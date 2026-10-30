# 技术架构与部署

[English](architecture.md) · [简体中文](architecture.zh-CN.md)

## 选型与实现范围

采用 TypeScript，前端 React + Vite，后端 Node.js + Fastify（推荐 24 LTS，兼容最低 22.18），数据库 SQLite。M3 已实现认证、连接、后台同步、笔记浏览、规则和持久化自动任务/发送队列，依赖及 lockfile 已固定。Docker 打包仍属后续阶段。

M1 采用 better-sqlite3，使用 WAL、busy_timeout、外键、事务迁移与 SQLite 独占锁文件。候选 SQL 测试继续使用 Node 内置 SQLite。当前完成 Linux arm64 本地验证，跨平台镜像与在线备份 API 的验收留在 M4；M1 使用停机备份。

## 单服务模块

```mermaid
flowchart LR
  UI[React 设置界面] --> API[Fastify 同源 API]
  API --> DB[(SQLite)]
  API --> JOB[持久化任务调度]
  JOB --> WR[微信读书客户端]
  WR --> DB
  DB --> RULE[规则匹配与预览]
  RULE --> OUT[数据库发送队列]
  OUT --> FLOMO[flomo 客户端]
  FLOMO --> DB
```

代码按前端、后端和共享规则契约组织。后端划分 provider 客户端、归一化、存储、规则、调度、发送与认证模块；它们是同一程序中的普通模块，首版不引入 Redis、消息代理或微服务。

前端只调用项目后端，绝不直接携带第三方凭据访问上游。TypeScript 类型不能验证网络响应，API 边界必须有运行时结构校验；未知字段保存在 raw JSON，不从字段名猜测含义。

## 部署

当前直接运行 Node.js，由同一进程提供构建后的静态页面、API、同步和发送任务。运行命令为 `npm ci`、`npm run build`、`npm start`，常驻运行可交给 systemd 等系统服务管理器。浏览器关闭不会停止后台任务。

数据库、密钥与可选配置默认保存在当前账号的外部应用数据目录；具体路径、环境变量与迁移步骤见[使用与运维](usage.zh-CN.md)。单实例、单数据库写入者；检测到同一数据目录已有活动实例则退出。

默认只监听 loopback。公网访问由部署者配置 HTTPS 反向代理或隧道，并使 `APP_ORIGIN` 与浏览器地址一致。ngrok、Cloudflare 等隧道不是应用运行依赖，也不包含用户专属域名或令牌。

Dockerfile、Compose 和多架构镜像尚未提供，属于可选的后续部署工作；不能把目标容器设计当成已发布功能。

## 调度

数据库记录 job 的间隔、下次到期时间、启用状态及最近结果。内存定时器只负责唤醒；重启后从数据库恢复，不能把 setInterval 当成唯一任务状态。

同步与队列发送分别持有状态；同步失败不清空已有待发送任务。运行中的同类任务不重叠；手动触发复用相同锁。停机错过多轮时恢复后补跑一次，不把所有错过的周期堆成请求风暴。

自动任务默认关闭，周期配置默认 15 分钟，允许 5–10,080 分钟或指定每日时刻。界面提供 full/light 模式；light 模式距离上次完整成功读取超过 24 小时时，下次调度使用 full。启动后导入先等待一次完整成功同步。同类任务不重叠，不代表上游允许相同的请求频率。

网络请求有超时；读请求采用有限次数、指数退避；依据 Retry-After 等已返回信号调整。密钥失效或 upgrade_info 暂停对应连接并提示操作。发送的不明确结果按发送状态机处理，不能沿用读请求的重试规则。

## 凭据与登录

首次设置需要部署者持有本地一次性 setup secret，通过请求体提交，不放进 URL。设置完成后关闭初始化入口。管理员密码采用 Node crypto.scrypt 加盐保存；会话为可撤销、可过期的服务端会话。

Cookie 使用 HttpOnly、SameSite，并按 HTTPS 配置 Secure；修改状态的请求校验 CSRF 与 Origin。登录和 setup 限速，认证前不能获取配置、笔记或调度状态。所有前后端校验必须由服务端再次执行。

微信读书密钥和 flomo URL 在首次提交后只返回配置状态，不回显秘密。连接表只保存 secret_ref；密钥存储采用 AES-256-GCM，每条独立随机 nonce，主密钥来自独立文件/部署 secret。主密钥不与数据库一同对外导出；恢复既有数据库时必须保留匹配的主密钥；缺失或不匹配时拒绝启动。该加密不防御主机管理员或已控制进程的攻击者。

限制上游目的地为核验过的官方 HTTPS origin 和路径格式，不接受任意 URL 代理；禁用跨域重定向，防止 flomo URL 输入引入 SSRF 或把凭据转发到其他主机。测试中使用依赖注入的假客户端，不提供生产环境“允许任意域名”开关。

日志脱敏 Authorization、Cookie、flomo URL 路径、原始请求体。笔记文本只保存在数据库，不进入常规日志和错误遥测。项目不内置遥测。

## 健康、备份与升级

对外健康检查 `/api/health` 仅返回应用可响应状态，不泄露个人信息；它不主动探测上游，也不是数据库完整性检查。登录后可查看同步与发送状态。

当前采用停机备份完整数据目录和独立密钥目录，尚无页面备份、在线备份任务或保留策略设置。禁止运行时只复制主数据库而漏掉 WAL。恢复时停止服务并运行 `npm run restore -- --from /绝对路径/备份/app.sqlite`；恢复工具校验数据库与密钥并开启恢复保护，需核对历史发送记录后在页面解除。

升级前备份，迁移版本逐级执行，失败保留旧数据并阻止 worker；应用降级遇到更新的数据库版本必须拒绝启动。支持恢复备份，而非声称所有迁移均可自动回滚。

参考：[Node LTS](https://nodejs.org/en/about/previous-releases)、[Fastify](https://fastify.dev/docs/latest/)、[Vite](https://vite.dev/guide/)、[Docker volumes](https://docs.docker.com/engine/storage/volumes/)。

界面使用 i18next/react-i18next，语言资源随前端打包。浏览器中的手动选择优先于系统语言，界面本地化不改写数据库或发送文本，详见[本地化指南](localization.zh-CN.md)。
