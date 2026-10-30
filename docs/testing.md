# Validation record

[English](testing.md) · [简体中文](testing.zh-CN.md)

Baseline validation: 2026-10-23, Linux arm64, Node.js 22.18.0, npm 11.6.1 and Chromium 156. Node 24 LTS is recommended; GitHub Actions runs installation, checks, browser tests and dependency audit on Node 24. The actual remote result for each commit is shown in Actions.

## Previously verified baseline

| Check | Result and scope |
| --- | --- |
| TypeScript / ESLint | No type or lint errors |
| Node tests | 87 passed: 8 candidate-SQL tests, 2 repository checks and 77 runtime tests |
| Build | Server compilation and Vite production assets succeeded |
| Playwright | 7 passed: process restart, desktop/mobile library, anonymous/cross-origin protections, rules, automation/manual review, deletion/recovery and backup review |
| Dependency audit | Locked dependencies had no known reported vulnerabilities at that check; this is not a future guarantee |

The 2026-10-26 sync-detail change added a browser regression for per-book grouping, same-title IDs, zero/missing/error results and mobile layout. Its local checks passed all 87 Node tests and 8 browser tests.

Runtime tests cover setup races, password hashing, login/expiry/logout/password revocation, authentication/Origin/CSRF/rate limits, secret encryption/tampering/redaction/replacement, migrations/instance locks/restarts, pagination/deduplication/edits/partial failure, account isolation, exact passage linkage, chapter supplementation, keyword/date filtering, bounded gateway behavior, and shutdown waiting for workers.

Browser flows create a synthetic administrator, save/check connections, sync, inspect runs, browse/filter notes, inspect author/passage/chapter fields, check mobile widths and sign out/in. Synthetic HTML remains text, not executable elements. Browser script errors are collected.

The production-entrypoint test launches compiled `dist/server/main.js` with external temporary configuration. It verifies initialization, closed setup after use, graceful shutdown, persistent credentials/session/master key and accessible assets. Test processes/data are cleaned up.

## Stage coverage

- **M2:** ten backend tests cover AND/any/all/exclude-first rules, literal case-insensitive matching, missing dates, inclusive dates/DST, schema validation, formatting/missing fields, connection roles and CSRF, complete baselines, stable IDs, enablement/copies/revisions/account isolation, pagination and schema migration. Browser tests exercise the complete visual rule workflow, automatic book tags, optional thoughts and mobile layout.
- **M3:** sixteen backend tests cover interval/daily time zones and missed schedules, no overlapping jobs, light/full fingerprints, cross-rule uniqueness, pre-send rematching, sent deduplication, persistent quotas/cooldown/retries/character limits, uncertain outcomes, old backups and schema migration. Sender tests cover allowed destinations, response validation, 429/Retry-After, 4xx/5xx, oversized/unknown responses, network classification and secret redaction. The injected browser sender returns uncertainty first and success later; no real flomo writes occur.
- **0.3.1:** three backend tests cover fixed output, multiline passages, omitted empty thoughts, normalized book tags, extra-tag deduplication and baseline/delivery-preserving rule migration. Whitespace checks prevent orphan quote markers while retaining original internal paragraphs. Preview spacing is CSS only; outgoing modules use one newline.
- **0.3.2:** fourteen backend tests cover first-absence holds, second-check cancellation, stable-ID recovery, untouched sent/uncertain history, retained retries/blocks, counts/cursors/duplicate validation, failed-check reset, absent-book reads, forced light rechecks, anomaly protection, sync/send exclusion, restart recovery and schema 4→5. Browser checks cover holds, inferred deletion, cancellation, identity reuse and mobile overflow.
- **0.3.3:** nine backend tests cover persisted switches/blocks, interrupted sends becoming uncertain, startup full-sync gating/backoff, retries/quota/cooldown/deduplication, missing/ahead/damaged checkpoints, migration baseline, authenticated explicit recovery review, restore locks/key mismatch and forced protection. The browser verifies ordinary settings cannot bypass recovery or turn on previously disabled delivery.
- **0.3.4:** three path tests cover platform defaults, XDG fallback, source-local and symlink rejection, and legacy migration prompts. Production tests use external config/default directories and verify no source-local data/secrets. A force-tracked synthetic database is rejected by repository checks.

Earlier constrained-server browser runs experienced initialization timeouts under swap pressure. The recorded complete baseline passed using Playwright's default Chromium headless shell without weakening assertions/timeouts. Deletion-flow acceptance previously increased that long scenario's timeout to 60 seconds and fixed a selector; the full suite was rerun.

Published-source checks use synthetic fixtures, inspect tracked files and ignore rules, and keep private credential-audit results outside source. Layout checks cover 1920, 1440, 900 and 390 pixels for equal settings cards and the overview button icon.

## Bilingual regression coverage

Validated on 2026-10-30: `npm run check` passed 92 Node tests (11 repository/schema/document checks and 81 runtime tests), types, lint and production build; all 12 browser tests passed. Runtime dependency audit reported zero known vulnerabilities. Source-tree checks also passed against Git-tracked files.

Language tests cover English fallback, Simplified/Traditional Chinese browser locales, manual preference precedence after reload, language switching on authentication and workspace pages, unavailable local storage, document language/title, translated errors/statuses, desktop/mobile layout and unchanged Chinese source content. Catalog checks compare keys and interpolation variables and exercise i18next plural selection. Documentation checks verify paired editions and local links/anchors.

Existing Chinese browser flows explicitly use `zh-CN`; internationalization cases independently set their browser locale. The verification commands below are the source of current results; the baseline counts above are historical, not claims about an unrun future commit.

## Reproduce

```sh
npm ci
npm run check
npx playwright install --with-deps chromium
npm run test:e2e
npm audit --audit-level=high
```

All fixtures and screenshots are synthetic. Browser screenshots are ignored under `test-results/`. Chromium may require browser/system downloads; Chinese screenshots require Chinese fonts. Tests do not contact real WeRead/flomo providers.

## Unverified limits

- Real-account completeness, long-term source changes/deletion consistency, very large libraries and long-running behavior.
- Local acceptance is Linux arm64; Node24/Linux amd64 results depend on Actions. Full Windows/macOS/Docker/NAS deployment is not accepted.
- Real flomo write responses, shared quotas and sustained network-failure behavior. Synthetic providers cover state transitions, not live account guarantees.

Thought deletion remains an inference from complete/count-validated independent checks. Errors cannot prove deletion. No physical source deletion occurs, and highlights are retained.
