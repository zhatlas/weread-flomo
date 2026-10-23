CREATE TABLE automation (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 1,
  delivery_cooldown INTEGER NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL CHECK (json_valid(config_json))
) STRICT;
INSERT INTO automation (id, revision, config_json) VALUES (1, 1, '{"syncEnabled":false,"deliveryEnabled":false,"schedule":"interval","intervalMinutes":15,"dailyTime":"09:00","timezone":"Asia/Shanghai","syncMode":"full","dailyLimit":100,"maxContentChars":5000}');
CREATE TABLE job_state (
  name TEXT PRIMARY KEY CHECK (name IN ('sync','deliver')),
  next_due_at INTEGER,
  started_at INTEGER,
  finished_at INTEGER,
  last_result TEXT,
  error_code TEXT,
  failures INTEGER NOT NULL DEFAULT 0
) STRICT;
INSERT INTO job_state(name) VALUES ('sync'), ('deliver');
CREATE TABLE book_scans (
  connection_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  PRIMARY KEY(connection_id, book_id),
  FOREIGN KEY(connection_id, book_id) REFERENCES books(connection_id, book_id)
) STRICT;
CREATE TABLE deliveries (
  id INTEGER PRIMARY KEY,
  note_id INTEGER NOT NULL REFERENCES notes(id),
  destination_id TEXT NOT NULL REFERENCES connections(id),
  status TEXT NOT NULL CHECK(status IN ('queued','sending','sent','retry','uncertain','blocked','cancelled')),
  content TEXT NOT NULL,
  matched_rules_json TEXT NOT NULL CHECK(json_valid(matched_rules_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  next_attempt_at INTEGER,
  sent_at INTEGER,
  remote_id TEXT,
  error_code TEXT,
  retries INTEGER NOT NULL DEFAULT 0,
  UNIQUE(note_id, destination_id),
  CHECK ((status = 'sent' AND sent_at IS NOT NULL) OR (status <> 'sent' AND sent_at IS NULL))
) STRICT;
CREATE INDEX deliveries_due ON deliveries(status, next_attempt_at);
CREATE TABLE delivery_attempts (
  id INTEGER PRIMARY KEY,
  delivery_id INTEGER NOT NULL REFERENCES deliveries(id),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  outcome TEXT NOT NULL CHECK(outcome IN ('started','sent','retry','uncertain','blocked')),
  content TEXT NOT NULL,
  matched_rules_json TEXT NOT NULL CHECK(json_valid(matched_rules_json)),
  http_status INTEGER,
  error_code TEXT,
  CHECK ((outcome = 'started' AND finished_at IS NULL) OR (outcome <> 'started' AND finished_at IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX one_delivery_attempt ON delivery_attempts(delivery_id) WHERE outcome = 'started';
CREATE INDEX attempts_quota ON delivery_attempts(started_at);
