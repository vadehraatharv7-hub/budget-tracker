import { formatMoney } from '@/lib/money';
import type { Category, Currency } from '@/lib/types';

interface Props {
  categories: Category[];
  total: number;
  currency: Currency;
}

/** One stacked bar showing how the monthly budget is divided between categories. */
export function Allocation({ categories, total, currency }: Props) {
  const parts = categories.filter((c) => c.budget > 0).sort((a, b) => b.budget - a.budget);
  const denom = Math.max(total, parts.reduce((s, c) => s + c.budget, 0), 1);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="alloc" role="img" aria-label="Budget allocation by category">
        {parts.map((c) => (
          <i key={c.id} style={{ width: `${(c.budget / denom) * 100}%`, background: c.color }} title={`${c.name}: ${formatMoney(c.budget, currency)}`} />
        ))}
      </div>
      {parts.length > 0 && (
        <div className="legend">
          {parts.slice(0, 6).map((c) => (
            <span key={c.id}>
              <i style={{ background: c.color }} />
              {c.name} {Math.round((c.budget / denom) * 100)}%
            </span>
          ))}
          {parts.length > 6 && <span className="faint">+{parts.length - 6} more</span>}
        </div>
      )}
    </div>
  );
}
