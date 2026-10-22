import type { Category, Currency, Expense } from './types';

export interface QuickResult {
  amount: string;
  currency: Currency | null;
  categoryId: number | null;
  note: string;
}

type History = Pick<Expense, 'note' | 'category_id'>[];

/** Category last used with a note, so "Netto" resolves to Groceries without asking. */
export function learnedCategory(note: string, history: History): number | null {
  const n = note.trim().toLowerCase();
  if (!n) return null;
  const same = history.find((e) => e.category_id && e.note.trim().toLowerCase() === n);
  if (same) return same.category_id;
  const within = history.find((e) => e.category_id && e.note.trim().length > 2 && n.includes(e.note.trim().toLowerCase()));
  return within?.category_id ?? null;
}

/** "120 kr netto groceries" or "₹450 auto" -> amount, currency, category and note. */
export function parseQuick(text: string, categories: Category[], history: History): QuickResult | null {
  const t = text.trim();
  const m = t.match(/(\d+(?:[.,]\d+)?)/);
  if (!m || m.index === undefined) return null;
  const currency: Currency | null = /₹|\brs\.?\b|\binr\b|rupee/i.test(t) ? 'INR' : /\bkr\b|\bdkk\b/i.test(t) ? 'DKK' : null;
  const words = `${t.slice(0, m.index)} ${t.slice(m.index + m[0].length)}`
    .replace(/₹|\brs\.?(?=\s|$)|\binr\b|rupees?|\bkr\.?(?=\s|$)|\bdkk\b/gi, ' ')
    .split(/\s+/)
    .filter(Boolean);
  let categoryId: number | null = null;
  const rest = words.filter((w) => {
    if (categoryId !== null || w.length < 3) return true;
    const lw = w.toLowerCase();
    const hit = categories.find((c) => c.name.toLowerCase().split(/\s+/).some((p) => p === lw || (lw.length >= 3 && p.startsWith(lw))));
    if (hit) {
      categoryId = hit.id;
      return false;
    }
    return true;
  });
  const note = rest.join(' ');
  return { amount: m[1]!.replace(',', '.'), currency, categoryId: categoryId ?? learnedCategory(note, history), note };
}
