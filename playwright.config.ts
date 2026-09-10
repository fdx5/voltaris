import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4179',
    viewport: { width: 1440, height: 900 },
    channel: 'chromium',
    launchOptions: {
      args: process.platform === 'win32' ? ['--enable-gpu', '--use-angle=d3d11'] : ['--enable-gpu'],
    },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node tools/e2e-server.mjs',
    url: 'http://127.0.0.1:4179/api/health',
    timeout: 30000,
    reuseExistingServer: false,
  },
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-report.json' }]],
});
