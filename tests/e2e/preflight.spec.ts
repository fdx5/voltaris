import { expect, test } from '@playwright/test';

test('first unit and scenery encounters reuse prepared GPU programs', async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (/GPUValidationError|Invalid CommandBuffer/i.test(message.text()))
      errors.push(message.text());
  });
  await page.route('**/api/**', (route) =>
    route.fulfill({
      json: {
        id: 'preflight-run',
        config: {},
        user: {
          id: 'preflight-pilot',
          username: 'preflight',
          unlockedStage: 5,
          clearedStages: [1, 2, 3, 4, 5],
        },
      },
    }),
  );
  await page.addInitScript(() => {
    const state = {
      combat: false,
      total: 0,
      combatShaders: 0,
      shaders: [] as { time: number; code: string }[],
    };
    Object.assign(window, { preflightMetrics: state });
    if (typeof GPUDevice === 'undefined') return;
    const original = GPUDevice.prototype.createShaderModule;
    GPUDevice.prototype.createShaderModule = function (descriptor) {
      state.total++;
      if (state.combat) {
        state.combatShaders++;
        state.shaders.push({ time: performance.now(), code: descriptor.code });
      }
      return original.call(this, descriptor);
    };
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /BEGIN SORTIE/ })).toBeEnabled({ timeout: 45000 });
  await page.getByRole('button', { name: /BEGIN SORTIE/ }).click();
  await page.getByRole('button', { name: /LAUNCH MISSION/ }).click();
  await expect(page.locator('.play-frame')).toBeVisible({ timeout: 60000 });
  await page.evaluate(() => {
    (window as unknown as { preflightMetrics: { combat: boolean } }).preflightMetrics.combat = true;
  });
  await page.waitForTimeout(15000);
  const metrics = await page.evaluate(
    () =>
      (window as unknown as { preflightMetrics: { total: number; combatShaders: number } })
        .preflightMetrics,
  );
  await testInfo.attach('GPU preparation metrics', {
    body: JSON.stringify(metrics),
    contentType: 'application/json',
  });
  console.log('GPU preflight metrics:', metrics.total, metrics.combatShaders);
  expect(metrics.total).toBeGreaterThan(0);
  expect(metrics.combatShaders).toBe(0);
  expect(errors).toEqual([]);
});
