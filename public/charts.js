// Tiny dependency-free SVG chart helpers. Every function returns an HTML string.
// Hover/tap tooltips are driven by `data-tip` attributes (see app.js).

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const compact = (n) => {
  const a = Math.abs(n);
  if (a >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${+(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return String(Math.round(n));
};

function niceMax(v) {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** Budget ring: spent / budget. Colour shifts with how much of the budget is gone. */
export function ring({ spent, budget, size = 148, stroke = 14, center, sub }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const pct = budget > 0 ? spent / budget : 0;
  const color = pct >= 1 ? 'var(--bad)' : pct >= 0.75 ? 'var(--warn)' : 'var(--accent)';
  const off = c * (1 - Math.min(1, pct));
  return `<div class="ring" role="img" aria-label="${esc(center)} ${esc(sub)}">
    <svg viewBox="0 0 ${size} ${size}"><circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>
    <circle class="arc" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${budget > 0 ? off : c}" data-final="${off}" style="stroke-dashoffset:${c}"/></svg>
    <div class="center"><b>${esc(center)}</b><span>${esc(sub)}</span></div></div>`;
}

/** Donut of category shares. items: [{name,color,value,label}] */
export function donut(items, { size = 150, stroke = 22, centerTop = '', centerBottom = '' } = {}) {
  const total = items.reduce((s, i) => s + i.value, 0);
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, mid = size / 2;
  if (total <= 0) return `<svg class="chart" viewBox="0 0 ${size} ${size}" style="max-width:${size}px"><circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="${stroke}"/></svg>`;
  let acc = 0;
  const gap = items.length > 1 ? 2 : 0; // surface gap between segments
  const segs = items.filter((i) => i.value > 0).map((i) => {
    const len = (i.value / total) * c;
    const seg = `<circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="${i.color}" stroke-width="${stroke}"
      stroke-dasharray="${Math.max(0, len - gap)} ${c - Math.max(0, len - gap)}" stroke-dashoffset="${-acc}" transform="rotate(-90 ${mid} ${mid})"
      data-tip="${esc(`${i.name}\n${i.label} · ${Math.round((i.value / total) * 100)}%`)}" style="cursor:pointer"/>`;
    acc += len;
    return seg;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${size} ${size}" style="max-width:${size}px" role="img" aria-label="Spending by category">${segs}
    <text x="${mid}" y="${mid - 2}" text-anchor="middle" style="fill:var(--text);font-size:15px;font-weight:700">${esc(centerTop)}</text>
    <text x="${mid}" y="${mid + 14}" text-anchor="middle">${esc(centerBottom)}</text></svg>`;
}

/**
 * Cumulative spend vs. the straight-line budget pace.
 * One y-axis (money); the dashed line is where you "should" be today.
 */
export function paceChart(daily, budget, fmt, { w = 640, h = 210 } = {}) {
  const L = 38, R = 8, T = 10, B = 24;
  const days = daily.length;
  const shown = daily.filter((d) => !d.future);
  const maxVal = niceMax(Math.max(budget, ...daily.map((d) => d.cum), 1) * 1.02);
  const x = (d) => L + ((d - 1) / Math.max(1, days - 1)) * (w - L - R);
  const y = (v) => T + (1 - v / maxVal) * (h - T - B);
  const grid = [0, 0.5, 1].map((f) => {
    const v = maxVal * f;
    return `<line class="grid" x1="${L}" x2="${w - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`;
  }).join('');
  const xt = [1, Math.ceil(days / 2), days].map((d) => `<text x="${x(d)}" y="${h - 6}" text-anchor="${d === 1 ? 'start' : d === days ? 'end' : 'middle'}">${d}</text>`).join('');
  const line = shown.map((d, i) => `${i ? 'L' : 'M'}${x(d.day).toFixed(1)},${y(d.cum).toFixed(1)}`).join('');
  const last = shown[shown.length - 1];
  const area = shown.length ? `${line}L${x(last.day)},${y(0)}L${x(1)},${y(0)}Z` : '';
  const ideal = budget > 0 ? `<line x1="${x(1)}" y1="${y(budget / days)}" x2="${x(days)}" y2="${y(budget)}" stroke="var(--text-3)" stroke-width="2" stroke-dasharray="5 5"/>` : '';
  const budgetLine = budget > 0 ? `<line class="grid" x1="${L}" x2="${w - R}" y1="${y(budget)}" y2="${y(budget)}" stroke="var(--bad)" style="stroke:var(--bad);opacity:.35"/>` : '';
  const step = (w - L - R) / Math.max(1, days - 1);
  const hits = daily.filter((d) => !d.future).map((d) =>
    `<rect class="hit" x="${x(d.day) - step / 2}" y="${T}" width="${step}" height="${h - T - B}" data-tip="${esc(`Day ${d.day}\nTotal ${fmt(d.cum)}${d.ideal != null ? `\nPace ${fmt(d.ideal)}` : ''}\nThat day ${fmt(d.spent)}`)}"/>`).join('');
  const dot = last ? `<circle cx="${x(last.day)}" cy="${y(last.cum)}" r="5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>` : '';
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Cumulative spending against budget pace">
    ${grid}${budgetLine}${ideal}
    ${area ? `<path d="${area}" fill="var(--accent)" opacity=".12"/>` : ''}
    ${line ? `<path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
    ${dot}${xt}${hits}</svg>
    <div class="legend"><span><i class="line" style="background:var(--accent)"></i>Spent so far</span>${budget > 0 ? '<span><i class="dash"></i>Budget pace</span>' : ''}</div>`;
}

/** Daily spend bars, 4px rounded tops, 2px gaps; the tallest day is labelled directly. */
export function dailyBars(daily, fmt, { w = 640, h = 110 } = {}) {
  const L = 38, R = 8, T = 14, B = 20;
  const days = daily.length;
  const max = niceMax(Math.max(...daily.map((d) => d.spent), 1));
  const slot = (w - L - R) / days;
  const bw = Math.max(3, slot - 2);
  const y = (v) => T + (1 - v / max) * (h - T - B);
  const top = daily.reduce((a, d) => (d.spent > a.spent ? d : a), daily[0]);
  const bars = daily.map((d) => {
    const x0 = L + (d.day - 1) * slot + (slot - bw) / 2;
    const bh = Math.max(0, h - B - y(d.spent));
    const rr = Math.min(4, bw / 2, bh);
    const path = bh > 0 ? `M${x0},${h - B}V${y(d.spent) + rr}Q${x0},${y(d.spent)} ${x0 + rr},${y(d.spent)}H${x0 + bw - rr}Q${x0 + bw},${y(d.spent)} ${x0 + bw},${y(d.spent) + rr}V${h - B}Z` : '';
    return `${path ? `<path d="${path}" fill="var(--accent)" opacity="${d.future ? 0 : .85}"/>` : ''}
      ${d.future ? '' : `<rect class="hit" x="${L + (d.day - 1) * slot}" y="${T}" width="${slot}" height="${h - T - B}" data-tip="${esc(`Day ${d.day}\n${fmt(d.spent)}`)}"/>`}`;
  }).join('');
  const label = top.spent > 0 ? `<text x="${Math.min(w - R, Math.max(L, L + (top.day - 0.5) * slot))}" y="${y(top.spent) - 4}" text-anchor="middle" style="fill:var(--text-2);font-weight:600">${compact(top.spent)}</text>` : '';
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Daily spending">
    <line class="grid" x1="${L}" x2="${w - R}" y1="${h - B}" y2="${h - B}"/>
    <text x="${L - 6}" y="${T + 4}" text-anchor="end">${compact(max)}</text>
    <text x="${L - 6}" y="${h - B + 4}" text-anchor="end">0</text>
    ${bars}${label}</svg>`;
}

/** Six-month trend; current month is highlighted, earlier months are muted. */
export function trendBars(trend, fmt, monthLabel, { w = 640, h = 150 } = {}) {
  const L = 8, R = 8, T = 22, B = 24;
  const max = niceMax(Math.max(...trend.map((t) => t.spent), 1));
  const slot = (w - L - R) / trend.length, bw = Math.min(54, slot - 14);
  const y = (v) => T + (1 - v / max) * (h - T - B);
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Spending over the last six months">
    <line class="grid" x1="${L}" x2="${w - R}" y1="${h - B}" y2="${h - B}"/>
    ${trend.map((t, i) => {
      const x0 = L + i * slot + (slot - bw) / 2, last = i === trend.length - 1;
      const bh = Math.max(0, h - B - y(t.spent)), rr = Math.min(6, bh);
      const path = bh > 0 ? `M${x0},${h - B}V${y(t.spent) + rr}Q${x0},${y(t.spent)} ${x0 + rr},${y(t.spent)}H${x0 + bw - rr}Q${x0 + bw},${y(t.spent)} ${x0 + bw},${y(t.spent) + rr}V${h - B}Z` : '';
      return `<g>${path ? `<path d="${path}" fill="${last ? 'var(--accent)' : 'var(--text-3)'}" opacity="${last ? 1 : .35}"/>` : ''}
        <text x="${x0 + bw / 2}" y="${h - 6}" text-anchor="middle" style="${last ? 'fill:var(--text);font-weight:650' : ''}">${monthLabel(t.month)}</text>
        ${t.spent > 0 ? `<text x="${x0 + bw / 2}" y="${y(t.spent) - 6}" text-anchor="middle" style="fill:var(--text-2);font-weight:600">${compact(t.spent)}</text>` : ''}
        <rect class="hit" x="${L + i * slot}" y="${T - 14}" width="${slot}" height="${h - T - B + 14}" data-tip="${esc(`${monthLabel(t.month, true)}\n${fmt(t.spent)}`)}"/></g>`;
    }).join('')}</svg>`;
}

/** Exchange-rate sparkline with endpoint dot and hover. points: [{date, v}] */
export function sparkline(points, fmtV, { w = 640, h = 120 } = {}) {
  if (points.length < 2) return '<p class="muted small">Rate history will appear after a few days.</p>';
  const L = 6, R = 6, T = 12, B = 20;
  const vs = points.map((p) => p.v);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  const pad = (hi - lo) * 0.15 || hi * 0.01;
  lo -= pad; hi += pad;
  const x = (i) => L + (i / (points.length - 1)) * (w - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (h - T - B);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const step = (w - L - R) / (points.length - 1);
  const li = points.length - 1;
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Exchange rate over time">
    <path d="${d}L${x(li)},${h - B}L${x(0)},${h - B}Z" fill="var(--accent)" opacity=".1"/>
    <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(li)}" cy="${y(points[li].v)}" r="5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>
    <text x="${L}" y="${h - 4}">${esc(points[0].date.slice(5))}</text><text x="${w - R}" y="${h - 4}" text-anchor="end">${esc(points[li].date.slice(5))}</text>
    <text x="${L}" y="9">${fmtV(Math.max(...vs))}</text>
    ${points.map((p, i) => `<rect class="hit" x="${x(i) - step / 2}" y="${T - 8}" width="${step}" height="${h - T - B + 8}" data-tip="${esc(`${p.date}\n${fmtV(p.v)}`)}"/>`).join('')}</svg>`;
}
