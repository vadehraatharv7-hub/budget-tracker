import { createContext, useCallback, useContext, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog } from './Dialog';
import { CategoryIcon } from './CategoryIcon';
import { useToast } from './Toast';
import { useAppState, useExpenses } from '@/hooks/data';
import { api, isNetworkError } from '@/lib/api';
import { currentMonth, localToday } from '@/lib/dates';
import { convert, formatMoney, parseAmount } from '@/lib/money';
import { learnedCategory, parseQuick } from '@/lib/parseQuick';
import { enqueue } from '@/lib/queue';
import type { Currency, Expense, Income, Kind, NewEntry } from '@/lib/types';

export interface EntryTarget {
  kind: Kind;
  expense?: Expense;
  income?: Income;
}

const EntryContext = createContext<{ open: (target?: Partial<EntryTarget>) => void }>({ open: () => undefined });
export const useEntryDialog = () => useContext(EntryContext);

export function EntryProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<EntryTarget | null>(null);
  const open = useCallback((t?: Partial<EntryTarget>) => setTarget({ kind: 'expense', ...t }), []);
  const value = useMemo(() => ({ open }), [open]);
  return (
    <EntryContext.Provider value={value}>
      {children}
      <EntryDialog target={target} onClose={() => setTarget(null)} />
    </EntryContext.Provider>
  );
}

function EntryDialog({ target, onClose }: { target: EntryTarget | null; onClose: () => void }) {
  const editing = !!(target?.expense || target?.income);
  const title = editing ? (target?.income ? 'Edit income' : 'Edit expense') : 'Add transaction';
  return (
    <Dialog open={!!target} title={title} onClose={onClose}>
      {target && <EntryForm key={`${target.kind}-${target.expense?.id ?? target.income?.id ?? 'new'}`} target={target} onClose={onClose} />}
    </Dialog>
  );
}

function EntryForm({ target, onClose }: { target: EntryTarget; onClose: () => void }) {
  const { data: state } = useAppState();
  const { data: history = [] } = useExpenses(currentMonth());
  const qc = useQueryClient();
  const toast = useToast();
  const existing = target.expense ?? target.income;
  const base = state?.settings.base_currency ?? 'DKK';

  const [kind, setKind] = useState<Kind>(target.kind);
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '');
  const [currency, setCurrency] = useState<Currency>(() => {
    if (existing) return existing.currency;
    try {
      const saved = localStorage.getItem('bt_cur');
      return saved === 'INR' || saved === 'DKK' ? saved : base;
    } catch {
      return base;
    }
  });
  const [categoryId, setCategoryId] = useState<number | null>(target.expense?.category_id ?? null);
  const [note, setNote] = useState(target.expense?.note ?? target.income?.source ?? '');
  const [date, setDate] = useState(existing?.date ?? localToday());
  const [quick, setQuick] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const categories = useMemo(() => {
    const cats = state?.categories ?? [];
    const rank = new Map((state?.usage ?? []).map((id, i) => [id, i]));
    return [...cats].sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999) || a.sort - b.sort);
  }, [state]);

  const value = parseAmount(amount);
  const preview =
    state?.rate && Number.isFinite(value) && value > 0 && currency !== base
      ? `≈ ${formatMoney(convert(value, currency, base, state.rate.dkk_inr), base, 2)} at ${state.rate.override ? 'your' : "today's"} rate`
      : '';

  const applyQuick = () => {
    const r = parseQuick(quick, categories, history);
    if (!r) {
      setError('Start with an amount, for example "120 netto groceries".');
      return;
    }
    setError('');
    setAmount(r.amount);
    if (r.currency) setCurrency(r.currency);
    if (r.categoryId) setCategoryId(r.categoryId);
    setNote(r.note);
    setQuick('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!(value > 0)) {
      setError('Enter an amount greater than zero.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      localStorage.setItem('bt_cur', currency);
    } catch {
      /* ignore */
    }
    const isIncome = kind === 'income';
    const body: NewEntry & { source?: string } = isIncome
      ? { amount, currency, source: note.trim(), date }
      : { amount, currency, category_id: categoryId, category: categoryId, note: note.trim(), date };
    const path = isIncome ? '/api/income' : '/api/expenses';
    try {
      if (existing) await api(`${path}/${existing.id}`, { method: 'PUT', body });
      else await api(path, { method: 'POST', body });
      await qc.invalidateQueries();
      toast.push(existing ? 'Changes saved.' : isIncome ? 'Income added.' : 'Expense added.');
      onClose();
    } catch (err) {
      if (!existing && !isIncome && isNetworkError(err)) {
        enqueue(body);
        toast.push('You are offline. The expense is saved on this device and will sync later.');
        onClose();
      } else {
        setError(err instanceof Error ? err.message : 'Could not save.');
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing || !window.confirm('Delete this transaction? This cannot be undone.')) return;
    setBusy(true);
    try {
      await api(`${kind === 'income' ? '/api/income' : '/api/expenses'}/${existing.id}`, { method: 'DELETE' });
      await qc.invalidateQueries();
      toast.push('Transaction deleted.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <div className="dialog__body">
        {!existing && (
          <div className="seg" role="group" aria-label="Type" style={{ justifySelf: 'start' }}>
            <button type="button" aria-pressed={kind === 'expense'} onClick={() => setKind('expense')}>
              Expense
            </button>
            <button type="button" aria-pressed={kind === 'income'} onClick={() => setKind('income')}>
              Income
            </button>
          </div>
        )}

        {!existing && kind === 'expense' && (
          <label className="field">
            <span className="field__label">Quick entry</span>
            <input
              className="input"
              value={quick}
              onChange={(e) => setQuick(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyQuick();
                }
              }}
              placeholder="120 netto groceries"
              autoComplete="off"
              enterKeyHint="done"
            />
            <span className="field__hint">Type an amount, merchant and category, then press Enter to fill the form.</span>
          </label>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'end' }}>
          <label className="field">
            <span className="field__label">Amount</span>
            <input
              className="input input--num"
              style={{ height: 44, fontSize: 20, fontWeight: 600 }}
              inputMode="decimal"
              autoComplete="off"
              autoFocus={!existing}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              aria-invalid={!!error && !(value > 0)}
            />
          </label>
          <div className="seg" role="group" aria-label="Currency" style={{ height: 44, alignItems: 'center' }}>
            {(['DKK', 'INR'] as const).map((c) => (
              <button key={c} type="button" aria-pressed={currency === c} onClick={() => setCurrency(c)}>
                {c}
              </button>
            ))}
          </div>
        </div>
        {preview && <p className="small muted" style={{ marginTop: -8 }}>{preview}</p>}

        {kind === 'expense' && (
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field__label">Category</legend>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="btn btn--sm"
                  aria-pressed={categoryId === c.id}
                  onClick={() => setCategoryId(categoryId === c.id ? null : c.id)}
                  style={categoryId === c.id ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)' } : undefined}
                >
                  <CategoryIcon slug={c.icon} color={c.color} size="sm" />
                  {c.name}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px', gap: 12 }}>
          <label className="field">
            <span className="field__label">{kind === 'income' ? 'Source' : 'Description'}</span>
            <input
              className="input"
              value={note}
              maxLength={120}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => {
                if (kind === 'expense' && categoryId === null) {
                  const learned = learnedCategory(note, history);
                  if (learned) setCategoryId(learned);
                }
              }}
              placeholder={kind === 'income' ? 'Salary, SU, transfer from home' : 'Merchant or note'}
              list="entry-notes"
            />
            <datalist id="entry-notes">
              {[...new Set(history.map((h) => h.note).filter(Boolean))].slice(0, 30).map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span className="field__label">Date</span>
            <input className="input" type="date" value={date} max={localToday()} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>

        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="dialog__footer">
        {existing && (
          <button type="button" className="btn btn--danger" onClick={remove} disabled={busy}>
            Delete
          </button>
        )}
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {existing ? 'Save changes' : kind === 'income' ? 'Add income' : 'Add expense'}
        </button>
      </div>
    </form>
  );
}
