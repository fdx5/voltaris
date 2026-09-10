import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  args: ['--enable-gpu', '--use-angle=d3d11'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const started = performance.now();
await page.goto('http://localhost:5173/');
await page.getByRole('button', { name: 'BEGIN SORTIE 출격 준비' }).waitFor({ timeout: 60000 });
const readyMs = performance.now() - started;
const gpu = await page.evaluate(() => {
  const canvas = document.createElement('canvas'),
    gl = canvas.getContext('webgl2');
  if (!gl) return 'unavailable';
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const value = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return value;
});
await page.getByRole('button', { name: '테스트 랩' }).click();
await page.getByLabel('테스트 화질').selectOption('HIGH');
await page.waitForTimeout(8000);
const samples = [];
for (let i = 0; i < 10; i++) {
  samples.push(await page.locator('.metrics').innerText());
  await page.waitForTimeout(500);
}
const backend = await page.locator('.lab .fine').innerText();
await page.screenshot({ path: 'test-results/hardware-stress.png' });
await mkdir('doc/validation', { recursive: true });
await writeFile(
  'doc/validation/desktop-performance.json',
  JSON.stringify(
    {
      gpu,
      backend,
      readyMs,
      viewport: '1440x810',
      bullets: 1500,
      ships: 20,
      bloom: true,
      quality: 'HIGH',
      samples,
      errors,
      measurement:
        'Automated headless Chromium hardware path, Vite development server. Not Android/iOS or 4G validation.',
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ gpu, backend, readyMs, samples, errors }, null, 2));
await browser.close();
