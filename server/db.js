import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const DB_PATH = resolve(process.env.DB_PATH || './data/budget.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'tag',
  color TEXT NOT NULL DEFAULT '#2a78d6',
  budget REAL NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  amount_base REAL NOT NULL,
  rate REAL NOT NULL DEFAULT 1,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'app',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE TABLE IF NOT EXISTS rates (date TEXT PRIMARY KEY, dkk_inr REAL NOT NULL, fetched_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS income (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  amount_base REAL NOT NULL,
  rate REAL NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_income_date ON income(date);
CREATE TABLE IF NOT EXISTS recurring (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'expense',
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',
  day INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  last_run TEXT
);
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'target',
  target REAL NOT NULL,
  saved REAL NOT NULL DEFAULT 0,
  deadline TEXT
);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS notif_log (key TEXT PRIMARY KEY, at TEXT NOT NULL DEFAULT (datetime('now')));
`);

// ---- settings ----
const DEFAULTS = {
  base_currency: 'DKK',
  monthly_budget: 0,
  daily_reminder: true,
  reminder_time: '20:00',
  weekly_recap: true,
  alert_thresholds: true,
  api_token: null,
  rate_override: null,
};

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : DEFAULTS[key];
}
export function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, JSON.stringify(value));
}
export function allSettings() {
  const out = { ...DEFAULTS };
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = JSON.parse(r.value);
  return out;
}

if (!getSetting('api_token')) setSetting('api_token', randomBytes(24).toString('hex'));

// ---- seed categories on first run ----
// Colors follow the validated 8-slot categorical order used by the UI.
if (db.prepare('SELECT COUNT(*) AS n FROM categories').get().n === 0) {
  const seed = [
    ['Rent', 'house', '#2a78d6'],
    ['Groceries', 'shopping-cart', '#eb6834'],
    ['Transport', 'train-front', '#eda100'],
    ['Eating out', 'utensils', '#1baf7a'],
    ['Subscriptions', 'tv', '#e87ba4'],
    ['Shopping', 'shopping-bag', '#008300'],
    ['Health', 'heart-pulse', '#e34948'],
    ['Education', 'graduation-cap', '#6250d6'],
    ['Travel', 'plane', '#7aa7e8'],
    ['Other', 'package', '#8b8a85'],
  ];
  const ins = db.prepare('INSERT INTO categories(name,icon,color,sort) VALUES(?,?,?,?)');
  seed.forEach(([n, i, c], idx) => ins.run(n, i, c, idx));
}

export const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// ---- input sanitisers shared by API and restore ----
/** Category colours end up in style attributes — accept strict #rrggbb only. */
export const cleanColor = (v, fallback = '#8b8a85') => (/^#[0-9a-fA-F]{6}$/.test(String(v)) ? String(v) : fallback);
/**
 * Category and goal icons are stored as slugs ("shopping-cart") that the frontend maps to line icons. Anything else
 * (including the emoji the first version stored) is converted or replaced, so markup can never reach the page.
 */
const ICON_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMOJI_TO_SLUG = {
  '🏠': 'house', '🛒': 'shopping-cart', '🍜': 'utensils', '🚆': 'train-front', '📺': 'tv', '🛍️': 'shopping-bag', '🛍': 'shopping-bag',
  '💊': 'heart-pulse', '📚': 'graduation-cap', '✈️': 'plane', '✈': 'plane', '📦': 'package', '🎯': 'target', '💸': 'tag', '💰': 'banknote',
  '🎟️': 'film', '🎟': 'film',
};
export const cleanIcon = (v, fallback = 'tag') => {
  const raw = String(v ?? '').trim();
  if (raw.length <= 30 && ICON_SLUG.test(raw)) return raw;
  return EMOJI_TO_SLUG[raw] ?? fallback;
};
export const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

// One-time migration of icons stored by the first version of the app (emoji) to slugs.
for (const r of db.prepare('SELECT id, icon FROM categories').all()) {
  const next = cleanIcon(r.icon);
  if (next !== r.icon) db.prepare('UPDATE categories SET icon = ? WHERE id = ?').run(next, r.id);
}
for (const r of db.prepare('SELECT id, icon FROM goals').all()) {
  const next = cleanIcon(r.icon, 'target');
  if (next !== r.icon) db.prepare('UPDATE goals SET icon = ? WHERE id = ?').run(next, r.id);
}
