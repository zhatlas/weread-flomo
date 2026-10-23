import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
import type { AutomationConfig, AutomationState, Delivery, Job } from '../shared/automation.js';
import type { Store } from './store.js';
import type { Vault } from './vault.js';
import type { SyncManager } from './sync.js';
import { Rules, dateBounds, formatNote, matchNote, scopeReasons, type Note } from './rules.js';
import { reconcileSourceTasks, deliveryStateSql } from './source-state.js';
import { AppError, errorCode } from './errors.js';
import { flomoSender, type Sender, type SendResult } from './flomo.js';

const day = 86_400_000;
const configSchema = z.strictObject({ syncEnabled: z.boolean(), deliveryEnabled: z.boolean(), schedule: z.enum(['interval', 'daily']), intervalMinutes: z.number().int().min(5).max(10080), dailyTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), timezone: z.string().min(1).max(100), syncMode: z.enum(['full', 'light']), dailyLimit: z.number().int().min(1).max(100), maxContentChars: z.number().int().min(1).max(100000) });
const settingsSchema = z.strictObject({ config: configSchema, revision: z.number().int().positive(), confirmSend: z.boolean().default(false) });
function validate<T>(schema: z.ZodType<T>, value: unknown): T { const parsed = schema.safeParse(value); if (!parsed.success) throw new AppError('AUTOMATION_VALIDATION'); return parsed.data; }
export function nextSchedule(config: AutomationConfig, now: number): number {
  try {
    new Intl.DateTimeFormat('en', { timeZone: config.timezone }).format(now);
    if (/^[+-]/.test(config.timezone)) throw new Error('offset');
    if (config.schedule === 'interval') return now + config.intervalMinutes * 60_000;
    const local = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(config.timezone);
    const time = Temporal.PlainTime.from(config.dailyTime);
    let target = local.toPlainDate().toZonedDateTime({ timeZone: config.timezone, plainTime: time });
    if (target.epochMilliseconds <= now) target = local.toPlainDate().add({ days: 1 }).toZonedDateTime({ timeZone: config.timezone, plainTime: time });
    return target.epochMilliseconds;
  } catch { throw new AppError('RULE_DATE'); }
}
type SourceNote = Note & { connection_id: string };
const noteSelect = `SELECT n.id, n.connection_id, n.book_id, n.kind, n.status, n.content, n.original_text, n.chapter_name, n.source_created_at, b.title, b.author FROM notes n JOIN books b ON b.connection_id = n.connection_id AND b.book_id = n.book_id`;
export class Automation {
  private task?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private controller?: AbortController;
  private stopping = false;
  private dirty = true;
  private reconcileAt = 0;
  private startupBaseline: number;
  private startupRetryAt = 0;
  private readonly now: () => number;
  private readonly sender: Sender;
  constructor(private store: Store, private vault: Vault, private sync: SyncManager, private rules: Rules, private options: { sender?: Sender; now?: () => number; canRun?: () => boolean } = {}) {
    this.now = options.now ?? Date.now; this.sender = options.sender ?? flomoSender();
    const db = store.db;
    this.startupBaseline = (db.prepare('SELECT coalesce(max(rowid), 0) AS n FROM sync_runs').get() as { n: number }).n;
    db.transaction(() => {
      const now = this.now();
      if (this.job('sync').last_result === 'running') db.prepare("UPDATE job_state SET last_result = 'interrupted', error_code = 'SYNC_INTERRUPTED', finished_at = ?, failures = failures + 1, next_due_at = ? WHERE name = 'sync'").run(now, this.settings().config.syncEnabled ? now + 60000 : null);
      db.prepare("UPDATE delivery_attempts SET outcome = 'uncertain', finished_at = ?, error_code = 'SEND_INTERRUPTED' WHERE outcome = 'started'").run(now);
      db.prepare("UPDATE deliveries SET status = 'uncertain', updated_at = ?, error_code = 'SEND_INTERRUPTED', next_attempt_at = NULL WHERE status = 'sending'").run(now);
      db.prepare("UPDATE job_state SET last_result = 'interrupted', error_code = 'SEND_INTERRUPTED', finished_at = ? WHERE name = 'deliver' AND last_result = 'running'").run(now);
      if (store.recovery.required) this.pause('deliver', 'BACKUP_REVIEW');
    })();
  }
  get busy() { return !!this.task; }
  get sending() { return !!this.controller; }
  settings(): { config: AutomationConfig; revision: number } {
    const row = this.store.db.prepare('SELECT * FROM automation WHERE id = 1').get() as { config_json: string; revision: number };
    return { config: validate(configSchema, JSON.parse(row.config_json)), revision: row.revision };
  }
  private blocks() {
    const row = this.store.db.prepare('SELECT sync_block, delivery_block FROM automation WHERE id = 1').get() as { sync_block: string | null; delivery_block: string | null };
    return { sync: row.sync_block, deliver: row.delivery_block };
  }
  private sourceReady() {
    return !!this.store.db.prepare("SELECT 1 FROM sync_runs WHERE rowid > ? AND mode = 'full' AND status = 'succeeded' AND connection_id IN (SELECT id FROM connections WHERE provider = 'weread' AND enabled = 1) LIMIT 1").get(this.startupBaseline);
  }
  state(): AutomationState {
    const counts = this.store.db.prepare(`SELECT ${deliveryStateSql} AS status, count(*) AS n FROM deliveries GROUP BY ${deliveryStateSql}`).all() as { status: string; n: number }[];
    return { ...this.settings(), blocks: this.blocks(), recoveryRequired: this.store.recovery.required, startupSyncPending: !this.sourceReady(), busy: this.busy, jobs: this.store.db.prepare('SELECT * FROM job_state ORDER BY name').all() as Job[], usedQuota: this.quota().n, counts: Object.fromEntries(counts.map((row) => [row.status, row.n])) };
  }
  save(value: unknown) {
    const input = validate(settingsSchema, value); const now = this.now(); nextSchedule(input.config, now);
    return this.store.db.transaction(() => {
      const old = this.settings();
      if (old.revision !== input.revision) throw new AppError('AUTOMATION_CONFLICT', 409);
      if (input.config.syncEnabled && !this.store.db.prepare("SELECT id FROM connections WHERE provider = 'weread' AND enabled = 1").get()) throw new AppError('CONNECTION_REQUIRED', 409);
      if (input.config.deliveryEnabled) {
        if (!this.store.db.prepare("SELECT id FROM connections WHERE provider = 'flomo' AND enabled = 1").get()) throw new AppError('RULE_CONNECTION', 409);
        if ((!old.config.deliveryEnabled || this.blocks().deliver) && !input.confirmSend) throw new AppError('SEND_CONFIRM', 409);
      }
      if (input.config.deliveryEnabled && this.store.recovery.required) throw new AppError('BACKUP_REVIEW', 409);
      this.store.db.prepare('UPDATE automation SET config_json = ?, revision = revision + 1, sync_block = NULL, delivery_block = NULL WHERE id = 1').run(JSON.stringify(input.config));
      if (JSON.stringify({ ...old.config, deliveryEnabled: false, dailyLimit: 0, maxContentChars: 0 }) !== JSON.stringify({ ...input.config, deliveryEnabled: false, dailyLimit: 0, maxContentChars: 0 })) this.store.db.prepare("UPDATE job_state SET next_due_at = ?, error_code = NULL, failures = 0 WHERE name = 'sync'").run(input.config.syncEnabled ? nextSchedule(input.config, now) : null);
      if (old.config.deliveryEnabled !== input.config.deliveryEnabled || input.confirmSend) this.store.db.prepare("UPDATE job_state SET next_due_at = ?, error_code = NULL WHERE name = 'deliver'").run(input.config.deliveryEnabled ? Math.max(now, this.cooldown()) : null);
      this.invalidate(); return this.state();
    })();
  }
  private pause(name: 'sync' | 'deliver', error: string) {
    this.store.db.prepare(`UPDATE automation SET ${name === 'sync' ? 'sync_block' : 'delivery_block'} = ?, revision = revision + 1 WHERE id = 1`).run(error);
    this.store.db.prepare('UPDATE job_state SET next_due_at = NULL, error_code = ?, last_result = ? WHERE name = ?').run(error, 'paused', name);
  }
  connectionChanged() {
    const { config } = this.settings(); config.syncEnabled = false; config.deliveryEnabled = false;
    this.store.db.prepare('UPDATE automation SET config_json = ? WHERE id = 1').run(JSON.stringify(config));
    this.startupBaseline = (this.store.db.prepare('SELECT coalesce(max(rowid), 0) AS n FROM sync_runs').get() as { n: number }).n;
    this.pause('sync', 'CONNECTION_CHANGED'); this.pause('deliver', 'CONNECTION_CHANGED');
    this.store.db.prepare("UPDATE deliveries SET status = 'cancelled', error_code = 'CONNECTION_CHANGED', next_attempt_at = NULL, updated_at = ? WHERE status IN ('queued','retry','blocked')").run(this.now());
    this.invalidate();
  }
  invalidate() { this.dirty = true; }
  start() { if (!this.timer) { this.timer = setInterval(() => void this.tick(), 1000); this.timer.unref(); } }
  async stop() { this.stopping = true; if (this.timer) clearInterval(this.timer); this.controller?.abort(); await this.sync.stop(); await this.task; }
  tick(): Promise<void> {
    if (this.task) return this.task;
    if (this.stopping || this.options.canRun?.() === false) return Promise.resolve();
    this.task = this.work().catch((error) => {
      if (!this.stopping) this.pause('deliver', this.store.recovery.inspect() ? 'BACKUP_REVIEW' : errorCode(error));
    }).finally(() => { this.task = undefined; });
    return this.task;
  }
  private async work() {
    let { config } = this.settings(); const now = this.now();
    const syncJob = this.job('sync');
    const startup = config.deliveryEnabled && !this.blocks().deliver && !this.sourceReady();
    if (!this.blocks().sync && !this.sync.busy && ((config.syncEnabled && (syncJob.next_due_at ?? now) <= now) || (startup && this.startupRetryAt <= now))) {
      this.store.db.prepare("UPDATE job_state SET started_at = ?, last_result = 'running', next_due_at = ? WHERE name = 'sync'").run(now, nextSchedule(config, now));
      try {
        const lastFull = this.store.db.prepare("SELECT max(finished_at) AS time FROM sync_runs WHERE connection_id IN (SELECT id FROM connections WHERE provider = 'weread' AND enabled = 1) AND mode = 'full' AND status = 'succeeded'").get() as { time: number | null };
        const mode = !startup && config.syncMode === 'light' && lastFull.time !== null && lastFull.time > now - day ? 'light' : 'full';
        const id = this.sync.start(mode); await this.sync.idle(); this.invalidate();
        const run = this.store.db.prepare('SELECT status, error_code FROM sync_runs WHERE id = ?').get(id) as { status: string; error_code: string | null };
        const current = this.settings().config; const failed = run.status !== 'succeeded';
        const failures = failed ? syncJob.failures + 1 : 0;
        const next = nextSchedule(current, this.now());
        this.startupRetryAt = failed ? this.now() + Math.min(3600000, 60000 * 2 ** Math.min(failures - 1, 6)) : 0;
        this.store.db.prepare("UPDATE job_state SET finished_at = ?, last_result = ?, error_code = ?, failures = ?, next_due_at = ? WHERE name = 'sync'").run(this.now(), run.status, run.error_code ?? (failed ? 'SYNC_PARTIAL' : null), failures, (current.syncEnabled || startup) ? (failed ? Math.min(next, this.now() + Math.min(3600000, 60000 * 2 ** Math.min(failures - 1, 6))) : next) : null);
        if (['UPSTREAM_AUTH','UPSTREAM_UPGRADE','UPSTREAM_REJECTED'].includes(run.error_code ?? '')) this.pause('sync', run.error_code!);
      } catch (error) { this.pause('sync', errorCode(error)); }
    }
    if (this.stopping || this.sync.busy || this.options.canRun?.() === false) return;
    config = this.settings().config;
    if (!config.deliveryEnabled || this.blocks().deliver || !this.sourceReady()) return;
    if (this.dirty || this.now() >= this.reconcileAt) this.prepare();
    if ((this.job('deliver').next_due_at ?? 0) <= this.now()) await this.sendOne(config);
  }
  private job(name: string) { return this.store.db.prepare('SELECT * FROM job_state WHERE name = ?').get(name) as Job; }
  private cooldown() { return (this.store.db.prepare('SELECT delivery_cooldown FROM automation WHERE id = 1').get() as { delivery_cooldown: number }).delivery_cooldown; }
  private quota() { return this.store.db.prepare('SELECT count(*) AS n, min(started_at) AS oldest FROM delivery_attempts WHERE started_at > ?').get(this.now() - day) as { n: number; oldest: number | null }; }
  private planner() {
    const connections = new Set((this.store.db.prepare('SELECT id FROM connections WHERE enabled = 1').all() as { id: string }[]).map((c) => c.id));
    const rules = this.rules.list().filter((rule) => rule.enabled && connections.has(rule.config.sourceConnectionId) && connections.has(rule.config.destinationId)).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).map((rule) => ({ rule, bounds: dateBounds(rule.config) }));
    return (note: SourceNote, destination: string) => {
      const matched = rules.filter(({ rule, bounds }) => rule.config.sourceConnectionId === note.connection_id && rule.config.destinationId === destination && !matchNote(note, rule.config, bounds).length && !scopeReasons(note, rule.config, rule.baselineNoteId).length).map(({ rule }) => rule);
      if (!matched.length) return undefined;
      return { content: formatNote(note, matched[0].config), rules: JSON.stringify(matched.map((r) => ({ id: r.id, name: r.config.name, revision: r.revision }))) };
    };
  }
  prepare() {
    if (this.sync.busy) throw new AppError('SYNC_BUSY', 409);
    this.store.db.transaction(() => {
      reconcileSourceTasks(this.store.db, this.now());
      const plan = this.planner(); const now = this.now();
      const existing = this.store.db.prepare("SELECT * FROM deliveries WHERE status IN ('queued','retry','blocked','cancelled')").all() as Delivery[];
      for (const delivery of existing) {
        if (delivery.source_hold) continue;
        const note = this.store.db.prepare(`${noteSelect} WHERE n.id = ?`).get(delivery.note_id) as SourceNote;
        const candidate = plan(note, delivery.destination_id);
        if (!candidate) this.store.db.prepare("UPDATE deliveries SET status = 'cancelled', next_attempt_at = NULL, error_code = 'RULE_NO_MATCH', updated_at = ? WHERE id = ?").run(now, delivery.id);
        else this.store.db.prepare("UPDATE deliveries SET content = ?, matched_rules_json = ?, status = CASE WHEN status = 'cancelled' THEN 'queued' ELSE status END, next_attempt_at = CASE WHEN status = 'cancelled' THEN ? ELSE next_attempt_at END, error_code = CASE WHEN status = 'cancelled' THEN NULL ELSE error_code END, updated_at = ? WHERE id = ?").run(candidate.content, candidate.rules, now, now, delivery.id);
      }
      const dest = this.store.db.prepare("SELECT id FROM connections WHERE provider = 'flomo' AND enabled = 1").get() as { id: string } | undefined;
      if (dest) {
        let after = 0;
        for (;;) {
          const notes = this.store.db.prepare(`${noteSelect} WHERE n.connection_id IN (SELECT id FROM connections WHERE provider = 'weread' AND enabled = 1) AND n.id > ? ORDER BY n.id LIMIT 200`).all(after) as SourceNote[];
          if (!notes.length) break;
          for (const note of notes) {
            const candidate = plan(note, dest.id); if (!candidate) continue;
            this.store.db.prepare("INSERT OR IGNORE INTO deliveries (note_id, destination_id, status, content, matched_rules_json, created_at, updated_at, next_attempt_at) VALUES (?, ?, 'queued', ?, ?, ?, ?, ?)").run(note.id, dest.id, candidate.content, candidate.rules, now, now, now);
          }
          after = notes.at(-1)!.id;
        }
      }
    })();
    this.dirty = false; this.reconcileAt = this.now() + 60000; return this.state();
  }
  private async sendOne(config: AutomationConfig) {
    const db = this.store.db; const now = this.now();
    if (this.cooldown() > now) { db.prepare("UPDATE job_state SET next_due_at = ? WHERE name = 'deliver'").run(this.cooldown()); return; }
    const quota = this.quota();
    if (quota.n >= config.dailyLimit) { db.prepare("UPDATE job_state SET next_due_at = ?, last_result = 'waiting', error_code = 'LOCAL_QUOTA' WHERE name = 'deliver'").run(quota.oldest! + day); return; }
    db.transaction(() => reconcileSourceTasks(db, now))();
    const delivery = db.prepare("SELECT * FROM deliveries WHERE source_hold IS NULL AND status IN ('queued','retry') AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at, id LIMIT 1").get(now) as Delivery | undefined;
    db.prepare("UPDATE job_state SET next_due_at = ? WHERE name = 'deliver'").run(now + 5000);
    if (!delivery) return;
    const note = db.prepare(`${noteSelect} WHERE n.id = ?`).get(delivery.note_id) as SourceNote;
    const candidate = this.planner()(note, delivery.destination_id);
    if (!candidate) { db.prepare("UPDATE deliveries SET status = 'cancelled', error_code = 'RULE_NO_MATCH', updated_at = ?, next_attempt_at = NULL WHERE id = ?").run(now, delivery.id); return; }
    if (!candidate.content.trim() || Array.from(candidate.content).length > config.maxContentChars) {
      db.prepare("UPDATE deliveries SET status = 'blocked', content = ?, matched_rules_json = ?, error_code = 'CONTENT_LIMIT', updated_at = ?, next_attempt_at = NULL WHERE id = ?").run(candidate.content, candidate.rules, now, delivery.id); return;
    }
    const connection = db.prepare("SELECT secret_ref FROM connections WHERE id = ? AND provider = 'flomo' AND enabled = 1").get(delivery.destination_id) as { secret_ref: string };
    const url = this.vault.get(connection.secret_ref);
    const attempt = db.transaction(() => {
      this.store.recovery.advance();
      db.prepare('UPDATE automation SET delivery_cooldown = ? WHERE id = 1').run(now + 5000);
      db.prepare("UPDATE deliveries SET status = 'sending', content = ?, matched_rules_json = ?, next_attempt_at = NULL, updated_at = ? WHERE id = ?").run(candidate.content, candidate.rules, now, delivery.id);
      db.prepare("UPDATE job_state SET started_at = ?, last_result = 'running', error_code = NULL WHERE name = 'deliver'").run(now);
      return db.prepare("INSERT INTO delivery_attempts (delivery_id, started_at, outcome, content, matched_rules_json) VALUES (?, ?, 'started', ?, ?)").run(delivery.id, now, candidate.content, candidate.rules).lastInsertRowid;
    })();
    this.controller = new AbortController();
    let result: SendResult;
    try { result = await this.sender(url, candidate.content, this.controller.signal); }
    catch { result = { status: 'uncertain', error: 'FLOMO_UNCERTAIN' }; }
    finally { this.controller = undefined; }
    const finished = this.now(); const retries = delivery.retries + (result.status === 'retry' ? 1 : 0);
    if (result.status === 'retry' && retries >= 5) result = { ...result, status: 'blocked', error: 'RETRY_EXHAUSTED' };
    const retryAt = result.status === 'retry' ? Math.max(finished + Math.min(3600000, 60000 * 2 ** Math.min(retries - 1, 6)), result.retryAt ?? 0) : null;
    db.transaction(() => {
      db.prepare('UPDATE automation SET delivery_cooldown = max(delivery_cooldown, ?) WHERE id = 1').run(retryAt ?? finished + 5000);
      db.prepare('UPDATE delivery_attempts SET outcome = ?, finished_at = ?, error_code = ?, http_status = ? WHERE id = ?').run(result.status, finished, result.error ?? null, result.httpStatus ?? null, attempt);
      db.prepare('UPDATE deliveries SET status = ?, updated_at = ?, next_attempt_at = ?, sent_at = ?, remote_id = ?, error_code = ?, retries = ? WHERE id = ?').run(result.status, finished, retryAt, result.status === 'sent' ? finished : null, result.remoteId ?? null, result.error ?? null, retries, delivery.id);
      db.prepare("UPDATE job_state SET finished_at = ?, last_result = ?, error_code = ?, next_due_at = ? WHERE name = 'deliver'").run(finished, result.status, result.error ?? null, this.settings().config.deliveryEnabled ? retryAt ?? finished + 5000 : null);
      if (result.status === 'blocked') this.pause('deliver', result.error ?? 'FLOMO_REJECTED');
    })();
  }
  acknowledgeRecovery(value: unknown) {
    validate(z.strictObject({ confirm: z.literal(true) }), value);
    if (this.busy || this.sync.busy) throw new AppError('SYNC_BUSY', 409);
    if (!this.store.recovery.required) throw new AppError('DELIVERY_STATE', 409);
    this.store.recovery.acknowledge();
    this.store.db.prepare("UPDATE automation SET delivery_block = NULL, revision = revision + 1 WHERE id = 1 AND delivery_block = 'BACKUP_REVIEW'").run();
    this.store.db.prepare("UPDATE job_state SET error_code = NULL, last_result = 'waiting', next_due_at = ? WHERE name = 'deliver'").run(this.now());
    this.startupBaseline = (this.store.db.prepare('SELECT coalesce(max(rowid), 0) AS n FROM sync_runs').get() as { n: number }).n;
    this.startupRetryAt = 0;
    return this.state();
  }
  list(value: unknown) {
    const query = validate(z.object({ page: z.coerce.number().int().min(1).max(1000000).default(1), status: z.enum(['queued','sending','sent','retry','uncertain','blocked','cancelled','held']).optional() }), value);
    const where = query.status ? ` WHERE (${deliveryStateSql.replaceAll('source_hold', 'd.source_hold').replaceAll('status', 'd.status')}) = ?` : ''; const args = query.status ? [query.status] : [];
    const total = (this.store.db.prepare(`SELECT count(*) AS n FROM deliveries d${where}`).get(...args) as { n: number }).n;
    const items = this.store.db.prepare(`SELECT d.*, b.title, n.kind FROM deliveries d JOIN notes n ON n.id = d.note_id JOIN books b ON b.connection_id = n.connection_id AND b.book_id = n.book_id${where} ORDER BY d.id DESC LIMIT 20 OFFSET ?`).all(...args, (query.page - 1) * 20);
    return { items, total, page: query.page };
  }
  detail(id: number) {
    const delivery = this.store.db.prepare('SELECT * FROM deliveries WHERE id = ?').get(id);
    if (!delivery) throw new AppError('NOT_FOUND', 404);
    return { delivery, attempts: this.store.db.prepare('SELECT * FROM delivery_attempts WHERE delivery_id = ? ORDER BY id DESC').all(id) };
  }
  resolve(id: number, value: unknown) {
    const input = validate(z.strictObject({ action: z.enum(['mark_sent','retry']), confirm: z.literal(true) }), value);
    this.store.db.transaction(() => {
      const row = this.store.db.prepare('SELECT * FROM deliveries WHERE id = ?').get(id) as Delivery | undefined;
      if (!row) throw new AppError('NOT_FOUND', 404);
      if (!(input.action === 'mark_sent' ? row.status === 'uncertain' : ['uncertain','blocked','retry'].includes(row.status))) throw new AppError('DELIVERY_STATE', 409);
      if (input.action === 'retry') {
        const note = this.store.db.prepare('SELECT kind, status FROM notes WHERE id = ?').get(row.note_id) as { kind: string; status: string };
        if (row.source_hold || (note.kind === 'thought' && note.status !== 'active')) throw new AppError('SOURCE_NOT_READY', 409);
      }
      if (input.action === 'mark_sent') this.store.db.prepare("UPDATE deliveries SET status = 'sent', sent_at = ?, updated_at = ?, next_attempt_at = NULL, error_code = 'MANUALLY_CONFIRMED' WHERE id = ?").run(this.now(), this.now(), id);
      else this.store.db.prepare("UPDATE deliveries SET status = 'queued', updated_at = ?, next_attempt_at = ?, error_code = NULL, retries = 0 WHERE id = ?").run(this.now(), this.now(), id);
    })(); this.invalidate(); return this.detail(id);
  }
}
