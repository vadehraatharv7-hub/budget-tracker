import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useToast } from '@/components/Toast';

/**
 * Runs a server call, refreshes every query on success and reports failures as a toast.
 * Resolves to the result, or undefined when the call failed.
 */
export function useAction() {
  const qc = useQueryClient();
  const toast = useToast();
  return useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const result = await fn();
        await qc.invalidateQueries();
        if (success) toast.push(success);
        return result;
      } catch (e) {
        toast.push(e instanceof Error ? e.message : 'Something went wrong.', 'error');
        return undefined;
      }
    },
    [qc, toast],
  );
}
