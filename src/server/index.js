/**
 * Scream – Server Entry Point
 * Express + WebSocket signaling server for WebRTC two-way audio.
 * Zero persistence: all caller data lives only in memory.
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { CallManager } = require('./callManager');
const { createRedisClient } = require('./redis');
const { setupWebSocket } = require('./websocket');
const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const BUILD_DIR = path.join(process.cwd(), 'client', 'build');

// Verify build exists
if (!require('fs').existsSync(path.join(BUILD_DIR, 'index.html'))) {
  console.error('[Fatal] client/build/index.html not found. Run: cd client && npm run build');
  process.exit(1);
}

app.use(cors());
app.use(express.json());
app.use(express.static(BUILD_DIR));
app.use('/api/auth', authRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// API routes for view info
app.get('/api/views', (_req, res) => {
  res.json({ views: ['caller', 'staff', 'admin'] });
});

// SPA fallback – serve React app for any non-API route
app.use((req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(BUILD_DIR, 'index.html'));
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const callManager = new CallManager();

let redisClient = null;
async function init() {
  try {
    redisClient = await createRedisClient();
  } catch (err) {
    console.warn('[Redis] Not available, continuing without it:', err.message);
  }
  setupWebSocket(wss, callManager, redisClient);
}

const graceful = async () => {
  console.log('\n[Server] Shutting down...');
  callManager.destroyAllSessions();
  wss.close(() => {
    if (redisClient) redisClient.quit().finally(() => server.close(() => process.exit(0)));
    else server.close(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 5000);
};
process.on('SIGTERM', graceful);
process.on('SIGINT', graceful);

async function main() {
  await init();
  server.listen(PORT, () => {
    console.log(`[Server] Scream running at http://localhost:${PORT}`);
    console.log(`[Caller] http://localhost:${PORT}/          (or #caller)`);
    console.log(`[Staff]  http://localhost:${PORT}/#staff     (or #staff)`);
    console.log(`[Admin]  http://localhost:${PORT}/#admin     (or #admin)`);
  });
}
main().catch(err => { console.error('[Server] Fatal:', err); process.exit(1); });
