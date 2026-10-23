import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixture, FakeProvider, origin } from './helpers.js';
import { defaultRule } from '../../src/shared/rules.js';
import { openStore } from '../../src/server/store.js';
import { createApp } from '../../src/server/app.js';
import { Vault } from '../../src/server/vault.js';
import { restoreDatabase } from '../../src/server/restore.js';
import Database from 'better-sqlite3';

async function prepared() {
  let now = Date.now(); const sent: string[] = [];
  const provider = new FakeProvider();
  const sender = async (_url: string, content: string) => { sent.push(content); return { status: 'sent' as const }; };
  const f = await fixture(provider, { now: () => now, sender });
  await f.setup(); const source = (await f.connect()).json().id;
  const destination = (await f.request('/connections', { provider: 'flomo', secret: ['https://flomoapp.com', 'iwh', 'synthetic-recovery'].join('/') })).json().id;
  f.sync.start(); await f.sync.idle();
  const rule = defaultRule(source, destination); rule.history = 'include_history';
  await f.request('/rules', { config: rule, enabled: true, confirmHistory: true });
  const state = f.automation.settings();
  f.automation.save({ ...state, config: { ...state.config, syncEnabled: true, deliveryEnabled: true }, confirmSend: true });
  f.automation.prepare();
  return { f, provider, sent, sender, now: () => now, advance(ms: number) { now += ms; } };
}

test('a trusted checkpoint survives restart; a pre-commit crash locks delivery until explicit review', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weread-checkpoint-'));
  let store = openStore(directory);
  try {
    assert.equal(store.recovery.required, false);
    store.db.transaction(() => store.recovery.advance())(); store.close();
    store = openStore(directory); assert.equal(store.recovery.required, false);
    assert.throws(() => store.db.transaction(() => { store.recovery.advance(); throw new Error('synthetic crash'); })(), /synthetic crash/);
    store.close(); store = openStore(directory); assert.equal(store.recovery.required, true);
    store.recovery.acknowledge(); store.close(); store = openStore(directory);
    assert.equal(store.recovery.required, false);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('restoring an older database or losing its external checkpoint requires review', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'weread-rollback-'));
  let store = openStore(directory);
  try {
    await store.db.backup(join(directory, 'older.sqlite'));
    store.db.transaction(() => store.recovery.advance())(); store.close();
    copyFileSync(join(directory, 'older.sqlite'), join(directory, 'app.sqlite'));
    store = openStore(directory); assert.equal(store.recovery.required, true);
    store.recovery.acknowledge(); store.close();
    unlinkSync(join(directory, 'delivery-checkpoint.json'));
    store = openStore(directory); assert.equal(store.recovery.required, true);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('schema 5 upgrade preserves enabled settings and cooldown but requires an initial recovery baseline', () => {
  const directory = mkdtempSync(join(tmpdir(), 'weread-recovery-upgrade-'));
  const old = new Database(join(directory, 'app.sqlite'));
  try {
    for (const migration of ['001','002','003','004','005']) old.exec(readFileSync(`migrations/${migration}.sql`, 'utf8'));
    old.pragma('user_version = 5');
    old.prepare("UPDATE automation SET config_json = json_set(config_json, '$.deliveryEnabled', json('true'), '$.syncEnabled', json('true')), delivery_cooldown = 12345").run();
    const before = old.prepare('SELECT config_json, delivery_cooldown FROM automation').get(); old.close();
    const upgraded = openStore(directory);
    try {
      assert.deepEqual(upgraded.db.prepare('SELECT config_json, delivery_cooldown FROM automation').get(), before);
      assert.equal(upgraded.recovery.required, true);
      upgraded.recovery.acknowledge();
    } finally { upgraded.close(); }
    const reopened = openStore(directory);
    try { assert.equal(reopened.recovery.required, false); } finally { reopened.close(); }
  } finally { if (old.open) old.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('disabled plans stay disabled and runtime blocks survive a normal restart', async () => {
  const p = await prepared(); const { f } = p;
  const current = f.automation.settings();
  f.automation.save({ ...current, config: { ...current.config, syncEnabled: false, deliveryEnabled: false } });
  f.store.db.prepare("UPDATE automation SET sync_block = 'UPSTREAM_AUTH', delivery_block = 'FLOMO_REJECTED'").run();
  await f.app.close(); f.store.close();
  const store = openStore(f.directory);
  const app = await createApp({ store, vault: new Vault(store, f.key), setupToken: '', origin, timers: false, providerFactory: () => p.provider, now: p.now, sender: p.sender });
  try {
    const calls = p.provider.calls.length; await app.automation.tick();
    assert.equal(p.provider.calls.length, calls); assert.equal(p.sent.length, 0);
    assert.equal(app.automation.state().config.syncEnabled, false); assert.equal(app.automation.state().config.deliveryEnabled, false);
    assert.deepEqual(app.automation.state().blocks, { sync: 'UPSTREAM_AUTH', deliver: 'FLOMO_REJECTED' });
  } finally { await app.app.close(); store.close(); rmSync(f.directory, { recursive: true, force: true }); }
});

test('restart keeps enabled plans, isolates an interrupted attempt, syncs first and sends other tasks once', async () => {
  const p = await prepared(); const { f } = p;
  f.store.db.transaction(() => {
    f.store.recovery.advance();
    f.store.db.prepare("UPDATE deliveries SET status = 'sending' WHERE id = 1").run();
    f.store.db.prepare("INSERT INTO delivery_attempts (delivery_id, started_at, outcome, content, matched_rules_json) VALUES (1, ?, 'started', 'synthetic', '[]')").run(p.now());
  })();
  await f.app.close(); f.store.close();
  const store = openStore(f.directory);
  let reads = 0; p.provider.handler = (name, params) => { reads++; return p.provider.sample(name, params); };
  const app = await createApp({ store, vault: new Vault(store, f.key), setupToken: '', origin, timers: false, providerFactory: () => p.provider, now: p.now,
    sender: async (url, content) => { assert(reads >= 3); return p.sender(url, content); } });
  try {
    assert.equal(app.automation.state().config.deliveryEnabled, true);
    assert.equal(app.automation.state().config.syncEnabled, true);
    assert.equal(app.automation.state().counts.uncertain, 1);
    assert.equal(app.automation.state().blocks.deliver, null);
    assert.equal(app.automation.state().startupSyncPending, true);
    await app.automation.tick(); assert.equal(p.sent.length, 1);
    assert.equal(app.automation.state().counts.sent, 1);
    assert.equal(app.automation.state().startupSyncPending, false);
    p.advance(60000); await app.automation.tick(); assert.equal(p.sent.length, 1);
    assert.equal(app.automation.state().counts.uncertain, 1);
  } finally { await app.app.close(); store.close(); rmSync(f.directory, { recursive: true, force: true }); }
});

test('startup read failure waits with backoff; source deletion is reconciled before any import', async () => {
  const p = await prepared(); const { f } = p;
  await f.app.close(); f.store.close();
  const store = openStore(f.directory);
  p.provider.handler = () => { throw new Error('synthetic offline'); };
  const app = await createApp({ store, vault: new Vault(store, f.key), setupToken: '', origin, timers: false, providerFactory: () => p.provider, now: p.now, sender: p.sender });
  try {
    await app.automation.tick(); assert.equal(p.sent.length, 0); assert.equal(app.automation.state().config.deliveryEnabled, true);
    const calls = p.provider.calls.length; await app.automation.tick(); assert.equal(p.provider.calls.length, calls);
    p.provider.handler = (name, params) => name === '/review/list/mine' ? { reviews: [], totalCount: 0, hasMore: 0 } : p.provider.sample(name, params);
    p.advance(60000); await app.automation.tick();
    assert.equal(p.sent.length, 1); assert.equal(app.automation.state().counts.held, 1);
    assert.equal(app.automation.state().counts.sent, 1);
    assert.equal(app.automation.state().startupSyncPending, false);
  } finally { await app.app.close(); store.close(); rmSync(f.directory, { recursive: true, force: true }); }
});

test('restart preserves retry attempts, cooldown, quota and successful deduplication', async () => {
  const p = await prepared(); const { f } = p;
  await f.automation.tick(); assert.equal(p.sent.length, 1);
  f.store.db.prepare("UPDATE deliveries SET status = 'retry', retries = 3, next_attempt_at = ? WHERE status = 'queued'").run(p.now() + 600000);
  f.store.db.prepare('UPDATE automation SET delivery_cooldown = ?').run(p.now() + 600000);
  await f.app.close(); f.store.close();
  const store = openStore(f.directory);
  const app = await createApp({ store, vault: new Vault(store, f.key), setupToken: '', origin, timers: false, providerFactory: () => p.provider, now: p.now, sender: p.sender });
  try {
    await app.automation.tick(); assert.equal(p.sent.length, 1); assert.equal(app.automation.state().usedQuota, 1);
    assert.equal((app.automation.list({ status: 'retry' }).items[0] as { retries: number }).retries, 3);
    p.advance(600000); await app.automation.tick(); assert.equal(p.sent.length, 2);
    p.advance(60000); await app.automation.tick(); assert.equal(p.sent.length, 2);
  } finally { await app.app.close(); store.close(); rmSync(f.directory, { recursive: true, force: true }); }
});

test('a broken checkpoint blocks before HTTP, ordinary settings cannot bypass it and review requires auth/CSRF/confirmation', async () => {
  const p = await prepared(); const { f } = p;
  try {
    writeFileSync(join(f.directory, 'delivery-checkpoint.json'), '{}');
    await f.automation.tick(); assert.equal(p.sent.length, 0);
    assert.equal(f.automation.state().blocks.deliver, 'BACKUP_REVIEW');
    assert.equal(f.automation.state().usedQuota, 0);
    assert.equal((await f.request('/automation', { ...f.automation.settings(), confirmSend: true })).json().error, 'BACKUP_REVIEW');
    assert.equal((await f.request('/automation/recovery', { confirm: true }, { cookie: '' })).statusCode, 401);
    assert.equal((await f.request('/automation/recovery', { confirm: true }, { 'x-csrf-token': '' })).statusCode, 403);
    assert.equal((await f.request('/automation/recovery', { confirm: false })).statusCode, 400);
    assert.equal((await f.request('/automation/recovery', { confirm: true })).statusCode, 200);
    assert.equal(f.automation.state().startupSyncPending, true);
    await f.automation.tick(); assert.equal(p.sent.length, 1);
  } finally { await f.close(); }
});

test('restore tool refuses a live instance, checks the key and locks even a matching snapshot for review', async () => {
  const p = await prepared(); const { f } = p;
  const backup = join(f.directory, 'snapshot.sqlite');
  writeFileSync(join(f.directory, 'master.key'), f.key, { mode: 0o600 });
  await f.store.db.backup(backup);
  await assert.rejects(restoreDatabase(backup, f.directory, f.directory), /locked/);
  await f.app.close(); f.store.close();
  try {
    const before = readFileSync(join(f.directory, 'app.sqlite'));
    writeFileSync(join(f.directory, 'master.key'), Buffer.alloc(32));
    await assert.rejects(restoreDatabase(backup, f.directory, f.directory));
    assert.deepEqual(readFileSync(join(f.directory, 'app.sqlite')), before);
    writeFileSync(join(f.directory, 'master.key'), f.key);
    const result = await restoreDatabase(backup, f.directory, f.directory); assert.ok(result.previous);
    const restored = openStore(f.directory);
    try {
      assert.equal(restored.recovery.required, true);
      assert.equal((restored.db.prepare('SELECT delivery_block FROM automation').get() as { delivery_block: string }).delivery_block, 'BACKUP_REVIEW');
    } finally { restored.close(); }
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});
