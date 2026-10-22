import { describe, expect, it } from 'vitest';
import { learnedCategory, parseQuick } from './parseQuick';
import type { Category } from './types';

const cat = (id: number, name: string): Category => ({ id, name, icon: 'tag', color: '#000000', budget: 0, sort: id, archived: 0 });
const categories = [cat(1, 'Rent'), cat(2, 'Groceries'), cat(3, 'Eating out'), cat(4, 'Transport')];
const history = [{ note: 'Netto', category_id: 2 }, { note: 'Wolt', category_id: 3 }];

describe('parseQuick', () => {
  it('reads amount, currency, category and note', () => {
    expect(parseQuick('120 kr netto groceries', categories, history)).toEqual({ amount: '120', currency: 'DKK', categoryId: 2, note: 'netto' });
  });
  it('detects rupees and decimal commas', () => {
    expect(parseQuick('₹450 auto', categories, history)).toMatchObject({ amount: '450', currency: 'INR', note: 'auto' });
    expect(parseQuick('45,5 coffee', categories, history)?.amount).toBe('45.5');
  });
  it('matches categories by prefix', () => {
    expect(parseQuick('80 eat', categories, history)?.categoryId).toBe(3);
  });
  it('falls back to the category last used with the same note', () => {
    expect(parseQuick('99 wolt', categories, history)?.categoryId).toBe(3);
  });
  it('returns null without an amount', () => {
    expect(parseQuick('netto groceries', categories, history)).toBeNull();
  });
});

describe('learnedCategory', () => {
  it('matches exact notes case-insensitively and notes contained in longer text', () => {
    expect(learnedCategory('NETTO', history)).toBe(2);
    expect(learnedCategory('Netto Nørrebro', history)).toBe(2);
    expect(learnedCategory('', history)).toBeNull();
    expect(learnedCategory('unknown shop', history)).toBeNull();
  });
});
