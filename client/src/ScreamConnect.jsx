/**
 * ScreamConnect – Caller View
 * Minimalist, urgent, high-contrast messenger-style interface.
 * No personal details, no history, no prompts for info.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import './ScreamConnect.css';

const API_URL = process.env.REACT_APP_API_URL || '';
const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;

// Generate anonymous session ID
function generateSessionId() {
  let id = localStorage.getItem('scream_session');
  if (!id) {
    id = 'scream_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    localStorage.setItem('scream_session', id);
  }
  return id;
}

// Audio visualizer using Web Audio API
function AudioVisualizer({ analyser, isActive }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const bufferLength = analyser ? analyser.frequencyBinCount : 64;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
      animRef.current = requestAnimationFrame(draw);
      if (!analyser) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Draw idle pulse
        const time = Date.now() / 1000;
        const radius = 40 + Math.sin(time * 2) * 8;
        ctx.beginPath();
        ctx.arc(canvas.width / 2, canvas.height / 2, radius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.2)';
        ctx.lineWidth = 2;
        ctx.stroke();
        return;
      }

      analyser.getByteFrequencyData(dataArray);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height * 0.8;
        const hue = 0 + (i / bufferLength) * 30; // red to orange
        ctx.fillStyle = `hsl(${hue}, 100%, ${40 + (dataArray[i] / 255) * 30}%)`;
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
      }
    }
    draw();

    return () => cancelAnimationFrame(animRef.current);
  }, [analyser]);

  return <canvas ref={canvasRef} width={300} height={100} className="visualizer-canvas" />;
}

export default function ScreamConnect() {
  const sessionId = useRef(generateSessionId());
  const [status, setStatus] = useState('idle'); // idle | connecting | queued | calling | ended
  const [statusMessage, setStatusMessage] = useState('');
  const [position, setPosition] = useState(0);
  const [callDuration, setCallDuration] = useState(0);
  const [callId, setCallId] = useState(null);

  // WebRTC refs
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const audioRef = useRef(null);
  const analyserRef = useRef(null);
  const wsRef = useRef(null);
  const timerRef = useRef(null);
  const durationRef = useRef(0);
  const statusRef = useRef('idle');

  // Keep statusRef in sync with status state
  useEffect(() => { statusRef.current = status; }, [status]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  function cleanup() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (peerRef.current) {
      try {
        peerRef.current.getTracks().forEach(t => t.stop());
        peerRef.current.close();
      } catch (e) { /* already closed */ }
      peerRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (analyserRef.current) {
      try { analyserRef.current.context.close(); } catch (e) { /* already closed */ }
      analyserRef.current = null;
    }
    // Clear ephemeral data
    localStorage.removeItem('scream_session');
    // Reset
    setStatus('idle');
    setStatusMessage('');
    setCallDuration(0);
    setCallId(null);
    callIdRef.current = null;
    durationRef.current = 0;
    statusRef.current = 'idle';
  }

  const startCall = async () => {
    cleanup();
    setStatus('connecting');
    setStatusMessage('Establishing anonymous connection...');

    try {
      // Get local audio
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;

      // Set up audio element
      if (audioRef.current) {
        audioRef.current.srcObject = stream;
        audioRef.current.muted = true;
      }

      // Set up Web Audio analyser for visualizer
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Create peer connection
      const peer = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      });
      peerRef.current = peer;

      stream.getTracks().forEach(track => peer.addTrack(track, stream));

      peer.onicecandidate = (event) => {
        if (event.candidate && wsRef.current && wsRef.current.readyState === 1) {
          wsRef.current.send(JSON.stringify({
            type: 'ice_candidate',
            callId: callIdRef.current,
            candidate: event.candidate,
            target: 'staff',
          }));
        }
      };

      peer.ontrack = (event) => {
        if (audioRef.current) {
          audioRef.current.srcObject = event.streams[0];
          audioRef.current.muted = false;
        }
      };

      // Connect WebSocket
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'join_queue', sessionId: sessionId.current }));
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

  const callIdRef = useRef(null);

  function handleWsMessage(data) {
    switch (data.type) {
      case 'queued':
        setStatus('queued');
        setStatusMessage(data.message);
        setPosition(data.position);
        break;

      case 'call_incoming':
        setStatus('connecting');
        setStatusMessage(data.message || 'Connecting to agent...');
        setCallId(data.callId);
        callIdRef.current = data.callId;
        // Create and send offer
        createAndSendOffer();
        break;

      case 'call_accepted':
        if (data.answer) {
          handleAnswer(data.answer);
        } else {
          // Staff accepted, connection is live
          setStatus('calling');
          setStatusMessage('Connected with a support agent.');
          durationRef.current = 0;
          setCallDuration(0);
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = setInterval(() => {
            durationRef.current++;
            setCallDuration(durationRef.current);
          }, 1000);
        }
        break;

      case 'ice_candidate':
        handleRemoteIce(data.candidate);
        break;

      case 'call_ended':
        setStatus('ended');
        setStatusMessage('Call has ended. Stay strong.');
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        // Stop WebRTC
        if (peerRef.current) {
          try {
            peerRef.current.getTracks().forEach(t => t.stop());
            peerRef.current.close();
          } catch (e) { /* already closed */ }
          peerRef.current = null;
        }
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(t => t.stop());
          localStreamRef.current = null;
        }
        if (audioRef.current) {
          audioRef.current.srcObject = null;
        }
        break;

      case 'error':
        setStatus('ended');
        setStatusMessage(data.message || 'An error occurred.');
        break;

      default:
        console.log('ScreamConnect unknown message:', data.type);
    }
  }

  async function createAndSendOffer() {
    const peer = peerRef.current;
    if (!peer) return;

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    // Wait for ICE gathering to complete (or use trickle)
    const sendOffer = () => {
      if (wsRef.current && wsRef.current.readyState === 1 && callIdRef.current) {
        wsRef.current.send(JSON.stringify({
          type: 'create_offer',
          callId: callIdRef.current,
          offer: peer.localDescription,
        }));
      }
    };

    if (peer.iceGatheringState === 'complete') {
      sendOffer();
    } else {
      peer.onicegatheringstatechange = () => {
        if (peer.iceGatheringState === 'complete') sendOffer();
      };
      // Fallback: send after 1 second even if gathering isn't complete
      setTimeout(sendOffer, 1000);
    }
  }

  async function handleAnswer(answer) {
    const peer = peerRef.current;
    if (!peer) return;
    try {
      await peer.setRemoteDescription(new RTCSessionDescription(answer));
      setStatus('calling');
      setStatusMessage('Connected! You are now speaking with an agent.');
      durationRef.current = 0;
      timerRef.current = setInterval(() => {
        durationRef.current++;
        setCallDuration(durationRef.current);
      }, 1000);
    } catch (err) {
      console.error('ScreamConnect handleAnswer error:', err);
      setStatus('ended');
      setStatusMessage('Connection error. Please try again.');
    }
  }

  async function handleRemoteIce(candidate) {
    const peer = peerRef.current;
    if (!peer) return;
    try {
      await peer.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error('ScreamConnect handleRemoteIce error:', err);
    }
  }

  const endCall = () => {
    if (wsRef.current && wsRef.current.readyState === 1) {
      if (callIdRef.current) {
        wsRef.current.send(JSON.stringify({ type: 'end_call', callId: callIdRef.current }));
      } else {
        wsRef.current.send(JSON.stringify({ type: 'leave_queue' }));
      }
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
      <audio ref={audioRef} autoPlay playsInline />

      {/* Header */}
      <header className="scream-header">
        <div className="logo">
          <span className="logo-icon">🔊</span>
          <h1>SCREAM</h1>
        </div>
        <p className="tagline">You are not alone.</p>
      </header>

      {/* Main Content */}
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
            <div className="visualizer-container">
              <AudioVisualizer analyser={analyserRef.current} isActive={false} />
            </div>
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
            <div className="visualizer-container">
              <AudioVisualizer analyser={analyserRef.current} isActive={true} />
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
              <p className="call-summary">
                Duration: {formatDuration(callDuration)}
              </p>
            )}
            <p className="privacy-note">
              All data has been wiped. This conversation never happened.
            </p>
            <button className="btn-scream" onClick={() => { cleanup(); startCall(); }}>
              <span className="btn-icon">🔥</span>
              CALL AGAIN
            </button>
            <button className="btn-secondary" onClick={endCall}>
              Close
            </button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="scream-footer">
        <p>Anonymous. Ephemeral. Safe.</p>
      </footer>
    </div>
  );
}
