/**
 * ScreamConnect – Caller View (Daily.co)
 * Minimalist, urgent, high-contrast messenger-style interface.
 * No personal details, no history, no prompts for info.
 *
 * Audio: Daily.co handles all WebRTC, NAT traversal, and TURN relay.
 */

import React, { useState, useRef, useEffect } from 'react';
import Daily from '@daily-co/daily-js';
import './ScreamConnect.css';

const API_URL = process.env.REACT_APP_API_URL || '';

export default function ScreamConnect() {
  const [status, setStatus] = useState('idle'); // idle | connecting | queued | calling | ended
  const [statusMessage, setStatusMessage] = useState('');
  const [position, setPosition] = useState(0);
  const [callDuration, setCallDuration] = useState(0);

  // Daily.co refs
  const dailyRef = useRef(null);
  const wsRef = useRef(null);
  const timerRef = useRef(null);
  const durationRef = useRef(0);
  const roomNameRef = useRef(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => cleanup();
  }, []);

  function cleanup() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (dailyRef.current) {
      dailyRef.current.leave().catch(() => {});
      dailyRef.current.close();
      dailyRef.current = null;
    }
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    // Clear ephemeral data
    localStorage.removeItem('scream_session');
    setStatus('idle');
    setStatusMessage('');
    setCallDuration(0);
    durationRef.current = 0;
    roomNameRef.current = null;
  }

  const startCall = async () => {
    cleanup();
    setStatus('connecting');
    setStatusMessage('Establishing anonymous connection...');

    try {
      // 1. Request a room from the server
      const res = await fetch(`${API_URL}/api/daily/join-room`, { method: 'POST' });
      const { roomName } = await res.json();
      roomNameRef.current = roomName;

      // 2. Create a Daily room and join with mic on
      const daily = Daily.createRoom();
      dailyRef.current = daily;
      await daily.join(`https://api.daily.co/apps/meetings/rooms/${roomName}`, {
        video: false,
        audio: true,
        // Don't show Daily's default UI
      });

      // 3. Connect WebSocket for signaling (queue + routing)
      const ws = new WebSocket(
        `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
      );
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'join_queue', sessionId: roomName }));
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWsMessage(data);
      };

      ws.onerror = () => {
        setStatus('ended');
        setStatusMessage('Connection failed. Please try again.');
      };

      ws.onclose = () => {
        if (statusRef.current !== 'ended') {
          setStatus('ended');
          setStatusMessage('Connection lost. Please try again.');
        }
      };

    } catch (err) {
      setStatus('ended');
      setStatusMessage('Microphone access denied. Please allow mic access and try again.');
      console.error('ScreamConnect startCall error:', err);
    }
  };

  const statusRef = useRef('idle');
  useEffect(() => { statusRef.current = status; }, [status]);

  function handleWsMessage(data) {
    switch (data.type) {
      case 'queued':
        setStatus('queued');
        setStatusMessage(data.message);
        setPosition(data.position);
        break;

      case 'call_incoming':
        setStatus('connecting');
        setStatusMessage('Agent is joining...');
        break;

      case 'call_accepted':
        // Staff has joined the Daily room — audio is now flowing
        setStatus('calling');
        setStatusMessage('Connected! You are now speaking with an agent.');
        durationRef.current = 0;
        setCallDuration(0);
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = setInterval(() => {
          durationRef.current++;
          setCallDuration(durationRef.current);
        }, 1000);
        break;

      case 'call_ended':
        endCall();
        break;

      case 'error':
        setStatus('ended');
        setStatusMessage(data.message || 'An error occurred.');
        break;

      default:
        break;
    }
  }

  const endCall = () => {
    if (wsRef.current && wsRef.current.readyState === 1) {
      if (roomNameRef.current) {
        wsRef.current.send(JSON.stringify({ type: 'end_call', callId: roomNameRef.current }));
      }
      // Also clean up the Daily room
      fetch(`${API_URL}/api/daily/leave-room`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName: roomNameRef.current }),
      }).catch(() => {});
    }
    cleanup();
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
        {/* Idle state */}
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
            <p className="privacy-note">
              100% anonymous. No registration. No recording. No traces.
            </p>
            <button className="btn-scream" onClick={startCall}>
              <span className="btn-icon">🔥</span>
              START SCREAM
            </button>
          </div>
        )}

        {/* Queued state */}
        {(status === 'connecting' || status === 'queued') && (
          <div className="state-queued">
            <div className="spinner-ring" />
            <h2>{status === 'connecting' ? 'Connecting...' : 'You are in the queue'}</h2>
            <p className="status-message">{statusMessage}</p>
            {position > 0 && <p className="queue-position">Position: #{position}</p>}
            <button className="btn-cancel" onClick={endCall}>Cancel</button>
          </div>
        )}

        {/* Calling state */}
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
              <span className="btn-icon">📞</span>
              END CALL
            </button>
          </div>
        )}

        {/* Ended state */}
        {status === 'ended' && (
          <div className="state-ended">
            <div className="ended-icon">✓</div>
            <h2>{callDuration > 0 ? 'Call Ended' : statusMessage}</h2>
            {callDuration > 0 && (
              <p className="call-summary">Duration: {formatDuration(callDuration)}</p>
            )}
            <p className="privacy-note">
              All data has been wiped. This conversation never happened.
            </p>
            <button className="btn-scream" onClick={startCall}>
              <span className="btn-icon">🔥</span>
              CALL AGAIN
            </button>
            <button className="btn-secondary" onClick={cleanup}>Close</button>
          </div>
        )}
      </main>

      <footer className="scream-footer">
        <p>Anonymous. Ephemeral. Safe.</p>
      </footer>
    </div>
  );
}
