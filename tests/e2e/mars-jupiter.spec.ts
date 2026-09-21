import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const user = {
    id: 'renderer-fixture',
    username: 'renderer_pilot',
    unlockedStage: 5,
    clearedStages: [1, 2, 3, 4, 5],
  };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      path === '/api/runs'
        ? { id: 'renderer-run', config: {} }
        : path === '/api/history'
          ? { rows: [], total: 0, pages: 1, page: 1 }
          : { user, status: 'abandoned' };
    await route.fulfill({ json: body });
  });
});

test('stage 2 launches with the Mars/Jupiter backdrop on WebGPU', async ({ page }) => {
  const errors: string[] = [];
  const gpuErrors: string[] = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => {
    const t = m.text();
    if (/GPUValidationError|Invalid CommandBuffer/i.test(t)) gpuErrors.push(t);
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /IRON BELT/ })).toBeEnabled({ timeout: 45000 });
  await page.getByRole('button', { name: /IRON BELT/ }).click();
  await expect(page.getByRole('dialog')).toContainText('MISSION 02');
  await page.getByRole('button', { name: '출격 · LAUNCH MISSION' }).click();
  await expect(page.locator('.play-frame')).toBeVisible();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test-results/mj-t0.png' });
  // Deterministic timeline/size coverage lives in planet-transition.test.ts.
  await page.waitForTimeout(5000);
  await expect(page.locator('.play-frame')).toBeVisible();
  expect(errors).toEqual([]);
  expect(gpuErrors).toEqual([]);
});
