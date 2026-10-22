import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/Card';
import { PageHeader } from '@/components/PageHeader';
import { PinDialog } from '@/components/PinDialog';
import { useLock } from '@/components/LockProvider';
import { useToast } from '@/components/Toast';
import { useAction } from '@/hooks/useAction';
import { useAppState } from '@/hooks/data';
import { api } from '@/lib/api';
import { biometricAvailable, biometricEnabled, disableBiometric, enableBiometric, getLockTimeout, lockEnabled, lockSupported, removeLock, setLockTimeout } from '@/lib/lock';
import { disablePush, enablePush, getPushState, sendTestPush, type PushState } from '@/lib/push';
import { getTheme, setTheme, type ThemeChoice } from '@/lib/theme';
import type { Currency, Settings as SettingsType } from '@/lib/types';

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

function Setting({ label, text, children }: { label: string; text?: ReactNode; children?: ReactNode }) {
  return (
    <div className="setting">
      <div className="setting__text">
        <div className="setting__label">{label}</div>
        {text && <p>{text}</p>}
      </div>
      {children}
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

export function Settings() {
  const { data: state } = useAppState();
  const run = useAction();
  const toast = useToast();
  const lock = useLock();
  const session = useQuery({ queryKey: ['session'], queryFn: () => api<{ authed: boolean; passwordRequired: boolean }>('/api/session') });
  const [push, setPush] = useState<PushState>('off');
  const [bioAvailable, setBioAvailable] = useState(false);
  const [pin, setPinDialog] = useState<{ mode: 'set' | 'verify'; then: () => void; title?: string } | null>(null);
  const [theme, setThemeState] = useState<ThemeChoice>(getTheme());
  const [revealToken, setRevealToken] = useState(false);

  useEffect(() => {
    void getPushState().then(setPush);
    void biometricAvailable().then(setBioAvailable);
  }, []);

  if (!state) return <div className="skeleton" style={{ height: 320 }} />;
  const s = state.settings;
  const update = (patch: Partial<SettingsType> | Record<string, unknown>, ok = 'Saved.') => run(() => api('/api/settings', { method: 'PUT', body: patch }), ok);
  const locked = lockEnabled();
  const origin = location.origin;

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.push(`${what} copied.`);
    } catch {
      toast.push('Copy failed. Select the text and copy it manually.', 'error');
    }
  };

  const pushNote: Record<PushState, string> = {
    unsupported: isIOS && !isStandalone ? 'On iPhone, add this app to your Home Screen first, then open it from there to enable notifications.' : 'This browser does not support push notifications, or the page is not served over HTTPS.',
    denied: 'Notifications are blocked for this site. Re-enable them in your browser or iOS settings.',
    off: 'Get budget alerts and a daily reminder on this device.',
    on: 'Notifications are enabled on this device.',
  };

  return (
    <>
      <PageHeader title="Settings" description="Security, notifications, preferences and integrations." />
      <div className="two-col">
        <div>
          <Card title="Security" flush>
            {!lockSupported() ? (
              <Setting label="App lock" text="App lock needs a secure connection (HTTPS or localhost)." />
            ) : (
              <>
                <Setting label="App lock" text={locked ? 'Locked with a 6-digit PIN on this device.' : 'Require a PIN (and Face ID or Touch ID) to open the app on this device.'}>
                  {locked ? (
                    <div className="row-flex">
                      <button className="btn btn--sm" onClick={lock.lockNow}>
                        Lock now
                      </button>
                      <button className="btn btn--sm" onClick={() => setPinDialog({ mode: 'verify', title: 'Change PIN', then: () => setTimeout(() => setPinDialog({ mode: 'set', then: () => lock.refresh() }), 50) })}>
                        Change PIN
                      </button>
                      <button
                        className="btn btn--sm btn--danger"
                        onClick={() =>
                          setPinDialog({
                            mode: 'verify',
                            title: 'Turn off app lock',
                            then: () => {
                              removeLock();
                              lock.refresh();
                              toast.push('App lock is off.');
                            },
                          })
                        }
                      >
                        Turn off
                      </button>
                    </div>
                  ) : (
                    <button className="btn btn--primary btn--sm" onClick={() => setPinDialog({ mode: 'set', then: () => (lock.refresh(), toast.push('App lock is on.')) })}>
                      Set a PIN
                    </button>
                  )}
                </Setting>
                {locked && (
                  <>
                    <Setting label="Face ID / Touch ID" text={bioAvailable ? 'Unlock with biometrics. The PIN remains the fallback.' : 'Not available on this device.'}>
                      <Switch
                        label="Face ID or Touch ID"
                        checked={biometricEnabled()}
                        onChange={(on) => {
                          if (!on) {
                            disableBiometric();
                            lock.refresh();
                            return;
                          }
                          setPinDialog({
                            mode: 'verify',
                            title: 'Enable biometrics',
                            then: () => {
                              enableBiometric()
                                .then(() => (lock.refresh(), toast.push('Biometric unlock is on.')))
                                .catch((e: Error) => toast.push(e.name === 'NotAllowedError' ? 'Cancelled.' : e.message, 'error'));
                            },
                          });
                        }}
                      />
                    </Setting>
                    <Setting label="Lock after">
                      <select className="select" style={{ width: 'auto' }} aria-label="Lock after" value={getLockTimeout()} onChange={(e) => (setLockTimeout(Number(e.target.value)), lock.refresh())}>
                        <option value={0}>Leaving the app</option>
                        <option value={1}>1 minute</option>
                        <option value={5}>5 minutes</option>
                        <option value={15}>15 minutes</option>
                      </select>
                    </Setting>
                  </>
                )}
              </>
            )}
            {session.data?.passwordRequired && (
              <Setting label="Session" text="Sign out of this browser. You will need the password to come back.">
                <button
                  className="btn btn--sm"
                  onClick={async () => {
                    await api('/api/logout', { method: 'POST' }).catch(() => undefined);
                    for (const k of await caches.keys()) await caches.delete(k);
                    location.href = '/';
                  }}
                >
                  Sign out
                </button>
              </Setting>
            )}
          </Card>

          <Card title="Notifications" flush>
            <Setting label="Push notifications" text={pushNote[push]}>
              {push === 'off' && (
                <button className="btn btn--primary btn--sm" onClick={() => enablePush(state.vapidPublicKey).then(() => setPush('on')).then(() => toast.push('Notifications enabled.')).catch((e: Error) => toast.push(e.message, 'error'))}>
                  Enable
                </button>
              )}
              {push === 'on' && (
                <div className="row-flex">
                  <button className="btn btn--sm" onClick={() => sendTestPush().then((r) => toast.push(r.sent ? 'Test notification sent.' : 'No device is subscribed.')).catch((e: Error) => toast.push(e.message, 'error'))}>
                    Send test
                  </button>
                  <button className="btn btn--sm" onClick={() => disablePush().then(() => setPush('off')).then(() => toast.push('Notifications turned off.'))}>
                    Turn off
                  </button>
                </div>
              )}
            </Setting>
            <Setting label="Budget alerts" text="When a category or the monthly total reaches 75% and 100%.">
              <Switch label="Budget alerts" checked={s.alert_thresholds} onChange={(v) => void update({ alert_thresholds: v })} />
            </Setting>
            <Setting label="Daily reminder" text="A nudge to record spending, with your daily allowance.">
              <Switch label="Daily reminder" checked={s.daily_reminder} onChange={(v) => void update({ daily_reminder: v })} />
            </Setting>
            <Setting label="Reminder time">
              <input className="input" type="time" style={{ width: 'auto' }} aria-label="Reminder time" defaultValue={s.reminder_time} key={s.reminder_time} onBlur={(e) => e.target.value && e.target.value !== s.reminder_time && void update({ reminder_time: e.target.value })} />
            </Setting>
            <Setting label="Weekly summary" text="Sent on Sundays with one suggestion.">
              <Switch label="Weekly summary" checked={s.weekly_recap} onChange={(v) => void update({ weekly_recap: v })} />
            </Setting>
          </Card>

          <Card title="Preferences" flush>
            <Setting label="Base currency" text="Budgets and totals use this currency. It can only change while there are no transactions.">
              <select
                className="select"
                style={{ width: 'auto' }}
                aria-label="Base currency"
                value={s.base_currency}
                onChange={(e) => void update({ base_currency: e.target.value as Currency }, 'Base currency changed.')}
              >
                <option>DKK</option>
                <option>INR</option>
              </select>
            </Setting>
            <Setting label="Appearance">
              <select className="select" style={{ width: 'auto' }} aria-label="Appearance" value={theme} onChange={(e) => (setTheme(e.target.value as ThemeChoice), setThemeState(e.target.value as ThemeChoice))}>
                <option value="auto">Match system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </Setting>
          </Card>
        </div>

        <div>
          <Card title="iPhone Shortcuts" flush>
            <Setting label="Server address">
              <code className="num small">{origin}</code>
            </Setting>
            <Setting label="API token" text="Authorises the Shortcuts app. Treat it like a password.">
              <div className="row-flex">
                <button className="btn btn--sm" onClick={() => setRevealToken((v) => !v)}>
                  {revealToken ? 'Hide' : 'Reveal'}
                </button>
                <button className="btn btn--sm" onClick={() => void copy(state.apiToken, 'Token')}>
                  Copy
                </button>
                <button
                  className="btn btn--sm btn--danger"
                  onClick={() => window.confirm('Generate a new token? Existing Shortcuts stop working until you paste the new one.') && void run(() => api('/api/token/regenerate', { method: 'POST' }), 'New token generated.')}
                >
                  Regenerate
                </button>
              </div>
            </Setting>
            {revealToken && (
              <div style={{ padding: '0 20px 14px' }}>
                <pre className="code-block">{state.apiToken}</pre>
              </div>
            )}
            <div style={{ padding: '4px 20px 20px' }}>
              <h3 style={{ marginBottom: 8 }}>Set up a shortcut</h3>
              <ol className="steps small">
                <li>In Shortcuts, create a shortcut named Add expense.</li>
                <li>Add Ask for Input (type Number), then Choose from List with your category names.</li>
                <li>
                  Add Get Contents of URL: <code>{origin}/api/shortcuts/expense</code>, method POST, header <code>Authorization: Bearer &lt;token&gt;</code>, JSON body with <code>amount</code>, <code>currency</code>, <code>category</code> and <code>note</code>.
                </li>
                <li>Add Show Result with the <code>message</code> value from the response.</li>
                <li>For hands-free use, assign it to the Action Button or Back Tap, or run it from a Wallet transaction automation.</li>
              </ol>
              <pre className="code-block" style={{ marginTop: 12 }}>{`curl -X POST ${origin}/api/shortcuts/expense \\\n  -H "Authorization: Bearer <token>" \\\n  -H "Content-Type: application/json" \\\n  -d '{"amount":"45","currency":"DKK","category":"Groceries"}'`}</pre>
            </div>
          </Card>

          <Card title="Data" flush>
            <Setting label="Export" text="Download your data. It is yours.">
              <div className="row-flex">
                <a className="btn btn--sm" href="/api/export.csv" download>
                  CSV
                </a>
                <a className="btn btn--sm" href="/api/backup.json" download>
                  Full backup
                </a>
              </div>
            </Setting>
            <Setting label="Import" text="A bank CSV with date, amount and description columns, or a full backup file.">
              <div className="row-flex">
                <label className="btn btn--sm">
                  CSV
                  <input
                    className="sr-only"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (!f) return;
                      const r = await run(async () => api<{ added: number; skipped: number }>('/api/import/csv', { method: 'POST', body: { csv: await f.text() } }));
                      if (r) toast.push(`Imported ${r.added} ${r.added === 1 ? 'transaction' : 'transactions'}${r.skipped ? `, skipped ${r.skipped}` : ''}.`);
                    }}
                  />
                </label>
                <label className="btn btn--sm">
                  Restore
                  <input
                    className="sr-only"
                    type="file"
                    accept=".json,application/json"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (!f || !window.confirm('Restore replaces ALL current data with this backup. Continue?')) return;
                      await run(async () => api('/api/restore', { method: 'POST', body: JSON.parse(await f.text()) }), 'Backup restored.');
                    }}
                  />
                </label>
              </div>
            </Setting>
          </Card>

          <Card title="About" flush>
            <Setting label="Install this app" text={isStandalone ? 'Installed on this device.' : isIOS ? 'In Safari, tap Share, then Add to Home Screen.' : 'Use your browser menu and choose Install.'} />
          </Card>
        </div>
      </div>
      <PinDialog
        mode={pin?.mode ?? null}
        title={pin?.title}
        onClose={() => setPinDialog(null)}
        onDone={() => {
          const next = pin;
          setPinDialog(null);
          next?.then();
        }}
      />
    </>
  );
}
