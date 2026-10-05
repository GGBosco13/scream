/**
 * ScreamConnect – Caller View (Firebase + Daily.co)
 * Minimalist, urgent, high-contrast interface.
 * No personal details, no history, no prompts for info.
 */

import React, { useState, useRef, useEffect } from 'react';
import { ref, onValue, set, remove } from 'firebase/database';
import { rtdb } from './firebase';
import Daily from '@daily-co/daily-js';
import './ScreamConnect.css';

const API_BASE = '';

export default function ScreamConnect() {
  const [status, setStatus] = useState('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [position, setPosition] = useState(0);
  const [callDuration, setCallDuration] = useState(0);

  const dailyRef = useRef(null);
  const timerRef = useRef(null);
  const durationRef = useRef(0);
  const callerIdRef = useRef(null);
  const roomNameRef = useRef(null);
  const callIdRef = useRef(null);
  const unsubRefs = useRef([]);

  // Cleanup on unmount
  useEffect(() => {
    return () => cleanup();
  }, []);

  function cleanup() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (dailyRef.current) {
      try { dailyRef.current.destroy(); } catch (e) {}
      dailyRef.current = null;
    }
    unsubRefs.current.forEach(unsub => unsub());
    unsubRefs.current = [];
    localStorage.removeItem('scream_session');
  }

  const startCall = async () => {
    cleanup();
    setStatus('connecting');
    setStatusMessage('Requesting microphone access...');

    try {
      // 1. Request mic permission
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
      } catch (micErr) {
        console.error('Mic error:', micErr);
        setStatus('ended');
        setStatusMessage('Microphone access denied. Please allow mic and try again.');
        return;
      }

      setStatus('connecting');
      setStatusMessage('Establishing anonymous connection...');

      // 2. Request a room from the server
      const res = await fetch(`${API_BASE}/api/daily/join-room`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create room');

      const { callerId, roomName, roomUrl, token } = data;
      callerIdRef.current = callerId;
      roomNameRef.current = roomName;

      // 3. Join the Daily room
      const daily = Daily.createIframe({
        url: roomUrl,
        video: false,
        audio: true,
        token,
        showLobby: false,
        styles: { content: { display: 'none' } },
      });
      dailyRef.current = daily;

      // 4. Listen for call events via Realtime Database
      const callRef = ref(rtdb, `queue/${callerId}`);
      const unsub1 = onValue(callRef, (snapshot) => {
        const queueData = snapshot.val();
        if (queueData?.callId) {
          callIdRef.current = queueData.callId;
          listenForCallStatus(queueData.callId);
        }
      });
      unsubRefs.current.push(unsub1);

      setStatus('queued');
      setStatusMessage('You are in the queue. Waiting for an agent...');
      setPosition(1);

    } catch (err) {
      console.error('startCall error:', err);
      setStatus('ended');
      setStatusMessage(`Connection error: ${err.message}. Please try again.`);
    }
  };

  function listenForCallStatus(callId) {
    const callRef = ref(rtdb, `calls/${callId}`);
    const unsub = onValue(callRef, (snapshot) => {
      const callData = snapshot.val();
      if (!callData) return;

      switch (callData.status) {
        case 'connected':
          setStatus('calling');
          setStatusMessage('Connected! You are now speaking with an agent.');
          startTimer();
          break;
        case 'declined':
          handleDeclined();
          break;
        case 'ended':
          handleEnded('Call has ended. Stay strong.');
          break;
        default:
          break;
      }
    });
    unsubRefs.current.push(unsub);
  }

  function startTimer() {
    durationRef.current = 0;
    setCallDuration(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      durationRef.current++;
      setCallDuration(durationRef.current);
    }, 1000);
  }

  function handleDeclined() {
    setStatus('ended');
    setStatusMessage('Agent is unavailable. Please try again.');
    cleanupDaily();
  }

  function handleEnded(message) {
    setStatus('ended');
    setStatusMessage(message);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    cleanupDaily();
  }

  function cleanupDaily() {
    if (dailyRef.current) {
      try { dailyRef.current.destroy(); } catch (e) {}
      dailyRef.current = null;
    }
  }

  const endCall = async () => {
    if (callIdRef.current) {
      await fetch(`${API_BASE}/api/calls/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: callIdRef.current }),
      }).catch(() => {});
    }
    if (callerIdRef.current) {
      await fetch(`${API_BASE}/api/daily/leave-room`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callerId: callerIdRef.current, roomName: roomNameRef.current }),
      }).catch(() => {});
    }
    cleanup();
    setStatus('ended');
    setStatusMessage('Call ended. All data wiped.');
  };

  const formatDuration = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="scream-connect">
      <header className="scream-header">
        <div className="logo">
          <span className="logo-icon">🔊</span>
          <h1>SCREAM</h1>
        </div>
        <p className="tagline">You are not alone.</p>
      </header>

      <main className="scream-main">
        {status === 'idle' && (
          <div className="state-idle">
            <div className="pulse-ring">
              <div className="pulse-inner">
                <svg viewBox="0 0 24 24" className="mic-icon" fill="currentColor">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z"/>
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                </svg>
              </div>
            </div>
            <h2>Need to let it all out?</h2>
            <p className="privacy-note">100% anonymous. No registration. No recording. No traces.</p>
            <button className="btn-scream" onClick={startCall}>
              <span className="btn-icon">🔥</span> START SCREAM
            </button>
          </div>
        )}

        {(status === 'connecting' || status === 'queued') && (
          <div className="state-queued">
            <div className="spinner-ring" />
            <h2>{status === 'connecting' ? 'Connecting...' : 'You are in the queue'}</h2>
            <p className="status-message">{statusMessage}</p>
            {position > 0 && <p className="queue-position">Position: #{position}</p>}
            <button className="btn-cancel" onClick={endCall}>Cancel</button>
          </div>
        )}

        {status === 'calling' && (
          <div className="state-calling">
            <div className="active-pulse">
              <div className="pulse-ring active" />
              <div className="pulse-ring active" style={{ animationDelay: '0.3s' }} />
              <div className="pulse-ring active" style={{ animationDelay: '0.6s' }} />
            </div>
            <div className="call-info">
              <p className="call-status-text">Connected</p>
              <p className="call-timer">{formatDuration(callDuration)}</p>
            </div>
            <button className="btn-end" onClick={endCall}>
              <span className="btn-icon">📞</span> END CALL
            </button>
          </div>
        )}

        {status === 'ended' && (
          <div className="state-ended">
            <div className="ended-icon">{callDuration > 0 ? '✓' : '✕'}</div>
            <h2>{callDuration > 0 ? 'Call Ended' : statusMessage}</h2>
            {callDuration > 0 && <p className="call-summary">Duration: {formatDuration(callDuration)}</p>}
            <p className="privacy-note">All data has been wiped. This conversation never happened.</p>
            <button className="btn-scream" onClick={startCall}>
              <span className="btn-icon">🔥</span> CALL AGAIN
            </button>
            <button className="btn-secondary" onClick={() => { setStatus('idle'); setStatusMessage(''); setCallDuration(0); }}>Close</button>
          </div>
        )}
      </main>

      <footer className="scream-footer">
        <p>Anonymous. Ephemeral. Safe.</p>
      </footer>
    </div>
  );
}
