/**
 * Downloads the external imagery the backdrop needs into public/textures/.
 *
 * Earth and sky come from the three.js example assets (NASA Visible Earth /
 * Blue Marble derivatives, public domain). Mars, Jupiter and Neptune come from
 * Solar System Scope (CC BY 4.0 - https://www.solarsystemscope.com/textures).
 * Asteroid and ice surfaces
 * come from Poly Haven (CC0). Sources ship at 1-8K and are resized here to
 * what a backdrop actually needs.
 *
 * Re-runnable: existing files are skipped unless --force is passed.
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public/textures');
const force = process.argv.includes('--force');

const three = 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures';
/**
 * [remote url, local path, resize width or 0 to keep as-is, optional tone pass,
 * optional jpeg quality]. The tone pass runs before the resize and is how a
 * photographed surface is turned into the material a scene actually needs.
 */
const assets = [
  [`${three}/planets/earth_atmos_2048.jpg`, 'planets/earth_color.jpg', 0],
  [`${three}/planets/earth_specular_2048.jpg`, 'planets/earth_specular.jpg', 0],
  [`${three}/planets/earth_normal_2048.jpg`, 'planets/earth_normal.jpg', 0],
  [`${three}/planets/earth_clouds_1024.png`, 'planets/earth_clouds.png', 0],
  [`${three}/planets/earth_lights_2048.png`, 'planets/earth_lights.png', 0],
  [`${three}/planets/moon_1024.jpg`, 'planets/moon_color.jpg', 0],
  [`${three}/2294472375_24a3b8ef46_o.jpg`, 'space/milkyway.jpg', 0],
  // Mars ships at 2K; a backdrop planet never needs more than half of that.
  [
    'https://www.solarsystemscope.com/textures/download/2k_mars.jpg',
    'planets/mars_color.jpg',
    1536,
  ],
  [
    'https://www.solarsystemscope.com/textures/download/2k_jupiter.jpg',
    'planets/jupiter_color.jpg',
    2048,
  ],
  [
    'https://www.solarsystemscope.com/textures/download/2k_neptune.jpg',
    'planets/neptune_color.jpg',
    1536,
  ],
];

// Poly Haven slugs, one per asteroid class. Photographed bare rock, CC0.
const rocks = [
  'gray_rocks',
  'dark_rock',
  'rock_06',
  'marble_rock_02',
  'rock_04',
  // Ice for the Neptune cave. `frozen_lake` on Poly Haven is an HDRI, not a
  // surface, so the cave uses packed snow and tints it for ice.
  'snow_02',
];
for (const slug of rocks) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${slug}`)).json();
  assets.push([files.Diffuse['1k'].jpg.url, `rocks/${slug}.jpg`, 512]);
}

/**
 * Terrain surfaces. A stage floor is magnified perhaps fifty times more than
 * an asteroid ever is, so these come down from the 2K source rather than the
 * 1K one and bring their normal map: at that magnification a flat albedo
 * reads as painted plastic no matter how good the photograph is.
 */
const surfaces = [
  {
    // Fractured rock slabs stand in for glacial ice far better than packed
    // snow does - snow photographs as a flat grey mush. Stripping the colour,
    // pushing the crevices dark and cooling the result gives blue shelf ice.
    slug: 'rocks_ground_04',
    name: 'glacier_ice',
    tone: (image) => image.grayscale().linear(1.45, -34).tint('#cddff0'),
  },
];
for (const s of surfaces) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${s.slug}`)).json();
  assets.push([files.Diffuse['2k'].jpg.url, `surfaces/${s.name}.jpg`, 1536, s.tone, 86]);
  // The normal map is data, not a picture: it is never toned, and it is kept
  // at half the albedo's size because its detail is all low frequency.
  assets.push([files.nor_gl['2k'].jpg.url, `surfaces/${s.name}_nor.jpg`, 1024, null, 80]);
}

const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );

for (const [url, local, width, tone, quality = 80] of assets) {
  const target = join(out, local);
  if (!force && (await exists(target))) {
    console.log('skip  ', local);
    continue;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  let bytes = Buffer.from(await res.arrayBuffer());
  if (width) {
    // Equirectangular maps keep their 2:1 shape; square rock tiles are cropped.
    const image = sharp(bytes);
    const meta = await image.metadata();
    const height = meta.width === meta.height * 2 ? width / 2 : width;
    bytes = await (tone ? tone(image) : image)
      .resize(width, height, { fit: 'cover' })
      .jpeg({ quality })
      .toBuffer();
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  console.log('fetch ', local, (bytes.length / 1024).toFixed(0) + ' KB');
}
