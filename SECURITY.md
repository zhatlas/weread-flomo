# Security

[English](SECURITY.md) · [简体中文](SECURITY.zh-CN.md)

This is an early M3 implementation, not a release with a long-term support commitment. Session authentication, Origin/CSRF checks, login limits, credential encryption and fixed provider destinations are implemented. See [Operations](docs/usage.md).

## Reporting vulnerabilities

Use [GitHub private vulnerability reporting](https://github.com/zhatlas/weread-flomo/security/advisories/new). Do not post credentials, private notes or exploitable details in public issues. Prefer synthetic data and redacted reproduction steps even in private reports.

## Data boundaries

WeRead keys and personal flomo URLs are secrets. Logs, diagnostics, screenshots and error responses must be redacted. Saved credentials are not returned by the server, and production databases/user content do not belong in the repository.

Public-release checks must cover authentication, CSRF, XSS, SSRF, secret storage and ambiguous writes. Encrypting credentials does not protect against a compromised host.

Backups contain private notes and can omit delivery records created after the restore point. Restoring a database does not make replaying its entire queue safe. Pause delivery and review history before clearing recovery protection.

Runtime data defaults to an external application-data directory. Startup and restore reject source-local database/key paths. Keep backups, exports and service configuration outside the source tree as well. Books and notes are plaintext in SQLite; API secrets are encrypted with an independent master key. Possession of both database and key permits decryption, so neither they nor their backups may be published.

`npm run check` scans source and Git-tracked files for common private artifacts. Review personal text, images and full Git history separately before publishing.

Language resources are bundled locally and no external translation service receives your data. Browser storage contains only the explicit interface-language choice. Translations and API text are rendered as text, never trusted HTML.
