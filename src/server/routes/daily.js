/**
 * Daily.co Room Management
 *
 * Creates rooms via the Daily HTTP API and generates short-lived join tokens.
 * Both caller and staff join the same Daily room using their tokens.
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const router = express.Router();

const DAILY_API_KEY = process.env.DAILY_API_KEY || '';
const DAILY_API_BASE = 'https://api.daily.co/v1';

// In-memory room tracking (ephemeral)
const rooms = new Map();

/**
 * Create a Daily room via API and return its URL.
 */
async function createDailyRoom(name) {
  if (!DAILY_API_KEY) {
    // No API key — fall back to a synthetic URL
    return `https://api.daily.co/apps/meetings/rooms/${name}`;
  }

  const response = await fetch(`${DAILY_API_BASE}/rooms`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${DAILY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: `scream-${name.slice(0, 8)}`,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    let errMsg = errText;
    try {
      const err = JSON.parse(errText);
      errMsg = err.message || err.error || errText;
    } catch { /* use raw text */ }
    console.error('[Daily] Room creation failed:', response.status, errMsg);
    throw new Error(`Daily API ${response.status}: ${errMsg}`);
  }

  const room = await response.json();
  console.log('[Daily] Room created:', room.url);
  return room.url;
}

/**
 * Generate a short-lived JWT for joining a Daily room.
 * Uses HS256 with the Daily API key.
 */
function generateJoinToken(roomName, participantName, ttlSeconds = 300) {
  if (!DAILY_API_KEY) {
    return '';
  }

  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: DAILY_API_KEY,
    aud: 'https://api.daily.co',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    nbf: Math.floor(Date.now() / 1000),
    sub: participantName,
    permissions: {
      roomCreate: false,
      roomUpdate: false,
      record: false,
      liveStream: false,
      publish: true,
      subscribe: true,
    },
    room: roomName,
  })).toString('base64url');

  const signature = crypto
    .createHmac('sha256', DAILY_API_KEY)
    .update(`${header}.${payload}`)
    .digest('base64url');

  return `${header}.${payload}.${signature}`;
}

/**
 * POST /api/daily/join-room
 * Caller requests a new room.
 * Creates the Daily room, generates a join token.
 * Returns: { roomName, roomUrl, token }
 */
router.post('/join-room', async (req, res) => {
  try {
    const roomName = uuidv4();

    // Create the room in Daily
    const roomUrl = await createDailyRoom(roomName);

    // Generate a join token for the caller
    const token = generateJoinToken(roomName, 'caller');

    rooms.set(roomName, {
      createdAt: Date.now(),
      roomUrl,
      callerToken: token,
      callerJoined: true,
      staffJoined: false,
    });

    res.json({ roomName, roomUrl, token });
  } catch (err) {
    console.error('[Daily] join-room error:', err.message);
    res.status(500).json({ error: `Failed to create room: ${err.message}` });
  }
});

/**
 * POST /api/daily/staff-join
 * Staff requests a join token for an existing room.
 * Returns: { roomName, roomUrl, token }
 */
router.post('/staff-join', async (req, res) => {
  try {
    const { roomName } = req.body;
    const room = rooms.get(roomName);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const token = generateJoinToken(roomName, 'staff');
    room.staffJoined = true;

    res.json({ roomName, roomUrl: room.roomUrl, token });
  } catch (err) {
    console.error('[Daily] staff-join error:', err.message);
    res.status(500).json({ error: err.message });
  }
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
