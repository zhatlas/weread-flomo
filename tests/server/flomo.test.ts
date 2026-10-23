import test from 'node:test';
import assert from 'node:assert/strict';
import { flomoSender, retryAfter, validateWebhook } from '../../src/server/flomo.js';
const url = ['https://flomoapp.com', 'iwh', 'synthetic-client'].join('/');
const signal = new AbortController().signal;
const transport = (response: Response) => (async () => response) as typeof fetch;
test('flomo sends one JSON request to a validated destination and accepts explicit success only', async () => {
  let calls = 0;
  const sender = flomoSender((async (address, options) => {
    calls++; assert.equal(address, url); assert.equal(options?.redirect, 'error'); assert.equal(options?.method, 'POST');
    assert.deepEqual(JSON.parse(String(options?.body)), { content: '合成内容\n#阅读' });
    return Response.json({ code: 0, data: { slug: 'synthetic-id' } });
  }) as typeof fetch);
  assert.deepEqual(await sender(url, '合成内容\n#阅读', signal), { status: 'sent', httpStatus: 200, remoteId: 'synthetic-id' }); assert.equal(calls, 1);
  await assert.rejects(() => sender('https://other.example/iwh/x', 'text', signal), /WEBHOOK_FORMAT/); assert.equal(calls, 1);
  for (const address of ['http://flomoapp.com/iwh/x','https://flomoapp.com.evil.example/iwh/x','https://user:pass@flomoapp.com/iwh/x',`${url}?secret=x`]) assert.throws(() => validateWebhook(address));
});
test('rate limits persist Retry-After while HTTP and business errors have conservative outcomes', async () => {
  const now = Date.parse('2026-10-22T00:00:00Z');
  const response = await flomoSender(transport(new Response('', { status: 429, headers: { 'Retry-After': '600' } })), () => now)(url, 'text', signal);
  assert.equal(response.status, 'retry'); assert.equal(response.retryAt, now + 600000);
  assert.equal(retryAfter(new Date(now + 600000).toUTCString(), now), now + 600000); assert.equal(retryAfter('bad', now), undefined);
  for (const status of [401, 403, 400, 422]) assert.equal((await flomoSender(transport(new Response('', { status })))(url, 'text', signal)).status, 'blocked');
  for (const status of [408, 500, 502, 503]) assert.equal((await flomoSender(transport(new Response('', { status })))(url, 'text', signal)).status, 'uncertain');
  assert.equal((await flomoSender(transport(Response.json({ code: 1001, message: 'private provider message' })))(url, 'text', signal)).status, 'blocked');
});
test('lost responses, unknown JSON, oversized bodies and generic network errors are never blindly retried', async () => {
  for (const response of [new Response('bad json'), Response.json({ ok: true }), Response.json({ code: '0' }), new Response('x'.repeat(1024 * 1024 + 1))]) {
    const result = await flomoSender(transport(response))(url, 'text', signal); assert.equal(result.status, 'uncertain'); assert.ok(!JSON.stringify(result).includes('private'));
  }
  const failing = (code: string) => (async () => { throw new TypeError('private URL must not escape', { cause: { code } }); }) as typeof fetch;
  assert.equal((await flomoSender(failing('ECONNRESET'))(url, 'text', signal)).status, 'uncertain');
  assert.equal((await flomoSender(failing('ENOTFOUND'))(url, 'text', signal)).status, 'retry');
  const aborted = new AbortController(); aborted.abort();
  assert.equal((await flomoSender(failing('ENOTFOUND'))(url, 'text', aborted.signal)).status, 'uncertain');
});
