import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, ChartPie, CloudOff, LayoutDashboard, Lock, Plus, ReceiptText, Settings } from 'lucide-react';
import { useEntryDialog } from './EntryDialog';
import { useLock } from './LockProvider';
import { useToast } from './Toast';
import { api } from '@/lib/api';
import { lockEnabled } from '@/lib/lock';
import { readQueue, writeQueue } from '@/lib/queue';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/transactions', label: 'Transactions', icon: ReceiptText },
  { to: '/budget', label: 'Budget', icon: ChartPie },
  { to: '/currency', label: 'Currency', icon: ArrowLeftRight },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function AppShell() {
  const { open } = useEntryDialog();
  const { lockNow, version } = useLock();
  const qc = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState(() => readQueue().length);
  const [params, setParams] = useSearchParams();

  // The home-screen shortcut "Add transaction" opens /?add=1.
  useEffect(() => {
    if (params.get('add')) {
      open();
      setParams((p) => {
        const next = new URLSearchParams(p);
        next.delete('add');
        return next;
      }, { replace: true });
    }
  }, [params, open, setParams]);

  // Expenses saved while offline are sent as soon as the server is reachable again.
  const flush = useCallback(async () => {
    const queue = readQueue();
    if (!queue.length) return;
    const left = [];
    for (const item of queue) {
      try {
        await api('/api/expenses', { method: 'POST', body: item });
      } catch (e) {
        const status = (e as { status?: number }).status ?? 0;
        if (status === 0 || status >= 500) left.push(item); // keep for later; drop anything the server rejected
      }
    }
    writeQueue(left);
    setPending(left.length);
    if (left.length < queue.length) {
      toast.push(`Synced ${queue.length - left.length} offline ${queue.length - left.length === 1 ? 'expense' : 'expenses'}.`);
      await qc.invalidateQueries();
    }
  }, [qc, toast]);

  useEffect(() => {
    void flush();
    const onVisible = () => document.visibilityState === 'visible' && setPending(readQueue().length);
    window.addEventListener('online', flush);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', flush);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [flush]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/icons/icon-192.png" alt="" />
          <span>Budget</span>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => open()}>
          <Plus size={16} /> Add transaction
        </button>
        <nav className="nav" aria-label="Main">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}>
              <Icon size={18} strokeWidth={1.8} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__footer" key={version}>
          {lockEnabled() && (
            <button type="button" className="btn btn--ghost" onClick={lockNow} style={{ justifyContent: 'flex-start' }}>
              <Lock size={16} /> Lock
            </button>
          )}
        </div>
      </aside>

      <div className="main">
        <main className="page" id="content">
          {pending > 0 && (
            <div className="banner" role="status">
              <CloudOff size={16} />
              {pending} {pending === 1 ? 'expense is' : 'expenses are'} saved on this device and will sync when the server is reachable.
            </div>
          )}
          <Outlet />
        </main>
      </div>

      <nav className="tabbar" aria-label="Main">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end}>
            <Icon size={20} strokeWidth={1.8} />
            {label}
          </NavLink>
        ))}
      </nav>
      <button type="button" className="fab" aria-label="Add transaction" onClick={() => open()}>
        <Plus size={22} />
      </button>
    </div>
  );
}
