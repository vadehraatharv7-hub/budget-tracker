// Behaviour behind Cloudflare Tunnel: host allowlist, real-client-IP throttling, loopback binding.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from './helpers.js';

const servers = [];
const start = async (env) => { const s = await startServer(env); servers.push(s); return s; };
after(() => Promise.all(servers.map((s) => s.stop())));

// fetch() won't let us choose the Host header reliably, so talk HTTP directly.
function raw(base, path, { method = 'GET', headers = {}, body } = {}) {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path, method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
      let t = ''; res.on('data', (d) => (t += d)); res.on('end', () => resolve({ status: res.statusCode, text: t, headers: res.headers }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

test('ALLOWED_HOSTS: listed host and loopback pass, other Host headers get 421', async () => {
  const s = await start({ ALLOWED_HOSTS: 'budget.example.com' });
  assert.equal((await raw(s.base, '/api/session', { headers: { host: 'budget.example.com' } })).status, 200);
  assert.equal((await raw(s.base, '/api/session', { headers: { host: 'BUDGET.example.com:443' } })).status, 200, 'case and port ignored');
  assert.equal((await raw(s.base, '/api/session')).status, 200, 'loopback (health checks) always allowed');
  assert.equal((await raw(s.base, '/api/session', { headers: { host: 'evil.example.net' } })).status, 421);
  assert.equal((await raw(s.base, '/api/session', { headers: { host: 'budget.example.com.evil.net' } })).status, 421);
});

test('TRUST_PROXY=cloudflare throttles per CF-Connecting-IP, not per connection', async () => {
  const s = await start({ APP_PASSWORD: 'correct horse battery', TRUST_PROXY: 'cloudflare' });
  const login = (ip, pw) => raw(s.base, '/api/login', { method: 'POST', headers: ip ? { 'cf-connecting-ip': ip } : {}, body: { password: pw } });
  // twelve different visitors each fail once: nobody is locked out
  for (let i = 1; i <= 12; i++) assert.equal((await login(`203.0.113.${i}`, 'wrong')).status, 401);
  // one visitor hammering gets locked out...
  const codes = [];
  for (let i = 0; i < 10; i++) codes.push((await login('198.51.100.7', 'wrong')).status);
  assert.equal(codes[0], 401);
  assert.equal(codes.at(-1), 429);
  assert.equal((await login('198.51.100.7', 'correct horse battery')).status, 429);
  // ...while everyone else can still sign in
  assert.equal((await login('203.0.113.99', 'correct horse battery')).status, 200);
});

test('X-Forwarded-For is ignored in cloudflare mode (it can be forged by the client)', async () => {
  const s = await start({ APP_PASSWORD: 'correct horse battery', TRUST_PROXY: 'cloudflare' });
  const codes = [];
  for (let i = 0; i < 10; i++) {
    codes.push((await raw(s.base, '/api/login', { method: 'POST', headers: { 'x-forwarded-for': `10.0.0.${i}` }, body: { password: 'wrong' } })).status);
  }
  assert.equal(codes.at(-1), 429, 'rotating X-Forwarded-For must not evade the throttle');
});

test('HOST=127.0.0.1 binds to loopback only', async () => {
  const s = await start({ HOST: '127.0.0.1' });
  assert.equal((await raw(s.base, '/api/session')).status, 200);
});
