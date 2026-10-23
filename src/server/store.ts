import { reconcileSourceTasks } from './source-state.js';
import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { RecoveryGuard } from './recovery.js';

export type Store = ReturnType<typeof openStore>;

export function openStore(directory: string, recoveryDirectory = directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = new Database(resolve(directory, 'instance.sqlite'), { timeout: 0 });
  let db: Database.Database | undefined;
  try {
    lock.exec('CREATE TABLE IF NOT EXISTS instance (id INTEGER PRIMARY KEY); BEGIN EXCLUSIVE');
    db = new Database(resolve(directory, 'app.sqlite'));
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    const version = db.pragma('user_version', { simple: true }) as number;
    if (version > 6) throw new Error('DATABASE_NEWER_THAN_APP');
    for (let next = version + 1; next <= 6; next++) {
      const sql = readFileSync(resolve(`migrations/${String(next).padStart(3, '0')}.sql`), 'utf8');
      db.transaction(() => { db!.exec(sql); db!.pragma(`user_version = ${next}`); })();
    }
    const recovery = new RecoveryGuard(db, recoveryDirectory, version === 0);
    db.transaction(() => {
      const now = Date.now();
      db!.prepare(`UPDATE notes SET status = CASE WHEN status = 'missing' THEN 'missing' ELSE 'unavailable' END,
        missing_scans = 0, source_error_code = 'SYNC_INTERRUPTED', updated_at = ?
        WHERE kind = 'thought' AND status <> 'removed' AND connection_id IN (SELECT connection_id FROM sync_runs WHERE status = 'running')`).run(now);
      reconcileSourceTasks(db!, now);
    })();
    db.prepare("UPDATE sync_runs SET status = 'interrupted', finished_at = ? WHERE status = 'running'").run(Date.now());
    chmodSync(resolve(directory, 'app.sqlite'), 0o600);
    chmodSync(resolve(directory, 'instance.sqlite'), 0o600);
    const database = db;
    return { db: database, recovery, close() { database.close(); lock.close(); } };
  } catch (error) {
    db?.close();
    lock.close();
    throw error;
  }
}
