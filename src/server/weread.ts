import { z } from 'zod';
import { setTimeout as sleep } from 'node:timers/promises';
import { AppError } from './errors.js';

export interface Provider { call(name: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> }
export type ProviderFactory = (key: string) => Provider;
const id = z.union([z.string().min(1).max(512), z.number().int().safe()]).transform(String);
const more = z.union([z.literal(0), z.literal(1), z.boolean()]);
const epoch = z.number().int().nonnegative().max(8_640_000_000_000).nullish();

export const notebookPage = z.object({
  books: z.array(z.object({ bookId: id, book: z.record(z.string(), z.unknown()).optional(), sort: z.number().int().optional(), reviewCount: z.number().int().nonnegative().optional() }).passthrough()),
  hasMore: more,
}).passthrough();
export const highlightPage = z.object({
  updated: z.array(z.object({ bookmarkId: id, bookId: id.optional(), chapterUid: id.optional(), markText: z.string(),
    range: z.string().optional(), createTime: epoch, colorStyle: z.unknown().optional() }).passthrough()),
  chapters: z.array(z.object({ chapterUid: id, title: z.string() }).passthrough()).optional(),
  book: z.record(z.string(), z.unknown()).optional(),
}).passthrough();
export const thoughtPage = z.object({
  reviews: z.array(z.object({ review: z.object({ reviewId: id, bookId: id.optional(), content: z.string(),
    chapterUid: id.optional(), chapterName: z.string().nullish(), abstract: z.string().nullish(),
    range: z.string().nullish(), createTime: epoch }).passthrough() }).passthrough()),
  hasMore: more, synckey: z.number().int().optional(), totalCount: z.number().int().nonnegative().optional(),
}).passthrough();
export const chapterPage = z.object({ chapters: z.array(z.object({ chapterUid: id, title: z.string() }).passthrough()) }).passthrough();
export const bookInfo = z.object({ title: z.string(), author: z.string().optional() }).passthrough();

export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new AppError('UPSTREAM_FORMAT', 502);
  return result.data;
}

// The application serializes connection checks and scans; retain the gap across new clients/runs.
let lastRequestAt = 0;
export class WeReadClient implements Provider {
  constructor(private key: string, private transport: typeof fetch = fetch, private gap = 1000) {}

  async call(name: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<unknown> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const delay = Math.max(0, lastRequestAt + this.gap - Date.now());
      if (delay) await sleep(delay, undefined, { signal });
      signal?.throwIfAborted();
      lastRequestAt = Date.now();
      let response: Response;
      try {
        response = await this.transport('https://i.weread.qq.com/api/agent/gateway', {
          method: 'POST', redirect: 'error',
          headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...params, api_name: name, skill_version: '1.0.5' }),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
        });
      } catch {
        if (signal?.aborted) throw new AppError('SYNC_INTERRUPTED', 503);
        if (attempt === 2) throw new AppError('UPSTREAM_NETWORK', 502);
        await sleep(1000 * 2 ** attempt, undefined, { signal });
        continue;
      }
      if (response.status === 401 || response.status === 403) throw new AppError('UPSTREAM_AUTH', 502);
      if (response.status === 429 || response.status >= 500) {
        const header = response.headers.get('retry-after');
        const retryMs = header ? (/^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now()) : 1000 * 2 ** attempt;
        await response.body?.cancel();
        if (attempt === 2 || retryMs > 30_000) throw new AppError(response.status === 429 ? 'UPSTREAM_RATE_LIMIT' : 'UPSTREAM_UNAVAILABLE', 502);
        await sleep(Math.max(1000, Number.isFinite(retryMs) ? retryMs : 1000), undefined, { signal });
        continue;
      }
      if (!response.ok) throw new AppError('UPSTREAM_HTTP', 502);
      // Bound a single response to avoid unbounded memory use; report failure rather than truncating.
      const reader = response.body?.getReader();
      if (!reader) throw new AppError('UPSTREAM_FORMAT', 502);
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 32 * 1024 * 1024) { await reader.cancel(); throw new AppError('UPSTREAM_TOO_LARGE', 502); }
          chunks.push(value);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('UPSTREAM_FORMAT', 502);
        if ('upgrade_info' in body) throw new AppError('UPSTREAM_UPGRADE', 502);
        if (body.errcode !== undefined && body.errcode !== 0) throw new AppError('UPSTREAM_REJECTED', 502);
        return body;
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError('UPSTREAM_FORMAT', 502);
      }
    }
    throw new AppError('UPSTREAM_UNAVAILABLE', 502);
  }
}
