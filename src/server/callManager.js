/**
 * Call Manager – In-memory call routing & state.
 * Zero persistence: all data is in-memory, wiped on session end or server restart.
 */

const { v4: uuidv4 } = require('uuid');
const { cleanupCallerSession, removeFromQueue } = require('./redis');

class CallManager {
  constructor() {
    this.callQueue = [];
    this.staffStates = new Map();
    this.activeCalls = new Map();
    this.connections = new Map();
  }

  // =====================
  // Caller Queue
  // =====================

  async joinQueue(callerId) {
    const sessionId = uuidv4();
    const entry = { callerId, sessionId, joinedAt: Date.now(), status: 'queued' };
    this.callQueue.push(entry);
    try {
      await removeFromQueue(sessionId); // safety: clear any stale entry
      await addToQueueLocal(sessionId);
    } catch (err) {
      console.warn('[CallManager] Queue store error:', err.message);
    }
    console.log(`[CallManager] Caller ${callerId.slice(0, 8)}... joined queue (session: ${sessionId.slice(0, 8)}...)`);
    return entry;
  }

  leaveQueue(callerId) {
    this.callQueue = this.callQueue.filter(e => e.callerId !== callerId);
    console.log(`[CallManager] Caller ${callerId.slice(0, 8)}... left queue`);
  }

  getNextCaller() {
    return this.callQueue.length > 0 ? this.callQueue[0] : null;
  }

  // =====================
  // Staff Management
  // =====================

  registerStaff(staffId, ws) {
    this.connections.set(`staff:${staffId}`, ws);
    console.log(`[CallManager] Staff ${staffId} registered`);
  }

  unregisterStaff(staffId) {
    this.connections.delete(`staff:${staffId}`);
    const state = this.staffStates.get(staffId);
    if (state && state.status === 'available') {
      this.staffStates.set(staffId, { ...state, status: 'away' });
    }
  }

  setStaffStatus(staffId, status) {
    const current = this.staffStates.get(staffId) || { status: 'away', currentCallId: null, callerId: null };
    this.staffStates.set(staffId, { ...current, status });
    console.log(`[CallManager] Staff ${staffId} → ${status}`);
  }

  getStaffStatus(staffId) {
    const state = this.staffStates.get(staffId);
    return state ? state.status : 'unknown';
  }

  getAllStaffStatuses() {
    const result = [];
    for (const [id, state] of this.staffStates) {
      result.push({ staffId: id, status: state.status, currentCallId: state.currentCallId });
    }
    return result;
  }

  getAvailableStaff() {
    const available = [];
    for (const [id, state] of this.staffStates) {
      if (state.status === 'available' && !state.currentCallId) {
        available.push(id);
      }
    }
    return available;
  }

  // =====================
  // Call Routing
  // =====================

  routeNextCall(roomName) {
    const caller = this.getNextCaller();
    if (!caller) return null;

    const availableStaff = this.getAvailableStaff();
    if (availableStaff.length === 0) return null;

    const staffId = availableStaff[0];
    // callId = Daily room name so accept/decline/end reference the same ID
    const callId = roomName || uuidv4();
    const startTime = Date.now();

    const staffState = this.staffStates.get(staffId);
    this.staffStates.set(staffId, { ...staffState, currentCallId: callId, callerId: caller.callerId });

    const callRecord = {
      id: callId,
      callerId: caller.callerId,
      staffId,
      startTime,
      endTime: null,
      signalingState: 'pending',
    };
    this.activeCalls.set(callId, callRecord);

    this.callQueue.shift();

    console.log(`[CallManager] Routed → staff ${staffId} (call: ${callId.slice(0, 8)}...)`);
    return { callId, caller, staffId };
  }

  // =====================
  // Call Lifecycle
  // =====================

  connectCall(callId) {
    const call = this.activeCalls.get(callId);
    if (!call) return false;
    call.signalingState = 'connected';
    console.log(`[CallManager] Call ${callId.slice(0, 8)}... CONNECTED`);
    return true;
  }

  endCall(callId) {
    const call = this.activeCalls.get(callId);
    if (!call) return false;

    call.signalingState = 'ended';
    call.endTime = Date.now();

    if (call.staffId) {
      const staffState = this.staffStates.get(call.staffId);
      this.staffStates.set(call.staffId, { ...staffState, currentCallId: null, callerId: null, status: 'available' });
    }

    cleanupCallerSession(call.callerId);

    const callerConn = this.connections.get(`caller:${call.callerId}`);
    if (callerConn && callerConn.readyState === 1) {
      callerConn.send(JSON.stringify({ type: 'call_ended', callId }));
    }

    console.log(`[CallManager] Call ${callId.slice(0, 8)}... ENDED (${Math.round((call.endTime - call.startTime) / 1000)}s)`);
    return true;
  }

  declineCall(callId) {
    const call = this.activeCalls.get(callId);
    if (!call) return false;

    call.signalingState = 'declined';
    call.endTime = Date.now();

    const staffState = this.staffStates.get(call.staffId);
    this.staffStates.set(call.staffId, { ...staffState, currentCallId: null, callerId: null, status: 'available' });

    const callerConn = this.connections.get(`caller:${call.callerId}`);
    if (callerConn && callerConn.readyState === 1) {
      callerConn.send(JSON.stringify({ type: 'call_declined', callId }));
    }

    console.log(`[CallManager] Call ${callId.slice(0, 8)}... DECLINED`);
    return true;
  }

  hasActiveCalls() {
    for (const [, call] of this.activeCalls) {
      if (call.signalingState === 'connected') return true;
    }
    return false;
  }

  getQueueLength() { return this.callQueue.length; }
  getCallerCount() { return this.callQueue.length; }

  getActiveCallCount() {
    let count = 0;
    for (const [, call] of this.activeCalls) {
      if (call.signalingState === 'connected') count++;
    }
    return count;
  }

  getActiveCallDetails(callId) {
    const call = this.activeCalls.get(callId);
    if (!call) return null;
    return {
      ...call,
      duration: call.endTime ? (call.endTime - call.startTime) : (Date.now() - call.startTime),
    };
  }

  getActiveCallSummaries() {
    const summaries = [];
    for (const [, call] of this.activeCalls) {
      if (['connected', 'offer_sent', 'answer_sent', 'pending'].includes(call.signalingState)) {
        summaries.push({
          callId: call.id,
          status: call.signalingState,
          startTime: call.startTime,
          duration: Date.now() - call.startTime,
        });
      }
    }
    return summaries;
  }

  destroyAllSessions() {
    console.log('[CallManager] Destroying all sessions...');
    this.callQueue = [];
    this.staffStates.clear();
    this.activeCalls.clear();
    this.connections.clear();
  }
}

// Simple local queue store (fallback when Redis is not available)
const localQueue = [];
async function addToQueueLocal(sessionId) {
  localQueue.push(sessionId);
}

module.exports = { CallManager };
