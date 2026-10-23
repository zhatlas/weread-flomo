import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Store } from './store.js';

export function loadMasterKey(directory: string, hasSecrets: boolean): Buffer {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, 'master.key');
  if (!existsSync(path)) {
    if (hasSecrets) throw new Error('MASTER_KEY_MISSING');
    writeFileSync(path, randomBytes(32), { mode: 0o600, flag: 'wx' });
  }
  chmodSync(path, 0o600);
  const key = readFileSync(path);
  if (key.length !== 32) throw new Error('MASTER_KEY_INVALID');
  return key;
}

export class Vault {
  constructor(private store: Store, private key: Buffer) {
    if (key.length !== 32) throw new Error('MASTER_KEY_INVALID');
    for (const row of store.db.prepare('SELECT id FROM secrets').all() as { id: string }[]) this.get(row.id);
  }
  put(id: string, plaintext: string) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(id));
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    this.store.db.prepare('INSERT INTO secrets (id, nonce, ciphertext, tag) VALUES (?, ?, ?, ?)')
      .run(id, nonce, encrypted, cipher.getAuthTag());
  }
  get(id: string): string {
    const row = this.store.db.prepare('SELECT * FROM secrets WHERE id = ?').get(id) as
      { nonce: Buffer; ciphertext: Buffer; tag: Buffer } | undefined;
    if (!row) throw new Error('SECRET_NOT_FOUND');
    const decipher = createDecipheriv('aes-256-gcm', this.key, row.nonce);
    decipher.setAAD(Buffer.from(id));
    decipher.setAuthTag(row.tag);
    return Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString('utf8');
  }
}
