import { getSetting, db } from './db.js';
import { ensureFreshRate, backfillHistory, localDate } from './rates.js';
import { sendDailyReminder, sendWeeklyRecap } from './push.js';

const pad = (n) => String(n).padStart(2, '0');

function once(key) {
  return db.prepare('INSERT OR IGNORE INTO notif_log(key) VALUES(?)').run(key).changes > 0;
}

let recurringHook = async () => {};
async function tick() {
  const now = new Date();
  const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const day = localDate(now);

  // Exchange rate: once per calendar day, retried every tick until it succeeds.
  await ensureFreshRate();
  await recurringHook();

  const t = getSetting('reminder_time');
  if (hhmm >= t) {
    if (getSetting('daily_reminder') && once(`daily:${day}`)) await sendDailyReminder();
    if (getSetting('weekly_recap') && now.getDay() === 0 && once(`weekly:${day}`)) await sendWeeklyRecap();
  }
}

export function startScheduler(runRecurring) {
  if (runRecurring) { recurringHook = runRecurring; runRecurring().catch(() => {}); }
  backfillHistory().then(ensureFreshRate).catch(() => {});
  // Every minute is cheap (a couple of SQLite reads) and keeps reminder time accurate.
  setInterval(() => tick().catch((e) => console.warn('[scheduler]', e.message)), 60_000);
  // Housekeeping: drop alert dedupe rows older than ~90 days.
  setInterval(() => db.prepare(`DELETE FROM notif_log WHERE at < datetime('now','-90 days')`).run(), 6 * 3600_000);
}
