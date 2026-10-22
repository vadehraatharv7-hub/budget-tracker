import { useCallback, useEffect, useRef, useState } from 'react';
import { Delete, Fingerprint } from 'lucide-react';
import { PIN_LENGTH } from '@/lib/lock';

export type PinResult = true | string | { info: string };

interface Props {
  title: string;
  subtitle?: string;
  /** Resolve true to accept, a string to show an error, or {info} for a neutral prompt (for example "enter it again"). */
  onComplete: (pin: string) => Promise<PinResult>;
  onBiometric?: () => Promise<boolean>;
  onCancel?: () => void;
}

export function PinPad({ title, subtitle = '', onComplete, onBiometric, onCancel }: Props) {
  const [entry, setEntry] = useState('');
  const [message, setMessage] = useState(subtitle);
  const [bad, setBad] = useState(false);
  const [shake, setShake] = useState(false);
  const busy = useRef(false);

  useEffect(() => setMessage(subtitle), [subtitle]);

  const submit = useCallback(
    async (pin: string) => {
      busy.current = true;
      const result = await onComplete(pin);
      busy.current = false;
      if (result === true) return;
      setEntry('');
      if (typeof result === 'object') {
        setBad(false);
        setMessage(result.info);
        return;
      }
      setBad(true);
      setMessage(result);
      setShake(true);
      window.setTimeout(() => setShake(false), 400);
      navigator.vibrate?.(60);
    },
    [onComplete],
  );

  const press = useCallback(
    (key: string) => {
      if (busy.current) return;
      if (key === 'del') return setEntry((e) => e.slice(0, -1));
      setEntry((e) => {
        if (e.length >= PIN_LENGTH) return e;
        const next = e + key;
        if (next.length === PIN_LENGTH) void submit(next);
        return next;
      });
    },
    [submit],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Escape' && onCancel) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press, onCancel]);

  const tryBiometric = useCallback(async () => {
    if (!onBiometric) return;
    try {
      await onBiometric();
    } catch {
      /* cancelled: the PIN pad stays available */
    }
  }, [onBiometric]);

  useEffect(() => {
    void tryBiometric();
  }, [tryBiometric]);

  return (
    <div className="lock">
      <img src="/icons/icon-192.png" alt="" />
      <h1>{title}</h1>
      <p className="lock__sub" data-bad={bad} role="status">
        {message}
      </p>
      <div className="lock__dots" data-shake={shake} aria-hidden="true">
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <i key={i} data-on={i < entry.length} />
        ))}
      </div>
      <div className="lock__keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
          <button key={k} type="button" onClick={() => press(k)} aria-label={k}>
            {k}
          </button>
        ))}
        {onBiometric ? (
          <button type="button" className="alt" onClick={() => void tryBiometric()} aria-label="Use Face ID or Touch ID">
            <Fingerprint size={22} />
          </button>
        ) : onCancel ? (
          <button type="button" className="alt" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <span />
        )}
        <button type="button" onClick={() => press('0')} aria-label="0">
          0
        </button>
        <button type="button" className="alt" onClick={() => press('del')} aria-label="Delete">
          <Delete size={20} />
        </button>
      </div>
    </div>
  );
}
