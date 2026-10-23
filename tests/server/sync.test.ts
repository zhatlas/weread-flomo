import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, sampleHighlight, sampleThought, syntheticKey } from './helpers.js';
import { AppError } from '../../src/server/errors.js';

test('sync normalizes, preserves unknown raw fields, deduplicates and updates changed content', async (t) => {
  const f = await fixture(); t.after(() => f.close()); await f.setup(); await f.connect();
  assert.equal((await f.request('/sync', {})).statusCode, 202); await f.sync.idle();
  const first = (await f.request('/notes')).json(); assert.equal(first.total, 2);
  const thought = first.items.find((n: { kind: string }) => n.kind === 'thought');
  assert.equal(thought.original_text, sampleHighlight.markText); assert.equal(thought.title, '阅读与生活'); assert.equal(thought.author, '示例作者'); assert.equal(thought.chapter_name, '第一章 · 阅读的意义');
  const highlights = (await f.request('/notes?kind=highlight')).json();
  const detail = (await f.request(`/notes/${highlights.items[0].id}`)).json();
  assert.deepEqual(JSON.parse(detail.raw_json).unknownFutureField, { kept: true });
  const dates = f.store.db.prepare('SELECT id, updated_at FROM notes ORDER BY id').all();
  f.sync.start(); await f.sync.idle(); assert.deepEqual(f.store.db.prepare('SELECT id, updated_at FROM notes ORDER BY id').all(), dates);
  f.provider.handler = (name, params) => name === '/review/list/mine' ? { reviews: [{ review: { ...sampleThought, content: '修改后的想法' } }], hasMore: 0 } : f.provider.sample(name, params);
  f.sync.start(); await f.sync.idle();
  assert.equal((await f.request('/notes?kind=thought')).json().items[0].content, '修改后的想法'); assert.equal((await f.request('/notes')).json().total, 2);
  assert.equal((await f.request('/status')).json().runs[0].status, 'succeeded');
});
test('book and thought cursors are fully traversed even when reviewCount is zero', async (t) => {
  const f = await fixture(); t.after(() => f.close()); await f.setup(); await f.connect();
  f.provider.handler = (name, params) => {
    if (name === '/user/notebooks') return params.lastSort === undefined ? { books: [{ bookId: 'book-1', sort: 12, book: { title: '一', author: '甲', reviewCount: 0 } }], hasMore: 1 } : { books: [{ bookId: 'book-2', sort: 11, book: { title: '二', author: '乙' } }], hasMore: 0 };
    if (name === '/book/bookmarklist') return { updated: [] };
    if (name === '/review/list/mine') return { reviews: [{ review: { ...sampleThought, bookId: params.bookid, reviewId: params.synckey === undefined ? 'page1' : 'page2', chapterName: '章节' } }], hasMore: params.synckey === undefined ? 1 : 0, synckey: 10 };
    return f.provider.sample(name, params);
  };
  f.sync.start(); await f.sync.idle(); assert.equal((await f.request('/notes')).json().total, 4);
  assert.ok(f.provider.calls.some((c) => c.params.lastSort === 12));
  assert.equal(f.provider.calls.filter((c) => c.params.synckey === 10).length, 2);
});
test('partial, malformed and empty responses never delete notes or commit incomplete thought pages', async (t) => {
  const f = await fixture(); t.after(() => f.close()); await f.setup(); await f.connect(); f.sync.start(); await f.sync.idle();
  f.provider.handler = (name, params) => {
    if (name === '/review/list/mine') {
      if (params.synckey !== undefined) throw new AppError('UPSTREAM_NETWORK', 502);
      return { reviews: [{ review: { ...sampleThought, content: 'should not be saved' } }], hasMore: 1, synckey: 5 };
    }
    if (name === '/book/bookmarklist') return { updated: [] };
    return f.provider.sample(name, params);
  };
  const id = f.sync.start(); await f.sync.idle();
  assert.equal((await f.request('/notes')).json().total, 2);
  assert.equal((await f.request('/notes?kind=thought')).json().items[0].content, sampleThought.content);
  const run = (await f.request(`/runs/${id}`)).json(); assert.equal(run.run.status, 'partial'); assert.equal(run.items.find((i: { kind: string }) => i.kind === 'thought').error_code, 'UPSTREAM_NETWORK');
  assert.equal(run.items[0].title, '阅读与生活');
  f.provider.handler = () => ({ errcode: -1 });
  f.sync.start(); await f.sync.idle(); assert.equal((await f.request('/notes')).json().total, 2); assert.equal((await f.request('/status')).json().runs[0].status, 'failed');
});
test('repeated cursors fail the scope; stored books are queried when absent from notebooks', async (t) => {
  const f = await fixture(); t.after(() => f.close()); await f.setup(); await f.connect(); f.sync.start(); await f.sync.idle();
  f.provider.calls = [];
  f.provider.handler = (name, params) => {
    if (name === '/user/notebooks') return { books: [], hasMore: 0 };
    if (name === '/review/list/mine') return { reviews: [{ review: sampleThought }], hasMore: 1, synckey: 3 };
    return f.provider.sample(name, params);
  };
  const id = f.sync.start(); await f.sync.idle();
  assert.ok(f.provider.calls.some((c) => c.name === '/book/bookmarklist'));
  assert.equal((await f.request(`/runs/${id}`)).json().items.find((i: { kind: string }) => i.kind === 'thought').error_code, 'PAGINATION_STALLED');
  assert.equal((await f.request('/notes')).json().total, 2);
});
test('chapter fallback remains stable across repeated syncs and missing original is explicit', async (t) => {
  const f = await fixture(); t.after(() => f.close()); await f.setup(); await f.connect();
  f.provider.handler = (name, params) => {
    if (name === '/book/bookmarklist') return { updated: [sampleHighlight] };
    if (name === '/review/list/mine') return { reviews: [{ review: { ...sampleThought, range: 'no-match' } }], hasMore: 0 };
    return f.provider.sample(name, params);
  };
  f.sync.start(); await f.sync.idle(); const first = f.store.db.prepare('SELECT id, chapter_name, updated_at FROM notes ORDER BY id').all();
  f.sync.start(); await f.sync.idle(); assert.deepEqual(f.store.db.prepare('SELECT id, chapter_name, updated_at FROM notes ORDER BY id').all(), first);
  assert.equal((await f.request('/notes?kind=thought')).json().items[0].original_text, null);
});
test('connection changes isolate IDs, retain old notes and support historical browsing', async (t) => {
  const f = await fixture(); t.after(() => f.close()); await f.setup(); const old = await f.connect(); f.sync.start(); await f.sync.idle();
  await f.connect(`${syntheticKey}-second`, true);
  assert.equal((await f.request('/notes')).json().total, 0); f.sync.start(); await f.sync.idle();
  assert.equal((await f.request('/notes')).json().total, 2);
  assert.equal((await f.request(`/notes?connectionId=${old.json().id}`)).json().total, 2);
  assert.equal((f.store.db.prepare('SELECT count(*) AS n FROM notes').get() as { n: number }).n, 4);
});
test('only one scan runs and credentials cannot change during scan; shutdown interrupts', async (t) => {
  const f = await fixture(); t.after(() => f.close()); await f.setup(); await f.connect();
  f.provider.handler = (_name, _params, signal) => new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new AppError('SYNC_INTERRUPTED')), { once: true }));
  const id = f.sync.start(); assert.equal((await f.request('/sync', {})).statusCode, 409); assert.equal((await f.connect(`${syntheticKey}-second`, true)).statusCode, 409);
  await f.sync.stop(); assert.equal((await f.request(`/runs/${id}`)).json().run.status, 'interrupted');
});
test('literal search, date boundaries, type and pagination filters', async (t) => {
  const f = await fixture(); t.after(() => f.close()); await f.setup(); await f.connect(); f.sync.start(); await f.sync.idle();
  assert.equal((await f.request('/notes?q=%25')).json().total, 0);
  assert.equal((await f.request(`/notes?q=${encodeURIComponent('思考')}&kind=thought`)).json().total, 1);
  assert.equal((await f.request(`/notes?from=${sampleThought.createTime * 1000}&to=${sampleThought.createTime * 1000 + 1}`)).json().total, 1);
  assert.equal((await f.request(`/notes?to=${sampleThought.createTime * 1000}`)).json().total, 1);
  assert.equal((await f.request('/notes?limit=1&page=2')).json().items.length, 1);
  assert.equal((await f.request('/notes?kind=bad')).statusCode, 400);
  assert.equal((await f.request('/notes?from=5&to=1')).statusCode, 400);
});
