/* =========================================================
   AquaSense server – small, dependency-free (Node 20+)
   - serves the dashboard and the /control page
   - keeps the sensor on/off state (JSON file in DATA_DIR)
   - pushes every change to all open screens (Server-Sent Events)
   - control actions require a PIN login (signed, HttpOnly cookie)
   ========================================================= */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

// ---------- configuration ----------
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const PUBLIC_DIR = path.resolve(process.env.PUBLIC_DIR || ROOT);
const SAMPLE_MS = Number(process.env.SAMPLE_MINUTES || 5) * 60 * 1000;
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || '');
const HISTORY_MS = 180 * 86400000;
const SENSORS = ['ph', 'sal'];
const VERSION = '2.0.0';

fs.mkdirSync(DATA_DIR, { recursive: true });
const STATE_FILE = path.join(DATA_DIR, 'state.json');

// PIN: from env, else a generated one kept in DATA_DIR (printed once in the logs)
function loadPin() {
  const env = (process.env.CONTROL_PIN || '').trim();
  if (env) {
    if (env.length < 4) { console.error('CONTROL_PIN phải có ít nhất 4 ký tự'); process.exit(1); }
    return env;
  }
  const f = path.join(DATA_DIR, 'control-pin.txt');
  try { const p = fs.readFileSync(f, 'utf8').trim(); if (p) return p; } catch (e) {}
  const p = String(crypto.randomInt(100000, 1000000));
  fs.writeFileSync(f, p + '\n', { mode: 0o600 });
  console.log(`[aquasense] Chưa đặt CONTROL_PIN – đã tạo PIN điều khiển: ${p} (lưu tại ${f})`);
  return p;
}
function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(DATA_DIR, 'session.key');
  try { const s = fs.readFileSync(f, 'utf8').trim(); if (s.length >= 32) return s; } catch (e) {}
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, s + '\n', { mode: 0o600 });
  return s;
}
const PIN = loadPin();
const SECRET = loadSecret();
// sessions are bound to the PIN: changing CONTROL_PIN signs everybody out
const PIN_TAG = crypto.createHmac('sha256', SECRET).update('pin:' + PIN).digest('base64url').slice(0, 12);

// ---------- state ----------
let state = { version: 1, intervals: { ph: [], sal: [] }, log: [] };
try {
  const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  SENSORS.forEach(k => { if (Array.isArray(raw?.intervals?.[k])) state.intervals[k] = raw.intervals[k]; });
  if (Array.isArray(raw?.log)) state.log = raw.log.slice(-100);
} catch (e) { /* first run */ }

let saving = Promise.resolve();
function persist() {
  const data = JSON.stringify(state, null, 1);
  saving = saving.then(async () => {
    const tmp = STATE_FILE + '.tmp';
    await fsp.writeFile(tmp, data);
    await fsp.rename(tmp, STATE_FILE);       // atomic replace
  }).catch(err => console.error('[aquasense] không ghi được trạng thái:', err.message));
}
function prune() {
  const min = Date.now() - HISTORY_MS;
  SENSORS.forEach(k => { state.intervals[k] = state.intervals[k].filter(x => x[1] == null || x[1] > min || (x[2] ?? 0) > min); });
}
const lastOf = k => state.intervals[k][state.intervals[k].length - 1];
const isOn = k => { const l = lastOf(k); return !l || l[1] != null; };

// same rule as the browser (assets/js/data.js): readings stop at offAt, the reading taken at reconnection is kept
function setSensor(k, on, by) {
  if (isOn(k) === on) return false;
  const now = Date.now();
  if (!on) state.intervals[k].push([now, null, null]);
  else {
    const l = lastOf(k);
    l[1] = Math.max(l[0], Math.floor(now / SAMPLE_MS) * SAMPLE_MS);
    l[2] = now;
  }
  state.log.push({ t: now, sensor: k, on, by: String(by || 'Không rõ').slice(0, 60) });
  state.log = state.log.slice(-100);
  prune();
  persist();
  return true;
}
function snapshot(authed) {
  return {
    server: 'aquasense', version: VERSION, now: Date.now(), sampleMinutes: SAMPLE_MS / 60000,
    authed: !!authed,
    sensors: Object.fromEntries(SENSORS.map(k => [k, { on: isOn(k), since: isOn(k) ? null : lastOf(k)[0] }])),
    intervals: state.intervals,
    log: authed ? state.log.slice(-30).reverse() : undefined
  };
}

// ---------- sessions ----------
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (p.pin !== PIN_TAG || !(p.exp > Date.now())) return null;
    return p;
  } catch (e) { return null; }
}
function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(c => { const i = c.indexOf('='); if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); });
  return out;
}
const COOKIE = 'aq_ctl';
const isAuthed = req => !!verify(cookies(req)[COOKIE]);
const isHttps = req => req.socket.encrypted || (TRUST_PROXY && /https/i.test(String(req.headers['x-forwarded-proto'] || '')));
function sessionCookie(req, token, maxAge) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;
}
function pinMatches(input) {
  const a = crypto.createHash('sha256').update(String(input || '')).digest();
  const b = crypto.createHash('sha256').update(PIN).digest();
  return crypto.timingSafeEqual(a, b);
}

// brute-force guard: 8 wrong PINs per 10 minutes per client address
const attempts = new Map();
const clientIp = req => (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';
function limited(ip) {
  const now = Date.now();
  const a = (attempts.get(ip) || []).filter(t => now - t < 10 * 60000);
  attempts.set(ip, a);
  return a.length >= 8;
}

// ---------- SSE ----------
const clients = new Set();
function broadcast() {
  for (const c of clients) {
    try { c.res.write(`event: state\ndata: ${JSON.stringify(snapshot(c.authed))}\n\n`); } catch (e) {}
  }
}
setInterval(() => { for (const c of clients) { try { c.res.write(': ping\n\n'); } catch (e) {} } }, 25000).unref();

// ---------- HTTP helpers ----------
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
};
function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}
function json(res, status, obj, headers = {}) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 4096) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch (e) { reject(Object.assign(new Error('bad json'), { status: 400 })); } });
    req.on('error', reject);
  });
}
// state-changing calls must come from our own pages (custom header → no cross-site form posts)
const sameSite = req => req.headers['x-requested-with'] === 'aquasense';

// ---------- static files ----------
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8'
};
const ALLOWED_TOP = new Set(['index.html', 'assets', 'control']);
async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (rel === '') rel = 'index.html';
  if (rel === 'control') { res.writeHead(301, { Location: '/control/' }); return res.end(); }
  if (rel.endsWith('/')) rel += 'index.html';
  const top = rel.split('/')[0];
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!ALLOWED_TOP.has(top) || !file.startsWith(PUBLIC_DIR + path.sep) || rel.split('/').some(p => p.startsWith('.'))) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
  let st;
  try { st = await fsp.stat(file); } catch (e) { return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' }); }
  if (st.isDirectory()) { res.writeHead(301, { Location: '/' + rel + '/' }); return res.end(); }
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'ETag': etag,
    'Cache-Control': /\/(fonts|vendor)\//.test(rel) ? 'public, max-age=604800' : 'no-cache'
  };
  if (req.headers['if-none-match'] === etag) return send(res, 304, '', headers);
  res.writeHead(200, { ...SECURITY_HEADERS, ...headers, 'Content-Length': st.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

// ---------- routes ----------
async function handle(req, res) {
  const url = new URL(req.url, 'http://local');
  const p = url.pathname;

  if (p === '/healthz') return json(res, 200, { ok: true });

  if (p === '/api/state' && req.method === 'GET') return json(res, 200, snapshot(isAuthed(req)));

  if (p === '/api/events' && req.method === 'GET') {
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    const client = { res, authed: isAuthed(req) };
    clients.add(client);
    res.write('retry: 3000\n');
    res.write(`event: state\ndata: ${JSON.stringify(snapshot(client.authed))}\n\n`);
    req.on('close', () => clients.delete(client));
    return;
  }

  if (p === '/api/login' && req.method === 'POST') {
    if (!sameSite(req)) return json(res, 403, { error: 'Yêu cầu không hợp lệ' });
    const ip = clientIp(req);
    if (limited(ip)) return json(res, 429, { error: 'Thử sai quá nhiều lần, vui lòng đợi 10 phút' });
    let body; try { body = await readJson(req); } catch (e) { return json(res, e.status || 400, { error: 'Dữ liệu không hợp lệ' }); }
    if (!pinMatches(body.pin)) {
      attempts.get(ip).push(Date.now());
      await new Promise(r => setTimeout(r, 400));
      return json(res, 401, { error: 'Mã PIN không đúng' });
    }
    attempts.delete(ip);
    const maxAge = SESSION_DAYS * 86400;
    const token = sign({ exp: Date.now() + maxAge * 1000, pin: PIN_TAG, dev: String(body.device || '').slice(0, 60) });
    return json(res, 200, { ok: true, state: snapshot(true) }, { 'Set-Cookie': sessionCookie(req, token, maxAge) });
  }

  if (p === '/api/logout' && req.method === 'POST') {
    if (!sameSite(req)) return json(res, 403, { error: 'Yêu cầu không hợp lệ' });
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  const m = p.match(/^\/api\/sensors\/(ph|sal)$/);
  if (m && req.method === 'POST') {
    if (!sameSite(req)) return json(res, 403, { error: 'Yêu cầu không hợp lệ' });
    const session = verify(cookies(req)[COOKIE]);
    if (!session) return json(res, 401, { error: 'Cần đăng nhập' });
    let body; try { body = await readJson(req); } catch (e) { return json(res, e.status || 400, { error: 'Dữ liệu không hợp lệ' }); }
    if (typeof body.on !== 'boolean') return json(res, 400, { error: 'Thiếu trường "on" (true/false)' });
    const changed = setSensor(m[1], body.on, session.dev || 'Trình duyệt');
    if (changed) { broadcast(); console.log(`[aquasense] ${m[1]} → ${body.on ? 'BẬT' : 'TẮT'} (${session.dev || '?'})`); }
    return json(res, 200, { ok: true, changed, state: snapshot(true) });
  }

  if (p.startsWith('/api/')) return json(res, 404, { error: 'Không tìm thấy' });
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { 'Content-Type': 'text/plain' });
  return serveStatic(req, res, p);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    console.error('[aquasense]', err);
    if (!res.headersSent) json(res, 500, { error: 'Lỗi máy chủ' }); else res.end();
  });
});
server.listen(PORT, HOST, () => {
  console.log(`[aquasense] v${VERSION} đang chạy tại http://${HOST}:${PORT}  (dashboard: /  ·  điều khiển: /control/)`);
  console.log(`[aquasense] dữ liệu: ${DATA_DIR}`);
});
const shutdown = () => { for (const c of clients) { try { c.res.end(); } catch (e) {} } server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
