import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useCallback } from 'react';
import { api } from '@/lib/api';
import { currentMonth, localToday } from '@/lib/dates';
import type { AppState, Expense, Goal, Income, RatesPayload, Recurring, Summary } from '@/lib/types';

export const useAppState = () => useQuery({ queryKey: ['state'], queryFn: () => api<AppState>('/api/state'), staleTime: 30_000 });

export const useSummary = (month: string) =>
  useQuery({ queryKey: ['summary', month], queryFn: () => api<Summary>(`/api/summary?month=${month}&today=${localToday()}`) });

export const useExpenses = (month: string) => useQuery({ queryKey: ['expenses', month], queryFn: () => api<Expense[]>(`/api/expenses?month=${month}`) });

export const useIncome = (month: string) => useQuery({ queryKey: ['income', month], queryFn: () => api<Income[]>(`/api/income?month=${month}`) });

export const useRecurring = () => useQuery({ queryKey: ['recurring'], queryFn: () => api<Recurring[]>('/api/recurring') });

export const useGoals = () => useQuery({ queryKey: ['goals'], queryFn: () => api<Goal[]>('/api/goals') });

export const useRates = () => useQuery({ queryKey: ['rates'], queryFn: () => api<RatesPayload>('/api/rates?days=30') });

/** The month being viewed lives in the URL (?m=2026-10) so it survives reloads and can be shared. */
export function useMonth(): [string, (m: string) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('m');
  const month = raw && /^\d{4}-\d{2}$/.test(raw) ? raw : currentMonth();
  const setMonth = useCallback(
    (m: string) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (m === currentMonth()) next.delete('m');
          else next.set('m', m);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return [month, setMonth];
}
