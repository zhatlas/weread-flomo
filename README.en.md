# WeRead → flomo

[简体中文](README.md) · [Operations guide (Chinese)](docs/usage.md)

A self-hosted reading workspace for WeRead highlights and thoughts, with rule-based automatic delivery to flomo. MIT licensed; not affiliated with Tencent, WeRead or flomo.

**M3 is implemented:** visual rules/previews, configurable interval or daily synchronization, full/light scans, a durable flomo delivery queue, deduplication and bounded safe retries. Automation is opt-in and initially disabled. The UI remains Chinese.

A note/destination pair has one delivery record across rules. Pending payloads are re-evaluated before sending; already sent notes are never automatically resent. Rate limits and rolling 24-hour request budgets survive restarts. Timeouts, lost responses and interrupted sends require manual verification rather than blind retries.

Enabled source and delivery plans resume after restart. Delivery first waits for a successful full source scan from the current process. Interrupted or ambiguous writes remain uncertain while other tasks continue. An independent durable checkpoint detects database rollback; restoring backups requires explicit review. Whole-device rollback of both database and checkpoint cannot be detected locally. Tests use synthetic providers; live-account behavior and long-running operation remain unverified.

## Run locally

Use Node.js 24 LTS (minimum 22.18) and npm, from the project root:

```sh
git clone https://github.com/zhatlas/weread-flomo.git
cd weread-flomo
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:3000`. Read the `setup-token` file at the location printed in the startup log to complete initial setup. Choose your own administrator username and password (at least 12 characters). There are no default credentials.

Obtain your own key from the [official WeRead integration page](https://weread.qq.com/r/weread-skills) and, for delivery, follow the [flomo API instructions](https://help.flomoapp.com/advance/api.html). Availability and quotas depend on your upstream accounts.

In Settings, enter a WeRead API key, save after the read-only connection check, then start synchronization. Credentials are never returned by configuration queries. The initial UI is in Chinese.

Optional environment settings are listed in [.env.example](.env.example). `APP_ORIGIN` must exactly match the browser origin, without a trailing slash. The default binding is loopback. Use HTTPS when exposing the service beyond your trusted local machine. Docker packaging and published images are not available yet; this version runs directly with Node.js.

## Verify

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

Checks include TypeScript, ESLint, migration/storage constraints, authentication, CSRF, encryption, pagination, repeat synchronization, partial failures, updates, account isolation, and a production build. Browser tests exercise setup, connection settings, synchronization, filtering, details, login/logout, the visual rule workflow and a mobile viewport. All fixtures are synthetic; tests do not contact real providers.

Rules filter by type, dates and keywords, with no book or author restrictions. Imports use a fixed book/author/chapter header, quoted source text, an optional thought paragraph and an automatic `#微信读书/book_title` tag. Whitespace in the tag title becomes underscores; additional custom tags remain supported. Migration 004 preserves activation baselines and delivery deduplication records.

## Data guarantees and limits

- Stores books, authors, highlights, thoughts, associated source text, chapters, timestamps, and raw item fields in SQLite.
- Uses stable source IDs for deduplication and content updates. Failed scopes do not overwrite an incomplete thought collection.
- **Thought deletion is inferred, not a confirmed upstream event.** A first verified absence holds unsent tasks; a second consecutive complete check marks the local thought removed and cancels unsent tasks. Failed/incomplete reads and anomalous drops cannot prove deletion. Source content and successful deliveries remain preserved; highlights are not inferred deleted.
- Changing the key creates a separate source namespace and preserves previous data, because account continuity cannot be verified reliably. Re-saving the same key reuses the connection.
- A started sync continues after the browser closes. Restarted services mark unfinished runs interrupted; the user can run them again.
- Requests are serialized with a one-second minimum gap, bounded retries, a 30-second request timeout, 30-minute run limit, and 32 MiB per-response cap. These are application limits, not claimed provider quotas.
- Missing source text, chapters, authors or timestamps are shown explicitly. Source text is only linked through the upstream abstract or an exact chapter/range match.

Back up the data and independent master-key directories while the service is stopped. Losing the master key makes stored connection credentials unreadable. Do not copy only the main SQLite file while the service is running. No telemetry or centralized service is included.

See [Architecture](docs/architecture.md), [Roadmap](docs/roadmap.md), [Contributing](CONTRIBUTING.md), [Security](SECURITY.md), and [Changelog](CHANGELOG.md).

Runtime data is stored outside the source tree, under the current account: Linux `~/.local/share/weread-flomo/` (absolute `XDG_DATA_HOME` supported), macOS `~/Library/Application Support/weread-flomo/`, Windows `%LOCALAPPDATA%/weread-flomo/`. Its `data/` and `secrets/` subdirectories hold the database and keys. Optional settings are read from `config.env` in that external directory; process environment variables take precedence. `DATA_DIR` and `SECRETS_DIR` can point to other external directories. Source-local paths, including symlink aliases, are rejected. Existing installations must move their old database and secrets while stopped before upgrading; the application refuses to silently create a fresh database when legacy source-local data exists. See [operations](docs/usage.md).
