import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openStore } from '../../src/server/store.js';
import { Vault } from '../../src/server/vault.js';
import { createApp } from '../../src/server/app.js';
import { FakeProvider, sampleThought, setupToken } from '../server/helpers.js';

// Test-only composition root: production has no mock-provider switch.
const directory = mkdtempSync(join(tmpdir(), 'weread-e2e-'));
const store = openStore(directory);
const provider = new FakeProvider();
let writes = 0;
const { app } = await createApp({ store, vault: new Vault(store, randomBytes(32)), setupToken,
  origin: 'http://127.0.0.1:4100', staticDir: resolve('dist/web'), providerFactory: () => provider, sender: async () => { writes++; return writes === 1 ? { status: 'uncertain', error: 'FLOMO_UNCERTAIN' } : { status: 'sent', remoteId: `synthetic-${writes}` }; } });
// Auth/CSRF-protected fixture control exists only in this synthetic test server.
app.post('/api/test/thoughts', async (request, reply) => {
  const phase = (request.body as { phase?: string }).phase;
  if (!['present','missing'].includes(phase ?? '')) return reply.code(400).send({ error: 'VALIDATION' });
  provider.handler = (name, params) => name === '/review/list/mine' ? {
    reviews: [{ review: sampleThought }, ...(phase === 'present' ? [{ review: { ...sampleThought, reviewId: 'pending-deletion', content: '合成删除测试想法' } }] : [])],
    totalCount: phase === 'present' ? 2 : 1, hasMore: 0,
  } : provider.sample(name, params);
  return { ok: true };
});
app.post('/api/test/recovery', async () => {
  store.db.prepare('UPDATE recovery_state SET review_required = 1').run();
  store.db.prepare("UPDATE automation SET delivery_block = 'BACKUP_REVIEW'").run();
  return { ok: true };
});
app.addHook('onClose', async () => { store.close(); rmSync(directory, { recursive: true, force: true }); });
await app.listen({ host: '127.0.0.1', port: 4100 });
process.on('SIGTERM', () => void app.close());
process.on('SIGINT', () => void app.close());
