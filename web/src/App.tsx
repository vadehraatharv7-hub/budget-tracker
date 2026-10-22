import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { EntryProvider } from '@/components/EntryDialog';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LockProvider } from '@/components/LockProvider';
import { ToastProvider } from '@/components/Toast';
import { AUTH_EVENT, api } from '@/lib/api';
import { Budget } from '@/routes/Budget';
import { Currency } from '@/routes/Currency';
import { Login } from '@/routes/Login';
import { Overview } from '@/routes/Overview';
import { Settings } from '@/routes/Settings';
import { Transactions } from '@/routes/Transactions';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 15_000 } },
});

interface SessionInfo {
  authed: boolean;
  passwordRequired: boolean;
}

function AuthGate() {
  const qc = useQueryClient();
  const session = useQuery({ queryKey: ['session'], queryFn: () => api<SessionInfo>('/api/session'), staleTime: 60_000 });

  // Any 401 from the API means the session ended: ask the server again, which flips us to the sign-in screen.
  useEffect(() => {
    const onAuth = () => void qc.invalidateQueries({ queryKey: ['session'] });
    window.addEventListener(AUTH_EVENT, onAuth);
    return () => window.removeEventListener(AUTH_EVENT, onAuth);
  }, [qc]);

  if (session.isLoading) return <div className="auth"><div className="skeleton" style={{ width: 320, height: 200 }} /></div>;
  if (session.data && !session.data.authed) {
    return <Login onSuccess={() => void qc.invalidateQueries().then(() => qc.refetchQueries({ queryKey: ['session'] }))} />;
  }

  return (
    <BrowserRouter>
      <EntryProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Overview />} />
            <Route path="transactions" element={<Transactions />} />
            <Route path="budget" element={<Budget />} />
            <Route path="currency" element={<Currency />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </EntryProvider>
    </BrowserRouter>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <LockProvider>
            <AuthGate />
          </LockProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
