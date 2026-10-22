import type { NewEntry } from './types';

const KEY = 'bt_queue';

export function readQueue(): NewEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as NewEntry[];
  } catch {
    return [];
  }
}

export function writeQueue(items: NewEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* storage unavailable (private mode) */
  }
}

export const enqueue = (item: NewEntry) => writeQueue([...readQueue(), item]);
