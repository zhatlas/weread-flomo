import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, origin, password, setupToken, syntheticKey } from './helpers.js';
import { Vault } from '../../src/server/vault.js';

test('setup token, singleton setup, hashed password and cookie/session protections', async (t) => {
  const f = await fixture(); t.after(() => f.close());
  assert.equal((await f.request('/notes')).statusCode, 401);
  assert.equal((await f.request('/auth/setup', { username: 'reader', password, setupToken: 'wrong' })).statusCode, 403);
  const setup = await f.setup(); assert.equal(setup.statusCode, 200);
  assert.match(String(setup.headers['set-cookie']), /HttpOnly/); assert.match(String(setup.headers['set-cookie']), /SameSite=Strict/);
  const account = f.store.db.prepare('SELECT * FROM admin').get() as { password_hash: string };
  assert.notEqual(account.password_hash, password); assert.match(account.password_hash, /^[a-f0-9]+:[a-f0-9]+$/);
  assert.equal((await f.request('/auth/setup', { username: 'second', password, setupToken })).statusCode, 409);
  assert.equal((await f.request('/sync', {}, { origin: 'https://evil.example' })).statusCode, 403);
  assert.equal((await f.request('/sync', {}, { 'x-csrf-token': '' })).statusCode, 403);
  assert.equal((await f.request('/notes')).statusCode, 200);
  f.store.db.prepare('UPDATE sessions SET expires_at = 0').run();
  assert.equal((await f.request('/notes')).statusCode, 401);
});
test('concurrent setup admits exactly one administrator', async (t) => {
  const f = await fixture(); t.after(() => f.close());
  const responses = await Promise.all([1, 2].map((n) => f.request('/auth/setup', { username: `reader-${n}`, password, setupToken })));
  assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 409]);
  assert.equal((f.store.db.prepare('SELECT count(*) AS n FROM admin').get() as { n: number }).n, 1);
});
test('login, logout and password change revoke persistent sessions', async (t) => {
  const f = await fixture(); t.after(() => f.close()); await f.setup();
  assert.equal((await f.request('/auth/login', { username: 'reader', password: 'wrong password here' })).statusCode, 401);
  assert.equal((await f.request('/auth/login', { username: 'reader', password })).statusCode, 200);
  assert.equal((await f.request('/auth/password', { currentPassword: password, password: 'Replacement password 2026' })).statusCode, 200);
  assert.equal((await f.request('/notes')).statusCode, 401);
  assert.equal((await f.request('/auth/login', { username: 'reader', password })).statusCode, 401);
  const login = await f.request('/auth/login', { username: 'reader', password: 'Replacement password 2026' });
  assert.equal(login.statusCode, 200);
  const cookie = String(login.headers['set-cookie']).split(';')[0];
  assert.equal((await f.request('/auth/logout', {}, { cookie, 'x-csrf-token': login.json().csrf })).statusCode, 200);
  assert.equal((await f.request('/notes', undefined, { cookie })).statusCode, 401);
});
test('credentials are encrypted, not echoed; replacement is explicit and isolated', async (t) => {
  const f = await fixture(); t.after(() => f.close()); await f.setup();
  const first = await f.connect(); assert.equal(first.statusCode, 200);
  const secret = f.store.db.prepare('SELECT * FROM secrets').get() as { id: string; ciphertext: Buffer };
  assert.equal(f.vault.get(secret.id), syntheticKey); assert.ok(!secret.ciphertext.includes(syntheticKey));
  const config = await f.request('/connections'); assert.ok(!config.body.includes(syntheticKey)); assert.ok(!config.body.includes('secret_ref'));
  assert.equal((await f.connect()).json().id, first.json().id);
  assert.equal((await f.connect(`${syntheticKey}-second`)).statusCode, 409);
  const second = await f.connect(`${syntheticKey}-second`, true); assert.equal(second.statusCode, 200); assert.notEqual(second.json().id, first.json().id);
  assert.equal((f.store.db.prepare('SELECT count(*) AS n FROM connections WHERE enabled = 1').get() as { n: number }).n, 1);
  f.store.db.prepare('UPDATE secrets SET tag = randomblob(16) WHERE id = ?').run(secret.id);
  assert.throws(() => new Vault(f.store, f.key));
});
test('failed credential check leaves old connection unchanged and flomo save makes no network request', async (t) => {
  const f = await fixture(); t.after(() => f.close()); await f.setup(); const first = await f.connect();
  f.provider.handler = () => ({ unexpected: true });
  assert.equal((await f.connect(`${syntheticKey}-second`, true)).json().error, 'UPSTREAM_FORMAT');
  assert.equal((await f.request('/connections')).json().items[0].id, first.json().id);
  const count = f.provider.calls.length;
  const url = ['https://flomoapp.com', 'iwh', 'synthetic', 'example'].join('/');
  assert.equal((await f.request('/connections', { provider: 'flomo', secret: url })).statusCode, 200);
  assert.equal(f.provider.calls.length, count);
  for (const secret of ['http://127.0.0.1/iwh/test', 'https://flomoapp.com.evil.example/iwh/test', `${url}?redirect=secret`]) {
    assert.equal((await f.request('/connections', { provider: 'flomo', secret })).statusCode, 400);
  }
});
test('origin check includes login and auth rate limit is enforced', async (t) => {
  const f = await fixture(); t.after(() => f.close());
  assert.equal((await f.request('/auth/login', { username: 'reader', password }, { origin: '' })).statusCode, 403);
  for (let n = 0; n < 10; n++) await f.app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin }, payload: { username: 'reader', password } });
  assert.equal((await f.request('/auth/login', { username: 'reader', password })).statusCode, 429);
});
