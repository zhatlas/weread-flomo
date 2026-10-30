# 贡献指南

[English](CONTRIBUTING.md) · [简体中文](CONTRIBUTING.zh-CN.md)

欢迎中文或英文 Issue/PR。当前已实现 M1–M3，请先阅读 [产品设计](docs/product.zh-CN.md) 和 [实施计划](docs/roadmap.zh-CN.md)，避免把未来功能当成已有功能。

## 本地检查

安装 Node.js 24 LTS，运行 `npm ci`、`npm run check`。界面变更还需安装 Playwright Chromium 后运行 `npm run test:e2e`。所有测试使用合成数据，无需真实 API Key。开发流程见 [使用与运维](docs/usage.zh-CN.md)。提交依赖变更时同步更新 lockfile，并检查 `npm audit`。

## 修改约定

- 让每次 PR 解决一个明确问题；实现范围与现有文档保持一致。
- 网络字段必须验证，不把 TypeScript 类型声明当作响应验证。
- 不在 PR 中放个人 Key、flomo API 地址、笔记正文、数据库、截图中的账号信息。
- 测试只使用合成数据。需要真实 API 验证时，写明环境、脱敏结构和结论，不上传原始录制。
- 数据结构修改需要迁移方案、失败恢复说明和约束测试。
- 发送逻辑修改要覆盖重复运行、超时、重启和不明确结果；不要通过自动重试掩盖重复发送风险。
- UI 文案集中管理，中英文语言文件和文档同步更新，保留插值变量且不翻译用户数据；参见[本地化指南](docs/localization.zh-CN.md)。避免新增未请求的配置选项或通用插件机制。

## 提交 PR

说明触发场景、修改后的行为、验证方式和未验证限制。实现代码、截图、测试必须与最终范围一致。请确认有权贡献提交内容；代码按本项目 MIT 许可证提供。
