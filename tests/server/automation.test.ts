import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, FakeProvider } from './helpers.js';
import { defaultRule } from '../../src/shared/rules.js';
import { nextSchedule } from '../../src/server/automation.js';
import { createApp } from '../../src/server/app.js';
import { openStore } from '../../src/server/store.js';
import { Vault } from '../../src/server/vault.js';
import type { SendResult, Sender } from '../../src/server/flomo.js';
import type { AutomationConfig } from '../../src/shared/automation.js';
const defaults: AutomationConfig = { syncEnabled: false, deliveryEnabled: false, schedule: 'interval', intervalMinutes: 15, dailyTime: '09:00', timezone: 'Asia/Shanghai', syncMode: 'full', dailyLimit: 100, maxContentChars: 5000 };
async function prepared(sender?: Sender) {
  let now = Date.now(); const sent: string[] = []; let outcome: SendResult = { status: 'sent', remoteId: 'synthetic-id' };
  const f = await fixture(new FakeProvider(), { now: () => now, sender: sender ?? (async (_url, content) => { sent.push(content); return outcome; }) });
  await f.setup(); const source = (await f.connect()).json().id;
  const destination = (await f.request('/connections', { provider: 'flomo', secret: ['https://flomoapp.com','iwh','synthetic-worker'].join('/') })).json().id;
  await f.request('/sync', {}); await f.sync.idle();
  const config = defaultRule(source, destination); config.history = 'include_history';
  const rule = (await f.request('/rules', { config, enabled: true, confirmHistory: true })).json();
  function settings(patch: Partial<AutomationConfig>, confirmSend = true) { const current = f.automation.settings(); return f.automation.save({ ...current, config: { ...current.config, ...patch }, confirmSend }); }
  return { f, sent, rule, settings, get now() { return now; }, advance(ms: number) { now += ms; }, outcome(value: SendResult) { outcome = value; } };
}
test('interval and daily schedules honor timezone, DST, and choose the next occurrence', () => {
  const start = Date.parse('2026-03-07T09:00:00-05:00');
  assert.equal(nextSchedule(defaults, start), start + 15 * 60000);
  const daily = { ...defaults, schedule: 'daily' as const, timezone: 'America/New_York' };
  assert.equal(nextSchedule(daily, start) - start, 23 * 3600000);
  assert.equal(nextSchedule(daily, Date.parse('2026-10-31T09:00:00-04:00')) - Date.parse('2026-10-31T09:00:00-04:00'), 25 * 3600000);
  assert.equal(nextSchedule({ ...daily, dailyTime: '02:30' }, Date.parse('2026-03-08T00:00:00-05:00')), Date.parse('2026-03-08T03:30:00-04:00'));
  assert.equal(nextSchedule({ ...daily, dailyTime: '01:30' }, Date.parse('2026-11-01T01:31:00-04:00')), Date.parse('2026-11-02T01:30:00-05:00'));
  assert.throws(() => nextSchedule({ ...daily, timezone: 'wrong' }, start), /RULE_DATE/);
});
test('scheduled sync persists due times, runs once after missed intervals, and does not overlap', async () => {
  const p = await prepared(); const { f } = p;
  try {
    const initial = f.provider.calls.length; await f.automation.tick(); assert.equal(f.provider.calls.length, initial);
    p.settings({ syncEnabled: true, intervalMinutes: 5 });
    await f.automation.tick(); assert.equal(f.provider.calls.length, initial);
    p.advance(5 * 60000); await Promise.all([f.automation.tick(), f.automation.tick()]);
    assert.equal((f.store.db.prepare('SELECT count(*) AS n FROM sync_runs').get() as { n: number }).n, 2);
    p.advance(20 * 60000); await f.automation.tick();
    assert.equal((f.store.db.prepare('SELECT count(*) AS n FROM sync_runs').get() as { n: number }).n, 3);
    assert.equal(f.automation.state().jobs.find((j) => j.name === 'sync')!.next_due_at, p.now + 5 * 60000);
    assert.equal(p.sent.length, 0);
  } finally { await f.close(); }
});
test('light scans skip unchanged books, changed/failed scopes are read again, and periodic full scans reconcile', async () => {
  const p = await prepared(); const { f } = p;
  try {
    let before = f.provider.calls.length; f.sync.start('light'); await f.sync.idle(); assert.equal(f.provider.calls.length - before, 1);
    let changed = 2; let fail = true;
    f.provider.handler = (name, params) => { if (name === '/user/notebooks') return { books: [{ bookId: 'book-1', sort: changed, book: { title: '阅读与生活', author: '示例作者', reviewCount: 0 } }], hasMore: 0 }; if (name === '/review/list/mine' && fail) throw new Error('synthetic'); return f.provider.sample(name, params); };
    f.sync.start('light'); await f.sync.idle(); fail = false; before = f.provider.calls.length;
    f.sync.start('light'); await f.sync.idle(); assert.equal(f.provider.calls.length - before, 3);
    before = f.provider.calls.length; f.sync.start('light'); await f.sync.idle(); assert.equal(f.provider.calls.length - before, 1);
    changed++; p.settings({ syncEnabled: true, syncMode: 'light', intervalMinutes: 5 }); p.advance(5 * 60000); await f.automation.tick();
    assert.equal((f.store.db.prepare('SELECT mode FROM sync_runs ORDER BY rowid DESC LIMIT 1').get() as { mode: string }).mode, 'light');
    p.advance(86400000); await f.automation.tick(); assert.equal((f.store.db.prepare('SELECT mode FROM sync_runs ORDER BY rowid DESC LIMIT 1').get() as { mode: string }).mode, 'full');
  } finally { await f.close(); }
});
test('multiple rules create one task per note/destination; current payload is used and successful notes never resend', async () => {
  const p = await prepared(); const { f } = p;
  try {
    await f.request('/rules', { config: { ...p.rule.config, name: 'second', output: { tags: ['second'] } }, enabled: true, confirmHistory: true });
    f.automation.prepare(); f.automation.prepare(); assert.equal(f.automation.state().counts.queued, 2);
    const first = f.automation.list({}).items as { matched_rules_json: string; content: string }[];
    assert.equal(JSON.parse(first[0].matched_rules_json).length, 2); assert.ok(first[0].content.includes('> '));
    f.store.db.prepare("UPDATE notes SET content = '最新合成想法' WHERE kind = 'thought'").run();
    p.settings({ deliveryEnabled: true }); await f.automation.tick(); p.advance(5000); await f.automation.tick();
    assert.equal(p.sent.length, 2); assert.ok(p.sent.some((text) => text.includes('📝 想法：最新合成想法')));
    for (const text of p.sent) { assert.ok(text.startsWith('《阅读与生活》 示例作者 · 第一章 · 阅读的意义\n> ')); assert.ok(text.endsWith('#微信读书/阅读与生活')); }
    f.store.db.prepare("UPDATE notes SET content = '已导入后再修改' WHERE kind = 'thought'").run();
    f.automation.prepare(); p.advance(60000); await f.automation.tick(); assert.equal(p.sent.length, 2); assert.equal(f.automation.state().counts.sent, 2);
  } finally { await f.close(); }
});
test('changing rules before sending cancels pending tasks and source namespaces cannot cross targets', async () => {
  const p = await prepared(); const { f } = p;
  try {
    f.automation.prepare(); const edited = await f.request(`/rules/${p.rule.id}`, { config: { ...p.rule.config, filters: { ...p.rule.config.filters, include: ['不存在的词'] } }, enabled: true, revision: p.rule.revision });
    assert.equal(edited.statusCode, 200); p.settings({ deliveryEnabled: true }); await f.automation.tick();
    assert.equal(p.sent.length, 0); assert.equal(f.automation.state().counts.cancelled, 2);
    await f.request('/connections', { provider: 'flomo', secret: ['https://flomoapp.com','iwh','different-target'].join('/'), confirmReplace: true });
    assert.equal(f.automation.state().config.deliveryEnabled, false); assert.equal(f.automation.state().config.syncEnabled, false);
    f.automation.prepare(); assert.equal(f.automation.state().counts.queued ?? 0, 0);
  } finally { await f.close(); }
});
test('429 retry cooldown survives settings toggles; retries are bounded and stored without duplicate tasks', async () => {
  const p = await prepared(); const { f } = p;
  try {
    p.outcome({ status: 'retry', error: 'FLOMO_RATE_LIMIT', retryAt: p.now + 600000 }); p.settings({ deliveryEnabled: true }); await f.automation.tick();
    assert.equal(p.sent.length, 1); assert.equal(f.automation.state().counts.retry, 1);
    p.settings({ deliveryEnabled: false }); p.settings({ deliveryEnabled: true }); p.advance(599999); await f.automation.tick(); assert.equal(p.sent.length, 1);
    p.advance(1); p.outcome({ status: 'sent' }); await f.automation.tick(); assert.equal(p.sent.length, 2); assert.equal(f.automation.state().counts.sent, 1);
    p.advance(5000); p.outcome({ status: 'retry', error: 'FLOMO_CONNECT' }); await f.automation.tick();
    for (let i = 0; i < 4; i++) { p.advance(3600000); await f.automation.tick(); }
    assert.equal(f.automation.state().counts.blocked, 1); assert.equal(f.automation.state().config.deliveryEnabled, true); assert.equal(f.automation.state().blocks.deliver, 'RETRY_EXHAUSTED');
    assert.equal((f.automation.list({ status: 'blocked' }).items[0] as { error_code: string }).error_code, 'RETRY_EXHAUSTED');
  } finally { await f.close(); }
});
test('uncertain writes hold only their task; other tasks continue and manual confirmation preserves deduplication', async () => {
  const p = await prepared(); const { f } = p;
  try {
    p.outcome({ status: 'uncertain', error: 'FLOMO_UNCERTAIN' }); p.settings({ deliveryEnabled: true }); await f.automation.tick();
    const row = f.automation.list({ status: 'uncertain' }).items[0] as { id: number };
    assert.ok(row); assert.equal(f.automation.state().config.deliveryEnabled, true);
    p.outcome({ status: 'sent' }); p.advance(5000); await f.automation.tick(); assert.equal(p.sent.length, 2);
    p.advance(86400000); await f.automation.tick(); assert.equal(p.sent.length, 2);
    assert.throws(() => f.automation.resolve(row.id, { action: 'retry', confirm: false }), /AUTOMATION_VALIDATION/);
    f.automation.resolve(row.id, { action: 'mark_sent', confirm: true }); assert.throws(() => f.automation.resolve(row.id, { action: 'retry', confirm: true }), /DELIVERY_STATE/);
    p.outcome({ status: 'sent' }); p.settings({ deliveryEnabled: true }); await f.automation.tick();
    assert.equal(p.sent.length, 2); assert.equal(f.automation.state().counts.sent, 2);
  } finally { await f.close(); }
});
test('quota counts all attempts over rolling 24 hours and oversized content is blocked without truncation', async () => {
  const p = await prepared(); const { f } = p;
  try {
    p.settings({ deliveryEnabled: true, dailyLimit: 1 }); await f.automation.tick(); p.advance(5000); await f.automation.tick();
    assert.equal(p.sent.length, 1); assert.equal(f.automation.state().usedQuota, 1);
    p.advance(86400000); await f.automation.tick(); assert.equal(p.sent.length, 2);
  } finally { await f.close(); }
  const q = await prepared();
  try {
    q.settings({ deliveryEnabled: true, maxContentChars: 1 }); await q.f.automation.tick();
    const row = q.f.automation.list({ status: 'blocked' }).items[0] as { content: string; id: number }; assert.ok(row.content.length > 1); assert.equal(q.sent.length, 0); assert.equal(q.f.automation.state().usedQuota, 0);
    q.settings({ maxContentChars: 5000 }); q.f.automation.resolve(row.id, { action: 'retry', confirm: true }); q.advance(5000); await q.f.automation.tick(); assert.equal(q.sent.length, 1);
  } finally { await q.f.close(); }
});
test('database restart/old-backup recovery pauses writes and recovers started attempts as uncertain while preserving schedules', async () => {
  const p = await prepared(); const { f } = p; const directory = mkdtempSync(join(tmpdir(), 'weread-m3-restore-'));
  try {
    f.automation.prepare(); p.settings({ syncEnabled: true, deliveryEnabled: true });
    f.store.db.prepare("UPDATE deliveries SET status = 'sending' WHERE id = 1").run();
    f.store.db.prepare("INSERT INTO delivery_attempts (delivery_id, started_at, outcome, content, matched_rules_json) VALUES (1, ?, 'started', 'synthetic snapshot', '[]')").run(p.now);
    f.store.db.prepare("UPDATE job_state SET last_result = 'running' WHERE name = 'sync'").run();
    await f.store.db.backup(join(directory, 'app.sqlite'));
    const store = openStore(directory); const vault = new Vault(store, f.key);
    const restored = await createApp({ store, vault, setupToken: 'unused', origin: 'http://127.0.0.1:3000', timers: false, sender: async () => { throw new Error('Must not send restored data'); }, providerFactory: () => f.provider });
    try {
      await restored.app.ready(); const state = restored.automation.state(); assert.equal(state.config.deliveryEnabled, true); assert.equal(state.blocks.deliver, 'BACKUP_REVIEW'); assert.equal(state.config.syncEnabled, true); assert.equal(state.counts.uncertain, 1); assert.equal(state.usedQuota, 1); assert.equal(state.jobs.find((j) => j.name === 'sync')!.last_result, 'interrupted');
      assert.equal((restored.automation.detail(1).attempts[0] as { outcome: string }).outcome, 'uncertain');
      await restored.automation.tick(); assert.equal(p.sent.length, 0);
    } finally { await restored.app.close(); store.close(); }
  } finally { await f.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('shutdown waits for in-flight write to become uncertain before closing the database', async () => {
  let began!: () => void; const started = new Promise<void>((resolve) => { began = resolve; });
  const p = await prepared(async (_url, _content, signal) => { began(); return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ status: 'uncertain', error: 'SEND_INTERRUPTED' }), { once: true })); });
  try {
    p.settings({ deliveryEnabled: true }); const task = p.f.automation.tick(); await started;
    await p.f.app.close(); await task; assert.equal(p.f.automation.state().counts.uncertain, 1);
    assert.equal((p.f.automation.detail(1).attempts[0] as { outcome: string }).outcome, 'uncertain');
  } finally { await p.f.close(); }
});
test('automation endpoints enforce authentication, CSRF, send confirmation and optimistic settings revisions', async () => {
  const p = await prepared(); const { f } = p;
  try {
    assert.equal((await f.request('/automation', undefined, { cookie: '' })).statusCode, 401);
    assert.equal((await f.request('/deliveries', undefined, { cookie: '' })).statusCode, 401);
    assert.equal((await f.request('/deliveries/prepare', {}, { 'x-csrf-token': '' })).statusCode, 403);
    assert.throws(() => p.settings({ deliveryEnabled: true }, false), /SEND_CONFIRM/);
    const stale = f.automation.settings(); p.settings({ intervalMinutes: 30 });
    assert.equal((await f.request('/automation', stale)).json().error, 'AUTOMATION_CONFLICT');
    assert.throws(() => p.settings({ intervalMinutes: 0 }), /AUTOMATION_VALIDATION/);
    assert.equal(f.automation.state().config.deliveryEnabled, false);
  } finally { await f.close(); }
});
test('sync failures back off, a later success recovers, and source authentication failures pause the schedule', async () => {
  const p = await prepared(); const { f } = p;
  try {
    p.settings({ syncEnabled: true, intervalMinutes: 15 });
    f.provider.handler = () => { throw new Error('synthetic read failure'); };
    p.advance(15 * 60000); await f.automation.tick();
    let job = f.automation.state().jobs.find((j) => j.name === 'sync')!;
    assert.equal(job.last_result, 'failed'); assert.equal(job.next_due_at, p.now + 60000);
    f.provider.handler = undefined; p.advance(60000); await f.automation.tick();
    job = f.automation.state().jobs.find((j) => j.name === 'sync')!; assert.equal(job.failures, 0); assert.equal(job.last_result, 'succeeded');
    const { AppError } = await import('../../src/server/errors.js');
    f.provider.handler = () => { throw new AppError('UPSTREAM_AUTH'); }; p.advance(15 * 60000); await f.automation.tick();
    assert.equal(f.automation.state().config.syncEnabled, true); assert.equal(f.automation.state().blocks.sync, 'UPSTREAM_AUTH'); assert.equal(f.automation.state().jobs.find((j) => j.name === 'sync')!.error_code, 'UPSTREAM_AUTH');
  } finally { await f.close(); }
});
