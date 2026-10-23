import { createHash, randomUUID } from 'node:crypto';
import type { Store } from './store.js';
import { Vault } from './vault.js';
import { reconcileSourceTasks } from './source-state.js';
import { AppError, errorCode } from './errors.js';
import { bookInfo, chapterPage, highlightPage, notebookPage, parse, thoughtPage, type Provider, type ProviderFactory } from './weread.js';

type Kind = 'highlight' | 'thought';
type Note = {
  sourceId: string; content: string | null; original: string | null; chapterUid: string | null;
  chapterName: string | null; range: string | null; created: number | null; raw: unknown;
};
type ThoughtScan = { verified: boolean; count: number; error?: string };
type Connection = { id: string; secret_ref: string };
const text = (value: unknown): string | null => typeof value === 'string' ? value : null;
const terminalCodes = new Set(['UPSTREAM_AUTH', 'UPSTREAM_UPGRADE', 'UPSTREAM_REJECTED', 'UPSTREAM_RATE_LIMIT', 'SYNC_INTERRUPTED']);

export class SyncManager {
  private task?: Promise<void>;
  private controller?: AbortController;
  constructor(private store: Store, private vault: Vault, private factory: ProviderFactory, private canStart: () => boolean = () => true) {}
  get busy() { return !!this.task; }
  async idle() { await this.task; }
  async stop() { this.controller?.abort(); await this.idle(); }

  start(mode: 'full' | 'light' = 'full'): string {
    if (this.busy || !this.canStart()) throw new AppError('SYNC_BUSY', 409);
    const connection = this.store.db.prepare("SELECT id, secret_ref FROM connections WHERE provider = 'weread' AND enabled = 1")
      .get() as Connection | undefined;
    if (!connection) throw new AppError('CONNECTION_REQUIRED', 409);
    const key = this.vault.get(connection.secret_ref);
    const run = randomUUID();
    this.store.db.prepare("INSERT INTO sync_runs (id, connection_id, mode, status, started_at) VALUES (?, ?, ?, 'running', ?)")
      .run(run, connection.id, mode, Date.now());
    this.controller = new AbortController();
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(30 * 60 * 1000)]);
    this.task = this.run(run, connection.id, this.factory(key), signal, mode).finally(() => { this.task = undefined; this.controller = undefined; });
    return run;
  }

  private saveNotes(run: string, connection: string, book: string, kind: Kind, notes: Note[]) {
    const db = this.store.db;
    const now = Date.now();
    const statement = db.prepare(`
      INSERT INTO notes (connection_id, book_id, kind, source_id, content, original_text,
        chapter_uid, chapter_name, source_range, source_created_at, first_seen_at, last_seen_at,
        updated_at, content_hash, last_seen_run_id, raw_json, last_checked_run_id)
      VALUES (@connection, @book, @kind, @sourceId, @content, @original, @chapterUid, @chapterName,
        @range, @created, @now, @now, @now, @hash, @run, @raw, @run)
      ON CONFLICT (connection_id, book_id, kind, source_id) DO UPDATE SET
        content = excluded.content, original_text = excluded.original_text,
        chapter_uid = excluded.chapter_uid, chapter_name = excluded.chapter_name,
        source_range = excluded.source_range, source_created_at = excluded.source_created_at,
        last_seen_at = excluded.last_seen_at, last_seen_run_id = excluded.last_seen_run_id,
        updated_at = CASE WHEN notes.content_hash <> excluded.content_hash OR notes.chapter_name IS NOT excluded.chapter_name OR notes.status <> 'active'
          THEN excluded.updated_at ELSE notes.updated_at END,
        content_hash = excluded.content_hash, raw_json = excluded.raw_json,
        status = 'active', removal_basis = NULL, missing_scans = 0, first_missing_at = NULL, removed_at = NULL, source_error_code = NULL, last_checked_run_id = @run
    `);
    db.transaction(() => {
      const seen = new Set<string>();
      for (const note of notes) {
        if (seen.has(note.sourceId)) throw new AppError('UPSTREAM_DUPLICATE', 502);
        seen.add(note.sourceId);
        if (!note.chapterName && note.chapterUid) {
          const cached = db.prepare(`SELECT chapter_name FROM notes WHERE connection_id = ? AND book_id = ? AND chapter_uid = ? AND chapter_name IS NOT NULL LIMIT 1`)
            .get(connection, book, note.chapterUid) as { chapter_name: string } | undefined;
          note.chapterName = cached?.chapter_name ?? null;
        }
        const raw = note.raw as Record<string, unknown>;
        const hash = createHash('sha256').update(JSON.stringify([
          note.content, note.original, note.chapterUid, note.range, note.created, raw.colorStyle ?? null,
        ])).digest('hex');
        statement.run({ ...note, connection, book, kind, now, run, hash, raw: JSON.stringify(note.raw) });
      }
      db.prepare('INSERT OR REPLACE INTO sync_items VALUES (?, ?, ?, ?, ?, NULL)')
        .run(run, book, kind, 'succeeded', notes.length);
    })();
  }

  private reconcileThoughts(run: string, connection: string, scans: Map<string, ThoughtScan>, globalError: string | null) {
    const db = this.store.db; const now = Date.now();
    db.transaction(() => {
      if (globalError) for (const row of db.prepare('SELECT book_id FROM books WHERE connection_id = ?').all(connection) as { book_id: string }[]) scans.set(row.book_id, { verified: false, count: 0, error: globalError });
      const scopes = [...scans].map(([book, scan]) => {
        const counts = db.prepare(`SELECT count(*) AS known, coalesce(sum(last_seen_run_id IS NOT ?), 0) AS missing
          FROM notes WHERE connection_id = ? AND book_id = ? AND kind = 'thought' AND status <> 'removed'`).get(run, connection, book) as { known: number; missing: number };
        return { book, scan, ...counts };
      });
      const valid = scopes.filter((scope) => scope.scan.verified && !scope.scan.error);
      const known = valid.reduce((sum, scope) => sum + scope.known, 0);
      const missing = valid.reduce((sum, scope) => sum + scope.missing, 0);
      const batchEmpty = valid.filter((scope) => scope.known > 0).length >= 2 && valid.every((scope) => scope.scan.count === 0);
      const massDrop = batchEmpty || (missing >= 5 && missing >= known / 2);
      for (const scope of scopes) {
        const { book, scan } = scope;
        const anomaly = scan.verified && !scan.error && (massDrop || (scope.missing >= 5 && scope.missing >= scope.known / 2));
        const error = scan.error ?? (anomaly ? 'SOURCE_ANOMALY' : !scan.verified && scope.missing ? 'SOURCE_UNVERIFIED' : null);
        if (error) {
          // A failed check breaks the consecutive-check sequence; it never proves deletion.
          db.prepare(`UPDATE notes SET status = CASE WHEN status = 'missing' THEN 'missing' ELSE 'unavailable' END,
            missing_scans = 0, source_error_code = ?, last_checked_run_id = ?, updated_at = ?
            WHERE connection_id = ? AND book_id = ? AND kind = 'thought' AND status <> 'removed'
              AND (? = 1 OR last_seen_run_id IS NOT ?)`).run(error, run, now, connection, book, +!!scan.error, run);
          db.prepare("INSERT OR REPLACE INTO sync_items VALUES (?, ?, 'thought', 'failed', ?, ?)").run(run, book, scan.count, error);
        } else if (scan.verified) {
          db.prepare(`UPDATE notes SET status = CASE WHEN missing_scans >= 1 THEN 'removed' ELSE 'missing' END,
            removal_basis = CASE WHEN missing_scans >= 1 THEN 'inferred_absence' ELSE NULL END,
            removed_at = CASE WHEN missing_scans >= 1 THEN ? ELSE NULL END,
            first_missing_at = coalesce(first_missing_at, ?), source_error_code = CASE WHEN missing_scans >= 1 THEN 'SOURCE_REMOVED' ELSE 'SOURCE_MISSING' END,
            missing_scans = missing_scans + 1, last_checked_run_id = ?, updated_at = ?
            WHERE connection_id = ? AND book_id = ? AND kind = 'thought' AND status <> 'removed'
              AND last_seen_run_id IS NOT ? AND last_checked_run_id IS NOT ?`).run(now, now, run, now, connection, book, run, run);
        }
      }
      reconcileSourceTasks(db, now);
    })();
  }

  private failure(run: string, book: string, kind: Kind | 'metadata', error: unknown) {
    this.store.db.prepare('INSERT OR REPLACE INTO sync_items VALUES (?, ?, ?, ?, 0, ?)')
      .run(run, book, kind, 'failed', errorCode(error));
    if (terminalCodes.has(errorCode(error))) throw error;
  }

  private async run(run: string, connection: string, client: Provider, signal: AbortSignal, mode: 'full' | 'light') {
    const db = this.store.db;
    let failure: string | null = null;
    let listComplete = false;
    let expectedBooks = 0;
    const thoughtScans = new Map<string, ThoughtScan>();
    const fingerprints = new Map<string, string>();
    const call = async (name: string, params: Record<string, unknown>) => {
      try { signal.throwIfAborted(); return await client.call(name, params, signal); }
      catch (error) { if (signal.aborted) throw new AppError('SYNC_INTERRUPTED', 503); throw error; }
    };
    try {
      const notebooks = new Map<string, Record<string, unknown>>();
      const reviewCounts = new Map<string, number>();
      const cursors = new Set<number>();
      let lastSort: number | undefined;
      for (let pageNumber = 0; ; pageNumber++) {
        signal.throwIfAborted();
        if (pageNumber >= 10_000) throw new AppError('PAGINATION_LIMIT', 502);
        const page = parse(notebookPage, await call('/user/notebooks', { count: 100, ...(lastSort === undefined ? {} : { lastSort }) }));
        for (const item of page.books) {
          if (notebooks.has(item.bookId)) throw new AppError('PAGINATION_DUPLICATE', 502);
          notebooks.set(item.bookId, item.book ?? {});
          if (item.reviewCount !== undefined) reviewCounts.set(item.bookId, item.reviewCount);
          fingerprints.set(item.bookId, createHash('sha256').update(JSON.stringify(item)).digest('hex'));
        }
        if (!page.hasMore) break;
        const cursor = page.books.at(-1)?.sort;
        if (cursor === undefined || cursors.has(cursor) || !page.books.length) throw new AppError('PAGINATION_STALLED', 502);
        cursors.add(cursor); lastSort = cursor;
      }
      listComplete = true;
      db.transaction(() => {
        const upsert = db.prepare(`INSERT INTO books (connection_id, book_id, title, author, raw_json, last_seen_at)
          VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (connection_id, book_id) DO UPDATE SET
          title = COALESCE(excluded.title, books.title), author = COALESCE(excluded.author, books.author),
          raw_json = excluded.raw_json, last_seen_at = excluded.last_seen_at`);
        for (const [id, book] of notebooks) upsert.run(connection, id, text(book.title), text(book.author), JSON.stringify(book), Date.now());
      })();
      const books = db.prepare('SELECT book_id, title, author FROM books WHERE connection_id = ? ORDER BY book_id').all(connection) as
        { book_id: string; title: string | null; author: string | null }[];
      expectedBooks = books.length;
      db.prepare('UPDATE sync_runs SET coverage_json = ? WHERE id = ?').run(JSON.stringify({ expectedBooks, listComplete }), run);
      for (const book of books) {
        signal.throwIfAborted();
        const bookId = book.book_id;
        const fingerprint = fingerprints.get(bookId);
        const previous = db.prepare('SELECT fingerprint FROM book_scans WHERE connection_id = ? AND book_id = ?').get(connection, bookId) as { fingerprint: string } | undefined;
        const recheck = db.prepare("SELECT 1 FROM notes WHERE connection_id = ? AND book_id = ? AND kind = 'thought' AND status IN ('missing','unavailable') LIMIT 1").get(connection, bookId);
        if (mode === 'light' && fingerprint && previous?.fingerprint === fingerprint && !recheck) continue;
        const chapters = new Map<string, string>();
        const marks = new Map<string, string>();
        let highlights: Note[] = [];
        try {
          const response = await call('/book/bookmarklist', { bookId });
          const page = parse(highlightPage, response);
          const rawItems = (response as { updated: unknown[] }).updated;
          for (const chapter of page.chapters ?? []) chapters.set(chapter.chapterUid, chapter.title);
          highlights = page.updated.filter((item) => item.type !== 0).map((item) => {
            if (item.bookId && item.bookId !== bookId) throw new AppError('UPSTREAM_BOOK_MISMATCH', 502);
            if (item.chapterUid && item.range) marks.set(`${item.chapterUid}:${item.range}`, item.markText);
            const index = page.updated.indexOf(item);
            return { sourceId: item.bookmarkId, content: null, original: item.markText,
              chapterUid: item.chapterUid ?? null, chapterName: chapters.get(item.chapterUid ?? '') ?? null,
              range: item.range ?? null, created: item.createTime == null ? null : item.createTime * 1000, raw: rawItems[index] };
          });
          this.saveNotes(run, connection, bookId, 'highlight', highlights);
        } catch (error) { this.failure(run, bookId, 'highlight', error); }

        let thoughts: Note[] = [];
        try {
          let synckey: number | undefined;
          let total: number | undefined; let verified = true;
          const seen = new Set<number>();
          for (let pageNumber = 0; ; pageNumber++) {
            signal.throwIfAborted();
            if (pageNumber >= 10_000) throw new AppError('PAGINATION_LIMIT', 502);
            const response = await call('/review/list/mine', { bookid: bookId, count: 20, ...(synckey === undefined ? {} : { synckey }) });
            const page = parse(thoughtPage, response);
            if (page.totalCount === undefined) verified = false;
            else {
              if (total !== undefined && total !== page.totalCount) throw new AppError('UPSTREAM_COUNT_MISMATCH', 502);
              total = page.totalCount;
            }
            const rawItems = (response as { reviews: { review: unknown }[] }).reviews;
            thoughts.push(...page.reviews.map(({ review: item }, index) => {
              if (item.bookId && item.bookId !== bookId) throw new AppError('UPSTREAM_BOOK_MISMATCH', 502);
              return { sourceId: item.reviewId, content: item.content,
                original: item.abstract || marks.get(`${item.chapterUid}:${item.range}`) || null,
                chapterUid: item.chapterUid ?? null, chapterName: item.chapterName || chapters.get(item.chapterUid ?? '') || null,
                range: item.range ?? null, created: item.createTime == null ? null : item.createTime * 1000, raw: rawItems[index].review };
            }));
            if (!page.hasMore) break;
            if (page.synckey === undefined || seen.has(page.synckey) || !page.reviews.length) throw new AppError('PAGINATION_STALLED', 502);
            seen.add(page.synckey); synckey = page.synckey;
          }
          if (total !== undefined && (total !== thoughts.length || (reviewCounts.has(bookId) && reviewCounts.get(bookId) !== total))) throw new AppError('UPSTREAM_COUNT_MISMATCH', 502);
          this.saveNotes(run, connection, bookId, 'thought', thoughts);
          thoughtScans.set(bookId, { verified, count: thoughts.length });
        } catch (error) { thoughts = []; thoughtScans.set(bookId, { verified: false, count: 0, error: errorCode(error) }); this.failure(run, bookId, 'thought', error); }

        if (!book.title || !book.author) {
          try {
            const info = parse(bookInfo, await call('/book/info', { bookId }));
            db.prepare('UPDATE books SET title = ?, author = ?, raw_json = ? WHERE connection_id = ? AND book_id = ?')
              .run(info.title, info.author ?? book.author, JSON.stringify(info), connection, bookId);
          } catch (error) { this.failure(run, bookId, 'metadata', error); }
        }
        if ([...highlights, ...thoughts].some((n) => n.chapterUid && !n.chapterName)) {
          try {
            const page = parse(chapterPage, await call('/book/chapterinfo', { bookId }));
            const update = db.prepare(`UPDATE notes SET chapter_name = ?, updated_at = ?
              WHERE connection_id = ? AND book_id = ? AND chapter_uid = ? AND (chapter_name IS NULL OR chapter_name = '')`);
            db.transaction(() => { for (const chapter of page.chapters) update.run(chapter.title, Date.now(), connection, bookId, chapter.chapterUid); })();
          } catch (error) { this.failure(run, bookId, 'metadata', error); }
        }

      }
    } catch (error) { failure = signal.aborted ? 'SYNC_INTERRUPTED' : errorCode(error); }
    finally {
      if (signal.aborted) failure = 'SYNC_INTERRUPTED';
      this.reconcileThoughts(run, connection, thoughtScans, failure);
      for (const [bookId, fingerprint] of fingerprints) {
        if (thoughtScans.has(bookId) && !db.prepare("SELECT 1 FROM sync_items WHERE run_id = ? AND book_id = ? AND status = 'failed'").get(run, bookId)) db.prepare('INSERT INTO book_scans VALUES (?, ?, ?, ?) ON CONFLICT(connection_id, book_id) DO UPDATE SET fingerprint = excluded.fingerprint, checked_at = excluded.checked_at').run(connection, bookId, fingerprint, Date.now());
      }
      const results = db.prepare('SELECT status, count(*) AS n, sum(count) AS records FROM sync_items WHERE run_id = ? GROUP BY status').all(run) as
        { status: string; n: number; records: number }[];
      const failed = results.find((r) => r.status === 'failed')?.n ?? 0;
      const succeeded = results.find((r) => r.status === 'succeeded')?.n ?? 0;
      if (signal.aborted) failure = 'SYNC_INTERRUPTED';
      const status = failure === 'SYNC_INTERRUPTED' ? 'interrupted' : (failure || failed) ? (succeeded ? 'partial' : 'failed') : 'succeeded';
      db.prepare('UPDATE sync_runs SET status = ?, finished_at = ?, coverage_json = ?, counts_json = ?, error_code = ? WHERE id = ?')
        .run(status, Date.now(), JSON.stringify({ listComplete, expectedBooks }), JSON.stringify({ succeeded, failed }), failure, run);
    }
  }
}
