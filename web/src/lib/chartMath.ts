/** Rounds a maximum up to a "nice" axis bound (1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10 x 10^n). */
export function niceMax(value: number): number {
  if (value <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= value) return m * p;
  return 10 * p;
}
