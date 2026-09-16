/**
 * Downloads the external imagery the backdrop needs into public/textures/.
 *
 * Earth comes from the three.js example assets (NASA Visible Earth / Blue
 * Marble derivatives, public domain). The star sky is generated here rather
 * than downloaded: the panorama this script used to pull from the three.js
 * repo is no longer a galaxy, it is a photograph of a derelict room, and its
 * windows and wall panels were showing through the backdrop of every stage. Mars, Jupiter and Neptune come from
 * Solar System Scope (CC BY 4.0 - https://www.solarsystemscope.com/textures).
 * Asteroid and ice surfaces
 * come from Poly Haven (CC0). Sources ship at 1-8K and are resized here to
 * what a backdrop actually needs.
 *
 * Section 5's galaxy backdrop is a real ESO VLT photograph of NGC 1232, a
 * grand-design spiral (CC BY 4.0 - https://www.eso.org/public/images/eso9845d/,
 * credit ESO) standing in for "our galaxy's shape" - no photograph of the
 * Milky Way's own face-on shape exists, since we're inside it.
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
  // The hero backdrop of a 6-minute stage, panned slowly across the whole
  // screen, so it keeps far more resolution than any other texture here.
  ['https://cdn.eso.org/images/large/eso9845d.jpg', 'space/galaxy.jpg', 4096, null, 90],
];

/**
 * Poly Haven slugs for the asteroids, two per belt class plus the hazard
 * rocks. Photographed bare rock, CC0. Each comes down from the 2K source with
 * its normal map: at 512px and colour only, a close body read as a smooth
 * painted ball, and the relief is what sells a rock as a rock.
 */
const rocks = [
  'gray_rocks',
  'dark_rock',
  'rock_06',
  'marble_rock_02',
  'rock_04',
  'cliff_side',
  'rock_boulder_cracked',
  'rock_face',
  'rock_05',
];
for (const slug of rocks) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${slug}`)).json();
  assets.push([files.Diffuse['2k'].jpg.url, `rocks/${slug}.jpg`, 1024, null, 85]);
  assets.push([files.nor_gl['2k'].jpg.url, `rocks/${slug}_nor.jpg`, 1024, null, 82]);
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

/* --- Star sky ---------------------------------------------------------- *
 * Drawn here, not downloaded. It is an equirectangular panorama: x wraps
 * once around the sky, y runs pole to pole, and the galactic band is laid
 * along a great circle so the arc reads as a band rather than as a stripe
 * across the equator. Seeded, so every run produces the same sky.
 */
const skyPath = join(out, 'space/starfield.jpg');
if (force || !(await exists(skyPath))) {
  const W = 2048,
    H = 1024;
  const px = Buffer.alloc(W * H * 3);
  let seed = 20260911;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  // Value noise on a coarse lattice, sampled smoothly: dust lanes in the band.
  const N = 96;
  const lattice = new Float32Array(N * N);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rnd();
  const noise = (u, v) => {
    const x = u * N,
      y = v * N;
    const x0 = Math.floor(x),
      y0 = Math.floor(y);
    const fx = x - x0,
      fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx),
      sy = fy * fy * (3 - 2 * fy);
    const at = (a, b) => lattice[(((b % N) + N) % N) * N + (((a % N) + N) % N)];
    const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
    const bot = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
    return top * (1 - sy) + bot * sy;
  };
  const tilt = 0.42; // radians the band is tilted off the equator
  for (let y = 0; y < H; y++) {
    const dec = (0.5 - y / H) * Math.PI; // -pi/2 .. pi/2
    for (let x = 0; x < W; x++) {
      const ra = (x / W) * Math.PI * 2;
      // Distance from the tilted great circle, in radians.
      const band = Math.abs(
        Math.asin(
          Math.max(
            -1,
            Math.min(
              1,
              Math.sin(dec) * Math.cos(tilt) - Math.cos(dec) * Math.sin(tilt) * Math.sin(ra),
            ),
          ),
        ),
      );
      const core = Math.exp(-((band / 0.32) ** 2));
      const halo = Math.exp(-((band / 0.9) ** 2)) * 0.45;
      // Dust: the lanes that break the band up, strongest along its spine.
      const dust = noise(x / W + 0.13, y / H) * noise((x / W) * 2.7, (y / H) * 2.7 + 0.5);
      const glow = Math.max(0, core * (0.62 + dust * 0.9) + halo * (0.5 + dust * 0.6));
      const i = (y * W + x) * 3;
      px[i] = Math.min(255, 6 + glow * 96);
      px[i + 1] = Math.min(255, 8 + glow * 104);
      px[i + 2] = Math.min(255, 14 + glow * 132);
    }
  }
  // Stars: dense in the band, thinner away from it, a few bright and coloured.
  const tint = [
    [255, 255, 255],
    [206, 226, 255],
    [255, 233, 200],
    [255, 206, 190],
    [216, 208, 255],
  ];
  for (let n = 0; n < 42000; n++) {
    const x = Math.floor(rnd() * W);
    // Sample declination by area so the poles do not clot with stars.
    const dec = Math.asin(rnd() * 2 - 1);
    const y = Math.floor((0.5 - dec / Math.PI) * H) % H;
    const ra = (x / W) * Math.PI * 2;
    const band = Math.abs(
      Math.asin(
        Math.max(
          -1,
          Math.min(
            1,
            Math.sin(dec) * Math.cos(tilt) - Math.cos(dec) * Math.sin(tilt) * Math.sin(ra),
          ),
        ),
      ),
    );
    if (rnd() > 0.24 + Math.exp(-((band / 0.5) ** 2)) * 0.76) continue;
    const mag = rnd() ** 3.4;
    const level = 60 + mag * 195;
    const [r, g, b] = tint[Math.floor(rnd() * tint.length)];
    const spread = mag > 0.72 ? 1 : 0;
    for (let dy = -spread; dy <= spread; dy++)
      for (let dx = -spread; dx <= spread; dx++) {
        const fall = dx || dy ? 0.32 : 1;
        const yy = y + dy,
          xx = (x + dx + W) % W;
        if (yy < 0 || yy >= H) continue;
        const i = (yy * W + xx) * 3;
        px[i] = Math.min(255, px[i] + ((r * level) / 255) * fall);
        px[i + 1] = Math.min(255, px[i + 1] + ((g * level) / 255) * fall);
        px[i + 2] = Math.min(255, px[i + 2] + ((b * level) / 255) * fall);
      }
  }
  await mkdir(dirname(skyPath), { recursive: true });
  await sharp(px, { raw: { width: W, height: H, channels: 3 } })
    .jpeg({ quality: 92 })
    .toFile(skyPath);
  console.log('draw   space/starfield.jpg');
} else console.log('skip   space/starfield.jpg');
