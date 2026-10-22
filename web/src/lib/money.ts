import type { Currency } from './types';

const locales: Record<Currency, string> = { DKK: 'en-GB', INR: 'en-IN' };

/** 1234.5 -> "DKK 1,235" / "₹1,235". Whole numbers by default; pass decimals for exact amounts. */
export function formatMoney(value: number, currency: Currency, decimals?: number): string {
  const v = Number.isFinite(value) ? value : 0;
  const d = decimals ?? (Number.isInteger(v) || Math.abs(v) >= 1000 ? 0 : 2);
  return new Intl.NumberFormat(locales[currency], {
    style: 'currency',
    currency,
    currencyDisplay: currency === 'INR' ? 'symbol' : 'code',
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })
    .format(v)
    .replace(/ /g, ' ');
}

/** Number only (no currency), for table columns whose header names the currency. */
export function formatNumber(value: number, currency: Currency, decimals = 0): string {
  return new Intl.NumberFormat(locales[currency], { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(
    Number.isFinite(value) ? value : 0,
  );
}

export function formatSigned(value: number, currency: Currency): string {
  const s = formatMoney(Math.abs(value), currency);
  return value > 0 ? `+${s}` : value < 0 ? `−${s}` : s;
}

export function formatCompact(value: number): string {
  const a = Math.abs(value);
  if (a >= 1e6) return `${+(value / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${+(value / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return String(Math.round(value));
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** Accepts "1.234,50", "1,5", "45", "₹450": returns NaN when there is no number. */
export function parseAmount(input: string): number {
  let s = input.trim().replace(/[^\d.,-]/g, '');
  if (!s) return NaN;
  const comma = s.lastIndexOf(',');
  const dot = s.lastIndexOf('.');
  if (comma > dot) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  return Number(s);
}

export function convert(amount: number, from: Currency, to: Currency, dkkInr: number): number {
  if (from === to) return amount;
  return from === 'DKK' ? amount * dkkInr : amount / dkkInr;
}
