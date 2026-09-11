import { defineConfig } from '@playwright/test';
import config from './playwright.config';

export default defineConfig({
  ...config,
  testMatch: ['**/iphone.spec.ts', '**/layout.spec.ts'],
  outputDir: 'test-results-webkit',
  reporter: [['list'], ['json', { outputFile: 'test-results-webkit/report.json' }]],
  use: {
    ...config.use,
    browserName: 'webkit',
    channel: undefined,
    launchOptions: {},
  },
});
