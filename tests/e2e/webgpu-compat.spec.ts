import { expect, test } from '@playwright/test';

test('loads the WebGPU hangar on a parser without flat either sampling', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /WGSL|GPUValidation|WebGPU|shader/i.test(message.text()))
      errors.push(message.text());
  });
  await page.route('**/api/**', (route) =>
    route.fulfill({
      json: {
        user: {
          id: 'gpu-fixture',
          username: 'gpu_pilot',
          unlockedStage: 4,
          clearedStages: [1, 2, 3, 4],
        },
        rows: [],
        total: 0,
        pages: 1,
        page: 1,
      },
    }),
  );
  await page.addInitScript(() => {
    const state = { modules: 0, rejected: 0, mipmaps: 0 };
    Object.assign(window, { wgslCompatState: state });
    if (typeof GPUDevice === 'undefined') return;
    const original = GPUDevice.prototype.createShaderModule;
    GPUDevice.prototype.createShaderModule = function (descriptor) {
      state.modules++;
      if (descriptor.code.includes('vBaseArrayLayer')) state.mipmaps++;
      if (/@interpolate\(\s*flat\s*,\s*either\s*\)/.test(descriptor.code)) {
        state.rejected++;
        throw new Error("Tint WGSL reader failure: unsupported sampling 'either'");
      }
      return original.call(this, descriptor);
    };
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /BEGIN SORTIE/ })).toBeEnabled({ timeout: 45000 });
  const state = await page.evaluate(
    () =>
      (
        window as unknown as {
          wgslCompatState: { modules: number; rejected: number; mipmaps: number };
        }
      ).wgslCompatState,
  );
  expect(state.modules, 'exercise WebGPU rather than silently testing WebGL').toBeGreaterThan(0);
  expect(state.mipmaps).toBeGreaterThan(0);
  expect(state.rejected).toBe(0);
  expect(errors).toEqual([]);
});
