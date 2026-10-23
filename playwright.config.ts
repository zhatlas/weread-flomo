import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', testMatch: '**/*.spec.ts', fullyParallel: false, workers: 1,
  timeout: 45_000, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4100', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: { command: 'node --import tsx tests/e2e/server.ts', url: 'http://127.0.0.1:4100/api/health', reuseExistingServer: false, timeout: 30_000, gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 } },
});
