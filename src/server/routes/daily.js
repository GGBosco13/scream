/**
 * Daily.co Room Management
 *
 * POST /api/daily/join-room   – Caller requests a room (returns room name)
 * POST /api/daily/staff-join  – Staff joins the room
 *
 * Architecture:
 *   1. Caller clicks "Start Scream"
 *   2. Caller POSTs to /api/daily/join-room → server creates a room name (UUID)
 *   3. Caller's browser creates a Daily room + joins
 *   4. Server notifies staff (via WebSocket) with the room name
 *   5. Staff's browser joins the same Daily room
 *   6. Daily handles all WebRTC, ICE, NAT, TURN automatically
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

// In-memory room tracking (ephemeral)
const rooms = new Map();

/**
 * POST /api/daily/join-room
 * Caller requests a new room.
 * Returns: { roomName, roomUrl }
 */
router.post('/join-room', (req, res) => {
  const roomName = uuidv4();
  rooms.set(roomName, {
    createdAt: Date.now(),
    callerJoined: true,
    staffJoined: false,
  });

  // Room URL (Daily.js creates rooms on-the-fly)
  const roomUrl = `https://api.daily.co/apps/meetings/rooms/${roomName}`;

  res.json({ roomName, roomUrl });
});

/**
 * POST /api/daily/staff-join
 * Staff marks themselves as joined in a room.
 */
router.post('/staff-join', (req, res) => {
  const { roomName } = req.body;
  const room = rooms.get(roomName);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  room.staffJoined = true;
  res.json({ success: true, roomName });
});

/**
 * POST /api/daily/leave-room
 * Caller leaves and the room is cleaned up.
 */
router.post('/leave-room', (req, res) => {
  const { roomName } = req.body;
  rooms.delete(roomName);
  res.json({ success: true });
});

module.exports = router;
