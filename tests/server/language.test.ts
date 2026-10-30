import ts from 'typescript';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createInstance } from 'i18next';
import { preferredLanguage } from '../../src/web/language.js';

const en = JSON.parse(readFileSync(new URL('../../src/web/locales/en.json', import.meta.url), 'utf8')) as Record<string, string>;
const zh = JSON.parse(readFileSync(new URL('../../src/web/locales/zh-CN.json', import.meta.url), 'utf8')) as Record<string, string>;

test('explicit language wins; all Chinese locales select Chinese and other locales fall back to English', () => {
  for (const locale of ['zh', 'zh-CN', 'zh-TW', 'zh-HK', 'zh-Hans', 'zh-Hant-TW', 'ZH_cn']) {
    assert.equal(preferredLanguage(null, locale), 'zh-CN');
    assert.equal(preferredLanguage('en', locale), 'en');
  }
  for (const locale of ['en-US', 'fr-FR', 'ja-JP', '', 'zho']) {
    assert.equal(preferredLanguage(null, locale), 'en');
    assert.equal(preferredLanguage('zh-CN', locale), 'zh-CN');
  }
  assert.equal(preferredLanguage('obsolete', 'zh-TW'), 'zh-CN');
  assert.equal(preferredLanguage('obsolete', 'de-DE'), 'en');
});

test('language catalogs cover the same keys and interpolation variables', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  const variables = (value: string) => [...value.matchAll(/{{\s*([^}]+?)\s*}}/g)].map((m) => m[1]).sort();
  for (const key of Object.keys(en)) {
    assert.equal(typeof zh[key], 'string', key);
    assert.ok(en[key].trim() && zh[key].trim(), key);
    assert.deepEqual(variables(en[key]), variables(zh[key]), key);
  }
});

test('i18next handles counts, interpolation and English fallback without altering supplied data', async () => {
  const i18n = createInstance();
  await i18n.init({ resources: { en: { translation: en }, 'zh-CN': { translation: zh } }, lng: 'en', fallbackLng: 'en', keySeparator: false, nsSeparator: false, interpolation: { escapeValue: false } });
  assert.equal(i18n.t('noteCount', { count: 1 }), '1 note');
  assert.equal(i18n.t('noteCount', { count: 0 }), '0 notes');
  assert.equal(i18n.t('noteCount', { count: 4 }), '4 notes');
  assert.equal(i18n.t('Book {{value0}}', { value0: '<合成书籍>' }), 'Book <合成书籍>');
  await i18n.changeLanguage('zh-CN');
  assert.equal(i18n.t('noteCount', { count: 1 }), '1 条');
  assert.equal(i18n.t('noteCount', { count: 4 }), '4 条');
  assert.equal(i18n.t('Page {{page}} of {{total}}', { page: 2, total: 3 }), '第 2 / 3 页');
  await i18n.changeLanguage('fr');
  assert.equal(i18n.t('Library'), 'Library');
});

test('literal UI translation keys and status/error labels have catalog entries', () => {
  const known = (key: string) => key in en || `${key}_other` in en;
  for (const file of ['src/web/main.tsx', 'src/web/Rules.tsx', 'src/web/Automation.tsx', 'src/web/api.ts', 'src/web/LanguageSwitcher.tsx', 'src/web/i18n.ts', 'src/shared/rules.ts', 'src/shared/automation.ts']) {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText(tree) === 't' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        assert.ok(known(node.arguments[0].text), `${file}: missing ${node.arguments[0].text}`);
      }
      if (ts.isVariableDeclaration(node) && ['messages', 'statusText', 'noteLabels', 'reasonLabels', 'deliveryLabels'].includes(node.name.getText(tree)) && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
        for (const property of node.initializer.properties) if (ts.isPropertyAssignment(property) && ts.isStringLiteral(property.initializer)) assert.ok(known(property.initializer.text), `${file}: missing ${property.initializer.text}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
});
