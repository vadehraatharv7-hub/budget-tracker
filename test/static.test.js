// How the server hands out the built web app: caching, the single-page-app fallback and 404s.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from './helpers.js';

let s, dir;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'budget-dist-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Budget</title><div id="root"></div>');
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
  writeFileSync(join(dir, 'assets', 'inter-abc123.woff2'), 'font');
  writeFileSync(join(dir, 'sw.js'), 'self.skipWaiting()');
  s = await startServer({ STATIC_DIR: dir });
});
after(async () => { await s.stop(); rmSync(dir, { recursive: true, force: true }); });

const get = (path) => fetch(s.base + path, { redirect: 'manual' });

test('index.html is always revalidated', async () => {
  const r = await get('/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.equal(r.headers.get('cache-control'), 'no-cache');
});

test('content-hashed assets are cached for a year, with the right MIME types', async () => {
  const js = await get('/assets/app-abc123.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('cache-control'), /immutable/);
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.equal((await get('/assets/inter-abc123.woff2')).headers.get('content-type'), 'font/woff2');
});

test('app routes fall back to index.html, but missing files are real 404s', async () => {
  for (const route of ['/budget', '/transactions', '/settings']) {
    const r = await get(route);
    assert.equal(r.status, 200, route);
    assert.match(await r.text(), /id="root"/);
  }
  assert.equal((await get('/assets/missing-123.js')).status, 404);
  assert.equal((await get('/nope.png')).status, 404);
});

test('the service worker may control the whole origin', async () => {
  assert.equal((await get('/sw.js')).headers.get('service-worker-allowed'), '/');
});

test('files outside the web root are not reachable', async () => {
  for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%2fserver%2fdb.js']) {
    const t = await (await get(p)).text();
    assert.ok(!t.includes('"dependencies"') && !t.includes('DatabaseSync'), p);
  }
});

test('the API is untouched by the static fallback', async () => {
  const r = await get('/api/session');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /json/);
});
