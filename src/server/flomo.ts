import { z } from 'zod';
import { AppError } from './errors.js';

export type SendResult = { status: 'sent' | 'retry' | 'uncertain' | 'blocked'; error?: string; httpStatus?: number; remoteId?: string; retryAt?: number };
export type Sender = (url: string, content: string, signal: AbortSignal) => Promise<SendResult>;
export function validateWebhook(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new AppError('WEBHOOK_FORMAT'); }
  if (url.protocol !== 'https:' || !['flomoapp.com', 'v.flomoapp.com'].includes(url.hostname) || url.port || url.username || url.password || url.search || url.hash || !/^\/iwh\/[A-Za-z0-9_/-]+\/?$/.test(url.pathname)) throw new AppError('WEBHOOK_FORMAT');
  return url.href;
}
export function retryAfter(value: string | null, now: number): number | undefined {
  if (!value) return undefined;
  const time = /^\d+$/.test(value) ? now + Number(value) * 1000 : Date.parse(value);
  return Number.isSafeInteger(time) && time > now && time <= 8_640_000_000_000_000 ? time : undefined;
}
const envelope = z.object({ code: z.number().int(), data: z.object({ id: z.union([z.string(), z.number()]).optional(), slug: z.string().optional() }).passthrough().nullable().optional() });
export function flomoSender(fetcher: typeof fetch = fetch, now = Date.now): Sender {
  return async (url, content, signal) => {
    validateWebhook(url);
    try {
      const response = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }), redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
      if (response.status === 429) { await response.body?.cancel(); return { status: 'retry', error: 'FLOMO_RATE_LIMIT', httpStatus: 429, retryAt: retryAfter(response.headers.get('retry-after'), now()) ?? now() + 300_000 }; }
      if ([401, 403].includes(response.status)) { await response.body?.cancel(); return { status: 'blocked', error: 'FLOMO_AUTH', httpStatus: response.status }; }
      if (response.status >= 400 && response.status < 500 && response.status !== 408) { await response.body?.cancel(); return { status: 'blocked', error: 'FLOMO_REJECTED', httpStatus: response.status }; }
      if (!response.ok) { await response.body?.cancel(); return { status: 'uncertain', error: 'FLOMO_UNCERTAIN', httpStatus: response.status }; }
      const reader = response.body?.getReader();
      if (!reader) return { status: 'uncertain', error: 'FLOMO_RESPONSE' };
      let size = 0; const chunks: Uint8Array[] = [];
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.length;
        if (size > 1024 * 1024) { await reader.cancel(); return { status: 'uncertain', error: 'FLOMO_RESPONSE', httpStatus: response.status }; }
        chunks.push(value);
      }
      const parsed = envelope.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (!parsed.success) return { status: 'uncertain', error: 'FLOMO_RESPONSE', httpStatus: response.status };
      if (parsed.data.code !== 0) return { status: 'blocked', error: 'FLOMO_REJECTED', httpStatus: response.status };
      const id = parsed.data.data?.slug ?? parsed.data.data?.id;
      return { status: 'sent', httpStatus: response.status, ...(id != null && /^[A-Za-z0-9_-]{1,128}$/.test(String(id)) ? { remoteId: String(id) } : {}) };
    } catch (error) {
      // Only failures known to occur before a connection is established can be retried automatically.
      const cause = (error as { cause?: { code?: string } })?.cause?.code;
      if (!signal.aborted && cause && ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT'].includes(cause)) return { status: 'retry', error: 'FLOMO_CONNECT' };
      return { status: 'uncertain', error: 'FLOMO_UNCERTAIN' };
    }
  };
}
