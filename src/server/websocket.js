/**
 * WebSocket Signal Handler
 * Manages WebRTC signaling between callers and staff.
 * All handlers receive (ws, message, callManager, redisClient).
 */

const { v4: uuidv4 } = require('uuid');

function setupWebSocket(wss, callManager, redisClient) {

  wss.on('connection', (ws) => {

    ws.on('message', async (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); }
      catch { ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' })); return; }

      try {
        switch (message.type) {
          // ---- CALLER ----
          case 'join_queue':
            await handleCallerJoin(ws, message, callManager);
            break;
          case 'leave_queue':
            handleCallerLeave(ws, callManager);
            break;
          case 'create_offer':
            handleCallerOffer(ws, message, callManager);
            break;
          case 'set_answer':
            handleCallerAnswer(ws, message, callManager);
            break;
          case 'ice_candidate':
            handleICE(ws, message, callManager);
            break;

          // ---- STAFF ----
          case 'staff_login':
            handleStaffLogin(ws, message, callManager);
            break;
          case 'set_status':
            handleStatusChange(ws, message, callManager);
            break;
          case 'accept_call':
            handleAccept(ws, message, callManager);
            break;
          case 'decline_call':
            handleDecline(ws, message, callManager);
            break;
          case 'send_answer':
            handleStaffAnswer(ws, message, callManager);
            break;
          case 'end_call':
            handleEnd(ws, message, callManager, redisClient);
            break;
          default:
            ws.send(JSON.stringify({ type: 'error', message: `Unknown: ${message.type}` }));
        }
      } catch (err) {
        console.error('[WS] Handler error:', err.message);
      }
    });

    ws.on('close', () => {
      if (ws.staffId) {
        callManager.unregisterStaff(ws.staffId);
      }
      if (ws.callerId) {
        callManager.leaveQueue(ws.callerId);
        if (ws._poll) clearInterval(ws._poll);
        cleanupCaller(ws.callerId, callManager, redisClient);
      }
    });

    ws.on('error', (err) => {
      console.error('[WS] Client error:', err.message);
    });
  });

  // Broadcast method on the WebSocketServer
  wss.broadcast = function(data, excludeWs) {
    this.clients.forEach(client => {
      if (client !== excludeWs && client.readyState === 1) {
        client.send(typeof data === 'string' ? data : JSON.stringify(data));
      }
    });
  };
}

// ======================
// Caller handlers
// ======================

async function handleCallerJoin(ws, message, callManager) {
  const callerId = uuidv4();
  const roomName = message.sessionId || callerId; // Daily room name
  callManager.connections.set(`caller:${callerId}`, ws);
  await callManager.joinQueue(callerId);
  ws.callerId = callerId;
  ws.roomName = roomName;

  // Always confirm queue position to the caller
  ws.send(JSON.stringify({
    type: 'queued',
    sessionId: callerId,
    roomName,
    position: callManager.getQueueLength(),
    message: 'You are in the queue. Waiting for an available agent...',
  }));

  // Try to route immediately
  setTimeout(() => tryRoute(callerId, callManager, ws), 500);

  // Poll for availability every 2s
  ws._poll = setInterval(() => {
    if (ws.readyState !== 1) { clearInterval(ws._poll); return; }
    tryRoute(callerId, callManager, ws);
  }, 2000);
}

function tryRoute(callerId, callManager, ws) {
  if (ws._routed) return;
  const route = callManager.routeNextCall(ws.roomName);
  if (!route) return;

  ws._routed = true;
  ws.callInfo = route;
  if (ws._poll) { clearInterval(ws._poll); ws._poll = null; }

  const roomName = ws.roomName || route.callId;
  const staffWs = callManager.connections.get(`staff:${route.staffId}`);
  if (staffWs && staffWs.readyState === 1) {
    staffWs.send(JSON.stringify({
      type: 'incoming_call',
      callId: roomName,
      roomName,
      callerId,
      message: 'Anonymous caller is waiting...',
    }));
  }
  ws.send(JSON.stringify({
    type: 'call_incoming',
    callId: roomName,
    roomName,
    message: 'Connecting to agent...',
  }));
}

function handleCallerLeave(ws, callManager) {
  if (ws.callerId) {
    callManager.leaveQueue(ws.callerId);
    if (ws._poll) { clearInterval(ws._poll); ws._poll = null; }
  }
  ws.send(JSON.stringify({ type: 'left_queue' }));
}

function handleCallerOffer(ws, message, callManager) {
  const { callId, offer } = message;
  const call = callManager.activeCalls.get(callId);
  if (!call) return;
  const staffWs = callManager.connections.get(`staff:${call.staffId}`);
  if (staffWs && staffWs.readyState === 1) {
    // Tell staff to prepare their peer (request mic) BEFORE the offer arrives
    staffWs.send(JSON.stringify({ type: 'prepare_call', callId, callerId: call.callerId }));
    // Forward the offer immediately
    staffWs.send(JSON.stringify({ type: 'caller_offer', callId, callerId: call.callerId, offer }));
  }
}

function handleCallerAnswer(ws, message, callManager) {
  const { callId } = message;
  const call = callManager.activeCalls.get(callId);
  if (!call) return;
  call.signalingState = 'answer_sent';
}

// ======================
// Staff handlers
// ======================

function handleStaffLogin(ws, message, callManager) {
  const { employeeId, password } = message;
  const adminId = process.env.ADMIN_EMPLOYEE_ID || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'admin123temp';

  if (employeeId === adminId && password === adminPass) {
    ws.staffId = adminId;
    ws.staffRole = 'admin';
    callManager.registerStaff(adminId, ws);
    callManager.setStaffStatus(adminId, 'available');
    ws.send(JSON.stringify({ type: 'login_success', staffId: adminId, role: 'admin', message: 'Welcome to Scream Desk', status: 'available' }));
  } else {
    ws.send(JSON.stringify({ type: 'login_error', message: 'Invalid Employee ID or Password' }));
  }
}

function handleStatusChange(ws, message, callManager) {
  const { status } = message;
  if (!ws.staffId) {
    ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
    return;
  }
  callManager.setStaffStatus(ws.staffId, status);
}

function handleAccept(ws, message, callManager) {
  const { callId } = message; // callId = Daily room name
  const call = callManager.activeCalls.get(callId);
  if (!call) {
    ws.send(JSON.stringify({ type: 'error', message: 'Call not found' }));
    return;
  }

  call.signalingState = 'connected';
  callManager.connectCall(callId);

  const callerWs = callManager.connections.get(`caller:${call.callerId}`);
  if (callerWs && callerWs.readyState === 1) {
    callerWs.send(JSON.stringify({ type: 'call_accepted', callId, message: 'Agent accepted your call!' }));
  }

  ws.send(JSON.stringify({ type: 'call_accepted_confirmed', callId, callerId: call.callerId, message: 'Call connected!' }));
}

function handleDecline(ws, message, callManager) {
  const { callId } = message;
  callManager.declineCall(callId);

  // Find caller by room name
  for (const [key, conn] of callManager.connections) {
    if (key.startsWith('caller:') && conn.roomName === callId) {
      conn.send(JSON.stringify({ type: 'call_declined', callId }));
      break;
    }
  }

  ws.send(JSON.stringify({ type: 'call_declined' }));
}

function handleStaffAnswer(ws, message, callManager) {
  const { callId, answer } = message;
  const call = callManager.activeCalls.get(callId);
  if (!call) return;
  call.signalingState = 'answer_sent';
  const callerWs = callManager.connections.get(`caller:${call.callerId}`);
  if (callerWs && callerWs.readyState === 1) {
    callerWs.send(JSON.stringify({ type: 'call_accepted', callId, answer }));
  }
}

function handleEnd(ws, message, callManager, redisClient) {
  const { callId } = message; // callId = Daily room name

  // Find the call in callManager (by callId or by room name)
  let call = callManager.activeCalls.get(callId);
  let callerWs = null;
  let staffWs = null;

  if (call) {
    callerWs = callManager.connections.get(`caller:${call.callerId}`);
    staffWs = callManager.connections.get(`staff:${call.staffId}`);
    callManager.endCall(callId);
    if (redisClient && redisClient.cleanupCallerSession) {
      redisClient.cleanupCallerSession(call.callerId);
    }
  } else {
    // Call not in callManager — find by room name
    for (const [key, conn] of callManager.connections) {
      if (key.startsWith('caller:') && conn.roomName === callId) {
        callerWs = conn;
        break;
      }
    }
    // Staff is the one who is NOT the caller
    for (const [key, conn] of callManager.connections) {
      if (key.startsWith('staff:') && conn.readyState === 1) {
        staffWs = conn;
        break;
      }
    }
  }

  // Notify the OTHER party (whoever didn't initiate the end)
  if (ws.callerId) {
    // Caller initiated end → notify staff
    if (staffWs && staffWs.readyState === 1) {
      staffWs.send(JSON.stringify({ type: 'call_ended', callId }));
    }
  } else {
    // Staff initiated end → notify caller
    if (callerWs && callerWs.readyState === 1) {
      callerWs.send(JSON.stringify({ type: 'call_ended', callId }));
    }
  }
}

// ======================
// ICE candidate forwarding
// ======================

function handleICE(ws, message, callManager) {
  const { callId, candidate } = message;
  const call = callManager.activeCalls.get(callId);
  if (!call) return;

  let targetWs;
  if (ws.callerId) {
    targetWs = callManager.connections.get(`staff:${call.staffId}`);
  } else if (ws.staffId) {
    targetWs = callManager.connections.get(`caller:${call.callerId}`);
  }
  if (targetWs && targetWs.readyState === 1) {
    targetWs.send(JSON.stringify({ type: 'ice_candidate', callId, candidate }));
  }
}

// ======================
// Helpers
// ======================

function cleanupCaller(callerId, callManager, redisClient) {
  callManager.connections.delete(`caller:${callerId}`);
  if (redisClient && redisClient.cleanupCallerSession) {
    redisClient.cleanupCallerSession(callerId);
  }
}

module.exports = { setupWebSocket };
