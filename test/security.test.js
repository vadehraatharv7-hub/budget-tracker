// Regression tests for the findings in SECURITY-AUDIT.md.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let s;
before(async () => { s = await startServer(); });
after(() => s.stop());

const KEYS = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };

test('static files cannot escape the public directory', async () => {
  for (const p of ['/../server/db.js', '/%2e%2e/server/db.js', '/..%2fserver%2fdb.js', '/icons/../../package.json', '/..%5cserver%5cdb.js']) {
    const r = await fetch(s.base + p, { redirect: 'manual' });
    const t = await r.text();
    assert.ok(!t.includes('DatabaseSync') && !t.includes('"dependencies"'), `leaked source via ${p}`);
  }
});

test('security headers are present', async () => {
  const r = await fetch(s.base + '/');
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  assert.equal(r.headers.get('strict-transport-security'), null, 'no HSTS over plain HTTP');
  const h = await fetch(s.base + '/', { headers: { 'x-forwarded-proto': 'https' } });
  assert.ok(h.headers.get('strict-transport-security'));
});

test('cross-origin writes are blocked (CSRF)', async () => {
  const evil = await s.call('/api/expenses', { method: 'POST', headers: { origin: 'http://evil.example', 'content-type': 'application/x-www-form-urlencoded' }, body: 'amount=1' });
  assert.equal(evil.status, 403);
  const same = await s.call('/api/expenses', { method: 'POST', headers: { origin: s.base }, body: { amount: '1' } });
  assert.equal(same.status, 200);
});

test('push subscriptions only accept real push services (no SSRF)', async () => {
  for (const endpoint of ['http://127.0.0.1:9/x', 'https://127.0.0.1/x', 'https://fcm.googleapis.com.evil.com/x', 'https://user:pw@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'file:///etc/passwd']) {
    const r = await s.call('/api/push/subscribe', { method: 'POST', body: { endpoint, keys: KEYS } });
    assert.equal(r.status, 400, endpoint);
  }
  const ok = await s.call('/api/push/subscribe', { method: 'POST', body: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: KEYS } });
  assert.equal(ok.status, 200);
});

test('category icon/colour/name cannot carry markup or CSS', async () => {
  const r = await s.call('/api/categories', { method: 'POST', body: { name: 'x', icon: '<img src=x onerror=1>', color: 'red;background:url(//evil)' } });
  assert.ok(!/[<>"'&]/.test(r.json.icon));
  assert.match(r.json.color, /^#[0-9a-f]{6}$/i);
  const u = await s.call(`/api/categories/${r.json.id}`, { method: 'PUT', body: { color: 'expression(alert(1))' } });
  assert.match(u.json.color, /^#[0-9a-f]{6}$/i);
});

test('rate override is bounded', async () => {
  assert.equal((await s.call('/api/settings', { method: 'PUT', body: { rate_override: '0.0001' } })).status, 400);
  assert.equal((await s.call('/api/settings', { method: 'PUT', body: { rate_override: '5000' } })).status, 400);
});

test('oversized bodies are rejected', async () => {
  const r = await s.call('/api/expenses', { method: 'POST', body: JSON.stringify({ note: 'a'.repeat(2_000_000), amount: 1 }) });
  assert.equal(r.status, 413);
  assert.equal((await s.call('/api/state')).status, 200, 'server keeps serving afterwards');
});

test('Shortcuts token brute force is throttled', async () => {
  const codes = [];
  for (let i = 0; i < 10; i++) codes.push((await s.call('/api/shortcuts/expense', { method: 'POST', headers: { authorization: 'Bearer nope' }, body: {} })).status);
  assert.deepEqual(codes.slice(0, 8), Array(8).fill(401));
  assert.equal(codes[9], 429);
});

test('a malformed VAPID_SUBJECT does not stop the server starting', async () => {
  for (const v of ['someone@example.com', 'not a url', 'ftp://x']) {
    const t = await startServer({ VAPID_SUBJECT: v });
    assert.equal((await t.call('/api/session')).status, 200, v);
    await t.stop();
  }
});
