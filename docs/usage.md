# M3 operations guide

[English](usage.md) · [简体中文](usage.zh-CN.md)

## Requirements and startup

Use Node.js 24 LTS (minimum 22.18). `better-sqlite3` attempts to download a native prebuilt binary; platforms without one need local C/C++ build tools. Local development verification is Linux arm64. Other platforms and Docker images have not received full deployment acceptance testing.

From the repository root, run `npm ci`, `npm run build`, then `npm start`. Open `http://127.0.0.1:3000`. The default listener is loopback; UI and API share an origin. First startup creates the database, independent master key and setup token. Read `setup-token` at the path shown in the startup log, then create the administrator. Initialization closes afterward; the old token is no longer valid and its file may be removed.

One process may use a data directory. Sync returns a task ID and continues server-side after the browser closes. Shutdown or a run timeout interrupts the current run. Manual sync can be retried; enabled automatic sync resumes according to its persisted schedule/backoff.

## Interface language

English and Simplified Chinese are available. The browser's primary language is used unless a manual choice exists: `zh`, `zh-CN`, `zh-TW`, `zh-HK`, `zh-Hans` and `zh-Hant` select Chinese; other languages select English. Traditional Chinese currently uses the Simplified Chinese translation.

Use the language selector on the sign-in/setup page or the workspace header. The choice is stored as `weread-flomo.language` in this browser's local storage, takes priority after refresh/sign-in and does not change other devices. If storage is unavailable, switching still works for the current tab. Clearing that site's stored preference restores automatic detection.

Labels, help, status/error messages and date formatting change language. Book titles, authors, passages, thoughts, raw fields, saved rule names, keywords, tags and outgoing/preview content do not. The library still filters/displays times in Beijing time; rule and schedule time zones retain their configured values. Changing language does not send requests to a translation service.

## Configuration

Copy the contents of `.env.example` to `config.env` in the external application-data directory and adjust as needed. `npm start`, `npm run dev` and `npm run restore` share path/configuration rules. Process environment variables take precedence. A source-local `.env` is not read. Configure provider credentials in the UI, not this file.

| Variable | Default | Meaning |
| --- | --- | --- |
| APP_HOST | 127.0.0.1 | Listener address |
| APP_PORT | 3000 | Listener port |
| APP_ORIGIN | http://127.0.0.1:3000 | Exact browser origin, no trailing slash |
| DATA_DIR | application-data directory/data | External SQLite directory |
| SECRETS_DIR | application-data directory/secrets | External master-key/setup/checkpoint directory |

Mismatched origins reject writes; do not mix `localhost` and `127.0.0.1`. HTTPS origins enable Secure cookies. A reverse proxy must preserve the browser Origin and forward to internal HTTP. `X-Forwarded-For` is not currently trusted, so proxied login rate limits share the proxy address. Use HTTPS for public access. Proxy/domain/certificate provisioning is not automatic.

## Connections and synchronization

Saving a WeRead connection makes one read-only notebook query. Failure leaves the existing connection intact. Saving the same key reuses the data space. Replacing a key requires confirmation and creates a new space because reliable account continuity is unavailable. Previous spaces remain accessible in Library.

flomo addresses must use approved HTTPS hosts and an `/iwh/` path. Saving checks format, not actual write permission, and sends no test note. The saved destination becomes available in Rules without entering it again.

A full run reads all notebook pages, then highlights and all thought pages for the union of listed and locally known books, supplementing book/author/chapter metadata as needed. Thoughts for one book are saved only after all their pages succeed. Independent books/types may succeed while others fail. An incomplete notebook list is not committed. Sync details show one row per book, with separate highlight/thought counts and error information.

Existing source IDs update content/raw fields; unchanged data does not change the local business-update timestamp. Source creation time is distinct from first local observation. Missing source dates are displayed explicitly. Thought absence follows the two-check process below; highlights retain their prior state. “Read complete” does not guarantee a complete upstream snapshot.

Reads are serialized at least one second apart. Network/5xx/429 reads get at most three attempts. `Retry-After` is respected; a requested delay above 30 seconds ends the current read with a rate-limit/unavailable result. Limits are 30 seconds per request, 32 MiB per response, 30 minutes per run and 10,000 pages. Reaching a limit fails explicitly rather than silently truncating into success.

## Browsing

Library shows 20 notes per page, newest first. Literal substring search covers thoughts, passages, titles and authors; SQLite LIKE is ASCII case-insensitive. Date filters use Beijing time and include both endpoints. Notes with missing source dates do not match date conditions. Details show source ID, timestamps, passage, chapter and original item JSON. Content is rendered as text.

## Backups and restores

There is no UI backup button or online backup job. Use a stopped-service backup:

1. Stop normally and wait for in-flight sync to be marked interrupted and the database closed.
2. Copy the entire `DATA_DIR`, including remaining WAL/SHM files. Keep `SECRETS_DIR/master.key` separately and privately. Backups contain personal notes and encrypted secrets.
3. To restore, stop the application, provide the matching key and use the restore command below. Restrict file access to the deployment account.
4. After startup, review flomo history and rule scope, then clear recovery protection on the Automation page.

A missing/mismatched key prevents credential access; no replacement key overwrites existing secrets. There is no automatic administrator reset or recovery of encrypted old connections after key loss. Keep usable backups. Back up before upgrading. An older application rejects a newer database version; downgrading requires a matching pre-upgrade backup.

## Development

Run `npm ci` and `npm run build`, then use two terminals:

```sh
APP_ORIGIN=http://127.0.0.1:5173 npm run dev
npm run dev:web
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` to port 3000; provider credentials remain server-side. `npm run check` runs types, lint, Node tests and build. Browser tests require built assets and Playwright Chromium.

Browser tests use temporary data and a fake provider on port 4100. The production-entrypoint restart test uses port 4101 without real connections. There is no production demo/arbitrary-provider switch. Tests stop servers and remove temporary databases; synthetic screenshots go into ignored `test-results/`.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Invalid setup token | Read the setup-token file indicated by startup logs on the deployment machine |
| Origin rejected | Match APP_ORIGIN exactly, including scheme/host/port, without trailing slash |
| Expired login | Sign in again; sessions last 12 hours, and password changes revoke all devices |
| Partial sync | Open the run and inspect affected books/types/errors, then retry |
| UPSTREAM_FORMAT / UPGRADE | Provider structure/version changed; a client update is needed, existing data remains |
| UPSTREAM_RATE_LIMIT | Wait before retrying; do not increase concurrency |
| Startup fails | Check port conflicts, a second instance, permissions, matching key and schema version |

The Node process must remain running even without automation to serve the UI. Use your platform's service manager for boot startup. Background scheduling/delivery does not require an open browser.

## Visual rules and preview (M2)

1. Configure connections, complete a successful full sync, then open Rules.
2. Select types, source dates and keywords. Books/authors remain unrestricted. Dates include both days in the rule's valid IANA time zone, default `Asia/Shanghai`. Empty filters impose no restriction; conditions combine with AND.
3. Enter one literal keyword per line. English matching is case-insensitive. Search thoughts, passages or both; include words support any/all, and any exclude match rejects the note. Highlight text lives in the passage field.
4. Output includes book metadata, quoted passage, nonempty thought and automatic book tag. Add optional space-free tags, one per line, with `/` for nesting. Preview matches, exclusions and eligible scope; changing filters clears the old preview.
5. By default, only IDs first observed after activation are new. Existing examples do not enter that scope; later edits do not make an old ID new. To import history, select it and confirm explicitly.
6. Save a draft or enable the rule. Enabling saves policy, not delivery permission. Prepare/review the queue and enable delivery separately on Automation. Preview counts are not sent counts.

Activation requires the latest run to be a successful full read, with a complete notebook list and successful highlights/thoughts for every book, and no sync in flight. This establishes traversal coverage of returned data, not an upstream snapshot/deletion guarantee. If the baseline is insufficient, sync again.

Disabling/re-enabling preserves the baseline, so new IDs observed while disabled may qualify. History scope cannot change after baseline creation; copy the rule instead. Saved connection identities cannot change in place; copies may select current connections. Replacing either connection disables associated rules without moving baselines between accounts. Stale concurrent revisions are rejected.

Each source record gets a preview. Highlights and thoughts can share a passage. Missing fields are explicit and never guessed. No unverified reading links are generated. Text is neither truncated nor split; oversized payloads are blocked during delivery. Across rules, one note/destination task uses the earliest-created matching rule's output. Official record-API length limits remain unverified. Preview scans local notes and returns at most 20 per page; large-scale performance is not yet accepted.

Before upgrading, stop and back up data, keys and the old program. Current migrations advance through schema 6 and preserve connections, notes, rules and sessions. Do not manually change schema numbers to downgrade.

Fixed outgoing text, in either UI language:

```text
《合成书籍（Reading Habits）》 示例作者 · 第一章
> 这里是标记的原文。
📝 想法：这里是自己的思考。
#微信读书/合成书籍（Reading_Habits）
```

Modules use a single newline with no inserted blank lines; source line breaks remain. Preview adds modest CSS paragraph spacing without changing the outgoing text. Empty thoughts are omitted. Leading/trailing passage whitespace is removed only for output; only nonempty passage lines get `> ` and internal blank lines stay ordinary blank lines. Stored source text is untouched. Tag whitespace, `#` and `/` become underscores; the displayed title is unchanged. Missing title/author/chapter/passage is marked. Creation dates are used for filtering, not exported.

Migration 004 removes old book/author restrictions and output switches, replaces the standalone WeRead tag with book tags, and preserves other tags, dates, keywords, baselines and enablement. Revisions increase; sent records and deduplication IDs remain. Preview changed scope before enabling delivery.

## Automation and delivery (M3)

Save settings on Automation. A fresh installation has both switches off; upgrades preserve them. The default interval is 15 minutes, adjustable from 5 minutes to 7 days, or a daily local time with an IANA time zone. Interval schedules calculate from completion; daily schedules handle daylight saving time. Missed runs catch up once without overlapping jobs.

Full mode rereads all notes. Light mode reads changed/new books, books without a successful fingerprint and known books absent from the overview. Failure does not advance fingerprints. A successful full scan at least 24 hours old forces the next scheduled scan to be full. Light scans may miss changes absent from the overview. Manual sync is always full; rule activation still requires a latest successful full run.

Sync failures back off for 1, 2, 4, 8… minutes up to an hour, or use the normal interval if shorter. Authentication failure, required upgrades and explicit rejection pause automatic sync. Review configuration before enabling again. Failed reads never prove deletion.

“Prepare queue from rules” only updates local tasks. With delivery enabled, queue preparation runs every minute, after automatic sync and after rule changes. Rules are checked again before sending. Multiple matches yield one task per note/destination, formatted by the earliest-created rule (ID breaks timestamp ties), with every match/revision retained. Different source IDs remain separate even with identical passages. Source edits do not automatically edit sent flomo notes.

Writes are at least 5 seconds apart. All attempts, including rejected and potentially successful writes, count toward a local rolling 24-hour quota (default 100, adjustable downward). This does not assume the provider's daily reset time or account for other tools. The default 5,000 Unicode-character limit is adjustable application protection, not a verified official API limit. Oversized content is blocked without truncation or splitting.

- HTTP 429: respect `Retry-After`, otherwise wait at least five minutes.
- Proven pre-connect DNS/refusal/connection-timeout failures: exponential backoff, up to five total automatic attempts, then block and pause delivery.
- Write timeout, connection reset, unknown response, HTTP 408/5xx or process interruption: mark that task uncertain; do not auto-resend. Other tasks may continue.
- HTTP 401/403, other definite 4xx or nonzero business code: block and pause; check permissions, content and quota before manually resuming.

Inspect content/attempts and check flomo before marking a task sent or confirming it was not sent and allowing retry. Retry still follows current rules, global cooldown and quotas. Toggling settings and manual recovery do not clear cooldown. Exactly-once delivery is not guaranteed.

Enabled settings survive restart. Delivery waits for a successful full source sync in the new process; failures back off instead of sending the old queue. Interrupted sends become uncertain while other tasks continue. Sent identities, retry counts, quotas, cooldown and persistent operational blocks survive. User-disabled tasks are not enabled automatically. Replacing either connection pauses both automations and cancels unsent tasks. A process manager must keep the service running.

Schema 3 preserves existing notes, rules, baselines, connections and sessions. Upgrade/rollback requires matching data/key/program backups. Restored old data may omit later successful sends; review those before resuming.

## Missing thoughts and deletion checks (0.3.2)

- Every thought check starts from page one. Absence is evidence only if all pages succeed, IDs/cursors are unique, totals are consistent and equal the actual unique count, and any top-level notebook reviewCount agrees. Without totals, observed content updates but unseen old thoughts are held, not inferred deleted.
- First valid absence marks the thought pending review and holds unsent tasks atomically. A second independent complete check marks inferred deletion and cancels unsent tasks. Pages/retries within one run do not count as separate evidence; another book's failure does not invalidate this book's complete check.
- Read/count/pagination errors pause affected imports and reset consecutive absence counts. Already-missing thoughts remain pending. Connection-wide failure/interruption holds related tasks; restarting does not bypass holds or count an interrupted check as evidence.
- At least five missing notes accounting for half or more of a book/valid batch, or at least two previously populated books simultaneously empty, triggers anomaly protection. Keep content, hold imports and do not advance deletion counts. Recheck the source; continuing anomalies stay held, with no forced bypass button.
- Books absent from the overview are still queried by old bookId. Light scans force rechecks for pending/unavailable thoughts; skipped books do not accumulate checks. Full 15-minute polling is appropriate when timely detection matters; light mode can delay the first detection.
- Reappearing IDs become active, clear missing counts and reuse their task identity after rule rematching. flomo cooldown, retries and independent delivery blocks remain; source recovery does not clear destination failures.
- Sent and uncertain history remains unchanged; no flomo content is edited/deleted. A held source prevents retry, but uncertain tasks can still be marked found in flomo. In-flight requests cannot be retracted; manual sync and delivery are mutually exclusive.

Library filters by source state and details show first absence, valid missing-check count and removal timestamp. Delivery history exposes source holds. Deletion is soft; original text, thoughts, IDs and delivery history remain.

## Restart and backup recovery (0.3.3)

The production entrypoint keeps `SECRETS_DIR/delivery-checkpoint.json` separately from the database's instance/checkpoint state. Before each flomo write, it persists and fsyncs the checkpoint, then atomically updates the database checkpoint and started attempt before HTTP. A missing, damaged, ahead-of-database or mismatched checkpoint locks delivery. Ordinary settings saves cannot clear the lock.

Initial checkpoint establishment after upgrading also requires review. A controlled stopped-service upgrade with unchanged data may establish the initial checkpoint after validating old records. Restoring old data requires checking flomo and excluding potentially duplicate history. UI confirmation creates a new checkpoint baseline; it cannot recover lost later sent records.

Stop the application, retain the matching master key and run from the project directory:

```sh
npm run restore -- --from /absolute/path/backup/app.sqlite
```

Restore obtains the instance lock; checks integrity, version, foreign keys and decryption; retains a pre-replacement database copy; replaces the database; and forces recovery protection. After startup, review and confirm on Automation. Confirmation does not turn on disabled switches; enabled delivery resumes after a full sync. Do not bypass this workflow by manually copying over the database.

A whole-device image rollback can roll back both database and checkpoint, which local evidence cannot detect. Use the same restore workflow even if its input has identical content, from another file path. Automatic detection would require an external durable checkpoint, which is not provided.

## Separating source and personal data (0.3.4)

Defaults depend on the account running the application, not the source location:

| Platform | Application-data directory |
| --- | --- |
| Linux | `$XDG_DATA_HOME/weread-flomo` if absolute; otherwise `~/.local/share/weread-flomo` |
| macOS | `~/Library/Application Support/weread-flomo` |
| Windows | `%LOCALAPPDATA%/weread-flomo`; otherwise `AppData/Local/weread-flomo` under the user home |

`data/` holds databases, `secrets/` holds keys/setup/checkpoints, and optional `config.env` holds non-secret startup settings. Create your external directory before copying the example. `DATA_DIR`/`SECRETS_DIR` override locations; absolute paths are recommended. Source-local paths and symlinks back into source are rejected. Created private directories use 700 and database/key files 600; Windows ACLs are the deployer's responsibility. Path selection has cross-platform unit coverage; full process tests currently cover Linux only.

To migrate an older installation:

1. Stop the app while preserving domain/tunnel settings. Back up all data including WAL/SHM, keys and old code outside the source tree.
2. Move the complete old `data/` and `secrets/` externally. Preserve `master.key` and `delivery-checkpoint.json` exactly; do not regenerate keys or move only the main database.
3. Move personal `.env` values into external `config.env` or service environment variables. Update service working directory and data/key paths. Move backups, exports, diagnostics and personal files too; do not leave source-local links to private directories.
4. Verify database records, settings, key and checkpoint agree, then start and check login, schedules and public access. Moving complete current data is not a backup rollback and needs no recovery bypass. Restoring old data still requires restore/review.

A legacy source-local `data/app.sqlite` causes startup/restore to refuse rather than silently initialize an empty database. Restore must use the same external configuration as the running service; service-only environment variables are not inherited by an unrelated terminal.

Run `npm run check` before publishing. Source and tracked-file checks catch private artifacts even if force-added past `.gitignore`. Tests use synthetic data in temporary directories. Publish code/examples only, never external runtime directories, backups, personal screenshots or diagnostics. Pattern checks do not replace reviewing arbitrary personal text and Git history.
