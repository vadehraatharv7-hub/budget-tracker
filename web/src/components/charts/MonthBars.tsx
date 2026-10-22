import { useElementWidth } from '@/hooks/useElementWidth';
import { niceMax } from '@/lib/chartMath';
import { monthLabel } from '@/lib/dates';
import { formatCompact, formatMoney } from '@/lib/money';
import type { Currency } from '@/lib/types';

interface Props {
  data: { month: string; spent: number }[];
  currency: Currency;
}

const HEIGHT = 170;
const M = { t: 22, b: 26, side: 4 };

export function MonthBars({ data, currency }: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>(320);
  const max = niceMax(Math.max(...data.map((d) => d.spent), 1));
  const slot = (width - M.side * 2) / data.length;
  const bw = Math.min(44, slot - 14);
  const y = (v: number) => M.t + (1 - v / max) * (HEIGHT - M.t - M.b);
  return (
    <div ref={ref}>
      <svg className="chart" width={width} height={HEIGHT} role="img" aria-label="Spending over the last six months">
        <line className="grid-line" x1={0} x2={width} y1={HEIGHT - M.b} y2={HEIGHT - M.b} />
        {data.map((d, i) => {
          const current = i === data.length - 1;
          const x0 = M.side + i * slot + (slot - bw) / 2;
          const h = Math.max(0, HEIGHT - M.b - y(d.spent));
          return (
            <g key={d.month}>
              <title>{`${monthLabel(d.month)}: ${formatMoney(d.spent, currency)}`}</title>
              {h > 0 && <rect x={x0} y={y(d.spent)} width={bw} height={h} rx={3} fill={current ? 'var(--accent)' : 'var(--border-strong)'} />}
              {d.spent > 0 && (
                <text x={x0 + bw / 2} y={y(d.spent) - 6} textAnchor="middle" style={{ fill: 'var(--text-2)' }}>
                  {formatCompact(d.spent)}
                </text>
              )}
              <text x={x0 + bw / 2} y={HEIGHT - 8} textAnchor="middle" style={current ? { fill: 'var(--text)', fontWeight: 500 } : undefined}>
                {monthLabel(d.month, 'short')}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
