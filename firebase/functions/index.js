/**
 * Scream – Firebase Cloud Functions
 * Handles: staff auth, call queue, routing, Daily room creation
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

admin.initializeApp();
const db = admin.firestore();

const DAILY_API_KEY = functions.config().daily?.api_key || process.env.DAILY_API_KEY || '';
const DAILY_API_BASE = 'https://api.daily.co/v1';

// ======================
// Daily Room Helpers
// ======================

async function createDailyRoom(name) {
  if (!DAILY_API_KEY) {
    return `https://api.daily.co/apps/meetings/rooms/${name}`;
  }

  const response = await fetch(`${DAILY_API_BASE}/rooms`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${DAILY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: `scream-${name.slice(0, 8)}` }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Daily API ${response.status}: ${errText}`);
  }

  const room = await response.json();
  return room.url;
}

function generateJoinToken(roomName, participantName, ttlSeconds = 300) {
  if (!DAILY_API_KEY) return '';

  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: DAILY_API_KEY,
    aud: 'https://api.daily.co',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    nbf: Math.floor(Date.now() / 1000),
    sub: participantName,
    permissions: {
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

// ======================
// API Cloud Function (HTTP)
// ======================

exports.api = functions.https.onRequest(async (req, res) => {
  // CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const path = req.path.replace(/^\/api/, '');
  const { method } = req;
  const { body } = req;

  try {
    // ======================
    // Health
    // ======================
    if (path === '/health' && method === 'GET') {
      return res.json({ status: 'ok', timestamp: Date.now() });
    }

    // ======================
    // Staff Login
    // ======================
    if (path === '/auth/login' && method === 'POST') {
      const { employeeId, password } = body;
      if (!employeeId || !password) {
        return res.status(400).json({ error: 'Missing credentials' });
      }

      // Check staff document
      const staffDoc = await db.collection('staff').doc(employeeId).get();
      if (!staffDoc.exists) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const staff = staffDoc.data();
      if (staff.password !== password || !staff.active) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Update status to available
      await db.collection('staff').doc(employeeId).update({
        status: 'available',
        lastSeen: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.json({
        success: true,
        staffId: employeeId,
        role: staff.role,
        status: 'available',
      });
    }

    // ======================
    // Staff Logout
    // ======================
    if (path === '/auth/logout' && method === 'POST') {
      const { employeeId } = body;
      if (employeeId) {
        await db.collection('staff').doc(employeeId).update({
          status: 'away',
          lastSeen: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      return res.json({ success: true });
    }

    // ======================
    // Set Staff Status
    // ======================
    if (path === '/auth/status' && method === 'POST') {
      const { employeeId, status } = body;
      if (employeeId && status) {
        await db.collection('staff').doc(employeeId).update({
          status,
          lastSeen: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      return res.json({ success: true });
    }

    // ======================
    // Staff List
    // ======================
    if (path === '/auth/staff-list' && method === 'GET') {
      const snapshot = await db.collection('staff').get();
      const staffList = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          employeeId: doc.id,
          role: data.role,
          active: data.active,
          status: data.status,
        };
      });
      return res.json({ staffList });
    }

    // ======================
    // Admin: Create Staff
    // ======================
    if (path === '/auth/admin/create' && method === 'POST') {
      const { employeeId, password, role } = body;
      if (!employeeId || !password) {
        return res.status(400).json({ error: 'Missing fields' });
      }

      const existing = await db.collection('staff').doc(employeeId).get();
      if (existing.exists) {
        return res.status(409).json({ error: 'Staff already exists' });
      }

      const tempPassword = password + '-' + Math.random().toString(36).slice(2, 6);
      await db.collection('staff').doc(employeeId).set({
        employeeId,
        password: tempPassword,
        role: role || 'staff',
        active: true,
        status: 'away',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.json({
        success: true,
        employeeId,
        temporaryPassword: tempPassword,
      });
    }

    // ======================
    // Admin: Disable Staff
    // ======================
    if (path === '/auth/admin/disable' && method === 'POST') {
      const { employeeId } = body;
      if (employeeId) {
        await db.collection('staff').doc(employeeId).update({ active: false });
      }
      return res.json({ success: true });
    }

    // ======================
    // Admin: Reset Password
    // ======================
    if (path === '/auth/admin/reset-password' && method === 'POST') {
      const { employeeId, newPassword } = body;
      if (employeeId && newPassword) {
        await db.collection('staff').doc(employeeId).update({ password: newPassword });
      }
      return res.json({ success: true });
    }

    // ======================
    // Caller: Join Queue + Create Room
    // ======================
    if (path === '/daily/join-room' && method === 'POST') {
      const roomName = uuidv4();
      const roomUrl = await createDailyRoom(roomName);
      const token = generateJoinToken(roomName, 'caller');

      const callerId = uuidv4();

      // Add to queue
      await db.collection('queue').doc(callerId).set({
        callerId,
        roomName,
        roomUrl,
        joinedAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'queued',
      });

      // Try to route immediately
      await tryRouteCall(callerId);

      return res.json({
        callerId,
        roomName,
        roomUrl,
        token,
        position: 1,
      });
    }

    // ======================
    // Staff: Join Room (get token)
    // ======================
    if (path === '/daily/staff-join' && method === 'POST') {
      const { roomName } = body;
      if (!roomName) {
        return res.status(400).json({ error: 'Missing roomName' });
      }

      const token = generateJoinToken(roomName, 'staff');
      return res.json({
        roomName,
        token,
      });
    }

    // ======================
    // Leave Room / Cleanup
    // ======================
    if (path === '/daily/leave-room' && method === 'POST') {
      const { roomName, callerId } = body;
      if (callerId) {
        await db.collection('queue').doc(callerId).delete().catch(() => {});
      }
      if (roomName) {
        // Delete active call if exists
        const callsSnap = await db.collection('calls').where('roomName', '==', roomName).get();
        for (const doc of callsSnap.docs) {
          await cleanupCall(doc.id);
        }
      }
      return res.json({ success: true });
    }

    // ======================
    // Accept Call
    // ======================
    if (path === '/calls/accept' && method === 'POST') {
      const { callId, staffId } = body;
      if (!callId || !staffId) {
        return res.status(400).json({ error: 'Missing fields' });
      }

      const callDoc = await db.collection('calls').doc(callId).get();
      if (!callDoc.exists) {
        return res.status(404).json({ error: 'Call not found' });
      }

      const call = callDoc.data();

      // Update call status
      await db.collection('calls').doc(callId).update({
        status: 'connected',
        staffId,
        connectedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Update staff status
      await db.collection('staff').doc(staffId).update({
        status: 'busy',
        currentCallId: callId,
        currentCallerId: call.callerId,
      });

      // Notify caller via Realtime Database
      const rtdb = admin.database();
      await rtdb.ref(`calls/${callId}`).set({
        status: 'connected',
        staffId,
        timestamp: Date.now(),
      });

      return res.json({ success: true, callId });
    }

    // ======================
    // Decline Call
    // ======================
    if (path === '/calls/decline' && method === 'POST') {
      const { callId, staffId } = body;
      if (!callId || !staffId) {
        return res.status(400).json({ error: 'Missing fields' });
      }

      const callDoc = await db.collection('calls').doc(callId).get();
      if (callDoc.exists) {
        const call = callDoc.data();
        await db.collection('calls').doc(callId).update({ status: 'declined' });

        // Release staff
        await db.collection('staff').doc(staffId).update({
          status: 'available',
          currentCallId: null,
          currentCallerId: null,
        });

        // Notify caller
        const rtdb = admin.database();
        await rtdb.ref(`calls/${callId}`).set({
          status: 'declined',
          timestamp: Date.now(),
        });

        // Try to route to next staff
        await tryRouteCall(call.callerId);
      }

      return res.json({ success: true });
    }

    // ======================
    // End Call
    // ======================
    if (path === '/calls/end' && method === 'POST') {
      const { callId } = body;
      if (callId) {
        await cleanupCall(callId);
      }
      return res.json({ success: true });
    }

    // ======================
    // Queue Status
    // ======================
    if (path === '/queue/status' && method === 'GET') {
      const snapshot = await db.collection('queue').orderBy('joinedAt').get();
      const queue = snapshot.docs.map((doc, i) => ({
        position: i + 1,
        status: doc.data().status,
      }));
      return res.json({ queueLength: queue.length, queue });
    }

    // Fallback
    return res.status(404).json({ error: 'Not found' });

  } catch (err) {
    console.error('[API Error]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ======================
// Internal: Route Call to Available Staff
// ======================

async function tryRouteCall(callerId) {
  const callerDoc = await db.collection('queue').doc(callerId).get();
  if (!callerDoc.exists || callerDoc.data().status !== 'queued') return;

  const caller = callerDoc.data();

  // Find available staff
  const staffSnap = await db.collection('staff')
    .where('status', '==', 'available')
    .where('active', '==', true)
    .limit(1)
    .get();

  if (staffSnap.empty) return; // No available staff

  const staffDoc = staffSnap.docs[0];
  const staffId = staffDoc.id;

  // Create call record
  const callId = uuidv4();
  await db.collection('calls').doc(callId).set({
    callId,
    callerId,
    roomName: caller.roomName,
    roomUrl: caller.roomUrl,
    staffId,
    status: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Update caller queue status
  await db.collection('queue').doc(callerId).update({
    status: 'routed',
    callId,
  });

  // Set staff to busy (tentative)
  await db.collection('staff').doc(staffId).update({
    currentCallId: callId,
    currentCallerId: callerId,
  });

  // Notify staff via Realtime Database
  const rtdb = admin.database();
  await rtdb.ref(`staff/${staffId}/incoming`).set({
    callId,
    callerId,
    roomName: caller.roomName,
    roomUrl: caller.roomUrl,
    timestamp: Date.now(),
  });

  console.log(`[Route] ${callerId} → staff ${staffId} (call: ${callId})`);
}

// ======================
// Internal: Cleanup Call
// ======================

async function cleanupCall(callId) {
  const callDoc = await db.collection('calls').doc(callId).get();
  if (!callDoc.exists) return;

  const call = callDoc.data();

  // Mark as ended
  await db.collection('calls').doc(callId).update({
    status: 'ended',
    endedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Release staff
  if (call.staffId) {
    await db.collection('staff').doc(call.staffId).update({
      status: 'available',
      currentCallId: null,
      currentCallerId: null,
    });

    // Clear incoming notification
    const rtdb = admin.database();
    await rtdb.ref(`staff/${call.staffId}/incoming`).remove();
  }

  // Remove caller from queue
  if (call.callerId) {
    await db.collection('queue').doc(call.callerId).delete().catch(() => {});
  }

  // Notify caller via Realtime Database
  const rtdb = admin.database();
  await rtdb.ref(`calls/${callId}`).set({
    status: 'ended',
    timestamp: Date.now(),
  });

  console.log(`[Cleanup] Call ${callId} ended`);
}

// ======================
// Scheduled: Cleanup stale calls (every 5 min)
// ======================

exports.cleanupStaleCalls = functions.pubsub.schedule('every 5 minutes').onRun(async (context) => {
  const cutoff = Date.now() - 30 * 60 * 1000; // 30 min old

  const staleCalls = await db.collection('calls')
    .where('status', 'in', ['pending', 'connected'])
    .get();

  for (const doc of staleCalls.docs) {
    const call = doc.data();
    const createdAt = call.createdAt?.toMillis?.() || 0;
    if (createdAt < cutoff) {
      console.log(`[Cleanup] Stale call: ${doc.id}`);
      await cleanupCall(doc.id);
    }
  }

  // Cleanup stale queue entries
  const staleQueue = await db.collection('queue')
    .where('status', '==', 'queued')
    .get();

  for (const doc of staleQueue.docs) {
    const joinedAt = doc.data().joinedAt?.toMillis?.() || 0;
    if (joinedAt < cutoff) {
      await doc.ref.delete();
    }
  }
});
