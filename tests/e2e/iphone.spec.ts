import { test, expect } from '@playwright/test';

test.use({
  hasTouch: true,
  isMobile: true,
  // Exercise the app's iOS renderer and asset paths as well as its touch layout.
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
});
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) =>
    route.fulfill({
      json:
        new URL(route.request().url()).pathname === '/api/runs'
          ? { id: 'iphone-run', config: {} }
          : {
              user: {
                id: 'iphone',
                username: 'iphone_pilot',
                unlockedStage: 4,
                clearedStages: [1, 2, 3, 4],
              },
              status: 'abandoned',
            },
    }),
  );
  // iPhone Safari does not provide document fullscreen on all OS versions.
  await page.addInitScript(() => {
    Object.defineProperty(Element.prototype, 'requestFullscreen', {
      configurable: true,
      value: undefined,
    });
  });
});

for (const device of [
  { width: 667, height: 375, side: 0, bottom: 0 },
  { width: 844, height: 390, side: 47, bottom: 21 },
  { width: 932, height: 430, side: 59, bottom: 21 },
  { width: 844, height: 280, side: 47, bottom: 21 },
]) {
  test(`iPhone safe-area gameplay ${device.width}x${device.height}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize(device);
    await page.goto('/?webgl=1');
    await page.evaluate(({ side, bottom }) => {
      const style = document.documentElement.style;
      style.setProperty('--safe-left', `${side}px`);
      style.setProperty('--safe-right', `${side}px`);
      style.setProperty('--safe-bottom', `${bottom}px`);
    }, device);
    await page.getByRole('button', { name: /GLACIAL VAULT/ }).click();
    const launch = page.getByRole('button', { name: '출격 · LAUNCH MISSION' });
    await launch.scrollIntoViewIfNeeded();
    await launch.click();
    await expect(page.locator('.play-frame')).toBeVisible({ timeout: 45000 });
    await expect(page.locator('.rotate-overlay')).not.toBeVisible();
    for (const selector of [
      'canvas',
      '.play-frame',
      '.hud.top-left',
      '.hud.bottom-left',
      '.skills',
      '.hud.top-right',
    ]) {
      const box = await page.locator(selector).boundingBox();
      expect(box, selector).not.toBeNull();
      expect(box!.x, selector).toBeGreaterThanOrEqual(device.side - 1);
      expect(box!.y, selector).toBeGreaterThanOrEqual(-1);
      expect(box!.x + box!.width, selector).toBeLessThanOrEqual(device.width - device.side + 1);
      expect(box!.y + box!.height, selector).toBeLessThanOrEqual(device.height - device.bottom + 1);
    }
    const pause = page.getByRole('button', { name: '일시정지', exact: true });
    expect((await pause.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.getByRole('button', { name: '옵션 홀드', exact: true }).click();
    await expect(page.getByRole('button', { name: '옵션 홀드', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.waitForTimeout(9000);
    await page.screenshot({
      path: `test-results/iphone-stage4-${device.width}x${device.height}.png`,
    });
    await pause.click();
    await expect(page.getByRole('dialog', { name: 'FLIGHT PAUSED' })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('visual viewport toolbar resize keeps the bottom controls inside the visible area', async ({
  page,
}) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/?webgl=1');
  await page.getByRole('button', { name: /GLACIAL VAULT/ }).click();
  await page.getByRole('button', { name: '출격 · LAUNCH MISSION' }).click();
  await expect(page.locator('.play-frame')).toBeVisible({ timeout: 45000 });
  for (const height of [280, 350, 390, 260, 390]) {
    await page.evaluate((h) => {
      Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: h });
      window.visualViewport!.dispatchEvent(new Event('resize'));
    }, height);
    await expect
      .poll(async () => {
        const box = await page.locator('.app').boundingBox();
        return Math.round(box!.height);
      })
      .toBe(height);
    const box = await page.locator('.skills').boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1);
  }
});
