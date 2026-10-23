# WeRead → flomo

[English](README.en.md) · [使用与运维](docs/usage.md) · [产品设计](docs/product.md) · [实施计划](docs/roadmap.md)

为个人自行部署的微信读书工具：保存划线和想法，在浏览器里整理自己的阅读库，并按条件自动导入 flomo。

**当前版本：M3，自动同步与按规则导入。** 已实现管理员登录、连接配置、后台同步、笔记浏览、可视化规则、导入预览和持久化发送队列。自动任务默认关闭，需要在“自动任务”页启用。测试使用合成上游，真实 flomo 写入仍需部署者验证。

## 已实现

- SQLite 持久化保存书籍、作者、划线、想法、对应原文、章节、来源时间及原始字段。
- 微信读书笔记本/想法分页读取、重复同步去重、相同 ID 内容变化更新；任务状态及每本书的失败范围可见。
- 想法首次有效缺失暂停导入，连续两次完整核对仍缺失则标记“已删除（同步推断）”并取消未发送任务；保留内容、已导入记录与恢复能力。
- 浏览器关闭后后台任务继续运行；周期或每日定时同步、完整/轻量模式、失败退避和任务重启恢复。
- 按类型、书籍、关键词、日期筛选；查看原文和原始字段；切换历史连接的数据空间。
- 单管理员、scrypt 密码、持久化会话、Origin/CSRF 校验、登录限速；凭据使用 AES-256-GCM 加密且不回显。
- flomo 专属 API 地址仅校验格式并加密保存，不发送测试记录。
- 按类型、来源日期/时区和包含/排除关键词创建规则（不限书籍、作者）；保存草稿、复制、编辑、启停。
- 分页预览命中/未命中原因、历史处理范围、缺失字段和完整导入文本；固定书籍信息/引用原文/可选想法排版，自动书名标签及额外标签。
- 完整同步后建立新增基准；历史范围须明确确认，连接更换会停用关联规则和自动任务。
- 按已启用规则导入 flomo，跨规则去重，发送前重新匹配；明确失败有限重试，不确定结果人工核对。
- 请求间隔、滚动 24 小时额度、单条字数保护、导入记录与尝试详情；启用设置跨重启保留；发送中断的单条任务待核对，备份恢复需解除保护。

## 本地启动

需要 Node.js **24 LTS** 和 npm（最低兼容 Node.js 22.18）。从 GitHub 克隆源码后运行：

```sh
git clone https://github.com/zhatlas/weread-flomo.git
cd weread-flomo
npm ci
npm run build
npm start
```

打开 `http://127.0.0.1:3000`。首次设置需要读取启动日志所示位置的 `setup-token` 文件，将令牌填入页面，创建自己的管理员账号和至少 12 字符的密码。没有默认账号或默认密码。

先在[微信读书官方接入页](https://weread.qq.com/r/weread-skills)获取自己的 API Key；需要导入时，在 [flomo API 页面](https://help.flomoapp.com/advance/api.html)按官方说明获取专属地址。账号权限与额度以上游提供的实际能力为准。

登录 → 设置 → 填写微信读书 API Key → 检查并保存连接 → 立即同步 → 笔记库。真实 Key 只在页面中填写，不放入仓库。保存时仅执行一次只读笔记本查询；连接成功不等于已经同步全部笔记。

配置访问地址、备份、开发环境及排错见 [使用与运维](docs/usage.md)。当前提供本地 Node 启动方式，Docker/Compose 和公开镜像尚未提供，不是运行本项目的前提。

## 验证

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

`check` 包含类型检查、lint、数据库/安全/同步测试及生产构建。Playwright 覆盖真实浏览器的初始化、连接、同步、筛选、详情、退出/登录及手机布局。全部测试使用合成数据，不访问真实微信读书或 flomo。系统缺少浏览器依赖时使用 `npx playwright install --with-deps chromium`。

具体结果与未验证范围见 [验证记录](docs/testing.md)。

## 使用边界

- 同步范围是官方查询接口可返回的数据。**未收到明确删除事件；想法删除使用两次完整核对推断，界面明确标注依据；划线缺失仍不推断删除。** 不承诺捕获两次读取之间创建后删除的记录。
- 想法仅在接口提供 `abstract` 或能按同一章节和精确范围匹配划线时关联原文；缺失内容明确显示“缺失”，不猜测文本。
- 新 Key 无法可靠证明仍属同一账号，更换凭据会建立独立数据空间并保留旧数据。相同 Key 重复保存复用原连接。
- 串行请求，默认至少间隔 1 秒；30 秒单请求超时；有限重试；整轮最多 30 分钟；单响应最多 32 MiB。以上是项目保护阈值，不是官方额度。
- 真实账号的完整性、接口变更/删除语义和长时间运行仍需部署者验证。当前为早期版本，不承诺 exactly-once；发送期间响应丢失时需人工核对。

## 开发与设计

TypeScript + React/Vite + Fastify + SQLite（better-sqlite3），单实例、单工作区；无外部队列、无项目作者托管服务器、无遥测。

| 文档 | 内容 |
| --- | --- |
| [使用与运维](docs/usage.md) | 启动、配置、备份、开发及故障处理 |
| [产品设计](docs/product.md) | 页面、规则语义和产品边界 |
| [技术架构](docs/architecture.md) | 模块、部署、认证与密钥 |
| [同步设计](docs/synchronization.md) | 完整目标和阶段差异 |
| [数据库设计](docs/data-model.md) | 表结构和数据保留 |
| [M1 迁移](migrations/001.sql) / [M2 迁移](migrations/002.sql) / [M3 迁移](migrations/003.sql) / [规则格式迁移](migrations/004.sql) / [删除核对迁移](migrations/005.sql) / [重启恢复迁移](migrations/006.sql) | 当前运行时实际使用的结构 |
| [完整候选 SQL](design/schema.sql) | 独立的约束设计草案，不用于初始化运行时数据库 |
| [上游依据](docs/upstream.md) | 已确认字段与尚待验证事项 |
| [实施计划](docs/roadmap.md) | 阶段范围和发布标准 |
| [变更记录](CHANGELOG.md) | 已实现变更 |

遵循 [贡献指南](CONTRIBUTING.md) 与 [安全说明](SECURITY.md)。仓库不含个人凭据、笔记、数据库或真实接口录制。与腾讯、微信读书、flomo 均无官方隶属关系。

[MIT License](LICENSE)

运行数据默认保存在当前用户的应用数据目录，源码目录只保存程序。Linux 默认为 `~/.local/share/weread-flomo/`，支持绝对路径的 `XDG_DATA_HOME`；macOS 为 `~/Library/Application Support/weread-flomo/`，Windows 为 `%LOCALAPPDATA%/weread-flomo/`。目录内的 `data/` 保存数据库，`secrets/` 保存密钥。配置文件为该目录下的 `config.env`；也可使用进程环境变量。旧版升级请先按[迁移说明](docs/usage.md#源码与个人数据分离034)迁移数据。
