'use strict';
/**
 * Puertas de Día de Muertos — servidor de votación
 * Ejecuta:  npm install   y luego   npm start
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const QRCode = require('qrcode');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');
for (const d of [DATA_DIR, UPLOAD_DIR]) fs.mkdirSync(d, { recursive: true });

// ---------- Configuración (se puede cambiar con variables de entorno) ----------
const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_PASSWORD = 'catrina2026';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD;
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const MAX_VOTES_PER_IP = Number(process.env.MAX_VOTES_PER_IP) || 0; // 0 = sin límite por red
const ADMIN_TTL = 12 * 3600 * 1000;

const SECRET = (() => {
  if (process.env.SECRET) return process.env.SECRET;
  if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, s);
  return s;
})();

// ---------- Base de datos en archivo JSON ----------
const DEFAULT_SETTINGS = { votingOpen: true, showResults: true, closesAt: null, strictMode: true };
function loadDb() {
  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return {
      settings: { ...DEFAULT_SETTINGS, ...(db.settings || {}) },
      doors: Array.isArray(db.doors) ? db.doors : [],
      votes: Array.isArray(db.votes) ? db.votes : []
    };
  } catch {
    return { settings: { ...DEFAULT_SETTINGS }, doors: [], votes: [] };
  }
}
let db = loadDb();
function saveDb() {
  const json = JSON.stringify(db, null, 2);
  const tmp = DB_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, DB_FILE);
  } catch {
    fs.writeFileSync(DB_FILE, json);
  }
}
if (!fs.existsSync(DB_FILE)) saveDb();

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
const baseUrl = (req) => PUBLIC_URL || `${req.protocol}://${req.get('host')}`;

function newDoorId() {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  let id;
  do {
    id = Array.from(crypto.randomBytes(7), (b) => abc[b % abc.length]).join('');
  } while (db.doors.some((d) => d.id === id));
  return id;
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

function isVotingOpen() {
  const s = db.settings;
  if (!s.votingOpen) return false;
  if (s.closesAt && Date.now() >= Date.parse(s.closesAt)) return false;
  return true;
}
const publicSettings = () => ({
  votingOpen: isVotingOpen(),
  showResults: !!db.settings.showResults,
  closesAt: db.settings.closesAt || null
});
function voteCounts() {
  const c = {};
  for (const v of db.votes) c[v.doorId] = (c[v.doorId] || 0) + 1;
  return c;
}
function doorView(d, counts, withVotes) {
  const o = {
    id: d.id,
    name: d.name,
    team: d.team,
    description: d.description,
    photos: d.photos.map((f) => '/uploads/' + f),
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

// ---------- API pública ----------
app.get('/api/doors', (req, res) => {
  const s = publicSettings();
  const c = voteCounts();
  res.set('Cache-Control', 'no-store');
  res.json({
    settings: s,
    totalVotes: s.showResults ? db.votes.length : null,
    doors: db.doors.map((d) => doorView(d, c, s.showResults))
  });
});

const FP_RE = /^[a-f0-9]{32,64}$/;
const LS_RE = /^[A-Za-z0-9-]{16,64}$/;
function voterKeys(req) {
  const b = req.body || {};
  const fp = FP_RE.test(b.fp || '') ? b.fp : null;
  const ls = LS_RE.test(b.ls || '') ? hmac('ls:' + b.ls) : null;
  return { fp, ls, ip: hmac('ip:' + (req.ip || '')) };
}
// Un voto se considera repetido si coincide: la cookie del dispositivo, el token del navegador,
// o la huella del dispositivo + la misma red (para cubrir modo incógnito / borrar cookies).
function findVote(req, k) {
  return db.votes.find((v) =>
    v.deviceId === req.deviceId ||
    (k.ls && v.ls === k.ls) ||
    (db.settings.strictMode !== false && k.fp && v.fp === k.fp && v.ip === k.ip)
  );
}

app.post('/api/status', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const v = findVote(req, voterKeys(req));
  if (!v) return res.json({ voted: false });
  const d = db.doors.find((x) => x.id === v.doorId);
  res.json({ voted: true, doorId: v.doorId, doorName: d ? d.name : null });
});

app.post('/api/vote', (req, res) => {
  if (!rateLimit('vote:' + req.ip, 10, 60e3)) {
    return res.status(429).json({ error: 'Demasiados intentos. Espera un minuto, alma impaciente.' });
  }
  if (!isVotingOpen()) return res.status(403).json({ error: 'La votación está cerrada.' });
  const door = db.doors.find((d) => d.id === String((req.body || {}).doorId || ''));
  if (!door) return res.status(404).json({ error: 'Esa puerta no existe.' });
  if (req.newDevice) return res.status(400).json({ error: 'Recarga la página e inténtalo de nuevo.' });
  const k = voterKeys(req);
  if (!k.fp || !k.ls) {
    return res.status(400).json({ error: 'No pudimos verificar tu dispositivo. Recarga la página (y evita el modo incógnito).' });
  }
  const prev = findVote(req, k);
  if (prev) {
    const pd = db.doors.find((d) => d.id === prev.doorId);
    return res.status(409).json({
      error: `Este dispositivo ya votó${pd ? ` por "${pd.name}"` : ''}. Solo se permite 1 voto.`,
      doorId: prev.doorId
    });
  }
  if (MAX_VOTES_PER_IP > 0 && db.votes.filter((v) => v.ip === k.ip).length >= MAX_VOTES_PER_IP) {
    return res.status(429).json({ error: 'Se alcanzó el límite de votos desde esta red.' });
  }
  db.votes.push({
    id: crypto.randomBytes(6).toString('hex'),
    doorId: door.id,
    deviceId: req.deviceId,
    ls: k.ls,
    fp: k.fp,
    ip: k.ip,
    ua: hmac('ua:' + (req.get('user-agent') || '')).slice(0, 16),
    at: new Date().toISOString()
  });
  saveDb();
  res.json({ ok: true, doorId: door.id });
});

// ---------- Códigos QR ----------
app.get('/qr/:id.png', async (req, res) => {
  const id = req.params.id;
  let url;
  if (id === 'inicio') url = baseUrl(req) + '/';
  else {
    const d = db.doors.find((x) => x.id === id);
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

app.get('/api/admin/data', requireAdmin, (req, res) => {
  const c = voteCounts();
  res.set('Cache-Control', 'no-store');
  res.json({
    settings: { ...db.settings, votingOpenNow: isVotingOpen() },
    totalVotes: db.votes.length,
    baseUrl: baseUrl(req),
    doors: db.doors.map((d) => ({ ...doorView(d, c, true), files: d.photos }))
  });
});

const IMG_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}${IMG_TYPES[file.mimetype] || '.jpg'}`)
  }),
  limits: { fileSize: 12 * 1024 * 1024, files: 3, fields: 10 },
  fileFilter: (req, file, cb) => (IMG_TYPES[file.mimetype] ? cb(null, true) : cb(new Error('Solo se permiten imágenes JPG, PNG, WEBP o GIF')))
});
function handleUpload(req, res, next) {
  upload.array('photos', 3)(req, res, (err) => {
    if (!err) return next();
    removeFiles((req.files || []).map((f) => f.filename));
    let msg = err.message;
    if (err.code === 'LIMIT_FILE_SIZE') msg = 'Cada foto debe pesar menos de 12 MB';
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') msg = 'Máximo 3 fotos por puerta';
    res.status(400).json({ error: msg });
  });
}
function removeFiles(list) {
  for (const f of list) fs.unlink(path.join(UPLOAD_DIR, path.basename(f)), () => {});
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
      const f = path.basename(s.slice(5));
      if (existing.includes(f) && !photos.includes(f)) photos.push(f);
    } else if (s.startsWith('new:')) {
      const i = Number(s.slice(4));
      if (files[i] && !used.has(i)) { used.add(i); photos.push(files[i].filename); }
    }
  }
  return { photos, unusedNew: files.filter((_, i) => !used.has(i)).map((f) => f.filename) };
}

app.post('/api/admin/doors', requireAdmin, handleUpload, (req, res) => {
  const files = req.files || [];
  const name = cleanLine(req.body.name, 70);
  const team = cleanLine(req.body.team, 70);
  const description = cleanText(req.body.description, 400);
  const { photos, unusedNew } = applyOrder(req.body.order, [], files);
  removeFiles(unusedNew);
  if (!name || !photos.length) {
    removeFiles(photos);
    return res.status(400).json({ error: !name ? 'La puerta necesita un nombre' : 'Sube al menos 1 foto (máximo 3)' });
  }
  const door = { id: newDoorId(), name, team, description, photos, createdAt: new Date().toISOString() };
  db.doors.push(door);
  saveDb();
  res.json({ ok: true, door: doorView(door, {}, true) });
});

app.put('/api/admin/doors/:id', requireAdmin, handleUpload, (req, res) => {
  const files = req.files || [];
  const door = db.doors.find((d) => d.id === req.params.id);
  if (!door) {
    removeFiles(files.map((f) => f.filename));
    return res.status(404).json({ error: 'Puerta no encontrada' });
  }
  const name = cleanLine(req.body.name, 70);
  const { photos, unusedNew } = applyOrder(req.body.order, door.photos, files);
  removeFiles(unusedNew);
  if (!name || !photos.length) {
    removeFiles(photos.filter((f) => !door.photos.includes(f)));
    return res.status(400).json({ error: !name ? 'La puerta necesita un nombre' : 'La puerta necesita al menos 1 foto' });
  }
  removeFiles(door.photos.filter((f) => !photos.includes(f)));
  door.name = name;
  door.team = cleanLine(req.body.team, 70);
  door.description = cleanText(req.body.description, 400);
  door.photos = photos;
  door.updatedAt = new Date().toISOString();
  saveDb();
  res.json({ ok: true, door: doorView(door, voteCounts(), true) });
});

app.delete('/api/admin/doors/:id', requireAdmin, (req, res) => {
  const door = db.doors.find((d) => d.id === req.params.id);
  if (!door) return res.status(404).json({ error: 'Puerta no encontrada' });
  db.doors = db.doors.filter((d) => d.id !== door.id);
  db.votes = db.votes.filter((v) => v.doorId !== door.id);
  removeFiles(door.photos);
  saveDb();
  res.json({ ok: true });
});

app.post('/api/admin/settings', requireAdmin, (req, res) => {
  const b = req.body || {};
  if ('votingOpen' in b) db.settings.votingOpen = !!b.votingOpen;
  if ('showResults' in b) db.settings.showResults = !!b.showResults;
  if ('strictMode' in b) db.settings.strictMode = !!b.strictMode;
  if ('closesAt' in b) {
    const t = b.closesAt ? Date.parse(b.closesAt) : NaN;
    db.settings.closesAt = Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  saveDb();
  res.json({ ok: true, settings: { ...db.settings, votingOpenNow: isVotingOpen() } });
});

app.post('/api/admin/reset-votes', requireAdmin, (req, res) => {
  db.votes = [];
  saveDb();
  res.json({ ok: true });
});

app.get('/api/admin/export.csv', requireAdmin, (req, res) => {
  const c = voteCounts();
  const total = db.votes.length || 1;
  const rows = db.doors
    .map((d) => ({ d, v: c[d.id] || 0 }))
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
});

// ---------- Páginas ----------
const tpl = (name) => fs.readFileSync(path.join(PUBLIC_DIR, name), 'utf8');
const render = (name, vars) => tpl(name).replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
const ogImageTag = (url) => (url ? `<meta property="og:image" content="${escHtml(url)}">` : '');

app.get('/', (req, res) => {
  const base = baseUrl(req);
  const cover = db.doors.find((d) => d.photos.length);
  res.set('Cache-Control', 'no-store');
  res.send(render('index.html', {
    OG_URL: escHtml(base + '/'),
    OG_IMAGE_TAG: ogImageTag(cover ? `${base}/uploads/${cover.photos[0]}` : '')
  }));
});

app.get('/puerta/:id', (req, res) => {
  const door = db.doors.find((d) => d.id === req.params.id);
  if (!door) return res.redirect('/?nf=1');
  const base = baseUrl(req);
  const shareUrl = `${base}/puerta/${door.id}`;
  res.set('Cache-Control', 'no-store');
  res.send(render('puerta.html', {
    DOOR_ID: escHtml(door.id),
    TITLE: escHtml(door.name),
    TEAM: escHtml(door.team),
    DESC: escHtml((door.description || 'Vota por esta puerta de Día de Muertos.').slice(0, 200)),
    SHARE_URL: escHtml(shareUrl),
    OG_IMAGE_TAG: ogImageTag(door.photos[0] ? `${base}/uploads/${door.photos[0]}` : '')
  }));
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

app.listen(PORT, '0.0.0.0', () => {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) if ((n.family === 'IPv4' || n.family === 4) && !n.internal) ips.push(n.address);
  }
  console.log('\n  💀  PUERTAS DE DÍA DE MUERTOS  🕯️\n');
  console.log(`  Página principal:  http://localhost:${PORT}`);
  ips.forEach((ip) => console.log(`  Desde celulares (misma WiFi):  http://${ip}:${PORT}`));
  console.log(`  Panel de administración:  http://localhost:${PORT}/admin`);
  console.log(`  Pantalla de resultados:   http://localhost:${PORT}/resultados`);
  if (ADMIN_PASSWORD === DEFAULT_PASSWORD) console.log(`\n  ⚠ Contraseña de admin por defecto: ${DEFAULT_PASSWORD}  (cámbiala con ADMIN_PASSWORD)`);
  console.log('');
});
