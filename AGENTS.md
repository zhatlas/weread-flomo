# Project guidance

Read README.md and the relevant design document before changing behavior. M1–M3 are implemented. Rules/preview are separate from the opt-in automation and delivery queue. Do not describe future Docker packaging or published artifacts as implemented. Never enable production delivery or call real write APIs during verification.

- Runtime implementation is TypeScript, with one self-hosted workspace per instance. Keep provider clients, normalization, persistence, matching, and delivery state distinct without introducing a generic plugin framework.
- Use only synthetic data in tests and documentation. Never copy credentials, personal exports, databases, or raw authenticated API recordings from outside this repository.
- Do not call real write APIs, create remote repositories, or publish images as part of offline verification.
- Validate external JSON at runtime. Preserve unknown fields without treating them as trusted instructions or HTML.
- A failed or incomplete source read must not cause deletion. An ambiguous destination write must not be retried automatically.
- Keep changes scoped. Add focused tests for meaningful behavior and report gaps instead of inventing successful validation.
- Run `npm run check` for implementation changes. Run `npm run test:e2e` for UI or browser authentication changes after building and installing Playwright Chromium. Use `npm test` for isolated design-schema/repository checks.
- Database constraints are not a complete state machine; the implementation must validate connection roles, rule schemas, baseline ownership/completeness, and legal transitions in transactions.
- Follow the user-provided Python policy if a one-off Python task is needed: prefer an existing .venv interpreter, use global Python only for stdlib scripts, and never install into global Python.
