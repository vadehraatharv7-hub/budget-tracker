import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { db, allSettings, getSetting, setSetting, num, cleanColor, cleanIcon, cleanText } from './db.js';
import { currentRate, refreshRate, rateHistory, toBase, localDate } from './rates.js';
import { buildSummary, shortStatus, monthOf } from './summary.js';
import { vapidPublicKey, saveSubscription, isAllowedPushEndpoint, removeSubscription, subscriptionCount, notify, checkThresholds } from './push.js';
import { startScheduler } from './scheduler.js';

const PORT = Number(process.env.PORT || 3000);
const PASSWORD = process.env.APP_PASSWORD || '';
const PUBLIC = resolve(fileURLToPath(new URL('../public', import.meta.url)));
const CURRENCIES = ['DKK', 'INR'];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

// ---------- helpers ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => new HttpError(400, msg);

// TRUST_PROXY=1          behind a normal reverse proxy: client IP = first X-Forwarded-For hop
// TRUST_PROXY=cloudflare behind Cloudflare Tunnel: client IP = CF-Connecting-IP (set by Cloudflare, not spoofable
//                        from the internet; pair it with HOST=127.0.0.1 so nothing else can reach the app directly)
const PROXY_MODE = process.env.TRUST_PROXY === 'cloudflare' ? 'cloudflare' : process.env.TRUST_PROXY ? 'forwarded' : '';
const TRUST_PROXY = !!PROXY_MODE;
const HOST = process.env.HOST || '0.0.0.0';
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
const SESSION_DAYS = 90;
const sha = (v) => createHash('sha256').update(v).digest('hex');
// Server-side sessions: random tokens, revocable, expiring. Changing APP_PASSWORD revokes them all.
const pwFingerprint = createHmac('sha256', String(getSetting('api_token'))).update(PASSWORD).digest('hex');
if (getSetting('pw_fp') !== pwFingerprint) { db.exec('DELETE FROM sessions'); setSetting('pw_fp', pwFingerprint); }
db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now()), 3600_000).unref();
function newSession() {
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(id, expires) VALUES(?,?)').run(sha(token), Date.now() + SESSION_DAYS * 864e5);
  return token;
}
const clientIp = (req) => {
  const h = PROXY_MODE === 'cloudflare' ? req.headers['cf-connecting-ip'] : PROXY_MODE === 'forwarded' ? req.headers['x-forwarded-for']?.split(',')[0] : '';
  return (h && String(h).trim()) || req.socket.remoteAddress;
};
const safeEq = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]));
}
function hasSession(req) {
  if (!PASSWORD) return true;
  const c = cookies(req).bt_session;
  if (!c || !/^[0-9a-f]{64}$/.test(c)) return false;
  const row = db.prepare('SELECT expires FROM sessions WHERE id = ?').get(sha(c));
  return !!row && row.expires > Date.now();
}
function hasApiToken(req, body) {
  const h = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.headers['x-api-key'] || body?.token || '';
  return !!h && safeEq(String(h), getSetting('api_token'));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 1e6) throw new HttpError(413, 'Body too large');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  const type = req.headers['content-type'] || '';
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  try { return JSON.parse(raw); } catch { throw bad('Invalid JSON'); }
}

const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};
// Failed logins / bad API tokens, per client IP. A failure only counts for FAIL_WINDOW; reaching FAIL_LIMIT inside that
// window locks the IP out for the same time; a successful login clears the count, so ordinary typos never add up.
const FAIL_LIMIT = Number(process.env.LOGIN_MAX_FAILURES) || 8;
const FAIL_WINDOW_MS = (Number(process.env.LOGIN_WINDOW_SECONDS) || 15 * 60) * 1000;
const failures = new Map(); // ip -> {n, first, until}
const throttled = (ip) => (failures.get(ip)?.until || 0) > Date.now();
function noteFailure(ip) {
  const now = Date.now();
  let f = failures.get(ip);
  if (!f || now - f.first > FAIL_WINDOW_MS) f = { n: 0, first: now, until: 0 }; // window (or lock-out) over: start fresh
  f.n += 1;
  if (f.n >= FAIL_LIMIT) f.until = now + FAIL_WINDOW_MS;
  failures.set(ip, f);
  if (failures.size > 10_000) failures.delete(failures.keys().next().value); // bound memory under a distributed flood
}
const clearFailures = (ip) => failures.delete(ip);
setInterval(() => {
  const now = Date.now();
  for (const [ip, f] of failures) if (now - f.first > FAIL_WINDOW_MS && f.until <= now) failures.delete(ip);
}, 60_000).unref();
const isHttps = (req) => req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';

function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, { 'content-type': typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(body);
}

// "1.234,50" / "1,5" / "45" -> number. iOS Shortcuts hands us whatever the user typed.
function parseAmount(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim().replace(/[^\d.,-]/g, '');
  if (!s) return NaN;
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  return Number(s);
}

function validDate(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)); }

function resolveCategory(input) {
  if (input == null || input === '') return null;
  if (Number.isInteger(Number(input)) && String(input).trim() !== '') {
    const c = db.prepare('SELECT id FROM categories WHERE id = ?').get(Number(input));
    if (c) return c.id;
  }
  const q = String(input).trim().toLowerCase();
  const all = db.prepare('SELECT id, name FROM categories WHERE archived = 0').all();
  return (all.find((c) => c.name.toLowerCase() === q)
    || all.find((c) => c.name.toLowerCase().startsWith(q))
    || all.find((c) => c.name.toLowerCase().includes(q) || q.includes(c.name.toLowerCase())))?.id ?? null;
}

const expenseSelect = `SELECT e.id, e.date, e.amount, e.currency, e.amount_base, e.rate, e.category_id, e.note, e.source, e.created_at
                       FROM expenses e`;

function parseMoneyInput({ amount, currency, date }) {
  const base = getSetting('base_currency');
  const amt = parseAmount(amount);
  if (!(amt > 0) || amt > 1e9) throw bad('Amount must be a positive number');
  const cur = String(currency || base).toUpperCase();
  if (!CURRENCIES.includes(cur)) throw bad(`Currency must be one of ${CURRENCIES.join(', ')}`);
  const d = date || localDate(new Date());
  if (!validDate(d)) throw bad('Date must be YYYY-MM-DD');
  return { amt, cur, d, ...toBase(amt, cur, base) };
}

export function addExpense({ amount, currency, date, category, note, source }) {
  const { amt, cur, d, amount_base, rate } = parseMoneyInput({ amount, currency, date });
  const catId = resolveCategory(category);
  const info = db.prepare(`INSERT INTO expenses(date,amount,currency,amount_base,rate,category_id,note,source) VALUES(?,?,?,?,?,?,?,?)`)
    .run(d, amt, cur, amount_base, rate, catId, String(note || '').slice(0, 200), source || 'app');
  const row = db.prepare(`${expenseSelect} WHERE e.id = ?`).get(info.lastInsertRowid);
  checkThresholds(monthOf(d)).catch((e) => console.warn('[alerts]', e.message));
  return row;
}

export function addIncome({ amount, currency, date, source, note }) {
  const { amt, cur, d, amount_base, rate } = parseMoneyInput({ amount, currency, date });
  const info = db.prepare('INSERT INTO income(date,amount,currency,amount_base,rate,source) VALUES(?,?,?,?,?,?)')
    .run(d, amt, cur, amount_base, rate, String(source ?? note ?? '').slice(0, 120));
  return db.prepare('SELECT * FROM income WHERE id = ?').get(info.lastInsertRowid);
}

// ---------- API routes ----------
// `auth`: 'session' (cookie, or open when no password), 'token' (Shortcuts), 'none'
const routes = [];
const route = (method, path, auth, handler) => routes.push({ method, re: new RegExp(`^${path.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), auth, handler });

route('POST', '/api/login', 'none', async ({ body, res, req }) => {
  if (!PASSWORD) return { ok: true };
  const ip = clientIp(req);
  if (throttled(ip)) throw new HttpError(429, `Too many attempts — try again in ${Math.max(1, Math.ceil((failures.get(ip).until - Date.now()) / 60_000))} minute(s)`);
  if (!safeEq(String(body.password || ''), PASSWORD)) { noteFailure(ip); throw new HttpError(401, 'Wrong password'); }
  clearFailures(ip);
  res.setHeader('set-cookie', `bt_session=${newSession()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${isHttps(req) ? '; Secure' : ''}`);
  return { ok: true };
});
route('POST', '/api/logout', 'none', async ({ req, res }) => {
  const c = cookies(req).bt_session;
  if (c) db.prepare('DELETE FROM sessions WHERE id = ?').run(sha(c));
  res.setHeader('set-cookie', 'bt_session=; HttpOnly; Path=/; Max-Age=0');
  return { ok: true };
});
route('GET', '/api/session', 'none', async ({ req }) => ({ authed: hasSession(req), passwordRequired: !!PASSWORD }));

route('GET', '/api/state', 'session', async () => {
  const { api_token, vapid, ...settings } = allSettings();
  return {
    settings, apiToken: api_token,
    categories: db.prepare('SELECT * FROM categories WHERE archived = 0 ORDER BY sort, id').all(),
    // Category ids ordered by how often they were used recently, so the quick-add grid leads with the usual suspects.
    usage: db.prepare(`SELECT category_id AS id FROM expenses WHERE category_id IS NOT NULL AND date >= date('now','-90 days')
                       GROUP BY category_id ORDER BY COUNT(*) DESC, MAX(id) DESC`).all().map((r) => r.id),
    rate: currentRate(), vapidPublicKey, pushDevices: subscriptionCount(),
    today: localDate(new Date()),
  };
});

route('POST', '/api/token/regenerate', 'session', async () => {
  const t = randomBytes(24).toString('hex');
  setSetting('api_token', t);
  return { apiToken: t };
});

route('PUT', '/api/settings', 'session', async ({ body }) => {
  if (body.base_currency !== undefined) {
    if (!CURRENCIES.includes(body.base_currency)) throw bad('Unsupported base currency');
    if (body.base_currency !== getSetting('base_currency') && db.prepare('SELECT COUNT(*) n FROM expenses').get().n > 0)
      throw bad('Base currency can only be changed while there are no expenses (history is stored in the base currency).');
    setSetting('base_currency', body.base_currency);
  }
  if (body.monthly_budget !== undefined) setSetting('monthly_budget', Math.max(0, num(body.monthly_budget)));
  if (body.rate_override !== undefined) {
    const v = body.rate_override === null || body.rate_override === '' ? null : parseAmount(body.rate_override);
    if (v !== null && !(v >= 0.1 && v <= 1000)) throw bad('Rate must be between 0.1 and 1000 INR per DKK');
    setSetting('rate_override', v);
  }
  for (const k of ['daily_reminder', 'weekly_recap', 'alert_thresholds']) if (body[k] !== undefined) setSetting(k, !!body[k]);
  if (body.reminder_time !== undefined) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.reminder_time)) throw bad('Time must be HH:MM');
    setSetting('reminder_time', body.reminder_time);
  }
  return { ok: true };
});

route('GET', '/api/summary', 'session', async ({ url }) => {
  const month = url.searchParams.get('month') || localDate(new Date()).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) throw bad('month must be YYYY-MM');
  return buildSummary(month, url.searchParams.get('today') && validDate(url.searchParams.get('today')) ? url.searchParams.get('today') : undefined);
});

const monthParam = (url) => {
  const m = url.searchParams.get('month') || localDate(new Date()).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(m)) throw bad('month must be YYYY-MM');
  return m;
};
route('GET', '/api/expenses', 'session', async ({ url }) => {
  const month = monthParam(url);
  return db.prepare(`${expenseSelect} WHERE e.date LIKE ? ORDER BY e.date DESC, e.id DESC`).all(`${month}-%`);
});
route('POST', '/api/expenses', 'session', async ({ body }) => addExpense({ ...body, source: 'app' }));
route('PUT', '/api/expenses/:id', 'session', async ({ body, params }) => {
  const cur = db.prepare('SELECT * FROM expenses WHERE id = ?').get(params.id);
  if (!cur) throw new HttpError(404, 'Not found');
  const base = getSetting('base_currency');
  const amt = parseAmount(body.amount ?? cur.amount);
  if (!(amt > 0)) throw bad('Amount must be a positive number');
  const cur2 = String(body.currency || cur.currency).toUpperCase();
  if (!CURRENCIES.includes(cur2)) throw bad('Unsupported currency');
  const date = body.date || cur.date;
  if (!validDate(date)) throw bad('Date must be YYYY-MM-DD');
  // Keep the originally stored rate when the money part is unchanged; re-convert otherwise.
  const unchanged = amt === cur.amount && cur2 === cur.currency;
  const conv = unchanged ? { amount_base: cur.amount_base, rate: cur.rate } : toBase(amt, cur2, base);
  const catId = body.category_id === undefined ? cur.category_id : (body.category_id === null ? null : resolveCategory(body.category_id));
  db.prepare('UPDATE expenses SET date=?, amount=?, currency=?, amount_base=?, rate=?, category_id=?, note=? WHERE id=?')
    .run(date, amt, cur2, conv.amount_base, conv.rate, catId, String(body.note ?? cur.note).slice(0, 200), cur.id);
  return db.prepare(`${expenseSelect} WHERE e.id = ?`).get(cur.id);
});
route('DELETE', '/api/expenses/:id', 'session', async ({ params }) => {
  db.prepare('DELETE FROM expenses WHERE id = ?').run(params.id);
  return { ok: true };
});

route('POST', '/api/categories', 'session', async ({ body }) => {
  const name = String(body.name || '').trim();
  if (!name) throw bad('Name required');
  const sort = db.prepare('SELECT COALESCE(MAX(sort),0)+1 AS n FROM categories').get().n;
  const info = db.prepare('INSERT INTO categories(name,icon,color,budget,sort) VALUES(?,?,?,?,?)')
    .run(cleanText(name, 40), cleanIcon(body.icon), cleanColor(body.color, '#2a78d6'), Math.max(0, num(body.budget)), sort);
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid);
});
route('PUT', '/api/categories/:id', 'session', async ({ body, params }) => {
  const c = db.prepare('SELECT * FROM categories WHERE id = ?').get(params.id);
  if (!c) throw new HttpError(404, 'Not found');
  db.prepare('UPDATE categories SET name=?, icon=?, color=?, budget=? WHERE id=?').run(
    cleanText(body.name ?? c.name, 40) || c.name, cleanIcon(body.icon ?? c.icon, c.icon),
    cleanColor(body.color ?? c.color, c.color), Math.max(0, num(body.budget, c.budget)), c.id);
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(c.id);
});
route('DELETE', '/api/categories/:id', 'session', async ({ params }) => {
  // Archive instead of delete when expenses reference it, so history stays readable.
  const used = db.prepare('SELECT COUNT(*) n FROM expenses WHERE category_id = ?').get(params.id).n;
  if (used) db.prepare('UPDATE categories SET archived = 1 WHERE id = ?').run(params.id);
  else db.prepare('DELETE FROM categories WHERE id = ?').run(params.id);
  return { ok: true, archived: used > 0 };
});

route('GET', '/api/rates', 'session', async ({ url }) => ({
  current: currentRate(), history: rateHistory(Number(url.searchParams.get('days')) || 30),
}));
route('POST', '/api/rates/refresh', 'session', async () => {
  try { return { current: await refreshRate() }; }
  catch (e) { throw new HttpError(502, `Could not fetch rate: ${e.message}`); }
});

route('POST', '/api/push/subscribe', 'session', async ({ body }) => {
  if (!body?.endpoint || !body?.keys || !isAllowedPushEndpoint(body.endpoint)) throw bad('Invalid or unsupported push subscription');
  saveSubscription(body);
  return { ok: true };
});
route('POST', '/api/push/unsubscribe', 'session', async ({ body }) => { removeSubscription(body.endpoint); return { ok: true }; });
route('POST', '/api/push/test', 'session', async () => {
  const sent = await notify({ title: '✅ Notifications work', body: 'You’ll get budget alerts and reminders here.', tag: 'test' });
  return { sent };
});

route('GET', '/api/export.csv', 'session', async ({ res }) => {
  const rows = db.prepare(`SELECT e.date, e.amount, e.currency, e.amount_base, COALESCE(c.name,'') AS category, e.note
    FROM expenses e LEFT JOIN categories c ON c.id = e.category_id ORDER BY e.date, e.id`).all();
  // Prefix cells that spreadsheets would execute as formulas (=, +, -, @, tab, CR).
  const q = (v) => `"${(/^[=+\-@\t\r]/.test(String(v)) ? "'" : '') + String(v).replace(/"/g, '""')}"`;
  const csv = ['date,amount,currency,amount_base,category,note',
    ...rows.map((r) => [r.date, r.amount, r.currency, r.amount_base.toFixed(2), q(r.category), q(r.note)].join(','))].join('\n');
  res.setHeader('content-disposition', 'attachment; filename="expenses.csv"');
  return { __raw: csv, type: 'text/csv; charset=utf-8' };
});

// ---- income ----
route('GET', '/api/income', 'session', async ({ url }) => {
  const month = monthParam(url);
  return db.prepare('SELECT * FROM income WHERE date LIKE ? ORDER BY date DESC, id DESC').all(`${month}-%`);
});
route('POST', '/api/income', 'session', async ({ body }) => addIncome(body));
route('PUT', '/api/income/:id', 'session', async ({ body, params }) => {
  const cur = db.prepare('SELECT * FROM income WHERE id = ?').get(params.id);
  if (!cur) throw new HttpError(404, 'Not found');
  const m = parseMoneyInput({ amount: body.amount ?? cur.amount, currency: body.currency || cur.currency, date: body.date || cur.date });
  const unchanged = m.amt === cur.amount && m.cur === cur.currency;
  db.prepare('UPDATE income SET date=?, amount=?, currency=?, amount_base=?, rate=?, source=? WHERE id=?')
    .run(m.d, m.amt, m.cur, unchanged ? cur.amount_base : m.amount_base, unchanged ? cur.rate : m.rate, String(body.source ?? cur.source).slice(0, 120), cur.id);
  return db.prepare('SELECT * FROM income WHERE id = ?').get(cur.id);
});
route('DELETE', '/api/income/:id', 'session', async ({ params }) => { db.prepare('DELETE FROM income WHERE id = ?').run(params.id); return { ok: true }; });

// ---- recurring ----
route('GET', '/api/recurring', 'session', async () => db.prepare('SELECT * FROM recurring ORDER BY kind, day, id').all());
const recurringFields = (body, cur = {}) => {
  const kind = body.kind ?? cur.kind ?? 'expense';
  if (!['expense', 'income'].includes(kind)) throw bad('Invalid kind');
  const amount = parseAmount(body.amount ?? cur.amount);
  if (!(amount > 0)) throw bad('Amount must be a positive number');
  const currency = String(body.currency ?? cur.currency ?? getSetting('base_currency')).toUpperCase();
  if (!CURRENCIES.includes(currency)) throw bad('Unsupported currency');
  const day = Math.min(31, Math.max(1, parseInt(body.day ?? cur.day ?? 1, 10) || 1));
  const category_id = body.category_id === undefined ? (cur.category_id ?? null) : resolveCategory(body.category_id);
  return [kind, amount, currency, category_id, String(body.note ?? cur.note ?? '').slice(0, 120), day];
};
route('POST', '/api/recurring', 'session', async ({ body }) => {
  const info = db.prepare('INSERT INTO recurring(kind,amount,currency,category_id,note,day) VALUES(?,?,?,?,?,?)').run(...recurringFields(body));
  await runRecurring();
  return db.prepare('SELECT * FROM recurring WHERE id = ?').get(info.lastInsertRowid);
});
route('PUT', '/api/recurring/:id', 'session', async ({ body, params }) => {
  const cur = db.prepare('SELECT * FROM recurring WHERE id = ?').get(params.id);
  if (!cur) throw new HttpError(404, 'Not found');
  db.prepare('UPDATE recurring SET kind=?, amount=?, currency=?, category_id=?, note=?, day=?, active=? WHERE id=?')
    .run(...recurringFields(body, cur), body.active === undefined ? cur.active : (body.active ? 1 : 0), cur.id);
  return db.prepare('SELECT * FROM recurring WHERE id = ?').get(cur.id);
});
route('DELETE', '/api/recurring/:id', 'session', async ({ params }) => { db.prepare('DELETE FROM recurring WHERE id = ?').run(params.id); return { ok: true }; });

/** Create this month's entry for every recurring item whose day has arrived. Idempotent per month. */
export async function runRecurring(now = new Date()) {
  const todayStr = localDate(now), month = todayStr.slice(0, 7);
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  let made = 0;
  for (const r of db.prepare('SELECT * FROM recurring WHERE active = 1').all()) {
    const day = Math.min(r.day, dim);
    if (now.getDate() < day || r.last_run === month) continue;
    const date = `${month}-${String(day).padStart(2, '0')}`;
    try {
      if (r.kind === 'income') addIncome({ amount: r.amount, currency: r.currency, date, source: r.note });
      else addExpense({ amount: r.amount, currency: r.currency, date, category: r.category_id, note: r.note, source: 'recurring' });
      db.prepare('UPDATE recurring SET last_run = ? WHERE id = ?').run(month, r.id);
      made++;
    } catch (e) { console.warn('[recurring]', e.message); }
  }
  if (made) console.log(`[recurring] created ${made} entr${made > 1 ? 'ies' : 'y'}`);
  return made;
}

// ---- savings goals ----
route('GET', '/api/goals', 'session', async () => db.prepare('SELECT * FROM goals ORDER BY id').all());
route('POST', '/api/goals', 'session', async ({ body }) => {
  const target = parseAmount(body.target);
  if (!String(body.name || '').trim() || !(target > 0)) throw bad('Name and a positive target are required');
  if (body.deadline && !validDate(body.deadline)) throw bad('Deadline must be YYYY-MM-DD');
  const info = db.prepare('INSERT INTO goals(name,icon,target,saved,deadline) VALUES(?,?,?,?,?)')
    .run(cleanText(body.name, 60), cleanIcon(body.icon, '🎯'), target, Math.max(0, parseAmount(body.saved) || 0), body.deadline || null);
  return db.prepare('SELECT * FROM goals WHERE id = ?').get(info.lastInsertRowid);
});
route('POST', '/api/goals/:id/contribute', 'session', async ({ body, params }) => {
  const amt = parseAmount(body.amount);
  if (!Number.isFinite(amt) || amt === 0) throw bad('Enter an amount');
  db.prepare('UPDATE goals SET saved = MAX(0, saved + ?) WHERE id = ?').run(amt, params.id);
  return db.prepare('SELECT * FROM goals WHERE id = ?').get(params.id);
});
route('DELETE', '/api/goals/:id', 'session', async ({ params }) => { db.prepare('DELETE FROM goals WHERE id = ?').run(params.id); return { ok: true }; });

// ---- backup / restore / CSV import ----
route('GET', '/api/backup.json', 'session', async ({ res }) => {
  const dump = { version: 1, exported_at: new Date().toISOString(),
    settings: (({ api_token, vapid, ...rest }) => rest)(allSettings()),
    categories: db.prepare('SELECT * FROM categories').all(), expenses: db.prepare('SELECT * FROM expenses').all(),
    income: db.prepare('SELECT * FROM income').all(), recurring: db.prepare('SELECT * FROM recurring').all(), goals: db.prepare('SELECT * FROM goals').all() };
  res.setHeader('content-disposition', `attachment; filename="budget-backup-${localDate(new Date())}.json"`);
  return { __raw: JSON.stringify(dump, null, 1), type: 'application/json' };
});
route('POST', '/api/restore', 'session', async ({ body }) => {
  if (body?.version !== 1 || !Array.isArray(body.categories) || !Array.isArray(body.expenses)) throw bad('Not a valid backup file');
  const tables = { categories: ['id', 'name', 'icon', 'color', 'budget', 'sort', 'archived'],
    expenses: ['id', 'date', 'amount', 'currency', 'amount_base', 'rate', 'category_id', 'note', 'source', 'created_at'],
    income: ['id', 'date', 'amount', 'currency', 'amount_base', 'rate', 'source', 'created_at'],
    recurring: ['id', 'kind', 'amount', 'currency', 'category_id', 'note', 'day', 'active', 'last_run'],
    goals: ['id', 'name', 'icon', 'target', 'saved', 'deadline'] };
  db.exec('BEGIN');
  try {
    db.exec('PRAGMA foreign_keys = OFF');
    for (const t of ['expenses', 'income', 'recurring', 'goals', 'categories']) db.exec(`DELETE FROM ${t}`);
    for (const t of ['categories', 'expenses', 'income', 'recurring', 'goals']) {
      const cols = tables[t];
      const ins = db.prepare(`INSERT INTO ${t}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`);
      for (const row of body[t] || []) {
        const r = { ...row };
        if (t === 'categories') { r.name = cleanText(r.name, 40) || 'Category'; r.icon = cleanIcon(r.icon); r.color = cleanColor(r.color); }
        if (t === 'goals') { r.name = cleanText(r.name, 60) || 'Goal'; r.icon = cleanIcon(r.icon, '🎯'); }
        if (t === 'expenses' || t === 'income') { if (!validDate(String(r.date))) continue; if (!CURRENCIES.includes(r.currency)) continue; r.note = cleanText(r.note, 200); r.source = cleanText(r.source, 120); }
        ins.run(...cols.map((c) => (typeof r[c] === 'object' ? null : r[c] ?? null)));
      }
    }
    for (const k of ['base_currency', 'monthly_budget', 'daily_reminder', 'reminder_time', 'weekly_recap', 'alert_thresholds', 'rate_override'])
      if (body.settings?.[k] !== undefined) setSetting(k, body.settings[k]);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw bad(`Restore failed: ${e.message}`); }
  finally { db.exec('PRAGMA foreign_keys = ON'); }
  return { ok: true, expenses: body.expenses.length };
});

// Minimal RFC-4180-ish parser (quoted fields, commas, newlines).
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',' || c === ';') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
// Accepts our own export or a bank CSV with date/amount/(currency)/(category)/(text|note|description) headers.
route('POST', '/api/import/csv', 'session', async ({ body }) => {
  const rows = parseCsv(String(body.csv || ''));
  if (rows.length < 2) throw bad('CSV needs a header row and at least one data row');
  if (rows.length > 5001) throw bad('Import at most 5,000 rows at a time');
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => head.findIndex((h) => names.some((n) => h === n || h.includes(n)));
  const iDate = col('date', 'dato'), iAmt = col('amount', 'beløb', 'belob'), iCur = col('currency', 'valuta'),
    iCat = col('category', 'kategori'), iNote = col('note', 'text', 'tekst', 'description', 'merchant');
  if (iDate < 0 || iAmt < 0) throw bad('CSV needs “date” and “amount” columns');
  const rules = Array.isArray(body.rules) ? body.rules : []; // [{contains, category}]
  let added = 0, skipped = 0;
  for (const r of rows.slice(1)) {
    try {
      let amt = parseAmount(r[iAmt]);
      if (!Number.isFinite(amt) || amt === 0) { skipped++; continue; }
      let date = r[iDate].trim();
      const dm = date.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/); // Danish bank format dd.mm.yyyy
      if (dm) date = `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
      const note = iNote >= 0 ? r[iNote].trim() : '';
      const ruleCat = rules.find((x) => x.contains && note.toLowerCase().includes(String(x.contains).toLowerCase()))?.category;
      const category = (iCat >= 0 && r[iCat]?.trim()) || ruleCat || null;
      if (amt < 0) addExpense({ amount: -amt, currency: iCur >= 0 ? r[iCur] : undefined, date, category, note, source: 'import' });
      else if (body.positiveIsIncome) addIncome({ amount: amt, currency: iCur >= 0 ? r[iCur] : undefined, date, source: note });
      else addExpense({ amount: amt, currency: iCur >= 0 ? r[iCur] : undefined, date, category, note, source: 'import' });
      added++;
    } catch { skipped++; }
  }
  return { added, skipped };
});

// ---- iOS Shortcuts endpoints (Bearer token). Responses are plain text-friendly. ----
route('GET', '/api/shortcuts/categories', 'token', async () => ({
  categories: db.prepare('SELECT name FROM categories WHERE archived = 0 ORDER BY sort, id').all().map((c) => c.name),
}));
route('POST', '/api/shortcuts/expense', 'token', async ({ body }) => {
  const e = addExpense({ ...body, source: 'shortcut' });
  const s = buildSummary(monthOf(e.date));
  const cat = s.categories.find((c) => c.id === e.category_id);
  let msg = `Logged ${e.amount} ${e.currency}${e.currency !== s.base ? ` (≈${Math.round(e.amount_base)} ${s.base})` : ''}${cat ? ` in ${cat.name}` : ''}.`;
  if (cat?.budget > 0) msg += ` ${cat.name}: ${Math.round(Math.abs(cat.remaining))} ${s.base} ${cat.remaining >= 0 ? 'left' : 'over'}.`;
  msg += ` ${shortStatus(s)}`;
  return { ok: true, message: msg, id: e.id };
});
route('GET', '/api/shortcuts/summary', 'token', async () => {
  const s = buildSummary(localDate(new Date()).slice(0, 7));
  return { message: shortStatus(s), spent: s.spent, budget: s.budget, remaining: s.remaining, allowance: s.allowance, currency: s.base };
});

// ---------- HTTP server ----------
async function handleApi(req, res, url) {
  const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
  if (!r) throw new HttpError(404, 'Not found');
  // CSRF defence in depth: browsers always send Origin on cross-site writes — it must match the host we were reached on.
  if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin) {
    let oh = ''; try { oh = new URL(req.headers.origin).host.toLowerCase(); } catch { /* invalid */ }
    const hosts = [req.headers.host, TRUST_PROXY && req.headers['x-forwarded-host']].filter(Boolean).map((h) => h.toLowerCase());
    if (!oh || !hosts.includes(oh)) throw new HttpError(403, 'Cross-origin request blocked');
  }
  const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
  if (r.auth === 'session' && !hasSession(req)) throw new HttpError(401, 'Login required');
  if (r.auth === 'token') {
    const ip = clientIp(req);
    if (throttled(ip)) throw new HttpError(429, 'Too many failed attempts');
    if (!hasApiToken(req, body)) { noteFailure(ip); throw new HttpError(401, 'Invalid API token'); }
    clearFailures(ip);
  }
  const params = r.re.exec(url.pathname).groups || {};
  const out = await r.handler({ req, res, url, body, params });
  if (out?.__raw !== undefined) { res.writeHead(200, { 'content-type': out.type, ...(res.getHeader('content-disposition') ? { 'content-disposition': res.getHeader('content-disposition') } : {}) }); return res.end(out.__raw); }
  const headers = {};
  for (const h of ['set-cookie']) if (res.getHeader(h)) headers[h] = res.getHeader(h);
  send(res, 200, out, headers);
}

async function serveStatic(req, res, url) {
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (p === '/' || p === '\\') p = '/index.html';
  const file = join(PUBLIC, p);
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not file');
    const data = await readFile(file);
    const isSw = p === '/sw.js';
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      // Always revalidate app shell so updates arrive; icons can be cached.
      'cache-control': p.startsWith('/icons/') ? 'public, max-age=86400' : 'no-cache',
      ...(isSw ? { 'service-worker-allowed': '/' } : {}),
    });
    res.end(data);
  } catch {
    // SPA fallback
    const data = await readFile(join(PUBLIC, 'index.html'));
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' });
    res.end(data);
  }
}

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  if (isHttps(req)) res.setHeader('strict-transport-security', 'max-age=31536000');
  // Loopback is always allowed: the deploy script's health check and cloudflared's local probes use it.
  const hostName = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
  if (ALLOWED_HOSTS.length && !ALLOWED_HOSTS.includes(hostName) && !['127.0.0.1', 'localhost', '[::1]'].includes(hostName)) {
    res.writeHead(421, { 'content-type': 'text/plain' }); return res.end('Misdirected request');
  }
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else await serveStatic(req, res, url);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) {
      // Don't keep reading an oversized upload: answer, then drop the connection.
      send(res, status, { error: status === 500 ? 'Server error' : e.message }, status === 413 ? { connection: 'close' } : {});
      if (status === 413) res.once('finish', () => req.destroy());
    }
  }
});

server.listen(PORT, HOST, () => {
  if (!PASSWORD) console.warn('\n⚠️  APP_PASSWORD is not set: anyone who can reach this port can read and change your data (and fetch the API token).\n   Set APP_PASSWORD, or keep the port reachable only from trusted networks.\n');
  console.log(`Budget Tracker running on http://${HOST}:${PORT}${PASSWORD ? ' (password protected)' : ' (no APP_PASSWORD set — open on your network)'}`);
  startScheduler(runRecurring);
});
