import { test, expect } from '@playwright/test';
// Not a check: this captures the frame `tools/create-icons.mjs --cover` builds
// the link-preview image from. Run it before regenerating the cover.
test('captures a frame for the link preview', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      json:
        path === '/api/runs'
          ? { id: 'cover-run', config: {} }
          : {
              user: {
                id: 'cover',
                username: 'cover_pilot',
                unlockedStage: 4,
                clearedStages: [1, 2, 3],
              },
            },
    });
  });
  await page.goto('/?webgl=1');
  await expect(page.getByRole('button', { name: 'BEGIN SORTIE 출격 준비' })).toBeEnabled({
    timeout: 45000,
  });
  await page.getByRole('button', { name: 'BEGIN SORTIE 출격 준비' }).click();
  await page.getByRole('button', { name: '출격 · LAUNCH MISSION' }).click();
  await expect(page.locator('.play-frame')).toBeVisible();
  // Long enough for a wave to fill the field, and up out of the bottom corner.
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(400);
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(13000);
  await page.screenshot({ path: 'test-results/cover.png' });
});
