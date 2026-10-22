// Fills the database with realistic demo data (for screenshots / trying the UI).
//   DB_PATH=./data/demo.db node scripts/seed-demo.js
import { db, setSetting } from '../server/db.js';
import { localDate, currentRate } from '../server/rates.js';

const rate = currentRate()?.dkk_inr || 14.2;
setSetting('monthly_budget', 14000);
const limits = { Rent: 6500, Groceries: 2400, 'Eating out': 1200, Transport: 600, Subscriptions: 350, Shopping: 900, Education: 400, Health: 300, Travel: 500, Other: 400 };
for (const [name, b] of Object.entries(limits)) db.prepare('UPDATE categories SET budget = ? WHERE name = ?').run(b, name);
const id = (n) => db.prepare('SELECT id FROM categories WHERE name = ?').get(n).id;

db.exec('DELETE FROM expenses; DELETE FROM income; DELETE FROM recurring; DELETE FROM goals;');
const ins = db.prepare('INSERT INTO expenses(date,amount,currency,amount_base,rate,category_id,note,source) VALUES(?,?,?,?,?,?,?,?)');
let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const today = new Date();
for (let back = 75; back >= 0; back--) {
  const d = new Date(today); d.setDate(d.getDate() - back);
  const date = localDate(d), dom = d.getDate();
  const add = (cat, amt, note, cur = 'DKK') => {
    const base = cur === 'INR' ? amt / rate : amt;
    ins.run(date, amt, cur, base, cur === 'INR' ? 1 / rate : 1, id(cat), note, rnd() > 0.8 ? 'shortcut' : 'app');
  };
  if (dom === 1) add('Rent', 6400, 'Rent');
  if (dom === 3) add('Subscriptions', 99, 'Spotify + iCloud');
  if (dom === 12) add('Subscriptions', 129, 'Netflix');
  if (dom === 5) add('Transport', 380, 'Rejsekort top-up');
  if (rnd() < 0.55) add('Groceries', Math.round(40 + rnd() * 180), pick(['Netto', 'Rema 1000', 'Føtex', 'Lidl']));
  if (rnd() < 0.3) add('Eating out', Math.round(45 + rnd() * 140), pick(['Lunch', 'Wolt', 'Coffee', 'Dinner out']));
  if (rnd() < 0.08) add('Shopping', Math.round(150 + rnd() * 450), pick(['H&M', 'Amazon', 'Tiger']));
  if (rnd() < 0.1) add('Travel', Math.round(80 + rnd() * 200), pick(['Train to Aarhus', 'Flixbus', 'Airport transfer']));
  if (rnd() < 0.05) add('Health', Math.round(60 + rnd() * 160), 'Pharmacy');
  if (rnd() < 0.06) add('Other', Math.round(1000 + rnd() * 3000), 'Chai & snacks (India trip)', 'INR');
}
const incIns = db.prepare('INSERT INTO income(date,amount,currency,amount_base,rate,source) VALUES(?,?,?,?,?,?)');
for (let back = 0; back < 3; back++) {
  const d = new Date(today.getFullYear(), today.getMonth() - back, 1);
  const m = localDate(d).slice(0, 7);
  incIns.run(`${m}-01`, 8200, 'DKK', 8200, 1, 'Part-time job');
  incIns.run(`${m}-05`, 6200, 'DKK', 6200, 1, 'SU');
  incIns.run(`${m}-12`, 20000, 'INR', 20000 / rate, 1 / rate, 'Transfer from home');
}
db.prepare("INSERT INTO recurring(kind,amount,currency,category_id,note,day,last_run) VALUES('expense',6400,'DKK',?,'Rent',1,?)").run(id('Rent'), localDate(today).slice(0, 7));
db.prepare("INSERT INTO recurring(kind,amount,currency,category_id,note,day,last_run) VALUES('expense',129,'DKK',?,'Netflix',12,?)").run(id('Subscriptions'), localDate(today).slice(0, 7));
db.prepare('INSERT INTO goals(name,icon,target,saved,deadline) VALUES(?,?,?,?,?)').run('Trip to India', '✈️', 12000, 3200, localDate(new Date(today.getFullYear(), today.getMonth() + 5, 1)));
console.log('Demo data inserted:', db.prepare('SELECT COUNT(*) n FROM expenses').get().n, 'expenses');
