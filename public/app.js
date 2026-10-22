import * as lock from './lock.js';
import { esc, ring, donut, paceChart, dailyBars, trendBars, sparkline } from './charts.js';

// ───────────────────────── state ─────────────────────────
const $ = (s, el = document) => el.querySelector(s);
const state = {
  settings: null, categories: [], rate: null, apiToken: '', vapidPublicKey: '', today: '', pushDevices: 0,
  month: '', view: 'home', summary: null, expenses: [], filterCat: 'all', search: '', loaded: false, loadedAt: 0,
  usage: [], incomes: [], recurring: [], goals: [], filterCur: 'all', rates: null, convFrom: 'DKK', convAmount: '1000',
};
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948', '#8b8a85'];
const VIEWS = {
  home: { label: 'Home', icon: '<path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>' },
  activity: { label: 'Activity', icon: '<path d="M5 6h14M5 12h14M5 18h9"/>' },
  budget: { label: 'Budget', icon: '<circle cx="12" cy="12" r="9"/><path d="M12 3v9l6.4 6.4"/>' },
  convert: { label: 'Convert', icon: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>' },
  settings: { label: 'Settings', icon: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>' },
};

// ───────────────────────── helpers ─────────────────────────
const ls = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const pad = (n) => String(n).padStart(2, '0');
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const monthNow = () => localToday().slice(0, 7);
const shiftMonth = (m, d) => { const [y, mo] = m.split('-').map(Number); const dt = new Date(y, mo - 1 + d, 1); return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`; };
const monthName = (m, long = false) => new Date(+m.slice(0, 4), +m.slice(5) - 1, 1).toLocaleDateString('en', long ? { month: 'long', year: 'numeric' } : { month: 'short' });

function money(n, cur = state.settings?.base_currency || 'DKK', dec) {
  const v = Number(n) || 0;
  const d = dec ?? (Math.abs(v) >= 1000 || Number.isInteger(v) ? 0 : 2);
  if (cur === 'INR') return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
  return `${v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })} kr`;
}
const base = () => state.settings.base_currency;
const catById = (id) => state.categories.find((c) => c.id === id);
const tint = (color, pct = 16) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2800);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 && !path.startsWith('/api/login')) { showLogin(); throw new Error('Login required'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; throw e; }
  return data;
}

// ───────────────────────── offline queue ─────────────────────────
const queue = { get: () => ls.get('bt_queue', []), set: (q) => ls.set('bt_queue', q) };
async function flushQueue() {
  const q = queue.get();
  if (!q.length) return;
  const left = [];
  for (const item of q) {
    try { await api('/api/expenses', { method: 'POST', body: item }); }
    catch (e) { if (e.status && e.status < 500) continue; /* rejected: drop */ left.push(item); }
  }
  queue.set(left);
  if (left.length < q.length) { toast(`Synced ${q.length - left.length} offline expense${q.length - left.length > 1 ? 's' : ''}`); await load(); }
  updateBanner();
}
function updateBanner() {
  const n = queue.get().length, b = $('#banner');
  b.hidden = !n;
  b.textContent = n ? `${n} expense${n > 1 ? 's' : ''} saved on this device — will sync when the server is reachable.` : '';
}

// ───────────────────────── data loading ─────────────────────────
async function bootstrap() {
  const st = await api('/api/state');
  Object.assign(state, { settings: st.settings, categories: st.categories, rate: st.rate, apiToken: st.apiToken, vapidPublicKey: st.vapidPublicKey, pushDevices: st.pushDevices, today: st.today, usage: st.usage });
}
async function load() {
  const m = state.month;
  const [summary, expenses, incomes] = await Promise.all([
    api(`/api/summary?month=${m}&today=${localToday()}`), api(`/api/expenses?month=${m}`), api(`/api/income?month=${m}`),
  ]);
  if (m !== state.month) return; // user navigated away mid-flight
  Object.assign(state, { summary, expenses, incomes, loaded: true, loadedAt: Date.now() });
  render();
}

// ───────────────────────── routing & shell ─────────────────────────
const icon = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;

function renderNav() {
  const item = (k) => `<button class="tab" data-nav="${k}" ${state.view === k ? 'aria-current="page"' : ''}>${icon(VIEWS[k].icon)}<span>${VIEWS[k].label}</span></button>`;
  $('#sidenav').innerHTML = ['home', 'activity', 'budget', 'convert', 'settings'].map(item).join('');
  $('#tabbar').innerHTML = `${item('home')}${item('activity')}<span class="spacer"></span>${item('budget')}${item('convert')}`;
}

function navigate(view) {
  state.view = view;
  if (location.hash !== `#/${view}`) history.replaceState(null, '', `#/${view}`);
  render();
  window.scrollTo({ top: 0 });
  if (view === 'convert') loadRates();
  if (view === 'budget') loadBudgetExtras();
}

async function loadBudgetExtras() {
  try {
    [state.recurring, state.goals] = await Promise.all([api('/api/recurring'), api('/api/goals')]);
    if (state.view === 'budget') render();
  } catch { /* offline */ }
}

// Defence in depth: never let server-provided colours/icons reach innerHTML unchecked.
const safeColor = (c) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : '#8b8a85');
const safeIcon = (i) => String(i ?? '').replace(/[<>&"'`\\]/g, '');
function sanitizeState() {
  const fix = (c) => { c.color = safeColor(c.color); c.icon = safeIcon(c.icon); };
  state.categories.forEach(fix);
  state.summary?.categories.forEach(fix);
}

function render() {
  if (!state.settings) return;
  sanitizeState();
  renderNav();
  const v = state.view;
  const monthViews = ['home', 'activity'];
  $('#monthlabel').textContent = v === 'convert' ? 'Convert' : v === 'settings' ? 'Settings' : monthName(state.month, true);
  if (v === 'convert' || v === 'settings') $('#monthbar').querySelectorAll('.icon-btn').forEach((b) => (b.style.visibility = 'hidden'));
  else $('#monthbar').querySelectorAll('.icon-btn').forEach((b) => (b.style.visibility = 'visible'));
  $('#monthbar').querySelector('[data-action="next-month"]').style.visibility = (v === 'convert' || v === 'settings' || state.month >= monthNow()) ? 'hidden' : 'visible';

  const el = $('#view');
  if (!state.loaded && monthViews.includes(v)) { el.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>'; return; }
  el.innerHTML = { home: viewHome, activity: viewActivity, budget: viewBudget, convert: viewConvert, settings: viewSettings }[v]();
  // animate rings and bars from zero
  requestAnimationFrame(() => {
    el.querySelectorAll('.arc').forEach((a) => { a.style.strokeDashoffset = a.dataset.final; });
    el.querySelectorAll('.bar > i').forEach((i) => { i.style.width = i.dataset.w; });
  });
  if (v === 'convert') bindConvert();
  updateBanner();
}

// ───────────────────────── HOME ─────────────────────────
function viewHome() {
  const s = state.summary, b = s.base;
  const m = (n, d) => money(n, b, d);
  const hasBudget = s.budget > 0;
  const over = s.remaining < 0;

  let paceChip = '';
  if (hasBudget && s.isCurrent && s.pace != null) {
    paceChip = s.pace <= 0 ? `<span class="chip good">✓ ${m(-s.pace)} under pace</span>` : `<span class="chip ${s.projected > s.budget ? 'bad' : 'warn'}">▲ ${m(s.pace)} over pace</span>`;
  }

  const hero = !hasBudget ? `
    <div class="card"><div class="empty"><div class="big">🎯</div><h2>Set your monthly budget</h2>
      <p>Give every krone a job. Set a total and split it across categories — that’s how you spend less.</p>
      <button class="btn primary" data-nav="budget">Set up budget</button></div>
      ${s.spent > 0 ? `<p class="center muted" style="text-align:center">Spent so far: <b>${m(s.spent)}</b></p>` : ''}</div>` : `
    <div class="card hero">
      ${ring({ spent: s.spent, budget: s.budget, center: m(Math.abs(s.remaining)), sub: over ? 'over budget' : 'left' })}
      <div class="kpis">
        <div class="row between"><div class="kpi"><div class="label">Spent</div><div class="value big">${m(s.spent)}</div></div></div>
        <div class="kpi"><div class="label">of budget</div><div class="value">${m(s.budget)}</div></div>
        ${s.isCurrent && s.allowance != null ? `<div class="kpi"><div class="label">Safe to spend / day</div><div class="value">${over ? m(0) : m(s.allowance)}</div></div>` : ''}
        ${s.isCurrent ? `<div class="kpi"><div class="label">Spent today</div><div class="value">${m(s.spentToday)}</div></div>` : ''}
        <div>${paceChip}</div>
      </div>
    </div>`;

  const flow = (s.income > 0 || s.spent > 0) ? `
    <div class="card"><h2>Cash flow <span class="small">${s.income > 0 ? `${Math.max(0, Math.round((s.net / s.income) * 100))}% of income kept` : 'log income to see your net'}</span></h2>
      <div class="flow"><div><div class="kpi"><div class="label">Income</div></div><div class="v pos">${m(s.income)}</div></div>
        <div><div class="kpi"><div class="label">Spent</div></div><div class="v">${m(s.spent)}</div></div>
        <div><div class="kpi"><div class="label">Net</div></div><div class="v ${s.net >= 0 ? 'pos' : 'neg'}">${s.net >= 0 ? '+' : '−'}${m(Math.abs(s.net))}</div></div></div>
    </div>` : '';

  const ios = isIOS && !isStandalone && !ls.get('bt_hide_ios', false) ? `
    <div class="card"><h2>Install on your iPhone</h2>
      <ol class="steps" style="margin-top:0"><li>Open this page in <b>Safari</b>, tap <b>Share</b> ⎙</li><li>Choose <b>Add to Home Screen</b></li><li>Open Budget from the home screen — notifications work from there.</li></ol>
      <button class="btn small" data-action="hide-ios" style="margin-top:10px">Got it</button></div>` : '';

  const insights = s.insights.length ? `
    <div class="card"><h2>Ways to spend less</h2>
      ${s.insights.map((i) => `<div class="insight"><span class="dot ${i.kind}" aria-hidden="true">${{ good: '✓', warn: '!', bad: '✕', info: 'i' }[i.kind]}</span><span>${esc(i.text)}</span></div>`).join('')}
    </div>` : '';

  const cats = s.categories.filter((c) => c.budget > 0 || c.spent > 0)
    .sort((a, c) => (c.pct ?? c.spent / 1e9) - (a.pct ?? a.spent / 1e9));
  const catList = cats.length ? `
    <div class="card"><h2>Categories <span class="small">${hasBudget ? 'spent vs limit' : 'spent'}</span></h2>
      ${cats.map((c) => catRow(c, m)).join('')}
    </div>` : '';

  const donutItems = s.categories.filter((c) => c.spent > 0).sort((a, c) => c.spent - a.spent).map((c) => ({ name: c.name, color: c.color, value: c.spent, label: m(c.spent), icon: c.icon }));
  const split = s.spent > 0 ? `
    <div class="card"><h2>Where it went</h2>
      <div class="donut-wrap">${donut(donutItems, { centerTop: m(s.spent), centerBottom: 'spent' })}
        <div class="donut-list">${donutItems.slice(0, 8).map((i) => `<div><span><i style="background:${i.color}"></i>${i.icon} ${esc(i.name)}</span><b>${Math.round((i.value / s.spent) * 100)}%</b></div>`).join('')}</div></div>
    </div>` : '';

  const pace = s.spent > 0 || hasBudget ? `
    <div class="card"><h2>Budget pace <span class="small">${s.avgDaily ? `avg ${m(s.avgDaily)}/day` : ''}</span></h2>
      ${paceChart(s.daily, s.budget, m)}
      <h2 style="margin-top:18px">Daily spending <span class="small">${s.noSpendDays} no-spend day${s.noSpendDays === 1 ? '' : 's'}</span></h2>
      ${dailyBars(s.daily, m)}
      <details><summary class="small" style="color:var(--accent)">View as table</summary>${dailyTable(s, m)}</details>
    </div>` : '';

  const trend = s.trend.some((t) => t.spent > 0) ? `
    <div class="card"><h2>Last 6 months ${s.prevSpent > 0 ? `<span class="small">vs last month ${s.spent <= s.prevSpent ? '▼' : '▲'} ${m(Math.abs(s.spent - s.prevSpent))}</span>` : ''}</h2>
      ${trendBars(s.trend, m, monthName)}
    </div>` : '';

  const spots = s.topNotes.length ? `
    <div class="card"><h2>Top spending spots</h2>
      ${s.topNotes.map((n) => `<div class="row between" style="padding:7px 0"><span>${esc(n.name)} <span class="faint small">×${n.count}</span></span><b>${m(n.total)}</b></div>`).join('')}
    </div>` : '';

  const empty = s.spent === 0 && hasBudget ? `<div class="card"><div class="empty"><div class="big">🧾</div><p>No expenses yet this month. Tap <b>＋</b> to add your first one.</p></div></div>` : '';

  return `${ios}${hero}${empty}${flow}<div class="grid-2"><div>${insights}${catList}</div><div>${split}${pace}${trend}${spots}</div></div>`;
}

function catRow(c, m) {
  const hasLimit = c.budget > 0;
  const pct = hasLimit ? c.spent / c.budget : 0;
  const color = !hasLimit ? c.color : pct >= 1 ? 'var(--bad)' : pct >= 0.75 ? 'var(--warn)' : 'var(--good)';
  return `<button class="cat" data-action="filter-cat" data-id="${c.id ?? 'none'}">
    <div class="head"><span class="name"><span class="ico" style="background:${tint(c.color)}">${c.icon}</span>${esc(c.name)}</span>
      <span class="amt"><b>${m(c.spent)}</b>${hasLimit ? `<span class="faint"> / ${m(c.budget)}</span>` : ''}</span></div>
    ${hasLimit ? `<div class="bar"><i class="${pct > 1 ? 'over' : ''}" data-w="${Math.min(100, pct * 100)}%" style="width:0;background:${color}"></i></div>
    <div class="sub"><span>${Math.round(pct * 100)}% used</span><span style="${c.remaining < 0 ? 'color:var(--bad);font-weight:650' : ''}">${c.remaining >= 0 ? `${m(c.remaining)} left` : `${m(-c.remaining)} over`}</span></div>` : ''}
  </button>`;
}

function dailyTable(s, m) {
  const rows = s.daily.filter((d) => d.spent > 0);
  if (!rows.length) return '<p class="muted small">No spending yet.</p>';
  return `<table class="data"><thead><tr><th>Date</th><th>Spent</th><th>Total</th></tr></thead><tbody>${rows.map((d) => `<tr><td>${d.date.slice(5)}</td><td>${m(d.spent)}</td><td>${m(d.cum)}</td></tr>`).join('')}</tbody></table>`;
}

// ───────────────────────── ACTIVITY ─────────────────────────
function dayLabel(d) {
  const t = localToday(), y = new Date(); y.setDate(y.getDate() - 1);
  if (d === t) return 'Today';
  if (d === `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`) return 'Yesterday';
  return new Date(d + 'T12:00').toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' });
}

function viewActivity() {
  const q = state.search.trim().toLowerCase();
  let rows = state.expenses;
  if (state.filterCat !== 'all') rows = rows.filter((e) => String(e.category_id ?? 'none') === String(state.filterCat));
  if (q) rows = rows.filter((e) => (e.note + (catById(e.category_id)?.name || '')).toLowerCase().includes(q));
  if (state.filterCur !== 'all') rows = rows.filter((e) => e.currency === state.filterCur);
  let incomes = state.filterCat === 'all' ? state.incomes.filter((i) => (state.filterCur === 'all' || i.currency === state.filterCur) && (!q || i.source.toLowerCase().includes(q))) : [];
  const used = new Set(state.expenses.map((e) => e.category_id ?? 'none'));
  const filters = `<div class="filters"><button data-action="filter-cat" data-id="all" aria-pressed="${state.filterCat === 'all'}">All</button>
    ${state.categories.filter((c) => used.has(c.id)).map((c) => `<button data-action="filter-cat" data-id="${c.id}" aria-pressed="${String(state.filterCat) === String(c.id)}">${c.icon} ${esc(c.name)}</button>`).join('')}
    <span class="sep"></span>${['DKK', 'INR'].map((c) => `<button data-action="filter-cur" data-id="${c}" aria-pressed="${state.filterCur === c}">${c}</button>`).join('')}</div>`;
  const total = rows.reduce((s, e) => s + e.amount_base, 0);

  const byDay = new Map();
  const slot = (d) => { if (!byDay.has(d)) byDay.set(d, []); return byDay.get(d); };
  for (const e of rows) slot(e.date).push({ ...e, kind: 'expense' });
  for (const i of incomes) slot(i.date).push({ ...i, kind: 'income' });
  const list = [...byDay].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([d, es]) => `
    <div class="day-head"><span>${dayLabel(d)}</span><span>${money(es.filter((e) => e.kind === 'expense').reduce((s, e) => s + e.amount_base, 0))}</span></div>
    ${es.map((e) => (e.kind === 'income' ? incomeRow(e) : txRow(e))).join('')}`).join('');

  return `<div class="search"><input type="search" id="search" placeholder="Search notes or categories" value="${esc(state.search)}" aria-label="Search expenses"></div>
    ${filters}
    ${rows.length || incomes.length ? `<p class="muted small" style="margin:0 4px">${rows.length} expense${rows.length === 1 ? '' : 's'} · ${money(total)}${incomes.length ? ` · ${incomes.length} income` : ''}</p>${list}` :
      `<div class="empty"><div class="big">🧾</div><p>${state.expenses.length ? 'Nothing matches.' : 'No expenses this month yet.'}</p></div>`}
    <p style="text-align:center;margin-top:18px"><a class="small" href="/api/export.csv" style="color:var(--accent)">Export all as CSV</a></p>`;
}

function incomeRow(i) {
  const foreign = i.currency !== base();
  return `<button class="tx" data-action="edit-income" data-id="${i.id}">
    <span class="ico" style="background:var(--good-soft)">💰</span>
    <span class="mid"><div class="title">${esc(i.source || 'Income')}</div><div class="muted small">Income</div></span>
    <span class="right in">+${money(i.amount_base)}${foreign ? `<small>${money(i.amount, i.currency)}</small>` : ''}</span></button>`;
}

function txRow(e) {
  const c = catById(e.category_id);
  const foreign = e.currency !== base();
  return `<button class="tx" data-action="edit" data-id="${e.id}">
    <span class="ico" style="background:${tint(c?.color || '#8b8a85')}">${c?.icon || '❔'}</span>
    <span class="mid"><div class="title">${esc(e.note || c?.name || 'Expense')}</div><div class="muted small">${esc(c?.name || 'Uncategorised')}${e.source === 'shortcut' ? ' · ⚡︎ Shortcut' : ''}</div></span>
    <span class="right">${money(e.amount_base)}${foreign ? `<small>${money(e.amount, e.currency)}</small>` : ''}</span></button>`;
}

// ───────────────────────── BUDGET ─────────────────────────
function viewBudget() {
  const s = state.summary, b = base();
  const alloc = state.categories.reduce((t, c) => t + c.budget, 0);
  const total = state.settings.monthly_budget;
  const target = total > 0 ? total : alloc;
  const left = target - alloc;
  const bars = state.categories.filter((c) => c.budget > 0).map((c) => `<i style="width:${Math.min(100, (c.budget / Math.max(target, alloc, 1)) * 100)}%;background:${c.color}" data-tip="${esc(`${c.name}\n${money(c.budget)}`)}"></i>`).join('');
  return `<div class="card"><h2>Monthly budget</h2>
      <label class="field">Total you want to spend each month (${b})<input id="total-budget" inputmode="decimal" value="${total || ''}" placeholder="e.g. 15000"></label>
      <div class="alloc" style="margin-top:14px">${bars}</div>
      <p class="small ${left < 0 ? '' : 'muted'}" style="margin:8px 0 0;${left < 0 ? 'color:var(--bad);font-weight:600' : ''}">
        ${alloc === 0 ? 'Now split it across categories below.' : left >= 0 ? `${money(alloc)} assigned · ${money(left)} unassigned` : `${money(alloc)} assigned — ${money(-left)} more than your total`}</p>
    </div>
    <div class="card"><h2>Category limits <span class="small">per month</span></h2>
      ${state.categories.map((c) => `
      <div class="cat-edit" data-cid="${c.id}">
        <input class="emoji" data-f="icon" value="${esc(c.icon)}" aria-label="Icon for ${esc(c.name)}" maxlength="4">
        <input data-f="name" value="${esc(c.name)}" aria-label="Category name">
        <input data-f="budget" inputmode="decimal" value="${c.budget || ''}" placeholder="0" aria-label="Monthly limit for ${esc(c.name)}">
      </div>
      <div class="row" style="gap:6px;margin:-2px 0 6px 52px;flex-wrap:wrap" data-cid="${c.id}">
        ${PALETTE.map((col) => `<button class="swatch" data-action="set-color" data-id="${c.id}" data-color="${col}" aria-label="Colour ${col}" aria-pressed="${c.color === col}" style="width:20px;height:20px;border-radius:50%;border:2px solid ${c.color === col ? 'var(--text)' : 'transparent'};background:${col};padding:0"></button>`).join('')}
        <button class="btn small danger" data-action="del-cat" data-id="${c.id}" style="margin-left:auto;padding:3px 10px">Remove</button>
      </div>`).join('')}
      <button class="btn block" data-action="add-cat" style="margin-top:12px">＋ New category</button>
    </div>
    <div class="card"><h2>Recurring <span class="small">auto-added each month</span></h2>
      ${state.recurring.length ? state.recurring.map((r) => { const c = catById(r.category_id); return `<div class="mini-row"><span class="ico">${r.kind === 'income' ? '💰' : (c?.icon || '🔁')}</span>
        <span class="mid"><div class="title" style="font-weight:600">${esc(r.note || c?.name || 'Recurring')}${r.active ? '' : ' <span class="faint small">(paused)</span>'}</div><div class="muted small">${r.kind === 'income' ? 'Income' : esc(c?.name || 'Uncategorised')} · day ${r.day} · ${money(r.amount, r.currency)}</div></span>
        <button class="btn small" data-action="toggle-rec" data-id="${r.id}">${r.active ? 'Pause' : 'Resume'}</button><button class="btn small danger" data-action="del-rec" data-id="${r.id}" aria-label="Remove">✕</button></div>`; }).join('') : '<p class="muted small" style="margin-top:0">Rent, phone plan, Spotify, a monthly transfer from home… define them once.</p>'}
      <button class="btn block" data-action="add-rec" style="margin-top:12px">＋ Add recurring</button>
    </div>
    <div class="card"><h2>Savings goals</h2>
      ${state.goals.length ? state.goals.map(goalRow).join('') : '<p class="muted small" style="margin-top:0">Set a target and a deadline — we’ll tell you what to put aside each month.</p>'}
      <button class="btn block" data-action="add-goal" style="margin-top:12px">＋ New goal</button>
    </div>
    <div class="card"><h2>Tips to cut spending</h2>
      <div class="insight"><span class="dot info">1</span><span>Fund essentials first (housing, groceries), then set <b>tighter</b> limits on eating out, shopping and subscriptions.</span></div>
      <div class="insight"><span class="dot info">2</span><span>Aim for each category to land 10% below last month — the Home screen shows you the pace daily.</span></div>
      <div class="insight"><span class="dot info">3</span><span>Turn on budget alerts in Settings so you hear about overspending at 80%, not at 120%.</span></div>
    </div>`;
}

function goalRow(g) {
  const pct = Math.min(1, g.saved / g.target), left = Math.max(0, g.target - g.saved);
  let need = '';
  if (left <= 0) need = '🎉 Goal reached';
  else if (g.deadline) {
    const months = Math.max(1, Math.ceil((new Date(g.deadline + 'T12:00') - new Date()) / (30.4 * 864e5)));
    need = `Save ${money(left / months)} / month for ${months} month${months > 1 ? 's' : ''}`;
  }
  return `<div class="cat" style="cursor:default"><div class="head"><span class="name"><span class="ico" style="background:var(--accent-soft)">${esc(g.icon)}</span>${esc(g.name)}</span>
    <span class="amt"><b>${money(g.saved)}</b><span class="faint"> / ${money(g.target)}</span></span></div>
    <div class="bar"><i data-w="${pct * 100}%" style="width:0;background:var(--accent)"></i></div>
    <div class="sub"><span>${esc(need)}</span><span><button class="btn small" data-action="goal-add" data-id="${g.id}">＋ Add</button> <button class="btn small danger" data-action="goal-del" data-id="${g.id}" aria-label="Remove goal">✕</button></span></div></div>`;
}

// ───────────────────────── CONVERT ─────────────────────────
async function loadRates() {
  try { state.rates = await api('/api/rates?days=30'); state.rate = state.rates.current; if (state.view === 'convert') render(); }
  catch { /* offline: keep what we have */ }
}

function viewConvert() {
  const r = state.rate;
  if (!r) return `<div class="card"><div class="empty"><div class="big">🌐</div><p>No exchange rate yet. The server needs internet access once to fetch it.</p>
    <button class="btn primary" data-action="refresh-rate">Fetch now</button></div></div>`;
  const hist = (state.rates?.history || []).map((h) => ({ date: h.date, v: h.dkk_inr }));
  const first = hist[0], change = first ? ((r.dkk_inr - first.v) / first.v) * 100 : null;
  const to = state.convFrom === 'DKK' ? 'INR' : 'DKK';
  return `<div class="card">
      <div class="conv-box"><div class="cur">${state.convFrom === 'DKK' ? '🇩🇰 DKK' : '🇮🇳 INR'}</div><input id="conv-in" inputmode="decimal" value="${esc(state.convAmount)}" aria-label="Amount to convert"></div>
      <button class="swap" data-action="swap" aria-label="Swap currencies">⇅</button>
      <div class="conv-box"><div class="cur">${to === 'DKK' ? '🇩🇰 DKK' : '🇮🇳 INR'}</div><input id="conv-out" readonly aria-label="Converted amount"></div>
      <div class="quick" style="margin-top:14px">${[100, 500, 1000, 5000, 10000].map((n) => `<button data-action="quick" data-n="${n}">${n.toLocaleString('en-US')}</button>`).join('')}</div>
    </div>
    <div class="card"><h2>Live rate <span class="small">updates daily</span></h2>
      <div class="row between"><div><div class="value" style="font-size:1.5rem;font-weight:700">1 DKK = ₹${r.dkk_inr.toFixed(2)}</div>
        <div class="muted small">1 INR = ${(1 / r.dkk_inr).toFixed(4)} DKK</div></div>
        ${change != null && hist.length > 3 ? `<span class="chip ${change >= 0 ? 'good' : 'warn'}">${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(1)}% · ${hist.length}d</span>` : ''}</div>
      <div style="margin-top:12px">${sparkline(hist, (v) => `₹${v.toFixed(2)}`)}</div>
      <div class="row between" style="margin-top:8px"><span class="faint small">${r.override ? 'Manual rate in use' : `ECB reference rate · ${esc(r.date)}`}</span><button class="btn small" data-action="refresh-rate">Refresh</button></div>
    </div>
    <div class="card"><h2>Your own rate <span class="small">optional</span></h2>
      <p class="muted small" style="margin-top:0">Your bank or Wise rarely matches the ECB. Enter what you actually get (INR per 1 DKK) and new expenses will use it.</p>
      <div class="row"><input id="rate-ov" inputmode="decimal" placeholder="${r.dkk_inr.toFixed(2)}" value="${r.override ? r.dkk_inr : ''}" aria-label="INR per DKK"><button class="btn primary" data-action="save-rate">Use</button>${r.override ? '<button class="btn" data-action="clear-rate">Reset</button>' : ''}</div>
    </div>`;
}

function bindConvert() {
  const inp = $('#conv-in'), out = $('#conv-out');
  if (!inp) return;
  const calc = () => {
    state.convAmount = inp.value;
    const v = parseFloat(inp.value.replace(',', '.'));
    if (!Number.isFinite(v) || !state.rate) { out.value = ''; return; }
    out.value = state.convFrom === 'DKK' ? (v * state.rate.dkk_inr).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : (v / state.rate.dkk_inr).toLocaleString('en-US', { maximumFractionDigits: 2 });
  };
  inp.addEventListener('input', calc); calc();
}

// ───────────────────────── SETTINGS ─────────────────────────
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
let lockBio = 'unknown'; // yes | no
lock.biometricAvailable().then((v) => { lockBio = v ? 'yes' : 'no'; if (state.view === 'settings') render(); });
let pushState = 'unknown'; // unsupported | denied | off | on

async function refreshPushState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) pushState = 'unsupported';
  else if (Notification.permission === 'denied') pushState = 'denied';
  else {
    const reg = await navigator.serviceWorker.getRegistration();
    pushState = (await reg?.pushManager.getSubscription()) ? 'on' : 'off';
  }
}

function viewSettings() {
  const s = state.settings;
  const sw = (id, on) => `<label class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span></span></label>`;
  const url = location.origin;
  const theme = ls.get('bt_theme', 'auto');
  const pushNote = {
    unsupported: isIOS && !isStandalone ? 'On iPhone, first tap Share → “Add to Home Screen”, then open the app from your home screen to enable notifications.' : 'This browser doesn’t support push notifications (they need HTTPS).',
    denied: 'Notifications are blocked for this site. Re-enable them in your browser/iOS settings.',
    off: 'Get budget alerts and a daily nudge to log spending.',
    on: 'Notifications are on for this device.',
    unknown: '',
  }[pushState];
  const lk = lock.enabled(), lkOk = lock.supported();
  const lockCard = `<div class="card"><h2>App lock</h2>
    ${!lkOk ? '<p class="muted small" style="margin-top:0">App lock needs a secure connection (HTTPS or localhost). Set up HTTPS and it will appear here.</p>' : `
    <p class="muted small" style="margin-top:0">${lk ? 'Locked with a 6-digit PIN on this device.' : 'Hide your finances behind a PIN (and Face ID / Touch ID) on this device.'}</p>
    <div class="row" style="flex-wrap:wrap">
      ${lk ? '<button class="btn small" data-action="lock-now">Lock now</button><button class="btn small" data-action="lock-change">Change PIN</button><button class="btn small danger" data-action="lock-remove">Turn off</button>' : '<button class="btn primary" data-action="lock-setup">Set a PIN</button>'}
    </div>
    ${lk ? `<div class="set-row"><div><div class="t">Face ID / Touch ID</div><div class="muted small" id="bio-note">${lockBio === 'no' ? 'Not available on this device' : 'Unlock with biometrics, PIN as fallback'}</div></div>
      <label class="switch"><input type="checkbox" id="s-bio" ${lock.biometricEnabled() ? 'checked' : ''} ${lockBio === 'no' ? 'disabled' : ''}><span></span></label></div>
    <div class="set-row"><div class="t">Lock after</div><select id="s-lock-time" style="width:auto">${[[0, 'Leaving the app'], [1, '1 minute'], [5, '5 minutes'], [15, '15 minutes']].map(([m, l]) => `<option value="${m}" ${lock.getTimeout() === m ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : ''}`}
  </div>`;
  return `
  ${lockCard}
  <div class="card"><h2>Notifications</h2>
    <p class="muted small" style="margin-top:0">${pushNote}</p>
    <div class="row" style="flex-wrap:wrap">
      ${pushState === 'off' ? '<button class="btn primary" data-action="push-on">Enable on this device</button>' : ''}
      ${pushState === 'on' ? '<button class="btn" data-action="push-test">Send test</button><button class="btn" data-action="push-off">Turn off</button>' : ''}
    </div>
    <div class="set-row"><div><div class="t">Budget alerts</div><div class="muted small">At 80% and 100% of any limit</div></div>${sw('s-alerts', s.alert_thresholds)}</div>
    <div class="set-row"><div><div class="t">Daily reminder</div><div class="muted small">“Log today’s spending” with your daily allowance</div></div>${sw('s-daily', s.daily_reminder)}</div>
    <div class="set-row"><div class="t">Reminder time</div><input type="time" id="s-time" value="${s.reminder_time}" style="width:auto"></div>
    <div class="set-row"><div><div class="t">Sunday recap</div><div class="muted small">Weekly summary and one tip</div></div>${sw('s-weekly', s.weekly_recap)}</div>
  </div>

  <div class="card"><h2>iPhone Shortcuts <span class="small">⚡︎ automate</span></h2>
    <p class="muted small" style="margin-top:0">Log expenses by voice, Action Button, Back Tap, or automatically after Apple Pay.</p>
    <label class="field">Server address<input readonly value="${esc(url)}" data-select></label>
    <label class="field" style="margin-top:10px">API token <input readonly id="tok" value="${esc(state.apiToken)}" data-select></label>
    <div class="row" style="margin-top:10px;flex-wrap:wrap"><button class="btn small" data-action="copy-token">Copy token</button><button class="btn small" data-action="copy-url">Copy endpoint URL</button><button class="btn small danger" data-action="regen-token">Regenerate</button></div>
    <details style="margin-top:10px"><summary>Setup steps</summary>
      <ol class="steps">
        <li>Open <b>Shortcuts</b> → ＋ → name it “Add expense”.</li>
        <li>Add <b>Ask for Input</b> (type: Number, prompt “Amount”).</li>
        <li>Add <b>Choose from Menu</b> / <b>Choose from List</b> with your category names (or fetch them live: <code>GET ${esc(url)}/api/shortcuts/categories</code>).</li>
        <li>Add <b>Get Contents of URL</b>: URL <code>${esc(url)}/api/shortcuts/expense</code>, Method <b>POST</b>, Header <code>Authorization</code> = <code>Bearer ${esc(state.apiToken.slice(0, 6))}…</code> (your token), Request Body <b>JSON</b> with fields <code>amount</code> (Provided Input), <code>currency</code> (DKK or INR), <code>category</code> (Chosen Item), <code>note</code> (optional).</li>
        <li>Add <b>Get Dictionary Value</b> for <code>message</code>, then <b>Show Result</b>.</li>
        <li><b>Hands-free:</b> Settings → Action Button / Back Tap → pick the shortcut, or say “Hey Siri, Add expense”.</li>
        <li><b>Automatic:</b> Shortcuts → Automation → <b>Transaction</b> (Wallet) → run the shortcut and pass <i>Amount</i> and <i>Merchant</i> as <code>amount</code> and <code>note</code>. Every Apple Pay tap gets logged for you.</li>
      </ol>
      <p class="small muted">Test from a terminal:</p>
      <pre class="code">curl -X POST ${esc(url)}/api/shortcuts/expense \\
  -H "Authorization: Bearer ${esc(state.apiToken)}" \\
  -H "Content-Type: application/json" \\
  -d '{"amount":"45","currency":"DKK","category":"Groceries","note":"Netto"}'</pre>
      <p class="small muted">Away from home? Your phone must reach the server — use Tailscale/WireGuard or a reverse proxy with HTTPS.</p>
    </details>
  </div>

  <div class="card"><h2>General</h2>
    <div class="set-row"><div><div class="t">Base currency</div><div class="muted small">All budgets and totals use this</div></div>
      <select id="s-base" style="width:auto"><option ${s.base_currency === 'DKK' ? 'selected' : ''}>DKK</option><option ${s.base_currency === 'INR' ? 'selected' : ''}>INR</option></select></div>
    <div class="set-row"><div class="t">Appearance</div>
      <select id="s-theme" style="width:auto"><option value="auto" ${theme === 'auto' ? 'selected' : ''}>Automatic</option><option value="light" ${theme === 'light' ? 'selected' : ''}>Light</option><option value="dark" ${theme === 'dark' ? 'selected' : ''}>Dark</option></select></div>
    <div class="set-row"><div><div class="t">Export</div><div class="muted small">Your data is yours</div></div><span class="row" style="gap:8px"><a class="btn small" href="/api/export.csv">CSV</a><a class="btn small" href="/api/backup.json">Backup</a></span></div>
    <div class="set-row"><div><div class="t">Import</div><div class="muted small">Bank CSV (date, amount, text) or a backup file</div></div><span class="row" style="gap:8px">
      <label class="btn small">CSV<input class="hidden-file" type="file" id="f-csv" accept=".csv,text/csv"></label>
      <label class="btn small">Restore<input class="hidden-file" type="file" id="f-restore" accept=".json,application/json"></label></span></div>
    <div class="set-row"><div class="t">Install app</div><span class="muted small" style="text-align:right">${isStandalone ? 'Installed ✓' : isIOS ? 'Share → Add to Home Screen' : 'Browser menu → Install'}</span></div>
    <div class="set-row"><div class="t">Session</div><button class="btn small" data-action="logout">Sign out</button></div>
  </div>`;
}

// ───────────────────────── ADD / EDIT SHEET ─────────────────────────
// One sheet, three modes: entry (expense|income, new or edit) and recurring.
const orderedCats = () => {
  const rank = new Map(state.usage.map((id, i) => [id, i]));
  return [...state.categories].sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999) || a.sort - b.sort);
};

// note -> category last used with that note (so "Netto" picks Groceries by itself)
function learnedCat(note) {
  const n = note.trim().toLowerCase();
  if (!n) return null;
  const hit = state.expenses.find((e) => e.category_id && e.note.trim().toLowerCase() === n)
    || state.expenses.find((e) => e.category_id && e.note.trim().length > 2 && n.includes(e.note.trim().toLowerCase()));
  return hit?.category_id ?? null;
}

// "120 kr netto groceries" / "₹450 auto" -> { amount, currency, category, note }
function parseQuick(text) {
  const t = text.trim();
  const m = t.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const currency = /₹|\brs\.?\b|\binr\b|rupee/i.test(t) ? 'INR' : /\bkr\b|\bdkk\b/i.test(t) ? 'DKK' : null;
  const rest = (t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length))
    .replace(/₹|\brs\.?(?=\s|$)|\binr\b|rupees?|\bkr\.?(?=\s|$)|\bdkk\b/gi, ' ').split(/\s+/).filter(Boolean);
  let cat = null;
  const words = rest.filter((w) => {
    if (cat || w.length < 3) return true;
    const lw = w.toLowerCase();
    const c = state.categories.find((c) => c.name.toLowerCase().split(/\s+/).some((p) => p === lw || (lw.length >= 3 && p.startsWith(lw))));
    if (c) { cat = c.id; return false; }
    return true;
  });
  const note = words.join(' ');
  return { amount: m[1].replace(',', '.'), currency, category: cat ?? learnedCat(note), note };
}

function openSheet(item, kind = 'expense', mode = 'entry') {
  const edit = !!item;
  const cur = item?.currency || ls.get('bt_cur', base());
  const catId = mode === 'recurring' ? null : item ? item.category_id ?? null : null;
  const isInc = kind === 'income';
  const sheet = $('#sheet');
  const notes = [...new Set(state.expenses.map((e) => e.note).filter(Boolean))].slice(0, 40);
  const title = mode === 'recurring' ? 'New recurring' : `${edit ? 'Edit' : 'New'} ${isInc ? 'income' : 'expense'}`;
  sheet.innerHTML = `<form class="sheet-body" method="dialog" id="sheetform" data-id="${item?.id || ''}" data-cat="${catId ?? ''}" data-cur="${cur}" data-kind="${kind}" data-mode="${mode}">
    <div class="sheet-title"><h2 id="sheet-title">${title}</h2><button type="button" class="icon-btn" data-action="close-sheet" aria-label="Close">✕</button></div>
    ${!edit ? `<div class="seg" role="group" aria-label="Type" style="justify-self:start"><button type="button" data-action="set-kind" data-kind="expense" aria-pressed="${!isInc}">Expense</button><button type="button" data-action="set-kind" data-kind="income" aria-pressed="${isInc}">Income</button></div>` : ''}
    ${!edit && mode === 'entry' && !isInc ? '<div class="quickline"><input id="f-quick" placeholder="Quick type: “120 netto groceries” or “₹450 auto”" autocomplete="off" enterkeyhint="done" aria-label="Quick entry"></div>' : ''}
    <div class="amount-wrap"><input name="amount" id="f-amount" inputmode="decimal" autocomplete="off" placeholder="0" value="${item ? item.amount : ''}" aria-label="Amount" required>
      <div class="seg" role="group" aria-label="Currency"><button type="button" data-action="set-cur" data-cur="DKK" aria-pressed="${cur === 'DKK'}">DKK</button><button type="button" data-action="set-cur" data-cur="INR" aria-pressed="${cur === 'INR'}">INR</button></div></div>
    <div class="muted small" id="f-preview" style="margin-top:-8px;min-height:1.3em"></div>
    ${isInc ? '' : `<div class="cat-grid" id="f-cats">${orderedCats().map((c) => `<button type="button" class="cat-pick" data-action="pick-cat" data-id="${c.id}" aria-pressed="${c.id === catId}"><span class="e">${c.icon}</span>${esc(c.name)}</button>`).join('')}</div>`}
    <div class="row"><label class="field" style="flex:1">${isInc ? 'Source' : 'Note'}<input name="note" id="f-note" ${isInc ? '' : 'list="note-list"'} maxlength="120" placeholder="${isInc ? 'e.g. Salary, SU, from home' : 'e.g. Netto, Metro ticket'}" value="${esc(item?.note ?? item?.source ?? '')}"></label>
      ${mode === 'recurring' ? '<label class="field" style="width:96px">Day of month<input id="f-day" inputmode="numeric" value="1" maxlength="2"></label>'
        : `<label class="field">Date<input type="date" name="date" id="f-date" value="${item?.date || (state.month === monthNow() ? localToday() : `${state.month}-01`)}" max="${localToday()}"></label>`}</div>
    <datalist id="note-list">${notes.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
    <div class="row">${edit ? '<button type="button" class="btn danger" data-action="delete-expense">Delete</button>' : ''}<button class="btn primary" style="flex:1" type="submit">${mode === 'recurring' ? 'Add recurring' : edit ? 'Save changes' : isInc ? 'Add income' : 'Add expense'}</button></div>
  </form>`;
  sheet.setAttribute('aria-labelledby', 'sheet-title');
  if (!sheet.open) sheet.showModal();
  updatePreview();
  if (!edit) setTimeout(() => ($('#f-quick') || $('#f-amount'))?.focus(), 60);
}

function openGoalSheet() {
  const sheet = $('#sheet');
  sheet.innerHTML = `<form class="sheet-body" id="goalform"><div class="sheet-title"><h2>New savings goal</h2><button type="button" class="icon-btn" data-action="close-sheet" aria-label="Close">✕</button></div>
    <div class="row"><label class="field" style="width:70px">Icon<input name="icon" value="🎯" maxlength="4" style="text-align:center"></label>
      <label class="field" style="flex:1">Name<input name="name" placeholder="e.g. Trip to India" required maxlength="60"></label></div>
    <div class="row"><label class="field" style="flex:1">Target (${base()})<input name="target" inputmode="decimal" required placeholder="12000"></label>
      <label class="field" style="flex:1">Already saved<input name="saved" inputmode="decimal" placeholder="0"></label></div>
    <label class="field">Deadline<input type="date" name="deadline" min="${localToday()}"></label>
    <button class="btn primary" type="submit">Create goal</button></form>`;
  sheet.showModal();
}

function updatePreview() {
  const form = $('#sheetform');
  if (!form) return;
  const cur = form.dataset.cur, v = parseFloat(($('#f-amount').value || '').replace(',', '.'));
  const el = $('#f-preview');
  if (!Number.isFinite(v) || v <= 0 || cur === base() || !state.rate) { el.textContent = cur !== base() && state.rate ? `1 ${cur} ≈ ${money(cur === 'INR' ? 1 / state.rate.dkk_inr : state.rate.dkk_inr, base(), 4)}` : ''; return; }
  const conv = cur === 'INR' ? v / state.rate.dkk_inr : v * state.rate.dkk_inr;
  el.textContent = `≈ ${money(conv, base(), 2)} at ${state.rate.override ? 'your' : 'today’s'} rate`;
}

function applyQuick(text) {
  const r = parseQuick(text);
  const form = $('#sheetform');
  if (!r || !form) return false;
  $('#f-amount').value = r.amount;
  if (r.currency) { form.dataset.cur = r.currency; form.querySelectorAll('[data-action="set-cur"]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.cur === r.currency)); }
  if (r.category) { form.dataset.cat = String(r.category); form.querySelectorAll('.cat-pick').forEach((b) => b.setAttribute('aria-pressed', b.dataset.id === String(r.category))); }
  $('#f-note').value = r.note;
  updatePreview();
  return true;
}

async function submitSheet(form) {
  const { id, kind, mode } = form.dataset;
  const amountOk = parseFloat($('#f-amount').value.replace(',', '.')) > 0;
  if (!amountOk) { toast('Enter an amount'); return; }
  const note = $('#f-note').value.trim();
  const common = { amount: $('#f-amount').value, currency: form.dataset.cur };
  const catId = form.dataset.cat ? Number(form.dataset.cat) : null;
  let url, method = id ? 'PUT' : 'POST', body;
  if (mode === 'recurring') { url = '/api/recurring'; method = 'POST'; body = { ...common, kind, category_id: catId, note, day: $('#f-day').value }; }
  else if (kind === 'income') { url = id ? `/api/income/${id}` : '/api/income'; body = { ...common, source: note, date: $('#f-date').value }; }
  else { url = id ? `/api/expenses/${id}` : '/api/expenses'; body = { ...common, category_id: catId, category: catId, note, date: $('#f-date').value }; }
  ls.set('bt_cur', common.currency);
  try {
    await api(url, { method, body });
    $('#sheet').close();
    toast(mode === 'recurring' ? 'Recurring added' : id ? 'Saved' : kind === 'income' ? 'Income added' : 'Expense added');
    navigator.vibrate?.(10);
    if (mode === 'recurring') await loadBudgetExtras();
    await bootstrap(); // refresh usage ordering
    await load();
  } catch (e) {
    if (!e.status && !id && mode === 'entry' && kind === 'expense') { // network failure: keep it locally and sync later
      queue.set([...queue.get(), body]); $('#sheet').close(); updateBanner(); toast('Offline — saved on this device');
    } else toast(e.message);
  }
}

// ───────────────────────── events ─────────────────────────
let colorTimer;
document.addEventListener('click', async (ev) => {
  const nav = ev.target.closest('[data-nav]');
  if (nav) return navigate(nav.dataset.nav);
  const a = ev.target.closest('[data-action]');
  if (!a) return;
  const act = a.dataset.action, id = a.dataset.id;
  try {
    switch (act) {
      case 'lock-setup': if (await lock.setupPin()) { toast('PIN set'); render(); } break;
      case 'lock-change': if (await lock.verifyPin('Enter current PIN') && await lock.setupPin()) { toast('PIN changed — set up Face ID again if you use it'); render(); } break;
      case 'lock-remove': if (await lock.verifyPin('Enter PIN to turn off')) { lock.removeLock(); toast('App lock off'); render(); } break;
      case 'lock-now': lock.lock(); break;
      case 'add': openSheet(); break;
      case 'edit-income': openSheet(state.incomes.find((i) => i.id === Number(id)), 'income'); break;
      case 'set-kind': { const form = $('#sheetform'); const keep = { amount: $('#f-amount').value, note: $('#f-note').value }; openSheet(null, a.dataset.kind, form.dataset.mode); $('#f-amount').value = keep.amount; $('#f-note').value = keep.note; break; }
      case 'add-rec': openSheet(null, 'expense', 'recurring'); break;
      case 'toggle-rec': { const r = state.recurring.find((x) => x.id === Number(id)); await api(`/api/recurring/${id}`, { method: 'PUT', body: { active: !r.active } }); await loadBudgetExtras(); break; }
      case 'del-rec': if (confirm('Remove this recurring item? Entries already created stay.')) { await api(`/api/recurring/${id}`, { method: 'DELETE' }); await loadBudgetExtras(); } break;
      case 'add-goal': openGoalSheet(); break;
      case 'goal-add': { const v = prompt(`Add to savings (${base()}) — negative to withdraw`); if (v) { await api(`/api/goals/${id}/contribute`, { method: 'POST', body: { amount: v } }); await loadBudgetExtras(); } break; }
      case 'goal-del': if (confirm('Remove this goal?')) { await api(`/api/goals/${id}`, { method: 'DELETE' }); await loadBudgetExtras(); } break;
      case 'filter-cur': state.filterCur = state.filterCur === id ? 'all' : id; render(); break;
      case 'hide-ios': ls.set('bt_hide_ios', true); render(); break;
      case 'reload': location.reload(); break;
      case 'save-rate': { const v = $('#rate-ov').value; await api('/api/settings', { method: 'PUT', body: { rate_override: v } }); await bootstrap(); await loadRates(); toast('Using your rate'); break; }
      case 'clear-rate': await api('/api/settings', { method: 'PUT', body: { rate_override: null } }); await bootstrap(); await loadRates(); toast('Back to the live rate'); break;
      case 'close-sheet': $('#sheet').close(); break;
      case 'edit': openSheet(state.expenses.find((e) => e.id === Number(id))); break;
      case 'set-cur': { const f = $('#sheetform'); f.dataset.cur = a.dataset.cur; f.querySelectorAll('[data-action="set-cur"]').forEach((b) => b.setAttribute('aria-pressed', b === a)); updatePreview(); break; }
      case 'pick-cat': { const f = $('#sheetform'); const same = f.dataset.cat === id; f.dataset.cat = same ? '' : id; f.querySelectorAll('.cat-pick').forEach((b) => b.setAttribute('aria-pressed', !same && b.dataset.id === id)); break; }
      case 'delete-expense': { const f = $('#sheetform'); if (confirm('Delete this entry?')) { await api(`/api/${f.dataset.kind === 'income' ? 'income' : 'expenses'}/${f.dataset.id}`, { method: 'DELETE' }); $('#sheet').close(); toast('Deleted'); await load(); } break; }
      case 'prev-month': case 'next-month': case 'this-month':
        state.month = act === 'this-month' ? monthNow() : shiftMonth(state.month, act === 'prev-month' ? -1 : 1);
        if (state.month > monthNow()) state.month = monthNow();
        state.loaded = false; state.filterCat = 'all'; render(); await load(); break;
      case 'filter-cat': state.filterCat = id; if (state.view !== 'activity') navigate('activity'); else render(); break;
      case 'swap': state.convFrom = state.convFrom === 'DKK' ? 'INR' : 'DKK'; render(); break;
      case 'quick': state.convAmount = a.dataset.n; render(); break;
      case 'refresh-rate': { a.disabled = true; const r = await api('/api/rates/refresh', { method: 'POST' }); state.rate = r.current; toast('Rate updated'); await loadRates(); render(); break; }
      case 'add-cat': { const name = prompt('Category name'); if (name?.trim()) { const c = await api('/api/categories', { method: 'POST', body: { name, color: PALETTE[state.categories.length % 8], icon: '💸' } }); state.categories.push(c); render(); } break; }
      case 'del-cat': { const c = catById(Number(id)); if (confirm(`Remove “${c.name}”? Past expenses keep their data.`)) { await api(`/api/categories/${id}`, { method: 'DELETE' }); state.categories = state.categories.filter((x) => x.id !== c.id); await load(); } break; }
      case 'set-color': { const c = catById(Number(id)); c.color = a.dataset.color; render(); clearTimeout(colorTimer); colorTimer = setTimeout(() => api(`/api/categories/${id}`, { method: 'PUT', body: { color: c.color } }).then(load), 300); break; }
      case 'copy-token': await navigator.clipboard?.writeText(state.apiToken); toast('Token copied'); break;
      case 'copy-url': await navigator.clipboard?.writeText(`${location.origin}/api/shortcuts/expense`); toast('URL copied'); break;
      case 'push-on': await enablePush(); break;
      case 'push-off': await disablePush(); break;
      case 'push-test': { const r = await api('/api/push/test', { method: 'POST' }); toast(r.sent ? 'Test sent' : 'No device subscribed'); break; }
      case 'logout': await api('/api/logout', { method: 'POST' }); for (const k of await caches.keys()) await caches.delete(k); location.reload(); break;
      case 'regen-token': if (confirm('Generate a new token? Your existing Shortcuts will stop working until you paste the new one.')) { const r = await api('/api/token/regenerate', { method: 'POST' }); state.apiToken = r.apiToken; render(); toast('New token generated'); } break;
    }
  } catch (e) { if (e.message !== 'Login required') toast(e.message); }
  finally { if (a.isConnected && a.disabled) a.disabled = false; }
});

document.addEventListener('submit', async (ev) => {
  if (ev.target.id === 'sheetform') { ev.preventDefault(); submitSheet(ev.target); }
  if (ev.target.id === 'goalform') {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    try { await api('/api/goals', { method: 'POST', body: f }); $('#sheet').close(); toast('Goal created'); await loadBudgetExtras(); } catch (e) { toast(e.message); }
  }
});
document.addEventListener('keydown', (ev) => {
  if (ev.target.id === 'f-quick' && ev.key === 'Enter') {
    ev.preventDefault();
    if (applyQuick(ev.target.value)) { ev.target.value = ''; $('#f-amount').focus(); } else toast('Start with an amount, e.g. “120 netto”');
  }
});
document.addEventListener('input', (ev) => {
  if (ev.target.id === 'f-amount') updatePreview();
  if (ev.target.id === 'search') { state.search = ev.target.value; const pos = ev.target.selectionStart; render(); const s = $('#search'); s.focus(); s.setSelectionRange(pos, pos); }
});
document.addEventListener('focusin', (ev) => { if (ev.target.matches('[data-select]')) ev.target.select(); });

// Inline edits on Budget + Settings screens
document.addEventListener('change', async (ev) => {
  const t = ev.target;
  try {
    if (t.id === 'f-note' && $('#sheetform')?.dataset.kind === 'expense' && !$('#sheetform').dataset.cat) {
      const c = learnedCat(t.value);
      if (c) { const f = $('#sheetform'); f.dataset.cat = String(c); f.querySelectorAll('.cat-pick').forEach((b) => b.setAttribute('aria-pressed', b.dataset.id === String(c))); }
    }
    else if (t.id === 'f-csv' && t.files[0]) {
      const r = await api('/api/import/csv', { method: 'POST', body: { csv: await t.files[0].text() } });
      t.value = ''; toast(`Imported ${r.added}${r.skipped ? `, skipped ${r.skipped}` : ''}`); await bootstrap(); await load();
    }
    else if (t.id === 'f-restore' && t.files[0]) {
      if (!confirm('Restore replaces ALL current data with this backup. Continue?')) { t.value = ''; return; }
      const r = await api('/api/restore', { method: 'POST', body: JSON.parse(await t.files[0].text()) });
      t.value = ''; toast(`Restored ${r.expenses} expenses`); await bootstrap(); await load();
    }
    else if (t.id === 'total-budget') { const v = parseFloat(t.value.replace(',', '.')) || 0; await api('/api/settings', { method: 'PUT', body: { monthly_budget: v } }); state.settings.monthly_budget = v; await load(); render(); toast('Budget saved'); }
    else if (t.closest('.cat-edit')) {
      const row = t.closest('.cat-edit'), c = catById(Number(row.dataset.cid)), f = t.dataset.f;
      const val = f === 'budget' ? parseFloat(t.value.replace(',', '.')) || 0 : t.value.trim();
      if (f === 'name' && !val) { t.value = c.name; return; }
      const updated = await api(`/api/categories/${c.id}`, { method: 'PUT', body: { [f]: val } });
      Object.assign(c, updated); await load(); toast('Saved');
    }
    else if (t.id === 's-lock-time') { lock.setTimeoutMinutes(t.value); toast('Saved'); }
    else if (t.id === 's-bio') {
      try {
        if (t.checked) { if (!(await lock.verifyPin('Enter PIN to enable'))) throw new Error('cancelled'); await lock.enableBiometric(); toast('Face ID / Touch ID enabled'); }
        else { lock.disableBiometric(); toast('Biometrics off'); }
      } catch (e) { t.checked = lock.biometricEnabled(); if (e.message !== 'cancelled') toast(e.name === 'NotAllowedError' ? 'Cancelled' : e.message); }
    }
    else if (t.id === 's-theme') { ls.set('bt_theme', t.value); applyTheme(); }
    else if (['s-alerts', 's-daily', 's-weekly', 's-time', 's-base'].includes(t.id)) {
      const map = { 's-alerts': ['alert_thresholds', t.checked], 's-daily': ['daily_reminder', t.checked], 's-weekly': ['weekly_recap', t.checked], 's-time': ['reminder_time', t.value], 's-base': ['base_currency', t.value] };
      const [k, v] = map[t.id];
      try { await api('/api/settings', { method: 'PUT', body: { [k]: v } }); state.settings[k] = v; toast('Saved'); if (k === 'base_currency') await load(); }
      catch (e) { toast(e.message); render(); }
    }
  } catch (e) { if (e.message !== 'Login required') toast(e.message); }
});

// Tooltips for charts: hover on desktop, tap on touch.
const tip = $('#tip');
function showTip(el, x, y) {
  tip.textContent = el.dataset.tip; tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = `${Math.min(innerWidth - w - 8, Math.max(8, x - w / 2))}px`;
  tip.style.top = `${Math.max(8, y - h - 14)}px`;
}
document.addEventListener('pointerover', (e) => { const el = e.target.closest?.('[data-tip]'); if (el && e.pointerType === 'mouse') showTip(el, e.clientX, e.clientY); });
document.addEventListener('pointermove', (e) => { const el = e.target.closest?.('[data-tip]'); if (el && e.pointerType === 'mouse') showTip(el, e.clientX, e.clientY); else if (e.pointerType === 'mouse') tip.hidden = true; });
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest?.('[data-tip]');
  if (el && e.pointerType !== 'mouse') { showTip(el, e.clientX, e.clientY - 10); clearTimeout(showTip.t); showTip.t = setTimeout(() => (tip.hidden = true), 2500); }
  else if (!el) tip.hidden = true;
});
document.addEventListener('scroll', () => (tip.hidden = true), { passive: true });

// ───────────────────────── push ─────────────────────────
const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { await refreshPushState(); render(); return toast('Permission not granted'); }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(state.vapidPublicKey) });
  await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
  await refreshPushState(); render(); toast('Notifications enabled');
}
async function disablePush() {
  const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
  if (sub) { await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }); await sub.unsubscribe(); }
  await refreshPushState(); render(); toast('Notifications off');
}

// ───────────────────────── boot ─────────────────────────
function applyTheme() {
  const t = ls.get('bt_theme', 'auto');
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
}

function showLogin() { $('#app').hidden = true; $('#login').hidden = false; }
$('#loginform').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await api('/api/login', { method: 'POST', body: { password: e.target.password.value } }); location.reload(); }
  catch (err) { $('#loginerr').textContent = err.message; }
});

async function init() {
  applyTheme();
  lock.watchBackground();
  if (lock.enabled()) lock.lock(); // cover the app before anything renders
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  const sess = await fetch('/api/session').then((r) => r.json()).catch(() => null);
  if (sess && !sess.authed) return showLogin();
  try { await bootstrap(); } catch (e) { if (e.message === 'Login required') return; $('#view').innerHTML = `<div class="card"><div class="empty"><div class="big">📡</div><p>Can’t reach the server.</p><button class="btn" data-action="reload">Retry</button></div></div>`; $('#app').hidden = false; return; }
  $('#app').hidden = false;
  state.month = monthNow();
  const hv = location.hash.replace('#/', '');
  if (VIEWS[hv]) state.view = hv;
  await refreshPushState();
  render();
  if (state.view === 'convert') loadRates();
  if (state.view === 'budget') loadBudgetExtras();
  await load().catch(() => {});
  flushQueue();
  if (new URLSearchParams(location.search).get('add')) { history.replaceState(null, '', '/'); openSheet(); }
}

window.addEventListener('hashchange', () => {
  const v = location.hash.replace('#/', '');
  if (state.settings && VIEWS[v] && v !== state.view) navigate(v);
});
window.addEventListener('online', flushQueue);
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && state.settings && Date.now() - state.loadedAt > 60_000) {
    // new day? refresh "today"-dependent numbers
    await flushQueue(); await load().catch(() => {});
  }
});

init();
