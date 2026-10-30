# Synchronization, deduplication and recovery

[English](synchronization.md) · [简体中文](synchronization.zh-CN.md)

M3 implements full/light scans, persistent schedules/queues, retry/review and restart protection. Version 0.3.2 adds inferred thought missing/removal state and unsent-task holds. Missing highlights are retained. This design includes broader intent; see [Operations](usage.md) for exact implemented limits.

## Sources

- Notebooks: `/user/notebooks`, `count` + `lastSort`, until `hasMore=0`.
- Highlights: `/book/bookmarklist` per book, preserving `updated` highlights and chapter data.
- Thoughts: `/review/list/mine`, lowercase `bookid`, paginated with `synckey`.

Treat bookId, bookmarkId and reviewId as opaque strings. Identity includes the source connection and must never mix accounts.

Without a verified stable account identifier, a new key creates a separate connection space and disables related old configuration rather than merging identities. Old content remains and a new baseline is required; account replacement must not automatically send old notes as new.

## One run

1. Acquire the sync lock and record the run, mode and settings snapshot.
2. Traverse notebooks; candidates are the union of the list and locally known books.
3. Full mode reads both types for every book. Light mode selects books from overview changes such as sort/counts; changes not reflected there can be delayed.
4. Read all thought pages. Repeated cursors, missing required fields, unknown structures and errors fail that book/type scope rather than pretending it is empty.
5. Upsert fully read records by source ID. Content hashes cover business content/location/style, not collection metadata.
6. Normalize and retain raw JSON. Supplement chapters by chapterUid. Link passages through abstract or an exact same-book/chapter/range match.
7. Successful scopes can commit independently. Any failure makes the run partial; it cannot advance a “fully successful” marker.
8. Record coverage/counts/errors and scheduling state. Rule-based queue preparation uses unique note/destination identity.

Full mode does not skip personal thoughts because the overview reports reviewCount=0. Counts and sort are hints, not proof of deletion. Sync details display one row per book ID with highlight/thought results; same-title books remain distinct and failed/unread scopes are not rendered as zero.

## Absence and deletion

Public documentation does not promise deletion events, snapshot consistency or update timestamps for every edit. `updated` is not an incremental guarantee, and `synckey` is not assumed to be a cross-run watermark. Reads start pagination afresh.

A valid complete thought check missing an old ID marks it missing and holds unsent imports. A second consecutive independent complete check infers removal and cancels unsent tasks. Each page must provide consistent totals matching unique records; any top-level reviewCount must agree. Without totals, observed notes may update but unseen notes become unavailable rather than inferred deleted.

A book disappearing from notebooks does not imply its notes were deleted; old IDs are queried again. Permission/unavailability errors, partial reads, missing fields, authentication failures and anomalous drops cannot prove deletion. Failures reset consecutive absence counts; seeing the original ID clears its missing state. No source notes are physically deleted.

At least five missing notes representing half or more of a book/valid batch, or multiple previously populated books becoming empty together, triggers `SOURCE_ANOMALY` and holds deletion inference/delivery.

Reappearing IDs recover to active. A genuinely different source ID is a new record; an old ID is still the same note and does not trigger duplicate delivery. Synthetic tests cover these transitions; long-term upstream consistency remains to be validated.

## Delivery queue

Main states: `queued → sending → sent / retry / uncertain`; unsent notes that no longer match may become cancelled. `source_hold` is independent of retry/error state. Only tasks without source holds may send. Confirmed inferred removal cancels unsent tasks; sent/uncertain history is unchanged.

- Enqueue stores matched rule IDs/revisions and a text snapshot. Before sending, rematch current rules and refresh the unsent snapshot. Successful tasks are not recreated.
- Persist a started attempt and commit before HTTP. Confirmed success saves a sanitized remote identifier, if available, and sent time.
- Only definitely unsent, retryable failures get automatic retries. Rate limits respect `Retry-After`; the local budget includes potentially successful attempts.
- Lost responses, write timeouts and sending-process crashes become uncertain without automatic resend. The UI lets the administrator mark a note found in flomo or explicitly confirm it was not sent and allow retry.
- Without verified provider idempotency/query support, exactly-once is not promised. A returned ID does not imply that the record API supports reads, edits or deletes.
- Exhausted budgets retain tasks. Public documentation states 100 writes/day, but other tools may share the account quota and reset semantics need live verification.
- Rule/source edits do not resend or update already-sent memos.

The fixed outgoing text and stored source data are independent of interface language. UI labels and error explanations can change without modifying the queue.

## Frequency and consistency

Ten synthetic books in a full run need at least `1 + 10 × 2 = 21` requests. Every 15 minutes is about 2,016/day, plus pagination/metadata. This is an estimate, not a provider quota or performance promise.

Automation starts off. Intervals default to 15 minutes and allow 5–10,080 minutes or a daily time. Light mode uses a full scan on the next scheduled run when the last successful full scan is at least 24 hours old; this is not a separate wall-clock daily full-scan job. Reads are serialized and bounded with backoff. Polling cannot capture notes created and deleted between checks; one empty response cannot establish an empty account.

## Recovery and required scenarios

Restart preserves user enablement and independent operational blocks. Delivery waits for a new full source check; interrupted writes hold only their own tasks. An independent durable checkpoint detects old database restoration; explicit backup review is required. Whole-device rollback of database and checkpoint cannot be detected locally and still needs the restore workflow.

Tests must cover repeated sync without duplicates, full pagination, failure without false deletion, updates to stable IDs, account isolation, pending-rule changes, sent-record deduplication, interrupted sends becoming uncertain, restored backups blocking delivery, historical/new separation, and date/time-zone boundaries.
