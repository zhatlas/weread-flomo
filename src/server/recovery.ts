import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AppError } from './errors.js';

type Checkpoint = { instance_id: string; checkpoint: string; review_required: number };
export class RecoveryGuard {
  private path: string;
  constructor(private db: Database.Database, directory: string, fresh: boolean) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.path = resolve(directory, 'delivery-checkpoint.json');
    if (fresh && !existsSync(this.path)) this.write(this.row());
    this.inspect();
  }
  private row() { return this.db.prepare('SELECT * FROM recovery_state WHERE id = 1').get() as Checkpoint; }
  get required() { return !!this.row().review_required; }
  inspect() {
    const row = this.row();
    try {
      const saved = JSON.parse(readFileSync(this.path, 'utf8')) as Checkpoint;
      if (saved.instance_id === row.instance_id && saved.checkpoint === row.checkpoint) return this.required;
    } catch { /* Missing or unreadable evidence must not permit automatic delivery. */ }
    this.db.prepare('UPDATE recovery_state SET review_required = 1 WHERE id = 1').run();
    return true;
  }
  private write(row: Checkpoint) {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      const fd = openSync(temporary, 'wx', 0o600);
      try { writeFileSync(fd, JSON.stringify({ instance_id: row.instance_id, checkpoint: row.checkpoint })); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temporary, this.path);
      const directory = openSync(dirname(this.path), 'r');
      try { fsyncSync(directory); } finally { closeSync(directory); }
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }
  // The file is durable before the SQLite transaction commits, and before any HTTP write.
  advance() {
    if (this.inspect()) throw new AppError('BACKUP_REVIEW', 409);
    const row = { ...this.row(), checkpoint: randomUUID() };
    this.write(row);
    this.db.prepare('UPDATE recovery_state SET checkpoint = ? WHERE id = 1').run(row.checkpoint);
  }
  acknowledge() {
    this.db.transaction(() => {
      const row = { ...this.row(), checkpoint: randomUUID() };
      this.write(row);
      this.db.prepare('UPDATE recovery_state SET checkpoint = ?, review_required = 0 WHERE id = 1').run(row.checkpoint);
    })();
  }
}
