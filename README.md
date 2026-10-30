# WeRead → flomo

[English](README.md) · [简体中文](README.zh-CN.md)

A self-hosted workspace for WeRead highlights and thoughts. Keep your reading library locally, browse it in your browser, and automatically send selected notes to flomo. MIT licensed; not affiliated with Tencent, WeRead or flomo.

**Current scope: M1–M3 are implemented.** Administrator login, encrypted connections, background synchronization, notes, visual rules, import previews, persistent schedules and a durable delivery queue are available. Automation is initially disabled and must be enabled on the Automation page. Tests use synthetic providers; real flomo writes require validation by the deployer.

## Languages

The interface supports **English and Simplified Chinese**. On first use, the browser's primary language selects Chinese for any `zh` locale, including Traditional Chinese; all other languages select English. The language selector is available before and after login. A manual choice is saved in this browser and takes priority on subsequent visits.

Book titles, authors, passages, thoughts, saved rule names and tags stay unchanged. Changing the interface language does not change the flomo output template or queued text. Translation resources live in `src/web/locales/en.json` and `src/web/locales/zh-CN.json`; see the [localization guide](docs/localization.md) to add a language. Every guide below has a Chinese counterpart linked at its top.

## Features

- SQLite stores books, authors, highlights, thoughts, associated passages, chapters, source timestamps and raw API fields.
- Paginated notebook/thought reads, source-ID deduplication, updates to existing IDs, and per-book sync details with highlight and thought counts on one row.
- A first verified missing thought pauses unsent imports. Two consecutive complete checks infer deletion and cancel unsent tasks, while retaining content, sent history and recovery ability. Missing highlights are retained.
- Background tasks continue after the browser closes. Interval/daily schedules, full/light scans, backoff and restart recovery are persistent.
- Search by book, type, date and keywords; inspect original API fields and switch between current and previous connection spaces.
- One administrator, salted scrypt passwords, persistent sessions, Origin/CSRF checks and login rate limits. Credentials use AES-256-GCM and are never returned by settings queries.
- Saving a flomo API address validates its format and encrypts it without sending a test note.
- Visual rules support note type, source dates/time zones, include/exclude keywords, drafts, copies, editing, enabling and disabling. Books and authors are unrestricted.
- Paginated previews explain matches, exclusions, scope and missing fields. The fixed output includes book information, quoted passage, an optional thought, an automatic book tag and optional extra tags.
- Activation requires a successful full-sync baseline. Including historical notes requires confirmation. Replacing connections disables associated rules and automation.
- Rule-based delivery deduplicates across rules and rechecks content before sending. Definitely unsent failures have bounded retries; ambiguous outcomes require manual review.
- Request pacing, rolling 24-hour budgets, character safeguards and attempt history persist. Enabled settings survive restarts; interrupted sends wait for review, and backup restores require explicit recovery review.

## Run locally

Install Node.js **24 LTS** and npm (minimum compatible Node version: 22.18), then run:

```sh
git clone https://github.com/zhatlas/weread-flomo.git
cd weread-flomo
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:3000`. Read the `setup-token` file at the location printed in the startup log. Create your own administrator username and a password of at least 12 characters. There are no default credentials.

Get your key from the [official WeRead integration page](https://weread.qq.com/r/weread-skills). For delivery, follow the [flomo API instructions](https://help.flomoapp.com/advance/api.html). Permissions and quotas depend on your upstream accounts.

Sign in → Settings → enter your WeRead API Key → Check and save connection → Sync now → Library. Enter real keys only in the application, never in the repository. Saving a connection makes one read-only notebook request; it does not synchronize all notes.

See [Operations](docs/usage.md) for access addresses, configuration, backups and development. This release runs directly with Node.js. Docker/Compose packaging and published images are not yet provided.

## Verify

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

`check` runs type checking, lint, database/security/sync tests and a production build. Browser tests cover initialization, connections, synchronization, filtering, details, login/logout, rules, automation, recovery and language selection. All test data is synthetic; no real WeRead or flomo services are contacted. If browser system dependencies are missing, use `npx playwright install --with-deps chromium`.

See [Testing](docs/testing.md) for coverage and unverified limits.

## Boundaries

- Synchronization is limited to data returned by the official query API. **No confirmed deletion events are received.** Thought deletion is inferred from two complete checks; highlight deletion is not inferred. Notes created and removed between polls may never be seen.
- Thoughts link to passages only through an API `abstract` or an exact chapter/range match. Missing content is marked rather than guessed.
- Different keys cannot reliably prove account continuity. Replacing a key creates a separate space and preserves old data; saving the same key reuses the existing connection.
- Reads are serialized, normally at least one second apart, with a 30-second request timeout, bounded retries, a 30-minute run limit and a 32 MiB response cap. These are application safeguards, not official quotas.
- Real-account completeness, upstream changes/deletion semantics and sustained large-scale operation still need deployer validation. Exactly-once delivery is not promised: an ambiguous write requires review.

## Development and documentation

TypeScript + React/Vite + Fastify + SQLite (`better-sqlite3`), one instance and one workspace. No external queue, author-hosted backend or telemetry.

| Document | Contents |
| --- | --- |
| [Operations](docs/usage.md) | Startup, configuration, backups, development and troubleshooting |
| [Product design](docs/product.md) | Pages, rule semantics and boundaries |
| [Architecture](docs/architecture.md) | Modules, deployment, authentication and secrets |
| [Synchronization](docs/synchronization.md) | Read, deletion and delivery state machines |
| [Data model](docs/data-model.md) | Tables and retention |
| [Localization](docs/localization.md) | Language selection and translation contributions |
| [Upstream contracts](docs/upstream.md) | Verified fields and remaining uncertainties |
| [Roadmap](docs/roadmap.md) | Implemented stages and future deployment work |
| [Changelog](CHANGELOG.md) | Implemented changes |

The runtime schema is defined by migrations [001](migrations/001.sql), [002](migrations/002.sql), [003](migrations/003.sql), [004](migrations/004.sql), [005](migrations/005.sql) and [006](migrations/006.sql). The [candidate SQL](design/schema.sql) is an independent design/constraint model, not the runtime initializer.

Read [Contributing](CONTRIBUTING.md) and [Security](SECURITY.md). The repository contains no personal credentials, notes, databases or real authenticated API recordings. [MIT License](LICENSE) · [中文许可参考译文](LICENSE.zh-CN.md).

Runtime data is stored outside the source tree under the account running the process: Linux `~/.local/share/weread-flomo/` (absolute `XDG_DATA_HOME` supported), macOS `~/Library/Application Support/weread-flomo/`, Windows `%LOCALAPPDATA%/weread-flomo/`. Its `data/` and `secrets/` directories contain the database and keys; optional configuration is read from `config.env`. See [migration instructions](docs/usage.md#separating-source-and-personal-data-034) before upgrading an older installation.
