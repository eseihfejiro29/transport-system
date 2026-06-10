/**
 * Real-Time Public Transport System - Backend Server v5
 * - Real Benin City stops, landmarks, fares
 * - Driver sees passenger destinations and counts
 * - Real GPS speed for accurate ETA
 * - Auto occupancy from passenger boarding
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(cors());
app.use(express.json());

// ─── Real Benin City Bus Stops ────────────────────────────────────────────────
const busStops = {
  'stop_001': {
    id: 'stop_001',
    name: 'Uselu Junction',
    lat: 6.3715, lng: 5.6303,
    subLocations: [
      'Uselu Market',
      'Uselu Roundabout',
      'Uselu Motor Park',
      'Textile Mile Junction',
      'Nitel Junction'
    ],
    fares: {
      'Ring Road': 300,
      'New Benin': 400,
      'Oluku': 550,
      'Uniben (Ugbowo)': 400
    },
    passengers: []
  },
  'stop_002': {
    id: 'stop_002',
    name: 'Ring Road',
    lat: 6.3401, lng: 5.6218,
    subLocations: [
      'Central Park',
      'Ring Road Roundabout',
      'Edo Museum',
      'Iyaro Motor Park'
    ],
    fares: {
      'Sapele Road': 300,
      'New Benin': 250,
      'GRA': 400,
      'Airport Road': 500
    },
    passengers: []
  },
  'stop_003': {
    id: 'stop_003',
    name: 'Sapele Road',
    lat: 6.3560, lng: 5.6450,
    subLocations: [
      'Kada Plaza Cinema',
      'Satana Market',
      'Agip Oghara Park',
      'Five Junction Bus Stop'
    ],
    fares: {
      'Agip Junction': 300,
      'Limit Junction': 350,
      'Adesuwa': 400,
      'Ring Road': 600
    },
    passengers: []
  },
  'stop_004': {
    id: 'stop_004',
    name: 'New Benin',
    lat: 6.3350, lng: 5.6290,
    subLocations: [
      'Total Filling Station',
      'New Benin Market',
      'Mission Road',
      'New Benin Bus Stop'
    ],
    fares: {
      'Ekiosa Junction': 350,
      'Ikpoba Hill': 400,
      'Ring Road': 200,
      'Uselu': 450
    },
    passengers: []
  },
  'stop_005': {
    id: 'stop_005',
    name: 'Ekiosa Junction',
    lat: 6.3800, lng: 5.6100,
    subLocations: [
      'Ekiosa Market',
      'Edo Line Bus Station',
      'Edegbe Line'
    ],
    fares: {
      'Ring Road': 350,
      'Mission Road': 250,
      'New Benin Market': 350,
      'Sakponba Road': 400
    },
    passengers: []
  },
};

const buses = {};

// ─── Utilities ────────────────────────────────────────────────────────────────
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateETA(distanceKm, speedKmh = 25) {
  const speed = speedKmh > 2 ? speedKmh : 25;
  return Math.round((distanceKm / speed) * 60);
}

function seatsAvailable(bus) {
  return Math.max(0, bus.capacity - bus.occupancy);
}

function broadcastBusFull(busId) {
  const bus = buses[busId];
  if (!bus) return;
  io.to('passengers').emit('bus_full', {
    busId, route: bus.route, driverName: bus.driverName,
    message: `Bus ${busId} on ${bus.route} is now FULL. Please wait for the next bus.`
  });
  io.to('passengers').emit('bus_occupancy_updated', {
    busId, occupancy: bus.occupancy,
    capacity: bus.capacity, seatsAvailable: 0, isFull: true
  });
}

// Build demand snapshot including destination breakdown for drivers
function getDemandSnapshot() {
  return Object.values(busStops).map(s => {
    const destinationBreakdown = {};
    s.passengers.forEach(p => {
      if (p.destination) {
        destinationBreakdown[p.destination] = (destinationBreakdown[p.destination] || 0) + (p.groupSize || 1);
      }
    });
    return {
      stopId: s.id,
      stopName: s.name,
      passengerCount: s.passengers.length,
      totalPeopleWaiting: s.passengers.reduce((sum, p) => sum + (p.groupSize || 1), 0),
      destinationBreakdown, // driver sees where people want to go
      location: { lat: s.lat, lng: s.lng }
    };
  }).sort((a, b) => b.totalPeopleWaiting - a.totalPeopleWaiting);
}

// ─── REST API ─────────────────────────────────────────────────────────────────
app.get('/api/buses', (req, res) => {
  res.json(Object.values(buses).map(b => ({ ...b, seatsAvailable: seatsAvailable(b) })));
});

app.get('/api/stops', (req, res) => {
  res.json(Object.values(busStops).map(s => ({
    ...s,
    passengerCount: s.passengers.length,
    totalPeopleWaiting: s.passengers.reduce((sum, p) => sum + (p.groupSize || 1), 0)
  })));
});

app.get('/api/demand', (req, res) => {
  res.json(getDemandSnapshot());
});

app.get('/api/stops/:stopId/approaching-buses', (req, res) => {
  const stop = busStops[req.params.stopId];
  if (!stop) return res.status(404).json({ error: 'Stop not found' });
  const groupSize = parseInt(req.query.groupSize) || 1;

  const approaching = Object.values(buses)
    .filter(b => b.isActive)
    .map(b => {
      const dist = haversineDistance(b.lat, b.lng, stop.lat, stop.lng);
      return {
        ...b,
        seatsAvailable: seatsAvailable(b),
        distanceKm: dist.toFixed(2),
        etaMinutes: estimateETA(dist, b.currentSpeedKmh || 25),
        occupancyPercent: Math.round((b.occupancy / b.capacity) * 100),
        canFitGroup: seatsAvailable(b) >= groupSize,
        seatsNeeded: groupSize,
      };
    })
    .filter(b => parseFloat(b.distanceKm) <= 10)
    .sort((a, b) => a.etaMinutes - b.etaMinutes);

  res.json(approaching);
});

// Passenger check-in — includes destination, auto-increments bus occupancy
app.post('/api/stops/:stopId/checkin', (req, res) => {
  const { passengerId, passengerName, groupSize = 1, destination, busId } = req.body;
  const stop = busStops[req.params.stopId];
  if (!stop) return res.status(404).json({ error: 'Stop not found' });

  if (!stop.passengers.find(p => p.passengerId === passengerId)) {
    stop.passengers.push({
      passengerId, passengerName, groupSize,
      destination: destination || null,
      checkinTime: new Date().toISOString()
    });
  }

  // Auto-increment bus occupancy when passenger boards
  if (busId && buses[busId]) {
    const newOcc = Math.min(buses[busId].capacity, buses[busId].occupancy + groupSize);
    buses[busId].occupancy = newOcc;
    if (newOcc >= buses[busId].capacity && !buses[busId].isFull) {
      buses[busId].isFull = true;
      broadcastBusFull(busId);
    } else {
      io.to('passengers').emit('bus_occupancy_updated', {
        busId, occupancy: newOcc, capacity: buses[busId].capacity,
        seatsAvailable: seatsAvailable(buses[busId]),
        isFull: buses[busId].isFull
      });
    }
    io.to('drivers').emit('occupancy_auto_updated', {
      busId, newOccupancy: newOcc, groupSize, stopName: stop.name,
      message: `${groupSize} passenger${groupSize > 1 ? 's' : ''} boarded at ${stop.name}${destination ? ` → ${destination}` : ''}`
    });
  }

  // Broadcast updated demand including destination breakdown
  const snapshot = getDemandSnapshot();
  io.to('drivers').emit('passenger_demand_update', snapshot.find(s => s.stopId === stop.id));
  io.to('drivers').emit('demand_snapshot_update', snapshot);

  res.json({ success: true });
});

app.post('/api/stops/:stopId/checkout', (req, res) => {
  const { passengerId } = req.body;
  const stop = busStops[req.params.stopId];
  if (!stop) return res.status(404).json({ error: 'Stop not found' });
  stop.passengers = stop.passengers.filter(p => p.passengerId !== passengerId);
  const snapshot = getDemandSnapshot();
  io.to('drivers').emit('passenger_demand_update', snapshot.find(s => s.stopId === stop.id));
  io.to('drivers').emit('demand_snapshot_update', snapshot);
  res.json({ success: true });
});

// ─── WebSocket ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  socket.on('driver_register', ({ busId, driverName, capacity, route }) => {
    socket.join('drivers');
    buses[busId] = {
      busId, driverName, capacity: capacity || 18, occupancy: 0,
      route, lat: 6.3715, lng: 5.6303,
      isActive: true, isFull: false, currentSpeedKmh: 0,
      socketId: socket.id, lastUpdated: new Date().toISOString()
    };
    socket.emit('stop_demand_snapshot', getDemandSnapshot());
    io.to('passengers').emit('bus_list_update',
      Object.values(buses).map(b => ({ ...b, seatsAvailable: seatsAvailable(b) })));
  });

  socket.on('driver_location_update', ({ busId, lat, lng, occupancy, speedKmh }) => {
    if (!buses[busId]) return;
    buses[busId].lat = lat;
    buses[busId].lng = lng;
    buses[busId].currentSpeedKmh = speedKmh || 0;
    if (occupancy !== undefined) buses[busId].occupancy = occupancy;
    buses[busId].lastUpdated = new Date().toISOString();

    if (buses[busId].occupancy >= buses[busId].capacity && !buses[busId].isFull) {
      buses[busId].isFull = true;
      broadcastBusFull(busId);
    }

    io.to('passengers').emit('bus_location_updated', {
      ...buses[busId],
      seatsAvailable: seatsAvailable(buses[busId]),
      stopETAs: Object.values(busStops).map(stop => {
        const dist = haversineDistance(lat, lng, stop.lat, stop.lng);
        return {
          stopId: stop.id, stopName: stop.name,
          distanceKm: dist.toFixed(2),
          etaMinutes: estimateETA(dist, buses[busId].currentSpeedKmh || 25)
        };
      })
    });
  });

  socket.on('driver_occupancy_update', ({ busId, occupancy }) => {
    if (!buses[busId]) return;
    buses[busId].occupancy = occupancy;
    if (occupancy >= buses[busId].capacity && !buses[busId].isFull) {
      buses[busId].isFull = true;
      broadcastBusFull(busId);
    }
    if (occupancy < buses[busId].capacity && buses[busId].isFull) {
      buses[busId].isFull = false;
      io.to('passengers').emit('bus_reopened', {
        busId, seatsAvailable: seatsAvailable(buses[busId]),
        route: buses[busId].route,
        message: `Bus ${buses[busId].busId} on ${buses[busId].route} now has seats available!`
      });
    }
    io.to('passengers').emit('bus_occupancy_updated', {
      busId, occupancy, capacity: buses[busId].capacity,
      seatsAvailable: seatsAvailable(buses[busId]),
      isFull: buses[busId].isFull
    });
  });

  socket.on('driver_mark_full', ({ busId }) => {
    if (!buses[busId]) return;
    buses[busId].isFull = true;
    buses[busId].occupancy = buses[busId].capacity;
    broadcastBusFull(busId);
  });

  socket.on('driver_reopen_bus', ({ busId }) => {
    if (!buses[busId]) return;
    buses[busId].isFull = false;
    io.to('passengers').emit('bus_reopened', {
      busId, seatsAvailable: seatsAvailable(buses[busId]),
      route: buses[busId].route,
      message: `Bus ${buses[busId].busId} on ${buses[busId].route} now has seats available!`
    });
    io.to('passengers').emit('bus_occupancy_updated', {
      busId, occupancy: buses[busId].occupancy,
      capacity: buses[busId].capacity,
      seatsAvailable: seatsAvailable(buses[busId]), isFull: false
    });
  });

  socket.on('passenger_subscribe', ({ passengerId, stopId }) => {
    socket.join('passengers');
    if (stopId) socket.join(`stop_${stopId}`);
    socket.emit('bus_list_update',
      Object.values(buses).map(b => ({ ...b, seatsAvailable: seatsAvailable(b) })));
  });

  socket.on('disconnect', () => {
    const bus = Object.values(buses).find(b => b.socketId === socket.id);
    if (bus) {
      buses[bus.busId].isActive = false;
      io.to('passengers').emit('bus_disconnected', { busId: bus.busId });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚌 Transport System v5 running on port ${PORT}`));