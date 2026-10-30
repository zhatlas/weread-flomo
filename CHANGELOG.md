# Changelog

[English](CHANGELOG.md) · [简体中文](CHANGELOG.zh-CN.md)

## Unreleased

- Add English/Chinese interface resources with i18next, browser-language detection, a persistent manual selector and English fallback. Source data and outgoing note text remain unchanged.
- Make English the default README/documentation edition, with paired Chinese guides and contribution templates.
- Combine highlight/thought sync results into one row per book, preserving independent errors and unread states.

## 0.3.4

- Fix equal-width settings cards and overview-button arrow alignment; clarify implemented deployment features and future plans.
- Default to the current user's external application-data directory and optional `config.env`; startup and restore share path rules.
- Reject source-local database/key paths and symlinks back into source. Legacy data requires explicit migration rather than silent empty initialization.
- Add path, external configuration and restart tests; include Git-tracked private files in publishing checks.

## 0.3.3

- Enabled sync/delivery plans survive restarts; delivery waits for a full source scan from the current process.
- Interrupted/ambiguous writes hold only their own tasks, preserving deduplication, quotas and retries for other tasks.
- Add durable external delivery checkpoints, explicit recovery review and a locked, validated restore command. Whole-device rollback of all evidence still requires the restore workflow.

## 0.3.2

- Infer thought deletion conservatively: first absence holds pending imports; two consecutive verified complete checks soft-delete locally and cancel unsent tasks.
- Add count/pagination validation, anomaly guards, forced rechecks, interruption recovery and source-state filtering. Source recovery preserves task identity/retries; sent/uncertain history stays untouched.
- Add schema 5 for verification metadata and independent source holds.

## 0.3.1

- Remove book/author rule restrictions and standardize output, omitting empty thoughts.
- Generate hierarchical book tags with normalized whitespace and preserve extra tags.
- Migrate old rules while retaining history baselines and delivery deduplication.

## 0.3.0 — M3

- Add opt-in interval/daily schedules, time zones, full/light scans with periodic full reconciliation and source backoff.
- Add durable flomo queue, note/destination deduplication, current-rule payload checks, pacing, rolling budgets and character protection.
- Add conservative response handling, bounded retries for known pre-connect failures/rate limits and manual resolution for uncertain writes.
- Add automation settings, paginated delivery history and attempts. In this version, startup pauses delivery, including after old-backup restore; source schedules recover.
- Add schema 3 and synthetic scheduler/sender/recovery/browser tests. Real flomo writes and long-running real-account behavior remain unverified.

## 0.2.0 — M2

- Add visual drafts, copying, revision-checked editing, enable/disable and existing encrypted connections.
- Add server-side matching for note type, date/time zone, book IDs, authors and literal any/all include/exclude keywords, including DST boundaries.
- Add paginated match/rejection previews, missing fields, output switches, tags and full text.
- Add complete-scan baselines, explicit history inclusion and connection isolation. Disabling preserves baselines; copies create their own.
- Add non-destructive M1→M2 migration and synthetic regression tests.
- M2 has no flomo writes or queue creation; scheduling, delivery deduplication, destination validation and recovery remained M3 work.

## 0.1.0 — M1

- Add local TypeScript/React/Fastify application and SQLite migrations.
- Add protected administrator setup, login/logout/password change, expiring sessions, Origin/CSRF and authentication limits.
- Add encrypted WeRead/flomo connections, read-only WeRead verification and separate spaces after key replacement.
- Add manual background pagination, upserts, raw fields, bounded requests, run details and interruption recovery.
- Add responsive library with book/type/keyword/date/source filters and details.
- Add synthetic storage/security/provider/sync/browser tests, pinned dependencies and CI.
- M1 retains records absent from later reads; deletion inference, scheduling, rules and flomo delivery were future work at that stage.
