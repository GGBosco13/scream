/**
 * AdminPanel – Super Admin Panel
 * Manages staff accounts (create, disable, reset).
 * Cannot view call content (privacy boundary).
 */

import React, { useState, useEffect } from 'react';
import './AdminPanel.css';

const API_URL = process.env.REACT_APP_API_URL || '';

export default function AdminPanel() {
  const [loginForm, setLoginForm] = useState({ employeeId: '', password: '' });
  const [loggedIn, setLoggedIn] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [staffList, setStaffList] = useState([]);

  // New staff form
  const [newId, setNewId] = useState('');
  const [newPass, setNewPass] = useState('');
  const [createResult, setCreateResult] = useState(null);

  // Password reset
  const [resetId, setResetId] = useState('');
  const [resetPass, setResetPass] = useState('');
  const [resetResult, setResetResult] = useState(null);

  useEffect(() => { loadStaffList(); }, [loggedIn]);

  const handleLogin = async () => {
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm),
      });
      const data = await res.json();
      if (data.success) {
        setLoggedIn(true);
        loadStaffList();
      } else {
        setLoginError(data.error);
      }
    } catch { setLoginError('Connection failed'); }
  };

  const loadStaffList = async () => {
    try {
      const res = await fetch(`${API_URL}/api/auth/staff-list`);
      const data = await res.json();
      setStaffList(data.staffList || []);
    } catch { /* ignore */ }
  };

  const handleCreate = async () => {
    try {
      const res = await fetch(`${API_URL}/api/auth/admin/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: newId, password: newPass, role: 'staff' }),
      });
      const data = await res.json();
      if (data.success) {
        setCreateResult(data);
        setNewId('');
        setNewPass('');
        loadStaffList();
      }
    } catch { setCreateResult({ error: 'Connection failed' }); }
  };

  const handleReset = async () => {
    try {
      const res = await fetch(`${API_URL}/api/auth/admin/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: resetId, newPassword: resetPass }),
      });
      const data = await res.json();
      if (data.success) {
        setResetResult(data);
        setResetId('');
        setResetPass('');
      }
    } catch { setResetResult({ error: 'Connection failed' }); }
  };

  // Login view
  if (!loggedIn) {
    return (
      <div className="admin-login">
        <div className="login-box">
          <h1>SCREAM</h1>
          <p>Admin Panel</p>
          {loginError && <div className="err">{loginError}</div>}
          <input placeholder="Employee ID" value={loginForm.employeeId}
            onChange={e => setLoginForm(p => ({ ...p, employeeId: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && handleLogin()} />
          <input type="password" placeholder="Password" value={loginForm.password}
            onChange={e => setLoginForm(p => ({ ...p, password: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && handleLogin()} />
          <button onClick={handleLogin}>Sign In</button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-panel">
      <header className="admin-header">
        <h2>SCREAM <span className="admin-badge">ADMIN</span></h2>
        <button className="btn-logout" onClick={() => setLoggedIn(false)}>Logout</button>
      </header>

      <main className="admin-main">
        {/* Create Staff */}
        <section className="admin-card">
          <h3>Create Staff Account</h3>
          <div className="admin-form">
            <input placeholder="Employee ID" value={newId}
              onChange={e => setNewId(e.target.value)} />
            <input placeholder="Temporary Password" value={newPass}
              onChange={e => setNewPass(e.target.value)} />
            <button className="btn-primary" onClick={handleCreate}>Create</button>
          </div>
          {createResult?.success && (
            <div className="success-box">
              ✓ Created: <strong>{createResult.employeeId}</strong> / {createResult.temporaryPassword}
            </div>
          )}
          {createResult?.error && <div className="error-box">{createResult.error}</div>}
        </section>

        {/* Reset Password */}
        <section className="admin-card">
          <h3>Reset Password</h3>
          <div className="admin-form">
            <input placeholder="Employee ID" value={resetId}
              onChange={e => setResetId(e.target.value)} />
            <input placeholder="New Password" value={resetPass}
              onChange={e => setResetPass(e.target.value)} />
            <button className="btn-secondary" onClick={handleReset}>Reset</button>
          </div>
          {resetResult?.success && (
            <div className="success-box">✓ Password reset for {resetId}</div>
          )}
          {resetResult?.error && <div className="error-box">{resetResult.error}</div>}
        </section>

        {/* Staff List */}
        <section className="admin-card">
          <h3>Staff Accounts</h3>
          <table className="staff-table">
            <thead>
              <tr>
                <th>Employee ID</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {staffList.map(s => (
                <tr key={s.employeeId} className={!s.active ? 'disabled' : ''}>
                  <td><strong>{s.employeeId}</strong></td>
                  <td>{s.role}</td>
                  <td>
                    <span className={`badge ${s.active ? 'active' : 'inactive'}`}>
                      {s.active ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td>{new Date(s.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}
