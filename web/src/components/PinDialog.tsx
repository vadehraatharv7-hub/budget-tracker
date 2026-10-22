import { useRef } from 'react';
import { Dialog } from './Dialog';
import { PinPad, type PinResult } from './PinPad';
import { checkPin, setPin } from '@/lib/lock';

interface Props {
  mode: 'set' | 'verify' | null;
  title?: string;
  onClose: () => void;
  onDone: () => void;
}

/** Collects a PIN twice to set it, or asks for the current one before a sensitive change. */
export function PinDialog({ mode, title, onClose, onDone }: Props) {
  return (
    <Dialog open={mode !== null} title={title ?? (mode === 'set' ? 'Choose a PIN' : 'Confirm your PIN')} onClose={onClose}>
      {mode && <Pad key={mode} mode={mode} onClose={onClose} onDone={onDone} />}
    </Dialog>
  );
}

function Pad({ mode, onClose, onDone }: { mode: 'set' | 'verify'; onClose: () => void; onDone: () => void }) {
  const first = useRef<string | null>(null);
  const handle = async (pin: string): Promise<PinResult> => {
    if (mode === 'verify') {
      const r = await checkPin(pin);
      if (r === true) onDone();
      return r;
    }
    if (first.current === null) {
      first.current = pin;
      return { info: 'Enter it again to confirm.' };
    }
    if (first.current !== pin) {
      first.current = null;
      return 'The PINs did not match. Start again.';
    }
    await setPin(pin);
    onDone();
    return true;
  };
  return (
    <div className="dialog__body" style={{ paddingBottom: 28 }}>
      <PinPad title={mode === 'set' ? 'Choose a 6-digit PIN' : 'Enter your PIN'} subtitle={mode === 'set' ? 'You will use it to unlock this app on this device.' : 'Confirm it is you.'} onComplete={handle} onCancel={onClose} />
    </div>
  );
}
