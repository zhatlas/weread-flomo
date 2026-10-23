# 上游契约与验证记录

资料核对日期：2026-10-22。下列事实来自公开文档；个人账号响应、密钥和真实笔记不作为开源 fixture。

| 事项 | 当前依据 | 实现要求 |
| --- | --- | --- |
| 微信读书网关 | POST `https://i.weread.qq.com/api/agent/gateway`，Bearer Key，顶层 api_name/skill_version/业务参数 | 凭据仅服务端使用，参数不包在 params 中 |
| 版本 | SKILL.md 当前为 1.0.5；README 可能滞后 | 固定已验证版本；upgrade_info 暂停并提示升级，不执行服务器返回的任意命令 |
| 笔记本 | count + lastSort；hasMore | 不把 count 默认值当最大值，不使用 offset |
| 想法 | bookid 小写；synckey 分页；abstract/range 可能缺失 | 类型/分页校验，缺失原文明确展示 |
| 划线 | bookmarklist 返回 updated，含颜色/原文/章节信息 | 不把 updated 名称当成增量保证；书签不在内容导出范围 |
| 删除和修改 | 文档没有完整承诺 | 0.3.2 想法按完整分页和总数校验、两次独立缺失推断删除；标注 inferred_absence，未承诺上游确认删除；划线不推断删除 |
| 推送与限流 | 未找到官方 webhook、明确 QPS/日配额 | 轮询，限制请求频率，处理实际限流 |
| flomo | 官方记录 API；文档注明每天 100 条 | 持久化队列与限额，不把 URL Scheme 的长度限制当成 API 限制 |
| flomo 写入响应 | 登录后个人 API 页面才能确认完整契约 | 实现前验证成功/错误返回、远端 ID、长度、限流和时区 |

## 首次集成需要验证

- 空列表和错误响应的差别；书籍不可访问时的响应。
- 超过一页想法的分页终止和游标行为。
- 新划线、删除划线、改变样式、发布/删除想法后的 ID、计数、sort 和返回变化。
- 客户端是否支持修改想法以及读取接口中的结果；不依据非官方 SDK 推断全部 App 行为。
- 只有一条笔记的书删除最后一条后，是否仍可通过旧 bookId 查到空的完整列表。
- flomo 成功判定、明确失败与不明确结果的区分、额度重置规则。

所有真实账号测试由部署者使用专门测试内容执行；CI 使用合成 fixture，不调用写接口。记录结论和脱敏结构，不保留凭据或真实用户内容。

## 来源

- [微信读书官方接入页](https://weread.qq.com/r/weread-skills)
- [微信读书调用规范](https://github.com/Tencent/WeChatReading/blob/main/skills/SKILL.md)
- [微信读书笔记字段与分页](https://github.com/Tencent/WeChatReading/blob/main/skills/notes.md)
- [flomo API 入口](https://help.flomoapp.com/advance/api.html)
- [flomo API 日写入额度](https://help.flomoapp.com/basic/import.html)
- [flomo MCP 能力](https://help.flomoapp.com/advance/mcp/)：不同于普通记录 API，不混用两种接口的承诺。

## M3 记录 API 适配边界

2026-10-22 只读核对官方帮助页及 [flomo 官方网页](https://v.flomoapp.com/mine/) 的公开静态脚本：提供个人 `/iwh/` URL 和 JSON `content` 的 POST 开发示例；公开帮助页注明每天 100 条。适配器发送 `{content}`，不使用私有账号 API 或 MCP。

成功适配采用 2xx 且数值 `code: 0`，只保存受限格式的 id/slug；该判定遵循官方前端的响应惯例，尚未用用户真实 webhook 验收。未知 JSON、非预期成功格式、5xx、超时等视为结果不确定，不假定失败后自动重发。非零业务码暂不猜测具体含义，统一阻塞待检查；原始响应、上游错误消息及带凭据 URL 不写入日志或查询结果。

官方 URL Scheme 的 5000 字限制不作为记录 API 契约。本应用默认 5000 字为可调整保护值，滚动 24 小时预算为保守本地限制；真实账号额度共享、API 字数上限和响应契约仍待部署者验收。
