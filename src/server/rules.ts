import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
import { ruleConfigSchema, type RuleConfig, type Rule, type Preview, type PreviewItem } from '../shared/rules.js';
import type { Store } from './store.js';
import { AppError } from './errors.js';

export type Note = { id: number; kind: 'highlight' | 'thought'; book_id: string; status: string; content: string | null; original_text: string | null; title: string | null; author: string | null; chapter_name: string | null; source_created_at: number | null };
type Row = { id: string; config_json: string; revision: number; enabled: number; baseline_run_id: string | null; baseline_note_id: number | null; activated_at: number | null; created_at: number; updated_at: number };
type Bounds = { start?: number; end?: number };
const saveSchema = z.strictObject({ config: ruleConfigSchema, enabled: z.boolean(), revision: z.number().int().positive().optional(), confirmHistory: z.boolean().default(false) });
const previewSchema = z.strictObject({ config: ruleConfigSchema, id: z.string().uuid().optional(), revision: z.number().int().positive().optional(), page: z.number().int().min(1).max(1_000_000).default(1), view: z.enum(['matched', 'excluded', 'eligible']).default('matched') });
function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError('RULE_VALIDATION');
  return result.data;
}
export function dateBounds(config: RuleConfig): Bounds {
  try {
    // Intl rejects fixed offsets: settings accept named IANA zones, including UTC.
    new Intl.DateTimeFormat('en', { timeZone: config.timezone }).format(0);
    if (/^[+-]/.test(config.timezone)) throw new Error('offset');
    const start = config.filters.startDate ? Temporal.PlainDate.from(config.filters.startDate) : undefined;
    const end = config.filters.endDate ? Temporal.PlainDate.from(config.filters.endDate) : undefined;
    if (start && end && Temporal.PlainDate.compare(start, end) > 0) throw new Error('order');
    return { start: start?.toZonedDateTime(config.timezone).epochMilliseconds, end: end?.add({ days: 1 }).toZonedDateTime(config.timezone).epochMilliseconds };
  } catch { throw new AppError('RULE_DATE'); }
}
export function matchNote(note: Note, config: RuleConfig, bounds = dateBounds(config)): string[] {
  const f = config.filters;
  const reasons: string[] = [];
  if (note.status !== 'active') reasons.push(note.kind !== 'thought' ? 'INACTIVE' : note.status === 'removed' ? 'SOURCE_REMOVED' : note.status === 'missing' ? 'SOURCE_MISSING' : 'SOURCE_UNAVAILABLE');
  if (f.kinds.length && !f.kinds.includes(note.kind)) reasons.push('KIND');
  if (bounds.start !== undefined || bounds.end !== undefined) {
    if (note.source_created_at === null) reasons.push('TIME_MISSING');
    else if ((bounds.start !== undefined && note.source_created_at < bounds.start) || (bounds.end !== undefined && note.source_created_at >= bounds.end)) reasons.push('DATE');
  }
  const fields = f.keywordFields.map((field) => (note[field] ?? '').toLowerCase());
  const hits = (word: string) => fields.some((field) => field.includes(word.toLowerCase()));
  if (f.exclude.some(hits)) reasons.push('EXCLUDE');
  else if (f.include.length && !(f.includeMode === 'all' ? f.include.every(hits) : f.include.some(hits))) reasons.push('INCLUDE');
  return reasons;
}
export function scopeReasons(note: Note, config: RuleConfig, baselineNoteId: number | null): string[] {
  const reasons: string[] = [];
  if (config.history === 'new_only') {
    if (baselineNoteId === null) reasons.push('BEFORE_ACTIVATION');
    else if (note.id <= baselineNoteId) reasons.push('EXISTING_NOTE');
  }
  return reasons;
}
function noteBlocks(note: Note, config: RuleConfig): string[] {
  const title = note.title?.trim() || '（书名缺失）';
  const author = note.author?.trim() || '（作者缺失）';
  const chapter = note.chapter_name?.trim() || '（章节缺失）';
  const original = note.original_text?.trim() || '（原文缺失）';
  const lines = [`《${title}》 ${author} · ${chapter}`, original.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trim() ? `> ${line}` : '').join('\n')];
  if (note.kind === 'thought' && note.content?.trim()) lines.push(`📝 想法：${note.content}`);
  const bookTag = `微信读书/${title.replace(/[\s#/]+/gu, '_')}`;
  lines.push([...new Set([bookTag, ...config.output.tags])].map((tag) => `#${tag}`).join(' '));
  return lines;
}
export function formatNote(note: Note, config: RuleConfig): string {
  return noteBlocks(note, config).join('\n');
}

function serialize(row: Row): Rule {
  return { id: row.id, config: validate(ruleConfigSchema, JSON.parse(row.config_json)), enabled: !!row.enabled, revision: row.revision, baselineRunId: row.baseline_run_id, baselineNoteId: row.baseline_note_id, activatedAt: row.activated_at, createdAt: row.created_at, updatedAt: row.updated_at };
}

export class Rules {
  constructor(private store: Store) {}
  list(): Rule[] { return (this.store.db.prepare('SELECT * FROM rules ORDER BY created_at DESC, id').all() as Row[]).map(serialize); }
  get(id: string): Rule {
    const row = this.store.db.prepare('SELECT * FROM rules WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new AppError('NOT_FOUND', 404);
    return serialize(row);
  }
  private connections(config: RuleConfig, active: boolean) {
    const query = this.store.db.prepare(`SELECT id FROM connections WHERE id = ? AND provider = ?${active ? ' AND enabled = 1' : ''}`);
    if (!query.get(config.sourceConnectionId, 'weread') || !query.get(config.destinationId, 'flomo')) throw new AppError('RULE_CONNECTION', 409);
  }
  private identity(config: RuleConfig, old: Rule) {
    if (config.sourceConnectionId !== old.config.sourceConnectionId || config.destinationId !== old.config.destinationId) throw new AppError('RULE_IDENTITY', 409);
    if (old.activatedAt !== null && config.history !== old.config.history) throw new AppError('RULE_HISTORY_LOCKED', 409);
  }
  private baseline(connection: string) {
    const db = this.store.db;
    if (db.prepare("SELECT id FROM sync_runs WHERE connection_id = ? AND status = 'running'").get(connection)) throw new AppError('SYNC_BUSY', 409);
    const run = db.prepare('SELECT id, status, mode, coverage_json FROM sync_runs WHERE connection_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1').get(connection) as { id: string; status: string; mode: string; coverage_json: string } | undefined;
    if (!run || run.status !== 'succeeded' || run.mode !== 'full') throw new AppError('RULE_BASELINE', 409);
    const coverage = JSON.parse(run.coverage_json) as { listComplete?: boolean; expectedBooks?: number };
    const books = (db.prepare('SELECT count(*) AS n FROM books WHERE connection_id = ?').get(connection) as { n: number }).n;
    const scopes = (db.prepare("SELECT count(*) AS n FROM sync_items WHERE run_id = ? AND kind IN ('highlight','thought') AND status = 'succeeded'").get(run.id) as { n: number }).n;
    if (coverage.listComplete !== true || coverage.expectedBooks !== books || scopes !== books * 2) throw new AppError('RULE_BASELINE', 409);
    const cutoff = (db.prepare('SELECT coalesce(max(id), 0) AS id FROM notes WHERE connection_id = ?').get(connection) as { id: number }).id;
    return { run: run.id, cutoff };
  }
  save(value: unknown, id?: string): Rule {
    const input = validate(saveSchema, value);
    dateBounds(input.config);
    return this.store.db.transaction(() => {
      const old = id ? this.get(id) : undefined;
      if ((old && old.revision !== input.revision) || (!old && input.revision !== undefined)) throw new AppError('RULE_CONFLICT', 409);
      if (old) this.identity(input.config, old);
      this.connections(input.config, input.enabled || !old);
      let baselineRun = old?.baselineRunId ?? null;
      let baselineNote = old?.baselineNoteId ?? null;
      let activated = old?.activatedAt ?? null;
      const now = Date.now();
      if (input.enabled && baselineRun === null) {
        if (input.config.history === 'include_history' && !input.confirmHistory) throw new AppError('RULE_HISTORY_CONFIRM', 409);
        const baseline = this.baseline(input.config.sourceConnectionId);
        baselineRun = baseline.run; baselineNote = baseline.cutoff; activated = now;
      }
      const ruleId = old?.id ?? randomUUID();
      this.store.db.prepare(`INSERT INTO rules (id, name, source_connection_id, destination_id, enabled, revision, config_json, baseline_run_id, baseline_note_id, activated_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, enabled = excluded.enabled, revision = excluded.revision, config_json = excluded.config_json, baseline_run_id = excluded.baseline_run_id, baseline_note_id = excluded.baseline_note_id, activated_at = excluded.activated_at, updated_at = excluded.updated_at`)
        .run(ruleId, input.config.name, input.config.sourceConnectionId, input.config.destinationId, +input.enabled, (old?.revision ?? 0) + 1, JSON.stringify(input.config), baselineRun, baselineNote, activated, old?.createdAt ?? now, now);
      return this.get(ruleId);
    })();
  }
  preview(value: unknown): Preview {
    const input = validate(previewSchema, value);
    const bounds = dateBounds(input.config);
    return this.store.db.transaction(() => {
      this.connections(input.config, false);
      const old = input.id ? this.get(input.id) : undefined;
      if (old) {
        if (old.revision !== input.revision) throw new AppError('RULE_CONFLICT', 409);
        this.identity(input.config, old);
      } else if (input.revision !== undefined) throw new AppError('RULE_CONFLICT', 409);
      const result: Preview = { total: 0, matched: 0, eligible: 0, excluded: 0, reasons: {}, items: [], page: input.page, pageTotal: 0, baselineAt: old?.activatedAt ?? null, baselinePending: input.config.history === 'new_only' && old?.baselineNoteId == null, snapshotAt: Date.now() };
      let selected = 0;
      const rows = this.store.db.prepare(`SELECT n.id, n.kind, n.book_id, n.status, n.content, n.original_text, n.chapter_name, n.source_created_at, b.title, b.author
        FROM notes n JOIN books b ON b.connection_id = n.connection_id AND b.book_id = n.book_id
        WHERE n.connection_id = ? ORDER BY n.id DESC`).iterate(input.config.sourceConnectionId) as Iterable<Note>;
      for (const note of rows) {
        result.total++;
        const reasons = matchNote(note, input.config, bounds);
        const matched = reasons.length === 0;
        if (matched) {
          result.matched++;
          reasons.push(...scopeReasons(note, input.config, old?.baselineNoteId ?? null));
        } else result.excluded++;
        const eligible = reasons.length === 0;
        if (eligible) result.eligible++;
        for (const reason of reasons) result.reasons[reason] = (result.reasons[reason] ?? 0) + 1;
        const visible = input.view === 'matched' ? matched : input.view === 'excluded' ? !matched : eligible;
        if (visible && selected++ >= (input.page - 1) * 20 && result.items.length < 20) {
          const missing: string[] = [];
          for (const [field, label] of [['original_text', '原文'], ['title', '书名'], ['author', '作者'], ['chapter_name', '章节'], ['source_created_at', '创建时间']] as const) {
            if (note[field] === null || note[field] === '') missing.push(label);
          }
          const { book_id: _bookId, status: _status, ...summary } = note;
          const blocks = noteBlocks(note, input.config);
          result.items.push({ ...summary, matched, eligible, reasons, missing, blocks, text: blocks.join('\n') } satisfies PreviewItem);
        }
      }
      result.pageTotal = Math.max(1, Math.ceil(selected / 20));
      return result;
    })();
  }
}
