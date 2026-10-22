import { useState } from 'react';
import { useElementWidth } from '@/hooks/useElementWidth';
import { shortDate } from '@/lib/dates';

interface Props {
  points: { date: string; value: number }[];
}

const HEIGHT = 150;
const M = { t: 16, b: 24, side: 4 };

/** Exchange-rate history for the last 30 days. */
export function RateChart({ points }: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>(320);
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return <p className="muted small">Rate history appears after a few days of data.</p>;
  const vals = points.map((p) => p.value);
  const pad = (Math.max(...vals) - Math.min(...vals)) * 0.2 || Math.max(...vals) * 0.01;
  const lo = Math.min(...vals) - pad;
  const hi = Math.max(...vals) + pad;
  const x = (i: number) => M.side + (i / (points.length - 1)) * (width - M.side * 2);
  const y = (v: number) => M.t + (1 - (v - lo) / (hi - lo)) * (HEIGHT - M.t - M.b);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const li = points.length - 1;
  const hp = hover !== null ? points[hover] : undefined;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg
        className="chart"
        width={width}
        height={HEIGHT}
        role="img"
        aria-label="DKK to INR exchange rate over the last 30 days"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.min(li, Math.max(0, Math.round(((e.clientX - r.left - M.side) / (width - M.side * 2)) * li))));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <path d={`${d}L${x(li)},${HEIGHT - M.b}L${x(0)},${HEIGHT - M.b}Z`} fill="var(--accent)" opacity="0.08" />
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <text x={M.side} y={HEIGHT - 6}>
          {shortDate(points[0]!.date)}
        </text>
        <text x={width - M.side} y={HEIGHT - 6} textAnchor="end">
          {shortDate(points[li]!.date)}
        </text>
        <circle cx={hover !== null ? x(hover) : x(li)} cy={y((hp ?? points[li]!).value)} r="4" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
      </svg>
      {hp && (
        <div className="chart-tip" style={{ position: 'absolute', top: 0, left: Math.min(Math.max(0, x(hover!) - 50), width - 110) }}>
          {shortDate(hp.date)}
          {'\n'}1 DKK = {hp.value.toFixed(3)} INR
        </div>
      )}
    </div>
  );
}
