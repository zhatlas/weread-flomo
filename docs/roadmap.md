# Roadmap and open-source release

[English](roadmap.md) · [简体中文](roadmap.zh-CN.md)

## Preparation completed

Product boundaries, pages/rules, single-service deployment, persistent scheduling/delivery design, executable candidate SQL with offline tests, MIT licensing, English/Chinese documentation, contribution/security guidance, Issue/PR templates and basic CI are available.

The current release is the M1–M3 self-hosted Node application. Docker packaging and public images are not provided.

## M1: local data and visual foundations

Implemented: TypeScript project, pinned dependencies, SQLite migrations, protected administrator setup/login, connections, read-only client, library and status views. See [Operations](usage.md). Tests are synthetic; real-account edit/deletion contracts and sustained large-scale operation still need validation.

Acceptance covers UI connection setup, complete pagination/visible failure scopes, restart persistence, no duplicate records on repeated sync, no saved credential disclosure in logs/query APIs, and authentication/CSRF checks.

## M2: rules and preview

Implemented: type/date/keyword filters, fixed output, drafts/copies/revision-checked editing/enablement, time-zone conversion, baselines and paginated preview. No unverified reading links. Preview and execution share date/keyword/missing-field/revision semantics on the server.

M2 itself does not deliver or enqueue. M3 handles cross-rule deduplication and historical execution. Acceptance requires preview/outgoing consistency, no tasks for disabled rules, no automatic history dump on initial synchronization and no duplicate tasks from overlapping rules.

## M3: scheduling and flomo

Implemented: configurable interval/daily schedules, full/light scans, persistent queue, cross-rule deduplication, request budgets/backoff and manual review. Enabled plans survive restart; delivery waits for a complete source check. Ambiguous writes pause only the affected task. Independent checkpoints protect old-database recovery.

Acceptance covers operation after browser closure, process restart recovery, no blind resend after crashes, edits affecting unsent tasks, visible authentication failures, rate limits without lost tasks and old-backup protection. Synthetic providers validate behavior; real writes and long-running real-account operation remain unverified.

## Bilingual interface and documentation

English is the default GitHub documentation edition, with Chinese links on each page. The interface selects Chinese for Chinese browser locales and English otherwise, unless the user saved an explicit choice. Translations are separate i18next JSON resources. Source notes and outgoing memo text stay unchanged. See [Localization](localization.md) for contributions and verification.

## M4: optional deployment simplification

Future work may add Dockerfile/Compose, multi-architecture images and synthetic demo screenshots. Keep Node startup, initialization, upgrade and backup documentation current. Publish runnable commands/image links only after end-to-end acceptance.

Candidates need Linux amd64/arm64 deployment checks, migrations/restores, offline recovery, reboots, first setup and daily usage validation. Demo data must be synthetic.

## GitHub release preparation

- Repository `weread-flomo`, default branch `main`, MIT; retain contributor copyright.
- Do not use Tencent/flomo official logos or imply official endorsement.
- Enable private vulnerability reporting; see Security.
- Actions run offline checks with no production secrets. Do not execute contributor code through `pull_request_target`.
- Commit lockfiles, maintain dependency/vulnerability checks, pin Actions and use minimal permissions. Any future image release should include an SBOM and third-party license review.
- Scan release files and Git history for personal notes, databases, authorization headers and credential-bearing URLs.
- Future image publishing should use version tags. Describe implemented features and known limits honestly, not roadmap items as shipped.

Docker/Compose improves deployment convenience but is not a prerequisite for open source. Prioritize cross-platform validation, long-term reliability and upstream response checks according to actual needs.
