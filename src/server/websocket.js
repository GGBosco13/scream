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
  callManager.connections.set(`caller:${callerId}`, ws);
  await callManager.joinQueue(callerId);
  ws.callerId = callerId;

  // Always confirm queue position to the caller
  ws.send(JSON.stringify({
    type: 'queued',
    sessionId: callerId,
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
  const route = callManager.routeNextCall();
  if (!route) return;

  ws._routed = true;
  ws.callInfo = route;
  if (ws._poll) { clearInterval(ws._poll); ws._poll = null; }

  const staffWs = callManager.connections.get(`staff:${route.staffId}`);
  if (staffWs && staffWs.readyState === 1) {
    staffWs.send(JSON.stringify({
      type: 'incoming_call',
      callId: route.callId,
      callerId,
      message: 'Anonymous caller is waiting...',
    }));
  }
  ws.send(JSON.stringify({
    type: 'call_incoming',
    callId: route.callId,
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
  const { callId } = message;
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
  const { callId } = message;
  const call = callManager.activeCalls.get(callId);
  if (call) {
    callManager.endCall(callId);
    if (redisClient && redisClient.cleanupCallerSession) {
      redisClient.cleanupCallerSession(call.callerId);
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
