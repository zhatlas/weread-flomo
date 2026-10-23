ALTER TABLE automation ADD COLUMN sync_block TEXT;
ALTER TABLE automation ADD COLUMN delivery_block TEXT;
CREATE TABLE recovery_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  instance_id TEXT NOT NULL,
  checkpoint TEXT NOT NULL,
  review_required INTEGER NOT NULL DEFAULT 0 CHECK (review_required IN (0, 1))
) STRICT;
INSERT INTO recovery_state (id, instance_id, checkpoint) VALUES (1, lower(hex(randomblob(16))), lower(hex(randomblob(16))));
