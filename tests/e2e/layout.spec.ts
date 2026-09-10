import { test, expect } from '@playwright/test';

test.use({ hasTouch: true, isMobile: true });
for (const [width, height] of [
  [568, 320],
  [667, 375],
  [932, 430],
  [320, 568],
  [390, 844],
]) {
  test(`mobile panels fit ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.route('**/api/**', (route) =>
      route.fulfill({
        json: {
          user: {
            id: 'layout',
            username: 'layout_pilot',
            unlockedStage: 4,
            clearedStages: [1, 2, 3, 4],
          },
        },
      }),
    );
    await page.goto('/?webgl=1');
    const launch = page.getByRole('button', { name: 'BEGIN SORTIE 출격 준비' });
    await expect(launch).toBeEnabled({ timeout: 45000 });
    await expect(page.locator('.rotate-overlay')).not.toBeVisible();
    const menu = await page.locator('.app').evaluate((el) => ({
      width: el.clientWidth,
      scrollWidth: el.scrollWidth,
      height: el.clientHeight,
      scrollHeight: el.scrollHeight,
      command: el.querySelector('.command')!.getBoundingClientRect().bottom,
      missions: el.querySelector('.mission-strip')!.getBoundingClientRect().top,
    }));
    expect(menu.scrollWidth).toBeLessThanOrEqual(menu.width + 1);
    expect(menu.scrollHeight).toBeLessThanOrEqual(menu.height + 1);
    expect(menu.command).toBeLessThanOrEqual(menu.missions);
    await launch.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const fits = async () =>
      dialog.evaluate((el) => ({
        height: el.clientHeight,
        scrollHeight: el.scrollHeight,
        width: el.clientWidth,
        scrollWidth: el.scrollWidth,
      }));
    let box = await fits();
    expect(box.scrollHeight, 'launch vertical overflow').toBeLessThanOrEqual(box.height + 1);
    expect(box.scrollWidth, 'launch horizontal overflow').toBeLessThanOrEqual(box.width + 1);
    await page.screenshot({ path: `test-results/mobile-launch-${width}x${height}.png` });
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    await page.getByRole('button', { name: '설정', exact: true }).click();
    box = await fits();
    expect(box.scrollHeight, 'settings vertical overflow').toBeLessThanOrEqual(box.height + 1);
    expect(box.scrollWidth, 'settings horizontal overflow').toBeLessThanOrEqual(box.width + 1);
    await page.screenshot({ path: `test-results/mobile-settings-${width}x${height}.png` });
  });
}
for (const [width, height] of [
  [568, 320],
  [320, 568],
]) {
  test(`login fits ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.route('**/api/**', (route) =>
      route.fulfill({ status: 401, json: { error: 'Login required' } }),
    );
    await page.goto('/?webgl=1');
    await expect(page.locator('.login-card')).toBeVisible();
    const size = await page.locator('.login-screen').evaluate((el) => ({
      height: el.clientHeight,
      scroll: el.scrollHeight,
      width: el.clientWidth,
      wide: el.scrollWidth,
    }));
    expect(size.scroll).toBeLessThanOrEqual(size.height + 1);
    expect(size.wide).toBeLessThanOrEqual(size.width + 1);
    await page.screenshot({ path: `test-results/login-${width}x${height}.png` });
  });
}
