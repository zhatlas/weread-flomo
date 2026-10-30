# Product and visual settings

[English](product.md) · [简体中文](product.zh-CN.md)

This is the full product design. M2 implements connections, manual sync, overview, library, rule editing/activation/preview and administrator settings. M3 adds scheduling, delivery history, retries and manual review. Unverified reading links are not generated. See [Operations](usage.md) for current behavior and limits.

## Users and scope

For GitHub users who want to synchronize their personal WeRead notes to flomo using their own filters. Each instance has one administrator, one workspace and one active connection per provider. General-purpose means configurable and self-hostable, not multi-user registration, public hosting, an arbitrary plugin platform or user code execution.

The application covers connections, browsing, rules, preview, automatic sync and error handling. It uses public official APIs and keeps data/credentials on equipment controlled by the deployer.

## First use

1. Start the service and create an administrator through protected setup.
2. Enter a WeRead API Key and run a read-only connection check. Later views show configuration status/time, not the key.
3. Read all accessible notes, with per-book results and visible failures. Sync details combine highlight/thought counts into one row per book ID.
4. Save the personal flomo API address. Format validation does not send a test note; there is no separate live-send test button.
5. Create rules and preview counts, samples, missing fields and final outgoing text.
6. Choose new-only or explicitly include matching history, then enable the relevant rules and delivery after reviewing scope and request budgets.

Importing history locally does not mean sending it to flomo. Disabled rules create no delivery tasks. Initial synchronization must finish before a new-note baseline can be established, so unread historical IDs are not misclassified as new.

## Pages

| Page | Contents and actions |
| --- | --- |
| Overview | Recent syncs, counts, mode and failures; manual sync |
| Library | Book/type/date/keyword/source-state search; thoughts, passages, chapter, author, IDs and raw fields |
| Rules | Create, edit, copy, disable; matching/exclusion previews and history scope |
| Automation | Schedule/mode/time zone, enablement, next runs, quotas and recovery protection |
| Delivery history | Queued/sent/retry/uncertain/cancelled tasks, outgoing text, redacted results and permitted resolution actions |
| Settings | Connections and administrator password |

The interface distinguishes successful checks with no additions, partial failures, missing configuration and potentially stale data. Zero is not a substitute for missing fields. User/API content is text, never arbitrary HTML.

English and Chinese labels are separate resources. Browser language is the default; a saved manual choice takes priority. Chinese regional/script variants select the current Simplified Chinese edition. Language changes do not translate source data, rule names, keywords, tags or outgoing notes, and do not alter schedule time zones. See [Localization](localization.md).

## Rule semantics

Conditions inside a rule combine with AND. Included keywords support any/all; any enabled matching rule may enqueue a note, but one source note/destination has one task.

| Condition | Meaning |
| --- | --- |
| Type | Highlights and/or thoughts; thoughts include personal chapter comments and book reviews exposed by the API |
| Date | Source creation time; inclusive local dates converted to `[start, nextDay(end))` |
| Include keywords | Search thought body, passage or both; each word may match any selected field, then combine by any/all |
| Exclude keywords | Any match in any selected field rejects the note, before include checks |

Keywords are literal substrings, not regex or scripts. English matching is case-insensitive; Chinese matches literal text. Blank keywords are removed and empty filters impose no restriction. Missing creation times fail date filters with a visible explanation.

Rules default to `Asia/Shanghai`, accept valid IANA zones and save revisions. Preview and delivery share one server-side matcher; frontend calculations are not authoritative.

## New notes, history and edits

- New-only means source IDs first observed after a complete baseline, not source creation dates.
- First observation after account replacement, reinitialization or old-backup restoration must not silently become routine new-note delivery.
- Edits increment rule revisions. Pending tasks are matched again before sending and cancelled if no enabled rule matches.
- Successful sends are not repeated after rule edits; retries also obey current rules.
- Historical inclusion requires an explicit choice. Preview and queue inspection expose the intended scope and deduplicated tasks.

## Output template

Books and authors are unrestricted. The fixed structure is a book/author/chapter header, quoted passage and nonempty thought (`📝 想法：…`), joined by single newlines without extra blank lines. Original internal line breaks remain. An automatic `#微信读书/book_title` tag is followed by extra tags. Whitespace, `#` and `/` in the tag's title become underscores; the displayed title remains unchanged. No creation timestamp is added.

Preview adds modest CSS paragraph spacing without adding blank lines to outgoing text. Missing passages/chapters are marked, not fabricated. The outgoing template is independent of UI language so browsing in English cannot silently change stored queue payloads or tags.

There is no template execution language. Oversized content is blocked with an explanation, not silently truncated or split. One source record creates one memo; choosing both highlights and thoughts can produce separate notes with the same passage.

## Understandable controls

“Sync now” updates the local library. Queue preparation updates local tasks; delivery requires its own enablement. Pausing prevents new tasks from starting but cannot withdraw an in-flight request, which must finish or become uncertain. Local edits/deletion do not automatically edit/delete flomo content.

Acceptance: connection setup, preview and schedules require no manual config editing; jobs continue after the browser closes; mobile layouts expose status/controls; forms support keyboard navigation, explicit labels and error feedback. Language switching preserves in-progress forms and open views.
