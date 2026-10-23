import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Store } from './store.js';
import { Vault } from './vault.js';
import { AppError, errorCode } from './errors.js';
import { createSession, digest, equal, findSession, hashPassword, SESSION_SECONDS, verifyPassword } from './auth.js';
import { notebookPage, parse, WeReadClient, type ProviderFactory } from './weread.js';
import { SyncManager } from './sync.js';
import { Rules } from './rules.js';
import { Automation } from './automation.js';
import { validateWebhook, type Sender } from './flomo.js';

type Options = { store: Store; vault: Vault; setupToken: string; origin: string; staticDir?: string; providerFactory?: ProviderFactory; sender?: Sender; now?: () => number; timers?: boolean };
type Admin = { username: string; password_hash: string };
type Connection = { id: string; provider: string; enabled: number; secret_ref: string; created_at: number };
const credentials = z.object({ username: z.string().trim().min(1).max(80), password: z.string().min(12).max(256) });
function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError('VALIDATION');
  return parsed.data;
}

export async function createApp(options: Options) {
  const { store, vault, origin } = options;
  const db = store.db;
  const providerFactory = options.providerFactory ?? ((key: string) => new WeReadClient(key));
  let configuring = false;
  const sync: SyncManager = new SyncManager(store, vault, providerFactory, () => !configuring && !automation.sending);
  const rules = new Rules(store);
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024, trustProxy: false });
  const automation: Automation = new Automation(store, vault, sync, rules, { sender: options.sender, now: options.now, canRun: () => !configuring });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  const admin = () => db.prepare('SELECT username, password_hash FROM admin WHERE id = 1').get() as Admin | undefined;
  const sessionCookie = (reply: FastifyReply) => {
    const session = createSession(store);
    reply.setCookie('session', session.token, { path: '/', httpOnly: true, sameSite: 'strict', secure: origin.startsWith('https:'), maxAge: SESSION_SECONDS });
    return { csrf: session.csrf };
  };
  app.setErrorHandler((error, _request, reply) => {
    const code = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
    const status = error instanceof AppError ? error.status : code === 429 ? 429 : code === 413 ? 413 : code === 400 ? 400 : 500;
    reply.code(status).send({ error: status === 429 ? 'RATE_LIMIT' : status === 413 ? 'BODY_TOO_LARGE' : status === 400 && !(error instanceof AppError) ? 'VALIDATION' : errorCode(error) });
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('X-Frame-Options', 'DENY')
      .header('Referrer-Policy', 'no-referrer')
      .header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const path = request.routeOptions.url ?? request.url.split('?')[0];
    if (!path.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (mutation && request.headers.origin !== origin) throw new AppError('ORIGIN_DENIED', 403);
    if (['/api/auth/state', '/api/auth/setup', '/api/auth/login', '/api/health'].includes(path)) return;
    const session = findSession(store, request.cookies.session);
    if (!session) throw new AppError('UNAUTHORIZED', 401);
    if (mutation && (typeof request.headers['x-csrf-token'] !== 'string' || !equal(request.headers['x-csrf-token'], session.csrf))) {
      throw new AppError('CSRF_DENIED', 403);
    }
  });
  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/auth/state', async (request) => {
    const session = findSession(store, request.cookies.session);
    return { initialized: !!admin(), authenticated: !!session, csrf: session?.csrf, username: session ? admin()?.username : undefined };
  });
  const authLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };
  app.post('/api/auth/setup', authLimit, async (request, reply) => {
    const input = validate(credentials.extend({ setupToken: z.string().max(256) }), request.body);
    if (admin()) throw new AppError('ALREADY_INITIALIZED', 409);
    if (!equal(input.setupToken, options.setupToken)) throw new AppError('SETUP_TOKEN_INVALID', 403);
    const hash = await hashPassword(input.password);
    db.transaction(() => {
      if (admin()) throw new AppError('ALREADY_INITIALIZED', 409);
      db.prepare('INSERT INTO admin VALUES (1, ?, ?, ?)').run(input.username, hash, Date.now());
    })();
    return sessionCookie(reply);
  });
  app.post('/api/auth/login', authLimit, async (request, reply) => {
    const input = validate(credentials, request.body);
    const account = admin();
    if (!account || !(await verifyPassword(input.password, account.password_hash)) || !equal(account.username, input.username)) throw new AppError('LOGIN_FAILED', 401);
    if (admin()?.password_hash !== account.password_hash) throw new AppError('LOGIN_FAILED', 401);
    return sessionCookie(reply);
  });
  app.post('/api/auth/logout', async (request, reply) => {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(request.cookies.session!));
    reply.clearCookie('session', { path: '/' });
    return { ok: true };
  });
  app.post('/api/auth/password', authLimit, async (request, reply) => {
    const input = validate(z.object({ currentPassword: z.string().max(256), password: credentials.shape.password }), request.body);
    const account = admin()!;
    if (!(await verifyPassword(input.currentPassword, account.password_hash))) throw new AppError('LOGIN_FAILED', 401);
    const hash = await hashPassword(input.password);
    db.transaction(() => {
      const updated = db.prepare('UPDATE admin SET password_hash = ? WHERE id = 1 AND password_hash = ?').run(hash, account.password_hash);
      if (!updated.changes) throw new AppError('PASSWORD_CHANGED', 409);
      db.prepare('DELETE FROM sessions').run();
    })();
    reply.clearCookie('session', { path: '/' });
    return { ok: true };
  });
  app.get('/api/connections', async () => ({ items: db.prepare('SELECT id, provider, enabled, created_at FROM connections ORDER BY created_at DESC').all() }));
  app.post('/api/connections', async (request) => {
    const input = validate(z.object({ provider: z.enum(['weread', 'flomo']), secret: z.string().trim().min(1).max(2048), confirmReplace: z.boolean().default(false) }), request.body);
    if (sync.busy || automation.sending || configuring) throw new AppError('SYNC_BUSY', 409);
    if (input.provider === 'weread' && !/^wrk-[A-Za-z0-9_-]{8,}$/.test(input.secret)) throw new AppError('KEY_FORMAT');
    if (input.provider === 'flomo') validateWebhook(input.secret);
    const existing = db.prepare('SELECT * FROM connections WHERE provider = ? AND enabled = 1').get(input.provider) as Connection | undefined;
    if (existing && equal(vault.get(existing.secret_ref), input.secret)) return { id: existing.id, reused: true };
    if (existing && !input.confirmReplace) throw new AppError('REPLACE_CONFIRMATION', 409);
    configuring = true;
    try {
      if (input.provider === 'weread') parse(notebookPage, await providerFactory(input.secret).call('/user/notebooks', { count: 1 }));
      const id = randomUUID();
      const secretId = randomUUID();
      db.transaction(() => {
        vault.put(secretId, input.secret);
        if (existing) db.prepare('UPDATE rules SET enabled = 0, revision = revision + 1, updated_at = ? WHERE enabled = 1 AND (source_connection_id = ? OR destination_id = ?)').run(Date.now(), existing.id, existing.id);
        db.prepare('UPDATE connections SET enabled = 0 WHERE provider = ?').run(input.provider);
        db.prepare('INSERT INTO connections VALUES (?, ?, 1, ?, ?)').run(id, input.provider, secretId, Date.now());
        if (existing) automation.connectionChanged();
      })();
      return { id, reused: false };
    } finally { configuring = false; }
  });
  app.post('/api/sync', async (_request, reply) => {
    if (configuring) throw new AppError('SYNC_BUSY', 409);
    const id = sync.start();
    return reply.code(202).send({ id });
  });
  app.get('/api/status', async () => ({
    running: sync.busy,
    stats: db.prepare(`SELECT count(*) AS total, coalesce(sum(kind = 'highlight'), 0) AS highlights, coalesce(sum(kind = 'thought'), 0) AS thoughts,
      count(DISTINCT book_id) AS books FROM notes WHERE connection_id IN (SELECT id FROM connections WHERE provider = 'weread' AND enabled = 1)`).get(),
    runs: db.prepare('SELECT * FROM sync_runs ORDER BY started_at DESC, rowid DESC LIMIT 10').all(),
  }));
  app.get('/api/runs/:id', async (request) => {
    const { id } = validate(z.object({ id: z.string().uuid() }), request.params);
    const run = db.prepare('SELECT * FROM sync_runs WHERE id = ?').get(id);
    if (!run) throw new AppError('NOT_FOUND', 404);
    return { run, items: db.prepare(`SELECT i.*, b.title FROM sync_items i JOIN sync_runs r ON r.id = i.run_id
      LEFT JOIN books b ON b.connection_id = r.connection_id AND b.book_id = i.book_id
      WHERE i.run_id = ? ORDER BY i.book_id, i.kind`).all(id) };
  });
  function source(request: FastifyRequest) {
    const { connectionId } = validate(z.object({ connectionId: z.string().uuid().optional() }), request.query);
    const row = connectionId
      ? db.prepare("SELECT id FROM connections WHERE id = ? AND provider = 'weread'").get(connectionId)
      : db.prepare("SELECT id FROM connections WHERE provider = 'weread' AND enabled = 1").get();
    if (connectionId && !row) throw new AppError('NOT_FOUND', 404);
    return (row as { id: string } | undefined)?.id ?? '';
  }
  app.get('/api/books', async (request) => ({ items: db.prepare('SELECT book_id, title, author FROM books WHERE connection_id = ? ORDER BY title, book_id').all(source(request)) }));
  app.get('/api/notes', async (request) => {
    const query = validate(z.object({ q: z.string().max(300).default(''), kind: z.enum(['highlight', 'thought']).optional(), status: z.enum(['active','missing','removed','unavailable']).optional(), bookId: z.string().max(512).optional(), from: z.coerce.number().int().nonnegative().max(8_640_000_000_000_000).optional(), to: z.coerce.number().int().nonnegative().max(8_640_000_000_000_000).optional(), page: z.coerce.number().int().min(1).max(1_000_000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }), request.query);
    const where = ['n.connection_id = ?'];
    const args: (string | number)[] = [source(request)];
    if (query.kind) { where.push('n.kind = ?'); args.push(query.kind); }
    if (query.status) { where.push('n.status = ?'); args.push(query.status); }
    if (query.bookId) { where.push('n.book_id = ?'); args.push(query.bookId); }
    if (query.from !== undefined && query.to !== undefined && query.from >= query.to) throw new AppError('VALIDATION');
    if (query.from !== undefined) { where.push('n.source_created_at >= ?'); args.push(query.from); }
    if (query.to !== undefined) { where.push('n.source_created_at < ?'); args.push(query.to); }
    if (query.q) {
      const term = `%${query.q.replace(/[\\%_]/g, '\\$&')}%`;
      where.push("(n.content LIKE ? ESCAPE '\\' OR n.original_text LIKE ? ESCAPE '\\' OR b.title LIKE ? ESCAPE '\\' OR b.author LIKE ? ESCAPE '\\')"); args.push(term, term, term, term);
    }
    const from = `FROM notes n JOIN books b ON b.connection_id = n.connection_id AND b.book_id = n.book_id WHERE ${where.join(' AND ')}`;
    const total = (db.prepare(`SELECT count(*) AS n ${from}`).get(...args) as { n: number }).n;
    const items = db.prepare(`SELECT n.id, n.kind, n.content, n.original_text, n.chapter_name, n.source_created_at, n.status, n.missing_scans, n.first_missing_at, n.removed_at, n.source_error_code, b.title, b.author ${from} ORDER BY coalesce(n.source_created_at, n.first_seen_at) DESC, n.id DESC LIMIT ? OFFSET ?`).all(...args, query.limit, (query.page - 1) * query.limit);
    return { items, total, page: query.page, limit: query.limit };
  });
  app.get('/api/notes/:id', async (request) => {
    const { id } = validate(z.object({ id: z.coerce.number().int().positive() }), request.params);
    const note = db.prepare('SELECT n.*, b.title, b.author FROM notes n JOIN books b ON b.connection_id = n.connection_id AND b.book_id = n.book_id WHERE n.id = ?').get(id);
    if (!note) throw new AppError('NOT_FOUND', 404);
    return note;
  });
  app.get('/api/rules', async () => ({ items: rules.list() }));
  app.post('/api/rules', async (request) => { const saved = rules.save(request.body); automation.invalidate(); return saved; });
  app.post('/api/rules/preview', async (request) => rules.preview(request.body));
  app.post('/api/rules/:id', async (request) => {
    const { id } = validate(z.object({ id: z.string().uuid() }), request.params);
    const saved = rules.save(request.body, id); automation.invalidate(); return saved;
  });
  app.get('/api/automation', async () => automation.state());
  app.post('/api/automation', async (request) => { if (configuring) throw new AppError('SYNC_BUSY', 409); return automation.save(request.body); });
  app.post('/api/automation/recovery', async (request) => { if (configuring) throw new AppError('SYNC_BUSY', 409); return automation.acknowledgeRecovery(request.body); });
  app.get('/api/deliveries', async (request) => automation.list(request.query));
  app.post('/api/deliveries/prepare', async () => automation.prepare());
  app.get('/api/deliveries/:id', async (request) => {
    const { id } = validate(z.object({ id: z.coerce.number().int().positive() }), request.params);
    return automation.detail(id);
  });
  app.post('/api/deliveries/:id/resolve', async (request) => {
    const { id } = validate(z.object({ id: z.coerce.number().int().positive() }), request.params);
    return automation.resolve(id, request.body);
  });
  if (options.timers !== false) app.addHook('onReady', async () => { automation.start(); });
  if (options.staticDir) {
    await app.register(staticFiles, { root: options.staticDir, wildcard: false, index: 'index.html' });
  }
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'NOT_FOUND' }));
  // preClose runs before onClose disposes the database; onClose hooks run in reverse order.
  app.addHook('preClose', async () => { await automation.stop(); });
  return { app, sync, automation };
}
