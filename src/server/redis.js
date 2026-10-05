/**
 * Redis client for ephemeral session storage.
 * All caller data has TTL — never persisted beyond the session.
 */

const Redis = require('ioredis');

let client = null;

async function createRedisClient() {
  const host = process.env.REDIS_HOST || 'localhost';
  const port = parseInt(process.env.REDIS_PORT, 10) || 6379;
  client = new Redis({
    host, port, maxRetriesPerRequest: 3, lazyConnect: true,
    retryStrategy: () => null, // Don't retry; if Redis is down, continue without it
    onError: () => {}, // Suppress noise errors
  });
  await client.connect();
  console.log('[Redis] Connected');
  return client;
}

async function setWithTTL(key, value, ttlSeconds) {
  if (!client) return;
  try { await client.setex(key, ttlSeconds, JSON.stringify(value)); } catch { /* ignore */ }
}

async function get(key) {
  if (!client) return null;
  try {
    const data = await client.get(key);
    return data ? JSON.parse(data) : null;
  } catch { return null; }
}

async function addToQueue(sessionId) {
  if (!client) return;
  try {
    const queueKey = 'scream:call_queue';
    await client.zAdd(queueKey, { score: Date.now(), value: sessionId });
    await client.expire(queueKey, 3600);
  } catch { /* ignore */ }
}

async function removeFromQueue(sessionId) {
  if (!client) return;
  try { await client.zRem('scream:call_queue', sessionId); } catch { /* ignore */ }
}

async function cleanupCallerSession(sessionId) {
  if (!client) return;
  try {
    const keys = [];
    let cursor = 0;
    do {
      const result = await client.scan(cursor, 'MATCH', `scream:signal:${sessionId}:*`, 'COUNT', 100);
      cursor = result[0];
      keys.push(...result[1]);
    } while (cursor !== '0');
    if (keys.length > 0) await client.del(...keys);
  } catch { /* ignore */ }
}

async function storeStaffPresence(staffId, status, sessionId = null) {
  if (!client) return;
  try {
    await client.setex(`scream:staff:${staffId}`, 300, JSON.stringify({ status, sessionId, updatedAt: Date.now() }));
  } catch { /* ignore */ }
}

async function getStaffPresence(staffId) {
  if (!client) return null;
  try {
    const data = await client.get(`scream:staff:${staffId}`);
    return data ? JSON.parse(data) : null;
  } catch { return null; }
}

module.exports = {
  createRedisClient,
  setWithTTL,
  get,
  addToQueue,
  removeFromQueue,
  cleanupCallerSession,
  storeStaffPresence,
  getStaffPresence,
};
