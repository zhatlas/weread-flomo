# Changelog

## 0.3.4

- 修正设置卡片等宽布局、首页按钮箭头对齐；整理公开部署文档，明确已实现功能与后续规划。

- 默认按本机用户选择源码外的应用数据目录，支持外部 config.env；启动和恢复使用一致的路径规则。
- 拒绝源码内及软链接指回源码的数据库/密钥路径；旧版数据库需显式迁移，不静默创建空库。
- 补充路径、外部配置与重启集成检查，Git 已跟踪的私有文件也参与发布前检查。

## 0.3.3

- Enabled sync and delivery plans survive restarts; delivery waits for a full source scan from the current process.
- Interrupted and ambiguous writes hold only their own tasks, preserving deduplication, quotas and retry state for other tasks.
- Added durable external delivery checkpoints, explicit recovery review and a locked, validated database restore command. Whole-device rollback of all evidence still requires the restore workflow.

## 0.3.2

- Added conservative thought deletion reconciliation: first absence holds pending imports; two consecutive verified complete checks soft-delete locally and cancel unsent tasks.
- Added count/pagination validation, anomaly guards, forced rechecks, interruption recovery and source-state UI/filtering. Source recovery preserves delivery identity and retry accounting; sent/uncertain history is untouched.
- Added schema 5 for source verification metadata and independent delivery holds.

## 0.3.1

- 规则移除书籍和作者限制，统一固定导入格式，非空想法才显示。
- 自动生成书名层级标签，空白转下划线，保留额外自定义标签。
- 迁移旧规则，保留历史基准和导入去重记录。

## 0.3.0 — M3

- Added persistent opt-in interval/daily schedules, timezone handling, full/light scans with periodic full reconciliation, and source failure backoff.
- Added a durable rule-based flomo queue, note/destination deduplication, current-rule payload checks, request pacing, rolling request budgets and configurable content protection.
- Added conservative webhook response handling, bounded retries only for known pre-connect failures/rate limits, and explicit manual resolution for uncertain writes.
- Added automation settings, paginated delivery records and attempt details. Starting the service pauses delivery, including after old-backup restoration; source schedules recover.
- Added schema version 3 and synthetic scheduler, sender, recovery and browser tests. Live flomo writes and long-running real-account behavior remain unverified.

## 0.2.0 — M2

- Added visual rule drafts, copying, revision-checked editing, enabling and pausing with existing encrypted connections.
- Added one server-side matcher for note kind, local date/timezone, book IDs, authors and literal any/all include/exclude keywords, including DST boundaries.
- Added paginated matching/rejection previews, missing-field explanations, output field toggles, tags and full plain-text previews.
- Added complete-scan activation baselines, explicit historical inclusion and connection-replacement isolation. Pausing preserves the baseline; copies establish their own.
- Added a non-destructive M1-to-M2 SQLite migration and synthetic backend/browser regression coverage.
- M2 performs no flomo writes or queue creation. Scheduling, delivery deduplication, destination length/limit validation and recovery remain M3 work.

## 0.1.0 — M1

- Added a local TypeScript/React/Fastify application and SQLite runtime migration.
- Added protected administrator setup, login/logout, password changes, expiring sessions, Origin/CSRF checks and authentication rate limits.
- Added encrypted WeRead/flomo settings, a read-only WeRead connection check, and separate data namespaces on key replacement.
- Added manual background synchronization with pagination validation, upserts, raw item retention, bounded requests, run details and interruption recovery.
- Added a responsive notes library with book/type/keyword/date/source filters and note details.
- Added synthetic storage, security, provider, sync and browser tests, locked dependencies and CI checks.
- M1 deliberately retains records absent from later reads. Source deletion semantics, automatic scheduling, rules and flomo delivery remain future work.
