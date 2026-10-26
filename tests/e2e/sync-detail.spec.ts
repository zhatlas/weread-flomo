import { test, expect } from '@playwright/test';

test('sync details group by book ID and preserve zero counts, missing scopes and errors', async ({ page }, info) => {
  const run = { id: 'synthetic-run', connection_id: 'synthetic-source', mode: 'full', status: 'partial', started_at: 0, finished_at: 1, error_code: null, coverage_json: '{"listComplete":true,"expectedBooks":3}', counts_json: '{}' };
  const item = (book_id: string, kind: string, count: number, error_code: string | null = null) => ({ book_id, title: '合成示例书', kind, count, error_code, status: error_code ? 'failed' : 'succeeded' });
  const responses: Record<string, unknown> = {
    '/api/auth/state': { initialized: true, authenticated: true, username: 'reader' },
    '/api/connections': { items: [{ id: run.connection_id, provider: 'weread', enabled: 1, created_at: 0 }] },
    '/api/status': { running: false, stats: { total: 6, highlights: 6, thoughts: 0, books: 3 }, runs: [run] },
    '/api/runs/synthetic-run': { run, items: [item('a', 'highlight', 4), item('b', 'highlight', 2), item('a', 'thought', 0), item('b', 'thought', 0, 'UPSTREAM_NETWORK'), { ...item('c', 'metadata', 0, 'UPSTREAM_FORMAT'), title: null }] },
  };
  await page.route('**/api/**', (route) => route.fulfill({ json: responses[new URL(route.request().url()).pathname] }));
  await page.goto('/');
  await page.getByRole('button', { name: /微信读书 · 完整遍历/ }).click();
  const dialog = page.getByRole('dialog', { name: '同步详情' });
  const rows = dialog.locator('.scope-list > div');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator(':scope > span')).toHaveText('合成示例书');
  await expect(rows.nth(0).locator('strong')).toHaveText('划线 4 条，想法 0 条');
  await expect(rows.nth(1).locator('strong')).toHaveText('划线 2 条，想法 无法连接微信读书，请稍后重试。');
  await expect(rows.nth(1).locator('.error-text')).toHaveText('想法 无法连接微信读书，请稍后重试。');
  await expect(rows.nth(2)).toContainText('书籍 c');
  await expect(rows.nth(2).locator('strong')).toHaveText('划线 未读取，想法 未读取，书籍信息 接口返回格式与预期不符，已有数据已保留。');
  const title = await rows.nth(0).locator(':scope > span').boundingBox();
  const counts = await rows.nth(0).locator('strong').boundingBox();
  expect(title!.x + title!.width).toBeLessThan(counts!.x);
  expect(Math.abs(title!.y - counts!.y)).toBeLessThan(2);
  await page.screenshot({ path: info.outputPath('sync-details-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(rows.nth(0).locator('strong')).toHaveText('划线 4 条，想法 0 条');
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('sync-details-mobile.png') });
});
