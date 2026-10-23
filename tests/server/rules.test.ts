import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { defaultRule, ruleConfigSchema } from '../../src/shared/rules.js';
import { dateBounds, formatNote, matchNote } from '../../src/server/rules.js';
import { fixture, syntheticKey, sampleThought } from './helpers.js';

const note = { id: 1, book_id: 'book-1', kind: 'thought' as const, status: 'active', content: 'Reading 每天思考 100% _ [.*]', original_text: '原文，阅读改变生活。', title: '合成书籍', author: ' 示例作者 ', chapter_name: '第一章', source_created_at: Date.parse('2026-01-01T00:00:00+08:00') };
function config() { return defaultRule(randomUUID(), randomUUID()); }
async function connected() {
  const f = await fixture(); await f.setup();
  const source = (await f.connect()).json().id as string;
  const destination = (await f.request('/connections', { provider: 'flomo', secret: ['https://flomoapp.com', 'iwh', 'synthetic-destination'].join('/') })).json().id as string;
  return { f, rule: defaultRule(source, destination) };
}
async function synced(f: Awaited<ReturnType<typeof fixture>>) { await f.request('/sync', {}); await f.sync.idle(); }

test('matching combines filters with AND, literal case-insensitive any/all keywords and exclusion priority', () => {
  const c = config();
  c.filters = { ...c.filters, kinds: ['thought'], include: ['READING', '原文'], includeMode: 'all' };
  assert.deepEqual(matchNote(note, c), []);
  c.filters.keywordFields = ['content']; assert.deepEqual(matchNote(note, c), ['INCLUDE']);
  c.filters.includeMode = 'any'; assert.deepEqual(matchNote(note, c), []);
  c.filters.include = ['does not exist']; c.filters.exclude = ['reading']; assert.deepEqual(matchNote(note, c), ['EXCLUDE']);
  c.filters.exclude = []; c.filters.include = ['% _ [.*]']; assert.deepEqual(matchNote(note, c), []);
  c.filters.include = ['read.*']; assert.deepEqual(matchNote(note, c), ['INCLUDE']);
  c.filters.include = []; assert.deepEqual(matchNote({ ...note, kind: 'highlight', book_id: 'other', author: null, status: 'removed' }, c), ['INACTIVE', 'KIND']);
});
test('date filters include both local days and exclude absent times; DST days are not assumed to be 24 hours', () => {
  const c = config(); c.filters.startDate = '2026-01-01'; c.filters.endDate = '2026-01-01';
  const bounds = dateBounds(c); assert.equal(bounds.start, note.source_created_at); assert.equal(bounds.end, note.source_created_at + 86_400_000);
  assert.deepEqual(matchNote(note, c), []);
  assert.deepEqual(matchNote({ ...note, source_created_at: bounds.end! - 1 }, c), []);
  assert.deepEqual(matchNote({ ...note, source_created_at: bounds.end! }, c), ['DATE']);
  assert.deepEqual(matchNote({ ...note, source_created_at: null }, c), ['TIME_MISSING']);
  c.timezone = 'America/New_York'; c.filters.startDate = c.filters.endDate = '2026-03-08';
  let b = dateBounds(c); assert.equal(b.end! - b.start!, 23 * 3600_000);
  c.filters.startDate = c.filters.endDate = '2026-11-01'; b = dateBounds(c); assert.equal(b.end! - b.start!, 25 * 3600_000);
  c.filters.startDate = '2026-11-02'; assert.throws(() => dateBounds(c), /RULE_DATE/);
  c.filters.startDate = '2026-02-30'; assert.throws(() => dateBounds(c), /RULE_DATE/);
  c.filters.startDate = c.filters.endDate = ''; c.timezone = 'invalid/zone'; assert.throws(() => dateBounds(c), /RULE_DATE/);
  c.timezone = '+08:00'; assert.throws(() => dateBounds(c), /RULE_DATE/);
});
test('rule input trims empty words, rejects unknown fields and invalid tags, formatter preserves full text with missing fields', () => {
  const c = config(); c.filters.include = [' ', ' 阅读 ', '阅读']; c.output.tags = ['#阅读/想法'];
  const parsed = ruleConfigSchema.parse(c); assert.deepEqual(parsed.filters.include, ['阅读']); assert.deepEqual(parsed.output.tags, ['阅读/想法']);
  assert.equal(ruleConfigSchema.safeParse({ ...c, script: 'arbitrary' }).success, false);
  assert.equal(ruleConfigSchema.safeParse({ ...c, output: { fields: [], tags: [] } }).success, false);
  assert.equal(ruleConfigSchema.safeParse({ ...c, output: { ...c.output, tags: ['bad tag'] } }).success, false);
  assert.equal(ruleConfigSchema.safeParse({ ...c, filters: { ...c.filters, bookIds: ['book-1'] } }).success, false);
  assert.equal(ruleConfigSchema.safeParse({ ...c, filters: { ...c.filters, authors: ['示例作者'] } }).success, false);
  const text = formatNote({ ...note, original_text: null, chapter_name: null }, parsed);
  assert.equal(text, `《合成书籍》 示例作者 · （章节缺失）\n> （原文缺失）\n📝 想法：${note.content}\n#微信读书/合成书籍 #阅读/想法`);
  const long = '<img src=x onerror=alert(1)>\n'.repeat(2000);
  assert.ok(formatNote({ ...note, content: long }, parsed).includes(`📝 想法：${long}`));

});
test('rules API requires authentication and CSRF, validates connection roles and rule input', async () => {
  const { f, rule } = await connected();
  try {
    assert.equal((await f.request('/rules', undefined, { cookie: '' })).statusCode, 401);
    assert.equal((await f.request('/rules/preview', { config: rule }, { cookie: '' })).statusCode, 401);
    assert.equal((await f.request('/rules', { config: rule, enabled: false }, { 'x-csrf-token': '' })).statusCode, 403);
    assert.equal((await f.request('/rules', { config: { ...rule, sourceConnectionId: rule.destinationId }, enabled: false })).json().error, 'RULE_CONNECTION');
    assert.equal((await f.request('/rules', { config: { ...rule, timezone: 'bad' }, enabled: false })).json().error, 'RULE_DATE');
    assert.equal((await f.request('/rules', { config: rule, enabled: false, baselineNoteId: 0 })).json().error, 'RULE_VALIDATION');
    const saved = (await f.request('/rules', { config: rule, enabled: false })).json();
    assert.equal(saved.revision, 1); assert.equal(saved.enabled, false); assert.equal(saved.baselineRunId, null);
    assert.equal((await f.request('/rules')).json().items.length, 1);
    assert.equal(f.provider.calls.length, 1); // Only the prior read-only connection check.
  } finally { await f.close(); }
});
test('activation refuses absent, incomplete and in-progress baselines, and uses the current source complete run', async () => {
  const { f, rule } = await connected();
  try {
    const save = () => f.request('/rules', { config: rule, enabled: true });
    assert.equal((await save()).json().error, 'RULE_BASELINE');
    await synced(f);
    const run = (f.store.db.prepare('SELECT id FROM sync_runs').get() as { id: string }).id;
    f.store.db.prepare("UPDATE sync_runs SET status = 'partial' WHERE id = ?").run(run);
    assert.equal((await save()).json().error, 'RULE_BASELINE');
    f.store.db.prepare("UPDATE sync_runs SET status = 'succeeded', coverage_json = '{}' WHERE id = ?").run(run);
    assert.equal((await save()).json().error, 'RULE_BASELINE');
    f.store.db.prepare("UPDATE sync_runs SET coverage_json = ? WHERE id = ?").run(JSON.stringify({ listComplete: true, expectedBooks: 1 }), run);
    f.store.db.prepare("DELETE FROM sync_items WHERE kind = 'thought'").run();
    assert.equal((await save()).json().error, 'RULE_BASELINE');
    await synced(f);
    f.store.db.prepare("INSERT INTO sync_runs (id, connection_id, mode, status, started_at) VALUES (?, ?, 'full', 'running', ?)").run(randomUUID(), rule.sourceConnectionId, Date.now());
    assert.equal((await save()).json().error, 'SYNC_BUSY');
    f.store.db.prepare("UPDATE sync_runs SET status = 'interrupted', finished_at = ? WHERE status = 'running'").run(Date.now());
    assert.equal((await save()).json().error, 'RULE_BASELINE');
    await synced(f);
    const response = await save(); assert.equal(response.statusCode, 200); assert.equal(response.json().enabled, true);
  } finally { await f.close(); }
});
test('new-only baseline excludes existing notes and edited notes, includes newly observed IDs even with old source dates, survives pause', async () => {
  const { f, rule } = await connected();
  try {
    await synced(f);
    const before = (await f.request('/rules/preview', { config: rule })).json();
    assert.equal(before.matched, 2); assert.equal(before.eligible, 0); assert.equal(before.baselinePending, true);
    const saved = (await f.request('/rules', { config: rule, enabled: true })).json();
    assert.equal(saved.baselineNoteId, 2);
    f.provider.handler = (name, params) => name === '/review/list/mine' ? { reviews: [{ review: { ...sampleThought, content: '修改已有想法' } }, { review: { ...sampleThought, reviewId: 'new-id', createTime: 1000 } }], hasMore: 0 } : f.provider.sample(name, params);
    await synced(f);
    const input = { config: rule, id: saved.id, revision: saved.revision };
    const preview = (await f.request('/rules/preview', input)).json();
    assert.equal(preview.matched, 3); assert.equal(preview.eligible, 1); assert.equal(preview.reasons.EXISTING_NOTE, 2);
    const eligible = (await f.request('/rules/preview', { ...input, view: 'eligible' })).json(); assert.equal(eligible.items.length, 1); assert.equal(eligible.items[0].source_created_at, 1000_000);
    const disabled = (await f.request(`/rules/${saved.id}`, { config: rule, enabled: false, revision: saved.revision })).json();
    const resumed = (await f.request(`/rules/${saved.id}`, { config: rule, enabled: true, revision: disabled.revision })).json();
    assert.equal(resumed.baselineNoteId, saved.baselineNoteId); assert.equal(resumed.activatedAt, saved.activatedAt);
    assert.equal((await f.request(`/rules/${saved.id}`, { config: { ...rule, history: 'include_history' }, enabled: true, revision: resumed.revision })).json().error, 'RULE_HISTORY_LOCKED');
  } finally { await f.close(); }
});
test('history requires explicit activation confirmation; edit revisions reject stale saves and previews; no delivery tasks exist', async () => {
  const { f, rule } = await connected();
  try {
    await synced(f); rule.history = 'include_history'; rule.filters.kinds = ['thought'];
    const preview = (await f.request('/rules/preview', { config: rule })).json(); assert.equal(preview.eligible, 1);
    assert.equal(preview.items[0].text, formatNote({ ...note, ...preview.items[0] }, rule));
    assert.equal(preview.items[0].blocks.length, 4); assert.equal(preview.items[0].blocks.join('\n'), preview.items[0].text);
    assert.ok(preview.items[0].blocks[1].startsWith('> ')); assert.ok(preview.items[0].blocks[2].startsWith('📝 想法：'));
    assert.equal((await f.request('/rules', { config: rule, enabled: true })).json().error, 'RULE_HISTORY_CONFIRM');
    const saved = (await f.request('/rules', { config: rule, enabled: true, confirmHistory: true })).json();
    const copy = (await f.request('/rules', { config: { ...rule, name: '复制规则' }, enabled: false })).json(); assert.equal(copy.baselineRunId, null); assert.notEqual(copy.id, saved.id);
    rule.filters.exclude = ['自己的思考'];
    const edited = (await f.request(`/rules/${saved.id}`, { config: rule, enabled: true, revision: saved.revision })).json(); assert.equal(edited.revision, 2);
    assert.equal((await f.request(`/rules/${saved.id}`, { config: rule, enabled: true, revision: saved.revision })).json().error, 'RULE_CONFLICT');
    assert.equal((await f.request('/rules/preview', { config: rule, id: saved.id, revision: saved.revision })).json().error, 'RULE_CONFLICT');
    const excluded = (await f.request('/rules/preview', { config: rule, id: saved.id, revision: edited.revision, view: 'excluded' })).json();
    assert.equal(excluded.matched, 0); assert.equal(excluded.excluded, 2); assert.equal(excluded.reasons.EXCLUDE, 1);
    assert.equal((f.store.db.prepare('SELECT count(*) AS n FROM deliveries').get() as { n: number }).n, 0);
  } finally { await f.close(); }
});
test('replacing either connection disables bound rules, retains old previews and prevents baseline transfer', async () => {
  const { f, rule } = await connected();
  try {
    await synced(f);
    const saved = (await f.request('/rules', { config: rule, enabled: true })).json();
    const other = (await f.connect(`${syntheticKey}next`, true)).json().id;
    const inactive = (await f.request('/rules')).json().items[0]; assert.equal(inactive.enabled, false); assert.equal(inactive.revision, 2);
    assert.equal((await f.request(`/rules/${saved.id}`, { config: rule, enabled: true, revision: inactive.revision })).json().error, 'RULE_CONNECTION');
    assert.equal((await f.request(`/rules/${saved.id}`, { config: { ...rule, sourceConnectionId: other }, enabled: false, revision: inactive.revision })).json().error, 'RULE_IDENTITY');
    assert.equal((await f.request('/rules/preview', { config: rule, id: saved.id, revision: inactive.revision })).json().matched, 2);
    const newRule = { ...rule, sourceConnectionId: other };
    assert.equal((await f.request('/rules', { config: newRule, enabled: true })).json().error, 'RULE_BASELINE');
    await synced(f);
    const fresh = (await f.request('/rules', { config: newRule, enabled: true })).json();
    await f.request('/connections', { provider: 'flomo', secret: ['https://flomoapp.com', 'iwh', 'replacement-synthetic'].join('/'), confirmReplace: true });
    const stopped = (await f.request('/rules')).json().items.find((r: { id: string }) => r.id === fresh.id);
    assert.equal(stopped.enabled, false); assert.equal(stopped.revision, 2);
  } finally { await f.close(); }
});
test('preview paginates all matches, reports missing values and does not return raw provider fields', async () => {
  const { f, rule } = await connected();
  try {
    f.provider.handler = (name, params) => name === '/review/list/mine' ? { reviews: Array.from({ length: 24 }, (_, i) => ({ review: { reviewId: `review-${i}`, content: `想法 ${i}` } })), hasMore: 0 } : f.provider.sample(name, params);
    await synced(f); rule.history = 'include_history'; rule.filters.kinds = ['thought'];
    const one = (await f.request('/rules/preview', { config: rule })).json(); const two = (await f.request('/rules/preview', { config: rule, page: 2 })).json();
    assert.equal(one.matched, 24); assert.equal(one.pageTotal, 2); assert.equal(one.items.length, 20); assert.equal(two.items.length, 4);
    assert.equal(new Set([...one.items, ...two.items].map((item) => item.id)).size, 24);
    assert.deepEqual(one.items[0].missing, ['原文', '章节', '创建时间']); assert.equal(one.items[0].raw_json, undefined);
    rule.filters.kinds = ['highlight'];
    const highlight = (await f.request('/rules/preview', { config: rule })).json(); assert.equal(highlight.matched, 1); assert.equal(highlight.eligible, 1); assert.ok(!highlight.items[0].text.includes('📝 想法：')); assert.equal(highlight.items[0].blocks.length, 3); assert.equal(highlight.items[0].blocks.join('\n'), highlight.items[0].text);
  } finally { await f.close(); }
});

test('fixed format quotes every original line, omits absent thoughts and generates a single normalized book tag', () => {
  const c = config();
  const n = { ...note, title: '合成书籍 （Reading Habits）', original_text: '第一行\r\n第二行\n\n第四行', content: '每天阅读' };
  const header = '《合成书籍 （Reading Habits）》 示例作者 · 第一章';
  const quote = '> 第一行\n> 第二行\n\n> 第四行';
  const tag = '#微信读书/合成书籍_（Reading_Habits）';
  assert.equal(formatNote(n, c), `${header}\n${quote}\n📝 想法：每天阅读\n${tag}`);
  for (const absent of [null, '', '  \n']) assert.equal(formatNote({ ...n, content: absent }, c), `${header}\n${quote}\n${tag}`);
  assert.equal(formatNote({ ...n, kind: 'highlight' }, c), `${header}\n${quote}\n${tag}`);
  c.output.tags = ['微信读书/合成书籍_（Reading_Habits）', '阅读/收藏', '阅读/收藏'];
  assert.ok(formatNote(n, c).endsWith(`${tag} #阅读/收藏`));
  assert.ok(formatNote({ ...n, title: 'A\tB　C/#D' }, c).includes('#微信读书/A_B_C_D'));
  assert.ok(formatNote({ ...n, title: null, author: null, chapter_name: null }, c).startsWith('《（书名缺失）》 （作者缺失） · （章节缺失）'));
});

test('source boundary whitespace never creates empty quote markers while internal paragraph breaks survive', () => {
  const c = config();
  const clean = formatNote({ ...note, original_text: '第一段' }, c);
  for (const original of ['第一段\n', '第一段\r\n', '\n\t第一段\r\n \t\r\n', '第一段\r', '第一段\n　\n']) {
    assert.equal(formatNote({ ...note, original_text: original }, c), clean);
  }
  const original = '\r\n第一段\r\n \t\r\n第二段\n　\n第三段\n';
  const formatted = formatNote({ ...note, original_text: original }, c);
  assert.ok(formatted.includes('> 第一段\n\n> 第二段\n\n> 第三段\n📝 想法：'));
  assert.doesNotMatch(formatted, /^>\s*$/m);
  for (const missing of [null, '', '\r\n \t　\n']) assert.ok(formatNote({ ...note, original_text: missing }, c).includes('> （原文缺失）'));
});
