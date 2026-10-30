# Contributing

[English](CONTRIBUTING.md) · [简体中文](CONTRIBUTING.zh-CN.md)

Issues and pull requests in English or Chinese are welcome. M1–M3 are implemented. Read [Product design](docs/product.md) and [Roadmap](docs/roadmap.md) to distinguish shipped behavior from future work.

## Local checks

Use Node.js 24 LTS, then run `npm ci` and `npm run check`. For UI changes, install Playwright Chromium and run `npm run test:e2e`. Tests use synthetic data and need no real API keys. See [Operations](docs/usage.md) for development setup. Commit lockfile changes with dependency changes and inspect `npm audit`.

## Change guidelines

- Solve one concrete problem per PR and keep implementation/documentation scope aligned.
- Validate network payloads at runtime; TypeScript declarations are not validation.
- Never include personal keys, flomo URLs, notes, databases or account details in screenshots.
- Use synthetic tests. For live validation, report the environment, redacted structure and conclusion rather than raw recordings.
- Schema changes need migration, failure-recovery guidance and constraint tests.
- Delivery changes must cover repeats, timeouts, restarts and ambiguous outcomes. Do not hide duplicate-send risk behind automatic retries.
- Keep UI copy in language resources. Maintain English and Chinese together, including interpolation placeholders; do not translate user data. See [Localization](docs/localization.md).
- Update both language editions of changed documentation and their links. Avoid unrequested settings or plugin frameworks.

## Pull requests

Explain the trigger, resulting behavior, validation and unverified limits. Code, screenshots and tests must represent the final change. Confirm you have the right to contribute the content. Contributions are provided under this project's MIT license.
