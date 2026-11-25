import { books, samples } from './samples';
import { defaultRule, ruleConfigSchema } from '../../src/shared/rules';
import { dateBounds, formatNote, matchNote, scopeReasons } from '../../src/server/rules';

const source = '00000000-0000-4000-8000-000000000001';
const destination = '00000000-0000-4000-8000-000000000002';
const day = 86400000;
const now = Date.now();
const connections = [source, destination].map((id, i) => ({ id, provider: i ? 'flomo' : 'weread', enabled: 1, created_at: now - 10 * day }));
const notes = samples.map((s, i) => ({
  id: samples.length - i, source_id: 'sample-' + (samples.length - i), book_id: s.book, ...books[s.book],
  kind: s.kind, status: 'active', source_created_at: now - (i + 1) * day, content: s.thought || null,
  original_text: s.passage, chapter_name: s.chapter, first_seen_at: now, updated_at: now, raw_json: JSON.stringify(s),
}));
const bookList = Object.entries(books).map(([book_id, b]) => ({ book_id, ...b }));
const items = bookList.flatMap(b => ['highlight', 'thought'].map(kind => ({
  ...b, kind, status: 'succeeded', count: notes.filter(n => n.book_id === b.book_id && n.kind === kind).length,
})));
function run(time) {
  return { id: 'sample-' + time, connection_id: source, mode: 'full', status: 'succeeded', started_at: time - 4500, finished_at: time, coverage_json: JSON.stringify({ listComplete: true, expectedBooks: bookList.length }), counts_json: '{}' };
}
const runs = [run(now - 60000)];
const sampleConfig = defaultRule(source, destination);
sampleConfig.name = 'Reading journal';
sampleConfig.history = 'include_history';
sampleConfig.filters.kinds = ['thought'];
const sampleRule = { id: '00000000-0000-4000-8000-000000000003', config: sampleConfig, enabled: true,
  revision: 1, createdAt: now - day, updatedAt: now - day, activatedAt: now - day, baselineNoteId: notes[0].id, baselineRunId: runs[0].id };
const rules = [sampleRule];
const delivery = { id: 1, note_id: notes[0].id, destination_id: destination, status: 'sent', source_hold: null, title: notes[0].title,
  kind: notes[0].kind, content: formatNote(notes[0], sampleConfig), matched_rules_json: JSON.stringify([{ name: sampleConfig.name, revision: 1 }]),
  retries: 0, updated_at: now, created_at: now, sent_at: now, next_attempt_at: null, error_code: null };

const automation = {
  revision: 1, config: { syncEnabled: false, deliveryEnabled: false, schedule: 'interval', intervalMinutes: 15, dailyTime: '02:00', timezone: 'Asia/Shanghai', syncMode: 'full', dailyLimit: 100, maxContentChars: 5000 },
  blocks: { sync: null, deliver: null }, recoveryRequired: false, startupSyncPending: false, busy: false, usedQuota: 0, counts: { sent: 1 }, jobs: [],
};
function filteredNotes(q) {
  const needle = (q.get('q') || '').trim().toLowerCase();
  return notes.filter(n => (!q.get('kind') || n.kind === q.get('kind')) &&
    (!q.get('status') || n.status === q.get('status')) && (!q.get('bookId') || n.book_id === q.get('bookId')) &&
    (!q.get('from') || n.source_created_at >= Number(q.get('from'))) && (!q.get('to') || n.source_created_at < Number(q.get('to'))) &&
    [n.content, n.original_text, n.title, n.author].some(s => s?.toLowerCase().includes(needle)));
}
function preview(config, saved, view) {
  const baseline = saved?.baselineNoteId ?? null;
  const bounds = dateBounds(config);
  const counts = {};
  const rows = notes.map(note => {
    const reasons = matchNote(note, config, bounds);
    const matched = !reasons.length;
    if (matched) reasons.push(...scopeReasons(note, config, baseline));
    for (const reason of reasons) counts[reason] = (counts[reason] || 0) + 1;
    const text = formatNote(note, config);
    return { ...note, matched, eligible: !reasons.length, reasons, missing: [], text, blocks: text.split('\n') };
  });
  const matched = rows.filter(n => n.matched).length;
  const visible = rows.filter(n => view === 'excluded' ? !n.matched : view === 'eligible' ? n.eligible : n.matched);
  return { total: rows.length, matched, excluded: rows.length - matched, eligible: rows.filter(n => n.eligible).length,
    reasons: counts, items: visible, page: 1, pageTotal: 1, baselinePending: config.history === 'new_only' && baseline === null,
    baselineAt: saved?.activatedAt ?? null, snapshotAt: Date.now() };
}
function route(url, body) {
  const { pathname, searchParams } = new URL(url, 'https://demo.invalid');
  const path = pathname.replace(/^\/api/, '');
  if (path === '/auth/state') return { authenticated: true, initialized: true, username: 'Demo' };
  if (path === '/connections' && !body) return { items: connections };
  if (path === '/status') return { running: false, runs, stats: { total: notes.length, thoughts: notes.filter(n => n.kind === 'thought').length, highlights: notes.filter(n => n.kind === 'highlight').length, books: bookList.length } };
  if (path === '/sync') { runs.unshift(run(Date.now())); return { id: runs[0].id }; }
  if (path.startsWith('/runs/')) return { run: runs.find(r => path === '/runs/' + r.id), items };
  if (path === '/books') return { items: bookList };
  if (path === '/notes') { const items = filteredNotes(searchParams); return { items, total: items.length }; }
  if (path.startsWith('/notes/')) return notes.find(n => path === '/notes/' + n.id);
  if (path === '/rules' && !body) return { items: rules };
  if (path === '/rules' || path.startsWith('/rules/')) {
    const parsed = ruleConfigSchema.safeParse(body.config);
    if (!parsed.success) throw new Error('RULE_VALIDATION');
    const config = parsed.data;
    const saved = rules.find(r => path === '/rules/' + r.id || r.id === body.id);
    if (path === '/rules/preview') return preview(config, saved, body.view);
    dateBounds(config);
    if (saved?.activatedAt && config.history !== saved.config.history) throw new Error('RULE_HISTORY_LOCKED');
    if (body.enabled && !saved?.activatedAt && config.history === 'include_history' && !body.confirmHistory) throw new Error('RULE_HISTORY_CONFIRM');
    const rule = saved || { id: crypto.randomUUID(), createdAt: Date.now(), revision: 0, activatedAt: null, baselineNoteId: null };
    if (!saved) rules.unshift(rule);
    if (body.enabled && !rule.activatedAt) Object.assign(rule, { activatedAt: Date.now(), baselineRunId: runs[0].id, baselineNoteId: notes[0].id });
    Object.assign(rule, { config, enabled: body.enabled, revision: rule.revision + 1, updatedAt: Date.now() });
    return rule;
  }
  if (path === '/automation' && !body) return automation;
  if (path === '/deliveries') {
    const rows = !searchParams.get('status') || searchParams.get('status') === 'sent' ? [delivery] : [];
    return { items: rows, total: rows.length, page: 1 };
  }
  if (path === '/deliveries/1') return { delivery, attempts: [{ id: 1, outcome: 'sent', started_at: now, finished_at: now, http_status: 200, content: delivery.content }] };
  throw new Error('NOT_FOUND');
}
// The demo bundle redirects the UI's fetch calls here. No native fetch fallback.
window.demoFetch = async (url, init) => {
  try { return Response.json(route(url, init?.body && JSON.parse(init.body))); }
  catch (error) { return Response.json({ error: error.code || error.message }, { status: 400 }); }
};
