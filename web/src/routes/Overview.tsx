import { Link } from 'react-router-dom';
import { CircleAlert, CircleCheck, Info, Plus, TriangleAlert, Receipt, Wallet, ListChecks } from 'lucide-react';
import { Card } from '@/components/Card';
import { CategoryIcon } from '@/components/CategoryIcon';
import { EmptyState } from '@/components/EmptyState';
import { useEntryDialog } from '@/components/EntryDialog';
import { PageHeader } from '@/components/PageHeader';
import { PeriodPicker } from '@/components/PeriodPicker';
import { Progress } from '@/components/Progress';
import { MonthBars } from '@/components/charts/MonthBars';
import { TrendChart } from '@/components/charts/TrendChart';
import { useAppState, useMonth, useSummary } from '@/hooks/data';
import { monthLabel, shiftMonth } from '@/lib/dates';
import { formatMoney, formatNumber, formatPercent, formatSigned } from '@/lib/money';
import type { Insight, Summary } from '@/lib/types';

const INSIGHT_ICON = { good: CircleCheck, warn: TriangleAlert, bad: CircleAlert, info: Info } as const;

export function Overview() {
  const [month, setMonth] = useMonth();
  const summary = useSummary(month);
  const { open } = useEntryDialog();

  return (
    <>
      <PageHeader
        title="Overview"
        description="Spending, budget and cash flow for the month."
        actions={
          <>
            <PeriodPicker month={month} onChange={setMonth} />
            <button type="button" className="btn btn--primary only-desktop" onClick={() => open()}>
              <Plus size={16} /> Add transaction
            </button>
          </>
        }
      />
      {summary.isLoading && <Loading />}
      {summary.error && (
        <Card>
          <EmptyState icon={CircleAlert} title="Could not load this month" action={<button className="btn" onClick={() => void summary.refetch()}>Try again</button>}>
            {summary.error.message}
          </EmptyState>
        </Card>
      )}
      {summary.data && <Content s={summary.data} month={month} />}
    </>
  );
}

function Loading() {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="skeleton" style={{ height: 96 }} />
      <div className="skeleton" style={{ height: 220 }} />
      <div className="skeleton" style={{ height: 280 }} />
    </div>
  );
}

function Content({ s, month }: { s: Summary; month: string }) {
  const { open } = useEntryDialog();
  const { data: state } = useAppState();
  const base = s.base;
  const m = (n: number, d?: number) => formatMoney(n, base, d);
  const hasBudget = s.budget > 0;
  const over = s.remaining < 0;
  const ratio = hasBudget ? s.spent / s.budget : 0;
  const elapsed = s.isCurrent ? s.dayNow / s.dim : 1;
  const cats = [...s.categories].filter((c) => c.spent > 0 || c.budget > 0).sort((a, b) => b.spent - a.spent);
  const delta = s.prevSpent > 0 ? (s.spent - s.prevSpent) / s.prevSpent : null;
  const prevLabel = monthLabel(shiftMonth(month, -1), 'short');
  const setupDone = [hasBudget, s.allocated > 0, s.spent > 0 || s.income > 0];

  let status: { label: string; tone: 'pos' | 'warn' | 'neg' } | null = null;
  if (hasBudget) {
    if (over) status = { label: 'Over budget', tone: 'neg' };
    else if (s.isCurrent && s.pace !== null && s.pace > 0) status = { label: s.projected > s.budget ? 'Over pace' : 'Slightly ahead of pace', tone: s.projected > s.budget ? 'neg' : 'warn' };
    else status = { label: s.isCurrent ? 'On track' : 'Within budget', tone: 'pos' };
  }

  return (
    <>
      {!hasBudget && (
        <Card title="Set up your budget" className="stack">
          <div className="checklist" style={{ margin: '-16px -20px -20px' }}>
            {[
              { icon: Wallet, title: 'Set a monthly budget', text: 'The total you want to spend each month.', to: '/budget' },
              { icon: ListChecks, title: 'Give categories a limit', text: 'Split the total so you can see where it goes.', to: '/budget' },
              { icon: Receipt, title: 'Record your first transaction', text: 'Takes a few seconds with quick entry.', to: '' },
            ].map((step, i) => (
              <div key={step.title} className="check-item" data-done={setupDone[i]}>
                <span className="check-item__mark">{setupDone[i] && <CircleCheck size={14} />}</span>
                <div className="check-item__text">
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
                {step.to ? (
                  <Link className="btn btn--sm" to={step.to}>
                    {setupDone[i] ? 'Review' : 'Start'}
                  </Link>
                ) : (
                  <button className="btn btn--sm" onClick={() => open()}>
                    {setupDone[i] ? 'Add another' : 'Add'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <section className="card kpis" aria-label="Summary" style={{ marginTop: hasBudget ? 0 : 16 }}>
        <div className="kpi">
          <div className="kpi__label">{hasBudget ? (over ? 'Over budget by' : 'Remaining') : 'Spent'}</div>
          <div className="kpi__value num">{m(hasBudget ? Math.abs(s.remaining) : s.spent)}</div>
          <div className="kpi__sub">{hasBudget ? `of ${m(s.budget)}${s.isCurrent && s.daysLeft ? ` · ${s.daysLeft} days left` : ''}` : 'No budget set'}</div>
        </div>
        <div className="kpi">
          <div className="kpi__label">Spent</div>
          <div className="kpi__value num">{m(s.spent)}</div>
          <div className="kpi__sub num" data-tone={delta === null ? undefined : delta > 0 ? 'neg' : 'pos'}>
            {delta === null ? 'No earlier month to compare' : `${delta > 0 ? '↑' : '↓'} ${formatPercent(Math.abs(delta))} vs ${prevLabel}`}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi__label">Income</div>
          <div className="kpi__value num">{m(s.income)}</div>
          <div className="kpi__sub">{s.income > 0 ? 'Recorded this month' : 'None recorded'}</div>
        </div>
        <div className="kpi">
          <div className="kpi__label">Net cash flow</div>
          <div className="kpi__value num" style={{ color: s.income > 0 ? (s.net >= 0 ? 'var(--pos)' : 'var(--neg)') : undefined }}>
            {s.income > 0 ? formatSigned(s.net, base) : '–'}
          </div>
          <div className="kpi__sub">{s.income > 0 ? `${formatPercent(Math.max(0, s.net / s.income))} of income kept` : 'Add income to see this'}</div>
        </div>
      </section>

      <div className="split">
        <div>
          {hasBudget && (
            <Card title="Budget" meta={status && <span className={`badge badge--${status.tone}`}>{status.label}</span>}>
              <div className="budget-meter">
                <div className="budget-meter__row">
                  <span className="budget-meter__big num">
                    {m(s.spent)} <span className="muted" style={{ fontWeight: 400 }}>of {m(s.budget)}</span>
                  </span>
                  <span className="num muted">{formatPercent(ratio)}</span>
                </div>
                <Progress value={ratio} marker={s.isCurrent ? elapsed : undefined} label="Budget used" />
                <div className="small muted num">
                  {s.isCurrent
                    ? `Even pace today: ${m(s.budget * elapsed)} · Projected month end: ${m(s.projected)}`
                    : `Finished the month ${over ? 'over' : 'under'} budget by ${m(Math.abs(s.remaining))}`}
                </div>
                {s.isCurrent && s.allowance !== null && !over && (
                  <div className="small muted num">
                    Daily allowance: <strong style={{ color: 'var(--text)' }}>{m(s.allowance)}</strong> for the remaining {s.daysLeft} days.
                  </div>
                )}
              </div>
            </Card>
          )}

          <Card title="Spending over the month" meta={s.avgDaily > 0 ? `Average ${m(s.avgDaily)} per day` : undefined}>
            {s.spent > 0 || hasBudget ? <TrendChart daily={s.daily} budget={s.budget} currency={base} /> : <p className="muted">Nothing recorded yet.</p>}
          </Card>

          <Card title="Categories" meta={hasBudget ? 'Spent against limit' : 'Spent'} flush>
            {cats.length === 0 ? (
              <EmptyState icon={Receipt} title="No spending yet">
                Transactions you add will be grouped here by category.
              </EmptyState>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="num">Spent</th>
                    <th className="num hide-sm">Limit</th>
                    <th className="num hide-sm">Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {cats.map((c) => {
                    const r = c.budget > 0 ? c.spent / c.budget : 0;
                    return (
                      <tr key={c.id ?? 'none'}>
                        <td>
                          <Link to={`/transactions?c=${c.id ?? 'none'}&m=${month}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                            <div className="cat-name">
                              <CategoryIcon slug={c.icon} color={c.color} />
                              <span>{c.name}</span>
                            </div>
                          </Link>
                          {c.budget > 0 && <Progress value={r} label={`${c.name} budget used`} style={{ marginTop: 8, marginLeft: 44 }} />}
                        </td>
                        <td className="num">
                          {formatNumber(c.spent, base)}
                          {c.budget > 0 && <div className="sm-only small faint">of {formatNumber(c.budget, base)}</div>}
                        </td>
                        <td className="num hide-sm">{c.budget > 0 ? formatNumber(c.budget, base) : '–'}</td>
                        <td className="num hide-sm" style={{ color: c.remaining !== null && c.remaining < 0 ? 'var(--neg)' : undefined }}>
                          {c.remaining === null ? '–' : c.remaining < 0 ? `−${formatNumber(-c.remaining, base)}` : formatNumber(c.remaining, base)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div>
          {s.insights.length > 0 && (
            <Card title="Insights" flush>
              {s.insights.map((i: Insight) => {
                const Icon = INSIGHT_ICON[i.kind];
                return (
                  <div key={i.text} className="insight" data-kind={i.kind}>
                    <Icon size={16} />
                    <span>{i.text}</span>
                  </div>
                );
              })}
            </Card>
          )}
          {s.topNotes.length > 0 && (
            <Card title="Top merchants" flush>
              {s.topNotes.map((n) => (
                <div key={n.name} className="list-row">
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {n.name} <span className="faint small">{n.count}×</span>
                  </span>
                  <span className="num" style={{ fontWeight: 500 }}>{m(n.total)}</span>
                </div>
              ))}
            </Card>
          )}
          {s.trend.some((t) => t.spent > 0) && (
            <Card title="Last six months" meta={state ? `Spending in ${base}` : undefined}>
              <MonthBars data={s.trend} currency={base} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
