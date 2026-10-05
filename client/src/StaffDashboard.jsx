/**
 * StaffDashboard – Professional dispatch dashboard for support staff.
 * Includes login, status toggle, incoming call alerts, and active call controls.
 *
 * Audio: Daily.co handles all WebRTC, NAT traversal, and TURN relay.
 */

import React, { useState, useRef, useEffect } from 'react';
import Daily from '@daily-co/daily-js';
import './StaffDashboard.css';

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
const API_URL = process.env.REACT_APP_API_URL || '';

export default function StaffDashboard() {
  const [authState, setAuthState] = useState('login'); // login | dashboard
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  // Dashboard state
  const [status, setStatus] = useState('away'); // available | away
  const [incomingCall, setIncomingCall] = useState(null);
  const [currentCallId, setCurrentCallId] = useState(null);
  const [currentCallDuration, setCurrentCallDuration] = useState(0);
  const [staffList, setStaffList] = useState([]);
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [adminEmployeeId, setAdminEmployeeId] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminResult, setAdminResult] = useState(null);
  const [muted, setMuted] = useState(false);

  // Daily.co + WebSocket refs
  const dailyRef = useRef(null);
  const wsRef = useRef(null);
  const durationRef = useRef(0);
  const timerRef = useRef(null);
  const roomNameRef = useRef(null);

  // =====================
  // LOGIN
  // =====================
  const handleLogin = async () => {
    setLoginError('');
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, password }),
      });
      const data = await res.json();
      if (data.success) {
        setAuthState('dashboard');
        connectWs();
        loadStaffList();
      } else {
        setLoginError(data.error || 'Login failed');
      }
    } catch {
      setLoginError('Could not connect to server');
    }
  };

  // =====================
  // WEBSOCKET (signaling only – Daily handles audio)
  // =====================
  const connectWs = () => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'staff_login', employeeId, password }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      handleWsMessage(data);
    };

    ws.onclose = () => {
      setTimeout(() => {
        if (authState === 'dashboard') connectWs();
      }, 3000);
    };
  };

  function handleWsMessage(data) {
    switch (data.type) {
      case 'login_success':
        setStatus(data.status || 'available');
        break;

      case 'login_error':
        setLoginError(data.message);
        break;

      case 'incoming_call':
        setIncomingCall({
          callId: data.callId,
          callerId: data.callerId,
          roomName: data.callId, // Daily room name = callId
          message: data.message || 'Anonymous caller is waiting...',
          timestamp: Date.now(),
        });
        playAlertSound();
        break;

      case 'call_accepted':
        setIncomingCall(null);
        break;

      case 'call_ended':
        endCall();
        break;

      case 'call_declined':
        setIncomingCall(null);
        break;

      default:
        break;
    }
  }

  // =====================
  // DAILY.CO – JOIN ROOM
  // =====================
  const joinDailyRoom = async (roomName) => {
    try {
      // Get a join token from the server
      const res = await fetch(`${API_URL}/api/daily/staff-join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to get room access');

      const daily = new Daily();
      dailyRef.current = daily;
      roomNameRef.current = roomName;

      await daily.join(data.roomUrl, {
        video: false,
        audio: true,
        token: data.token,
      });

      setCurrentCallId(roomName);
      setCurrentCallDuration(0);
      durationRef.current = 0;
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        durationRef.current++;
        setCurrentCallDuration(durationRef.current);
      }, 1000);
    } catch (err) {
      console.error('Staff: Failed to join Daily room', err);
    }
  };

  // =====================
  // STAFF ACTIONS
  // =====================
  const toggleStatus = () => {
    const newStatus = status === 'available' ? 'away' : 'available';
    setStatus(newStatus);
    if (wsRef.current && wsRef.current.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'set_status', status: newStatus }));
    }
  };

  const acceptCall = async () => {
    if (!incomingCall) return;
    const roomName = incomingCall.roomName;
    setIncomingCall(null);

    // Notify server
    if (wsRef.current && wsRef.current.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'accept_call', callId: roomName }));
    }

    // Join the Daily room
    await joinDailyRoom(roomName);
  };

  const declineCall = () => {
    if (wsRef.current && wsRef.current.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'decline_call', callId: incomingCall?.callId }));
    }
    setIncomingCall(null);
  };

  const endCall = () => {
    if (wsRef.current && wsRef.current.readyState === 1 && currentCallId) {
      wsRef.current.send(JSON.stringify({ type: 'end_call', callId: currentCallId }));
    }
    endLocalCall();
  };

  const endLocalCall = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (dailyRef.current) {
      dailyRef.current.leave().catch(() => {});
      dailyRef.current.destroy();
      dailyRef.current = null;
    }
    // Clean up the Daily room
    if (roomNameRef.current) {
      fetch(`${API_URL}/api/daily/leave-room`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName: roomNameRef.current }),
      }).catch(() => {});
      roomNameRef.current = null;
    }
    setCurrentCallId(null);
    setCurrentCallDuration(0);
    durationRef.current = 0;
    setMuted(false);
  };

  const toggleMute = () => {
    const newMuted = !muted;
    setMuted(newMuted);
    if (dailyRef.current) {
      dailyRef.current.updateSendSettings({ audio: !newMuted }).catch(() => {});
    }
  };

  // =====================
  // STAFF MANAGEMENT
  // =====================
  const loadStaffList = async () => {
    try {
      const res = await fetch(`${API_URL}/api/auth/staff-list`);
      const data = await res.json();
      setStaffList(data.staffList || []);
    } catch { /* ignore */ }
  };

  const createStaff = async () => {
    try {
      const res = await fetch(`${API_URL}/api/auth/admin/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: adminEmployeeId, password: adminPassword, role: 'staff' }),
      });
      const data = await res.json();
      if (data.success) {
        setAdminResult(data);
        loadStaffList();
        setAdminEmployeeId('');
        setAdminPassword('');
      }
    } catch {
      setAdminResult({ error: 'Could not connect to server' });
    }
  };

  const disableStaff = async (empId) => {
    try {
      await fetch(`${API_URL}/api/auth/admin/disable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: empId }),
      });
      loadStaffList();
    } catch { /* ignore */ }
  };

  const playAlertSound = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 800;
      gain.gain.value = 0.3;
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
      setTimeout(() => {
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.frequency.value = 1000;
        gain2.gain.value = 0.3;
        osc2.start();
        osc2.stop(ctx.currentTime + 0.2);
      }, 250);
    } catch { /* audio not critical */ }
  };

  const formatDuration = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // =====================
  // LOGIN VIEW
  // =====================
  if (authState !== 'dashboard') {
    return (
      <div className="staff-login">
        <div className="login-card">
          <div className="login-header">
            <h1>SCREAM</h1>
            <p>Staff Portal</p>
          </div>
          {loginError && <div className="login-error">{loginError}</div>}
          <div className="login-form">
            <div className="form-group">
              <label>Employee ID</label>
              <input
                type="text"
                value={employeeId}
                onChange={e => setEmployeeId(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                placeholder="Enter your ID"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                placeholder="Enter your password"
              />
            </div>
            <button className="btn-login" onClick={handleLogin}>Sign In</button>
          </div>
        </div>
      </div>
    );
  }

  // =====================
  // DASHBOARD VIEW
  // =====================
  return (
    <div className="staff-dashboard">
      <header className="dashboard-header">
        <div className="logo-small">
          <span className="logo-dot" />
          <h2>SCREAM</h2>
          <span className="logo-sub">DESK</span>
        </div>
        <div className="header-right">
          <button className={`status-toggle ${status}`} onClick={toggleStatus}>
            <span className={`status-dot ${status}`} />
            {status === 'available' ? 'Available' : 'Away'}
          </button>
          <button className="btn-staff-list" onClick={() => setShowStaffModal(true)}>👥 Staff</button>
          <button className="btn-logout" onClick={() => {
            if (wsRef.current) wsRef.current.close();
            setAuthState('login');
          }}>
            Logout
          </button>
        </div>
      </header>

      <div className="dashboard-body">
        <section className="panel active-calls-panel">
          <h3>Active Calls</h3>
          {currentCallId ? (
            <div className="active-call-card">
              <div className="call-header">
                <span className="call-label">Anonymous Caller</span>
                <span className="call-timer-display">{formatDuration(currentCallDuration)}</span>
              </div>
              <div className="call-controls">
                <button className={`btn-control ${muted ? 'muted' : ''}`} onClick={toggleMute}>
                  {muted ? '🔇' : '🎤'} {muted ? 'Unmute' : 'Mute'}
                </button>
                <button className="btn-control btn-end-call" onClick={endCall}>
                  📞 End Call
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-calls">
              <p>No active calls</p>
            </div>
          )}
        </section>

        <section className="panel queue-panel">
          <h3>Queue Status</h3>
          <div className="queue-stats">
            <div className="stat-card">
              <span className="stat-value">{status === 'available' ? '🟢' : '🔴'}</span>
              <span className="stat-label">Your Status</span>
              <span className="stat-text">{status}</span>
            </div>
          </div>
        </section>
      </div>

      {/* Incoming Call Modal */}
      {incomingCall && (
        <div className="modal-overlay">
          <div className="incoming-call-modal">
            <div className="modal-icon">📞</div>
            <h3>Incoming Call</h3>
            <p className="modal-caller">Anonymous Caller</p>
            <p className="modal-message">{incomingCall.message}</p>
            <div className="modal-actions">
              <button className="btn-decline" onClick={declineCall}>Decline</button>
              <button className="btn-accept" onClick={acceptCall}>Accept</button>
            </div>
          </div>
        </div>
      )}

      {/* Staff Management Modal */}
      {showStaffModal && (
        <div className="modal-overlay">
          <div className="staff-modal">
            <div className="modal-header">
              <h3>Staff Management</h3>
              <button className="btn-close" onClick={() => setShowStaffModal(false)}>✕</button>
            </div>
            <div className="create-staff">
              <h4>Create New Staff</h4>
              <div className="form-row">
                <input type="text" placeholder="Employee ID" value={adminEmployeeId}
                  onChange={e => setAdminEmployeeId(e.target.value)} />
                <input type="text" placeholder="Temporary Password" value={adminPassword}
                  onChange={e => setAdminPassword(e.target.value)} />
                <button className="btn-create" onClick={createStaff}>Create</button>
              </div>
              {adminResult?.success && (
                <div className="create-success">
                  ✓ Created: {adminResult.employeeId} / {adminResult.temporaryPassword}
                </div>
              )}
              {adminResult?.error && <div className="create-error">{adminResult.error}</div>}
            </div>
            <div className="staff-list">
              <h4>Registered Staff</h4>
              {staffList.map(s => (
                <div key={s.employeeId} className={`staff-row ${!s.active ? 'disabled' : ''}`}>
                  <div>
                    <span className="staff-id">{s.employeeId}</span>
                    <span className="staff-role">{s.role}</span>
                  </div>
                  <div className="staff-actions">
                    <span className={`staff-active ${s.active ? 'active' : 'inactive'}`}>
                      {s.active ? 'Active' : 'Disabled'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
