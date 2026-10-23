-- Candidate schema for design validation; not a released production migration.
-- All timestamps are UTC Unix milliseconds. Credentials live outside this schema.
PRAGMA foreign_keys = ON;

CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('weread', 'flomo')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  secret_ref TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX one_active_connection_per_provider
  ON connections(provider) WHERE enabled = 1;

CREATE TABLE books (
  connection_id TEXT NOT NULL REFERENCES connections(id),
  book_id TEXT NOT NULL,
  title TEXT,
  author TEXT,
  category_json TEXT CHECK (category_json IS NULL OR json_valid(category_json)),
  raw_json TEXT NOT NULL CHECK (json_valid(raw_json)),
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (connection_id, book_id)
) STRICT;

CREATE TABLE sync_runs (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES connections(id),
  mode TEXT NOT NULL CHECK (mode IN ('full', 'light')),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed', 'interrupted')),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  coverage_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(coverage_json)),
  counts_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(counts_json)),
  error_code TEXT,
  CHECK ((status = 'running' AND finished_at IS NULL)
    OR (status <> 'running' AND finished_at IS NOT NULL))
) STRICT;

CREATE UNIQUE INDEX one_running_scan_per_connection
  ON sync_runs(connection_id) WHERE status = 'running';

CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  connection_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('highlight', 'thought')),
  source_id TEXT NOT NULL,
  content TEXT,
  original_text TEXT,
  chapter_uid TEXT,
  chapter_name TEXT,
  source_range TEXT,
  source_created_at INTEGER,
  source_updated_at INTEGER,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'missing', 'removed', 'unavailable')),
  missing_scans INTEGER NOT NULL DEFAULT 0 CHECK (missing_scans >= 0),
  removal_basis TEXT CHECK (removal_basis IN ('confirmed_source', 'inferred_absence')),
  last_seen_run_id TEXT REFERENCES sync_runs(id),
  raw_json TEXT NOT NULL CHECK (json_valid(raw_json)),
  UNIQUE (connection_id, book_id, kind, source_id),
  FOREIGN KEY (connection_id, book_id) REFERENCES books(connection_id, book_id),
  CHECK ((status = 'removed' AND removal_basis IS NOT NULL)
    OR (status <> 'removed' AND removal_basis IS NULL))
) STRICT;

CREATE INDEX notes_filter ON notes(connection_id, status, kind, source_created_at);

CREATE TABLE rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  source_connection_id TEXT NOT NULL REFERENCES connections(id),
  destination_id TEXT NOT NULL REFERENCES connections(id),
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  filters_json TEXT NOT NULL CHECK (json_valid(filters_json)),
  output_json TEXT NOT NULL CHECK (json_valid(output_json)),
  baseline_run_id TEXT REFERENCES sync_runs(id),
  activated_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (enabled = 0 OR (activated_at IS NOT NULL AND baseline_run_id IS NOT NULL))
) STRICT;

CREATE TABLE deliveries (
  id INTEGER PRIMARY KEY,
  note_id INTEGER NOT NULL REFERENCES notes(id),
  destination_id TEXT NOT NULL REFERENCES connections(id),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'sent', 'retry', 'uncertain', 'cancelled')),
  matched_rules_json TEXT NOT NULL CHECK (json_valid(matched_rules_json)),
  rendered_text TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  next_attempt_at INTEGER,
  sent_at INTEGER,
  remote_id TEXT,
  UNIQUE (note_id, destination_id),
  CHECK ((status = 'sent' AND sent_at IS NOT NULL)
    OR (status <> 'sent' AND sent_at IS NULL))
) STRICT;

CREATE INDEX deliveries_due ON deliveries(status, next_attempt_at);

CREATE TABLE delivery_attempts (
  id INTEGER PRIMARY KEY,
  delivery_id INTEGER NOT NULL REFERENCES deliveries(id),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  outcome TEXT NOT NULL CHECK (outcome IN ('started', 'succeeded', 'failed', 'uncertain')),
  http_status INTEGER,
  error_code TEXT,
  response_summary_json TEXT CHECK (response_summary_json IS NULL OR json_valid(response_summary_json)),
  CHECK ((outcome = 'started' AND finished_at IS NULL)
    OR (outcome <> 'started' AND finished_at IS NOT NULL))
) STRICT;

CREATE UNIQUE INDEX one_started_attempt_per_delivery
  ON delivery_attempts(delivery_id) WHERE outcome = 'started';

CREATE TABLE job_state (
  name TEXT PRIMARY KEY CHECK (name IN ('sync', 'reconcile', 'deliver', 'backup')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  interval_seconds INTEGER NOT NULL CHECK (interval_seconds > 0),
  next_due_at INTEGER,
  started_at INTEGER,
  finished_at INTEGER,
  last_result TEXT CHECK (last_result IN ('succeeded', 'partial', 'failed', 'interrupted')),
  CHECK (enabled = 0 OR next_due_at IS NOT NULL)
) STRICT;
