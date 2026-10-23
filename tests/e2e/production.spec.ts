import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { password } from '../fixtures.js';
import { defaultRuntimeRoot } from '../../src/server/paths.js';

test('production entrypoint initializes and preserves administrator, master key and session after restart', async () => {
  test.skip(process.platform !== 'linux', 'Default-directory process integration is currently verified on Linux.');
  const directory = mkdtempSync(join(tmpdir(), 'weread-production-'));
  const origin = 'http://127.0.0.1:4101';
  const env: NodeJS.ProcessEnv = { ...process.env, XDG_DATA_HOME: directory, LOCALAPPDATA: directory, DATA_DIR: '', SECRETS_DIR: '' };
  delete env.APP_HOST; delete env.APP_PORT; delete env.APP_ORIGIN;
  const runtime = defaultRuntimeRoot(env);
  mkdirSync(runtime, { recursive: true });
  writeFileSync(join(runtime, 'config.env'), `APP_HOST=127.0.0.1\nAPP_PORT=4101\nAPP_ORIGIN=${origin}\n`);
  let child: ChildProcess | undefined;
  async function start() {
    child = spawn(process.execPath, ['dist/server/main.js'], { cwd: process.cwd(), stdio: 'ignore', env });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error('Production process exited during startup');
      try { if ((await fetch(`${origin}/api/health`)).ok) return; } catch { /* Process is still starting. */ }
      await sleep(100);
    }
    throw new Error('Production process did not become healthy');
  }
  async function stop() {
    if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); const [code] = await exited; expect(code).toBe(0); }
    child = undefined;
  }
  try {
    await start();
    expect(existsSync(join(runtime, 'data/app.sqlite'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'data'))).toBe(false);
    expect(existsSync(join(process.cwd(), 'secrets'))).toBe(false);
    const token = readFileSync(join(runtime, 'secrets/setup-token'), 'utf8').trim();
    const key = readFileSync(join(runtime, 'secrets/master.key'));
    const setup = await fetch(`${origin}/api/auth/setup`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'production-reader', password, setupToken: token }) });
    expect(setup.status).toBe(200);
    const cookie = setup.headers.get('set-cookie')!.split(';')[0];
    await stop(); await start();
    expect(readFileSync(join(runtime, 'secrets/master.key')).equals(key)).toBe(true);
    const state = await fetch(`${origin}/api/auth/state`, { headers: { Cookie: cookie } }).then((r) => r.json());
    expect(state.initialized).toBe(true); expect(state.authenticated).toBe(true); expect(state.username).toBe('production-reader');
    const page = await fetch(origin); expect(page.status).toBe(200); expect(await page.text()).toContain('WeRead');
    const repeated = await fetch(`${origin}/api/auth/setup`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'another', password, setupToken: token }) });
    expect(repeated.status).toBe(409);
  } finally { await stop(); rmSync(directory, { recursive: true, force: true }); }
});
