'use strict';
/**
 * Puertas de Día de Muertos — aplicación Express
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const storage = require('./storage');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');

try {
  for (const d of [DATA_DIR, UPLOAD_DIR]) fs.mkdirSync(d, { recursive: true });
} catch {}

// ---------- Configuración ----------
const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_PASSWORD = 'catrina2026';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD;
const MAX_VOTES_PER_IP = Number(process.env.MAX_VOTES_PER_IP) || 0;
const ADMIN_TTL = 12 * 3600 * 1000;
const isBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

let blobPut = null;
let blobDel = null;
if (isBlob) {
  try {
    const blobModule = require('@vercel/blob');
    blobPut = blobModule.put;
    blobDel = blobModule.del;
  } catch (e) {
    console.error('Error cargando @vercel/blob:', e.message);
  }
}

const SECRET = (() => {
  if (process.env.SECRET) return process.env.SECRET;
  if (fs.existsSync(SECRET_FILE)) {
    try {
      return fs.readFileSync(SECRET_FILE, 'utf8').trim();
    } catch {}
  }
  const s = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(SECRET_FILE, s);
  } catch {}
  return s;
})();

// ---------- Utilidades ----------
const hmac = (v) => crypto.createHmac('sha256', SECRET).update(String(v)).digest('hex');
const sign = (v) => `${v}.${hmac(v).slice(0, 32)}`;
function unsign(s) {
  if (!s) return null;
  const i = s.lastIndexOf('.');
  if (i < 0) return null;
  const v = s.slice(0, i);
  const a = Buffer.from(sign(v)), b = Buffer.from(s);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? v : null;
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) {
      try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch { /* ignorar */ }
    }
  });
  return out;
}

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cleanLine = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanText = (v, max) => String(v ?? '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);

function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  const ok = arr.length < max;
  if (ok) arr.push(now);
  buckets.set(key, arr);
  return ok;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, a] of buckets) if (!a.length || now - a[a.length - 1] > 3600e3) buckets.delete(k);
}, 600e3).unref();

function isVotingOpen(s) {
  if (!s.votingOpen) return false;
  if (s.closesAt && Date.now() >= Date.parse(s.closesAt)) return false;
  return true;
}

const publicSettings = (s) => ({
  votingOpen: isVotingOpen(s),
  showResults: !!s.showResults,
  closesAt: s.closesAt || null
});

function doorView(d, counts, withVotes) {
  const o = {
    id: d.id,
    name: d.name,
    team: d.team,
    description: d.description,
    photos: (d.photos || []).map((f) => (f.startsWith('http://') || f.startsWith('https://') || f.startsWith('/') ? f : '/uploads/' + f)),
    url: '/puerta/' + d.id
  };
  if (withVotes) o.votes = counts[d.id] || 0;
  return o;
}

// ---------- App ----------
const app = express();
app.disable('x-powered-by');

const tp = process.env.TRUST_PROXY;
app.set('trust proxy', tp ? (/^\d+$/.test(tp) ? Number(tp) : tp === 'true' ? true : tp) : 'loopback');
app.use(express.json({ limit: '50kb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Identificador de dispositivo (cookie firmada, 400 días)
app.use((req, res, next) => {
  req.cookies = parseCookies(req);
  let dev = unsign(req.cookies.pdm_dev);
  req.newDevice = false;
  if (!dev) {
    dev = crypto.randomUUID();
    req.newDevice = true;
    res.cookie('pdm_dev', sign(dev), { httpOnly: true, sameSite: 'lax', maxAge: 400 * 24 * 3600 * 1000, path: '/' });
  }
  req.deviceId = dev;
  next();
});

app.use('/static', express.static(PUBLIC_DIR, { maxAge: '1h', index: false }));
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules', 'three', 'build'), { maxAge: '7d' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', index: false }));

// ---------- Multer y manejo de fotos (Vercel Blob / uploads local) ----------
const IMG_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const uploadStorage = isBlob
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: UPLOAD_DIR,
      filename: (req, file, cb) => cb(null, `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}${IMG_TYPES[file.mimetype] || '.jpg'}`)
    });

const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 12 * 1024 * 1024, files: 3, fields: 10 },
  fileFilter: (req, file, cb) => (IMG_TYPES[file.mimetype] ? cb(null, true) : cb(new Error('Solo se permiten imágenes JPG, PNG, WEBP o GIF')))
});

function handleUpload(req, res, next) {
  upload.array('photos', 3)(req, res, async (err) => {
    if (!err) return next();
    if (!isBlob) {
      await removeFiles((req.files || []).map((f) => f.filename));
    }
    let msg = err.message;
    if (err.code === 'LIMIT_FILE_SIZE') msg = 'Cada foto debe pesar menos de 12 MB';
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') msg = 'Máximo 3 fotos por puerta';
    res.status(400).json({ error: msg });
  });
}

async function uploadToBlob(file) {
  if (!blobPut) throw new Error('Vercel Blob no configurado en este entorno');
  const ext = IMG_TYPES[file.mimetype] || '.jpg';
  const pathname = `doors/${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  const blob = await blobPut(pathname, file.buffer, {
    access: 'public',
    token: process.env.BLOB_READ_WRITE_TOKEN,
    contentType: file.mimetype
  });
  return blob.url;
}

async function removeFiles(list) {
  if (!list || !list.length) return;
  for (const f of list) {
    if (!f) continue;
    if (typeof f === 'string' && (f.startsWith('http://') || f.startsWith('https://'))) {
      if (blobDel && process.env.BLOB_READ_WRITE_TOKEN) {
        try {
          await blobDel(f, { token: process.env.BLOB_READ_WRITE_TOKEN });
        } catch (e) {
          console.error('Error eliminando blob:', e.message);
        }
      }
    } else {
      try {
        fs.unlink(path.join(UPLOAD_DIR, path.basename(f)), () => {});
      } catch {}
    }
  }
}

// order: ["keep:archivo.jpg", "new:0", ...] define qué fotos quedan y en qué orden (máx. 3)
function applyOrder(order, existing, files) {
  let arr;
  try { arr = JSON.parse(order || 'null'); } catch { arr = null; }
  if (!Array.isArray(arr)) arr = [...existing.map((f) => 'keep:' + f), ...files.map((_, i) => 'new:' + i)];
  const photos = [];
  const used = new Set();
  for (const tok of arr) {
    if (photos.length >= 3) break;
    const s = String(tok);
    if (s.startsWith('keep:')) {
      const f = s.slice(5);
      if (existing.includes(f) && !photos.includes(f)) {
        photos.push(f);
      } else {
        const found = existing.find((ex) => ex === f || path.basename(ex) === path.basename(f));
        if (found && !photos.includes(found)) photos.push(found);
      }
    } else if (s.startsWith('new:')) {
      const i = Number(s.slice(4));
      if (files[i] && !used.has(i)) {
        used.add(i);
        photos.push(files[i].url || files[i].filename);
      }
    }
  }
  return {
    photos,
    unusedNew: files.filter((_, i) => !used.has(i)).map((f) => f.url || f.filename)
  };
}

// ---------- API pública ----------
app.get('/api/doors', async (req, res, next) => {
  try {
    const settings = await storage.getSettings();
    const s = publicSettings(settings);
    const [counts, doors, totalVotes] = await Promise.all([
      storage.getVoteCounts(),
      storage.getDoors(),
      storage.getTotalVotes()
    ]);
    res.set('Cache-Control', 'no-store');
    res.json({
      settings: s,
      totalVotes: s.showResults ? totalVotes : null,
      doors: doors.map((d) => doorView(d, counts, s.showResults))
    });
  } catch (err) { next(err); }
});

const FP_RE = /^[a-f0-9]{32,64}$/;
const LS_RE = /^[A-Za-z0-9-]{16,64}$/;
function voterKeys(req) {
  const b = req.body || {};
  const fp = FP_RE.test(b.fp || '') ? b.fp : null;
  const ls = LS_RE.test(b.ls || '') ? hmac('ls:' + b.ls) : null;
  return { fp, ls, ip: hmac('ip:' + (req.ip || '')) };
}

app.post('/api/status', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const settings = await storage.getSettings();
    const k = voterKeys(req);
    const v = await storage.findVote(req.deviceId, k, settings.strictMode);
    if (!v) return res.json({ voted: false });
    const d = await storage.getDoor(v.doorId);
    res.json({ voted: true, doorId: v.doorId, doorName: d ? d.name : null });
  } catch (err) { next(err); }
});

app.post('/api/vote', async (req, res, next) => {
  try {
    if (!rateLimit('vote:' + req.ip, 10, 60e3)) {
      return res.status(429).json({ error: 'Demasiados intentos. Espera un minuto, alma impaciente.' });
    }
    const settings = await storage.getSettings();
    if (!isVotingOpen(settings)) return res.status(403).json({ error: 'La votación está cerrada.' });

    const doorId = String((req.body || {}).doorId || '');
    const door = await storage.getDoor(doorId);
    if (!door) return res.status(404).json({ error: 'Esa puerta no existe.' });
    if (req.newDevice) return res.status(400).json({ error: 'Recarga la página e inténtalo de nuevo.' });

    const k = voterKeys(req);
    if (!k.fp || !k.ls) {
      return res.status(400).json({ error: 'No pudimos verificar tu dispositivo. Recarga la página (y evita el modo incógnito).' });
    }

    const voteResult = await storage.recordVote({
      doorId: door.id,
      deviceId: req.deviceId,
      k,
      strictMode: settings.strictMode,
      maxVotesPerIp: MAX_VOTES_PER_IP,
      ua: hmac('ua:' + (req.get('user-agent') || '')).slice(0, 16)
    });

    if (!voteResult.ok) {
      if (voteResult.ipLimit) {
        return res.status(429).json({ error: 'Se alcanzó el límite de votos desde esta red.' });
      }
      if (voteResult.duplicate) {
        const pd = await storage.getDoor(voteResult.doorId);
        return res.status(409).json({
          error: `Este dispositivo ya votó${pd ? ` por "${pd.name}"` : ''}. Solo se permite 1 voto.`,
          doorId: voteResult.doorId
        });
      }
      return res.status(400).json({ error: 'No se pudo registrar tu voto.' });
    }

    res.json({ ok: true, doorId: door.id });
  } catch (err) { next(err); }
});

// ---------- Códigos QR ----------
app.get('/qr/:id.png', async (req, res) => {
  const id = req.params.id;
  let url;
  if (id === 'inicio') {
    url = baseUrl(req) + '/';
  } else {
    const d = await storage.getDoor(id);
    if (!d) return res.status(404).end();
    url = baseUrl(req) + '/puerta/' + d.id;
  }
  try {
    const buf = await QRCode.toBuffer(url, { width: 480, margin: 2, color: { dark: '#14051c', light: '#ffffff' } });
    res.type('png').set('Cache-Control', 'public, max-age=300').send(buf);
  } catch {
    res.status(500).end();
  }
});

// ---------- Administración ----------
function isAdmin(req) {
  const v = unsign(req.cookies.pdm_admin);
  if (!v) return false;
  const [tag, exp] = v.split(':');
  return tag === 'admin' && Number(exp) > Date.now();
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Tu sesión expiró. Vuelve a entrar.' });
  next();
}

app.post('/api/admin/login', (req, res) => {
  if (!rateLimit('login:' + req.ip, 8, 15 * 60e3)) {
    return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos.' });
  }
  const p = String((req.body || {}).password || '');
  const ok = crypto.timingSafeEqual(Buffer.from(hmac('pw:' + p)), Buffer.from(hmac('pw:' + ADMIN_PASSWORD)));
  if (!ok) return res.status(401).json({ error: 'Contraseña incorrecta' });
  res.cookie('pdm_admin', sign('admin:' + (Date.now() + ADMIN_TTL)), { httpOnly: true, sameSite: 'strict', maxAge: ADMIN_TTL, path: '/' });
  res.json({ ok: true, defaultPassword: ADMIN_PASSWORD === DEFAULT_PASSWORD });
});

app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('pdm_admin', { path: '/' });
  res.json({ ok: true });
});

app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ ok: true, defaultPassword: ADMIN_PASSWORD === DEFAULT_PASSWORD }));

app.get('/api/admin/data', requireAdmin, async (req, res, next) => {
  try {
    const settings = await storage.getSettings();
    const [counts, totalVotes, doors] = await Promise.all([
      storage.getVoteCounts(),
      storage.getTotalVotes(),
      storage.getDoors()
    ]);
    res.set('Cache-Control', 'no-store');
    res.json({
      settings: { ...settings, votingOpenNow: isVotingOpen(settings) },
      totalVotes,
      baseUrl: baseUrl(req),
      doors: doors.map((d) => ({ ...doorView(d, counts, true), files: d.photos }))
    });
  } catch (err) { next(err); }
});

app.post('/api/admin/doors', requireAdmin, handleUpload, async (req, res, next) => {
  try {
    const files = req.files || [];
    if (isBlob) {
      for (const f of files) {
        f.url = await uploadToBlob(f);
      }
    }
    const name = cleanLine(req.body.name, 70);
    const team = cleanLine(req.body.team, 70);
    const description = cleanText(req.body.description, 400);
    const { photos, unusedNew } = applyOrder(req.body.order, [], files);
    await removeFiles(unusedNew);
    if (!name || !photos.length) {
      await removeFiles(photos);
      return res.status(400).json({ error: !name ? 'La puerta necesita un nombre' : 'Sube al menos 1 foto (máximo 3)' });
    }
    const existingDoors = await storage.getDoors();
    const id = storage.newDoorId(existingDoors);
    const door = { id, name, team, description, photos, createdAt: new Date().toISOString() };
    await storage.saveDoor(door);
    res.json({ ok: true, door: doorView(door, {}, true) });
  } catch (err) { next(err); }
});

app.put('/api/admin/doors/:id', requireAdmin, handleUpload, async (req, res, next) => {
  try {
    const files = req.files || [];
    const door = await storage.getDoor(req.params.id);
    if (!door) {
      if (!isBlob) {
        await removeFiles(files.map((f) => f.filename));
      }
      return res.status(404).json({ error: 'Puerta no encontrada' });
    }
    if (isBlob) {
      for (const f of files) {
        f.url = await uploadToBlob(f);
      }
    }
    const name = cleanLine(req.body.name, 70);
    const { photos, unusedNew } = applyOrder(req.body.order, door.photos, files);
    await removeFiles(unusedNew);
    if (!name || !photos.length) {
      await removeFiles(photos.filter((f) => !door.photos.includes(f)));
      return res.status(400).json({ error: !name ? 'La puerta necesita un nombre' : 'La puerta necesita al menos 1 foto' });
    }
    await removeFiles(door.photos.filter((f) => !photos.includes(f)));
    const updated = await storage.updateDoor(door.id, {
      name,
      team: cleanLine(req.body.team, 70),
      description: cleanText(req.body.description, 400),
      photos,
      updatedAt: new Date().toISOString()
    });
    const counts = await storage.getVoteCounts();
    res.json({ ok: true, door: doorView(updated, counts, true) });
  } catch (err) { next(err); }
});

app.delete('/api/admin/doors/:id', requireAdmin, async (req, res, next) => {
  try {
    const door = await storage.getDoor(req.params.id);
    if (!door) return res.status(404).json({ error: 'Puerta no encontrada' });
    await storage.deleteDoor(door.id);
    await removeFiles(door.photos);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.post('/api/admin/settings', requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    const patch = {};
    if ('votingOpen' in b) patch.votingOpen = !!b.votingOpen;
    if ('showResults' in b) patch.showResults = !!b.showResults;
    if ('strictMode' in b) patch.strictMode = !!b.strictMode;
    if ('closesAt' in b) {
      const t = b.closesAt ? Date.parse(b.closesAt) : NaN;
      patch.closesAt = Number.isNaN(t) ? null : new Date(t).toISOString();
    }
    const updated = await storage.saveSettings(patch);
    res.json({ ok: true, settings: { ...updated, votingOpenNow: isVotingOpen(updated) } });
  } catch (err) { next(err); }
});

app.post('/api/admin/reset-votes', requireAdmin, async (req, res, next) => {
  try {
    await storage.resetVotes();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.get('/api/admin/export.csv', requireAdmin, async (req, res, next) => {
  try {
    const [counts, totalVotes, doors] = await Promise.all([
      storage.getVoteCounts(),
      storage.getTotalVotes(),
      storage.getDoors()
    ]);
    const total = totalVotes || 1;
    const rows = doors
      .map((d) => ({ d, v: counts[d.id] || 0 }))
      .sort((a, b) => b.v - a.v || a.d.name.localeCompare(b.d.name, 'es'));
    const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    let place = 0, last = null;
    const lines = ['Lugar,Puerta,Equipo,Votos,Porcentaje,Link'];
    rows.forEach((r, i) => {
      if (r.v !== last) { place = i + 1; last = r.v; }
      lines.push([place, q(r.d.name), q(r.d.team), r.v, ((r.v / total) * 100).toFixed(1) + '%', q(baseUrl(req) + '/puerta/' + r.d.id)].join(','));
    });
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="resultados-puertas-dia-de-muertos.csv"');
    res.send('\uFEFF' + lines.join('\r\n'));
  } catch (err) { next(err); }
});

// ---------- Páginas ----------
const tpl = (name) => {
  const p1 = path.join(PUBLIC_DIR, name);
  if (fs.existsSync(p1)) return fs.readFileSync(p1, 'utf8');
  const p2 = path.join(process.cwd(), 'public', name);
  if (fs.existsSync(p2)) return fs.readFileSync(p2, 'utf8');
  throw new Error(`Template not found: ${name}`);
};

const render = (name, vars) => tpl(name).replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
const ogImageTag = (url) => (url ? `<meta property="og:image" content="${escHtml(url)}">` : '');

app.get('/', async (req, res, next) => {
  try {
    const base = baseUrl(req);
    const doors = await storage.getDoors();
    const cover = doors.find((d) => d.photos && d.photos.length);
    let coverUrl = '';
    if (cover && cover.photos[0]) {
      const p = cover.photos[0];
      coverUrl = p.startsWith('http://') || p.startsWith('https://') ? p : `${base}/uploads/${p}`;
    }
    res.set('Cache-Control', 'no-store');
    res.send(render('index.html', {
      OG_URL: escHtml(base + '/'),
      OG_IMAGE_TAG: ogImageTag(coverUrl)
    }));
  } catch (err) { next(err); }
});

app.get('/puerta/:id', async (req, res, next) => {
  try {
    const door = await storage.getDoor(req.params.id);
    if (!door) return res.redirect('/?nf=1');
    const base = baseUrl(req);
    const shareUrl = `${base}/puerta/${door.id}`;
    let photoUrl = '';
    if (door.photos && door.photos[0]) {
      const p = door.photos[0];
      photoUrl = p.startsWith('http://') || p.startsWith('https://') ? p : `${base}/uploads/${p}`;
    }
    res.set('Cache-Control', 'no-store');
    res.send(render('puerta.html', {
      DOOR_ID: escHtml(door.id),
      TITLE: escHtml(door.name),
      TEAM: escHtml(door.team),
      DESC: escHtml((door.description || 'Vota por esta puerta de Día de Muertos.').slice(0, 200)),
      SHARE_URL: escHtml(shareUrl),
      OG_IMAGE_TAG: ogImageTag(photoUrl)
    }));
  } catch (err) { next(err); }
});

app.get('/resultados', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.send(tpl('resultados.html'));
});

app.get('/admin', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.send(tpl('admin.html'));
});

app.use('/api', (req, res) => res.status(404).json({ error: 'No encontrado' }));
app.use((req, res) => res.redirect('/'));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Algo salió mal en el más allá. Intenta de nuevo.' });
});

module.exports = {
  app,
  PORT,
  DEFAULT_PASSWORD,
  ADMIN_PASSWORD
};
