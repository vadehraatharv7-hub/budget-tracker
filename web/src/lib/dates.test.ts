import { describe, expect, it } from 'vitest';
import { dayLabel, monthLabel, monthsUntil, shiftMonth, toISODate } from './dates';

describe('shiftMonth', () => {
  it('moves across year boundaries', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-10', -5)).toBe('2026-05');
  });
});

describe('labels', () => {
  it('labels months', () => {
    expect(monthLabel('2026-10')).toBe('October 2026');
    expect(monthLabel('2026-10', 'short')).toBe('Oct');
  });
  it('labels today, yesterday and older days', () => {
    expect(dayLabel('2026-10-22', '2026-10-22')).toBe('Today');
    expect(dayLabel('2026-10-21', '2026-10-22')).toBe('Yesterday');
    expect(dayLabel('2026-10-20', '2026-10-22')).toBe('Tue 20 Oct');
  });
  it('formats ISO dates in local time', () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('monthsUntil', () => {
  it('is at least one month and rounds up', () => {
    expect(monthsUntil('2026-10-30', new Date('2026-10-22T12:00'))).toBe(1);
    expect(monthsUntil('2027-03-22', new Date('2026-10-22T12:00'))).toBe(5);
  });
});
