/**
 * StaffDashboard – Firebase + Daily.co
 * Login, status toggle, incoming calls, active call controls.
 */

import React, { useState, useRef, useEffect } from 'react';
import { ref, onValue, set, remove } from 'firebase/database';
import { rtdb } from './firebase';
import Daily from '@daily-co/daily-js';
import './StaffDashboard.css';

const API_BASE = '';

export default function StaffDashboard() {
  const [authState, setAuthState] = useState('login');
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const [status, setStatus] = useState('away');
  const [incomingCall, setIncomingCall] = useState(null);
  const [currentCallId, setCurrentCallId] = useState(null);
  const [currentCallDuration, setCurrentCallDuration] = useState(0);
  const [staffList, setStaffList] = useState([]);
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [adminEmployeeId, setAdminEmployeeId] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminResult, setAdminResult] = useState(null);
  const [muted, setMuted] = useState(false);

  const dailyRef = useRef(null);
  const durationRef = useRef(0);
  const timerRef = useRef(null);
  const unsubRef = useRef(null);
  const staffIdRef = useRef(null);

  useEffect(() => {
    return () => {
      if (unsubRef.current) unsubRef.current();
      if (timerRef.current) clearInterval(timerRef.current);
      if (dailyRef.current) { try { dailyRef.current.destroy(); } catch (e) {} }
    };
  }, []);

  // =====================
  // LOGIN
  // =====================
  const handleLogin = async () => {
    setLoginError('');
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, password }),
      });
      const data = await res.json();
      if (data.success) {
        staffIdRef.current = data.staffId;
        setAuthState('dashboard');
        setStatus('available');
        loadStaffList();
        listenForIncomingCalls(data.staffId);
      } else {
        setLoginError(data.error || 'Login failed');
      }
    } catch {
      setLoginError('Could not connect to server');
    }
  };

  // =====================
  // REALTIME LISTENERS
  // =====================
  const listenForIncomingCalls = (staffId) => {
    const incomingRef = ref(rtdb, `staff/${staffId}/incoming`);
    if (unsubRef.current) unsubRef.current();

    unsubRef.current = onValue(incomingRef, (snapshot) => {
      const data = snapshot.val();
      if (data && !currentCallId) {
        setIncomingCall({
          callId: data.callId,
          callerId: data.callerId,
          roomName: data.roomName,
          roomUrl: data.roomUrl,
          timestamp: data.timestamp,
        });
        playAlertSound();
      }
    });
  };

  const listenForCallStatus = (callId) => {
    const callRef = ref(rtdb, `calls/${callId}`);
    const unsub = onValue(callRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;
      if (data.status === 'ended' || data.status === 'declined') {
        endLocalCall();
      }
    });
    // Store for cleanup
    unsubRef.current = () => {
      if (unsubRef.current?.callUnsub) unsubRef.current.callUnsub();
      unsub();
    };
    unsubRef.current.callUnsub = unsub;
  };

  // =====================
  // DAILY.CO
  // =====================
  const joinDailyRoom = async (roomName, roomUrl) => {
    try {
      const res = await fetch(`${API_BASE}/api/daily/staff-join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to get room access');

      const iframe = Daily.createIframe({
        url: roomUrl,
        video: false,
        audio: true,
        token: data.token,
        showLobby: false,
        styles: { content: { display: 'none' } },
      });
      dailyRef.current = iframe;

      setCurrentCallId(roomName);
      setCurrentCallDuration(0);
      durationRef.current = 0;
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        durationRef.current++;
        setCurrentCallDuration(durationRef.current);
      }, 1000);

      listenForCallStatus(roomName);
    } catch (err) {
      console.error('Staff join error:', err);
    }
  };

  // =====================
  // STAFF ACTIONS
  // =====================
  const toggleStatus = async () => {
    const newStatus = status === 'available' ? 'away' : 'available';
    setStatus(newStatus);
    await fetch(`${API_BASE}/api/auth/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: staffIdRef.current, status: newStatus }),
    }).catch(() => {});
  };

  const acceptCall = async () => {
    if (!incomingCall) return;
    const { callId, roomName, roomUrl } = incomingCall;
    setIncomingCall(null);

    await fetch(`${API_BASE}/api/calls/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callId, staffId: staffIdRef.current }),
    }).catch(() => {});

    await joinDailyRoom(roomName, roomUrl);
  };

  const declineCall = async () => {
    if (!incomingCall) return;
    const { callId } = incomingCall;
    setIncomingCall(null);

    await fetch(`${API_BASE}/api/calls/decline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callId, staffId: staffIdRef.current }),
    }).catch(() => {});
  };

  const endCall = async () => {
    if (currentCallId) {
      await fetch(`${API_BASE}/api/calls/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: currentCallId }),
      }).catch(() => {});
    }
    endLocalCall();
  };

  const endLocalCall = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (dailyRef.current) {
      try { dailyRef.current.destroy(); } catch (e) {}
      dailyRef.current = null;
    }
    setCurrentCallId(null);
    setCurrentCallDuration(0);
    durationRef.current = 0;
    setMuted(false);
  };

  const toggleMute = () => {
    const newMuted = !muted;
    setMuted(newMuted);
    if (dailyRef.current?.daily) {
      dailyRef.current.daily.updateSendSettings({ audio: !newMuted }).catch(() => {});
    }
  };

  const handleLogout = async () => {
    if (staffIdRef.current) {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: staffIdRef.current }),
      }).catch(() => {});
    }
    if (unsubRef.current) unsubRef.current();
    endLocalCall();
    setAuthState('login');
    setIncomingCall(null);
  };

  // =====================
  // STAFF MANAGEMENT
  // =====================
  const loadStaffList = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/staff-list`);
      const data = await res.json();
      setStaffList(data.staffList || []);
    } catch { /* ignore */ }
  };

  const createStaff = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/admin/create`, {
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
      } else {
        setAdminResult({ error: data.error });
      }
    } catch {
      setAdminResult({ error: 'Could not connect' });
    }
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
              <input type="text" value={employeeId} onChange={e => setEmployeeId(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()} placeholder="Enter your ID" autoFocus />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()} placeholder="Enter your password" />
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
          <button className="btn-logout" onClick={handleLogout}>Logout</button>
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
                <button className="btn-control btn-end-call" onClick={endCall}>📞 End Call</button>
              </div>
            </div>
          ) : (
            <div className="empty-calls"><p>No active calls</p></div>
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
                <div className="create-success">✓ Created: {adminResult.employeeId} / {adminResult.temporaryPassword}</div>
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
