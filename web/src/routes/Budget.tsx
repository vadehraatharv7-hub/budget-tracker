import { useState, type FormEvent } from 'react';
import { Pause, Play, Plus, Repeat, Target, Trash2 } from 'lucide-react';
import { Card } from '@/components/Card';
import { CategoryDialog } from '@/components/CategoryDialog';
import { CategoryIcon } from '@/components/CategoryIcon';
import { Dialog } from '@/components/Dialog';
import { EmptyState } from '@/components/EmptyState';
import { GoalDialog } from '@/components/GoalDialog';
import { PageHeader } from '@/components/PageHeader';
import { PeriodPicker } from '@/components/PeriodPicker';
import { Progress } from '@/components/Progress';
import { RecurringDialog } from '@/components/RecurringDialog';
import { Allocation } from '@/components/charts/Allocation';
import { useAction } from '@/hooks/useAction';
import { useAppState, useGoals, useMonth, useRecurring, useSummary } from '@/hooks/data';
import { api } from '@/lib/api';
import { monthLabel, monthsUntil, shiftMonth } from '@/lib/dates';
import { formatMoney, formatNumber, parseAmount } from '@/lib/money';
import type { Category, Goal, Recurring } from '@/lib/types';

export function Budget() {
  const [month, setMonth] = useMonth();
  const { data: state } = useAppState();
  const summary = useSummary(month);
  const recurring = useRecurring();
  const goals = useGoals();
  const run = useAction();
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [recOpen, setRecOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [fundGoal, setFundGoal] = useState<Goal | null>(null);

  if (!state) return <div className="skeleton" style={{ height: 320 }} />;
  const base = state.settings.base_currency;
  const cats = state.categories;
  const total = state.settings.monthly_budget;
  const allocated = cats.reduce((t, c) => t + c.budget, 0);
  const target = total > 0 ? total : allocated;
  const left = target - allocated;
  const m = (n: number) => formatMoney(n, base);
  const stat = new Map((summary.data?.categories ?? []).map((c) => [c.id, c]));
  const prevMonth = monthLabel(shiftMonth(month, -1), 'short');
  const symbol = base === 'INR' ? '₹' : 'kr';

  const saveTotal = (value: string) => {
    const v = value.trim() === '' ? 0 : parseAmount(value);
    if (!Number.isFinite(v) || v < 0 || v === total) return;
    void run(() => api('/api/settings', { method: 'PUT', body: { monthly_budget: v } }), 'Monthly budget saved.');
  };
  const saveLimit = (c: Category, value: string) => {
    const v = value.trim() === '' ? 0 : parseAmount(value);
    if (!Number.isFinite(v) || v < 0 || v === c.budget) return;
    void run(() => api(`/api/categories/${c.id}`, { method: 'PUT', body: { budget: v } }), `${c.name} limit saved.`);
  };

  return (
    <>
      <PageHeader title="Budget" description="Decide how much each category gets, then watch it in Overview." actions={<PeriodPicker month={month} onChange={setMonth} />} />
      <div className="two-col">
        <div>
          <Card title="Monthly budget">
            <label className="field">
              <span className="field__label">Total to spend each month</span>
              <span className="big-input">
                {base === 'INR' && <span>{symbol}</span>}
                <input key={total} className="num" inputMode="decimal" defaultValue={total || ''} placeholder="0" aria-label="Monthly budget" onBlur={(e) => saveTotal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
                {base !== 'INR' && <span>{base}</span>}
              </span>
            </label>
            <div style={{ marginTop: 16 }}>
              <Allocation categories={cats} total={target} currency={base} />
            </div>
            <div className="row-flex" style={{ marginTop: 14, flexWrap: 'wrap' }}>
              {allocated === 0 ? (
                <span className="badge badge--info">Next: give each category a limit</span>
              ) : left >= 0 ? (
                <>
                  <span className="badge badge--pos">{m(allocated)} assigned</span>
                  <span className="badge">{m(left)} unassigned</span>
                </>
              ) : (
                <span className="badge badge--neg">
                  {m(allocated)} assigned, {m(-left)} more than the total
                </span>
              )}
            </div>
          </Card>

          <Card
            title="Category limits"
            meta={
              <button type="button" className="btn btn--sm" onClick={() => setEditing('new')}>
                <Plus size={14} /> Category
              </button>
            }
            flush
          >
            <div className="only-desktop">
            <table className="table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="num hide-sm">Spent</th>
                    <th className="num" style={{ width: 150 }}>
                      Monthly limit
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {cats.map((c) => {
                    const st = stat.get(c.id);
                    const spent = st?.spent ?? 0;
                    const prev = st?.prev ?? 0;
                    const suggestion = Math.round(prev * 0.9);
                    return (
                      <tr key={c.id}>
                        <td>
                          <div className="cat-name">
                            <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)} style={{ width: 'auto', padding: 0, height: 'auto' }}>
                              <CategoryIcon slug={c.icon} color={c.color} />
                            </button>
                            <span>{c.name}</span>
                          </div>
                          {c.budget > 0 && <Progress value={spent / c.budget} label={`${c.name} budget used`} style={{ marginTop: 8, marginLeft: 44 }} />}
                          <div className="small faint meta-line" style={{ marginLeft: 44, marginTop: 4 }}>
                            <span className="num">{m(spent)} spent</span>
                            {prev > 0 && (
                              <>
                                {' · '}
                                <span className="num">
                                  {m(prev)} in {prevMonth}
                                </span>
                                {suggestion !== c.budget && (
                                  <>
                                    {' · '}
                                    <button type="button" className="link-btn" style={{ fontSize: 12 }} onClick={() => saveLimit(c, String(suggestion))}>
                                      Set to 90% ({formatNumber(suggestion, base)})
                                    </button>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                        <td className="num hide-sm">{formatNumber(spent, base)}</td>
                        <td>
                          <div className="input-group limit-input">
                            <input key={`${c.id}-${c.budget}`} className="input input--num" inputMode="decimal" defaultValue={c.budget || ''} placeholder="0" aria-label={`Monthly limit for ${c.name}`} onBlur={(e) => saveLimit(c, e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
                            <span className="input-group__suffix">{base}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="only-mobile">
              {cats.map((c) => {
                const st = stat.get(c.id);
                const spent = st?.spent ?? 0;
                const prev = st?.prev ?? 0;
                const suggestion = Math.round(prev * 0.9);
                return (
                  <div key={c.id} className="limit-row">
                    <div className="limit-row__top">
                      <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)} style={{ width: 'auto', padding: 0, height: 'auto' }}>
                        <CategoryIcon slug={c.icon} color={c.color} />
                      </button>
                      <div className="limit-row__name">
                        <div style={{ fontWeight: 500 }}>{c.name}</div>
                        <div className="small faint num">{m(spent)} spent</div>
                      </div>
                      <div className="input-group limit-input">
                        <input key={`${c.id}-${c.budget}`} className="input input--num" inputMode="decimal" defaultValue={c.budget || ''} placeholder="0" aria-label={`Monthly limit for ${c.name}`} onBlur={(e) => saveLimit(c, e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
                        <span className="input-group__suffix">{base}</span>
                      </div>
                    </div>
                    {c.budget > 0 && <Progress value={spent / c.budget} label={`${c.name} budget used`} style={{ marginTop: 10 }} />}
                    {prev > 0 && (
                      <div className="small faint num meta-line" style={{ marginTop: 8 }}>
                        {m(prev)} in {prevMonth}
                        {suggestion !== c.budget && (
                          <>
                                                        <button type="button" className="link-btn" style={{ fontSize: 12 }} onClick={() => saveLimit(c, String(suggestion))}>
                              Set to 90% ({formatNumber(suggestion, base)})
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <div>
          <Card
            title="Recurring"
            meta={
              <button type="button" className="btn btn--sm" onClick={() => setRecOpen(true)}>
                <Plus size={14} /> Add
              </button>
            }
            flush
          >
            {(recurring.data ?? []).length === 0 ? (
              <EmptyState icon={Repeat} title="No recurring items">
                Rent, subscriptions or a monthly transfer are added for you each month.
              </EmptyState>
            ) : (
              (recurring.data ?? []).map((r: Recurring) => {
                const c = cats.find((x) => x.id === r.category_id);
                return (
                  <div key={r.id} className="list-row">
                    <div className="row-flex" style={{ minWidth: 0 }}>
                      {r.kind === 'income' ? <span className="cat-icon" style={{ background: 'var(--pos-soft)', color: 'var(--pos)' }}>+</span> : <CategoryIcon slug={c?.icon ?? 'tag'} color={c?.color ?? '#8b8a85'} />}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.note || c?.name || 'Recurring'} {!r.active && <span className="badge">Paused</span>}
                        </div>
                        <div className="small faint num">
                          {r.kind === 'income' ? 'Income' : c?.name ?? 'Uncategorised'} {'·'} day {r.day} {'·'} {formatMoney(r.amount, r.currency)}
                        </div>
                      </div>
                    </div>
                    <div className="row-flex">
                      <button type="button" className="btn btn--sm btn--icon" aria-label={r.active ? 'Pause' : 'Resume'} onClick={() => void run(() => api(`/api/recurring/${r.id}`, { method: 'PUT', body: { active: !r.active } }))}>
                        {r.active ? <Pause size={14} /> : <Play size={14} />}
                      </button>
                      <button type="button" className="btn btn--sm btn--icon btn--danger" aria-label="Remove" onClick={() => window.confirm('Remove this recurring item? Entries already created stay.') && void run(() => api(`/api/recurring/${r.id}`, { method: 'DELETE' }), 'Recurring item removed.')}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </Card>

          <Card
            title="Savings goals"
            meta={
              <button type="button" className="btn btn--sm" onClick={() => setGoalOpen(true)}>
                <Plus size={14} /> Goal
              </button>
            }
            flush
          >
            {(goals.data ?? []).length === 0 ? (
              <EmptyState icon={Target} title="No savings goals">
                Set a target and a deadline to see how much to put aside each month.
              </EmptyState>
            ) : (
              (goals.data ?? []).map((g) => {
                const remaining = Math.max(0, g.target - g.saved);
                const months = g.deadline ? monthsUntil(g.deadline) : 0;
                return (
                  <div key={g.id} className="list-row" style={{ alignItems: 'stretch', flexDirection: 'column', gap: 8 }}>
                    <div className="row-flex">
                      <span style={{ fontWeight: 500, flex: 1 }}>{g.name}</span>
                      <span className="num small muted">
                        {m(g.saved)} of {m(g.target)}
                      </span>
                    </div>
                    <Progress value={g.saved / g.target} label={`${g.name} progress`} />
                    <div className="row-flex">
                      <span className="small muted num" style={{ flex: 1 }}>
                        {remaining === 0 ? 'Goal reached' : g.deadline ? `Set aside ${m(remaining / months)} a month for ${months} ${months === 1 ? 'month' : 'months'}` : `${m(remaining)} to go`}
                      </span>
                      <button type="button" className="btn btn--sm" onClick={() => setFundGoal(g)}>
                        Add funds
                      </button>
                      <button type="button" className="btn btn--sm btn--icon btn--danger" aria-label="Remove goal" onClick={() => window.confirm(`Remove "${g.name}"?`) && void run(() => api(`/api/goals/${g.id}`, { method: 'DELETE' }), 'Goal removed.')}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </Card>
        </div>
      </div>

      <CategoryDialog
        open={editing !== null}
        category={editing && editing !== 'new' ? editing : null}
        onClose={() => setEditing(null)}
        onSave={async (v) => {
          await run(
            () => (editing && editing !== 'new' ? api(`/api/categories/${editing.id}`, { method: 'PUT', body: v }) : api('/api/categories', { method: 'POST', body: v })),
            'Category saved.',
          );
        }}
        onDelete={editing && editing !== 'new' ? async () => void (await run(() => api(`/api/categories/${editing.id}`, { method: 'DELETE' }), 'Category removed.')) : undefined}
      />
      <RecurringDialog open={recOpen} categories={cats} baseCurrency={base} onClose={() => setRecOpen(false)} onSave={async (b) => void (await run(() => api('/api/recurring', { method: 'POST', body: b }), 'Recurring item added.'))} />
      <GoalDialog open={goalOpen} currencyLabel={base} onClose={() => setGoalOpen(false)} onSave={async (b) => void (await run(() => api('/api/goals', { method: 'POST', body: b }), 'Goal created.'))} />
      <FundDialog goal={fundGoal} onClose={() => setFundGoal(null)} onSave={async (amount) => void (await run(() => api(`/api/goals/${fundGoal?.id}/contribute`, { method: 'POST', body: { amount } }), 'Funds added.'))} />
    </>
  );
}

function FundDialog({ goal, onClose, onSave }: { goal: Goal | null; onClose: () => void; onSave: (amount: string) => Promise<void> }) {
  return (
    <Dialog open={!!goal} title={goal ? `Add funds to ${goal.name}` : ''} onClose={onClose}>
      {goal && <FundForm onClose={onClose} onSave={onSave} />}
    </Dialog>
  );
}

function FundForm({ onClose, onSave }: { onClose: () => void; onSave: (amount: string) => Promise<void> }) {
  const [amount, setAmount] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!Number.isFinite(parseAmount(amount)) || parseAmount(amount) === 0) return;
    await onSave(amount);
    onClose();
  };
  return (
    <form onSubmit={submit}>
      <div className="dialog__body">
        <label className="field">
          <span className="field__label">Amount</span>
          <input className="input input--num" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
          <span className="field__hint">Use a negative amount to withdraw.</span>
        </label>
      </div>
      <div className="dialog__footer">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary">
          Add funds
        </button>
      </div>
    </form>
  );
}
