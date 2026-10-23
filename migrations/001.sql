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


CREATE TABLE admin (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  csrf TEXT NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE TABLE secrets (
  id TEXT PRIMARY KEY,
  nonce BLOB NOT NULL,
  ciphertext BLOB NOT NULL,
  tag BLOB NOT NULL
) STRICT;
CREATE TABLE sync_items (
  run_id TEXT NOT NULL REFERENCES sync_runs(id),
  book_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('highlight', 'thought', 'metadata')),
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  PRIMARY KEY (run_id, book_id, kind)
) STRICT;
