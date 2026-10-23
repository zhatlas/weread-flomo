import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { defaultRule, ruleConfigSchema } from '../../src/shared/rules.js';
import { matchNote } from '../../src/server/rules.js';
import { openStore } from '../../src/server/store.js';
import { loadMasterKey, Vault } from '../../src/server/vault.js';
import { createSession, findSession } from '../../src/server/auth.js';
import { createApp } from '../../src/server/app.js';

test('migration is persistent, exclusive instance lock releases on close, interrupted scans recover', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weread-store-'));
  try {
    const store = openStore(directory);
    assert.equal(store.db.pragma('user_version', { simple: true }), 6);
    assert.throws(() => openStore(directory), /locked/);
    store.db.prepare("INSERT INTO connections VALUES ('source', 'weread', 1, 'secret', 1)").run();
    store.db.prepare("INSERT INTO sync_runs (id, connection_id, mode, status, started_at) VALUES ('run', 'source', 'full', 'running', 1)").run();
    const key = randomBytes(32); new Vault(store, key).put('secret', 'synthetic value');
    const session = createSession(store); store.close();
    const reopened = openStore(directory);
    try {
      const row = reopened.db.prepare('SELECT status, finished_at FROM sync_runs').get() as { status: string; finished_at: number };
      assert.equal(row.status, 'interrupted'); assert.ok(row.finished_at > 1);
      assert.equal(new Vault(reopened, key).get('secret'), 'synthetic value');
      assert.equal(findSession(reopened, session.token)?.csrf, session.csrf);
      assert.equal(statSync(join(directory, 'app.sqlite')).mode & 0o777, 0o600);
    } finally { reopened.db.pragma('user_version = 7'); reopened.close(); }
    assert.throws(() => openStore(directory), /DATABASE_NEWER_THAN_APP/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('missing master key fails closed when encrypted records exist', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weread-key-'));
  try {
    assert.throws(() => loadMasterKey(directory, true), /MASTER_KEY_MISSING/);
    const key = loadMasterKey(directory, false);
    assert.equal(key.length, 32); assert.deepEqual(loadMasterKey(directory, true), key);
    assert.equal(statSync(join(directory, 'master.key')).mode & 0o777, 0o600);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('server shutdown interrupts the worker before the database is closed', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weread-shutdown-'));
  const store = openStore(directory);
  const vault = new Vault(store, randomBytes(32));
  vault.put('key', 'synthetic-value');
  store.db.prepare("INSERT INTO connections VALUES ('source', 'weread', 1, 'key', 1)").run();
  const { app, sync } = await createApp({ store, vault, setupToken: 'unused', origin: 'http://127.0.0.1:3000', providerFactory: () => ({
    call: async (_name, _params, signal) => new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
  }) });
  app.addHook('onClose', async () => { store.close(); });
  try {
    await app.ready(); const id = sync.start(); await app.close();
    const reopened = openStore(directory);
    try { assert.equal((reopened.db.prepare('SELECT status FROM sync_runs WHERE id = ?').get(id) as { status: string }).status, 'interrupted'); }
    finally { reopened.close(); }
  } finally {
    await app.close();
    if (store.db.open) store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('upgrading an M1 database preserves books, credentials and sessions and persists rules after reopening', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weread-migration-'));
  try {
    const old = new Database(join(directory, 'app.sqlite'));
    old.exec(readFileSync('migrations/001.sql', 'utf8')); old.pragma('user_version = 1');
    old.prepare("INSERT INTO connections VALUES ('source', 'weread', 1, 'secret', 1)").run();
    old.prepare("INSERT INTO connections VALUES ('destination', 'flomo', 1, 'other', 1)").run();
    old.prepare("INSERT INTO books (connection_id, book_id, title, raw_json, last_seen_at) VALUES ('source', 'book', '合成迁移书籍', '{}', 1)").run();
    old.prepare("INSERT INTO sessions VALUES ('hash', 'csrf', 9999999999999)").run(); old.close();
    const store = openStore(directory);
    assert.equal(store.db.pragma('user_version', { simple: true }), 6);
    assert.equal((store.db.prepare('SELECT count(*) AS n FROM books').get() as { n: number }).n, 1);
    assert.equal((store.db.prepare('SELECT csrf FROM sessions').get() as { csrf: string }).csrf, 'csrf');
    store.db.prepare("INSERT INTO rules (id, name, source_connection_id, destination_id, revision, config_json, created_at, updated_at) VALUES ('rule', '合成规则', 'source', 'destination', 1, '{}', 1, 1)").run();
    store.close();
    const reopened = openStore(directory);
    try { assert.equal((reopened.db.prepare('SELECT name FROM rules').get() as { name: string }).name, '合成规则'); }
    finally { reopened.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('M2 upgrade retains rule configuration and baselines while new automation starts disabled', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weread-m2-upgrade-'));
  try {
    const old = new Database(join(directory, 'app.sqlite'));
    old.exec(readFileSync('migrations/001.sql', 'utf8')); old.exec(readFileSync('migrations/002.sql', 'utf8')); old.pragma('user_version = 2');
    old.prepare("INSERT INTO connections VALUES ('source', 'weread', 1, 'secret', 1)").run();
    old.prepare("INSERT INTO connections VALUES ('destination', 'flomo', 1, 'other', 1)").run();
    old.prepare("INSERT INTO sync_runs (id, connection_id, mode, status, started_at, finished_at) VALUES ('baseline','source','full','succeeded',1,2)").run();
    old.prepare("INSERT INTO rules VALUES ('rule','existing','source','destination',1,7,'{\"synthetic\":true}','baseline',12,3,1,3)").run(); old.close();
    const upgraded = openStore(directory);
    try {
      assert.equal(upgraded.db.pragma('user_version', { simple: true }), 6);
      const rule = upgraded.db.prepare('SELECT revision, enabled, config_json, baseline_note_id FROM rules').get() as { revision: number; enabled: number; config_json: string; baseline_note_id: number };
      assert.deepEqual(rule, { revision: 7, enabled: 1, config_json: '{"synthetic":true}', baseline_note_id: 12 });
      const configuration = JSON.parse((upgraded.db.prepare('SELECT config_json FROM automation').get() as { config_json: string }).config_json);
      assert.equal(configuration.syncEnabled, false); assert.equal(configuration.deliveryEnabled, false);
      assert.equal((upgraded.db.prepare('SELECT count(*) AS n FROM deliveries').get() as { n: number }).n, 0);
    } finally { upgraded.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('M3 rules migrate to unrestricted books and fixed output without losing baselines or sent deduplication', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weread-format-upgrade-'));
  const source = randomUUID(); const destination = randomUUID(); const ruleId = randomUUID();
  const config = defaultRule(source, destination); config.history = 'include_history'; config.filters.include = ['阅读'];
  const legacy = { ...config, schemaVersion: 1, filters: { ...config.filters, bookIds: ['excluded-book'], authors: ['旧作者'] }, output: { fields: ['thought'], tags: ['微信读书', '阅读/收藏'] } };
  try {
    const old = new Database(join(directory, 'app.sqlite'));
    for (const migration of ['001', '002', '003']) old.exec(readFileSync(`migrations/${migration}.sql`, 'utf8'));
    old.pragma('user_version = 3');
    old.prepare("INSERT INTO connections VALUES (?, 'weread', 1, 'secret', 1)").run(source);
    old.prepare("INSERT INTO connections VALUES (?, 'flomo', 1, 'other', 1)").run(destination);
    old.prepare("INSERT INTO sync_runs (id, connection_id, mode, status, started_at, finished_at) VALUES ('baseline',?,'full','succeeded',1,2)").run(source);
    old.prepare("INSERT INTO rules VALUES (?,'existing',?,?,1,7,?,'baseline',12,3,1,3)").run(ruleId, source, destination, JSON.stringify(legacy));
    old.prepare("INSERT INTO books (connection_id, book_id, raw_json, last_seen_at) VALUES (?, 'book', '{}', 1)").run(source);
    old.prepare("INSERT INTO notes (id, connection_id, book_id, kind, source_id, first_seen_at, last_seen_at, updated_at, content_hash, raw_json) VALUES (1, ?, 'book', 'thought', 'note', 1, 1, 1, 'hash', '{}')").run(source);
    old.prepare("INSERT INTO deliveries (note_id, destination_id, status, content, matched_rules_json, created_at, updated_at, sent_at) VALUES (1, ?, 'sent', '旧格式已发送', '[]', 1, 2, 2)").run(destination);
    const sent = old.prepare('SELECT * FROM deliveries').get(); old.close();
    const upgraded = openStore(directory);
    try {
      const row = upgraded.db.prepare('SELECT * FROM rules').get() as { config_json: string; revision: number; baseline_note_id: number; enabled: number };
      const migrated = ruleConfigSchema.parse(JSON.parse(row.config_json));
      assert.equal(row.revision, 8); assert.equal(row.baseline_note_id, 12); assert.equal(row.enabled, 1);
      assert.deepEqual(migrated, { ...config, output: { tags: ['阅读/收藏'] } });
      assert.deepEqual(matchNote({ id: 1, kind: 'thought', status: 'active', book_id: 'any-book', title: null, author: null, chapter_name: null, source_created_at: null, content: '阅读', original_text: null }, migrated), []);
      assert.deepEqual(upgraded.db.prepare('SELECT * FROM deliveries').get(), { ...sent as object, source_hold: null });
      assert.throws(() => upgraded.db.prepare("INSERT INTO deliveries (note_id, destination_id, status, content, matched_rules_json, created_at, updated_at) VALUES (1, ?, 'queued', '新格式', '[]', 3, 3)").run(destination), /UNIQUE/);
    } finally { upgraded.close(); }
    const reopened = openStore(directory);
    try { assert.equal((reopened.db.prepare('SELECT revision FROM rules').get() as { revision: number }).revision, 8); }
    finally { reopened.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('schema 4 upgrade adds deletion bookkeeping without changing existing notes or deliveries', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weread-deletion-migration-'));
  try {
    const old = new Database(join(directory, 'app.sqlite'));
    for (const migration of ['001','002','003','004']) old.exec(readFileSync(`migrations/${migration}.sql`, 'utf8'));
    old.pragma('user_version = 4');
    old.prepare("INSERT INTO connections VALUES ('source','weread',1,'secret',1)").run();
    old.prepare("INSERT INTO connections VALUES ('destination','flomo',1,'other',1)").run();
    old.prepare("INSERT INTO books (connection_id, book_id, raw_json, last_seen_at) VALUES ('source','book','{}',1)").run();
    for (const id of [1,2]) old.prepare("INSERT INTO notes (id, connection_id, book_id, kind, source_id, first_seen_at, last_seen_at, updated_at, content_hash, raw_json) VALUES (?, 'source', 'book', 'thought', ?, 1, 1, 1, 'hash', '{}')").run(id, `note-${id}`);
    old.prepare("INSERT INTO deliveries (note_id, destination_id, status, content, matched_rules_json, created_at, updated_at, retries) VALUES (1,'destination','retry','existing','[]',1,1,2)").run();
    old.prepare("INSERT INTO deliveries (note_id, destination_id, status, content, matched_rules_json, created_at, updated_at, sent_at) VALUES (2,'destination','sent','already sent','[]',1,2,2)").run();
    const notes = old.prepare('SELECT * FROM notes ORDER BY id').all() as object[]; const deliveries = old.prepare('SELECT * FROM deliveries ORDER BY id').all() as object[]; old.close();
    const store = openStore(directory);
    try {
      assert.equal(store.db.pragma('user_version', { simple: true }), 6);
      assert.deepEqual(store.db.prepare('SELECT * FROM notes ORDER BY id').all(), notes.map((row) => ({ ...row, first_missing_at: null, removed_at: null, last_checked_run_id: null, source_error_code: null })));
      assert.deepEqual(store.db.prepare('SELECT * FROM deliveries ORDER BY id').all(), deliveries.map((row) => ({ ...row, source_hold: null })));
      assert.deepEqual(store.db.pragma('foreign_key_check'), []);
    } finally { store.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
