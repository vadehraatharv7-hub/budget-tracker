import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PinPad } from './PinPad';
import { biometricEnabled, checkPin, getLockTimeout, lockEnabled, verifyBiometric } from '@/lib/lock';

interface LockApi {
  lockNow: () => void;
  /** Call after turning the lock on or off so the UI re-reads it. */
  refresh: () => void;
  version: number;
}

const LockContext = createContext<LockApi>({ lockNow: () => undefined, refresh: () => undefined, version: 0 });
export const useLock = () => useContext(LockContext);

export function LockProvider({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(() => lockEnabled());
  const [version, setVersion] = useState(0);
  const hiddenAt = useRef(0);

  const lockNow = useCallback(() => {
    if (lockEnabled()) setLocked(true);
  }, []);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  // Re-lock after the chosen time in the background ("0" = as soon as the app is hidden, which also blanks the app switcher).
  useEffect(() => {
    const onVisibility = () => {
      if (!lockEnabled()) return;
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
        if (getLockTimeout() === 0) setLocked(true);
      } else if (hiddenAt.current && Date.now() - hiddenAt.current >= getLockTimeout() * 60_000) {
        setLocked(true);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('is-locked', locked);
  }, [locked]);

  const api = useMemo(() => ({ lockNow, refresh, version }), [lockNow, refresh, version]);

  return (
    <LockContext.Provider value={api}>
      <div inert={locked} aria-hidden={locked}>
        {children}
      </div>
      {locked && (
        <div className="lockscreen" role="dialog" aria-modal="true" aria-label="Locked">
          <PinPad
            title="Budget is locked"
            subtitle="Enter your PIN"
            onComplete={async (pin) => {
              const r = await checkPin(pin);
              if (r === true) setLocked(false);
              return r;
            }}
            onBiometric={
              biometricEnabled()
                ? async () => {
                    const ok = await verifyBiometric();
                    if (ok) setLocked(false);
                    return ok;
                  }
                : undefined
            }
          />
        </div>
      )}
    </LockContext.Provider>
  );
}
