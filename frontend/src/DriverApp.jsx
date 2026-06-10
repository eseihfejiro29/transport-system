/**
 * Driver App v5
 * - Real Benin City routes
 * - Driver sees WHERE passengers want to go at each stop
 * - Demand map visible before GPS is started
 * - Auto occupancy from passenger boarding
 * - Real GPS speed for accurate ETA
 */

import { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
const SERVER_URL = "https://transport-backend-05b9.onrender.com";

const ROUTES = [
  "Uselu - Ring Road",
  "Ring Road - Sapele Road",
  "New Benin - Ekiosa",
];

export default function DriverApp() {
  const savedDriver = JSON.parse(localStorage.getItem("driver_profile") || "null");

  const [registered, setRegistered] = useState(!!savedDriver);
  const [busId] = useState(savedDriver?.busId || "BUS_" + Math.random().toString(36).substr(2, 4).toUpperCase());
  const [driverName, setDriverName] = useState(savedDriver?.driverName || "");
  const [capacity, setCapacity] = useState(savedDriver?.capacity || 18);
  const [occupancy, setOccupancy] = useState(0);
  const [route, setRoute] = useState(savedDriver?.route || ROUTES[0]);
  const [isFull, setIsFull] = useState(false);
  const [stopDemand, setStopDemand] = useState([]);
  const [connected, setConnected] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const [alerts, setAlerts] = useState([]);
  const [expandedStop, setExpandedStop] = useState(null);
  const socketRef = useRef(null);
  const gpsIntervalRef = useRef(null);
  const watchIdRef = useRef(null);

  // Load demand immediately on mount (even before login)
  useEffect(() => {
    fetch(`${SERVER_URL}/api/demand`)
      .then(r => r.json()).then(setStopDemand).catch(() => {});
  }, []);

  useEffect(() => {
    const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      const saved = JSON.parse(localStorage.getItem("driver_profile") || "null");
      if (saved) {
        socket.emit("driver_register", {
          busId: saved.busId, driverName: saved.driverName,
          capacity: saved.capacity, route: saved.route
        });
      }
    });
    socket.on("disconnect", () => { setConnected(false); setTracking(false); });

    socket.on("stop_demand_snapshot", setStopDemand);

    // Live demand updates including destination breakdown
    socket.on("demand_snapshot_update", setStopDemand);
    socket.on("passenger_demand_update", update => {
      setStopDemand(prev => {
        const idx = prev.findIndex(s => s.stopId === update.stopId);
        if (idx >= 0) { const u = [...prev]; u[idx] = update; return u; }
        return [...prev, update];
      });
      if (update.totalPeopleWaiting >= 3)
        addAlert(`📣 ${update.totalPeopleWaiting} people at ${update.stopName}!`);
    });

    // Auto occupancy from passenger boarding
    socket.on("occupancy_auto_updated", ({ newOccupancy, message }) => {
      setOccupancy(newOccupancy);
      if (newOccupancy >= capacity) setIsFull(true);
      addAlert(`🧍 ${message}`);
    });

    return () => {
      socket.disconnect();
      if (gpsIntervalRef.current) clearInterval(gpsIntervalRef.current);
      if (watchIdRef.current) navigator.geolocation?.clearWatch(watchIdRef.current);
    };
  }, []);

  function addAlert(msg) {
    const id = Date.now();
    setAlerts(prev => [{ id, msg }, ...prev.slice(0, 3)]);
    setTimeout(() => setAlerts(prev => prev.filter(a => a.id !== id)), 8000);
  }

  function handleRegister() {
    if (!driverName.trim()) return;
    localStorage.setItem("driver_profile", JSON.stringify({ busId, driverName, capacity, route }));
    socketRef.current.emit("driver_register", { busId, driverName, capacity, route });
    setRegistered(true);
  }

  function handleSwitchDriver() {
    localStorage.removeItem("driver_profile");
    setRegistered(false);
    setDriverName("");
    setOccupancy(0);
    setIsFull(false);
    setTracking(false);
    if (gpsIntervalRef.current) clearInterval(gpsIntervalRef.current);
    if (watchIdRef.current) navigator.geolocation?.clearWatch(watchIdRef.current);
  }

  function startTracking() {
    if (!navigator.geolocation) { simulateGPS(); return; }
    watchIdRef.current = navigator.geolocation.watchPosition(
      pos => {
        const { latitude: lat, longitude: lng, speed } = pos.coords;
        const speedKmh = speed ? Math.round(speed * 3.6) : 0;
        setCurrentLocation({ lat, lng });
        setCurrentSpeed(speedKmh);
        socketRef.current.emit("driver_location_update", { busId, lat, lng, occupancy, speedKmh });
      },
      () => simulateGPS(),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
    );
    setTracking(true);
  }

  function simulateGPS() {
    const path = [
      { lat: 6.3715, lng: 5.6303, speed: 22 },
      { lat: 6.3650, lng: 5.6280, speed: 28 },
      { lat: 6.3580, lng: 5.6250, speed: 15 },
      { lat: 6.3500, lng: 5.6230, speed: 30 },
      { lat: 6.3450, lng: 5.6220, speed: 20 },
      { lat: 6.3401, lng: 5.6218, speed: 10 },
    ];
    let step = 0;
    gpsIntervalRef.current = setInterval(() => {
      const pos = path[step % path.length];
      setCurrentLocation({ lat: pos.lat, lng: pos.lng });
      setCurrentSpeed(pos.speed);
      socketRef.current.emit("driver_location_update", {
        busId, lat: pos.lat, lng: pos.lng, occupancy, speedKmh: pos.speed
      });
      step++;
    }, 4000);
    setTracking(true);
  }

  function stopTracking() {
    if (gpsIntervalRef.current) clearInterval(gpsIntervalRef.current);
    if (watchIdRef.current) navigator.geolocation?.clearWatch(watchIdRef.current);
    setTracking(false);
    setCurrentSpeed(0);
  }

  function handleOccupancyChange(val) {
    const newOcc = Math.max(0, Math.min(capacity, occupancy + val));
    setOccupancy(newOcc);
    socketRef.current.emit("driver_occupancy_update", { busId, occupancy: newOcc });
    if (newOcc >= capacity && !isFull) setIsFull(true);
    if (newOcc < capacity && isFull) setIsFull(false);
  }

  function markBusFull() {
    setIsFull(true); setOccupancy(capacity);
    socketRef.current.emit("driver_mark_full", { busId });
    addAlert("🚫 Bus marked FULL — all passengers notified.");
  }

  function reopenBus() {
    setIsFull(false);
    socketRef.current.emit("driver_reopen_bus", { busId });
    addAlert("✅ Bus reopened — passengers notified.");
  }

  const pct = Math.round((occupancy / capacity) * 100);
  const seatsLeft = Math.max(0, capacity - occupancy);
  const occColor = pct < 50 ? "#22c55e" : pct < 80 ? "#f59e0b" : "#ef4444";
  const topStop = stopDemand.filter(s => s.totalPeopleWaiting > 0)[0];

  // ── Registration Screen ───────────────────────────────────────────────────
  if (!registered) {
    return (
      <div style={S.container}>
        <div style={S.header}>
          <div style={S.logo}>🚌 DriverLink</div>
          <div style={S.logoSub}>Benin City Transport Network</div>
        </div>

        {/* Demand visible before login */}
        {stopDemand.some(s => s.totalPeopleWaiting > 0) && (
          <div style={S.preDemandBox}>
            <div style={S.preDemandTitle}>🔥 Passengers waiting right now</div>
            <div style={S.preDemandSub}>Register to see full details and head to the busiest stop</div>
            {stopDemand.filter(s => s.totalPeopleWaiting > 0).map(stop => (
              <div key={stop.stopId} style={S.preDemandRow}>
                <span style={S.preDemandName}>{stop.stopName}</span>
                <span style={{
                  ...S.preDemandCount,
                  color: stop.totalPeopleWaiting >= 5 ? "#ef4444" : "#f59e0b"
                }}>{stop.totalPeopleWaiting} people</span>
              </div>
            ))}
          </div>
        )}

        <div style={S.form}>
          <label style={S.label}>Your Name</label>
          <input style={S.input} placeholder="e.g. Emeka" value={driverName}
            onChange={e => setDriverName(e.target.value)} />

          <label style={S.label}>Select Route</label>
          <select style={S.input} value={route} onChange={e => setRoute(e.target.value)}>
            {ROUTES.map(r => <option key={r}>{r}</option>)}
          </select>

          <label style={S.label}>Bus Capacity (seats)</label>
          <input style={S.input} type="number" value={capacity}
            onChange={e => setCapacity(+e.target.value)} min={5} max={60} />

          <button style={S.goBtn} onClick={handleRegister}>Go Live →</button>
        </div>
      </div>
    );
  }

  // ── Driver Dashboard ──────────────────────────────────────────────────────
  return (
    <div style={S.container}>

      {/* Header */}
      <div style={S.header}>
        <div style={S.hrow}>
          <div>
            <div style={S.logo}>🚌 {busId}</div>
            <div style={S.logoSub}>{driverName} · {route}</div>
          </div>
          <span style={{ ...S.dot, background: connected ? "#22c55e" : "#ef4444" }}>
            {connected ? "● LIVE" : "○ OFFLINE"}
          </span>
        </div>
      </div>

      {/* Switch Driver */}
      <div style={S.switchBar}>
        <span style={S.switchInfo}>Logged in as <strong style={{ color: "#f1f5f9" }}>{driverName}</strong></span>
        <button style={S.switchBtn} onClick={handleSwitchDriver}>↩ Switch Driver</button>
      </div>

      {/* Alerts */}
      {alerts.map(a => (
        <div key={a.id} style={S.alert}>{a.msg}</div>
      ))}

      {/* GPS */}
      <div style={S.section}>
        <div style={S.card}>
          <div style={S.cardRow}>
            <div>
              <div style={S.cardTitle}>GPS Tracking</div>
              {currentLocation
                ? <div style={S.coords}>
                    {currentLocation.lat.toFixed(5)}, {currentLocation.lng.toFixed(5)}
                    {currentSpeed > 0 && <span style={{ color: "#38bdf8" }}> · {currentSpeed} km/h</span>}
                  </div>
                : <div style={S.coords}>Tap Start to begin tracking</div>}
            </div>
            <button style={{ ...S.trackBtn, background: tracking ? "#dc2626" : "#16a34a" }}
              onClick={tracking ? stopTracking : startTracking}>
              {tracking ? "⏹ Stop" : "▶ Start"}
            </button>
          </div>
        </div>
      </div>

      {/* Occupancy */}
      <div style={S.section}>
        <div style={S.sectionTitle}>👥 PASSENGER COUNT</div>
        <div style={S.card}>
          <div style={S.autoNote}>🔄 Auto-updates when passengers board. Use +/− to correct if needed.</div>
          <div style={S.cntRow}>
            <button style={S.cntBtn} onClick={() => handleOccupancyChange(-1)} disabled={isFull}>−</button>
            <div style={{ textAlign: "center" }}>
              <span style={S.cntNum}>{occupancy}</span>
              <span style={{ fontSize: 16, color: "#64748b" }}> / {capacity}</span>
            </div>
            <button style={S.cntBtn} onClick={() => handleOccupancyChange(1)} disabled={isFull}>+</button>
          </div>

          <div style={S.seatsRow}>
            <span style={{ ...S.seatsNum, color: isFull ? "#ef4444" : occColor }}>
              {isFull ? 0 : seatsLeft}
            </span>
            <span style={S.seatsLabel}>
              {isFull ? "No seats available" : `seat${seatsLeft !== 1 ? "s" : ""} remaining`}
            </span>
          </div>

          <div style={S.barBg}>
            <div style={{ ...S.barFill, width: `${pct}%`, background: isFull ? "#ef4444" : occColor }} />
          </div>
          <div style={{ ...S.coords, marginTop: 4 }}>{pct}% full</div>

          {!isFull
            ? <button style={S.fullBtn} onClick={markBusFull}>🚫 Mark Bus as Full</button>
            : <button style={S.reopenBtn} onClick={reopenBus}>✅ Reopen — Seats Available</button>}
          {isFull && (
            <div style={S.fullWarn}>All passengers notified. Tap Reopen when seats free up.</div>
          )}
        </div>
      </div>

      {/* Demand with destination breakdown */}
      <div style={S.section}>
        <div style={S.sectionTitle}>📍 WHERE PASSENGERS WANT TO GO</div>

        {topStop && (
          <div style={S.hotspot}>
            <div style={S.hotspotLabel}>🎯 HIGHEST DEMAND</div>
            <div style={S.hotspotStop}>{topStop.stopName}</div>
            <div style={S.hotspotCount}>{topStop.totalPeopleWaiting} people waiting</div>
          </div>
        )}

        {stopDemand.length === 0
          ? <div style={{ color: "#475569", fontSize: 13, textAlign: "center", padding: 16 }}>No passengers waiting</div>
          : stopDemand.map((stop, idx) => (
            <div key={stop.stopId} style={{ marginBottom: 8 }}>
              <button style={{
                ...S.demandBtn,
                borderColor: idx === 0 && stop.totalPeopleWaiting > 0 ? "#f59e0b" : "#334155"
              }} onClick={() => setExpandedStop(expandedStop === stop.stopId ? null : stop.stopId)}>
                <div style={S.demandLeft}>
                  {idx === 0 && stop.totalPeopleWaiting > 0 && <span style={S.hotBadge}>🔥 HOTSPOT</span>}
                  <span style={S.demandName}>{stop.stopName}</span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{
                    ...S.demandCount,
                    color: stop.totalPeopleWaiting >= 5 ? "#ef4444"
                      : stop.totalPeopleWaiting >= 2 ? "#f59e0b" : "#475569"
                  }}>
                    {stop.totalPeopleWaiting || 0} people
                  </div>
                  <div style={S.demandSub}>{stop.passengerCount || 0} check-in{stop.passengerCount !== 1 ? "s" : ""}</div>
                </div>
                <span style={{ fontSize: 10, color: "#64748b", marginLeft: 8 }}>
                  {expandedStop === stop.stopId ? "▲" : "▼"}
                </span>
              </button>

              {/* Expanded: destination breakdown */}
              {expandedStop === stop.stopId && (
                <div style={S.destPanel}>
                  {stop.destinationBreakdown && Object.keys(stop.destinationBreakdown).length > 0 ? (
                    <>
                      <div style={S.destTitle}>🗺 WHERE THEY ARE GOING</div>
                      {Object.entries(stop.destinationBreakdown)
                        .sort((a, b) => b[1] - a[1])
                        .map(([dest, count]) => (
                          <div key={dest} style={S.destRow}>
                            <span style={S.destName}>→ {dest}</span>
                            <span style={S.destCount}>{count} person{count !== 1 ? "s" : ""}</span>
                          </div>
                        ))}
                    </>
                  ) : (
                    <div style={{ color: "#475569", fontSize: 12 }}>No destination info yet</div>
                  )}
                </div>
              )}
            </div>
          ))
        }
      </div>

    </div>
  );
}

const S = {
  container: { background: "#0f172a", minHeight: "100vh", color: "#f1f5f9", fontFamily: "'Segoe UI', sans-serif", maxWidth: 430, margin: "0 auto", paddingBottom: 40 },
  header: { background: "linear-gradient(135deg, #064e3b, #065f46, #0d9488)", padding: "18px 16px 16px" },
  hrow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  logo: { fontSize: 20, fontWeight: 700, color: "#fff" },
  logoSub: { fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 2 },
  dot: { fontSize: 11, color: "#fff", padding: "4px 10px", borderRadius: 20, fontWeight: 700 },
  switchBar: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "#1e293b", padding: "8px 16px", borderBottom: "1px solid #334155" },
  switchInfo: { fontSize: 12, color: "#64748b" },
  switchBtn: { background: "transparent", color: "#94a3b8", border: "1px solid #334155", borderRadius: 8, padding: "4px 12px", fontSize: 12, cursor: "pointer" },
  preDemandBox: { margin: 14, background: "#1c1917", border: "1px solid #f59e0b", borderRadius: 14, padding: 14 },
  preDemandTitle: { fontSize: 15, fontWeight: 700, color: "#fbbf24", marginBottom: 4 },
  preDemandSub: { fontSize: 12, color: "#64748b", marginBottom: 10 },
  preDemandRow: { display: "flex", justifyContent: "space-between", marginBottom: 6 },
  preDemandName: { fontSize: 13, color: "#f1f5f9" },
  preDemandCount: { fontSize: 13, fontWeight: 700 },
  form: { padding: 16, display: "flex", flexDirection: "column", gap: 12 },
  label: { fontSize: 12, color: "#94a3b8", fontWeight: 600, letterSpacing: 0.5 },
  input: { background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: "12px 14px", color: "#f1f5f9", fontSize: 15, outline: "none" },
  goBtn: { background: "#0d9488", color: "#fff", border: "none", borderRadius: 12, padding: 14, fontSize: 16, fontWeight: 700, cursor: "pointer", marginTop: 6 },
  alert: { background: "#1e293b", borderLeft: "3px solid #0d9488", color: "#5eead4", padding: "9px 16px", fontSize: 13, fontWeight: 600 },
  section: { padding: "14px 16px 0" },
  sectionTitle: { fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 1.2, marginBottom: 10 },
  card: { background: "#1e293b", borderRadius: 14, padding: 16, border: "1px solid #334155" },
  cardRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontSize: 14, fontWeight: 600, color: "#f1f5f9" },
  coords: { fontSize: 12, color: "#64748b", marginTop: 4 },
  trackBtn: { color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", fontWeight: 700, cursor: "pointer", fontSize: 13 },
  autoNote: { fontSize: 12, color: "#64748b", background: "#0f172a", borderRadius: 8, padding: "6px 10px", marginBottom: 12 },
  cntRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  cntBtn: { width: 44, height: 44, background: "#334155", color: "#f1f5f9", border: "none", borderRadius: 10, fontSize: 22, fontWeight: 700, cursor: "pointer" },
  cntNum: { fontSize: 34, fontWeight: 800, color: "#f1f5f9" },
  seatsRow: { display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 },
  seatsNum: { fontSize: 30, fontWeight: 800 },
  seatsLabel: { fontSize: 13, color: "#94a3b8" },
  barBg: { background: "#334155", borderRadius: 6, height: 10, marginBottom: 4 },
  barFill: { height: "100%", borderRadius: 6, transition: "width 0.4s, background 0.4s" },
  fullBtn: { width: "100%", marginTop: 12, background: "#7f1d1d", color: "#fca5a5", border: "1.5px solid #ef4444", borderRadius: 10, padding: 11, fontSize: 14, fontWeight: 700, cursor: "pointer" },
  reopenBtn: { width: "100%", marginTop: 12, background: "#14532d", color: "#4ade80", border: "1.5px solid #22c55e", borderRadius: 10, padding: 11, fontSize: 14, fontWeight: 700, cursor: "pointer" },
  fullWarn: { marginTop: 8, background: "#451a03", color: "#fcd34d", borderRadius: 8, padding: "8px 12px", fontSize: 12 },
  hotspot: { background: "#1c1917", border: "1px solid #f59e0b", borderRadius: 12, padding: 14, marginBottom: 10, textAlign: "center" },
  hotspotLabel: { fontSize: 10, color: "#fbbf24", fontWeight: 700, letterSpacing: 1 },
  hotspotStop: { fontSize: 20, fontWeight: 700, color: "#f1f5f9", margin: "4px 0 2px" },
  hotspotCount: { fontSize: 13, color: "#f59e0b" },
  demandBtn: { width: "100%", display: "flex", alignItems: "center", background: "#1e293b", border: "1px solid", borderRadius: 12, padding: "12px 14px", cursor: "pointer", textAlign: "left", gap: 8 },
  demandLeft: { flex: 1, display: "flex", flexDirection: "column", gap: 2 },
  hotBadge: { fontSize: 10, color: "#fbbf24", fontWeight: 700, letterSpacing: 0.5 },
  demandName: { fontSize: 14, fontWeight: 600, color: "#f1f5f9" },
  demandCount: { fontSize: 16, fontWeight: 700 },
  demandSub: { fontSize: 11, color: "#64748b", marginTop: 1 },
  destPanel: { background: "#0f172a", border: "1px solid #334155", borderTop: "none", borderRadius: "0 0 12px 12px", padding: "12px 14px" },
  destTitle: { fontSize: 10, fontWeight: 700, color: "#64748b", letterSpacing: 1, marginBottom: 8 },
  destRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  destName: { fontSize: 13, color: "#94a3b8" },
  destCount: { fontSize: 13, fontWeight: 600, color: "#f1f5f9" },
};