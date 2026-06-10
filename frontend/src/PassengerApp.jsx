/**
 * Passenger App v5
 * - Real Benin City stops with exact landmarks and fares
 * - Passenger selects destination before boarding
 * - Boarding auto-updates bus occupancy
 * - Group size defaults to 1
 */

import { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";

const SERVER_URL = "https://transport-backend-05b9.onrender.com";
const PASSENGER_ID = "passenger_" + Math.random().toString(36).substr(2, 9);

export default function PassengerApp() {
  const [buses, setBuses] = useState([]);
  const [stops, setStops] = useState([]);
  const [selectedStop, setSelectedStop] = useState(null);
  const [selectedDestination, setSelectedDestination] = useState(null);
  const [approachingBuses, setApproachingBuses] = useState([]);
  const [checkedIn, setCheckedIn] = useState(false);
  const [boardedBusId, setBoardedBusId] = useState(null);
  const [groupSize, setGroupSize] = useState(1);
  const [connected, setConnected] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [expandedStop, setExpandedStop] = useState(null);
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = io(SERVER_URL);
    socketRef.current = socket;
    socket.on("connect", () => {
      setConnected(true);
      socket.emit("passenger_subscribe", { passengerId: PASSENGER_ID });
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("bus_list_update", list =>
      setBuses(list.map(b => ({ ...b, seatsAvailable: b.capacity - b.occupancy }))));
    socket.on("bus_location_updated", updated =>
      setBuses(prev => prev.map(b => b.busId === updated.busId
        ? { ...updated, seatsAvailable: updated.seatsAvailable ?? (updated.capacity - updated.occupancy) }
        : b)));
    socket.on("bus_occupancy_updated", ({ busId, occupancy, capacity, seatsAvailable, isFull }) =>
      setBuses(prev => prev.map(b => b.busId === busId ? { ...b, occupancy, capacity, seatsAvailable, isFull } : b)));
    socket.on("bus_full", ({ busId, message }) => {
      addNotif({ type: "danger", message });
      setBuses(prev => prev.map(b => b.busId === busId ? { ...b, isFull: true, seatsAvailable: 0 } : b));
    });
    socket.on("bus_reopened", ({ busId, seatsAvailable, message }) => {
      addNotif({ type: "success", message });
      setBuses(prev => prev.map(b => b.busId === busId ? { ...b, isFull: false, seatsAvailable } : b));
    });
    socket.on("bus_disconnected", ({ busId }) =>
      setBuses(prev => prev.filter(b => b.busId !== busId)));
    fetch(`${SERVER_URL}/api/stops`).then(r => r.json()).then(setStops).catch(() => {});
    return () => socket.disconnect();
  }, []);

  useEffect(() => {
    if (!selectedStop) return;
    fetch(`${SERVER_URL}/api/stops/${selectedStop.id}/approaching-buses?groupSize=${groupSize}`)
      .then(r => r.json()).then(setApproachingBuses).catch(() => {});
  }, [selectedStop, buses, groupSize]);

  function addNotif(n) {
    const id = Date.now();
    setNotifications(prev => [{ ...n, id }, ...prev.slice(0, 2)]);
    setTimeout(() => setNotifications(prev => prev.filter(x => x.id !== id)), 6000);
  }

  async function handleBoard(busId) {
    if (!selectedStop) return;
    await fetch(`${SERVER_URL}/api/stops/${selectedStop.id}/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        passengerId: PASSENGER_ID,
        passengerName: "Commuter",
        groupSize,
        destination: selectedDestination,
        busId
      })
    });
    setCheckedIn(true);
    setBoardedBusId(busId);
    addNotif({
      type: "info",
      message: `✅ Boarded Bus ${busId}${selectedDestination ? ` → ${selectedDestination}` : ""}. ${groupSize > 1 ? `Group of ${groupSize} counted.` : "You have been counted."}`
    });
  }

  async function handleAlight() {
    if (!selectedStop) return;
    await fetch(`${SERVER_URL}/api/stops/${selectedStop.id}/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passengerId: PASSENGER_ID })
    });
    setCheckedIn(false);
    setBoardedBusId(null);
    setSelectedDestination(null);
  }

  function getBarColor(seats, capacity) {
    const pct = 1 - seats / capacity;
    return pct < 0.5 ? "#22c55e" : pct < 0.8 ? "#f59e0b" : "#ef4444";
  }

  return (
    <div style={S.container}>

      {/* Header */}
      <div style={S.header}>
        <div style={S.hrow}>
          <div>
            <div style={S.logo}>🚌 TransitNow Benin</div>
            <div style={S.logoSub}>Real-Time Bus Tracker</div>
          </div>
          <span style={{ ...S.liveDot, background: connected ? "#22c55e" : "#ef4444" }}>
            {connected ? "● LIVE" : "○ OFFLINE"}
          </span>
        </div>
      </div>

      {/* Notifications */}
      {notifications.map(n => (
        <div key={n.id} style={{
          ...S.notif,
          background: n.type === "danger" ? "#7f1d1d" : n.type === "success" ? "#14532d" : "#1e3a5f",
          borderLeft: `3px solid ${n.type === "danger" ? "#ef4444" : n.type === "success" ? "#22c55e" : "#3b82f6"}`
        }}>{n.message}</div>
      ))}

      {/* Group Size */}
      <div style={S.section}>
        <div style={S.sectionTitle}>👥 TRAVELLING AS</div>
        <div style={S.groupRow}>
          {[1, 2, 3, 4, 5, 6].map(n => (
            <button key={n} style={{ ...S.groupBtn, ...(groupSize === n ? S.groupBtnOn : {}) }}
              onClick={() => setGroupSize(n)}>{n}{n === 6 ? "+" : ""}</button>
          ))}
        </div>
        {groupSize > 1 && <p style={S.hint}>Searching for buses with {groupSize}+ seats</p>}
      </div>

      {/* Stop Selection */}
      <div style={S.section}>
        <div style={S.sectionTitle}>📍 WHERE ARE YOU WAITING?</div>
        {stops.map(stop => (
          <div key={stop.id} style={{ marginBottom: 8 }}>

            {/* Stop button */}
            <button style={{
              ...S.stopBtn,
              ...(selectedStop?.id === stop.id ? S.stopBtnOn : {})
            }} onClick={() => {
              setSelectedStop(stop);
              setCheckedIn(false);
              setSelectedDestination(null);
              setExpandedStop(expandedStop === stop.id ? null : stop.id);
            }}>
              <div style={{ flex: 1 }}>
                <div style={S.stopName}>{stop.name}</div>
                <div style={S.stopLandmarks}>
                  {stop.subLocations?.slice(0, 2).join("  ·  ")}
                </div>
              </div>
              <div style={S.stopRight}>
                <div style={S.stopCount}>{stop.totalPeopleWaiting || stop.passengerCount || 0}</div>
                <div style={S.stopCountLabel}>waiting</div>
              </div>
              <div style={{ ...S.chevron, transform: expandedStop === stop.id ? "rotate(180deg)" : "rotate(0deg)" }}>▼</div>
            </button>

            {/* Expanded panel */}
            {expandedStop === stop.id && (
              <div style={S.panel}>

                {/* Landmarks */}
                <div style={S.panelSection}>
                  <div style={S.panelTitle}>📌 NEARBY LANDMARKS</div>
                  <div style={S.landmarkGrid}>
                    {stop.subLocations?.map((loc, i) => (
                      <div key={i} style={S.landmarkTag}>📍 {loc}</div>
                    ))}
                  </div>
                </div>

                {/* Fares / Destination */}
                {stop.fares && (
                  <div style={S.panelSection}>
                    <div style={S.panelTitle}>💰 WHERE ARE YOU GOING? (Select to see fare)</div>
                    <div style={S.fareGrid}>
                      {Object.entries(stop.fares).map(([dest, fare]) => (
                        <button key={dest}
                          style={{
                            ...S.fareCard,
                            ...(selectedDestination === dest ? S.fareCardOn : {})
                          }}
                          onClick={() => setSelectedDestination(selectedDestination === dest ? null : dest)}>
                          <div style={S.fareDest}>{dest}</div>
                          <div style={S.fareAmt}>₦{fare}</div>
                          {groupSize > 1 && (
                            <div style={S.fareTotal}>₦{fare * groupSize} for {groupSize}</div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            )}
          </div>
        ))}
      </div>

      {/* Selected fare summary */}
      {selectedStop && selectedDestination && (
        <div style={S.fareSummary}>
          <div>
            <div style={S.fareSummaryRoute}>{selectedStop.name} → {selectedDestination}</div>
            {groupSize > 1 && <div style={S.fareSummaryNote}>Group of {groupSize}</div>}
          </div>
          <div style={S.fareSummaryAmt}>
            ₦{selectedStop.fares?.[selectedDestination]}
            {groupSize > 1 && (
              <div style={S.fareSummaryTotal}>₦{(selectedStop.fares?.[selectedDestination] || 0) * groupSize} total</div>
            )}
          </div>
        </div>
      )}

      {/* Approaching Buses */}
      {selectedStop && (
        <div style={S.section}>
          <div style={S.sectionTitle}>
            🚍 BUSES APPROACHING {selectedStop.name.toUpperCase()}
            {groupSize > 1 && <span style={{ color: "#3b82f6", fontWeight: 400, textTransform: "none" }}> · need {groupSize} seats</span>}
          </div>

          {approachingBuses.length === 0 ? (
            <div style={S.emptyCard}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
              <div style={{ color: "#94a3b8", fontSize: 14 }}>No buses within 10km right now</div>
              <div style={{ color: "#475569", fontSize: 12, marginTop: 4 }}>Check back shortly</div>
            </div>
          ) : (
            approachingBuses.map(bus => (
              <div key={bus.busId} style={{
                ...S.busCard,
                borderColor: bus.isFull ? "#ef4444" : bus.canFitGroup ? "#22c55e" : "#334155",
              }}>
                {/* Full banner */}
                {bus.isFull && (
                  <div style={S.fullBanner}>🚫 BUS FULL — Please wait for the next bus</div>
                )}

                {/* Group fit badge */}
                {!bus.isFull && groupSize > 1 && (
                  <div style={{
                    ...S.fitBadge,
                    background: bus.canFitGroup ? "#14532d" : "#7c2d12",
                    color: bus.canFitGroup ? "#4ade80" : "#fca5a5"
                  }}>
                    {bus.canFitGroup
                      ? `✅ Can fit your group of ${groupSize}`
                      : `⚠️ Only ${bus.seatsAvailable} seat${bus.seatsAvailable !== 1 ? "s" : ""} — not enough for ${groupSize}`}
                  </div>
                )}

                {/* Bus header */}
                <div style={S.busHeader}>
                  <div>
                    <div style={S.busId}>{bus.busId}</div>
                    <div style={S.busRoute}>{bus.route}</div>
                    <div style={S.busDriver}>Driver: {bus.driverName}</div>
                  </div>
                  <div style={S.etaBox}>
                    <div style={S.etaNum}>{bus.etaMinutes}</div>
                    <div style={S.etaLbl}>min</div>
                  </div>
                </div>

                {/* Seats */}
                <div style={S.seatsRow}>
                  <span style={{ ...S.seatsNum, color: bus.isFull ? "#ef4444" : getBarColor(bus.seatsAvailable, bus.capacity) }}>
                    {bus.isFull ? 0 : bus.seatsAvailable}
                  </span>
                  <span style={S.seatsLabel}>{bus.isFull ? "No seats" : "seats available"}</span>
                  <span style={S.seatsDist}>{bus.distanceKm} km away</span>
                </div>

                {/* Bar */}
                <div style={S.barBg}>
                  <div style={{
                    ...S.barFill,
                    width: `${bus.occupancyPercent}%`,
                    background: bus.isFull ? "#ef4444" : getBarColor(bus.seatsAvailable, bus.capacity)
                  }} />
                </div>

                {/* Board / Alight */}
                {!bus.isFull && !checkedIn && (
                  <button style={S.boardBtn} onClick={() => handleBoard(bus.busId)}>
                    🚌 Board this bus{groupSize > 1 ? ` (${groupSize} people)` : ""}
                    {selectedDestination ? ` → ${selectedDestination}` : ""}
                  </button>
                )}
                {checkedIn && boardedBusId === bus.busId && (
                  <div style={S.boardedRow}>
                    <div>
                      <div style={{ color: "#4ade80", fontWeight: 600, fontSize: 13 }}>✅ You are on this bus</div>
                      {selectedDestination && <div style={{ color: "#86efac", fontSize: 12 }}>→ {selectedDestination}</div>}
                    </div>
                    <button style={S.alightBtn} onClick={handleAlight}>Alight</button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* All buses summary */}
      <div style={S.section}>
        <div style={S.sectionTitle}>🗺 ALL ACTIVE BUSES ({buses.length})</div>
        {buses.length === 0
          ? <p style={{ color: "#475569", fontSize: 13, textAlign: "center", padding: "16px 0" }}>No buses active</p>
          : buses.map(bus => (
            <div key={bus.busId} style={{ ...S.miniCard, borderColor: bus.isFull ? "#ef4444" : "#334155" }}>
              <div>
                <span style={S.busId}>{bus.busId}</span>
                <span style={{ ...S.busRoute, marginLeft: 8 }}>{bus.route}</span>
              </div>
              <span style={{
                fontWeight: 600, fontSize: 13,
                color: bus.isFull ? "#ef4444"
                  : getBarColor(bus.seatsAvailable ?? (bus.capacity - bus.occupancy), bus.capacity)
              }}>
                {bus.isFull ? "FULL" : `${bus.seatsAvailable ?? (bus.capacity - bus.occupancy)} seats`}
              </span>
            </div>
          ))}
      </div>

    </div>
  );
}

const S = {
  container: { background: "#0f172a", minHeight: "100vh", color: "#f1f5f9", fontFamily: "'Segoe UI', sans-serif", maxWidth: 430, margin: "0 auto", paddingBottom: 40 },
  header: { background: "linear-gradient(135deg, #1e3a8a, #1d4ed8, #0ea5e9)", padding: "18px 16px 16px" },
  hrow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  logo: { fontSize: 20, fontWeight: 700, color: "#fff" },
  logoSub: { fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 2 },
  liveDot: { fontSize: 11, color: "#fff", padding: "4px 10px", borderRadius: 20, fontWeight: 700 },
  notif: { padding: "10px 16px", fontSize: 13, fontWeight: 500, marginBottom: 1 },
  section: { padding: "14px 16px 0" },
  sectionTitle: { fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 1.2, marginBottom: 10 },
  groupRow: { display: "flex", gap: 8 },
  groupBtn: { width: 46, height: 46, borderRadius: 10, border: "1.5px solid #334155", background: "#1e293b", color: "#64748b", fontSize: 16, fontWeight: 600, cursor: "pointer" },
  groupBtnOn: { background: "#1d4ed8", borderColor: "#3b82f6", color: "#fff" },
  hint: { fontSize: 12, color: "#64748b", marginTop: 6 },
  stopBtn: { width: "100%", display: "flex", alignItems: "center", gap: 10, background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: "12px 14px", cursor: "pointer", textAlign: "left" },
  stopBtnOn: { background: "#1e3a5f", borderColor: "#3b82f6" },
  stopName: { fontSize: 15, fontWeight: 600, color: "#f1f5f9" },
  stopLandmarks: { fontSize: 11, color: "#64748b", marginTop: 3 },
  stopRight: { textAlign: "right", minWidth: 36 },
  stopCount: { fontSize: 20, fontWeight: 700, color: "#f1f5f9", lineHeight: 1 },
  stopCountLabel: { fontSize: 10, color: "#64748b" },
  chevron: { fontSize: 10, color: "#64748b", transition: "transform 0.2s", marginLeft: 4 },
  panel: { background: "#0f172a", border: "1px solid #334155", borderTop: "none", borderRadius: "0 0 12px 12px", padding: 14 },
  panelSection: { marginBottom: 14 },
  panelTitle: { fontSize: 10, fontWeight: 700, color: "#64748b", letterSpacing: 1, marginBottom: 8 },
  landmarkGrid: { display: "flex", flexWrap: "wrap", gap: 6 },
  landmarkTag: { background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "5px 10px", fontSize: 12, color: "#94a3b8" },
  fareGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  fareCard: { background: "#1e293b", border: "1.5px solid #334155", borderRadius: 10, padding: "10px 12px", cursor: "pointer", textAlign: "left" },
  fareCardOn: { background: "#1e3a5f", borderColor: "#3b82f6" },
  fareDest: { fontSize: 12, color: "#94a3b8", marginBottom: 4 },
  fareAmt: { fontSize: 20, fontWeight: 700, color: "#22c55e" },
  fareTotal: { fontSize: 11, color: "#4ade80", marginTop: 2 },
  fareSummary: { margin: "10px 16px 0", background: "#14532d", border: "1px solid #22c55e", borderRadius: 12, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" },
  fareSummaryRoute: { fontSize: 14, fontWeight: 600, color: "#86efac" },
  fareSummaryNote: { fontSize: 12, color: "#4ade80", marginTop: 2 },
  fareSummaryAmt: { fontSize: 22, fontWeight: 700, color: "#4ade80", textAlign: "right" },
  fareSummaryTotal: { fontSize: 12, color: "#86efac" },
  emptyCard: { background: "#1e293b", borderRadius: 14, padding: "28px 16px", textAlign: "center", border: "1px solid #334155" },
  busCard: { background: "#1e293b", borderRadius: 14, padding: 16, marginBottom: 12, border: "1.5px solid" },
  fullBanner: { background: "#7f1d1d", color: "#fca5a5", borderRadius: 8, padding: "7px 10px", fontSize: 13, fontWeight: 700, textAlign: "center", marginBottom: 10 },
  fitBadge: { borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 600, marginBottom: 10 },
  busHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 },
  busId: { fontSize: 15, fontWeight: 700, color: "#f1f5f9" },
  busRoute: { fontSize: 12, color: "#64748b" },
  busDriver: { fontSize: 12, color: "#475569", marginTop: 2 },
  etaBox: { background: "#1d4ed8", borderRadius: 10, padding: "6px 14px", textAlign: "center", minWidth: 56 },
  etaNum: { fontSize: 24, fontWeight: 800, color: "#fff" },
  etaLbl: { fontSize: 10, color: "rgba(255,255,255,0.7)" },
  seatsRow: { display: "flex", alignItems: "baseline", gap: 6, marginBottom: 8 },
  seatsNum: { fontSize: 26, fontWeight: 800 },
  seatsLabel: { fontSize: 13, color: "#94a3b8" },
  seatsDist: { fontSize: 12, color: "#475569", marginLeft: "auto" },
  barBg: { background: "#334155", borderRadius: 4, height: 6, marginBottom: 12 },
  barFill: { height: "100%", borderRadius: 4, transition: "width 0.5s, background 0.4s" },
  boardBtn: { width: "100%", background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 10, padding: 12, fontSize: 13, fontWeight: 700, cursor: "pointer" },
  boardedRow: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "#14532d", borderRadius: 10, padding: "10px 14px" },
  alightBtn: { background: "#ef4444", color: "#fff", border: "none", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 13, fontWeight: 600 },
  miniCard: { background: "#1e293b", borderRadius: 10, padding: "10px 14px", marginBottom: 7, border: "1px solid", display: "flex", justifyContent: "space-between", alignItems: "center" },
};