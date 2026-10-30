# Localization

[English](localization.md) · [简体中文](localization.zh-CN.md)

## Runtime behavior

The React interface uses [i18next](https://www.i18next.com/overview/configuration-options) and [react-i18next](https://react.i18next.com/latest/using-with-hooks). Both dictionaries are bundled; no translation API, CDN or extra network request is needed.

Language priority:

1. A valid manual choice (`en` or `zh-CN`) stored at `localStorage['weread-flomo.language']`.
2. The browser's primary preferred locale (`navigator.languages[0]`, falling back to `navigator.language`): Chinese variants, including Traditional Chinese, use `zh-CN`.
3. English for other or missing locales.

An unsupported/stale saved value is ignored. Failed storage access does not prevent startup or switching; the selection lasts for the current tab. Browser language changes are followed only without an explicit choice. Preferences are browser/origin-specific, not account-wide. Clear the saved value and reload to restore automatic selection.

The language selector is available during loading/setup/login and in the authenticated header. Switching keeps open views, form input and fetched data. The document's `lang`, page title, interface text and date formatting update. Dates still use Beijing time where specified; rule/schedule time zones are unchanged.

## Files and keys

- `src/web/language.ts`: pure language-selection policy and storage key.
- `src/web/i18n.ts`: bundled resources, initialization, persistence and document metadata.
- `src/web/LanguageSwitcher.tsx`: shared selector.
- `src/web/locales/en.json` and `src/web/locales/zh-CN.json`: complete language catalogs.

Keys are stable, readable English messages, an i18next-supported natural-language-key style. `keySeparator` and `nsSeparator` are disabled so periods and colons are ordinary key characters. Keep existing keys stable when editing translations. JSON values hold the displayed wording; translations should not be embedded in page components.

Use `t(key, values)` for interface strings and named `{{placeholders}}` for whole dynamic messages when word order matters. Keep placeholder names identical across languages. Pass counts through i18next's `count` option for plural-sensitive messages. English provides singular/plural forms; Chinese has its own applicable form. Use translated labels for known status/reason codes, with unknown codes visible for diagnosis. Store error codes and notice keys in state, not already-translated text, so switching updates existing feedback.

React escapes rendered values. Do not use translated HTML through `dangerouslySetInnerHTML`, and do not disable escaping in other renderers merely because the React integration does so.

## Data is not interface copy

Never translate source titles, authors, passages, thoughts, original JSON, administrator usernames, saved rule names, keywords, extra tags or delivery content. The fixed Chinese output template is intentionally independent of interface language, and preview must show exactly the text sent to flomo. Translate explanations around that content, not the content itself. Draft default names may use the current language when created, but become user data thereafter.

A language change must not modify the database, trigger sync/delivery, reset a baseline, alter time zones or change queued payloads.

## Adding a language

1. Copy `en.json` to a locale-named file and translate every value, preserving placeholders and appropriate plural forms.
2. Register the resource, extend the supported language type/list and update browser fallback mapping explicitly.
3. Add an option labeled in that language to the selector. Update preference validation so the choice persists.
4. Extend locale-selection/catalog/browser tests and inspect long text at desktop/mobile widths.
5. Add translated documentation with a language link at the top. Update related guides together.

This release intentionally has two editions; a future Traditional Chinese catalog can be added separately without changing source data.

## Documentation conventions

English lives at canonical names (`README.md`, `docs/usage.md`, `CONTRIBUTING.md`, etc.). Chinese uses `.zh-CN.md`. Both link to the other edition at the top; links inside Chinese guides should remain in Chinese where a counterpart exists. `README.en.md` is a compatibility link to the English default. `LICENSE` retains the standard English MIT text; `LICENSE.zh-CN.md` is a non-authoritative reading aid. Issue templates offer both languages, and the default PR template links to its Chinese counterpart.

Run `npm run check` and `npm run test:e2e`. Use only synthetic content for screenshots and language tests.
