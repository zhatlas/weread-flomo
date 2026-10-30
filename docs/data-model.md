# Data model

[English](data-model.md) · [简体中文](data-model.zh-CN.md)

The [candidate SQL](../design/schema.sql) validates the broader design. Runtime structure is defined by migrations [001](../migrations/001.sql), [002](../migrations/002.sql), [003](../migrations/003.sql), [004](../migrations/004.sql), [005](../migrations/005.sql) and [006](../migrations/006.sql), tracked through SQLite `user_version`. The candidate SQL must not initialize a runtime database.

| Table | Responsibility |
| --- | --- |
| connections | Provider identity, enablement and secret references; no plaintext keys |
| books | Book metadata and raw JSON per source connection |
| sync_runs | Run status, coverage, counts and redacted errors |
| sync_items | Per-book/type read results and counts |
| notes | Current highlights/thoughts, passages, chapters, location, source/local timestamps and raw JSON |
| admin / sessions | Password hash and revocable login sessions |
| secrets | Encrypted connection credentials |
| rules | Versioned configuration, revision, enablement and activation baseline |
| automation / job_state | Persistent settings, blocks, schedules and results |
| book_scans | Successfully checked notebook fingerprints |
| deliveries | Unique note/destination task and outgoing snapshot |
| delivery_attempts | Attempt state and redacted outcome for recovery and quota accounting |
| recovery_state | Instance identity, delivery checkpoint and recovery lock |

Timestamps are UTC Unix milliseconds. WeRead second-based fields are explicitly multiplied by 1,000 in the adapter; raw JSON retains original values. Display formatting follows the interface language, while the library's time zone remains Beijing time. Rule and schedule time zones are independent of interface language. Source creation and first-local-observation times are distinct; missing source modification times are not fabricated from polling times.

A note's unique key is `(connection_id, book_id, kind, source_id)`. Highlights and thoughts remain separate even when they share a passage. Books are joined through `books`, while each thought retains its own original text and chapter so a later highlight removal does not destroy context.

Raw JSON means returned API fields, not every item or image in an account. It can contain private content and belongs in protected data directories and private backups, never Git, fixtures or logs.

Content hashes identify business-data changes. Local `updated_at` records such changes; observation timestamps track reads without pretending the content changed. Unchanged reads do not rewrite the business update timestamp.

Foreign keys, WAL and busy timeouts are enabled. Network reads do not hold long write transactions. A complete validated book/type read is applied in a short transaction; read results, missing-state updates and success markers must stay consistent.

Versioned rule JSON is runtime-validated. SQLite `json_valid` checks syntax only. Several matching rules produce one note/destination task with rule/revision snapshots for explanation. Provider roles, baseline ownership/completeness and valid state transitions are service-layer checks inside transactions; candidate SQL tests alone do not prove them.

The application keeps current records, soft-deletion state, outgoing snapshots and run history. Arbitrary historical replay and a full event store are not implemented.

## Rules and baselines

Rules use strict `schemaVersion: 2` JSON, connection foreign keys, enablement and an increasing revision. Time zones, filters, history mode and output tags are in the JSON; stale revisions return 409.

First activation verifies current connection roles and the latest successful full scan, then saves `baseline_run_id`, `activated_at` and the source's maximum local `baseline_note_id`. With no hard deletes, newly observed IDs above that boundary are new; edits do not change IDs. Future hard deletion/rebuilding must retain monotonic IDs or explicitly migrate baseline membership.

Connections cannot be changed in place on a saved rule, nor can history scope change after activation. Copies establish independent baselines. Disabling retains the baseline. Replacing a connection disables associated rules and increments revisions atomically. Preview reads local data only, without fetching secrets, contacting providers or creating delivery records.

## Queue, source holds and recovery

Configuration updates check revisions. `job_state` persists due times, results and failures. `automation.delivery_cooldown` is independent of enablement and manual retry. A book fingerprint is saved only after its read succeeds.

The sending transaction records `sending` and a `started` attempt, including content/rule snapshots, before HTTP. A later transaction handles the response. Unique `(note_id, destination_id)` prevents duplicate tasks across rules and repeated syncs; queue preparation does not overwrite `sent` or `uncertain`. Startup converts interrupted sending attempts to `uncertain`; other tasks wait for the startup full sync. Quotas use persisted attempts over a rolling 24-hour window.

Migration 004 converts old rules to fixed output, removes book/author restrictions and output-field switches, preserves extra tags and replaces the standalone WeRead root tag with automatic book tags. IDs, baselines, enablement, delivery history and attempt snapshots remain. Revisions increase, requiring stale pages to reload.

Migration 005 adds missing-check timestamps, run references and source error codes to notes and an independent `deliveries.source_hold`. Source changes and task holds/cancellations commit atomically. Sent/uncertain history is excluded. UI status `held` derives from an unsent task with a source hold; it does not replace its retry/delivery state.

Migration 006 separates `sync_block` and `delivery_block` from user enablement and adds `recovery_state`. The checkpoint file lives separately in `SECRETS_DIR` and contains no account credentials or note text. A normal restart preserves settings; a restore requires administrator review.

Interface translations and browser language preferences do not require a database migration. Saved user data and delivery snapshots are never translated on a language switch.
