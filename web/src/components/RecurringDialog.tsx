import { useState, type FormEvent } from 'react';
import { Dialog } from './Dialog';
import { parseAmount } from '@/lib/money';
import type { Category, Currency, Kind } from '@/lib/types';

interface Props {
  open: boolean;
  categories: Category[];
  baseCurrency: Currency;
  onClose: () => void;
  onSave: (body: { kind: Kind; amount: string; currency: Currency; category_id: number | null; note: string; day: number }) => Promise<void>;
}

export function RecurringDialog({ open, categories, baseCurrency, onClose, onSave }: Props) {
  return (
    <Dialog open={open} title="New recurring item" onClose={onClose}>
      {open && <Form categories={categories} baseCurrency={baseCurrency} onClose={onClose} onSave={onSave} />}
    </Dialog>
  );
}

function Form({ categories, baseCurrency, onClose, onSave }: Omit<Props, 'open'>) {
  const [kind, setKind] = useState<Kind>('expense');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<Currency>(baseCurrency);
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const [day, setDay] = useState('1');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!(parseAmount(amount) > 0)) return setError('Enter an amount greater than zero.');
    const d = parseInt(day, 10);
    if (!(d >= 1 && d <= 31)) return setError('Day of month must be between 1 and 31.');
    setBusy(true);
    await onSave({ kind, amount, currency, category_id: categoryId === '' ? null : categoryId, note: note.trim(), day: d });
    setBusy(false);
    onClose();
  };

  return (
    <form onSubmit={submit}>
      <div className="dialog__body">
        <div className="seg" role="group" aria-label="Type" style={{ justifySelf: 'start' }}>
          <button type="button" aria-pressed={kind === 'expense'} onClick={() => setKind('expense')}>
            Expense
          </button>
          <button type="button" aria-pressed={kind === 'income'} onClick={() => setKind('income')}>
            Income
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 12 }}>
          <label className="field">
            <span className="field__label">Amount</span>
            <input className="input input--num" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">Currency</span>
            <select className="select" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
              <option>DKK</option>
              <option>INR</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span className="field__label">{kind === 'income' ? 'Source' : 'Description'}</span>
          <input className="input" value={note} maxLength={120} placeholder={kind === 'income' ? 'Salary' : 'Rent, phone plan, Spotify'} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 12 }}>
          {kind === 'expense' ? (
            <label className="field">
              <span className="field__label">Category</span>
              <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">Uncategorised</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span />
          )}
          <label className="field">
            <span className="field__label">Day of month</span>
            <input className="input input--num" inputMode="numeric" value={day} maxLength={2} onChange={(e) => setDay(e.target.value)} />
          </label>
        </div>
        <p className="small muted">An entry is added automatically on that day each month. In shorter months it is added on the last day.</p>
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="dialog__footer">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy}>
          Add recurring item
        </button>
      </div>
    </form>
  );
}
