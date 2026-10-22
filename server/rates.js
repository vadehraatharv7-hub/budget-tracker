import { db, getSetting } from './db.js';

const today = () => localDate(new Date());
export function localDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

// Primary: Frankfurter (ECB reference rates). Fallback: open.er-api.com.
async function fetchLatest() {
  try {
    const j = await getJson('https://api.frankfurter.dev/v1/latest?base=DKK&symbols=INR');
    if (j?.rates?.INR) return { date: j.date, rate: j.rates.INR };
  } catch (e) { console.warn('[rates] frankfurter failed:', e.message); }
  const j = await getJson('https://open.er-api.com/v6/latest/DKK');
  if (j?.rates?.INR) return { date: today(), rate: j.rates.INR };
  throw new Error('no rate source available');
}

export async function refreshRate() {
  const { rate } = await fetchLatest();
  // Key by the day we fetched, so "last updated" is honest even on ECB weekends.
  db.prepare(`INSERT INTO rates(date,dkk_inr,fetched_at) VALUES(?,?,datetime('now'))
              ON CONFLICT(date) DO UPDATE SET dkk_inr=excluded.dkk_inr, fetched_at=excluded.fetched_at`)
    .run(today(), rate);
  console.log(`[rates] 1 DKK = ${rate} INR`);
  return currentRate();
}

export async function backfillHistory(days = 60) {
  const have = db.prepare('SELECT COUNT(*) AS n FROM rates').get().n;
  if (have >= 20) return;
  try {
    const from = localDate(new Date(Date.now() - days * 864e5));
    const j = await getJson(`https://api.frankfurter.dev/v1/${from}..?base=DKK&symbols=INR`);
    const ins = db.prepare(`INSERT OR IGNORE INTO rates(date,dkk_inr,fetched_at) VALUES(?,?,datetime('now'))`);
    for (const [d, r] of Object.entries(j.rates || {})) ins.run(d, r.INR);
  } catch (e) { console.warn('[rates] history backfill failed:', e.message); }
}

export function currentRate() {
  const ov = getSetting('rate_override');
  if (ov > 0) return { dkk_inr: ov, date: today(), fetched_at: null, override: true };
  const row = db.prepare('SELECT date, dkk_inr, fetched_at FROM rates ORDER BY date DESC LIMIT 1').get();
  return row ? { dkk_inr: row.dkk_inr, date: row.date, fetched_at: row.fetched_at } : null;
}

export function rateHistory(days = 30) {
  return db.prepare('SELECT date, dkk_inr FROM rates ORDER BY date DESC LIMIT ?').all(days).reverse();
}

/** Convert `amount` of `from` into `base` using the latest stored rate. */
export function toBase(amount, from, base) {
  if (from === base) return { amount_base: amount, rate: 1 };
  const r = currentRate();
  if (!r) throw new Error('No exchange rate available yet — check internet access and try again.');
  // dkk_inr = INR per 1 DKK
  if (from === 'INR' && base === 'DKK') return { amount_base: amount / r.dkk_inr, rate: 1 / r.dkk_inr };
  if (from === 'DKK' && base === 'INR') return { amount_base: amount * r.dkk_inr, rate: r.dkk_inr };
  throw new Error(`Unsupported currency pair ${from}/${base}`);
}

/** Ensure we have a rate from today; called at start-up and hourly. */
let lastAttempt = 0;
export async function ensureFreshRate() {
  const cur = currentRate();
  if (cur && cur.date === today()) return cur;
  if (Date.now() - lastAttempt < 15 * 60_000) return cur; // don't hammer the API while offline
  lastAttempt = Date.now();
  try { return await refreshRate(); }
  catch (e) { console.warn('[rates] refresh failed, keeping last known rate:', e.message); return cur; }
}
