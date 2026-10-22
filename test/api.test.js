import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let s;
before(async () => { s = await startServer(); });
after(() => s.stop());

const today = () => new Date().toISOString().slice(0, 10);
const month = () => today().slice(0, 7);

test('state exposes seeded categories and an API token', async () => {
  const r = await s.call('/api/state');
  assert.equal(r.status, 200);
  assert.ok(r.json.categories.length >= 9);
  assert.match(r.json.apiToken, /^[0-9a-f]{48}$/);
});

test('rejects invalid amounts, dates, currencies and months', async () => {
  for (const body of [{ amount: '-5' }, { amount: 'abc' }, { amount: '5', date: 'nope' }, { amount: '5', currency: 'EUR' }]) {
    const r = await s.call('/api/expenses', { method: 'POST', body });
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.equal((await s.call('/api/expenses?month=%25')).status, 400);
});

test('stores original amount, currency and the rate used (manual override)', async () => {
  assert.equal((await s.call('/api/settings', { method: 'PUT', body: { rate_override: '14' } })).status, 200);
  const r = await s.call('/api/expenses', { method: 'POST', body: { amount: '140', currency: 'INR', category: 'groceries', note: 'inr test' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.amount, 140);
  assert.equal(r.json.currency, 'INR');
  assert.ok(Math.abs(r.json.amount_base - 10) < 1e-9);
  // later rate changes must not rewrite history
  await s.call('/api/settings', { method: 'PUT', body: { rate_override: '20' } });
  const list = await s.call(`/api/expenses?month=${month()}`);
  const e = list.json.find((x) => x.note === 'inr test');
  assert.ok(Math.abs(e.amount_base - 10) < 1e-9);
});

test('accepts decimal comma and matches categories by prefix', async () => {
  const r = await s.call('/api/expenses', { method: 'POST', body: { amount: '45,5', category: 'eat', note: 'comma' } });
  assert.equal(r.json.amount, 45.5);
  const cats = (await s.call('/api/state')).json.categories;
  assert.equal(r.json.category_id, cats.find((c) => c.name === 'Eating out').id);
});

test('summary: budget, remaining, per-category spend, income and net', async () => {
  await s.call('/api/settings', { method: 'PUT', body: { monthly_budget: 1000 } });
  await s.call('/api/income', { method: 'POST', body: { amount: '5000', source: 'Job' } });
  const sum = (await s.call(`/api/summary?month=${month()}`)).json;
  assert.equal(sum.budget, 1000);
  assert.ok(sum.spent > 0);
  assert.ok(Math.abs(sum.remaining - (1000 - sum.spent)) < 0.01);
  assert.equal(sum.income, 5000);
  assert.ok(Math.abs(sum.net - (5000 - sum.spent)) < 0.01);
  assert.equal(sum.daily.length, sum.dim);
});

test('edit and delete an expense', async () => {
  const c = await s.call('/api/expenses', { method: 'POST', body: { amount: '10', note: 'edit me' } });
  const u = await s.call(`/api/expenses/${c.json.id}`, { method: 'PUT', body: { amount: '12', note: 'edited' } });
  assert.equal(u.json.amount, 12);
  assert.equal(u.json.note, 'edited');
  assert.equal((await s.call(`/api/expenses/${c.json.id}`, { method: 'DELETE' })).status, 200);
  const list = await s.call(`/api/expenses?month=${month()}`);
  assert.ok(!list.json.some((x) => x.id === c.json.id));
});

test('recurring items create this month\'s entry exactly once', async () => {
  const r = await s.call('/api/recurring', { method: 'POST', body: { kind: 'expense', amount: 99, currency: 'DKK', category_id: 5, note: 'Spotify test', day: 1 } });
  assert.equal(r.status, 200);
  await s.call('/api/recurring', { method: 'GET' });
  const list = await s.call(`/api/expenses?month=${month()}`);
  assert.equal(list.json.filter((x) => x.note === 'Spotify test' && x.source === 'recurring').length, 1);
});

test('Shortcuts endpoint needs the token and returns a readable message', async () => {
  assert.equal((await s.call('/api/shortcuts/expense', { method: 'POST', body: { amount: '5' } })).status, 401);
  const token = (await s.call('/api/state')).json.apiToken;
  const r = await s.call('/api/shortcuts/expense', {
    method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { amount: '19,90', category: 'groc', note: 'Netto' },
  });
  assert.equal(r.status, 200);
  assert.match(r.json.message, /Logged 19\.9 DKK in Groceries/);
});

test('CSV export neutralises spreadsheet formulas', async () => {
  await s.call('/api/expenses', { method: 'POST', body: { amount: '1', note: '=HYPERLINK("http://evil","x")' } });
  const csv = (await s.call('/api/export.csv')).text;
  assert.ok(csv.includes(`"'=HYPERLINK`), 'formula cell must be prefixed');
  assert.ok(!/,"=HYPERLINK/.test(csv));
});

test('CSV import understands Danish bank format and category rules', async () => {
  const csv = 'Dato,Beløb,Tekst\n21.10.2026,-89,NETTO KOBENHAVN\n20.10.2026,-45.5,Wolt\nbad,row,here\n';
  const r = await s.call('/api/import/csv', { method: 'POST', body: { csv, rules: [{ contains: 'netto', category: 'Groceries' }] } });
  assert.equal(r.json.added, 2);
  assert.equal(r.json.skipped, 1);
});

test('backup then restore round-trips the data', async () => {
  const backup = (await s.call('/api/backup.json')).json;
  assert.equal(backup.version, 1);
  assert.equal(backup.settings.api_token, undefined, 'token must not be exported');
  const before = backup.expenses.length;
  await s.call('/api/expenses', { method: 'POST', body: { amount: '7', note: 'after backup' } });
  const r = await s.call('/api/restore', { method: 'POST', body: backup });
  assert.equal(r.status, 200);
  const all = (await s.call('/api/backup.json')).json;
  assert.equal(all.expenses.length, before);
});

test('goals and categories CRUD', async () => {
  const g = await s.call('/api/goals', { method: 'POST', body: { name: 'Trip', target: '1000', deadline: '2030-01-01' } });
  assert.equal(g.status, 200);
  const c = await s.call(`/api/goals/${g.json.id}/contribute`, { method: 'POST', body: { amount: '250' } });
  assert.equal(c.json.saved, 250);
  const cat = await s.call('/api/categories', { method: 'POST', body: { name: 'Pets', icon: '🐶', color: '#112233', budget: 300 } });
  assert.equal(cat.json.budget, 300);
  assert.equal((await s.call(`/api/categories/${cat.json.id}`, { method: 'DELETE' })).json.archived, false);
});
