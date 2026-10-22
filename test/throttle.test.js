// The failed-login counter must expire, reset on success, and still lock out real brute force.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const PW = 'correct horse battery';
const servers = [];
const start = async (env) => { const s = await startServer({ APP_PASSWORD: PW, ...env }); servers.push(s); return s; };
after(() => Promise.all(servers.map((s) => s.stop())));
const login = (s, pw) => s.call('/api/login', { method: 'POST', body: { password: pw } }).then((r) => r.status);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('a successful login resets the failure count', async () => {
  const s = await start();
  for (let i = 0; i < 7; i++) assert.equal(await login(s, 'wrong'), 401); // one short of the limit
  assert.equal(await login(s, PW), 200);
  for (let i = 0; i < 7; i++) assert.equal(await login(s, 'wrong'), 401, `typo ${i + 1} after a success must not be locked out`);
  assert.equal(await login(s, PW), 200);
});

test('old failures expire instead of accumulating forever', async () => {
  const s = await start({ LOGIN_WINDOW_SECONDS: '2' });
  for (let i = 0; i < 5; i++) assert.equal(await login(s, 'wrong'), 401);
  await sleep(2300);
  for (let i = 0; i < 5; i++) assert.equal(await login(s, 'wrong'), 401, 'only failures inside the window count');
  assert.equal(await login(s, PW), 200);
});

test('brute force inside the window still locks out, then the lock lifts', async () => {
  const s = await start({ LOGIN_WINDOW_SECONDS: '2' });
  const codes = [];
  for (let i = 0; i < 10; i++) codes.push(await login(s, 'wrong'));
  assert.equal(codes.at(-1), 429);
  assert.equal(await login(s, PW), 429, 'even the right password is refused while locked');
  await sleep(2300);
  assert.equal(await login(s, PW), 200, 'lock-out ends after the window');
});

test('LOGIN_MAX_FAILURES is configurable', async () => {
  const s = await start({ LOGIN_MAX_FAILURES: '3' });
  assert.equal(await login(s, 'wrong'), 401);
  assert.equal(await login(s, 'wrong'), 401);
  assert.equal(await login(s, 'wrong'), 401);
  assert.equal(await login(s, 'wrong'), 429);
});

test('a valid API token also clears the shared counter', async () => {
  const s = await start();
  // Sign in to read the token, then fail with bad tokens and succeed with the real one.
  assert.equal(await login(s, PW), 200);
  const api = (await s.call('/api/state')).json.apiToken;
  for (let i = 0; i < 6; i++) assert.equal((await s.call('/api/shortcuts/summary', { headers: { authorization: 'Bearer nope' } })).status, 401);
  assert.equal((await s.call('/api/shortcuts/summary', { headers: { authorization: `Bearer ${api}` } })).status, 200);
  for (let i = 0; i < 6; i++) assert.equal((await s.call('/api/shortcuts/summary', { headers: { authorization: 'Bearer nope' } })).status, 401);
});
