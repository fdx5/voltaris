/**
 * Draws the VOLTARIS mark: the install icons and the link-preview cover.
 *
 * The mark is a lance-shaped V - two blades meeting at a point, with the
 * cross-stroke that reads as a chevron at small sizes - inside a skewed frame,
 * matching the header lockup. Everything is authored here as SVG so there are
 * no remote assets and no font dependency: glyphs are drawn as paths.
 *
 *   node tools/create-icons.mjs            icons only
 *   node tools/create-icons.mjs --cover    icons and og-cover.png
 *
 * The cover composites a real frame of the game, captured into
 * `test-results/cover.png` by `npx playwright test cover`, so the preview shows
 * the game rather than a title card. Without that file it falls back to a
 * plain gradient.
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import sharp from 'sharp';

const MINT = '#7ff0d8';
const PAPER = '#eff5f7';
const INK = '#070c12';

/** The V, drawn as a path so no font has to be installed. */
const lance = (cx, cy, w, h, fill) => {
  const half = w / 2;
  const inner = w * 0.17;
  return `<path fill="${fill}" d="
    M ${cx - half} ${cy - h / 2}
    L ${cx - half + inner} ${cy - h / 2}
    L ${cx} ${cy + h / 2 - inner * 1.15}
    L ${cx + half - inner} ${cy - h / 2}
    L ${cx + half} ${cy - h / 2}
    L ${cx + inner * 0.6} ${cy + h / 2}
    L ${cx - inner * 0.6} ${cy + h / 2}
    Z" />`;
};

const icon = (size) => {
  const frame = size * 0.16;
  const stroke = Math.max(2, size * 0.028);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" fill="${INK}" />
    <g transform="skewX(-9) translate(${size * 0.07} 0)">
      <rect x="${frame}" y="${frame}" width="${size - frame * 2}" height="${size - frame * 2}"
        fill="none" stroke="${MINT}" stroke-width="${stroke}" />
      ${lance(size / 2, size / 2, size * 0.42, size * 0.44, PAPER)}
    </g>
  </svg>`);
};

await mkdir('public/icons', { recursive: true });
for (const size of [192, 512])
  await sharp(icon(size)).png().toFile(`public/icons/icon-${size}.png`);
console.log('icons  public/icons/icon-192.png, icon-512.png');

if (!process.argv.includes('--cover')) process.exit(0);

/* --- Link preview cover ---------------------------------------------- */
const W = 1200,
  H = 630;
const shot = 'test-results/cover.png';
const hasShot = await access(shot).then(
  () => true,
  () => false,
);
// The capture is 1440x900; crop the band the ship flies through, not the HUD.
const plate = hasShot
  ? await sharp(shot)
      .extract({ left: 0, top: 150, width: 1440, height: 630 })
      .resize(W, H, { fit: 'cover' })
      .modulate({ brightness: 0.82, saturation: 1.06 })
      .toBuffer()
  : await sharp({
      create: { width: W, height: H, channels: 4, background: INK },
    })
      .png()
      .toBuffer();

const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="wash" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${INK}" stop-opacity="0.94" />
      <stop offset="0.52" stop-color="${INK}" stop-opacity="0.66" />
      <stop offset="1" stop-color="${INK}" stop-opacity="0.12" />
    </linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${INK}" stop-opacity="0" />
      <stop offset="1" stop-color="${INK}" stop-opacity="0.85" />
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#wash)" />
  <rect y="${H * 0.62}" width="${W}" height="${H * 0.38}" fill="url(#floor)" />
  <g transform="translate(78 92) skewX(-9)">
    <rect x="0" y="0" width="86" height="86" fill="none" stroke="${MINT}" stroke-width="3" />
    ${lance(43, 44, 40, 42, PAPER)}
  </g>
  <text x="78" y="330" font-family="Arial Black, Arial, sans-serif" font-size="118"
    font-weight="900" font-style="italic" letter-spacing="-5" fill="${PAPER}">VOLT<tspan
    fill="${MINT}">ARIS</tspan></text>
  <text x="82" y="382" font-family="Arial, sans-serif" font-size="21" letter-spacing="9"
    fill="#bed0d9">THE SILENCE ENDS HERE</text>
  <text x="82" y="446" font-family="Arial, sans-serif" font-size="25" fill="#9fb6c4">
    지구 · 화성 · 목성 · 해왕성 4개 섹터를 돌파하는 3D 횡스크롤 슈팅</text>
  <g fill="none" stroke="${MINT}" stroke-width="2" opacity="0.85">
    <path d="M78 490 h150" />
  </g>
  <text x="78" y="533" font-family="Arial, sans-serif" font-size="19" letter-spacing="4"
    fill="#7f96a6">WEBGPU · WEBGL 2 · ORIGINAL ARCADE SHOOTER</text>
</svg>`);

await sharp(plate)
  .composite([{ input: overlay }])
  .png()
  .toFile('public/og-cover.png');
console.log('cover  public/og-cover.png');
