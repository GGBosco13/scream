# 🔊 SCREAM – Anonymous Voice Venting Platform

A secure, anonymous web application for two-way voice consultations. Users can anonymously connect with support staff for voice-based emotional support.

## Philosophy

- **Total Anonymity**: Callers need no registration, login, or personal info
- **Ephemeral Data**: All caller data is temporary and deleted immediately after sessions
- **Zero Logging**: No IP addresses, names, or contact information stored
- **Privacy Boundary**: Admins manage staff access only – they cannot view call content

## Architecture

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────┐
│   Caller     │────────▶│   Express +      │────────▶│   Staff     │
│  (Anonymous) │ WebRTC  │   WebSocket      │ WebRTC  │  (Staff)    │
│  React UI    │◀────────│   Signaling Srv  │◀────────│  React UI   │
└─────────────┘         └──────────────────┘         └─────────────┘
                                │
                        ┌───────┴───────┐
                        │  Redis (TTL)  │
                        │ Ephemeral     │
                        │ Session Store │
                        └───────────────┘
```

## Tech Stack

| Layer       | Technology                          |
|-------------|-------------------------------------|
| Frontend    | React.js (Create React App)         |
| Real-Time   | WebRTC (Peer-to-Peer Audio)         |
| Signaling   | WebSocket (ws)                      |
| Backend     | Node.js + Express                   |
| Session     | Redis (with TTL auto-expiry)        |
| Auth        | bcryptjs (password hashing)         |

## Project Structure

```
scream/
├── src/
│   ├── server/
│   │   ├── index.js          # Express + WebSocket server entry
│   │   ├── callManager.js    # Call routing & in-memory state
│   │   ├── redis.js          # Redis client for ephemeral data
│   │   ├── websocket.js      # WebRTC signaling handlers
│   │   └── routes/
│   │       └── auth.js       # Auth API routes (login, admin)
│   └── client/
│       └── src/
│           ├── App.jsx              # Main app with view switcher
│           ├── ScreamConnect.jsx    # Caller view component
│           ├── StaffDashboard.jsx   # Staff dashboard component
│           ├── AdminPanel.jsx       # Admin panel component
│           └── *.css                # Component styles
├── public/
│   └── index.html
├── .env.example
├── .gitignore
└── package.json
```

## Quick Start

### Prerequisites

- Node.js 18+
- Redis (optional, recommended for production)

### Installation

```bash
# Clone and install
cd scream
npm install

# Copy env file
cp .env.example .env

# Start Redis (optional)
redis-server
```

### Run in Development

```bash
# Start both server and frontend concurrently
npm run dev
```

This starts:
- **Backend** on `http://localhost:3000`
- **Frontend** on `http://localhost:3001`

### URLs

| View | URL | Description |
|------|-----|-------------|
| Caller | `http://localhost:3000/` | Anonymous voice venting |
| Staff | `http://localhost:3000/staff` | Support dashboard |
| Admin | `http://localhost:3000/admin` | Staff account management |

### Default Credentials

| Role | Employee ID | Password |
|------|------------|----------|
| Admin/Staff | `admin` | `admin123temp` |

## Features

### Caller View (Scream Connect)

- 🔴 **Start Scream** button – initiates anonymous call
- 📊 **Queue system** – shows position and waiting status
- 🎙️ **Audio visualizer** – real-time waveform feedback
- 🔒 **No registration** – anonymous session ID generated locally
- 🧹 **Auto-cleanup** – session data wiped on page close

### Staff View (Scream Desk)

- 🟢 **Status toggle** – Available / Away
- 🔔 **Incoming call alerts** – with audio notification
- ⏱️ **Call timer** – tracks call duration
- 🎤 **Mute controls** – toggle microphone
- 📋 **Queue management** – see active call status

### Admin Panel

- 👥 **Create staff accounts** – with temporary passwords
- 🔒 **Disable accounts** – deactivate staff access
- 🔑 **Reset passwords** – secure password reset
- 📊 **Staff list** – view all registered accounts

## Security & Privacy

### Ephemeral Data Architecture

1. **No persistent storage** of call data
2. **No recordings** – WebRTC is peer-to-peer
3. **No transcripts** – audio never touches the server
4. **No PII** – session IDs are random UUIDs
5. **Redis TTL** – all cached data auto-expires
6. **Client-side wipe** – localStorage cleared on session end

### Call Flow

```
Caller clicks "Start Scream"
    ↓
Browser generates anonymous session ID
    ↓
Caller connects via WebSocket
    ↓
Caller enters queue
    ↓
System matches caller → available staff
    ↓
WebRTC peer-to-peer connection established
    ↓
Audio streams directly (browser → browser)
    ↓
When call ends:
    ├── All in-memory data destroyed
    ├── Redis entries expire (TTL)
    └── localStorage cleared
```

## WebRTC Flow

```
Caller                  Signaling Server              Staff
  │                         │                          │
  │──── join_queue ────────▶│                          │
  │◀──── queued ───────────│                          │
  │                         │                          │
  │──── create_offer ──────▶│────── caller_offer ─────▶│
  │                         │                          │
  │                         │◀───── send_answer ───────│
  │◀──── call_accepted ────│                          │
  │                         │                          │
  │◀─── ice_candidate ─────│◀── ice_candidate ────────│
  │──── ice_candidate ────▶│────── ice_candidate ─────▶│
  │                         │                          │
  │══════ WebRTC Audio Stream (Peer-to-Peer) ══════════│
  │                         │                          │
  │──── end_call ──────────▶│────────── end_call ─────▶│
  │                         │                          │
```

## Building for Production

```bash
# Build React frontend
npm run build

# Serve with Node.js (includes static files)
npm start
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `REDIS_HOST` | Redis hostname | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `ADMIN_EMPLOYEE_ID` | Admin employee ID | `admin` |
| `ADMIN_PASSWORD` | Admin password | `admin123temp` |
| `SESSION_SECRET` | Session secret | _(change in production)_ |

## Future Enhancements

- [ ] JWT-based authentication with token refresh
- [ ] MongoDB/PostgreSQL for staff account persistence
- [ ] Call recording opt-in with explicit consent
- [ ] Multi-language support
- [ ] Crisis resource directory
- [ ] WebRTC data channels for text support
- [ ] Load balancing for multiple server instances
- [ ] Rate limiting and DDoS protection
