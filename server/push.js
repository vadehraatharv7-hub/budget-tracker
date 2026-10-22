import webpush from 'web-push';
import { db, getSetting, setSetting } from './db.js';
import { buildSummary, shortStatus } from './summary.js';
import { localDate } from './rates.js';

let keys = getSetting('vapid');
if (!keys) {
  keys = webpush.generateVAPIDKeys();
  setSetting('vapid', keys);
}
// Apple's push service rejects malformed subjects; use a real-looking mailto.
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:budget@example.com', keys.publicKey, keys.privateKey);

export const vapidPublicKey = keys.publicKey;

// Only real browser push services — otherwise a subscription is an SSRF primitive into your LAN.
const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/, /(^|\.)push\.microsoft\.com$/, /(^|\.)android\.googleapis\.com$/];
export function isAllowedPushEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && !u.port && !u.username && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch { return false; }
}

export function saveSubscription(sub) {
  if (!isAllowedPushEndpoint(sub.endpoint)) throw Object.assign(new Error('Unsupported push service'), { status: 400 });
  db.prepare('INSERT INTO push_subs(endpoint,data) VALUES(?,?) ON CONFLICT(endpoint) DO UPDATE SET data=excluded.data')
    .run(sub.endpoint, JSON.stringify(sub));
}
export function removeSubscription(endpoint) {
  db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint);
}
export const subscriptionCount = () => db.prepare('SELECT COUNT(*) AS n FROM push_subs').get().n;

export async function notify({ title, body, tag, url = '/' }) {
  const subs = db.prepare('SELECT endpoint, data FROM push_subs').all().filter((s) => isAllowedPushEndpoint(s.endpoint));
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(JSON.parse(s.data), JSON.stringify({ title, body, tag, url }), { TTL: 3600 });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) removeSubscription(s.endpoint);
      else console.warn('[push] send failed:', e.statusCode || e.message);
    }
  }));
  return sent;
}

// Fire each alert key once (e.g. "cat:3:2026-10:100").
function once(key) {
  const r = db.prepare('INSERT OR IGNORE INTO notif_log(key) VALUES(?)').run(key);
  return r.changes > 0;
}

/** Called after an expense is logged: warn when a category or the whole budget crosses 80% / 100%. */
export async function checkThresholds(month) {
  if (!getSetting('alert_thresholds')) return;
  const s = buildSummary(month);
  const b = s.base;
  const fmt = (n) => `${Math.round(n).toLocaleString('en-US')} ${b}`;
  for (const c of s.categories) {
    if (!c.budget || c.pct == null) continue;
    const level = c.pct >= 1 ? 100 : c.pct >= 0.75 ? 75 : 0;
    for (const l of [75, 100]) {
      if (level >= l && once(`cat:${c.id}:${month}:${l}`)) {
        await notify({
          title: l === 100 ? `${c.icon} ${c.name} budget used up` : `${c.icon} ${c.name} at 75%`,
          body: l === 100 ? `You’ve spent ${fmt(c.spent)} of ${fmt(c.budget)} — ${fmt(c.spent - c.budget)} over.`
                          : `${fmt(c.remaining)} left of ${fmt(c.budget)} for the rest of the month.`,
          tag: `cat-${c.id}`,
        });
      }
    }
  }
  if (s.budget > 0) {
    const pct = s.spent / s.budget;
    for (const l of [75, 100]) {
      if (pct >= l / 100 && once(`total:${month}:${l}`)) {
        await notify({
          title: l === 100 ? '🚨 Monthly budget exceeded' : '⚠️ 75% of monthly budget used',
          body: shortStatus(s), tag: 'total',
        });
      }
    }
  }
}

export async function sendDailyReminder() {
  const todayStr = localDate(new Date());
  const s = buildSummary(todayStr.slice(0, 7), todayStr);
  const spentToday = s.daily[s.dayNow - 1]?.spent || 0;
  const b = s.base;
  const body = spentToday === 0
    ? `Nothing logged today yet.${s.allowance != null ? ` You can spend about ${Math.round(s.allowance)} ${b} a day to stay on budget.` : ''}`
    : `${Math.round(spentToday)} ${b} logged today. ${shortStatus(s)}`;
  return notify({ title: '💰 Log today’s spending', body, tag: 'daily' });
}

export async function sendWeeklyRecap() {
  const todayStr = localDate(new Date());
  const s = buildSummary(todayStr.slice(0, 7), todayStr);
  const top = [...s.categories].sort((a, b) => b.spent - a.spent)[0];
  const tip = s.insights.find((i) => i.kind === 'warn' || i.kind === 'bad');
  return notify({
    title: '📊 Your week in money',
    body: `${shortStatus(s)}${top && top.spent > 0 ? ` Biggest: ${top.icon} ${top.name}.` : ''}${tip ? ` ${tip.text}` : ''}`,
    tag: 'weekly',
  });
}
