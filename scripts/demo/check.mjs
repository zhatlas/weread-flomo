import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';

const browser = await chromium.launch();
try {
  for (const locale of ['en-US', 'zh-CN']) {
    const context = await browser.newContext({ locale, viewport: { width: 1240, height: 866 }, deviceScaleFactor: 2, offline: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (/^https?:/.test(r.url())) errors.push('Unexpected network request'); });
    await page.clock.setFixedTime(new Date('2026-05-10T02:30:00Z'));
    await page.goto(new URL('../../demo/index.html', import.meta.url).href);
    const nav = page.locator('.nav-item');
    await expect(page.locator('.stat strong').first()).toContainText('6');
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (process.argv.includes('--screenshots')) {
      const name = locale === 'zh-CN' ? 'demo.zh-CN.png' : 'demo.png';
      await page.screenshot({ path: 'docs/images/' + name, animations: 'disabled' });
    }
    await page.locator('.run-row').first().click();
    await expect(page.locator('dialog')).toContainText('潮汐标本室');
    await page.keyboard.press('Escape');
    await nav.nth(1).click();
    await expect(page.locator('.note-card')).toHaveCount(6);
    await page.locator('[name=kind]').selectOption('thought');
    await page.locator('.filters button').click();
    await expect(page.locator('.note-card')).toHaveCount(3);
    await page.locator('.note-card').first().click();
    await expect(page.locator('dialog')).toContainText('退潮之后');
    await page.keyboard.press('Escape');
    await nav.nth(2).click();
    await page.getByRole('button', { name: locale === 'zh-CN' ? /预览匹配与导入文本/ : /Preview matches and import text/ }).click();
    await expect(page.locator('.preview-block').first()).toContainText('潮汐标本室');
    if (process.argv.includes('--screenshots')) {
      await page.locator('.rule-preview').evaluate(el => el.scrollIntoView({ block: 'start' }));
      const name = locale === 'zh-CN' ? 'demo-preview.zh-CN.png' : 'demo-preview.png';
      await page.screenshot({ path: 'docs/images/' + name, animations: 'disabled' });
    }
    await nav.nth(3).click();
    await expect(page.locator('.rule-editor input[type=checkbox]').first()).toBeDisabled();
    await page.locator('.rule-preview .preview-note button').first().click();
    await expect(page.locator('.delivery-content').first()).toContainText('潮汐标本室');
    await nav.nth(4).click();
    await expect(page.locator('input[type=password]').first()).toBeDisabled();
    await page.setViewportSize({ width: 390, height: 844 });
    await nav.first().click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.locator('.language-switcher select').selectOption(locale === 'zh-CN' ? 'en' : 'zh-CN');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', locale === 'zh-CN' ? 'en' : 'zh-CN');
    assert.deepEqual(errors, []);
    await context.close();
    console.log(locale, 'offline workspace and mobile checks passed');
  }
} finally { await browser.close(); }
