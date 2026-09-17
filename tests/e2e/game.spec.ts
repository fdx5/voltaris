import { test, expect } from '@playwright/test';
// Rendering regression tests use an unlocked API fixture; auth.spec.ts tests real authentication.
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
test('title menu supports keyboard selection, records and flight manual', async ({ page }) => {
  await page.goto('/?webgl=1');
  const menu = page.getByRole('navigation', { name: '메인 메뉴' });
  const launch = menu.getByRole('button', { name: 'BEGIN SORTIE 출격 준비' });
  await expect(launch).toBeEnabled({ timeout: 45000 });
  await launch.focus();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('button', { name: '파일럿 랭킹' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'FLIGHT RECORDS' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu.getByRole('button', { name: '파일럿 랭킹' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'FLIGHT MANUAL' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('End');
  await expect(menu.getByRole('button', { name: 'SIMULATION 보스 훈련' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(launch).toBeFocused();
});

test('WebGL2 hangar, launch, movement, options, pause and settings', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /texture|blob:|Content Security Policy/i.test(message.text()))
      errors.push(message.text());
  });
  await page.goto('/?webgl=1');
  await expect(page.getByRole('button', { name: 'BEGIN SORTIE 출격 준비' })).toBeEnabled({
    timeout: 45000,
  });
  await page.screenshot({ path: 'test-results/hangar.png' });
  await page.getByRole('button', { name: 'BEGIN SORTIE 출격 준비' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'SPREAD SCATTER CANNON' }).click();
  await page.getByRole('button', { name: '출격 · LAUNCH MISSION' }).click();
  await expect(page.locator('.play-frame')).toBeVisible();
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(500);
  await page.keyboard.up('ArrowUp');
  await page.keyboard.press('KeyQ');
  await expect(page.locator('.mode-button')).toContainText('FREEZE');
  await page.waitForTimeout(4500);
  await page.screenshot({ path: 'test-results/combat.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'FLIGHT PAUSED' })).toBeVisible();
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByLabel('피격 판정 점 표시').uncheck();
  await expect(page.getByLabel('음악 볼륨')).toHaveValue('0.5');
  await page.getByLabel('음악 볼륨').fill('0.8');
  await expect(page.getByText('80% · STAGE 01 GALAXY DASH')).toBeVisible();
  await page.getByRole('button', { name: '닫기' }).click();
  await page.getByRole('button', { name: '전투 재개', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(errors).toEqual([]);
});
test('boss training, phase notice and stress count controls', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?webgl=1');
  await expect(page.getByRole('button', { name: 'SIMULATION 보스 훈련' })).toBeEnabled({
    timeout: 45000,
  });
  await page.getByRole('button', { name: 'SIMULATION 보스 훈련' }).click();
  await page.getByRole('button', { name: '출격 · LAUNCH MISSION' }).click();
  await expect(page.locator('.boss-hud')).toContainText('GATEKEEPER');
  await page.waitForTimeout(6000);
  await page.screenshot({ path: 'test-results/boss.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '출격 포기 · 격납고로' }).click();
  await page.getByRole('button', { name: '테스트 랩' }).click();
  await expect(page.locator('.lab')).toBeVisible();
  await page.getByLabel('탄환 수').fill('4000');
  await expect(page.locator('.lab')).toContainText('4000');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'test-results/stress.png' });
  await page.getByRole('button', { name: '메뉴로 돌아가기' }).click();
  expect(errors).toEqual([]);
});
test('stage two launches with its own sector, roster and boss', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?webgl=1');
  await expect(page.getByRole('button', { name: /IRON BELT/ })).toBeEnabled({ timeout: 45000 });
  await page.getByRole('button', { name: /IRON BELT/ }).click();
  await expect(page.getByRole('dialog')).toContainText('MISSION 02 / IRON BELT');
  await page.getByRole('button', { name: '출격 · LAUNCH MISSION' }).click();
  await expect(page.locator('.hud.top-left')).toContainText('STAGE 02');
  await expect(page.locator('.hud.top-left')).toContainText('IRON BELT');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'test-results/stage-02.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await expect(page.getByText('STAGE 02 SPACE ENGINE')).toBeVisible();
  expect(errors).toEqual([]);
});
test('stage three flies a surface sector with terrain and emplacements', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?webgl=1');
  await expect(page.getByRole('button', { name: /IO SURFACE/ })).toBeEnabled({ timeout: 45000 });
  await page.getByRole('button', { name: /IO SURFACE/ }).click();
  await expect(page.getByRole('dialog')).toContainText('MISSION 03 / IO SURFACE');
  await page.getByRole('button', { name: '출격 · LAUNCH MISSION' }).click();
  await expect(page.locator('.hud.top-left')).toContainText('IO SURFACE');
  await page.waitForTimeout(9000);
  await page.screenshot({ path: 'test-results/stage-03.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await expect(page.getByText('STAGE 03 FLY FLY')).toBeVisible();
  expect(errors).toEqual([]);
});
test('stage four flies an ice cave with a roof and a deck', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?webgl=1');
  await expect(page.getByRole('button', { name: /GLACIAL VAULT/ })).toBeEnabled({ timeout: 45000 });
  await page.getByRole('button', { name: /GLACIAL VAULT/ }).click();
  await expect(page.getByRole('dialog')).toContainText('MISSION 04 / GLACIAL VAULT');
  await page.getByRole('button', { name: '출격 · LAUNCH MISSION' }).click();
  await expect(page.locator('.hud.top-left')).toContainText('GLACIAL VAULT');
  await page.waitForTimeout(9000);
  await page.screenshot({ path: 'test-results/stage-04.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await expect(page.getByText('STAGE 04 SKY HIGH')).toBeVisible();
  expect(errors).toEqual([]);
});
test('stage five flies a wide galaxy rim sector with an expanded vertical range', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?webgl=1');
  await expect(page.getByRole('button', { name: /GALACTIC RIM/ })).toBeEnabled({ timeout: 45000 });
  await page.getByRole('button', { name: /GALACTIC RIM/ }).click();
  await expect(page.getByRole('dialog')).toContainText('MISSION 05 / GALACTIC RIM');
  await page.getByRole('button', { name: '출격 · LAUNCH MISSION' }).click();
  await expect(page.locator('.hud.top-left')).toContainText('GALACTIC RIM');
  await page.waitForTimeout(9000);
  await page.screenshot({ path: 'test-results/stage-05.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await expect(page.getByText('STAGE 05 LEVEL5 1 BGM')).toBeVisible();
  expect(errors).toEqual([]);
});
test('falls back to WebGL 2 when WebGPU advertises itself and then refuses', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // The case three does not handle: navigator.gpu exists, so it picks the
  // WebGPU backend in its constructor, and the adapter request then fails.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: {
        requestAdapter: async () => null,
        getPreferredCanvasFormat: () => 'bgra8unorm',
        wgslLanguageFeatures: new Set(),
      },
    });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'BEGIN SORTIE 출격 준비' })).toBeEnabled({
    timeout: 45000,
  });
  await expect(page.locator('.fatal')).toHaveCount(0);
  await expect(page.locator('.footer')).toContainText('WEBGL 2');
  // The canvas was replaced on the way down, so touch has to still land.
  await page.getByRole('button', { name: 'BEGIN SORTIE 출격 준비' }).click();
  await page.getByRole('button', { name: '출격 · LAUNCH MISSION' }).click();
  await expect(page.locator('.play-frame')).toBeVisible();
  await page.mouse.move(700, 450);
  await page.mouse.down();
  await page.mouse.move(700, 300, { steps: 8 });
  await page.mouse.up();
  expect(errors).toEqual([]);
});
test('draws the combat batches after a renderer restart, not just the hangar', async ({ page }) => {
  // The compile pass hides the combat batches; a start-up that fails there and
  // retries used to leave them hidden for the rest of the session - a game
  // with no enemies and no shots. `?rendererfail` fails the first attempt at
  // exactly that point. The stress lab is the honest witness: it draws nothing
  // but those batches, and prints its draw calls.
  const draws = async (query: string) => {
    await page.goto(query);
    await expect(page.getByRole('button', { name: 'BEGIN SORTIE 출격 준비' })).toBeEnabled({
      timeout: 45000,
    });
    await page.getByRole('button', { name: /테스트 랩/ }).click();
    await page.waitForTimeout(3500);
    return Number(await page.locator('.metrics div:nth-child(3) strong').innerText());
  };
  const healthy = await draws('/?webgl=1');
  expect(healthy).toBeGreaterThan(40);
  const restarted = await draws('/?rendererfail=1');
  expect(restarted).toBeGreaterThanOrEqual(healthy - 2);
});
test('latches option hold from the HUD, since a phone cannot hold a button', async ({ page }) => {
  await page.goto('/?webgl=1');
  await expect(page.getByRole('button', { name: 'BEGIN SORTIE 출격 준비' })).toBeEnabled({
    timeout: 45000,
  });
  await page.getByRole('button', { name: 'BEGIN SORTIE 출격 준비' }).click();
  await page.getByRole('button', { name: '출격 · LAUNCH MISSION' }).click();
  await expect(page.locator('.play-frame')).toBeVisible();
  const hold = page.getByRole('button', { name: '옵션 홀드' });
  await expect(hold).toHaveAttribute('aria-pressed', 'false');
  await hold.click();
  await expect(hold).toHaveAttribute('aria-pressed', 'true');
  await expect(hold).toContainText('ON');
  // It stays latched across a mode change, which is the point of latching.
  await page.getByRole('button', { name: /옵션 모드/ }).click();
  await expect(hold).toHaveAttribute('aria-pressed', 'true');
  await hold.click();
  await expect(hold).toHaveAttribute('aria-pressed', 'false');
});
test('keeps the boss gauge inside its track on the heaviest boss', async ({ page }) => {
  await page.goto('/?webgl=1');
  await expect(page.getByRole('button', { name: /GLACIAL VAULT/ })).toBeEnabled({ timeout: 45000 });
  await page.getByRole('button', { name: /GLACIAL VAULT/ }).click();
  await page.getByRole('button', { name: '닫기' }).click();
  await page.getByRole('button', { name: /보스 훈련/ }).click();
  await page.getByRole('button', { name: '출격 · LAUNCH MISSION' }).click();
  await expect(page.locator('.boss-hud')).toBeVisible({ timeout: 30000 });
  const fits = await page.locator('.boss-hud').evaluate((el) => {
    const track = el.querySelector('div') as HTMLElement;
    const fill = el.querySelector('i') as HTMLElement;
    return {
      track: track.getBoundingClientRect().width,
      fill: fill.getBoundingClientRect().width,
      page: document.documentElement.clientWidth,
      right: track.getBoundingClientRect().right,
    };
  });
  // NEREID carries 15,600 - more than six times the constant the bar used to
  // divide by, which ran the fill clean off the side of the screen.
  expect(fits.fill).toBeLessThanOrEqual(fits.track + 1);
  expect(fits.right).toBeLessThanOrEqual(fits.page);
  expect(fits.fill).toBeGreaterThan(fits.track * 0.9);
});
test.describe('phone held sideways', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true });
  test('takes the whole screen on launch and keeps the HUD controls small', async ({ page }) => {
    // The address bar costs a fifth of a landscape phone screen.
    await page.addInitScript(() => {
      (window as unknown as { fsCalls: number }).fsCalls = 0;
      (
        Element.prototype as unknown as { requestFullscreen: () => Promise<void> }
      ).requestFullscreen = () => {
        (window as unknown as { fsCalls: number }).fsCalls++;
        return Promise.resolve();
      };
    });
    await page.goto('/?webgl=1');
    await expect(page.getByRole('button', { name: 'BEGIN SORTIE 출격 준비' })).toBeEnabled({
      timeout: 45000,
    });
    await page.getByRole('button', { name: 'BEGIN SORTIE 출격 준비' }).click();
    await page.getByRole('button', { name: '출격 · LAUNCH MISSION' }).click();
    await expect(page.locator('.play-frame')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { fsCalls: number }).fsCalls)).toBe(1);
    // And the player can hand the screen back.
    await expect(page.getByRole('button', { name: /전체화면|창 모드/ })).toBeVisible();
    const strip = await page.locator('.hud.top-right > div').boundingBox();
    expect(strip!.height).toBeGreaterThanOrEqual(44);
    expect(strip!.height).toBeLessThanOrEqual(46);
    expect(strip!.width).toBeLessThanOrEqual(300);
  });
});
test('mobile landscape touch and portrait pause overlay', async ({ page }) => {
  await page.setViewportSize({ width: 932, height: 430 });
  await page.goto('/?webgl=1');
  await expect(page.getByRole('button', { name: 'BEGIN SORTIE 출격 준비' })).toBeEnabled({
    timeout: 45000,
  });
  await page.screenshot({ path: 'test-results/mobile-hangar.png' });
  await page.getByRole('button', { name: 'BEGIN SORTIE 출격 준비' }).click();
  await page.getByRole('button', { name: '출격 · LAUNCH MISSION' }).click();
  await page
    .locator('canvas')
    .dispatchEvent('pointerdown', { pointerId: 1, clientX: 200, clientY: 200 });
  await page
    .locator('canvas')
    .dispatchEvent('pointermove', { pointerId: 1, clientX: 250, clientY: 150 });
  await page.locator('canvas').dispatchEvent('pointerup', { pointerId: 1 });
  await page.setViewportSize({ width: 430, height: 932 });
  await expect(page.getByText('가로로 돌려주세요', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 932, height: 430 });
  await expect(page.getByRole('dialog', { name: 'FLIGHT PAUSED' })).toBeVisible();
});

test.describe('mobile touch device', () => {
  test.use({ hasTouch: true, isMobile: true });
  test('touch steering survives multiple fingers and capture loss in recorded gameplay', async ({
    page,
  }) => {
    let events: number[][] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/finish')) events = request.postDataJSON().events;
    });
    await page.setViewportSize({ width: 932, height: 430 });
    await page.goto('/?webgl=1');
    await page.getByRole('button', { name: 'BEGIN SORTIE 출격 준비' }).click();
    await page.getByRole('button', { name: '출격 · LAUNCH MISSION' }).click();
    await expect(page.locator('.play-frame')).toBeVisible();
    const canvas = page.locator('canvas');
    await canvas.dispatchEvent('pointerdown', {
      pointerId: 21,
      pointerType: 'touch',
      clientX: 750,
      clientY: 200,
    });
    await canvas.dispatchEvent('pointerdown', {
      pointerId: 22,
      pointerType: 'touch',
      clientX: 400,
      clientY: 200,
    });
    await canvas.dispatchEvent('pointermove', {
      pointerId: 21,
      pointerType: 'touch',
      clientX: 780,
      clientY: 170,
    });
    await page.waitForTimeout(150);
    await canvas.dispatchEvent('lostpointercapture', { pointerId: 21 });
    await canvas.dispatchEvent('pointermove', {
      pointerId: 21,
      pointerType: 'touch',
      clientX: 750,
      clientY: 200,
    });
    await page.waitForTimeout(150);
    await canvas.dispatchEvent('pointerup', { pointerId: 21 });
    await canvas.dispatchEvent('pointermove', {
      pointerId: 22,
      pointerType: 'touch',
      clientX: 430,
      clientY: 230,
    });
    await page.waitForTimeout(150);
    await canvas.dispatchEvent('pointercancel', { pointerId: 22 });
    await page.getByRole('button', { name: '일시정지', exact: true }).click();
    await page.getByRole('button', { name: '출격 포기 · 격납고로' }).click();
    await expect.poll(() => events.length).toBeGreaterThan(0);
    const movement = events.filter((e) => e[0] === 0 && (e[3] || e[4]));
    expect(movement.some((e) => e[3] > 0 && e[4] > 0)).toBe(true);
    expect(movement.some((e) => e[3] < 0 && e[4] < 0)).toBe(true);
    expect(movement.some((e) => e[3] > 0 && e[4] < 0)).toBe(true);
  });
});
