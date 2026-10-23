CREATE TABLE rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_connection_id TEXT NOT NULL REFERENCES connections(id),
  destination_id TEXT NOT NULL REFERENCES connections(id),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  revision INTEGER NOT NULL CHECK (revision > 0),
  config_json TEXT NOT NULL CHECK (json_valid(config_json)),
  baseline_run_id TEXT REFERENCES sync_runs(id),
  baseline_note_id INTEGER,
  activated_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((baseline_run_id IS NULL AND baseline_note_id IS NULL AND activated_at IS NULL)
    OR (baseline_run_id IS NOT NULL AND baseline_note_id >= 0 AND activated_at IS NOT NULL)),
  CHECK (enabled = 0 OR baseline_run_id IS NOT NULL)
) STRICT;
CREATE INDEX rules_source ON rules(source_connection_id, enabled);
