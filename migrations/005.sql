ALTER TABLE notes ADD COLUMN first_missing_at INTEGER;
ALTER TABLE notes ADD COLUMN removed_at INTEGER;
ALTER TABLE notes ADD COLUMN last_checked_run_id TEXT REFERENCES sync_runs(id);
ALTER TABLE notes ADD COLUMN source_error_code TEXT;
ALTER TABLE deliveries ADD COLUMN source_hold TEXT;
CREATE INDEX notes_recheck ON notes(connection_id, book_id, kind, status);
