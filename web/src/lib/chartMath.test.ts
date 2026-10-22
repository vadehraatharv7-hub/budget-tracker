import { describe, expect, it } from 'vitest';
import { niceMax } from './chartMath';

describe('niceMax', () => {
  it('rounds up to friendly axis bounds', () => {
    expect(niceMax(0)).toBe(100);
    expect(niceMax(7)).toBe(8);
    expect(niceMax(14500)).toBe(15000);
    expect(niceMax(10657)).toBe(15000);
    expect(niceMax(100)).toBe(100);
  });
  it('never returns less than the input', () => {
    for (const v of [1, 3.2, 99, 101, 1234, 56789, 1e6]) expect(niceMax(v)).toBeGreaterThanOrEqual(v);
  });
});
