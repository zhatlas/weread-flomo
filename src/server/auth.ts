import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { Store } from './store.js';

export const SESSION_SECONDS = 12 * 60 * 60;
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const equal = (a: string, b: string) => timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
    (error, key) => error ? reject(error) : resolve(key)));
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await derive(password, salt)).toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [salt, expected] = encoded.split(':');
  return equal((await derive(password, salt)).toString('hex'), expected);
}

export function createSession(store: Store) {
  const token = randomBytes(32).toString('hex');
  const csrf = randomBytes(32).toString('hex');
  store.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  store.db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(token), csrf, Date.now() + SESSION_SECONDS * 1000);
  return { token, csrf };
}

export function findSession(store: Store, token?: string) {
  if (!token || token.length > 256) return undefined;
  return store.db.prepare('SELECT csrf FROM sessions WHERE token_hash = ? AND expires_at > ?')
    .get(digest(token), Date.now()) as { csrf: string } | undefined;
}
