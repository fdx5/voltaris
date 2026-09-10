import { test, expect } from '@playwright/test';

test('real signup, mandatory login, stage lock, saved history, session restore and logout', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const username = `pilot_${Date.now().toString(36)}`;
  await page.goto('/?webgl=1');
  await expect(page.getByRole('heading', { name: '파일럿 로그인' })).toBeVisible();
  await expect(page.locator('.mission-cards')).toHaveCount(0);
  await page.getByRole('button', { name: '처음 오셨나요? 회원가입' }).click();
  await page.getByLabel('아이디', { exact: true }).fill(username);
  await page.getByLabel('비밀번호', { exact: true }).fill('flight-test-password-2026');
  await page.getByRole('button', { name: '가입하고 시작' }).click();
  const first = page.locator('.mission').filter({ hasText: 'STAGE 01' });
  await expect(first).toBeEnabled({ timeout: 45000 });
  for (const stage of ['02', '03', '04'])
    await expect(page.locator('.mission').filter({ hasText: `STAGE ${stage}` })).toBeDisabled();
  await page.screenshot({ path: 'test-results/auth-stage-locks.png' });
  const locked = await page.request.post('/api/runs', {
    headers: { 'X-Voltaris': '1' },
    data: { stage: 2, weapon: 'LASER', credits: 3 },
  });
  expect(locked.status()).toBe(403);
  await first.click();
  await page.getByRole('button', { name: /LAUNCH MISSION/ }).click();
  await expect(page.locator('.play-frame')).toBeVisible();
  await page.waitForTimeout(1800);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '출격 포기 · 격납고로' }).click();
  await expect(page.locator('.account-banner')).toHaveCount(0, { timeout: 30000 });
  const history = await page.request.get('/api/history');
  const result = await history.json();
  expect(
    result.rows.some(
      (r: { username: string; status: string; seconds: number }) =>
        r.username === username && r.status === 'abandoned' && r.seconds > 0,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: /기록/ }).first().click();
  await expect(page.locator('.online-history')).toContainText(username);
  await page.screenshot({ path: 'test-results/auth-history.png' });
  await page.reload();
  await expect(page.locator('.guest')).toContainText(username, { timeout: 45000 });
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page.getByRole('heading', { name: '파일럿 로그인' })).toBeVisible();
  await page.getByLabel('아이디', { exact: true }).fill(username);
  await page.getByLabel('비밀번호', { exact: true }).fill('flight-test-password-2026');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.locator('.guest')).toContainText(username, { timeout: 45000 });
  expect(errors).toEqual([]);
});
