import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openStore } from './store.js';
import { loadMasterKey, Vault } from './vault.js';
import { createApp } from './app.js';
import { loadRuntimeConfig, runtimePaths } from './paths.js';

process.umask(0o077);
loadRuntimeConfig();
const origin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:3000';
const url = new URL(origin);
if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) throw new Error('APP_ORIGIN must be an HTTP(S) origin without a trailing slash');
const port = Number(process.env.APP_PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('APP_PORT_INVALID');
const paths = runtimePaths();
const secretsDir = paths.secrets;
const store = openStore(paths.data, secretsDir);
try {
  const hasSecrets = !!store.db.prepare('SELECT 1 FROM secrets LIMIT 1').get();
  const vault = new Vault(store, loadMasterKey(secretsDir, hasSecrets));
  const setupPath = resolve(secretsDir, 'setup-token');
  const initialized = !!store.db.prepare('SELECT 1 FROM admin').get();
  if (!initialized && !existsSync(setupPath)) writeFileSync(setupPath, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
  const setupToken = initialized ? '' : readFileSync(setupPath, 'utf8').trim();
  if (!initialized && setupToken.length < 32) throw new Error('SETUP_TOKEN_INVALID');
  const { app } = await createApp({ store, vault, origin, setupToken, staticDir: resolve('dist/web') });
  app.addHook('onClose', async () => { store.close(); });
  await app.listen({ host: process.env.APP_HOST ?? '127.0.0.1', port });
  console.info(`WeRead Flomo listening. Open ${origin}`);
  if (!initialized) console.info(`首次设置令牌文件：${setupPath}`);
  const shutdown = () => { void app.close().catch(() => { process.exitCode = 1; }); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch {
  store.close();
  console.error('启动失败：请检查数据库锁、主密钥、迁移版本和监听配置。凭据不会输出到日志。');
  process.exitCode = 1;
}
