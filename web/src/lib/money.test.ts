import { describe, expect, it } from 'vitest';
import { convert, formatCompact, formatMoney, formatPercent, formatSigned, parseAmount } from './money';

describe('formatMoney', () => {
  it('formats DKK with the currency code and thousands separators', () => {
    expect(formatMoney(1234.5, 'DKK')).toBe('DKK 1,235');
    expect(formatMoney(0, 'DKK')).toBe('DKK 0');
  });
  it('shows pennies for small non-integer amounts and when asked', () => {
    expect(formatMoney(45.5, 'DKK')).toBe('DKK 45.50');
    expect(formatMoney(1234.5, 'DKK', 2)).toBe('DKK 1,234.50');
  });
  it('formats INR with the rupee sign and Indian grouping', () => {
    expect(formatMoney(1234567, 'INR')).toBe('₹12,34,567');
  });
  it('never renders NaN', () => {
    expect(formatMoney(Number.NaN, 'DKK')).toBe('DKK 0');
  });
});

describe('formatSigned', () => {
  it('prefixes plus and a true minus sign', () => {
    expect(formatSigned(500, 'DKK')).toBe('+DKK 500');
    expect(formatSigned(-500, 'DKK')).toBe('−DKK 500');
    expect(formatSigned(0, 'DKK')).toBe('DKK 0');
  });
});

describe('formatCompact and formatPercent', () => {
  it('abbreviates thousands and millions', () => {
    expect(formatCompact(950)).toBe('950');
    expect(formatCompact(1500)).toBe('1.5k');
    expect(formatCompact(14000)).toBe('14k');
    expect(formatCompact(2_500_000)).toBe('2.5M');
  });
  it('rounds percentages', () => {
    expect(formatPercent(0.756)).toBe('76%');
  });
});

describe('parseAmount', () => {
  it('reads decimal commas and dots', () => {
    expect(parseAmount('45,5')).toBe(45.5);
    expect(parseAmount('45.5')).toBe(45.5);
    expect(parseAmount('1.234,50')).toBe(1234.5);
    expect(parseAmount('1,234.50')).toBe(1234.5);
  });
  it('ignores currency symbols and spaces', () => {
    expect(parseAmount('₹ 450')).toBe(450);
    expect(parseAmount('kr 120')).toBe(120);
  });
  it('returns NaN when there is no number', () => {
    expect(parseAmount('abc')).toBeNaN();
    expect(parseAmount('')).toBeNaN();
  });
});

describe('convert', () => {
  it('converts both ways with the DKK to INR rate', () => {
    expect(convert(100, 'DKK', 'INR', 14)).toBe(1400);
    expect(convert(1400, 'INR', 'DKK', 14)).toBe(100);
    expect(convert(100, 'DKK', 'DKK', 14)).toBe(100);
  });
});
