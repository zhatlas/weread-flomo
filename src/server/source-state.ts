import type Database from 'better-sqlite3';

// Run inside the transaction that changes note state. Keep send history and retry state intact.
export function reconcileSourceTasks(db: Database.Database, now: number) {
  const reason = `CASE WHEN n.kind <> 'thought' OR n.status = 'active' THEN NULL
    WHEN n.status = 'removed' THEN 'SOURCE_REMOVED'
    WHEN n.status = 'missing' THEN 'SOURCE_MISSING'
    WHEN n.source_error_code IN ('SOURCE_ANOMALY','SOURCE_UNVERIFIED') THEN n.source_error_code
    ELSE 'SOURCE_UNAVAILABLE' END`;
  const lookup = `SELECT ${reason} FROM notes n WHERE n.id = d.note_id`;
  db.prepare(`UPDATE deliveries AS d SET source_hold = (${lookup}), updated_at = ?
    WHERE d.status IN ('queued','retry','blocked','cancelled')
      AND d.source_hold IS NOT (${lookup})`).run(now);
  db.prepare(`UPDATE deliveries SET status = 'cancelled', error_code = 'SOURCE_REMOVED', next_attempt_at = NULL, updated_at = ?
    WHERE source_hold = 'SOURCE_REMOVED' AND status IN ('queued','retry','blocked')`).run(now);
}

export const deliveryStateSql = "CASE WHEN source_hold IS NOT NULL AND status IN ('queued','retry','blocked') THEN 'held' ELSE status END";
