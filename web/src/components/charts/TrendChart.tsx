import { useState } from 'react';
import { useElementWidth } from '@/hooks/useElementWidth';
import { niceMax } from '@/lib/chartMath';
import { formatCompact, formatMoney } from '@/lib/money';
import { shortDate } from '@/lib/dates';
import type { Currency, DailyPoint } from '@/lib/types';

interface Props {
  daily: DailyPoint[];
  budget: number;
  currency: Currency;
}

const HEIGHT = 232;
const M = { l: 44, r: 8, t: 12, b: 26 };

/** Cumulative spending through the month against the straight-line pace that would land exactly on budget. */
export function TrendChart({ daily, budget, currency }: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const days = daily.length;
  const shown = daily.filter((d) => !d.future);
  const maxV = niceMax(Math.max(budget, ...daily.map((d) => d.cum), 1) * 1.03);
  const innerW = Math.max(10, width - M.l - M.r);
  const x = (day: number) => M.l + ((day - 1) / Math.max(1, days - 1)) * innerW;
  const y = (v: number) => M.t + (1 - v / maxV) * (HEIGHT - M.t - M.b);

  const line = shown.map((d, i) => `${i ? 'L' : 'M'}${x(d.day).toFixed(1)},${y(d.cum).toFixed(1)}`).join('');
  const last = shown[shown.length - 1];
  const area = last ? `${line}L${x(last.day)},${y(0)}L${x(1)},${y(0)}Z` : '';
  const hovered = hover !== null ? daily.find((d) => d.day === hover && !d.future) : undefined;

  const onMove = (clientX: number, target: SVGSVGElement) => {
    const rect = target.getBoundingClientRect();
    const day = Math.round(((clientX - rect.left - M.l) / innerW) * (days - 1)) + 1;
    setHover(Math.min(Math.max(1, day), last?.day ?? 1));
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg
        className="chart"
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={`Cumulative spending by day. Total so far ${formatMoney(last?.cum ?? 0, currency)}${budget > 0 ? ` of a ${formatMoney(budget, currency)} budget` : ''}.`}
        onPointerMove={(e) => onMove(e.clientX, e.currentTarget)}
        onPointerLeave={() => setHover(null)}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line className="grid-line" x1={M.l} x2={width - M.r} y1={y(maxV * f)} y2={y(maxV * f)} />
            <text x={M.l - 8} y={y(maxV * f) + 4} textAnchor="end">
              {formatCompact(maxV * f)}
            </text>
          </g>
        ))}
        {[1, Math.ceil(days / 2), days].map((d, i) => (
          <text key={d} x={x(d)} y={HEIGHT - 6} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>
            {d}
          </text>
        ))}
        {budget > 0 && (
          <>
            <line x1={M.l} x2={width - M.r} y1={y(budget)} y2={y(budget)} stroke="var(--bar-neg)" strokeOpacity="0.45" strokeWidth="1" />
            <line x1={x(1)} y1={y(budget / days)} x2={x(days)} y2={y(budget)} stroke="var(--text-3)" strokeWidth="1.5" strokeDasharray="5 4" />
          </>
        )}
        {area && <path d={area} fill="var(--accent)" opacity="0.08" />}
        {line && <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        {hovered ? (
          <>
            <line x1={x(hovered.day)} x2={x(hovered.day)} y1={M.t} y2={HEIGHT - M.b} stroke="var(--border-strong)" />
            <circle cx={x(hovered.day)} cy={y(hovered.cum)} r="4" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
          </>
        ) : (
          last && <circle cx={x(last.day)} cy={y(last.cum)} r="4" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
        )}
      </svg>
      {hovered && (
        <div className="chart-tip" style={{ position: 'absolute', left: Math.min(Math.max(8, x(hovered.day) - 70), width - 150), top: 4 }}>
          {shortDate(hovered.date)}
          {'\n'}Total {formatMoney(hovered.cum, currency)}
          {hovered.ideal != null ? `\nPace ${formatMoney(hovered.ideal, currency)}` : ''}
          {'\n'}That day {formatMoney(hovered.spent, currency)}
        </div>
      )}
      <div className="chart-legend">
        <span>
          <i />
          Spent
        </span>
        {budget > 0 && (
          <span>
            <i data-dash="true" />
            Even pace to budget
          </span>
        )}
      </div>
    </div>
  );
}
