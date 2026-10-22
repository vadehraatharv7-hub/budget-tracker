import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Start the real server on a free port with a throw-away database. */
export async function startServer(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'budget-test-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DB_PATH: join(dir, 'test.db'), NO_NETWORK: '1', TZ: 'UTC', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (log.includes('running on')) break;
    if (child.exitCode !== null) throw new Error(`server exited early:\n${log}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!log.includes('running on')) { child.kill(); throw new Error(`server did not start:\n${log}`); }

  let cookie = '';
  const call = async (path, { method = 'GET', body, headers = {}, raw = false } = {}) => {
    const res = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  return {
    base, call, setCookie: (c) => (cookie = c), getCookie: () => cookie,
    async stop() { child.kill(); await new Promise((r) => child.once('exit', r)); rmSync(dir, { recursive: true, force: true }); },
  };
}
