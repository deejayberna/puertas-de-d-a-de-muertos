'use strict';
/**
 * Capa de almacenamiento intercambiable para Puertas de Día de Muertos
 * - Si existen variables de Upstash Redis (o KV de Vercel), usa Upstash Redis.
 * - Si no existen, usa archivo local data/db.json.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_SETTINGS = { votingOpen: true, showResults: true, closesAt: null, strictMode: true };

const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const isRedis = Boolean(redisUrl && redisToken);

let redis = null;
if (isRedis) {
  const { Redis } = require('@upstash/redis');
  redis = new Redis({ url: redisUrl, token: redisToken });
} else {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {}
}

// ---------- Modo local (archivo JSON) ----------
function loadDb() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const db = JSON.parse(raw);
    return {
      settings: { ...DEFAULT_SETTINGS, ...(db.settings || {}) },
      doors: Array.isArray(db.doors) ? db.doors : [],
      votes: Array.isArray(db.votes) ? db.votes : []
    };
  } catch {
    return { settings: { ...DEFAULT_SETTINGS }, doors: [], votes: [] };
  }
}

function saveDb(db) {
  const json = JSON.stringify(db, null, 2);
  const tmp = DB_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, DB_FILE);
  } catch {
    fs.writeFileSync(DB_FILE, json);
  }
}

if (!isRedis && !fs.existsSync(DB_FILE)) {
  saveDb({ settings: { ...DEFAULT_SETTINGS }, doors: [], votes: [] });
}

// ---------- Generador de IDs de puerta ----------
function newDoorId(existingDoors = []) {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  let id;
  do {
    id = Array.from(crypto.randomBytes(7), (b) => abc[b % abc.length]).join('');
  } while ((existingDoors || []).some((d) => d.id === id));
  return id;
}

// ---------- API del almacén ----------
async function getSettings() {
  if (isRedis) {
    try {
      const raw = await redis.get('pdm:settings');
      if (!raw) {
        await redis.set('pdm:settings', JSON.stringify(DEFAULT_SETTINGS));
        return { ...DEFAULT_SETTINGS };
      }
      const parsed = typeof raw === 'object' && raw !== null ? raw : JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch (e) {
      console.error('Error al leer settings de Redis:', e.message);
      return { ...DEFAULT_SETTINGS };
    }
  }
  const db = loadDb();
  return { ...DEFAULT_SETTINGS, ...(db.settings || {}) };
}

async function saveSettings(partial) {
  if (isRedis) {
    const current = await getSettings();
    const updated = { ...current, ...partial };
    await redis.set('pdm:settings', JSON.stringify(updated));
    return updated;
  }
  const db = loadDb();
  db.settings = { ...DEFAULT_SETTINGS, ...(db.settings || {}), ...partial };
  saveDb(db);
  return db.settings;
}

async function getDoors() {
  if (isRedis) {
    try {
      const raw = await redis.get('pdm:doors');
      if (!raw) return [];
      return typeof raw === 'object' && Array.isArray(raw) ? raw : JSON.parse(raw);
    } catch (e) {
      console.error('Error al leer doors de Redis:', e.message);
      return [];
    }
  }
  const db = loadDb();
  return Array.isArray(db.doors) ? db.doors : [];
}

async function getDoor(id) {
  const doors = await getDoors();
  return doors.find((d) => d.id === id) || null;
}

async function saveDoor(door) {
  if (isRedis) {
    const doors = await getDoors();
    doors.push(door);
    await redis.set('pdm:doors', JSON.stringify(doors));
    return door;
  }
  const db = loadDb();
  db.doors.push(door);
  saveDb(db);
  return door;
}

async function updateDoor(id, updateData) {
  if (isRedis) {
    const doors = await getDoors();
    const door = doors.find((d) => d.id === id);
    if (!door) return null;
    Object.assign(door, updateData);
    await redis.set('pdm:doors', JSON.stringify(doors));
    return door;
  }
  const db = loadDb();
  const door = db.doors.find((d) => d.id === id);
  if (!door) return null;
  Object.assign(door, updateData);
  saveDb(db);
  return door;
}

async function deleteDoor(doorId) {
  if (isRedis) {
    // 1. Quitar la puerta de pdm:doors
    const doors = (await getDoors()).filter((d) => d.id !== doorId);
    await redis.set('pdm:doors', JSON.stringify(doors));

    // 2. Borrar conteo en pdm:votes:counts
    await redis.hdel('pdm:votes:counts', doorId);

    // 3. Limpiar llaves anti-duplicado de esta puerta
    const doorKeys = await redis.smembers(`pdm:door_keys:${doorId}`);
    if (doorKeys && doorKeys.length > 0) {
      await redis.del(...doorKeys);
      await redis.srem('pdm:votes:keys', ...doorKeys);
    }
    await redis.del(`pdm:door_keys:${doorId}`);
    return true;
  }
  const db = loadDb();
  db.doors = db.doors.filter((d) => d.id !== doorId);
  db.votes = db.votes.filter((v) => v.doorId !== doorId);
  saveDb(db);
  return true;
}

async function getVoteCounts() {
  if (isRedis) {
    const map = await redis.hgetall('pdm:votes:counts');
    const counts = {};
    for (const [k, v] of Object.entries(map || {})) {
      counts[k] = Number(v) || 0;
    }
    return counts;
  }
  const db = loadDb();
  const c = {};
  for (const v of db.votes || []) c[v.doorId] = (c[v.doorId] || 0) + 1;
  return c;
}

async function getTotalVotes() {
  if (isRedis) {
    const counts = await getVoteCounts();
    return Object.values(counts).reduce((a, b) => a + b, 0);
  }
  const db = loadDb();
  return (db.votes || []).length;
}

// Búsqueda de voto existente
async function findVote(deviceId, k, strictMode) {
  if (isRedis) {
    const keys = [];
    if (deviceId) keys.push(`pdm:dev:${deviceId}`);
    if (k && k.ls) keys.push(`pdm:ls:${k.ls}`);
    if (strictMode !== false && k && k.fp && k.ip) keys.push(`pdm:fp:${k.fp}:${k.ip}`);
    if (!keys.length) return null;

    try {
      const values = await redis.mget(...keys);
      for (const val of values || []) {
        if (val) {
          const doorId = typeof val === 'object' && val !== null ? val.doorId : String(val);
          return { doorId };
        }
      }
    } catch (e) {
      console.error('Error al consultar voto en Redis:', e.message);
    }
    return null;
  }
  const db = loadDb();
  const v = db.votes.find((item) =>
    (deviceId && item.deviceId === deviceId) ||
    (k && k.ls && item.ls === k.ls) ||
    (strictMode !== false && k && k.fp && k.ip && item.fp === k.fp && item.ip === k.ip)
  );
  return v ? { doorId: v.doorId } : null;
}

// Registro atómico de voto
async function recordVote({ doorId, deviceId, k, strictMode, maxVotesPerIp, ua }) {
  if (isRedis) {
    // 1. Verificar si ya votó
    const prev = await findVote(deviceId, k, strictMode);
    if (prev) {
      return { ok: false, duplicate: true, doorId: prev.doorId };
    }

    // 2. Verificar límite por red/IP
    if (maxVotesPerIp > 0 && k && k.ip) {
      const ipVotes = Number(await redis.get(`pdm:ip_votes:${k.ip}`)) || 0;
      if (ipVotes >= maxVotesPerIp) {
        return { ok: false, ipLimit: true };
      }
    }

    // 3. SET NX atómico anti-duplicados
    const kDev = deviceId ? `pdm:dev:${deviceId}` : null;
    const kLs = (k && k.ls) ? `pdm:ls:${k.ls}` : null;
    const kFp = (strictMode !== false && k && k.fp && k.ip) ? `pdm:fp:${k.fp}:${k.ip}` : null;

    const acquired = [];
    if (kDev) {
      const ok = await redis.set(kDev, doorId, { nx: true });
      if (!ok) {
        const existing = await redis.get(kDev);
        return { ok: false, duplicate: true, doorId: String(existing || '') };
      }
      acquired.push(kDev);
    }

    if (kLs) {
      const ok = await redis.set(kLs, doorId, { nx: true });
      if (!ok) {
        if (acquired.length > 0) await redis.del(...acquired);
        const existing = await redis.get(kLs);
        return { ok: false, duplicate: true, doorId: String(existing || '') };
      }
      acquired.push(kLs);
    }

    if (kFp) {
      const ok = await redis.set(kFp, doorId, { nx: true });
      if (!ok) {
        if (acquired.length > 0) await redis.del(...acquired);
        const existing = await redis.get(kFp);
        return { ok: false, duplicate: true, doorId: String(existing || '') };
      }
      acquired.push(kFp);
    }

    // 4. Todo reservado con éxito: incrementar conteo y registrar llaves
    await redis.hincrby('pdm:votes:counts', doorId, 1);
    if (maxVotesPerIp > 0 && k && k.ip) {
      await redis.incr(`pdm:ip_votes:${k.ip}`);
    }

    if (acquired.length > 0) {
      await redis.sadd('pdm:votes:keys', ...acquired);
      await redis.sadd(`pdm:door_keys:${doorId}`, ...acquired);
    }

    return { ok: true, doorId };
  }

  // Modo local
  const db = loadDb();
  const prev = db.votes.find((item) =>
    (deviceId && item.deviceId === deviceId) ||
    (k && k.ls && item.ls === k.ls) ||
    (strictMode !== false && k && k.fp && k.ip && item.fp === k.fp && item.ip === k.ip)
  );
  if (prev) {
    return { ok: false, duplicate: true, doorId: prev.doorId };
  }
  if (maxVotesPerIp > 0 && k && k.ip && db.votes.filter((v) => v.ip === k.ip).length >= maxVotesPerIp) {
    return { ok: false, ipLimit: true };
  }

  db.votes.push({
    id: crypto.randomBytes(6).toString('hex'),
    doorId,
    deviceId,
    ls: k ? k.ls : null,
    fp: k ? k.fp : null,
    ip: k ? k.ip : null,
    ua: ua || null,
    at: new Date().toISOString()
  });
  saveDb(db);
  return { ok: true, doorId };
}

async function resetVotes() {
  if (isRedis) {
    const allKeys = await redis.smembers('pdm:votes:keys');
    if (allKeys && allKeys.length > 0) {
      await redis.del(...allKeys);
    }
    const doors = await getDoors();
    const doorKeySets = doors.map((d) => `pdm:door_keys:${d.id}`);
    if (doorKeySets.length > 0) {
      await redis.del(...doorKeySets);
    }
    await redis.del('pdm:votes:counts', 'pdm:votes:keys');
    return true;
  }
  const db = loadDb();
  db.votes = [];
  saveDb(db);
  return true;
}

module.exports = {
  isRedis,
  DEFAULT_SETTINGS,
  newDoorId,
  getSettings,
  saveSettings,
  getDoors,
  getDoor,
  saveDoor,
  updateDoor,
  deleteDoor,
  getVoteCounts,
  getTotalVotes,
  findVote,
  recordVote,
  resetVotes
};
