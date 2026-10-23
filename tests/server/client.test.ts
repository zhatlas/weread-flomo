import assert from 'node:assert/strict';
import test from 'node:test';
import { WeReadClient } from '../../src/server/weread.js';
import { AppError } from '../../src/server/errors.js';
import { syntheticKey } from './helpers.js';

test('gateway uses documented flat body, pinned endpoint, bearer auth and disables redirects', async () => {
  const client = new WeReadClient(syntheticKey, async (input, init) => {
    assert.equal(input, 'https://i.weread.qq.com/api/agent/gateway'); assert.equal(init?.redirect, 'error');
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${syntheticKey}`);
    assert.deepEqual(JSON.parse(String(init?.body)), { bookid: 'book', count: 20, api_name: '/review/list/mine', skill_version: '1.0.5' });
    return Response.json({ reviews: [], hasMore: 0 });
  }, 0);
  assert.deepEqual(await client.call('/review/list/mine', { bookid: 'book', count: 20 }), { reviews: [], hasMore: 0 });
});
test('auth, upgrade, API errors and invalid JSON return sanitized error codes', async () => {
  const cases: [() => Response, string][] = [
    [() => new Response('private detail', { status: 401 }), 'UPSTREAM_AUTH'],
    [() => Response.json({ upgrade_info: 'new version' }), 'UPSTREAM_UPGRADE'],
    [() => Response.json({ errcode: -1, errmsg: 'private detail' }), 'UPSTREAM_REJECTED'],
    [() => new Response('not json'), 'UPSTREAM_FORMAT'],
    [() => Response.json([]), 'UPSTREAM_FORMAT'],
    [() => new Response('slow down', { status: 429, headers: { 'Retry-After': '120' } }), 'UPSTREAM_RATE_LIMIT'],
  ];
  for (const [response, code] of cases) {
    const client = new WeReadClient(syntheticKey, async () => response(), 0);
    await assert.rejects(client.call('/user/notebooks'), (error: unknown) => error instanceof AppError && error.code === code && !error.message.includes('private'));
  }
});
test('transient upstream failure retries with bounded attempts', async () => {
  let calls = 0;
  const client = new WeReadClient(syntheticKey, async () => ++calls === 1 ? new Response('', { status: 503 }) : Response.json({ books: [], hasMore: 0 }), 0);
  assert.deepEqual(await client.call('/user/notebooks'), { books: [], hasMore: 0 }); assert.equal(calls, 2);
});
test('oversize response is rejected instead of silently truncating data', async () => {
  const client = new WeReadClient(syntheticKey, async () => new Response(new Uint8Array(32 * 1024 * 1024 + 1)), 0);
  await assert.rejects(client.call('/user/notebooks'), (error: unknown) => error instanceof AppError && error.code === 'UPSTREAM_TOO_LARGE');
});
test('request spacing survives client recreation between scans', async () => {
  const timestamps: number[] = [];
  const transport: typeof fetch = async () => { timestamps.push(Date.now()); return Response.json({ books: [], hasMore: 0 }); };
  await new WeReadClient(syntheticKey, transport, 30).call('/user/notebooks');
  await new WeReadClient(syntheticKey, transport, 30).call('/user/notebooks');
  assert.ok(timestamps[1] - timestamps[0] >= 25);
});
