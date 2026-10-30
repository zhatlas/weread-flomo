import { test, expect, type Page } from '@playwright/test';
import { languageStorageKey } from '../../src/web/language.js';

const source = '00000000-0000-4000-8000-000000000001';
const destination = '00000000-0000-4000-8000-000000000002';
const note = { id: 1, kind: 'thought', title: '合成书籍', author: '合成作者', chapter_name: '合成章节', content: '我的中文想法 <不是 HTML>', original_text: '保留中文原文。', source_created_at: 0, status: 'missing', missing_scans: 1, first_missing_at: 1, removed_at: null, source_error_code: 'SOURCE_MISSING' };
const outgoing = '《合成书籍》 合成作者 · 合成章节\n> 保留中文原文。\n📝 想法：我的中文想法 <不是 HTML>\n#微信读书/合成书籍';
const run = { id: 'run', connection_id: source, mode: 'full', status: 'partial', started_at: 0, finished_at: 1, error_code: 'SYNC_PARTIAL', coverage_json: '{"expectedBooks":1,"listComplete":true}', counts_json: '{}' };
const delivery = { id: 1, note_id: 1, destination_id: destination, status: 'uncertain', source_hold: null, content: outgoing, matched_rules_json: JSON.stringify([{ name: '用户保存的规则', revision: 1 }]), updated_at: 1, next_attempt_at: null, error_code: 'FLOMO_UNCERTAIN', title: note.title, kind: 'thought' };
const config = { syncEnabled: false, deliveryEnabled: false, schedule: 'interval', intervalMinutes: 15, dailyTime: '02:00', timezone: 'Asia/Shanghai', syncMode: 'full', dailyLimit: 100, maxContentChars: 5000 };

async function mock(page: Page, authenticated = false) {
  const writes: string[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') writes.push(path);
    if (path === '/api/auth/login') return route.fulfill({ status: 401, json: { error: 'LOGIN_FAILED' } });
    const responses: Record<string, unknown> = {
      '/api/auth/state': { initialized: true, authenticated, username: 'synthetic-reader' },
      '/api/connections': { items: [{ id: source, provider: 'weread', enabled: 1, created_at: 0 }, { id: destination, provider: 'flomo', enabled: 1, created_at: 0 }] },
      '/api/status': { running: false, stats: { total: 1, highlights: 0, thoughts: 1, books: 1 }, runs: [run] },
      '/api/runs/run': { run, items: [{ book_id: 'book', title: note.title, kind: 'highlight', status: 'succeeded', count: 1, error_code: null }, { book_id: 'book', title: note.title, kind: 'thought', status: 'failed', count: 0, error_code: 'UPSTREAM_NETWORK' }] },
      '/api/books': { items: [{ book_id: 'book', title: note.title }] },
      '/api/notes': { items: [note], total: 1 },
      '/api/notes/1': { ...note, source_id: 'synthetic-note', first_seen_at: 0, updated_at: 1, raw_json: JSON.stringify({ content: note.content }) },
      '/api/rules': { items: [] },
      '/api/rules/preview': { total: 1, matched: 1, eligible: 1, excluded: 0, reasons: { KIND: 1 }, page: 1, pageTotal: 1, baselinePending: false, baselineAt: 0, snapshotAt: 1, items: [{ ...note, reasons: [], missing: ['章节'], blocks: outgoing.split('\n'), text: outgoing }] },
      '/api/automation': { config, revision: 1, recoveryRequired: true, startupSyncPending: false, blocks: { sync: null, deliver: 'BACKUP_REVIEW' }, usedQuota: 1, counts: { uncertain: 1 }, jobs: [] },
      '/api/deliveries': { items: [delivery], total: 1, page: 1 },
      '/api/deliveries/1': { delivery, attempts: [{ id: 1, started_at: 0, outcome: 'started', error_code: 'FLOMO_UNCERTAIN', http_status: null, content: outgoing }] },
    };
    if (!(path in responses)) throw new Error(`Unexpected test API request: ${path}`);
    return route.fulfill({ json: responses[path] });
  });
  return writes;
}

test('primary browser locale selects English or Chinese, including Traditional Chinese', async ({ browser }) => {
  test.setTimeout(90000);
  for (const locale of ['en-US', 'fr-FR', 'zh-CN', 'zh-TW', 'zh-HK']) {
    const context = await browser.newContext({ locale });
    try {
      const page = await context.newPage(); await mock(page); await page.goto('/');
      const chinese = locale.startsWith('zh');
      await expect(page.getByRole('heading', { name: chinese ? '欢迎回到阅读库' : 'Welcome back to your library' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', chinese ? 'zh-CN' : 'en');
      await expect(page).toHaveTitle(chinese ? 'WeRead → flomo · 阅读收件箱' : 'WeRead → flomo · Reading inbox');
      expect(await page.evaluate((key) => localStorage.getItem(key), languageStorageKey)).toBeNull();
    } finally { await context.close(); }
  }
});

test('manual choice persists, overrides browser language, and updates existing errors without clearing inputs', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'en-US' });
  try {
    const page = await context.newPage(); await mock(page); await page.goto('/');
    await page.getByLabel('Administrator username').fill('synthetic-reader');
    await page.getByLabel('Password', { exact: false }).fill('Synthetic input only');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Incorrect username or password.');
    await page.getByRole('combobox', { name: 'Language' }).selectOption('zh-CN');
    await expect(page.getByRole('alert')).toHaveText('账号或密码不正确。');
    await expect(page.getByLabel('管理员账号')).toHaveValue('synthetic-reader');
    await expect(page.getByLabel('密码', { exact: false })).toHaveValue('Synthetic input only');
    await page.reload();
    await expect(page.getByRole('heading', { name: '欢迎回到阅读库' })).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), languageStorageKey)).toBe('zh-CN');
    await page.evaluate(() => window.dispatchEvent(new Event('languagechange')));
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await page.getByRole('combobox', { name: '语言' }).selectOption('en');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Welcome back to your library' })).toBeVisible();
  } finally { await context.close(); }
});

test('blocked browser storage does not break startup or in-tab language switching', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-TW' });
  try {
    await context.addInitScript(() => {
      Storage.prototype.getItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
      Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
    });
    const page = await context.newPage(); await mock(page); await page.goto('/');
    await page.getByRole('combobox', { name: '语言' }).selectOption('en');
    await expect(page.getByRole('heading', { name: 'Welcome back to your library' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: '欢迎回到阅读库' })).toBeVisible();
  } finally { await context.close(); }
});

test('all workspace pages switch language while preserving source data, drafts and outgoing text', async ({ browser }, info) => {
  test.setTimeout(90000);
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage(); const writes = await mock(page, true); await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Reading overview' })).toBeVisible();
    await page.screenshot({ path: info.outputPath('overview-english.png'), fullPage: true });
    await page.getByRole('button', { name: /WeRead · Full scan/ }).click();
    const sync = page.getByRole('dialog', { name: 'Sync details' });
    await expect(sync).toContainText('Highlights 1 note, Thoughts Cannot connect to WeRead. Try again later.');
    await expect(sync).toContainText('Some scopes failed in this run. Sync will retry with backoff.');
    await page.getByRole('button', { name: 'Close details' }).click();
    await page.getByRole('button', { name: 'Open library' }).click();
    await expect(page.locator('.note-card')).toContainText(note.title);
    await expect(page.locator('.note-card')).toContainText(note.content);
    await page.locator('.note-card').click();
    await expect(page.getByRole('dialog')).toContainText('Possibly deleted, pending review');
    await expect(page.getByRole('dialog')).toContainText(note.original_text);
    await page.getByRole('button', { name: 'Close details' }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Administrator password' })).toBeVisible();
    await expect(page.getByLabel('WeRead API Key')).toBeVisible();
    await page.getByRole('button', { name: 'Rules', exact: true }).click();
    await page.getByLabel('Rule name').fill('用户自定义规则');
    await page.getByRole('button', { name: 'Preview matches and import text' }).click();
    await expect(page.locator('.preview-note')).toContainText('Missing fields: Chapter');
    const blocks = await page.locator('.preview-block').allTextContents();
    expect(blocks.join('\n')).toBe(outgoing);
    await page.getByRole('combobox', { name: 'Language' }).selectOption('zh-CN');
    await expect(page.getByLabel('规则名称')).toHaveValue('用户自定义规则');
    expect(await page.locator('.preview-block').allTextContents()).toEqual(blocks);
    await expect(page.locator('.preview-note')).toContainText('缺失字段：章节');
    await page.getByRole('combobox', { name: '语言' }).selectOption('en');
    await page.getByRole('button', { name: 'Automation', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Backup recovery protection' })).toBeVisible();
    await expect(page.getByLabel('Sync interval (minutes)')).toHaveValue('15');
    await page.getByRole('button', { name: 'View delivery #1', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Delivery details' })).toContainText('Started');
    await expect(page.getByRole('region', { name: 'Delivery details' })).toContainText('用户保存的规则');
    expect(await page.locator('.delivery-content').first().textContent()).toBe(outgoing);
    await page.screenshot({ path: info.outputPath('automation-english.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    for (const name of ['Overview', 'Library', 'Rules', 'Automation', 'Settings']) {
      await page.getByRole('button', { name: new RegExp(`^${name}(?:\\s+\\d+)?$`) }).first().click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), name).toBe(true);
      if (name === 'Overview') await page.screenshot({ path: info.outputPath('overview-english-mobile.png'), fullPage: true });
    }
    await page.screenshot({ path: info.outputPath('settings-english-mobile.png'), fullPage: true });
    expect(writes).toEqual(['/api/rules/preview']);
  } finally { await context.close(); }
});
