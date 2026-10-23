import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openStore } from '../../src/server/store.js';
import { Vault } from '../../src/server/vault.js';
import { createApp } from '../../src/server/app.js';
import type { Sender } from '../../src/server/flomo.js';
import type { Provider } from '../../src/server/weread.js';
import { syntheticKey, password, setupToken } from '../fixtures.js';
export { syntheticKey, password, setupToken };

export const origin = 'http://127.0.0.1:3000';
export const sampleHighlight = { bookmarkId: 'highlight-1', bookId: 'book-1', chapterUid: 1, range: '1-20', markText: '读书让我们看见更多可能。', createTime: 1767225600, colorStyle: 1, unknownFutureField: { kept: true } };
export const sampleThought = { reviewId: 'thought-1', bookId: 'book-1', chapterUid: 1, range: '1-20', content: '把阅读变成自己的思考。', createTime: 1767312000 };
export class FakeProvider implements Provider {
  calls: { name: string; params: Record<string, unknown> }[] = [];
  handler?: (name: string, params: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown> | unknown;
  async call(name: string, params: Record<string, unknown> = {}, signal?: AbortSignal) {
    this.calls.push({ name, params });
    if (this.handler) return await this.handler(name, params, signal);
    return this.sample(name, params);
  }
  sample(name: string, _params: Record<string, unknown> = {}): unknown {
    if (name === '/user/notebooks') return { books: [{ bookId: 'book-1', sort: 1, book: { title: '阅读与生活', author: '示例作者', reviewCount: 0 } }], hasMore: 0 };
    if (name === '/book/bookmarklist') return { updated: [sampleHighlight], chapters: [{ chapterUid: 1, title: '第一章 · 阅读的意义' }] };
    if (name === '/review/list/mine') return { reviews: [{ review: sampleThought }], totalCount: 1, hasMore: 0 };
    if (name === '/book/info') return { title: '阅读与生活', author: '示例作者' };
    if (name === '/book/chapterinfo') return { chapters: [{ chapterUid: 1, title: '第一章 · 阅读的意义' }] };
    throw new Error('Unexpected synthetic request');
  }
}
export async function fixture(provider = new FakeProvider(), options: { sender?: Sender; now?: () => number } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'weread-test-'));
  const store = openStore(directory);
  const key = randomBytes(32);
  const vault = new Vault(store, key);
  const { app, sync, automation } = await createApp({ store, vault, origin, setupToken, providerFactory: () => provider, timers: false, ...options });
  await app.ready();
  let cookie = ''; let csrf = '';
  const request = (path: string, body?: unknown, headers: Record<string, string> = {}) => app.inject({
    method: body === undefined ? 'GET' : 'POST', url: `/api${path}`,
    headers: { origin, cookie, 'x-csrf-token': csrf, ...headers }, ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  });
  async function setup() {
    const response = await request('/auth/setup', { username: 'reader', password, setupToken });
    cookie = String(response.headers['set-cookie']).split(';')[0]; csrf = response.json().csrf;
    return response;
  }
  async function connect(secret = syntheticKey, confirmReplace = false) { return request('/connections', { provider: 'weread', secret, confirmReplace }); }
  return { directory, store, key, vault, provider, app, sync, automation, request, setup, connect,
    get cookie() { return cookie; }, get csrf() { return csrf; },
    async close() { await app.close(); store.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}
