import Database from 'better-sqlite3';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openStore } from './store.js';
import { loadMasterKey, Vault } from './vault.js';
import { loadRuntimeConfig, runtimePaths } from './paths.js';

// The instance lock makes replacement impossible while the application is running.
export async function restoreDatabase(source: string, directory: string, secretsDirectory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const destination = resolve(directory, 'app.sqlite');
  if (resolve(source) === destination) throw new Error('RESTORE_SOURCE_IS_CURRENT');
  const lock = new Database(resolve(directory, 'instance.sqlite'), { timeout: 0 });
  let temporary: string | undefined;
  try {
    lock.exec('CREATE TABLE IF NOT EXISTS instance (id INTEGER PRIMARY KEY); BEGIN EXCLUSIVE');
    temporary = mkdtempSync(join(resolve(directory), '.restore-'));
    const input = new Database(resolve(source), { readonly: true, fileMustExist: true });
    try {
      if (input.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('RESTORE_INVALID_DATABASE');
      await input.backup(join(temporary, 'app.sqlite'));
    } finally { input.close(); }
    const restored = openStore(temporary);
    try {
      if ((restored.db.pragma('foreign_key_check') as unknown[]).length) throw new Error('RESTORE_INVALID_DATABASE');
      const hasSecrets = !!restored.db.prepare('SELECT 1 FROM secrets LIMIT 1').get();
      new Vault(restored, loadMasterKey(secretsDirectory, hasSecrets));
      restored.db.prepare('UPDATE recovery_state SET review_required = 1 WHERE id = 1').run();
      restored.db.prepare("UPDATE automation SET delivery_block = 'BACKUP_REVIEW' WHERE id = 1").run();
      restored.db.pragma('wal_checkpoint(TRUNCATE)');
    } finally { restored.close(); }
    let previous: string | undefined;
    if (existsSync(destination)) {
      previous = resolve(directory, `before-restore-${Date.now()}.sqlite`);
      const current = new Database(destination, { readonly: true });
      try { await current.backup(previous); chmodSync(previous, 0o600); } finally { current.close(); }
    }
    for (const suffix of ['-wal', '-shm']) rmSync(`${destination}${suffix}`, { force: true });
    renameSync(join(temporary, 'app.sqlite'), destination);
    chmodSync(destination, 0o600);
    return { previous, reviewRequired: true };
  } finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true });
    lock.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.umask(0o077);
  const [flag, source, ...extra] = process.argv.slice(2);
  if (flag !== '--from' || !source || extra.length) {
    console.error('用法：npm run restore -- --from /绝对路径/app.sqlite（先停止应用服务）');
    process.exitCode = 1;
  } else {
    try {
      loadRuntimeConfig();
      const paths = runtimePaths();
      const result = await restoreDatabase(source, paths.data, paths.secrets);
      console.info(`恢复完成，自动导入已锁定，需在自动任务页面核对后解除。替换前数据库：${result.previous ?? '无'}`);
    } catch {
      console.error('恢复失败：请检查应用已停止、备份版本/完整性以及主密钥匹配。');
      process.exitCode = 1;
    }
  }
}
