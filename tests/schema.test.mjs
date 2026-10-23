import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const schema = readFileSync(new URL('../design/schema.sql', import.meta.url), 'utf8');

function database(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(schema);
  db.exec(`
    INSERT INTO connections VALUES ('source-a', 'weread', 1, 'secret/example-source', 1000);
    INSERT INTO connections VALUES ('source-b', 'weread', 0, 'secret/example-other', 1000);
    INSERT INTO connections VALUES ('target-a', 'flomo', 1, 'secret/example-target', 1000);
    INSERT INTO books VALUES ('source-a', 'book-example', '示例书籍', '虚构作者', NULL, '{}', 1000);
    INSERT INTO books VALUES ('source-b', 'book-example', '另一账号的示例书籍', '虚构作者', NULL, '{}', 1000);
  `);
  return db;
}

function insertNote(db, connection = 'source-a', kind = 'thought') {
  return db.prepare(`
    INSERT INTO notes (connection_id, book_id, kind, source_id, content,
      first_seen_at, last_seen_at, updated_at, content_hash, raw_json)
    VALUES (?, 'book-example', ?, 'record-example', '合成测试内容', 1000, 1000, 1000, 'example-hash', '{}')
  `).run(connection, kind).lastInsertRowid;
}

test('the schema rejects duplicate source records and isolates accounts and kinds', (t) => {
  const db = database(t);
  insertNote(db);
  assert.throws(() => insertNote(db), /UNIQUE/);
  insertNote(db, 'source-b');
  insertNote(db, 'source-a', 'highlight');
  assert.equal(db.prepare('SELECT count(*) AS n FROM notes').get().n, 3);
});

test('book references, raw JSON and record types are validated', (t) => {
  const db = database(t);
  assert.throws(() => insertNote(db, 'unknown-source'), /FOREIGN KEY/);
  assert.throws(() => insertNote(db, 'source-a', 'unsupported'), /CHECK/);
  const id = insertNote(db);
  assert.throws(() => db.prepare('UPDATE notes SET raw_json = ? WHERE id = ?').run('invalid', id), /CHECK/);
  assert.throws(() => db.exec("DELETE FROM books WHERE connection_id = 'source-a'"), /FOREIGN KEY/);
});

test('removed notes require a recorded basis and can be restored without duplication', (t) => {
  const db = database(t);
  const id = insertNote(db);
  assert.throws(() => db.prepare("UPDATE notes SET status = 'removed' WHERE id = ?").run(id), /CHECK/);
  db.prepare("UPDATE notes SET status = 'removed', removal_basis = 'inferred_absence' WHERE id = ?").run(id);
  db.prepare("UPDATE notes SET status = 'active', removal_basis = NULL, missing_scans = 0 WHERE id = ?").run(id);
  assert.equal(db.prepare('SELECT status FROM notes WHERE id = ?').get(id).status, 'active');
});

test('a note has at most one delivery to a destination and sent requires a timestamp', (t) => {
  const db = database(t);
  const noteId = insertNote(db);
  const statement = db.prepare(`
    INSERT INTO deliveries (note_id, destination_id, matched_rules_json, rendered_text,
      payload_hash, created_at, updated_at)
    VALUES (?, 'target-a', '[{"id":"example-rule","revision":1}]', '合成发送内容', 'payload-example', 1000, 1000)
  `);
  const id = statement.run(noteId).lastInsertRowid;
  assert.throws(() => statement.run(noteId), /UNIQUE/);
  assert.throws(() => db.prepare("UPDATE deliveries SET status = 'sent' WHERE id = ?").run(id), /CHECK/);
  db.prepare("UPDATE deliveries SET status = 'sent', sent_at = 2000 WHERE id = ?").run(id);
  assert.equal(db.prepare('SELECT status FROM deliveries WHERE id = ?').get(id).status, 'sent');
});

test('running scans and active connections cannot overlap', (t) => {
  const db = database(t);
  assert.throws(() => db.exec("UPDATE connections SET enabled = 1 WHERE id = 'source-b'"), /UNIQUE/);
  const statement = db.prepare(`
    INSERT INTO sync_runs (id, connection_id, mode, status, started_at)
    VALUES (?, 'source-a', 'full', 'running', 1000)
  `);
  statement.run('run-a');
  assert.throws(() => statement.run('run-b'), /UNIQUE/);
  db.exec("UPDATE sync_runs SET status = 'interrupted', finished_at = 2000 WHERE id = 'run-a'");
  statement.run('run-b');
  assert.equal(db.prepare("SELECT count(*) AS n FROM sync_runs WHERE status = 'running'").get().n, 1);
});

test('rules require a baseline before activation and schedules require a next run', (t) => {
  const db = database(t);
  db.exec(`
    INSERT INTO rules (id, name, source_connection_id, destination_id,
      filters_json, output_json, created_at, updated_at)
    VALUES ('rule-example', '仅想法', 'source-a', 'target-a', '{"kinds":["thought"]}', '{}', 1000, 1000);
  `);
  assert.throws(() => db.exec("UPDATE rules SET enabled = 1 WHERE id = 'rule-example'"), /CHECK/);
  assert.throws(() => db.exec("INSERT INTO job_state (name, enabled, interval_seconds) VALUES ('sync', 1, 900)"), /CHECK/);
  db.exec("INSERT INTO job_state (name, enabled, interval_seconds, next_due_at) VALUES ('sync', 1, 900, 1000)");
});

test('attempt history preserves ambiguous results and prevents simultaneous attempts', (t) => {
  const db = database(t);
  const noteId = insertNote(db);
  const deliveryId = db.prepare(`
    INSERT INTO deliveries (note_id, destination_id, matched_rules_json, rendered_text,
      payload_hash, created_at, updated_at, status)
    VALUES (?, 'target-a', '[]', '合成发送内容', 'payload-example', 1000, 1000, 'sending')
  `).run(noteId).lastInsertRowid;
  const attempt = db.prepare("INSERT INTO delivery_attempts (delivery_id, started_at, outcome) VALUES (?, 1000, 'started')");
  attempt.run(deliveryId);
  assert.throws(() => attempt.run(deliveryId), /UNIQUE/);
  db.exec('BEGIN');
  db.prepare("UPDATE delivery_attempts SET outcome = 'uncertain', finished_at = 2000 WHERE delivery_id = ?").run(deliveryId);
  db.prepare("UPDATE deliveries SET status = 'uncertain', updated_at = 2000 WHERE id = ?").run(deliveryId);
  db.exec('COMMIT');
  assert.equal(db.prepare('SELECT outcome FROM delivery_attempts WHERE delivery_id = ?').get(deliveryId).outcome, 'uncertain');
  assert.equal(db.prepare('SELECT status FROM deliveries WHERE id = ?').get(deliveryId).status, 'uncertain');
});

test('failed transactions do not leave partial note updates', (t) => {
  const db = database(t);
  const id = insertNote(db);
  db.exec('BEGIN');
  try {
    db.prepare("UPDATE notes SET content = '未提交的新内容' WHERE id = ?").run(id);
    insertNote(db);
  } catch {
    db.exec('ROLLBACK');
  }
  assert.equal(db.prepare('SELECT content FROM notes WHERE id = ?').get(id).content, '合成测试内容');
});
