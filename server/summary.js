import { db, getSetting } from './db.js';
import { localDate } from './rates.js';

const r2 = (n) => Math.round(n * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');

export const monthOf = (dateStr) => dateStr.slice(0, 7);
export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function totalsByCategory(month) {
  return db.prepare(`SELECT category_id AS id, SUM(amount_base) AS spent, COUNT(*) AS n
                     FROM expenses WHERE date LIKE ? GROUP BY category_id`).all(`${month}-%`);
}

export function buildSummary(month, todayStr = localDate(new Date())) {
  const base = getSetting('base_currency');
  const dim = daysInMonth(month);
  const curMonth = monthOf(todayStr);
  const isCurrent = month === curMonth;
  const isFuture = month > curMonth;
  const dayNow = isCurrent ? Number(todayStr.slice(8)) : isFuture ? 0 : dim;
  const daysLeft = isCurrent ? dim - dayNow + 1 : 0; // includes today

  const cats = db.prepare('SELECT * FROM categories WHERE archived = 0 ORDER BY sort, id').all();
  const spentBy = new Map(totalsByCategory(month).map((r) => [r.id, r]));
  const prevBy = new Map(totalsByCategory(shiftMonth(month, -1)).map((r) => [r.id, r]));

  const catRows = cats.map((c) => {
    const spent = spentBy.get(c.id)?.spent || 0;
    const prev = prevBy.get(c.id)?.spent || 0;
    // Fixed one-off items (rent) shouldn't be extrapolated: only project categories with a real purchase habit.
    const habit = (spentBy.get(c.id)?.n || 0) >= 4;
    const projected = isCurrent && dayNow > 0 && habit ? spent + (spent / dayNow) * (dim - dayNow) : spent;
    return {
      id: c.id, name: c.name, icon: c.icon, color: c.color,
      budget: c.budget, spent: r2(spent), prev: r2(prev), count: spentBy.get(c.id)?.n || 0,
      pct: c.budget > 0 ? spent / c.budget : null,
      remaining: c.budget > 0 ? r2(c.budget - spent) : null,
      projected: r2(projected),
    };
  });
  const uncat = spentBy.get(null)?.spent || 0;
  if (uncat > 0) {
    catRows.push({ id: null, name: 'Uncategorised', icon: '❔', color: '#8b8a85', budget: 0, spent: r2(uncat),
      prev: r2(prevBy.get(null)?.spent || 0), count: spentBy.get(null).n, pct: null, remaining: null, projected: r2(uncat) });
  }

  const spent = catRows.reduce((s, c) => s + c.spent, 0);
  const prevSpent = catRows.reduce((s, c) => s + c.prev, 0);
  const allocated = cats.reduce((s, c) => s + c.budget, 0);
  const setBudget = getSetting('monthly_budget');
  const budget = setBudget > 0 ? setBudget : allocated;
  const remaining = budget - spent;
  const projected = catRows.reduce((t, c) => t + c.projected, 0);

  // Daily series: bars = spend that day, line = cumulative, ideal = straight-line budget pace.
  const perDay = new Map(db.prepare(`SELECT date, SUM(amount_base) AS s FROM expenses WHERE date LIKE ? GROUP BY date`)
    .all(`${month}-%`).map((r) => [r.date, r.s]));
  const daily = [];
  let cum = 0;
  for (let d = 1; d <= dim; d++) {
    const key = `${month}-${pad(d)}`;
    const s = perDay.get(key) || 0;
    cum += s;
    daily.push({ day: d, date: key, spent: r2(s), cum: r2(cum), ideal: budget > 0 ? r2((budget * d) / dim) : null,
      future: isCurrent ? d > dayNow : isFuture });
  }

  // Last 6 months for the trend chart.
  const trend = [];
  for (let i = 5; i >= 0; i--) {
    const m = shiftMonth(month, -i);
    const t = db.prepare('SELECT SUM(amount_base) AS s FROM expenses WHERE date LIKE ?').get(`${m}-%`).s || 0;
    trend.push({ month: m, spent: r2(t) });
  }

  const topNotes = db.prepare(`SELECT LOWER(TRIM(note)) AS k, MIN(note) AS name, SUM(amount_base) AS total, COUNT(*) AS n
      FROM expenses WHERE date LIKE ? AND TRIM(note) <> '' GROUP BY k ORDER BY total DESC LIMIT 5`)
    .all(`${month}-%`).map((r) => ({ name: r.name, total: r2(r.total), count: r.n }));

  const incomeTotal = db.prepare('SELECT SUM(amount_base) AS s FROM income WHERE date LIKE ?').get(`${month}-%`).s || 0;
  const spentToday = isCurrent ? (daily[dayNow - 1]?.spent || 0) : 0;
  const noSpendDays = daily.filter((d) => !d.future && d.spent === 0).length;
  const daysElapsed = Math.max(dayNow, isCurrent ? 1 : 0);
  const avgDaily = daysElapsed > 0 ? spent / daysElapsed : 0;
  const allowance = isCurrent && daysLeft > 0 && budget > 0 ? Math.max(0, remaining) / daysLeft : null;
  const idealToDate = budget > 0 && dayNow > 0 ? (budget * dayNow) / dim : null;

  const s = {
    month, base, isCurrent, dim, dayNow, daysLeft,
    budget: r2(budget), allocated: r2(allocated), unallocated: r2(budget - allocated),
    spent: r2(spent), spentToday: r2(spentToday), income: r2(incomeTotal), net: r2(incomeTotal - spent), remaining: r2(remaining), prevSpent: r2(prevSpent),
    projected: r2(projected), allowance: allowance == null ? null : r2(allowance),
    avgDaily: r2(avgDaily), noSpendDays, pace: idealToDate == null ? null : r2(spent - idealToDate),
    categories: catRows, daily, trend, topNotes,
  };
  s.insights = buildInsights(s);
  return s;
}

const fmt = (n, base) => (base === 'INR' ? `₹${Math.round(n).toLocaleString('en-IN')}` : `${Math.round(n).toLocaleString('en-US')} kr`);

function buildInsights(s) {
  const out = [];
  const b = s.base;
  const budgeted = s.categories.filter((c) => c.budget > 0);

  if (s.budget === 0) {
    out.push({ kind: 'info', text: 'Set a monthly budget and category limits — you can’t cut what you haven’t measured.' });
    return out;
  }
  for (const c of budgeted.filter((c) => c.spent > c.budget)) {
    out.push({ kind: 'bad', text: `${c.icon} ${c.name} is over by ${fmt(c.spent - c.budget, b)}.` });
  }
  if (s.isCurrent) {
    for (const c of budgeted.filter((c) => c.spent <= c.budget && c.projected > c.budget * 1.05 && c.count >= 4)) {
      out.push({ kind: 'warn', text: `${c.icon} ${c.name} is on track to hit ${fmt(c.projected, b)} vs a ${fmt(c.budget, b)} limit — ease off by ${fmt((c.projected - c.budget) / Math.max(1, s.daysLeft), b)}/day.` });
    }
    if (s.projected > s.budget) out.push({ kind: 'warn', text: `At today’s pace you’ll finish the month ${fmt(s.projected - s.budget, b)} over budget.` });
    else if (s.dayNow >= 5) out.push({ kind: 'good', text: `On pace to finish about ${fmt(s.budget - s.projected, b)} under budget.` });
  }
  const worst = s.categories.filter((c) => c.prev > 0 && c.spent - c.prev > 0 && s.dayNow >= 10)
    .sort((a, b2) => (b2.spent - b2.prev) - (a.spent - a.prev))[0];
  if (worst && worst.spent > worst.prev * 1.2) {
    out.push({ kind: 'warn', text: `${worst.icon} ${worst.name} is already ${fmt(worst.spent - worst.prev, b)} above last month’s total.` });
  }
  if (s.noSpendDays >= 3) out.push({ kind: 'good', text: `${s.noSpendDays} no-spend days so far — keep stacking them.` });
  if (s.unallocated < 0) out.push({ kind: 'warn', text: `Category limits add up to ${fmt(s.allocated, b)}, ${fmt(-s.unallocated, b)} more than your monthly budget.` });
  return out.slice(0, 5);
}

export function shortStatus(s) {
  const b = s.base;
  let t = `${fmt(s.spent, b)} spent`;
  if (s.budget > 0) t += ` of ${fmt(s.budget, b)} (${fmt(Math.abs(s.remaining), b)} ${s.remaining >= 0 ? 'left' : 'over'})`;
  if (s.allowance != null && s.remaining > 0) t += ` · ${fmt(s.allowance, b)}/day for ${s.daysLeft} days`;
  return t;
}
