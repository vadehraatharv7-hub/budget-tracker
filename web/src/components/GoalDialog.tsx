import { useState, type FormEvent } from 'react';
import { Dialog } from './Dialog';
import { parseAmount } from '@/lib/money';
import { localToday } from '@/lib/dates';

interface Props {
  open: boolean;
  currencyLabel: string;
  onClose: () => void;
  onSave: (body: { name: string; icon: string; target: string; saved: string; deadline: string }) => Promise<void>;
}

export function GoalDialog({ open, currencyLabel, onClose, onSave }: Props) {
  return (
    <Dialog open={open} title="New savings goal" onClose={onClose}>
      {open && <Form currencyLabel={currencyLabel} onClose={onClose} onSave={onSave} />}
    </Dialog>
  );
}

function Form({ currencyLabel, onClose, onSave }: Omit<Props, 'open'>) {
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [saved, setSaved] = useState('');
  const [deadline, setDeadline] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Give the goal a name.');
    if (!(parseAmount(target) > 0)) return setError('Enter a target amount greater than zero.');
    setBusy(true);
    await onSave({ name: name.trim(), icon: 'target', target, saved, deadline });
    setBusy(false);
    onClose();
  };

  return (
    <form onSubmit={submit}>
      <div className="dialog__body">
        <label className="field">
          <span className="field__label">Name</span>
          <input className="input" value={name} maxLength={60} autoFocus placeholder="Trip home" onChange={(e) => setName(e.target.value)} />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label className="field">
            <span className="field__label">Target ({currencyLabel})</span>
            <input className="input input--num" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">Already saved</span>
            <input className="input input--num" inputMode="decimal" value={saved} placeholder="0" onChange={(e) => setSaved(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span className="field__label">Deadline (optional)</span>
          <input className="input" type="date" min={localToday()} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          <span className="field__hint">With a deadline, we show how much to set aside each month.</span>
        </label>
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
          Create goal
        </button>
      </div>
    </form>
  );
}
