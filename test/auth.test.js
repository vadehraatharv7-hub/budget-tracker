import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let s;
before(async () => { s = await startServer({ APP_PASSWORD: 'correct horse battery' }); });
after(() => s.stop());

test('every data route needs a session', async () => {
  for (const p of ['/api/state', '/api/expenses', '/api/summary', '/api/export.csv', '/api/backup.json', '/api/recurring', '/api/goals', '/api/income']) {
    assert.equal((await s.call(p)).status, 401, p);
  }
  assert.equal((await s.call('/api/shortcuts/summary')).status, 401);
  assert.equal((await s.call('/')).status, 200, 'the app shell itself stays public so the login screen can load');
});

test('forged and malformed cookies are rejected', async () => {
  for (const c of ['bt_session=00', 'bt_session=' + 'a'.repeat(64), 'bt_session=../../etc/passwd']) {
    s.setCookie(c);
    assert.equal((await s.call('/api/state')).status, 401, c);
  }
  s.setCookie('');
});

test('login issues a random server-side session that logout revokes', async () => {
  const login = await s.call('/api/login', { method: 'POST', body: { password: 'correct horse battery' } });
  assert.equal(login.status, 200);
  const set = login.headers.get('set-cookie');
  assert.match(set, /bt_session=[0-9a-f]{64}/);
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Lax/);
  assert.equal((await s.call('/api/state')).status, 200);
  const token = s.getCookie();
  await s.call('/api/logout', { method: 'POST' });
  s.setCookie(token);
  assert.equal((await s.call('/api/state')).status, 401, 'revoked session must stop working');
});

test('two logins get different tokens', async () => {
  const a = await s.call('/api/login', { method: 'POST', body: { password: 'correct horse battery' } });
  const b = await s.call('/api/login', { method: 'POST', body: { password: 'correct horse battery' } });
  assert.notEqual(a.headers.get('set-cookie').split(';')[0], b.headers.get('set-cookie').split(';')[0]);
});

test('login is throttled after repeated failures', async () => {
  s.setCookie('');
  const codes = [];
  for (let i = 0; i < 11; i++) codes.push((await s.call('/api/login', { method: 'POST', body: { password: 'wrong' } })).status);
  // Failed logins and bad API tokens share one per-IP counter, so the lock-out may start a request or two early.
  assert.equal(codes[0], 401);
  assert.ok(codes.slice(0, 6).every((c) => c === 401));
  assert.equal(codes[10], 429);
  // even the right password is refused while locked out
  assert.equal((await s.call('/api/login', { method: 'POST', body: { password: 'correct horse battery' } })).status, 429);
});
