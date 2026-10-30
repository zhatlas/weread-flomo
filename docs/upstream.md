# Upstream contracts and validation notes

[English](upstream.md) · [简体中文](upstream.zh-CN.md)

Source review date: **2026-10-22**. The following reflects that review of public documentation, not a claim that provider contracts cannot change. Personal account responses, credentials and real notes are not open-source fixtures.

| Topic | Evidence at review time | Implementation requirement |
| --- | --- | --- |
| WeRead gateway | POST `https://i.weread.qq.com/api/agent/gateway`, Bearer Key, top-level api_name/skill_version/business arguments | Use credentials server-side; do not nest arguments in params |
| Version | SKILL.md reported 1.0.5; README may lag | Pin a verified version; pause on upgrade_info, never execute returned commands |
| Notebooks | count + lastSort, hasMore | Do not treat default count as maximum or use offset |
| Thoughts | Lowercase bookid, synckey pagination, abstract/range may be absent | Validate types/pagination and show missing passages explicitly |
| Highlights | bookmarklist returns updated with style/text/chapter fields | The name updated is not an incremental guarantee; bookmarks are outside content export scope |
| Edits/deletions | No complete public contract | Infer thought removal only after two independently complete/count-validated absences; mark inferred_absence; do not infer highlight deletion |
| Push/rate limits | No verified official webhook, QPS or daily read allowance found | Poll conservatively and handle actual limit signals |
| flomo | Official record API; docs state 100/day | Persistent queue/local quota; URL Scheme limits are not record-API limits |
| flomo write responses | Full personal API instructions require login | Validate success/errors, remote IDs, length/rate limits and reset time zone |

## First live integration checks

- Distinguish empty lists from errors, including inaccessible books.
- Verify multi-page thought termination/cursors.
- Observe IDs, counts, sort and responses after adding/removing highlights, changing style and publishing/editing/deleting thoughts.
- Verify client editing capability and query results directly, not through assumptions from unofficial SDKs.
- After the last note disappears, check whether the old bookId still returns a complete empty list.
- Verify flomo success, definite/ambiguous failure and quota reset semantics.

Deployers perform live checks with dedicated test content. CI uses synthetic fixtures and no real writes. Record conclusions and redacted structures, not credentials or private content.

## Sources

- [Official WeRead integration](https://weread.qq.com/r/weread-skills)
- [WeRead invocation specification](https://github.com/Tencent/WeChatReading/blob/main/skills/SKILL.md)
- [WeRead note fields and pagination](https://github.com/Tencent/WeChatReading/blob/main/skills/notes.md)
- [flomo API](https://help.flomoapp.com/advance/api.html)
- [flomo daily import quota](https://help.flomoapp.com/basic/import.html)
- [flomo MCP](https://help.flomoapp.com/advance/mcp/): distinct from the ordinary record API; do not transfer guarantees between them.

## M3 adapter boundaries

The 2026-10-22 read-only review covered official help and public static scripts from the [official flomo web app](https://v.flomoapp.com/mine/). They show a personal `/iwh/` URL and JSON `content` POST example; help states 100/day. The adapter sends `{content}`, not private account APIs or MCP.

Success requires 2xx and numeric `code: 0`, saving only a constrained ID/slug. This follows official frontend response conventions but has not been accepted against the user's real webhook. Unknown JSON, unexpected success formats, 5xx and timeouts are uncertain, never assumed safely retryable. Nonzero business codes are blocked for review without guessed meanings. Raw responses, upstream messages and credential-bearing URLs do not enter logs/query output.

The URL Scheme's 5,000-character limit is not treated as a record-API contract. This app's adjustable 5,000-character safeguard and rolling 24-hour budget are conservative local policy. Shared-account usage, real API length limits and response behavior remain deployer validation tasks.
