import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixture, sampleThought, FakeProvider, origin } from './helpers.js';
import { defaultRule } from '../../src/shared/rules.js';
import { AppError } from '../../src/server/errors.js';
import { openStore } from '../../src/server/store.js';
import { createApp } from '../../src/server/app.js';
import { Vault } from '../../src/server/vault.js';
import type { Sender } from '../../src/server/flomo.js';

type F = Awaited<ReturnType<typeof fixture>>;
type NoteState = { id: number; status: string; missing_scans: number; first_missing_at: number | null; removed_at: number | null; removal_basis: string | null; source_error_code: string | null; content: string };
type Task = { id: number; note_id: number; status: string; source_hold: string | null; error_code: string | null; retries: number; next_attempt_at: number | null };
const note = (f: F) => f.store.db.prepare("SELECT * FROM notes WHERE kind = 'thought' ORDER BY id LIMIT 1").get() as NoteState;
const task = (f: F) => f.store.db.prepare("SELECT d.* FROM deliveries d JOIN notes n ON n.id = d.note_id WHERE n.kind = 'thought' ORDER BY d.id LIMIT 1").get() as Task;
async function scan(f: F, mode: 'full' | 'light' = 'full') { const id = f.sync.start(mode); await f.sync.idle(); return id; }
function absent(f: F) { f.provider.handler = (name, params) => name === '/review/list/mine' ? { reviews: [], totalCount: 0, hasMore: 0 } : f.provider.sample(name, params); }
async function prepared(sender?: Sender) {
  let now = Date.now(); const writes: string[] = [];
  const f = await fixture(new FakeProvider(), { now: () => now, sender: sender ?? (async (_url, content) => { writes.push(content); return { status: 'sent', remoteId: 'synthetic' }; }) });
  await f.setup(); const source = (await f.connect()).json().id;
  const destination = (await f.request('/connections', { provider: 'flomo', secret: ['https://flomoapp.com','iwh','synthetic-deletion'].join('/') })).json().id;
  await scan(f);
  const config = defaultRule(source, destination); config.history = 'include_history'; config.filters.kinds = ['thought'];
  assert.equal((await f.request('/rules', { config, enabled: true, confirmHistory: true })).statusCode, 200);
  f.automation.prepare();
  function enable() { const current = f.automation.settings(); f.automation.save({ ...current, config: { ...current.config, deliveryEnabled: true }, confirmSend: true }); }
  return { f, writes, source, destination, enable, advance() { now += 60000; } };
}

test('first missing thought immediately holds its task; second complete scan soft-deletes and cancels; reappearance restores the same identity', async (t) => {
  const p = await prepared(); const { f } = p; t.after(() => f.close()); const before = note(f); const originalTask = task(f);
  absent(f); await scan(f); const first = note(f);
  assert.equal(first.status, 'missing'); assert.equal(first.missing_scans, 1); assert.ok(first.first_missing_at); assert.equal(first.removed_at, null);
  assert.equal(task(f).status, 'queued'); assert.equal(task(f).source_hold, 'SOURCE_MISSING');
  assert.equal(f.automation.state().counts.held, 1); assert.equal((await f.request('/deliveries?status=held')).json().total, 1);
  assert.equal((await f.request('/notes?status=missing')).json().total, 1);
  p.enable(); await f.automation.tick(); assert.equal(p.writes.length, 0);
  await scan(f); const removed = note(f);
  assert.equal(removed.status, 'removed'); assert.equal(removed.missing_scans, 2); assert.equal(removed.removal_basis, 'inferred_absence'); assert.ok(removed.removed_at);
  assert.equal(task(f).status, 'cancelled'); assert.equal(task(f).error_code, 'SOURCE_REMOVED');
  f.automation.prepare(); p.advance(); await f.automation.tick(); assert.equal(p.writes.length, 0);
  assert.equal((await f.request('/notes?status=removed')).json().items[0].id, before.id);
  f.provider.handler = undefined; await scan(f); f.automation.prepare();
  assert.equal(note(f).status, 'active'); assert.equal(note(f).first_missing_at, null); assert.equal(note(f).removed_at, null);
  assert.equal(task(f).id, originalTask.id); assert.equal(task(f).status, 'queued'); assert.equal(task(f).source_hold, null); assert.equal(task(f).error_code, null);
  p.advance(); await f.automation.tick(); assert.equal(p.writes.length, 1);
});

test('successful flomo deliveries and attempt history are untouched by source deletion and restoration', async (t) => {
  const p = await prepared(); const { f } = p; t.after(() => f.close()); p.enable(); await f.automation.tick();
  const sent = task(f); const attempts = f.store.db.prepare('SELECT * FROM delivery_attempts').all();
  absent(f); await scan(f); await scan(f);
  assert.equal(note(f).status, 'removed'); assert.deepEqual(task(f), sent); assert.deepEqual(f.store.db.prepare('SELECT * FROM delivery_attempts').all(), attempts);
  f.provider.handler = undefined; await scan(f); f.automation.prepare(); p.advance(); await f.automation.tick();
  assert.equal(p.writes.length, 1); assert.deepEqual(task(f), sent);
});

test('failure breaks consecutive absence, never unholds a missing note, and manual retry cannot bypass source checks', async (t) => {
  const p = await prepared(); const { f } = p; t.after(() => f.close());
  f.store.db.prepare("UPDATE deliveries SET status='retry', retries=2, error_code='FLOMO_RATE_LIMIT', next_attempt_at=9999999999999").run();
  absent(f); await scan(f);
  assert.equal(task(f).status, 'retry'); assert.equal(task(f).retries, 2); assert.equal(task(f).error_code, 'FLOMO_RATE_LIMIT');
  assert.equal((await f.request(`/deliveries/${task(f).id}/resolve`, { action: 'retry', confirm: true })).json().error, 'SOURCE_NOT_READY');
  f.provider.handler = (name, params) => { if (name === '/review/list/mine') throw new AppError('UPSTREAM_NETWORK', 502); return f.provider.sample(name, params); };
  await scan(f); assert.equal(note(f).missing_scans, 0); assert.equal(note(f).status, 'missing'); assert.equal(task(f).source_hold, 'SOURCE_MISSING');
  absent(f); await scan(f); assert.equal(note(f).status, 'missing'); assert.equal(note(f).missing_scans, 1);
  await scan(f); assert.equal(note(f).status, 'removed'); assert.equal(task(f).status, 'cancelled');
});

test('unverified totals, changed totals, duplicate IDs and partial pagination cannot prove deletion', async (t) => {
  const p = await prepared(); const { f } = p; t.after(() => f.close()); const before = note(f).content;
  const invalid = [
    () => ({ reviews: [], hasMore: 0 }),
    () => ({ reviews: [], totalCount: 1, hasMore: 0 }),
    () => ({ reviews: [{ review: sampleThought }, { review: sampleThought }], totalCount: 2, hasMore: 0 }),
    (_params: Record<string, unknown>) => ({ reviews: [], totalCount: -1, hasMore: 0 }),
    (params: Record<string, unknown>) => params.synckey === undefined ? { reviews: [{ review: { ...sampleThought, content: 'partial must not commit' } }], totalCount: 2, hasMore: 1, synckey: 2 } : { reviews: [{ review: { ...sampleThought, reviewId: 'another' } }], totalCount: 3, hasMore: 0 },
    (params: Record<string, unknown>) => { if (params.synckey !== undefined) throw new AppError('UPSTREAM_NETWORK'); return { reviews: [{ review: { ...sampleThought, content: 'partial must not commit' } }], totalCount: 2, hasMore: 1, synckey: 2 }; },
  ];
  for (const response of invalid) {
    f.provider.handler = (name, params) => name === '/review/list/mine' ? response(params) : f.provider.sample(name, params);
    await scan(f); assert.equal(note(f).status, 'unavailable'); assert.equal(note(f).missing_scans, 0); assert.equal(note(f).content, before);
    assert.ok(task(f).source_hold); assert.equal(task(f).status, 'queued');
  }
  f.provider.handler = undefined; await scan(f); assert.equal(note(f).status, 'active'); assert.equal(task(f).source_hold, null);
});

test('the final thought is checked by old book ID after its book disappears, even in light mode', async (t) => {
  const p = await prepared(); const { f } = p; t.after(() => f.close());
  f.provider.handler = (name, params) => name === '/user/notebooks' ? { books: [], hasMore: 0 } : name === '/review/list/mine' ? { reviews: [], totalCount: 0, hasMore: 0 } : f.provider.sample(name, params);
  await scan(f, 'light'); assert.equal(note(f).status, 'missing'); await scan(f, 'light'); assert.equal(note(f).status, 'removed');
  assert.equal((await f.request('/notes?kind=highlight')).json().items[0].status, 'active');
});

test('missing and unavailable books bypass unchanged fingerprints; skipped books do not count as checks', async (t) => {
  const p = await prepared(); const { f } = p; t.after(() => f.close()); absent(f);
  const calls = f.provider.calls.length; await scan(f, 'light'); assert.equal(f.provider.calls.length - calls, 1); assert.equal(note(f).status, 'active');
  await scan(f); assert.equal(note(f).missing_scans, 1);
  await scan(f, 'light'); assert.equal(note(f).status, 'removed');
});

test('multi-page verified reads count only once per scan and notebook count mismatches hold the source', async (t) => {
  const p = await prepared(); const { f } = p; t.after(() => f.close());
  f.provider.handler = (name, params) => name === '/review/list/mine' ? { reviews: [{ review: { ...sampleThought, reviewId: params.synckey === undefined ? 'new-a' : 'new-b' } }], totalCount: 2, hasMore: params.synckey === undefined ? 1 : 0, synckey: 2 } : f.provider.sample(name, params);
  await scan(f); assert.equal(note(f).missing_scans, 1); await scan(f); assert.equal(note(f).status, 'removed');
  f.provider.handler = (name, params) => name === '/user/notebooks' ? { books: [{ bookId: 'book-1', reviewCount: 99 }], hasMore: 0 } : f.provider.sample(name, params);
  await scan(f); assert.equal((await f.request('/status')).json().runs[0].status, 'partial');
  assert.equal((await f.request('/notes?status=unavailable')).json().total, 2);
});

test('large drops and multiple simultaneously empty books are quarantined rather than inferred deleted', async (t) => {
  const p = await prepared(); const { f } = p; t.after(() => f.close());
  f.provider.handler = (name, params) => name === '/review/list/mine' ? { reviews: Array.from({ length: 6 }, (_, i) => ({ review: { ...sampleThought, reviewId: i ? `thought-${i+1}` : sampleThought.reviewId } })), totalCount: 6, hasMore: 0 } : f.provider.sample(name, params);
  await scan(f); f.automation.prepare(); absent(f); await scan(f); await scan(f);
  const rows = f.store.db.prepare("SELECT status, missing_scans, source_error_code FROM notes WHERE kind='thought'").all() as NoteState[];
  assert.ok(rows.every((n) => n.status === 'unavailable' && n.missing_scans === 0 && n.source_error_code === 'SOURCE_ANOMALY'));
  assert.equal(f.automation.state().counts.held, 6); assert.equal(f.automation.state().counts.cancelled ?? 0, 0);
  f.provider.handler = (name, params) => name === '/user/notebooks' ? { books: [{ bookId: 'book-1' }, { bookId: 'book-2' }], hasMore: 0 } : name === '/review/list/mine' ? { reviews: [{ review: { ...sampleThought, bookId: params.bookid } }], totalCount: 1, hasMore: 0 } : name === '/book/bookmarklist' ? { updated: [] } : f.provider.sample(name, params);
  await scan(f);
  absent(f); await scan(f);
  assert.equal((await f.request('/notes?status=removed')).json().total, 0);
  assert.ok((await f.request('/notes?kind=thought')).json().items.every((n: NoteState) => n.source_error_code === 'SOURCE_ANOMALY'));
});

test('a failed scope pauses only its thoughts; unread scopes after connection failure are held too', async (t) => {
  const p = await prepared(); const { f } = p; t.after(() => f.close());
  f.provider.handler = (name, params) => { if (name === '/review/list/mine') throw new AppError('UPSTREAM_NETWORK'); return f.provider.sample(name, params); };
  await scan(f); assert.equal(note(f).status, 'unavailable'); assert.equal((await f.request('/notes?kind=highlight')).json().items[0].status, 'active');
  f.provider.handler = undefined; await scan(f);
  f.provider.handler = () => { throw new AppError('UPSTREAM_AUTH'); };
  await scan(f); assert.equal(note(f).status, 'unavailable'); assert.equal(task(f).source_hold, 'SOURCE_UNAVAILABLE');
  p.enable(); await f.automation.tick(); assert.equal(p.writes.length, 0);
});

test('restart preserves a first absence and its hold; a second check cancels without losing dedup identity', async (t) => {
  const p = await prepared(); const { f } = p; t.after(() => f.close()); absent(f); await scan(f);
  const directory = mkdtempSync(join(tmpdir(), 'weread-deletion-restart-')); await f.store.db.backup(join(directory, 'app.sqlite'));
  const store = openStore(directory); const provider = new FakeProvider(); provider.handler = (name, params) => name === '/review/list/mine' ? { reviews: [], totalCount: 0, hasMore: 0 } : provider.sample(name, params);
  const app = await createApp({ store, vault: new Vault(store, f.key), setupToken: 'unused', origin, providerFactory: () => provider, timers: false, sender: async () => { throw new Error('Must not send'); } });
  try {
    assert.equal((store.db.prepare("SELECT source_hold FROM deliveries").get() as Task).source_hold, 'SOURCE_MISSING');
    app.sync.start(); await app.sync.idle(); assert.equal((store.db.prepare("SELECT status FROM notes WHERE kind='thought'").get() as NoteState).status, 'removed');
    app.automation.prepare(); assert.equal((store.db.prepare('SELECT status FROM deliveries').get() as Task).status, 'cancelled');
  } finally { await app.app.close(); store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('an in-flight send blocks manual sync; uncertain attempts remain uncertain after source removal', async (t) => {
  let complete!: (value: { status: 'uncertain'; error: string }) => void;
  const p = await prepared(async () => new Promise((resolve) => { complete = resolve; })); const { f } = p;
  t.after(() => f.close()); p.enable(); const pending = f.automation.tick();
  try {
    assert.equal((await f.request('/sync', {})).statusCode, 409); assert.throws(() => f.sync.start(), /SYNC_BUSY/);
  } finally { complete({ status: 'uncertain', error: 'FLOMO_UNCERTAIN' }); await pending; }
  const uncertain = task(f); const attempts = f.store.db.prepare('SELECT * FROM delivery_attempts').all(); absent(f); await scan(f); await scan(f);
  assert.deepEqual(task(f), uncertain); assert.deepEqual(f.store.db.prepare('SELECT * FROM delivery_attempts').all(), attempts);
  assert.equal((await f.request(`/deliveries/${task(f).id}/resolve`, { action: 'retry', confirm: true })).json().error, 'SOURCE_NOT_READY');
  assert.equal((await f.request(`/deliveries/${task(f).id}/resolve`, { action: 'mark_sent', confirm: true })).statusCode, 200);
});

test('source recovery preserves a previously blocked delivery and does not reset retry accounting', async (t) => {
  const p = await prepared(); const { f } = p; t.after(() => f.close());
  f.store.db.prepare("UPDATE deliveries SET status='blocked', error_code='RETRY_EXHAUSTED', retries=5").run();
  absent(f); await scan(f); assert.equal(task(f).source_hold, 'SOURCE_MISSING');
  f.provider.handler = undefined; await scan(f); f.automation.prepare();
  assert.equal(task(f).status, 'blocked'); assert.equal(task(f).source_hold, null); assert.equal(task(f).retries, 5); assert.equal(task(f).error_code, 'RETRY_EXHAUSTED');
  p.enable(); await f.automation.tick(); assert.equal(p.writes.length, 0);
});

test('interrupted sync recovery resets deletion evidence and holds pending tasks before another send can start', async (t) => {
  const p = await prepared(); const { f } = p; t.after(() => f.close()); absent(f); await scan(f);
  const directory = mkdtempSync(join(tmpdir(), 'weread-deletion-interrupted-')); await f.store.db.backup(join(directory, 'app.sqlite'));
  const { default: Database } = await import('better-sqlite3'); const copied = new Database(join(directory, 'app.sqlite'));
  copied.prepare("INSERT INTO sync_runs (id, connection_id, mode, status, started_at) VALUES ('interrupted-check', ?, 'full', 'running', 1)").run(p.source); copied.close();
  const store = openStore(directory);
  try {
    const row = store.db.prepare("SELECT * FROM notes WHERE kind='thought'").get() as NoteState;
    assert.equal(row.status, 'missing'); assert.equal(row.missing_scans, 0); assert.equal(row.source_error_code, 'SYNC_INTERRUPTED');
    assert.equal((store.db.prepare('SELECT source_hold FROM deliveries').get() as Task).source_hold, 'SOURCE_MISSING');
    assert.equal((store.db.prepare("SELECT status FROM sync_runs WHERE id='interrupted-check'").get() as { status: string }).status, 'interrupted');
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
