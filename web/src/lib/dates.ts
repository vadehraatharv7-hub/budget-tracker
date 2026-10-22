const pad = (n: number) => String(n).padStart(2, '0');

export const toISODate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const localToday = () => toISODate(new Date());
export const currentMonth = () => localToday().slice(0, 7);

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function monthLabel(month: string, style: 'long' | 'short' = 'long'): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(y, m - 1, 1);
  return style === 'long'
    ? d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : d.toLocaleDateString('en-GB', { month: 'short' });
}

/** "Today", "Yesterday", or "Tue 20 Oct". */
export function dayLabel(date: string, today = localToday()): string {
  if (date === today) return 'Today';
  const y = new Date(`${today}T12:00`);
  y.setDate(y.getDate() - 1);
  if (date === toISODate(y)) return 'Yesterday';
  return new Date(`${date}T12:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function shortDate(date: string): string {
  return new Date(`${date}T12:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function monthsUntil(deadline: string, from = new Date()): number {
  const ms = new Date(`${deadline}T12:00`).getTime() - from.getTime();
  return Math.max(1, Math.ceil(ms / (30.4 * 864e5)));
}
