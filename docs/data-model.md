# 数据模型

[候选 SQL](../design/schema.sql) 是完整目标的设计验证结构。[M1 迁移](../migrations/001.sql) 与 [M2 迁移](../migrations/002.sql) 是当前运行时结构，使用 SQLite user_version 管理版本；包括 connections、books、sync_runs、notes、admin、sessions、secrets、sync_items 和 rules。[M3 迁移](../migrations/003.sql) 加入 automation、job_state、book_scans、deliveries、delivery_attempts。

| 表 | 责任 |
| --- | --- |
| connections | 来源/目标连接身份、活动状态、secret 引用；不保存明文密钥 |
| books | 每个来源账号的书籍资料及原始 JSON |
| sync_runs | 每次扫描状态、完整性、统计及脱敏错误 |
| notes | 划线/想法当前状态、原文、章节、定位、来源与本地时间、原始 JSON |
| rules | 可视化配置、修订号、启用状态、起始基准 |
| deliveries | 每条笔记到目标的唯一导入任务及发送快照 |
| delivery_attempts | 每次请求的状态及脱敏结果，用于异常恢复 |
| job_state | 持久化周期、下一次到期时间和最近运行状态 |

所有时间使用 UTC Unix 毫秒；微信读书秒级字段在适配层显式乘 1000，同时 raw_json 保留原值。UI 在所选时区显示日期。source_created_at 与 first_seen_at 分开，source_updated_at 允许缺失，不能拿本地采集时间伪装成来源修改时间。

notes 唯一键为 `(connection_id, book_id, kind, source_id)`。想法与划线可以引用同一段原文，但独立保存。书籍资料通过 books 关联；每条想法仍存自己的原文和章节，以防后续划线被删除。

原始 JSON 指接口返回的数据，不代表整个微信读书账号的所有信息或图片文件。raw_json 可能含个人内容，必须纳入备份和数据目录权限管理；不进入 Git、测试 fixture 或日志。

派生内容 hash 用于判断是否变化；updated_at 是本地业务数据最后变化时间，last_seen_at 是最后看见时间。无变化时只推进 last_seen_at。

SQLite 开启 foreign_keys；生产已启用 WAL + busy_timeout。网络请求不占用长写事务，先完成一书一类型的读取校验，再在短事务里应用更新。API 请求结果、缺失确认和扫描成功标记不能以会互相矛盾的顺序提交。

规则内容为版本化 JSON，由服务端运行时 schema 验证；SQLite 的 json_valid 只校验 JSON 语法，不替代业务字段校验。多规则只产生一个 note/destination 任务，保存所有命中规则及其修订快照用于解释。

候选 SQL 约束基本唯一性、引用与状态字段一致性；连接是否为正确 provider、规则基准是否属于当前来源且完整成功、状态转换是否合法，需要服务层在事务中验证，不能把 SQL 测试通过当成这些流程已实现。

首版不实现任意历史版本回放；保留当前记录、软删除状态、发送快照和运行审计，避免为尚未提出的需求引入完整事件存储。

## M2 运行时规则结构

生产迁移顺序为 `001.sql` → `002.sql` → `003.sql` → `004.sql` → `005.sql` → `006.sql`。完整候选 SQL 是独立的约束设计草案，不用于直接初始化运行时数据库。当前 rules 保存带 `schemaVersion: 2` 的严格配置 JSON、连接外键、启停状态和递增 revision。日期时区、筛选条件、历史模式与输出选项保存在该 JSON；修订冲突返回 409。

首次启用在事务中校验连接角色及当前状态、最近完整成功扫描的覆盖范围，并记录 `baseline_run_id`、`activated_at` 与该来源 `baseline_note_id` 最大本地 ID。无硬删除的当前存储模型下，后续首次入库 ID 大于此边界才算新增；修改不改变 ID。以后若增加硬删除/数据重建，必须保留单调 ID 或迁移为显式基准成员关系，不能复用已删除 ID 破坏语义。0.3.3 将启用设置与运行阻塞原因分开；正常启动保留设置，恢复旧备份需要管理员核对后解除保护。

规则连接身份不可原位更换；已建立基准的历史模式不能原位改变，复制规则建立自己的基准。停用保留原基准。连接替换在同一事务内停用相关规则并增加修订号。预览只读取本地数据，不读回凭据、不调用上游、不产生发送记录。

## M3 队列与任务状态

配置采用修订校验；计划时间、上次结果和失败次数保存在 job_state。写入冷却时间独立保存在 automation.delivery_cooldown，不能通过启停或手动重试清空。book_scans 只在该书完整读取成功后保存概览指纹。

发送事务先保存 sending 状态和 started 尝试（含文本及规则快照），提交后再请求 flomo。响应处理在另一事务更新状态。数据库唯一键 `(note_id, destination_id)` 防止规则重叠或重复同步生成重复任务；sent 和 uncertain 不被重建队列覆盖。启动恢复将 sending/started 转为 uncertain，仅暂停对应任务；其他任务在本次启动后的完整同步成功后继续。配额从持久化尝试表计算滚动 24 小时窗口，不依赖进程内计数。

[迁移 004](../migrations/004.sql) 将版本 1 规则转换为固定格式，移除书籍/作者条件和输出字段开关，保留额外标签（独立微信读书根标签由自动书名标签替代）。规则 ID、历史基准、启停状态、导入记录和尝试快照保留；规则 revision 增加，旧页面提交须刷新。

[迁移 005](../migrations/005.sql) 添加 notes.first_missing_at、removed_at、last_checked_run_id、source_error_code 和 deliveries.source_hold，沿用既有 status/missing_scans/removal_basis。状态与任务挂起/取消在同一事务中提交；sent/uncertain 不参与来源任务变更。UI 的 held 是未发送任务带 source_hold 时的展示状态，不替换原来的发送/重试状态。

0.3.3 的 [迁移 006](../migrations/006.sql) 增加 `automation.sync_block`、`delivery_block`，与用户开关独立保存；`recovery_state` 保存实例、发送检查值和恢复锁。检查文件单独保存于生产入口的 `SECRETS_DIR`，不包含账号密钥或笔记内容。
