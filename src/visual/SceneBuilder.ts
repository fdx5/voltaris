import * as T from 'three/webgpu';
import {
  color,
  normalWorld,
  positionWorld,
  cameraPosition,
  float,
  vec3,
  uv,
  texture,
  mix,
  mx_fractal_noise_float,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Random } from '../core/math/Random';
import { Terrain } from '../core/math/Terrain';
import enemyDefs from '../../data/enemies/enemy-defs.json';

const metal = (c: string, roughness = 0.4) =>
  new T.MeshStandardNodeMaterial({ color: c, metalness: 0.8, roughness });

export function glow(c: string, intensity = 2) {
  const m = new T.MeshBasicNodeMaterial({ color: c, toneMapped: false });
  m.colorNode = color(c).mul(intensity);
  return m;
}

/* ------------------------------------------------------------------ *
 * Player ship
 * ------------------------------------------------------------------ */
export function makeShip() {
  const root = new T.Group(),
    k = new Kit();
  const ceramic = '#eff7ef',
    blue = '#256cba',
    copper = '#ecaa67';
  // Forward-facing arrowhead with separated swept outriggers and a raised canopy.
  k.add(
    armour(
      [
        [1.42, 0],
        [0.2, -0.24],
        [-1.1, -0.19],
        [-0.8, 0],
        [-1.1, 0.19],
        [0.2, 0.24],
      ],
      0.2,
    ),
    ceramic,
  );
  for (const side of [-1, 1]) {
    k.add(
      armour(
        [
          [0.63, side * 0.2],
          [-0.58, side * 1.06],
          [-1.25, side * 0.88],
          [-0.78, side * 0.62],
          [-0.34, side * 0.28],
        ],
        0.1,
        -0.05,
      ),
      blue,
    );
    k.add(
      armour(
        [
          [-0.26, side * 0.32],
          [-0.78, side * 0.77],
          [-1.05, side * 0.73],
          [-0.64, side * 0.42],
        ],
        0.055,
        0.09,
      ),
      ceramic,
    );
    k.add(
      armour(
        [
          [0.73, side * 0.15],
          [0.32, side * 0.52],
          [0.06, side * 0.43],
          [0.3, side * 0.16],
        ],
        0.07,
        0.09,
      ),
      copper,
    );
    k.add(tube(0.09, 0.16, 0.83, 12, -0.76, side * 0.53, 0), '#24405c');
    k.add(tube(0.03, 0.05, 0.86, 10, 0.04, side * 0.66, 0.08), ceramic);
    k.lit(box(0.46, 0.026, 0.025, -0.65, side * 0.79, 0.17), '#6cf1ff', 1.7);
    const flame = new T.Mesh(new T.ConeGeometry(0.12, 0.95, 12), glow('#85eeff', 2.2));
    flame.rotation.z = Math.PI / 2;
    flame.position.set(-1.55, side * 0.53, 0);
    flame.name = 'exhaust';
    root.add(flame);
  }
  k.add(orb(0.22, 0.3, 0, 0.22, 1.9, 0.6, 0.65), '#143655');
  k.lit(box(0.42, 0.025, 0.025, 0.3, 0, 0.37), '#85efff', 1.5);
  for (let j = 0; j < 5; j++) k.add(box(0.04, 0.22, 0.035, -0.33 - j * 0.1, 0, 0.25), blue);
  attachKit(root, k, 0.4, 0.3);
  return root;
}

/* ------------------------------------------------------------------ *
 * Enemy fleet - 34 individually fitted hulls
 *
 * Every hull is authored nose first along -X (enemies fly right to left).
 * Parts carry their colour in a vertex attribute, so a whole type renders
 * as two instanced draw calls: a lit hull and an additive accent pass.
 * Accent colours are written above 1.0 so the bloom pass catches them.
 * ------------------------------------------------------------------ */
export const ENEMY_TYPES = 44;

const linear = new T.Color();
function paint(g: T.BufferGeometry, hex: string, gain = 1) {
  linear.set(hex);
  const n = g.attributes.position.count,
    a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = linear.r * gain;
    a[i * 3 + 1] = linear.g * gain;
    a[i * 3 + 2] = linear.b * gain;
  }
  g.setAttribute('color', new T.BufferAttribute(a, 3));
  return g;
}

function weld(parts: T.BufferGeometry[]) {
  if (!parts.length) return null;
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const merged = mergeGeometries(flat);
  parts.forEach((p) => p.dispose());
  flat.forEach((p) => p.dispose());
  if (!merged) throw new Error('Enemy geometry merge failed');
  return merged;
}

/** Collects painted primitives, then welds them into hull + accent buffers. */
class Kit {
  private readonly hull: T.BufferGeometry[] = [];
  private readonly accent: T.BufferGeometry[] = [];
  hex = '#5c6a78';
  trim = '#39485a';
  lamp = '#ff6a52';
  add(g: T.BufferGeometry, hex = this.hex) {
    // Color already converts CSS sRGB to linear; keep the armour below
    // emissive accents so bevels and dark recesses remain readable.
    this.hull.push(paint(g, hex, 1.25));
    return this;
  }
  lit(g: T.BufferGeometry, hex = this.lamp, gain = 2.6) {
    this.accent.push(paint(g, hex, gain));
    return this;
  }
  /** Mirrors a builder across Y so silhouettes stay symmetric. */
  pair(build: (side: number) => void) {
    build(-1);
    build(1);
    return this;
  }
  build() {
    return { hull: weld(this.hull), accent: weld(this.accent) };
  }
}

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0, rz = 0) => {
  const g = new T.BoxGeometry(w, h, d);
  if (rz) g.rotateZ(rz);
  return g.translate(x, y, z);
};
/** A cone laid on its side; the tip points along -X, i.e. forwards. */
/** A gun barrel: a cylinder laid along -X and swung up by `rz`. */
const rod = (r: number, len: number, x = 0, y = 0, z = 0, rz = 0) => {
  const g = new T.CylinderGeometry(r, r * 1.2, len, 8);
  g.rotateZ(Math.PI / 2 + rz);
  return g.translate(x, y, z);
};

const spike = (r: number, len: number, seg: number, x = 0, y = 0, z = 0) => {
  const g = new T.ConeGeometry(r, len, seg);
  g.rotateZ(Math.PI / 2);
  return g.translate(x, y, z);
};
const tube = (r0: number, r1: number, len: number, seg: number, x = 0, y = 0, z = 0) => {
  const g = new T.CylinderGeometry(r0, r1, len, seg);
  g.rotateZ(Math.PI / 2);
  return g.translate(x, y, z);
};
const disc = (r: number, t: number, seg: number, x = 0, y = 0, z = 0) => {
  const g = new T.CylinderGeometry(r, r, t, seg);
  g.rotateX(Math.PI / 2);
  return g.translate(x, y, z);
};
const ring = (r: number, t: number, seg: number, x = 0, y = 0, z = 0) =>
  new T.TorusGeometry(r, t, 8, seg).translate(x, y, z);
const orb = (r: number, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => {
  const g = new T.SphereGeometry(r, 14, 10);
  g.scale(sx, sy, sz);
  return g.translate(x, y, z);
};
const gem = (r: number, detail: number, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => {
  const g = new T.IcosahedronGeometry(r, detail);
  g.scale(sx, sy, sz);
  return g.translate(x, y, z);
};

export type EnemyHulls = { hull: T.BufferGeometry | null; accent: T.BufferGeometry | null };

// Every entry has its own topology, palette and surface finish.
export const FLEET_STYLE = [
  ['SKIFF', '#f2eee0', '#d34226', '#8aefff', 0.35, 0.48],
  ['LANCER', '#a82145', '#eac67a', '#ffbb55', 0.8, 0.28],
  ['CARRIER', '#e2ac32', '#284659', '#a9f5c2', 0.45, 0.62],
  ['WARDEN', '#284b88', '#c1d4df', '#ff735b', 0.75, 0.34],
  ['WASP', '#ded749', '#252439', '#ff62e5', 0.3, 0.45],
  ['SPINNER', '#41b994', '#edfaf1', '#c6ff76', 0.65, 0.22],
  ['MORTAR', '#ba5a27', '#e9c8a0', '#ffc15d', 0.65, 0.65],
  ['SHARD', '#6ecbde', '#346095', '#e5faff', 0.9, 0.13],
  ['SENTRY', '#e7ddd1', '#783d52', '#ff4479', 0.25, 0.6],
  ['RAVEN', '#564683', '#b794dc', '#63ffd5', 0.55, 0.3],
  ['HYDRA', '#55a579', '#d6bc75', '#e5ff82', 0.3, 0.52],
  ['BULWARK', '#d5aa70', '#5b443b', '#6febff', 0.55, 0.7],
  ['SEEKER', '#ec7254', '#f3e2ce', '#ffed87', 0.2, 0.4],
  ['MANTIS', '#89bd4b', '#37534d', '#dcff98', 0.4, 0.44],
  ['DRILL', '#a8bbc8', '#e77c24', '#fff0a5', 0.95, 0.25],
  ['MONOLITH', '#484461', '#d6bfdc', '#cb7bff', 0.75, 0.2],
  ['SWARMER', '#c7529a', '#f3c7d8', '#ffe2a0', 0.25, 0.55],
  ['ARBITER', '#e3d29a', '#437b94', '#92f8ff', 0.8, 0.3],
  ['SCOURGE', '#8c3048', '#cd8966', '#ffad78', 0.45, 0.65],
  ['HALBERD', '#5c94ce', '#e3eaf3', '#a9dfff', 0.85, 0.22],
  ['CINDER', '#e35728', '#592d4b', '#fff19a', 0.2, 0.75],
  ['TALON', '#2ab7c4', '#f4d29e', '#a1ffff', 0.7, 0.32],
  ['VULTURE', '#b9a981', '#4d7369', '#ffc65c', 0.3, 0.72],
  ['SIREN', '#a688e2', '#ebdff4', '#ffb1e7', 0.55, 0.18],
  ['BASILISK', '#25776f', '#bccf86', '#ceff77', 0.35, 0.57],
  ['COMET', '#f8cc70', '#e97381', '#fff8d0', 0.6, 0.3],
  ['GORGON', '#c07cba', '#574577', '#99ffc4', 0.3, 0.43],
  ['ANVIL', '#7d869b', '#f4af46', '#ffdda2', 0.85, 0.6],
  ['WRAITH', '#396b89', '#c3ede9', '#72ffdc', 0.6, 0.15],
  ['TEMPEST', '#789aea', '#dceaff', '#c3bdff', 0.75, 0.2],
  ['CHIMERA', '#d19450', '#448f9c', '#f7ffa8', 0.55, 0.48],
  ['OBELISK', '#cec5ad', '#81674b', '#79dfff', 0.4, 0.72],
  ['NOVA', '#db78a8', '#f7d9b0', '#fff3c9', 0.65, 0.24],
  ['LEVIATHAN', '#315b78', '#7dccbc', '#ff9575', 0.5, 0.4],
  // Stage 4: the ice cave wing. Small, medium and heavy, in that order.
  ['SLEET', '#cfe9f5', '#3f6d8c', '#9df3ff', 0.55, 0.2],
  ['GLIMMER', '#9fe3d8', '#2f5d6b', '#b6fff0', 0.65, 0.18],
  ['SHIVER', '#7fb4e0', '#26405c', '#d8f2ff', 0.5, 0.24],
  ['RIME', '#e6f2ff', '#547b9a', '#a8e0ff', 0.45, 0.42],
  ['FLOE', '#8fc4d6', '#31586e', '#c4fbff', 0.6, 0.46],
  ['CRYSTAL', '#b6d8ff', '#3a4f8c', '#8fb0ff', 0.8, 0.3],
  ['HOARFROST', '#dce9ef', '#4a6a7c', '#7fffe0', 0.4, 0.5],
  ['CALVING', '#6f9fc4', '#22384f', '#a6d8ff', 0.55, 0.66],
  ['MORAINE', '#a9b8c4', '#3d4a58', '#ffd88f', 0.5, 0.7],
  ['GLACIER', '#8fb8d4', '#20344a', '#bfefff', 0.6, 0.85],
] as const;

/** Mechanical ribs, recessed armour and lenses follow the authored shape. */
function uniqueHull(k: Kit, type: number) {
  const [, main, trim, lamp] = FLEET_STYLE[type];
  k.hex = main;
  k.trim = trim;
  k.lamp = lamp;
  const plate = (p: number[][], z = 0, d = 0.18, c: string = main) => k.add(armour(p, d, z), c);
  const bar = (
    x: number,
    y: number,
    xx: number,
    yy: number,
    w = 0.1,
    c: string = trim,
    z = 0.05,
  ) => {
    k.add(
      box(
        Math.hypot(xx - x, yy - y),
        w,
        0.13,
        (x + xx) / 2,
        (y + yy) / 2,
        z,
        Math.atan2(yy - y, xx - x),
      ),
      c,
    );
  };
  const eye = (x = 0, y = 0, r = 0.1) => {
    const z = [3, 8, 27, 33].includes(type) ? 0.6 : 0.32;
    k.add(disc(r * 1.55, 0.1, 12, x, y, z - 0.07), '#182837');
    k.lit(disc(r, 0.025, 16, x, y, z), lamp, 1.8);
    Object.assign(ENEMY_CORE[type], { x, y, z: z + 0.03 });
  };
  const pod = (x: number, y: number, r = 0.15) => {
    k.add(tube(r * 0.7, r, 0.45, 10, x, y, 0), trim);
    k.lit(disc(r * 0.6, 0.04, 10, x + 0.22, y, 0.08), lamp, 1.5);
  };
  const arc = (r: number, start: number, end: number, w = 0.14, c: string = main, z = 0) => {
    const p: number[][] = [];
    for (let i = 0; i <= 20; i++) {
      const a = start + ((end - start) * i) / 20;
      p.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    for (let i = 20; i >= 0; i--) {
      const a = start + ((end - start) * i) / 20;
      p.push([Math.cos(a) * (r - w), Math.sin(a) * (r - w)]);
    }
    plate(p, z, 0.15, c);
  };
  switch (type) {
    case 0: // Offset racing blade: one long wing, one cropped stabiliser.
      plate([
        [-1, 0],
        [0.72, -0.22],
        [0.45, 0.18],
        [0.8, 0.85],
        [0.15, 0.7],
        [-0.3, 0.16],
      ]);
      plate(
        [
          [-0.6, 0.03],
          [0.58, -0.12],
          [0.21, 0.12],
        ],
        0.2,
        0.055,
        trim,
      );
      pod(0.53, 0.47);
      eye(-0.22, 0.02);
      break;
    case 1: // Tuning fork railgun, empty slot between two lances.
      for (const s of [-1, 1]) {
        plate([
          [-1.15, s * 0.38],
          [0.75, s * 0.52],
          [0.9, s * 0.15],
          [0.22, s * 0.12],
          [-0.72, s * 0.22],
        ]);
        bar(-0.8, s * 0.31, 0.5, s * 0.32, 0.055);
        pod(0.64, s * 0.36);
      }
      bar(0.45, -0.4, 0.45, 0.4, 0.2);
      eye(0.45);
      break;
    case 2: // Open rectangular cargo cradle with three suspended containers.
      bar(-0.8, -0.62, 0.9, -0.62, 0.16);
      bar(-0.8, 0.62, 0.9, 0.62, 0.16);
      bar(0.9, -0.62, 0.9, 0.62, 0.18);
      for (let i = 0; i < 3; i++) {
        const x = -0.55 + i * 0.5;
        plate(
          [
            [x - 0.18, -0.4],
            [x + 0.18, -0.4],
            [x + 0.18, 0.4],
            [x - 0.18, 0.4],
          ],
          0,
          0.3,
          i % 2 ? trim : main,
        );
        bar(x - 0.1, -0.3, x - 0.1, 0.3, 0.045, '#263a46', 0.34);
      }
      eye(0.9);
      pod(1, -0.55);
      pod(1, 0.55);
      break;
    case 3: // Broad shield with a deep forward notch and four battlements.
      plate(
        [
          [-0.7, -0.9],
          [0.3, -1],
          [0.85, -0.65],
          [0.85, 0.65],
          [0.3, 1],
          [-0.7, 0.9],
          [-0.35, 0.32],
          [-0.8, 0],
          [-0.35, -0.32],
        ],
        0,
        0.38,
      );
      plate(
        [
          [0.1, -0.68],
          [0.65, -0.48],
          [0.65, 0.48],
          [0.1, 0.68],
          [-0.25, 0],
        ],
        0.4,
        0.12,
        trim,
      );
      for (const s of [-1, 1]) {
        bar(-0.55, s * 0.7, 0.65, s * 0.7, 0.12);
        pod(0.7, s * 0.7, 0.22);
      }
      eye(-0.45, 0, 0.17);
      break;
    case 4: // Insect abdomen with four detached-looking narrow sail wings.
      k.add(orb(0.28, 0, 0, 0, 1.6, 0.7, 0.7));
      for (const s of [-1, 1]) {
        plate(
          [
            [-0.38, s * 0.12],
            [-0.8, s * 0.8],
            [-0.24, s * 0.61],
            [0.09, s * 0.15],
          ],
          0,
          0.08,
        );
        plate(
          [
            [0.1, s * 0.12],
            [0.25, s * 0.83],
            [0.65, s * 0.7],
            [0.38, s * 0.12],
          ],
          0,
          0.08,
          trim,
        );
      }
      pod(0.5, 0, 0.13);
      eye(-0.32);
      break;
    case 5: // Three curved turbine vanes with an open rotating collar.
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI * 2) / 3;
        plate(
          [
            [-0.15, 0.1],
            [0.05, 0.88],
            [0.5, 0.68],
            [0.34, 0.4],
            [0.28, 0.1],
          ].map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]),
        );
      }
      arc(0.4, 0, Math.PI * 2, 0.09, trim, 0.22);
      eye(0, 0, 0.15);
      break;
    case 6: // Off-centre siege cup and long recoil carriage.
      plate(
        [
          [-0.6, -0.45],
          [0.8, -0.45],
          [0.95, 0.1],
          [0.45, 0.52],
          [-0.4, 0.5],
        ],
        0,
        0.26,
      );
      k.add(tube(0.32, 0.41, 1.25, 14, -0.35, 0.16, 0.32), trim);
      k.add(ring(0.27, 0.085, 16, -0.98, 0.16, 0.32).rotateY(Math.PI / 2));
      bar(-0.3, -0.35, 0.65, -0.35, 0.1, trim, 0.3);
      eye(-0.45, 0.16, 0.18);
      pod(0.85, -0.16, 0.2);
      break;
    case 7: // A single translucent-looking fractured crystal, no wings or engines.
      k.add(gem(0.7, 0, -0.18, 0, 0, 1.5, 0.5, 0.65));
      k.add(gem(0.34, 0, 0.5, 0.32, 0.05, 0.7, 1.2, 0.6), trim);
      k.add(gem(0.24, 0, 0.45, -0.32, 0.1, 1.2, 0.6, 0.8));
      bar(-0.72, 0, 0.26, 0.14, 0.028, lamp, 0.4);
      eye(-0.18, 0, 0.08);
      break;
    case 8: // Upright watchtower, two radar ears and a single lens.
      plate(
        [
          [-0.4, -0.65],
          [0.32, -0.8],
          [0.48, -0.25],
          [0.48, 0.25],
          [0.32, 0.8],
          [-0.4, 0.65],
          [-0.6, 0],
        ],
        0,
        0.35,
      );
      for (const s of [-1, 1]) {
        bar(0.08, s * 0.5, 0.08, s * 1, 0.09);
        k.add(disc(0.23, 0.1, 6, 0.08, s * 0.9, 0.15), trim);
      }
      eye(-0.15, 0, 0.25);
      bar(0.27, -0.4, 0.27, 0.4, 0.075, trim, 0.4);
      break;
    case 9: // Bat: scalloped trailing edge and long swept tips.
      plate(
        [
          [-0.6, 0],
          [0.24, -0.4],
          [-0.15, -1],
          [0.52, -0.65],
          [0.72, -0.22],
          [0.33, -0.3],
          [0.55, 0],
          [0.33, 0.3],
          [0.72, 0.22],
          [0.52, 0.65],
          [-0.15, 1],
          [0.24, 0.4],
        ],
        0,
        0.14,
      );
      for (const s of [-1, 1]) bar(-0.22, 0, 0.4, s * 0.61, 0.065, trim, 0.18);
      eye(-0.25);
      break;
    case 10: // Three separate serpent necks, connected to an organic tail.
      k.add(orb(0.36, 0.45, 0, 0, 1, 1.3, 0.55));
      for (const s of [-1, 0, 1]) {
        bar(0.45, 0, -0.1, s * 0.48, 0.17);
        bar(-0.1, s * 0.48, -0.7, s * 0.6, 0.11);
        k.add(orb(0.18, -0.76, s * 0.6, 0, 1.4, 0.8, 0.7), trim);
        eye(-0.8, s * 0.6, 0.085);
      }
      plate(
        [
          [0.6, -0.2],
          [1, 0.1],
          [0.6, 0.25],
        ],
        0,
        0.14,
      );
      break;
    case 11: // Armoured wall: a vertical slab with six staggered shield tiles.
      bar(0.22, -0.85, 0.22, 0.85, 0.27);
      for (let i = 0; i < 6; i++) {
        const y = (i - 2.5) * 0.31;
        plate(
          [
            [-0.55, y - 0.12],
            [0.25, y - 0.14],
            [0.48, y],
            [0.25, y + 0.14],
            [-0.55, y + 0.12],
            [-0.68, y],
          ],
          0.08,
          0.22,
          i % 2 ? trim : main,
        );
      }
      eye(-0.32, 0, 0.14);
      pod(0.55, -0.6);
      pod(0.55, 0.6);
      break;
    case 12: // Comma-shaped hunter: large sensor and hooked tail on one side.
      k.add(orb(0.42, -0.3, 0, 0, 1, 0.9, 0.6));
      arc(0.64, -1.2, 1.8, 0.22, trim);
      plate([
        [0.2, 0.5],
        [0.95, 0.45],
        [0.58, 0.22],
        [0.28, 0.23],
      ]);
      eye(-0.38, 0, 0.23);
      break;
    case 13: // Praying mantis with two hooked forearms and a narrow waist.
      plate(
        [
          [-0.44, 0],
          [0.42, -0.23],
          [0.67, 0],
          [0.42, 0.23],
        ],
        0,
        0.2,
      );
      for (const s of [-1, 1]) {
        bar(0.2, s * 0.12, -0.2, s * 0.72, 0.11);
        plate(
          [
            [-0.2, s * 0.72],
            [-0.92, s * 0.56],
            [-0.63, s * 0.23],
            [-0.59, s * 0.49],
          ],
          0,
          0.13,
          trim,
        );
        pod(0.45, s * 0.17, 0.1);
      }
      eye(-0.23);
      break;
    case 14: // Industrial auger: stacked tapering drill teeth.
      for (let i = 0; i < 5; i++) {
        const x = -0.85 + i * 0.34,
          r = 0.08 + i * 0.075;
        k.add(spike(r, 0.55, 6, x, 0, 0), i % 2 ? trim : main);
      }
      bar(0.55, -0.42, 0.55, 0.42, 0.2);
      pod(0.82, -0.28);
      pod(0.82, 0.28);
      eye(0.4);
      break;
    case 15: // Floating black tablet split by a diagonal luminous fault.
      plate(
        [
          [-0.45, -1],
          [0.34, -0.86],
          [0.48, 0.85],
          [-0.31, 1],
        ],
        0,
        0.32,
      );
      plate(
        [
          [-0.45, -1],
          [0.34, -0.86],
          [0.4, -0.15],
          [-0.39, 0.1],
        ],
        0.34,
        0.055,
        trim,
      );
      bar(-0.38, 0.1, 0.4, -0.15, 0.045, lamp, 0.42);
      eye(0, 0, 0.09);
      break;
    case 16: // Brood cluster: a honeycomb of six hollow cells.
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3,
          x = Math.cos(a) * 0.53,
          y = Math.sin(a) * 0.53;
        k.add(ring(0.24, 0.085, 6, x, y, 0), i % 2 ? trim : main);
        k.lit(disc(0.095, 0.03, 6, x, y, 0.05), lamp, 1.25);
      }
      k.add(gem(0.25, 0));
      eye(0, 0, 0.12);
      break;
    case 17: // Ceremonial balance: central spear with two weighted crescents.
      plate(
        [
          [-1, 0],
          [0.43, -0.15],
          [0.83, 0],
          [0.43, 0.15],
        ],
        0,
        0.25,
      );
      for (const s of [-1, 1]) {
        bar(0.14, 0, 0.14, s * 0.74, 0.08);
        arc(0.83, s > 0 ? 0.25 : 3.4, s > 0 ? 2.65 : 5.8, 0.18, trim);
      }
      eye(-0.24);
      break;
    case 18: // Centipede bomber: six asymmetric ribs down a curved backbone.
      for (let i = 0; i < 6; i++) {
        const x = -0.75 + i * 0.3,
          y = Math.sin(i * 0.6) * 0.18;
        k.add(orb(0.22, x, y, 0, 1, 0.85, 0.6), i % 2 ? trim : main);
        bar(x, y, x + 0.23, y + (i % 2 ? -0.55 : 0.55), 0.085);
      }
      eye(-0.77, 0, 0.13);
      break;
    case 19: // Polearm: long needle with a single large axe head.
      bar(-1.2, 0, 1, 0, 0.12);
      plate(
        [
          [-0.95, 0],
          [-0.2, -0.73],
          [0.2, -0.63],
          [-0.18, -0.18],
          [0.2, 0.22],
          [-0.55, 0.18],
        ],
        0,
        0.19,
      );
      plate(
        [
          [0.25, -0.12],
          [0.85, -0.25],
          [0.95, 0.1],
          [0.4, 0.15],
        ],
        0.1,
        0.16,
        trim,
      );
      eye(-0.33);
      pod(0.88, 0, 0.14);
      break;
    case 20: // Volcanic cinder with jagged lava seams.
      plate(
        [
          [-0.75, 0],
          [-0.5, -0.53],
          [-0.07, -0.35],
          [0.25, -0.65],
          [0.43, -0.2],
          [0.78, -0.1],
          [0.43, 0.3],
          [0.28, 0.68],
          [-0.12, 0.4],
          [-0.6, 0.53],
        ],
        0,
        0.25,
      );
      for (const s of [-1, 1]) {
        bar(-0.4, 0, 0.1, s * 0.3, 0.045, lamp, 0.3);
        bar(0.1, s * 0.3, 0.42, s * 0.12, 0.035, lamp, 0.3);
      }
      eye(0, 0, 0.16);
      break;
    case 21: // Three forward claws, broad crescent rear bridge.
      arc(0.78, -1.45, 1.45, 0.22, trim);
      for (const s of [-1, 0, 1])
        plate(
          [
            [0.48, s * 0.4],
            [-0.48, s * 0.49],
            [-0.92, s * 0.35],
            [-0.4, s * 0.3],
            [0.58, s * 0.4 + 0.12],
          ],
          0,
          0.16,
        );
      eye(0.36);
      break;
    case 22: // Glider with broad squared wings and a recessed bomb bay.
      plate(
        [
          [-0.42, -0.25],
          [-0.23, -1],
          [0.4, -0.95],
          [0.7, -0.45],
          [0.32, -0.5],
          [0.6, 0.5],
          [0.7, 0.45],
          [0.4, 0.95],
          [-0.23, 1],
          [-0.42, 0.25],
        ],
        0,
        0.14,
      );
      k.add(box(0.66, 0.44, 0.32, 0, 0, 0.12), trim);
      for (let i = 0; i < 3; i++)
        bar(-0.24 + i * 0.22, -0.17, -0.24 + i * 0.22, 0.17, 0.075, '#2a3740', 0.34);
      eye(-0.42);
      break;
    case 23: // Tuning instrument: nested open sound forks.
      for (let i = 0; i < 3; i++)
        arc(0.42 + i * 0.22, -2.3, 2.3, 0.09, i % 2 ? trim : main, i * 0.045);
      plate(
        [
          [0.1, -0.14],
          [1, -0.08],
          [0.75, 0.15],
          [0.1, 0.14],
        ],
        0,
        0.14,
      );
      eye(0.12, 0, 0.13);
      break;
    case 24: // Crocodile jaws, serrated nose and a plated tail.
      for (const s of [-1, 1]) {
        plate(
          [
            [-1, s * 0.12],
            [-0.65, s * 0.4],
            [0.35, s * 0.36],
            [0.58, 0],
            [-0.18, s * 0.13],
          ],
          0,
          0.2,
        );
        for (let i = 0; i < 4; i++)
          plate(
            [
              [-0.8 + i * 0.2, s * 0.12],
              [-0.7 + i * 0.2, 0],
              [-0.61 + i * 0.2, s * 0.16],
            ],
            0.06,
            0.08,
            trim,
          );
      }
      plate(
        [
          [0.3, -0.22],
          [1.1, 0],
          [0.3, 0.22],
        ],
        0,
        0.18,
        trim,
      );
      eye(0.2);
      break;
    case 25: // Teardrop with three long trailing ribbons.
      k.add(orb(0.4, -0.35, 0, 0, 1.2, 0.8, 0.6));
      for (const s of [-1, 0, 1])
        plate(
          [
            [-0.1, s * 0.12],
            [1.1 - Math.abs(s) * 0.2, s * 0.44],
            [0.55, s * 0.1],
          ],
          0,
          0.08,
          s ? trim : main,
        );
      eye(-0.5, 0, 0.14);
      break;
    case 26: // Medusa: five bent antennae ending in coloured sensor heads.
      k.add(disc(0.36, 0.26, 8, 0, 0), trim);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2,
          x = Math.cos(a),
          y = Math.sin(a);
        bar(x * 0.2, y * 0.2, x * 0.65, y * 0.65, 0.08);
        bar(x * 0.65, y * 0.65, x * 0.8 - y * 0.18, y * 0.8 + x * 0.18, 0.07);
        eye(x * 0.8 - y * 0.18, y * 0.8 + x * 0.18, 0.11);
      }
      break;
    case 27: // Hammerhead: heavy transverse bow, exposed narrow rear drive.
      plate(
        [
          [-0.62, -0.85],
          [-0.2, -0.85],
          [0.05, -0.51],
          [0.05, 0.51],
          [-0.2, 0.85],
          [-0.62, 0.85],
          [-0.8, 0.4],
          [-0.8, -0.4],
        ],
        0,
        0.34,
      );
      bar(-0.3, 0, 0.86, 0, 0.28);
      pod(0.8, 0, 0.28);
      bar(-0.54, -0.64, -0.54, 0.64, 0.08, trim, 0.38);
      eye(-0.57);
      break;
    case 28: // Broken stealth kite with a large triangular negative space.
      plate(
        [
          [-1, 0],
          [0.55, -0.67],
          [0.05, -0.13],
          [0.72, 0],
          [0.05, 0.13],
          [0.55, 0.67],
        ],
        0,
        0.1,
      );
      bar(-0.75, 0, 0.25, -0.37, 0.035, trim, 0.14);
      bar(-0.75, 0, 0.25, 0.37, 0.035, trim, 0.14);
      eye(-0.55, 0, 0.08);
      break;
    case 29: // Pinwheel with four lightning-bolt arms.
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        plate(
          [
            [0.1, 0.1],
            [0.8, 0.2],
            [0.48, 0.42],
            [0.82, 0.72],
            [0.21, 0.55],
            [0.3, 0.32],
            [-0.1, 0.25],
          ].map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]),
          0,
          0.13,
          i % 2 ? trim : main,
        );
      }
      eye(0, 0, 0.17);
      break;
    case 30: // Asymmetric twin craft: a ceramic sail joined to a cylindrical gun.
      plate(
        [
          [-0.7, 0.05],
          [0.1, 0.88],
          [0.75, 0.51],
          [0.34, 0.05],
        ],
        0,
        0.17,
      );
      k.add(tube(0.15, 0.24, 1.45, 12, -0.1, -0.37, 0), trim);
      bar(0.26, -0.35, 0.26, 0.27, 0.14);
      eye(-0.52, -0.37, 0.11);
      pod(0.73, 0.4);
      break;
    case 31: // Stepped ziggurat, broad front face and four tapering tiers.
      for (let i = 0; i < 4; i++) {
        const x = -0.6 + i * 0.35,
          h = 0.95 - i * 0.18;
        plate(
          [
            [x, -h],
            [x + 0.28, -h],
            [x + 0.4, 0],
            [x + 0.28, h],
            [x, h],
          ],
          i * 0.07,
          0.22,
          i % 2 ? trim : main,
        );
      }
      bar(-0.55, -0.6, -0.55, 0.6, 0.045, lamp, 0.25);
      eye(-0.48);
      break;
    case 32: // Open stellar cage: eight pointed rays around a hollow octagon.
      k.add(ring(0.45, 0.095, 8), trim);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        plate(
          [
            [0.4, -0.13],
            [i % 2 ? 0.75 : 1, 0],
            [0.4, 0.13],
          ].map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]),
          0,
          0.12,
        );
      }
      eye(0, 0, 0.2);
      break;
    case 33: // Whale dreadnought with articulated ribs and unequal dorsal fins.
      plate(
        [
          [-1, -0.12],
          [-0.66, -0.57],
          [0.25, -0.47],
          [0.92, -0.17],
          [0.65, 0],
          [0.92, 0.26],
          [0.12, 0.48],
          [-0.67, 0.54],
        ],
        0,
        0.36,
      );
      for (let i = 0; i < 5; i++) {
        const x = -0.5 + i * 0.25;
        bar(x, -0.3, x + 0.1, 0.32, 0.08, trim, 0.4);
      }
      plate(
        [
          [-0.18, 0.36],
          [0.36, 1],
          [0.52, 0.4],
        ],
        0,
        0.2,
        trim,
      );
      plate(
        [
          [0.22, -0.35],
          [0.74, -0.72],
          [0.61, -0.2],
        ],
        0,
        0.16,
      );
      eye(-0.72, 0, 0.2);
      pod(0.76, -0.13, 0.18);
      pod(0.7, 0.21, 0.13);
      break;
    case 34: // SLEET: a bare dart, two swept slivers and one lens.
      for (const s of [-1, 1])
        plate([
          [-0.62, s * 0.06],
          [0.5, s * 0.1],
          [0.34, s * 0.34],
          [-0.4, s * 0.2],
        ]);
      bar(-0.7, 0, 0.55, 0, 0.09);
      eye(-0.24, 0, 0.09);
      break;
    case 35: // GLIMMER: a spinning shard cluster around a bright core.
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        plate(
          [
            [Math.cos(a) * 0.28, Math.sin(a) * 0.28],
            [Math.cos(a) * 0.86, Math.sin(a) * 0.14 + Math.sin(a) * 0.4],
            [Math.cos(a) * 0.4 - Math.sin(a) * 0.2, Math.sin(a) * 0.4 + Math.cos(a) * 0.2],
          ],
          0,
          0.13,
        );
      }
      eye(0, 0, 0.14);
      break;
    case 36: // SHIVER: twin outriggers on a narrow spine.
      bar(-0.85, 0, 0.8, 0, 0.16, main);
      for (const s of [-1, 1]) {
        plate([
          [-0.4, s * 0.28],
          [0.62, s * 0.34],
          [0.5, s * 0.62],
          [-0.5, s * 0.52],
        ]);
        pod(0.6, s * 0.46, 0.12);
      }
      eye(-0.5, 0, 0.1);
      break;
    case 37: // RIME: a blunt frost barge with a recessed muzzle.
      plate([
        [-0.95, -0.42],
        [0.7, -0.6],
        [0.98, 0],
        [0.7, 0.6],
        [-0.95, 0.42],
      ]);
      arc(0.72, -1.1, 1.1, 0.13, trim, 0.22);
      for (const s of [-1, 1]) pod(0.72, s * 0.3, 0.15);
      eye(-0.5, 0, 0.14);
      break;
    case 38: // FLOE: a drifting slab with fractured edges.
      plate([
        [-1.05, -0.2],
        [-0.35, -0.66],
        [0.72, -0.5],
        [0.95, 0.14],
        [0.2, 0.7],
        [-0.7, 0.5],
      ]);
      plate(
        [
          [-0.5, -0.1],
          [0.3, -0.28],
          [0.44, 0.2],
          [-0.3, 0.34],
        ],
        0.22,
        0.07,
        trim,
      );
      pod(0.68, -0.28, 0.16);
      pod(0.6, 0.3, 0.13);
      eye(-0.44, 0.02, 0.13);
      break;
    case 39: // CRYSTAL: a caged prism, four struts around a lens.
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        bar(Math.cos(a) * 0.3, Math.sin(a) * 0.3, Math.cos(a) * 0.95, Math.sin(a) * 0.95, 0.11);
      }
      arc(0.62, 0, Math.PI * 2, 0.12, main, 0.1);
      plate(
        [
          [-0.34, 0],
          [0, -0.4],
          [0.34, 0],
          [0, 0.4],
        ],
        0.18,
        0.12,
        trim,
      );
      eye(0, 0, 0.16);
      break;
    case 40: // HOARFROST: needle spines fanned off a slim body.
      plate([
        [-1.1, 0],
        [0.5, -0.24],
        [0.86, 0],
        [0.5, 0.24],
      ]);
      for (const s of [-1, 1])
        for (let i = 0; i < 3; i++) bar(-0.1 + i * 0.3, s * 0.16, -0.35 + i * 0.3, s * 0.78, 0.07);
      eye(-0.62, 0, 0.11);
      break;
    case 41: // CALVING: a heavy wedge shedding blocks off its flanks.
      plate([
        [-1.2, -0.5],
        [0.6, -0.78],
        [1.05, -0.16],
        [1.05, 0.16],
        [0.6, 0.78],
        [-1.2, 0.5],
      ]);
      for (const s of [-1, 1]) {
        plate(
          [
            [-0.5, s * 0.5],
            [0.3, s * 0.66],
            [0.24, s * 0.96],
            [-0.6, s * 0.8],
          ],
          0,
          0.14,
          trim,
        );
        pod(0.86, s * 0.36, 0.17);
      }
      eye(-0.66, 0, 0.16);
      break;
    case 42: // MORAINE: rubble hauler, a spine strung with debris pods.
      bar(-1.15, 0, 1.0, 0, 0.3, main);
      for (let i = 0; i < 4; i++) {
        const x = -0.85 + i * 0.55;
        const s = i % 2 ? 1 : -1;
        plate(
          [
            [x - 0.2, s * 0.2],
            [x + 0.24, s * 0.16],
            [x + 0.14, s * 0.66],
            [x - 0.26, s * 0.6],
          ],
          0,
          0.16,
          i % 2 ? trim : main,
        );
      }
      pod(1.0, 0.2, 0.18);
      pod(1.0, -0.2, 0.18);
      eye(-0.9, 0, 0.15);
      break;
    case 43: // GLACIER: the cave's capital ship, a terraced ice shelf.
      plate([
        [-1.9, -0.66],
        [0.9, -1.0],
        [1.6, -0.3],
        [1.6, 0.3],
        [0.9, 1.0],
        [-1.9, 0.66],
      ]);
      for (const s of [-1, 1]) {
        plate(
          [
            [-1.0, s * 0.7],
            [0.5, s * 0.92],
            [0.35, s * 1.35],
            [-1.1, s * 1.05],
          ],
          0,
          0.2,
          trim,
        );
        pod(1.32, s * 0.52, 0.22);
        pod(1.32, s * 0.18, 0.2);
        bar(-1.5, s * 0.5, 0.9, s * 0.66, 0.08);
      }
      arc(1.0, -1.3, 1.3, 0.16, trim, 0.28);
      eye(-1.1, 0, 0.22);
      break;
  }
}

/** Radius, colour and nose offset of the charge lamp drawn over each hull. */
export const ENEMY_CORE = FLEET_STYLE.map((style, type) => ({
  size: Math.min(0.16, enemyDefs[type].radius * 0.17),
  hex: style[3],
  x: 0,
  y: 0,
  z: 0,
}));

/** Bevelled armour plate, authored in the camera-facing XY plane. */
function armour(points: number[][], depth: number, z = 0) {
  const shape = new T.Shape();
  points.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  return new T.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 1,
    steps: 1,
    bevelSize: Math.min(0.045, depth * 0.25),
    bevelThickness: Math.min(0.035, depth * 0.2),
  }).translate(0, 0, z);
}

export function enemyGeometry(type: number): EnemyHulls {
  const kit = new Kit();
  uniqueHull(kit, type);
  const geometry = kit.build();
  geometry.hull!.computeBoundingBox();
  const bounds = geometry.hull!.boundingBox!;
  const reach = Math.max(
    Math.abs(bounds.min.x),
    Math.abs(bounds.max.x),
    Math.abs(bounds.min.y),
    Math.abs(bounds.max.y),
  );
  const scale = (enemyDefs[type].radius * 1.55) / reach;
  geometry.hull!.scale(scale, scale, scale);
  geometry.accent!.scale(scale, scale, scale);
  ENEMY_CORE[type].x *= scale;
  ENEMY_CORE[type].y *= scale;
  ENEMY_CORE[type].z *= scale;
  return geometry;
}

/* ------------------------------------------------------------------ *
 * Backdrop
 *
 * Everything behind the play field is a parallax band. Each band tiles
 * its content three times across `span` and slides left, so the wrap is
 * invisible and the ship reads as travelling right at speed. Earth and
 * its cloud shell keep their place and simply turn.
 * ------------------------------------------------------------------ */
const TEXTURE_ROOT = '/textures/';
const loader = new T.TextureLoader();
function loadTexture(path: string, srgb: boolean, repeat = false) {
  const t = loader.load(TEXTURE_ROOT + path);
  if (srgb) t.colorSpace = T.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = T.RepeatWrapping;
  // Ground strips are viewed at a grazing angle for the whole stage; 8 was
  // not enough to keep their grain from smearing into the horizon.
  t.anisotropy = 16;
  return t;
}

type Layer = { object: T.Object3D; speed: number; span: number };

function tiledField(
  geometry: T.BufferGeometry,
  material: T.Material,
  count: number,
  span: number,
  place: (dummy: T.Object3D, tint: T.Color) => void,
) {
  const mesh = new T.InstancedMesh(geometry, material, count * 3);
  const dummy = new T.Object3D(),
    tint = new T.Color();
  for (let i = 0; i < count; i++) {
    place(dummy, tint);
    const baseX = dummy.position.x;
    for (let tile = -1; tile <= 1; tile++) {
      const idx = i * 3 + tile + 1;
      dummy.position.x = baseX + tile * span;
      dummy.updateMatrix();
      mesh.setMatrixAt(idx, dummy.matrix);
      mesh.setColorAt(idx, tint);
    }
  }
  mesh.frustumCulled = false;
  return mesh;
}

function nebulaSheet(rng: Random, width: number, height: number, hexA: string, hexB: string) {
  const material = new T.MeshBasicNodeMaterial({
    transparent: true,
    blending: T.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const p = uv().sub(0.5);
  const n = mx_fractal_noise_float(vec3(p.mul(3.1), float(rng.next() * 40)), 2, 2, 0.5, 1)
    .mul(0.5)
    .add(0.5);
  const falloff = float(1).sub(p.length().mul(2.05)).clamp(0, 1).pow(1.7);
  material.colorNode = mix(color(hexA), color(hexB), n.pow(1.6));
  material.opacityNode = n.pow(2.2).mul(falloff).mul(0.5);
  return new T.Mesh(new T.PlaneGeometry(width, height), material);
}

/* ------------------------------------------------------------------ *
 * Asteroids
 *
 * Five photographed rock surfaces (Poly Haven, CC0), each on its own
 * lumpy icosphere, colour, size band and depth, so the belt reads as a
 * mix of real bodies rather than one repeated prop.
 * ------------------------------------------------------------------ */
type RockClass = {
  /** Poly Haven slug, used as the texture file name. */
  texture: string;
  tint: string;
  roughness: number;
  metalness: number;
  /** Icosphere subdivisions: 1 is angular, 2 reads as a weathered body. */
  detail: number;
  /** Radial displacement, as a fraction of the radius. */
  lumps: number;
  min: number;
  max: number;
  count: number;
  near: number;
  far: number;
  speed: number;
  spin: number;
  /**
   * How much of a scene's size boost this lane takes. The far lanes can carry
   * giants; the near lanes have to stay small or they sit on top of the play
   * field and hide it.
   */
  bulk: number;
};

const ROCKS: RockClass[] = [
  // C-type: the big dark carbonaceous bodies drifting furthest out.
  {
    texture: 'dark_rock',
    tint: '#9a958d',
    roughness: 0.96,
    metalness: 0.04,
    detail: 2,
    lumps: 0.17,
    min: 1.3,
    max: 4.4,
    count: 13,
    near: -70,
    far: -104,
    speed: 4.2,
    spin: 0.2,
    bulk: 1,
  },
  // S-type: ordinary grey stone, the bulk of the belt.
  {
    texture: 'gray_rocks',
    tint: '#a9a7a1',
    roughness: 0.86,
    metalness: 0.1,
    detail: 1,
    lumps: 0.24,
    min: 0.6,
    max: 2.5,
    count: 22,
    near: -44,
    far: -72,
    speed: 5.5,
    spin: 0.35,
    bulk: 0.8,
  },
  // M-type: small metallic fragments that catch the key light.
  {
    texture: 'marble_rock_02',
    tint: '#b9c8d8',
    roughness: 0.4,
    metalness: 0.7,
    detail: 1,
    lumps: 0.31,
    min: 0.4,
    max: 1.5,
    count: 16,
    near: -34,
    far: -58,
    speed: 7.5,
    spin: 0.6,
    bulk: 0.5,
  },
  // Oxidised silicate: rust-red, heavily eroded.
  {
    texture: 'rock_06',
    tint: '#c08c58',
    roughness: 0.92,
    metalness: 0.07,
    detail: 2,
    lumps: 0.21,
    min: 0.9,
    max: 3.1,
    count: 14,
    near: -50,
    far: -80,
    speed: 4.8,
    spin: 0.25,
    bulk: 0.9,
  },
  // Rubble: the near lane, small and tumbling fast.
  {
    texture: 'rock_04',
    tint: '#95897b',
    roughness: 0.9,
    metalness: 0.06,
    detail: 1,
    lumps: 0.35,
    min: 0.35,
    max: 1.25,
    count: 26,
    near: -26,
    far: -46,
    speed: 9.5,
    spin: 0.9,
    bulk: 0.3,
  },
];

/** Deterministic bumpiness: a handful of offset sine lobes over the sphere. */
function lumpField(rng: Random, lobes: number) {
  const wave: number[][] = [];
  for (let i = 0; i < lobes; i++)
    wave.push([
      1.3 + rng.next() * 3.4,
      1.3 + rng.next() * 3.4,
      1.3 + rng.next() * 3.4,
      rng.next() * 6.283,
      rng.next() * 6.283,
      rng.next() * 6.283,
    ]);
  return (x: number, y: number, z: number) => {
    let n = 0;
    for (const [fx, fy, fz, px, py, pz] of wave)
      n += Math.sin(x * fx + px) * Math.sin(y * fy + py) * Math.sin(z * fz + pz);
    return n / wave.length;
  };
}

function asteroidGeometry(rng: Random, detail: number, lumps: number) {
  const source = new T.IcosahedronGeometry(1, detail);
  const g = source.index ? source.toNonIndexed() : source;
  const position = g.attributes.position as T.BufferAttribute;
  const noise = lumpField(rng, 4);
  for (let i = 0; i < position.count; i++) {
    const len = Math.hypot(position.getX(i), position.getY(i), position.getZ(i)) || 1;
    const x = position.getX(i) / len,
      y = position.getY(i) / len,
      z = position.getZ(i) / len;
    // Displacement is a function of direction alone, so the duplicated
    // corners of adjacent triangles stay welded.
    const r = 1 + noise(x, y, z) * lumps;
    position.setXYZ(i, x * r, y * r, z * r);
  }
  // Per-face planar projection along the facet's dominant axis. Spherical UVs
  // smear the whole map across the triangles that meet at the poles; this has
  // no poles and no wrap seam, and the axis changes land on facet edges where
  // they read as cracks in the rock.
  const uv = new Float32Array(position.count * 2);
  const a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3(),
    edge = new T.Vector3(),
    normal = new T.Vector3();
  for (let t = 0; t < position.count; t += 3) {
    a.fromBufferAttribute(position, t);
    b.fromBufferAttribute(position, t + 1);
    c.fromBufferAttribute(position, t + 2);
    edge.copy(c).sub(a);
    normal.copy(b).sub(a).cross(edge);
    const nx = Math.abs(normal.x),
      ny = Math.abs(normal.y),
      nz = Math.abs(normal.z);
    const axis = nx > ny && nx > nz ? 0 : ny > nz ? 1 : 2;
    for (let k = 0; k < 3; k++) {
      const v = k === 0 ? a : k === 1 ? b : c;
      uv[(t + k) * 2] = (axis === 0 ? v.z : v.x) * 0.45 + 0.5;
      uv[(t + k) * 2 + 1] = (axis === 1 ? v.z : v.y) * 0.45 + 0.5;
    }
  }
  g.setAttribute('uv', new T.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** A tiled, tumbling belt of one rock class. */
function asteroidField(
  rng: Random,
  rock: RockClass,
  span: number,
  mix: { count: number; min: number; max: number; bias: number },
) {
  const material = new T.MeshStandardNodeMaterial({
    map: loadTexture(`rocks/${rock.texture}.jpg`, true, true),
    color: rock.tint,
    roughness: rock.roughness,
    metalness: rock.metalness,
  });
  // A near lane takes only a fraction of the scene's extra bodies and size.
  const gain = 1 + (mix.max - 1) * rock.bulk;
  const count = Math.round(rock.count * (1 + (mix.count - 1) * (0.35 + 0.65 * rock.bulk)));
  const total = count * 3;
  const min = rock.min * mix.min,
    max = rock.max * gain;
  const mesh = new T.InstancedMesh(asteroidGeometry(rng, rock.detail, rock.lumps), material, total);
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
  // x y z, sx sy sz, rx ry rz per instance, plus a tumble rate.
  const base = new Float32Array(total * 9);
  const rate = new Float32Array(total * 3);
  const dummy = new T.Object3D(),
    tint = new T.Color();
  for (let i = 0; i < count; i++) {
    const x = (rng.next() - 0.5) * span,
      y = (rng.next() - 0.5) * 95,
      z = rock.near - rng.next() * (rock.near - rock.far);
    // A biased roll over the class's size band: mostly small bodies, with the
    // occasional very large one. Raising the bias widens the gap between them.
    const roll = Math.pow(rng.next(), mix.bias);
    const s = min + roll * (max - min);
    const sy = s * (0.62 + rng.next() * 0.7),
      sz = s * (0.62 + rng.next() * 0.7);
    const rx = rng.next() * 6.283,
      ry = rng.next() * 6.283,
      rz = rng.next() * 6.283;
    const wx = (rng.next() - 0.5) * rock.spin,
      wy = (rng.next() - 0.5) * rock.spin,
      wz = (rng.next() - 0.5) * rock.spin;
    tint.setScalar(0.7 + rng.next() * 0.55);
    for (let tile = -1; tile <= 1; tile++) {
      const k = i * 3 + tile + 1;
      base.set([x + tile * span, y, z, s, sy, sz, rx, ry, rz], k * 9);
      rate.set([wx, wy, wz], k * 3);
      mesh.setColorAt(k, tint);
    }
  }
  return {
    mesh,
    tumble(t: number) {
      for (let k = 0; k < total; k++) {
        const b = k * 9,
          w = k * 3;
        dummy.position.set(base[b], base[b + 1], base[b + 2]);
        dummy.scale.set(base[b + 3], base[b + 4], base[b + 5]);
        dummy.rotation.set(
          base[b + 6] + rate[w] * t,
          base[b + 7] + rate[w + 1] * t,
          base[b + 8] + rate[w + 2] * t,
        );
        dummy.updateMatrix();
        mesh.setMatrixAt(k, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

/* ------------------------------------------------------------------ *
 * Ground emplacements
 *
 * Authored upright with a flat footprint at y = 0 and their guns raised
 * towards the sky, because everything that can hurt them comes from above.
 * ------------------------------------------------------------------ */
export const GROUND_TYPES = 12;

export const GROUND_CORE = [
  { size: 0.14, hex: '#ffd063', x: -0.62, y: 1.3 },
  { size: 0.12, hex: '#a6ffb8', x: -0.4, y: 1.4 },
  { size: 0.15, hex: '#f8b2ff', x: 0, y: 1.9 },
  { size: 0.12, hex: '#86eaff', x: -0.48, y: 1.2 },
  // Stage 4 floor: ice emplacements dug into the cave deck.
  { size: 0.13, hex: '#9df3ff', x: -0.42, y: 1.15 },
  { size: 0.15, hex: '#b6fff0', x: 0, y: 1.5 },
  { size: 0.12, hex: '#ffd88f', x: -0.5, y: 1.05 },
  { size: 0.16, hex: '#8fb0ff', x: 0, y: 1.7 },
  // Stage 4 roof: the same idea clamped to the ceiling. Authored the same way
  // up as the floor set; the renderer turns them over.
  { size: 0.13, hex: '#a8e0ff', x: -0.38, y: 1.2 },
  { size: 0.14, hex: '#7fffe0', x: 0, y: 1.45 },
  { size: 0.12, hex: '#c4fbff', x: -0.46, y: 1.0 },
  { size: 0.17, hex: '#bfefff', x: 0, y: 1.8 },
];
export function groundGeometry(type: number): EnemyHulls {
  const k = new Kit();
  if (type >= 4) {
    // Separate ice-white armour from recessed machinery and anchoring feet.
    // Merged into the existing two instance batches: detail adds no draw calls.
    const light = GROUND_CORE[type].hex;
    for (const side of [-1, 1]) {
      k.add(box(0.26, 0.28, 1.04, side * 0.65, 0.16, 0), '#273e54');
      k.add(box(0.18, 0.08, 1.12, side * 0.65, 0.3, 0), '#e8f5fc');
      k.add(rod(0.055, 0.58, side * 0.48, 0.5, 0.46, side * 0.34), '#7796aa');
      k.lit(box(0.22, 0.045, 0.025, side * 0.62, 0.34, 0.58), light, 1.8);
      for (let vent = 0; vent < 3; vent++) {
        k.add(box(0.055, 0.16, 0.025, side * (0.34 + vent * 0.1), 0.47, 0.53), '#263e51');
      }
    }
    k.add(ring(0.24, 0.045, 16, 0, 0.55, 0.55), '#7997ae');
    k.lit(disc(0.12, 0.025, 12, 0, 0.55, 0.59), light, 1.4);
  }
  switch (type) {
    case 0: // Sandstone tracked artillery, wide low tread silhouette.
      k.add(
        armour(
          [
            [-1, 0],
            [0.9, 0],
            [0.7, 0.45],
            [-0.7, 0.45],
          ],
          0.45,
        ),
        '#c79859',
      );
      for (let i = 0; i < 5; i++)
        k.add(disc(0.16, 0.09, 12, -0.68 + i * 0.33, 0.17, 0.5), '#3d424c');
      k.add(
        armour(
          [
            [-0.45, 0.45],
            [0.42, 0.45],
            [0.22, 0.98],
            [-0.3, 0.95],
          ],
          0.32,
        ),
        '#e3c28a',
      );
      k.add(tube(0.13, 0.2, 1.1, 10, -0.42, 1.1, 0.1).rotateZ(-0.2), '#685242');
      k.lit(box(0.4, 0.05, 0.03, 0.2, 0.66, 0.36), '#ffd063', 1.6);
      break;
    case 1: // Lime radar tripod with an open elliptical receiving dish.
      for (const side of [-1, 1])
        k.add(box(0.1, 0.9, 0.15, side * 0.3, 0.43, 0, -side * 0.55), '#3b8274');
      k.add(new T.CylinderGeometry(0.13, 0.22, 0.95, 8).translate(0, 0.65, 0), '#accb68');
      k.add(
        new T.TorusGeometry(0.48, 0.09, 8, 24)
          .scale(1, 0.6, 1)
          .rotateZ(-0.5)
          .translate(-0.1, 1.32, 0),
        '#accb68',
      );
      k.add(box(0.72, 0.045, 0.05, -0.1, 1.32, 0, -0.5), '#3b8274');
      k.lit(orb(0.1, -0.1, 1.32, 0.15), '#a6ffb8', 1.6);
      break;
    case 2: // Violet launch blossom, three opened silo petals.
      k.add(new T.CylinderGeometry(0.4, 0.7, 0.4, 6).translate(0, 0.2, 0), '#7758a1');
      for (const side of [-1, 1])
        k.add(
          armour(
            [
              [side * 0.2, 0.35],
              [side * 0.9, 0.6],
              [side * 0.65, 1.25],
              [side * 0.32, 0.85],
            ],
            0.2,
          ),
          '#c7acd9',
        );
      k.add(new T.CylinderGeometry(0.13, 0.22, 1.1, 10).translate(0, 1, 0), '#d5d6eb');
      k.add(new T.ConeGeometry(0.15, 0.5, 8).translate(0, 1.8, 0), '#ad6dbe');
      k.lit(ring(0.26, 0.045, 12, 0, 0.6, 0.12), '#f8b2ff', 1.6);
      break;
    case 4: // Ice deck cannon, a wedge of packed frost with one long barrel.
      k.add(
        armour(
          [
            [-0.95, 0],
            [0.95, 0],
            [0.7, 0.5],
            [-0.7, 0.5],
          ],
          1.1,
          -0.55,
        ),
        '#bcd8e6',
      );
      k.add(box(0.9, 0.34, 0.8, 0, 0.66, 0), '#8fb4c8');
      k.add(rod(0.11, 1.25, -0.32, 1.05, 0, 0.62), '#4d6f86');
      k.lit(orb(0.11, -0.72, 1.32, 0), '#9df3ff', 2.6);
      break;
    case 5: // Frost bloom launcher, four petals around a raised charge.
      k.add(disc(0.95, 0.26, 16, 0, 0.1, 0), '#7f9fb4');
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        k.add(
          armour(
            [
              [0, 0],
              [0.5, 0.15],
              [0.42, 0.82],
              [-0.12, 0.7],
            ],
            0.16,
            0,
          )
            .rotateZ(a)
            .translate(Math.cos(a) * 0.36, 0.5 + Math.sin(a) * 0.18, Math.sin(a) * 0.36),
          '#a8cadc',
        );
      }
      k.add(tube(0.24, 0.3, 0.8, 10, 0, 0.95, 0), '#4f7286');
      k.lit(orb(0.15, 0, 1.5, 0), '#b6fff0', 3);
      break;
    case 6: // Twin tracked sled, a low mobile mount on skids.
      for (const s of [-1, 1]) k.add(box(1.9, 0.2, 0.26, 0, 0.12, s * 0.5), '#41586a');
      k.add(box(1.4, 0.42, 0.9, 0, 0.44, 0), '#9fb4c2');
      k.add(disc(0.4, 0.34, 12, 0.05, 0.78, 0), '#5d7788');
      k.add(rod(0.09, 1.05, -0.3, 1.0, 0, 0.7), '#3f5567');
      k.lit(orb(0.1, -0.72, 1.22, 0), '#ffd88f', 2.6);
      break;
    case 7: // Pillar battery, a frozen column with lenses up its length.
      k.add(tube(0.42, 0.58, 1.9, 10, 0, 0.95, 0), '#c2dced');
      k.add(disc(0.8, 0.24, 14, 0, 0.1, 0), '#6d8ca0');
      for (let i = 0; i < 3; i++)
        k.lit(disc(0.14, 0.05, 10, 0, 0.55 + i * 0.45, 0.42), '#8fb0ff', 2);
      k.add(
        armour(
          [
            [-0.5, 0],
            [0.5, 0],
            [0.32, 0.55],
            [-0.32, 0.55],
          ],
          0.5,
          -0.25,
        ).translate(0, 1.85, 0),
        '#a4c0d4',
      );
      k.lit(orb(0.16, 0, 1.7, 0), '#8fb0ff', 3);
      break;
    case 8: // Roof clamp with a stubby downward gun.
      k.add(box(1.7, 0.28, 1.0, 0, 0.14, 0), '#7f9cb0');
      k.add(
        armour(
          [
            [-0.7, 0],
            [0.7, 0],
            [0.5, 0.62],
            [-0.5, 0.62],
          ],
          0.9,
          -0.45,
        ).translate(0, 0.24, 0),
        '#b4d0e0',
      );
      k.add(rod(0.1, 1.0, -0.26, 0.98, 0, 0.65), '#43617a');
      k.lit(orb(0.11, -0.66, 1.2, 0), '#a8e0ff', 2.6);
      break;
    case 9: // Icicle cluster, three tapered spikes over a bright node.
      k.add(disc(0.8, 0.24, 14, 0, 0.12, 0), '#6f8ea4');
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        k.add(tube(0.03, 0.19, 1.3, 7, Math.cos(a) * 0.34, 0.95, Math.sin(a) * 0.34), '#cfe6f2');
      }
      k.add(tube(0.26, 0.34, 0.6, 10, 0, 0.5, 0), '#4d7286');
      k.lit(orb(0.14, 0, 1.45, 0), '#7fffe0', 3);
      break;
    case 10: // Hanging rail, a slim beam with paired emitters.
      k.add(box(2.1, 0.22, 0.34, 0, 0.11, 0), '#5b7789');
      for (const s of [-1, 1]) {
        k.add(box(0.5, 0.5, 0.5, s * 0.62, 0.44, 0), '#a8c4d4');
        k.lit(disc(0.12, 0.05, 10, s * 0.62, 0.78, 0), '#c4fbff', 2.2);
      }
      k.add(rod(0.09, 0.85, -0.2, 0.82, 0, 0.6), '#40596b');
      k.lit(orb(0.1, -0.56, 1.0, 0), '#c4fbff', 2.6);
      break;
    case 11: // Cathedral mount, a broad arched housing for a heavy piece.
      k.add(disc(1.1, 0.3, 16, 0, 0.14, 0), '#67849a');
      k.add(
        armour(
          [
            [-0.9, 0],
            [0.9, 0],
            [0.62, 1.05],
            [0, 1.35],
            [-0.62, 1.05],
          ],
          0.95,
          -0.48,
        ).translate(0, 0.24, 0),
        '#b8d4e4',
      );
      for (const s of [-1, 1]) k.lit(disc(0.13, 0.05, 10, s * 0.46, 0.8, 0.5), '#bfefff', 2);
      k.add(tube(0.2, 0.26, 1.0, 10, 0, 1.7, 0), '#3d5a72');
      k.lit(orb(0.18, 0, 2.0, 0), '#bfefff', 3);
      break;
    case 3: // Navy naval flak bunker, squat hexagonal hull and four barrels.
      k.add(
        armour(
          [
            [-0.9, 0],
            [0.9, 0],
            [0.65, 0.55],
            [0.35, 0.75],
            [-0.55, 0.6],
          ],
          0.48,
        ),
        '#477eaa',
      );
      k.add(
        armour(
          [
            [-0.4, 0.4],
            [0.4, 0.4],
            [0.3, 0.92],
            [-0.3, 0.85],
          ],
          0.28,
          0.42,
        ),
        '#c9dce5',
      );
      for (let j = 0; j < 4; j++)
        k.add(
          tube(0.055, 0.075, 0.8, 8, -0.3 + j * 0.08, 1 + j * 0.06, 0.1 + j * 0.12).rotateZ(-0.45),
          '#27394d',
        );
      k.lit(box(0.5, 0.05, 0.04, 0, 0.3, 0.51), '#86eaff', 1.6);
      break;
  }
  return k.build();
}

/* ------------------------------------------------------------------ *
 * Bosses
 * ------------------------------------------------------------------ */
export type BossDesign = 'gatekeeper' | 'ares' | 'jove' | 'nereid';
export type BossModel = {
  root: T.Group;
  core: T.Mesh;
  ring: T.Group;
  pods: T.Group[];
};

function attachKit(target: T.Group, kit: Kit, metalness = 0.55, roughness = 0.38) {
  const geometry = kit.build();
  if (geometry.hull)
    target.add(
      new T.Mesh(
        geometry.hull,
        new T.MeshStandardNodeMaterial({ vertexColors: true, metalness, roughness }),
      ),
    );
  if (geometry.accent)
    target.add(
      new T.Mesh(
        geometry.accent,
        new T.MeshBasicNodeMaterial({ vertexColors: true, toneMapped: false }),
      ),
    );
}

/** Three different architectures, with the same gameplay core and orbiting hardpoints. */
export function makeBoss(design: BossDesign): BossModel {
  const root = new T.Group(),
    ringGroup = new T.Group(),
    k = new Kit(),
    rotor = new Kit();
  const gate = design === 'gatekeeper',
    ares = design === 'ares',
    nereid = design === 'nereid';
  const hull = gate ? '#e6e0cc' : ares ? '#ac2940' : nereid ? '#a8cfe4' : '#3a8f9e';
  const trim = gate ? '#368490' : ares ? '#dbac65' : nereid ? '#2f5f86' : '#b0a3e1';
  const lamp = gate ? '#64f2df' : ares ? '#ffbb65' : nereid ? '#bfefff' : '#d6a3ff';
  const dark = gate ? '#26394d' : ares ? '#402437' : nereid ? '#15304a' : '#253a64';
  k.hex = hull;
  rotor.hex = trim;
  const plate = (p: number[][], z = 0, d = 0.35, c = hull) => k.add(armour(p, d, z), c);
  if (gate) {
    // GATEKEEPER: an open horseshoe citadel, facing the player on the left.
    const outer: number[][] = [],
      inner: number[][] = [];
    for (let i = 0; i <= 24; i++) {
      const a = -2.25 + (i * 4.5) / 24;
      outer.push([Math.cos(a) * 3.7, Math.sin(a) * 3.7]);
      inner.unshift([Math.cos(a) * 2.65, Math.sin(a) * 2.65]);
    }
    plate([...outer, ...inner], -0.35, 0.7);
    for (const side of [-1, 1]) {
      plate(
        [
          [-2.85, side * 2.85],
          [-1.75, side * 2.8],
          [-1.3, side * 1.9],
          [-3.2, side * 1.95],
        ],
        0,
        0.45,
        trim,
      );
      k.add(tube(0.2, 0.35, 1.9, 12, -2.6, side * 2.3, 0.22), dark);
      k.lit(disc(0.14, 0.1, 12, -3.55, side * 2.3, 0.22), lamp, 1.8);
      plate(
        [
          [0.3, side * 0.4],
          [2.7, side * 1.6],
          [2.8, side * 1.3],
          [0.3, side * 0.1],
        ],
        -0.15,
        0.22,
        dark,
      );
    }
    for (let i = 0; i < 9; i++) {
      const a = -1.9 + i * 0.475;
      k.add(box(0.7, 0.17, 0.16, 3.24 * Math.cos(a), 3.24 * Math.sin(a), 0.45, a), trim);
      k.lit(box(0.34, 0.045, 0.04, 3.25 * Math.cos(a), 3.25 * Math.sin(a), 0.56, a), lamp, 1.4);
    }
    k.add(ring(1.25, 0.13, 48, 0, 0, 0.2), trim);
    // Delicate gyroscope rather than another outer armour wheel.
    rotor.add(new T.TorusGeometry(1.65, 0.045, 6, 48).rotateY(0.55), trim);
  } else if (ares) {
    // ARES: a massive horizontal siege hammer, angular bow and rear engine banks.
    plate(
      [
        [-2.6, -2.5],
        [-1.2, -2.8],
        [-0.65, -1.35],
        [2.45, -1.05],
        [3, -0.65],
        [3, 0.65],
        [2.45, 1.05],
        [-0.65, 1.35],
        [-1.2, 2.8],
        [-2.6, 2.5],
        [-3, 1.25],
        [-2.45, 0],
        [-3, -1.25],
      ],
      -0.4,
      0.85,
    );
    for (const side of [-1, 1]) {
      plate(
        [
          [-2.5, side * 1.25],
          [-1.35, side * 1.1],
          [-1.1, side * 2.4],
          [-2.25, side * 2.15],
        ],
        0.48,
        0.25,
        trim,
      );
      plate(
        [
          [0.7, side * 0.6],
          [2.5, side * 0.45],
          [2.3, side * 0.94],
          [0.9, side * 1.05],
        ],
        0.49,
        0.18,
        dark,
      );
      k.add(tube(0.2, 0.32, 2.2, 12, -1.6, side * 0.85, 0.64), dark);
      for (let j = 0; j < 3; j++) {
        k.add(box(0.17, 0.4, 0.07, 1 + j * 0.43, side * 0.76, 0.75), trim);
        k.lit(box(0.3, 0.09, 0.04, 2.82, side * (0.24 + j * 0.22), 0.1), lamp, 2);
      }
    }
    k.add(disc(1.1, 0.18, 6, 0, 0, 0.65), dark);
    rotor.add(ring(0.92, 0.13, 6, 0, 0, 0.9), trim);
    for (let j = 0; j < 3; j++)
      rotor.lit(box(0.35, 0.065, 0.045, 0.7, 0, 1.08).rotateZ((j * Math.PI * 2) / 3), lamp, 1.5);
  } else if (nereid) {
    // NEREID: an ice leviathan coiled around a frozen heart. Read as a
    // tapering spine of calving bergs rather than a machine.
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const cx = -3.1 + i * 0.95,
        cy = Math.sin(t * 3.2) * 1.25,
        r = 1.35 - t * 0.72;
      plate(
        [
          [cx - r, cy],
          [cx - r * 0.25, cy - r * 0.92],
          [cx + r * 0.8, cy - r * 0.4],
          [cx + r * 0.55, cy + r * 0.35],
          [cx - r * 0.2, cy + r * 0.95],
        ],
        -0.2 - t * 0.15,
        0.55 - t * 0.2,
        i % 2 ? trim : hull,
      );
      if (i % 2 === 0) k.lit(disc(0.16 - t * 0.05, 0.06, 10, cx, cy, 0.42), lamp, 1.7);
    }
    // The jaw: a blunt prow of fractured ice.
    plate(
      [
        [-4.5, 0],
        [-3.4, -1.15],
        [-2.5, -0.5],
        [-2.5, 0.5],
        [-3.4, 1.15],
      ],
      -0.25,
      0.7,
      hull,
    );
    // Shards fanned around the heart.
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      k.add(
        tube(0.04, 0.22, 1.85, 5, Math.cos(a) * 1.45, Math.sin(a) * 1.45, 0.2).rotateZ(a),
        i % 2 ? hull : trim,
      );
    }
    k.add(ring(1.2, 0.1, 40, 0, 0, 0.35), dark);
    // Two shelves, one barely tilted, so the silhouette keeps turning.
    rotor.add(new T.TorusGeometry(1.75, 0.05, 6, 52).rotateX(0.35), hull);
    rotor.add(new T.TorusGeometry(1.35, 0.04, 6, 52).rotateY(1.1), trim);
  } else {
    // JOVE: a floating manta cathedral with swept sails and long rear tendrils.
    plate(
      [
        [-1.5, 0],
        [-0.6, -0.9],
        [0.9, -0.5],
        [1.7, 0],
        [0.9, 0.5],
        [-0.6, 0.9],
      ],
      -0.2,
      0.5,
    );
    for (const side of [-1, 1]) {
      plate(
        [
          [-0.8, side * 0.65],
          [-2, side * 2.9],
          [-0.6, side * 3.8],
          [1.9, side * 2.25],
          [0.6, side * 1.7],
          [1.2, side * 0.6],
        ],
        -0.1,
        0.18,
        trim,
      );
      plate(
        [
          [-0.35, side * 0.7],
          [-0.8, side * 2.8],
          [0.55, side * 2.28],
          [0.4, side * 1.1],
        ],
        0.12,
        0.12,
        hull,
      );
      for (let j = 0; j < 3; j++) {
        const y = side * (0.5 + j * 0.62);
        plate(
          [
            [0.8, y],
            [3.5 - j * 0.35, y + side * 0.7],
            [2.5 - j * 0.2, y + side * 0.02],
            [1, y - side * 0.15],
          ],
          0,
          0.09,
          j % 2 ? trim : hull,
        );
        k.lit(box(0.8, 0.045, 0.04, 0.2, y, 0.36, side * 0.5), lamp, 1.5);
      }
    }
    k.add(ring(1.13, 0.08, 6, 0, 0, 0.5), trim);
    rotor.add(new T.TorusGeometry(1.45, 0.045, 6, 48).rotateX(0.9), hull);
    rotor.add(new T.TorusGeometry(1.45, 0.045, 6, 48).rotateY(0.9), trim);
  }
  attachKit(
    root,
    k,
    gate ? 0.3 : ares ? 0.7 : nereid ? 0.25 : 0.45,
    gate ? 0.5 : ares ? 0.55 : nereid ? 0.4 : 0.22,
  );
  attachKit(ringGroup, rotor);
  root.add(ringGroup);
  const core = new T.Mesh(
    gate
      ? new T.OctahedronGeometry(0.83)
      : ares
        ? new T.IcosahedronGeometry(0.7, 1)
        : nereid
          ? new T.IcosahedronGeometry(0.9, 2)
          : new T.SphereGeometry(0.72, 24, 12),
    glow(lamp, 1.8),
  );
  core.position.z = ares ? 0.94 : nereid ? 0.5 : 0.45;
  root.add(core);
  const pods: T.Group[] = [];
  for (let i = 0; i < (gate ? 4 : ares ? 6 : nereid ? 10 : 8); i++) {
    const p = new T.Group(),
      pk = new Kit();
    pk.hex = hull;
    if (gate) {
      pk.add(
        armour(
          [
            [-0.75, 0],
            [-0.28, -0.45],
            [0.52, -0.32],
            [0.7, 0],
            [0.52, 0.32],
            [-0.28, 0.45],
          ],
          0.28,
        ),
        hull,
      );
      pk.add(ring(0.25, 0.08, 6, 0, 0, 0.35), trim);
      pk.lit(disc(0.16, 0.03, 12, 0, 0, 0.39), lamp, 1.8);
    } else if (ares) {
      pk.add(box(0.8, 0.66, 0.4, 0.16), hull);
      for (const side of [-1, 1]) {
        pk.add(tube(0.09, 0.15, 1.05, 10, -0.35, side * 0.21, 0.18), trim);
        pk.lit(disc(0.07, 0.06, 10, -0.87, side * 0.21, 0.18), lamp, 1.8);
      }
      pk.add(
        armour(
          [
            [-0.18, -0.4],
            [0.64, -0.35],
            [0.64, 0.35],
            [-0.18, 0.4],
          ],
          0.13,
          0.36,
        ),
        trim,
      );
    } else {
      pk.add(
        armour(
          [
            [-0.8, 0],
            [0.05, -0.52],
            [0.68, -0.23],
            [0.28, 0],
            [0.68, 0.23],
            [0.05, 0.52],
          ],
          0.12,
        ),
        trim,
      );
      pk.add(gem(0.22, 0, -0.13, 0, 0.17, 1.6, 0.7, 0.7), hull);
      pk.lit(orb(0.105, -0.28, 0, 0.32), lamp, 1.8);
    }
    attachKit(p, pk);
    pods.push(p);
  }
  return { root, core, ring: ringGroup, pods };
}

/* ------------------------------------------------------------------ *
 * Surface terrain
 * ------------------------------------------------------------------ */
export type GroundConfig = {
  /** Tile width; the strip repeats exactly at this interval. */
  span: number;
  /** Depth of the strip, from the near lip to the far ridge line. */
  near: number;
  far: number;
  base: number;
  relief: number;
  /** How fast the deck peels away from the play plane behind it. */
  flare?: number;
  /** World units per second the surface slides past. */
  speed: number;
  seed: number;
  texture: string;
  /** Tangent-space normal map for the surface, if the stage ships one. */
  normal?: string;
  roughness?: string;
  /** Height between topographic bands. */
  contour: number;
  /**
   * A cave stage mirrors the field overhead with the relief inverted. The
   * vault carries its own lane and reach shaping and its own depth: a roof
   * built to the deck's numbers closes on the horizon and buries the
   * corridor, and one built to the deck's depth hangs over the whole screen.
   */
  roof: {
    base: number;
    relief: number;
    seed: number;
    lane?: number;
    reach?: number;
    near?: number;
    far?: number;
    depthSlope?: number;
    flare?: number;
  } | null;
  valley: string;
  crest: string;
  /** Distant terrain fades to this, standing in for depth haze. */
  haze: string;
};

/** Builds one surface strip from a height field. */
function buildStrip(cfg: GroundConfig, terrain: Terrain, flip: boolean) {
  const columns = 252,
    rows = 52;
  const near = (flip ? cfg.roof?.near : undefined) ?? cfg.near,
    far = (flip ? cfg.roof?.far : undefined) ?? cfg.far;
  const width = cfg.span * 3,
    depth = near - far;
  const geometry = new T.PlaneGeometry(width, depth, columns, rows);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position as T.BufferAttribute;
  const uv = geometry.attributes.uv as T.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const valley = new T.Color(cfg.valley).convertSRGBToLinear();
  const crest = new T.Color(cfg.crest).convertSRGBToLinear();
  const haze = new T.Color(cfg.haze).convertSRGBToLinear();
  // Distance on the vault reads as mist rather than as depth: it is lit from
  // below only, so the deck's haze colour left the far roof too close to the
  // sky behind it. It fades towards the crest colour instead.
  if (flip) haze.lerp(new T.Color(cfg.crest).convertSRGBToLinear(), 0.42);
  const shade = new T.Color();
  const centre = (near + far) / 2;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i) + centre;
    const y = terrain.height(x, z);
    position.setY(i, y);
    position.setZ(i, z);
    // Height paints the rock, depth washes it out towards the horizon.
    const from = flip ? cfg.roof!.base : cfg.base;
    const span = flip ? -cfg.roof!.relief : cfg.relief;
    const lift = Math.min(
      1,
      Math.max(0, (y - z * terrain.depthSlope - terrain.flare * Math.min(0, z) ** 2 - from) / span),
    );
    const away = Math.min(1, Math.max(0, (near - z) / depth));
    shade.copy(valley).lerp(crest, Math.pow(lift, 0.75));
    // Topographic banding: a soft line at every contour interval, so the
    // height of the ground reads at a glance rather than only in shading.
    // The distance is taken as an absolute: the vault hangs *below* its base,
    // so a signed offset sent the band term negative, and a negative fifth
    // power multiplied whole stretches of ceiling down past black.
    const band = cfg.contour > 0 ? Math.abs(y - from) / cfg.contour : 0;
    const contour = cfg.contour > 0 ? Math.pow(1 - Math.abs((band % 1) * 2 - 1), 5) : 0;
    shade.multiplyScalar(1 + contour * 0.45);
    // The vault ends closer to the camera than the deck does, so its far
    // edge dissolves into the haze rather than stopping at a visible lip.
    shade.lerp(haze, Math.pow(away, flip ? 1.35 : 1.6) * (flip ? 0.8 : 0.45));
    // The vault only ever catches bounced light, so its albedo carries more
    // of the work than the deck's does.
    if (flip) shade.multiplyScalar(cfg.roughness ? 1.1 : 1.75);
    colors[i * 3] = shade.r;
    colors[i * 3 + 1] = shade.g;
    colors[i * 3 + 2] = shade.b;
    // The vault is nearer the camera than the deck, so it tiles tighter:
    // matching scales would magnify the same grain twice as much up there.
    const tile = cfg.roughness ? 12 : flip ? 6.5 : 9;
    // Shear and gently warp the photographic grain, keeping x periodic at
    // the scrolling seam. Large fractures no longer form a checkerboard.
    const warp = cfg.roughness ? Math.sin((x * Math.PI * 2) / cfg.span) * 0.24 : 0;
    uv.setXY(i, x / tile + (cfg.roughness ? z * 0.017 : 0), z / tile + warp + (flip ? 0.37 : 0));
  }
  geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  // The vault is seen from below, so the face we look at is the plane's back
  // one. Drawing both sides is enough: the renderer flips the normal for a
  // back face itself, and negating it here as well would cancel that out and
  // leave the ceiling unlit.
  const mesh = new T.Mesh(
    geometry,
    new T.MeshStandardNodeMaterial({
      map: loadTexture(cfg.texture, true, true),
      normalMap: cfg.normal ? loadTexture(cfg.normal, false, true) : null,
      roughnessMap: cfg.roughness ? loadTexture(cfg.roughness, false, true) : null,
      // Ice is not rock: a little sheen, and enough normal relief that the
      // grain survives being magnified across a whole stage floor.
      normalScale: new T.Vector2(cfg.roughness ? 0.7 : 1.35, cfg.roughness ? 0.7 : 1.35),
      vertexColors: true,
      roughness: cfg.roughness ? 0.58 : cfg.normal ? 0.78 : 0.95,
      metalness: 0,
      // A cave has no light from above and the hemisphere light hands a
      // down-facing normal its ground colour, so the vault gets a dim self-lit
      // floor keyed to its own map: the grain stays readable everywhere.
      emissive: new T.Color(flip ? '#1d3d58' : '#000000'),
      emissiveMap: flip ? loadTexture(cfg.texture, true, true) : null,
      side: flip ? T.DoubleSide : T.FrontSide,
    }),
  );
  mesh.frustumCulled = false;
  return mesh;
}

function buildGround(cfg: GroundConfig) {
  const terrain = new Terrain(
    cfg.span,
    cfg.base,
    cfg.relief,
    cfg.seed,
    undefined,
    undefined,
    0,
    cfg.flare,
  );
  const vault = cfg.roof
    ? new Terrain(
        cfg.span,
        cfg.roof.base,
        -cfg.roof.relief,
        cfg.roof.seed,
        cfg.roof.lane,
        cfg.roof.reach,
        cfg.roof.depthSlope,
        cfg.roof.flare,
      )
    : null;
  const mesh = buildStrip(cfg, terrain, false);
  const roof = vault ? buildStrip(cfg, vault, true) : null;
  return { mesh, roof, terrain, vault, span: cfg.span, speed: cfg.speed };
}

/* ------------------------------------------------------------------ *
 * Backdrop scenes
 * ------------------------------------------------------------------ */
export type SceneName = 'earth' | 'mars' | 'jupiter' | 'neptune';

type PlanetConfig = {
  map: string;
  /** Optional PBR support maps; Mars ships colour only. */
  normal?: string;
  specular?: string;
  clouds?: string;
  lights?: string;
  radius: number;
  position: [number, number, number];
  tilt: number;
  tint: string;
  /** Limb scattering: a tight bright shell and a wide soft one. */
  halo: [string, string];
  haloGain: number;
  glow: string;
  glowGain: number;
  /** Radians per second of axial rotation. */
  spin: number;
  /** Strength of the day/night falloff baked into the albedo, 0 to disable. */
  terminator: number;
};

type SceneConfig = {
  skyTint: string;
  skyGain: number;
  nebula: [string, string][];
  planet: PlanetConfig;
  station: boolean;
  moons: { radius: number; at: [number, number, number]; speed: number; span: number }[];
  /** Multipliers on the shared rock classes: how many, how big, how varied. */
  rocks: { count: number; min: number; max: number; bias: number };
  streakTint: string;
};

const SCENES: Record<SceneName, SceneConfig> = {
  earth: {
    skyTint: '#8fb2dd',
    skyGain: 0.5,
    nebula: [
      ['#123a63', '#3f6fb0'],
      ['#3a1450', '#8e3fa0'],
      ['#0d3a45', '#2f8a86'],
      ['#40183a', '#b04a6a'],
      ['#101f52', '#4257b4'],
    ],
    planet: {
      map: 'planets/earth_color.jpg',
      normal: 'planets/earth_normal.jpg',
      specular: 'planets/earth_specular.jpg',
      clouds: 'planets/earth_clouds.png',
      lights: 'planets/earth_lights.png',
      radius: 33,
      // Low and far right: only the upper limb crosses the play field.
      position: [22, -48, -74],
      tilt: -0.28,
      tint: '#8fa4ba',
      halo: ['#2d6cff', '#a8d8ff'],
      haloGain: 0.6,
      glow: '#2f74d8',
      glowGain: 0.16,
      spin: 0.0125,
      terminator: 0,
    },
    station: true,
    moons: [{ radius: 4.6, at: [-46, 26, -102], speed: 1.1, span: 260 }],
    rocks: { count: 1, min: 1, max: 1, bias: 2 },
    streakTint: '#9fd0ff',
  },
  mars: {
    skyTint: '#d8a583',
    skyGain: 0.42,
    nebula: [
      ['#3d1a12', '#a8563a'],
      ['#2a1830', '#7a4470'],
      ['#3a2410', '#b07a3c'],
      ['#141d33', '#3f5a8e'],
      ['#40160f', '#c26a45'],
    ],
    planet: {
      map: 'planets/mars_color.jpg',
      radius: 26,
      // Centred and far back, so the whole disc sits inside the frame.
      position: [14, -6, -118],
      tilt: 0.19,
      tint: '#6f5a4a',
      halo: ['#d4531f', '#ffb98a'],
      haloGain: 0.16,
      glow: '#b4552a',
      glowGain: 0.05,
      spin: 0.032,
      terminator: 0.85,
    },
    station: false,
    // Phobos and Deimos: small, close, and moving fast enough to notice.
    moons: [
      { radius: 1.7, at: [-34, 30, -86], speed: 2.6, span: 220 },
      { radius: 1.0, at: [40, -30, -70], speed: 4.2, span: 180 },
    ],
    // The belt run: many more bodies over a far wider size range, weighted so
    // the giants stay rare and stay in the back lanes.
    rocks: { count: 2.4, min: 0.5, max: 1.85, bias: 3.1 },
    streakTint: '#ffbf8f',
  },
  jupiter: {
    skyTint: '#c9a882',
    skyGain: 0.34,
    nebula: [
      ['#2a1a0c', '#8a5a28'],
      ['#1a1428', '#5a4278'],
      ['#301c0e', '#a06a30'],
      ['#0e1a26', '#36597a'],
      ['#3a1c10', '#b0703c'],
    ],
    planet: {
      map: 'planets/jupiter_color.jpg',
      radius: 46,
      // Off to the right and running past the frame edge, leaving the left of
      // the field clear to fly in.
      position: [52, 20, -150],
      tilt: 0.06,
      tint: '#8a7358',
      halo: ['#d08a3a', '#ffd9a8'],
      haloGain: 0.34,
      glow: '#b87a3a',
      glowGain: 0.12,
      // A ten hour day: the banding visibly turns during a sortie.
      spin: 0.05,
      terminator: 0.7,
    },
    station: false,
    // Io and Europa, small and quick against the giant.
    moons: [
      { radius: 2.2, at: [-38, -2, -94], speed: 3.2, span: 210 },
      { radius: 1.4, at: [44, 12, -76], speed: 5.0, span: 170 },
    ],
    // No belt over the moon: the surface carries this stage's foreground.
    rocks: { count: 0, min: 1, max: 1, bias: 2.4 },
    streakTint: '#ffcf9f',
  },
  neptune: {
    skyTint: '#8fb6d8',
    skyGain: 0.3,
    nebula: [
      ['#0b1c33', '#2c5a8e'],
      ['#101a2e', '#3f4f88'],
      ['#0a2434', '#2f6a80'],
      ['#1a1030', '#4a3a78'],
      ['#08192c', '#255a7a'],
    ],
    planet: {
      map: 'planets/neptune_color.jpg',
      radius: 30,
      // Right of the field and level with it, so the cave mouth frames it.
      position: [46, 0, -128],
      tilt: 0.12,
      tint: '#7fa6c8',
      halo: ['#2f6fd0', '#a8d6ff'],
      haloGain: 0.26,
      glow: '#2a5f9e',
      glowGain: 0.1,
      // Neptune turns in sixteen hours; a sortie sees a good arc of it.
      spin: 0.038,
      terminator: 0.88,
    },
    station: false,
    // Triton, retrograde and pale.
    moons: [{ radius: 2.6, at: [-40, 16, -96], speed: 2.4, span: 200 }],
    rocks: { count: 0, min: 1, max: 1, bias: 2.4 },
    streakTint: '#bfe4ff',
  },
};

export function buildBackdrop(
  scene: T.Scene,
  name: SceneName = 'earth',
  groundConfig: GroundConfig | null = null,
) {
  const config = SCENES[name];
  const rng = new Random(890234);
  const layers: Layer[] = [];
  const root = new T.Group();
  scene.add(root);

  /* --- Milky Way sky shell ------------------------------------------ */
  const skyMaterial = new T.MeshBasicNodeMaterial({
    side: T.BackSide,
    fog: false,
    depthWrite: false,
  });
  const sky = texture(loadTexture('space/starfield.jpg', true));
  skyMaterial.colorNode = mix(color('#050912'), sky.mul(color(config.skyTint)), float(0.62)).mul(
    config.skyGain,
  );
  const skybox = new T.Mesh(new T.SphereGeometry(168, 48, 32), skyMaterial);
  skybox.renderOrder = -100;
  root.add(skybox);

  /* --- Nebula sheets ------------------------------------------------- */
  const nebula = new T.Group();
  nebula.position.z = -86;
  root.add(nebula);
  const nebulaSpan = 320;
  for (let i = 0; i < config.nebula.length; i++) {
    const sheet = nebulaSheet(
      rng,
      150 + rng.next() * 110,
      90 + rng.next() * 60,
      ...config.nebula[i],
    );
    sheet.position.set(
      -nebulaSpan / 2 + (i + rng.next() * 0.6) * (nebulaSpan / config.nebula.length),
      (rng.next() - 0.5) * 46,
      (rng.next() - 0.5) * 26,
    );
    sheet.rotation.z = (rng.next() - 0.5) * 0.9;
    sheet.renderOrder = -90;
    nebula.add(sheet);
    const echo = sheet.clone();
    echo.position.x += nebulaSpan;
    nebula.add(echo);
  }
  layers.push({ object: nebula, speed: 0.55, span: nebulaSpan });

  /* --- Three star bands, each with its own drift --------------------- */
  const starGeometry = new T.SphereGeometry(1, 5, 4);
  const starTints = ['#ffffff', '#cfe4ff', '#ffe7c2', '#ffd0c0', '#d6ccff'];
  const bands = [
    { count: 900, span: 300, speed: 0.5, z: -128, depth: 34, size: 0.11, bright: 0.6 },
    { count: 520, span: 240, speed: 1.5, z: -86, depth: 26, size: 0.15, bright: 0.9 },
    { count: 220, span: 190, speed: 3.4, z: -54, depth: 18, size: 0.2, bright: 1.3 },
  ];
  for (const band of bands) {
    const material = new T.MeshBasicNodeMaterial({ toneMapped: false, fog: false });
    const field = tiledField(starGeometry, material, band.count, band.span, (dummy, tint) => {
      dummy.position.set(
        (rng.next() - 0.5) * band.span,
        (rng.next() - 0.5) * 150,
        band.z - rng.next() * band.depth,
      );
      dummy.rotation.set(0, 0, 0);
      // Squared distribution: a few standouts among many faint pinpricks.
      dummy.scale.setScalar(band.size * (0.35 + rng.next() * rng.next() * 1.9));
      tint
        .set(starTints[Math.floor(rng.next() * starTints.length)])
        .multiplyScalar(band.bright * (0.5 + rng.next() * 0.9));
    });
    field.renderOrder = -80;
    root.add(field);
    layers.push({ object: field, speed: band.speed, span: band.span });
  }

  /* --- The planet ---------------------------------------------------- */
  const p = config.planet;
  const planet = new T.Group();
  planet.position.set(...p.position);
  planet.rotation.z = p.tilt;
  root.add(planet);
  const sunDir = vec3(-0.42, 0.58, 0.7);
  const viewDir = cameraPosition.sub(positionWorld).normalize();
  const limb = float(1).sub(normalWorld.dot(viewDir).abs()).pow(3);
  const surface = new T.MeshStandardNodeMaterial({ metalness: 0.1, roughness: 0.9 });
  let albedo = texture(loadTexture(p.map, true)).rgb.mul(color(p.tint));
  if (p.terminator > 0) {
    // Fill light alone leaves an airless planet looking like a flat disc, so
    // the day/night falloff is folded into the albedo.
    const day = normalWorld.dot(sunDir).smoothstep(-0.45, 0.6);
    albedo = albedo.mul(mix(float(1 - p.terminator), float(1), day));
  }
  surface.colorNode = albedo;
  if (p.normal) {
    surface.normalMap = loadTexture(p.normal, false);
    surface.normalScale = new T.Vector2(1.4, 1.4);
  }
  if (p.specular) {
    // The specular map marks water: oceans read polished, land reads dry rock.
    const water = texture(loadTexture(p.specular, false));
    surface.roughnessNode = float(1).sub(water.g.mul(0.78));
    surface.metalnessNode = water.g.mul(0.42);
  } else {
    surface.roughnessNode = float(0.96);
    surface.metalnessNode = float(0.02);
  }
  let emissive = color(p.halo[0]).mul(limb).mul(0.5);
  if (p.lights) {
    const night = normalWorld.dot(sunDir).mul(-1).smoothstep(-0.06, 0.38);
    emissive = texture(loadTexture(p.lights, true))
      .rgb.mul(color('#ffcb7a'))
      .mul(night)
      .mul(1.6)
      .add(emissive);
  }
  surface.emissiveNode = emissive;
  const globe = new T.Mesh(new T.SphereGeometry(p.radius, 96, 64), surface);
  planet.add(globe);

  let clouds: T.Mesh | null = null;
  if (p.clouds) {
    const cloudMaterial = new T.MeshStandardNodeMaterial({
      transparent: true,
      depthWrite: false,
      roughness: 1,
      metalness: 0,
    });
    cloudMaterial.colorNode = color('#e9f2fa');
    cloudMaterial.opacityNode = texture(loadTexture(p.clouds, true)).a.mul(0.85);
    clouds = new T.Mesh(new T.SphereGeometry(p.radius * 1.012, 64, 44), cloudMaterial);
    planet.add(clouds);
  }

  // Two shells of scattering: a tight bright limb and a wide soft halo.
  const inward = normalWorld.dot(viewDir).abs();
  const haloMaterial = new T.MeshBasicNodeMaterial({
    transparent: true,
    side: T.BackSide,
    blending: T.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  haloMaterial.colorNode = mix(color(p.halo[0]), color(p.halo[1]), float(1).sub(inward).pow(2));
  haloMaterial.opacityNode = float(1).sub(inward).pow(2.6).mul(p.haloGain);
  planet.add(new T.Mesh(new T.SphereGeometry(p.radius * 1.055, 64, 44), haloMaterial));
  const glowMaterial = new T.MeshBasicNodeMaterial({
    transparent: true,
    side: T.BackSide,
    blending: T.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  glowMaterial.colorNode = color(p.glow);
  glowMaterial.opacityNode = float(1).sub(inward).pow(1.4).mul(p.glowGain);
  planet.add(new T.Mesh(new T.SphereGeometry(p.radius * 1.15, 48, 32), glowMaterial));

  /* --- Moons, drifting with the star bands --------------------------- */
  const moons: T.Mesh[] = [];
  const moonTexture = loadTexture('planets/moon_color.jpg', true);
  for (const m of config.moons) {
    const moon = new T.Mesh(
      new T.SphereGeometry(m.radius, 48, 32),
      new T.MeshStandardNodeMaterial({ map: moonTexture, roughness: 1, metalness: 0 }),
    );
    moon.position.set(...m.at);
    const echo = moon.clone();
    echo.position.x += m.span;
    const layer = new T.Group();
    layer.add(moon, echo);
    root.add(layer);
    layers.push({ object: layer, speed: m.speed, span: m.span });
    moons.push(moon, echo);
  }

  /* --- Orbital ring station, sliding past on the mid plane ----------- */
  const spinners: T.Object3D[] = [];
  if (config.station) {
    const station = new T.Group();
    station.position.set(0, 6, -34);
    station.rotation.set(0.23, 0.48, 0);
    const frameMat = metal('#293a45', 0.72),
      trim = metal('#55626a', 0.65);
    const dummy = new T.Object3D();
    for (const r of [10.4, 11.7])
      station.add(new T.Mesh(new T.TorusGeometry(r, 0.3, 8, 100), frameMat));
    const plates = new T.InstancedMesh(new T.BoxGeometry(1.2, 1.8, 0.8), frameMat, 64),
      strips = new T.InstancedMesh(
        new T.BoxGeometry(0.035, 1.1, 0.83),
        new T.MeshBasicNodeMaterial({ color: '#647c83' }),
        64,
      );
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      dummy.position.set(Math.cos(a) * 11, Math.sin(a) * 11, 0);
      dummy.rotation.set(0, 0, a);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      plates.setMatrixAt(i, dummy.matrix);
      strips.setMatrixAt(i, dummy.matrix);
    }
    station.add(plates, strips);
    const windows = new T.InstancedMesh(
      new T.BoxGeometry(0.09, 0.18, 0.86),
      glow('#cfe3ea', 1.5),
      256,
    );
    for (let i = 0; i < 256; i++) {
      const a = (Math.floor(i / 4) / 64) * Math.PI * 2,
        r = 10.5 + (i % 4) * 0.32;
      dummy.position.set(Math.cos(a) * r, Math.sin(a) * r, 0);
      dummy.rotation.set(0, 0, a);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      windows.setMatrixAt(i, dummy.matrix);
    }
    station.add(windows);
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3,
        spoke = new T.Mesh(new T.BoxGeometry(8, 0.5, 0.5), trim);
      spoke.position.set(Math.cos(a) * 6, Math.sin(a) * 6, -0.6);
      spoke.rotation.z = a;
      station.add(spoke);
    }
    const hub = new T.Mesh(new T.CylinderGeometry(2.6, 3, 3, 12), frameMat);
    hub.rotation.x = Math.PI / 2;
    station.add(hub);
    const stationSpan = 190;
    const stationEcho = station.clone();
    stationEcho.position.x += stationSpan;
    const stationLayer = new T.Group();
    stationLayer.add(station, stationEcho);
    root.add(stationLayer);
    layers.push({ object: stationLayer, speed: 3.6, span: stationSpan });
    spinners.push(station, stationEcho);
  }

  /* --- Asteroid belt: five rock classes, each its own lane ----------- */
  const belts: { tumble: (t: number) => void }[] = [];
  for (const rock of ROCKS) {
    // A zero-count scene builds no belt at all.
    if (config.rocks.count <= 0) break;
    const span = 150;
    const field = asteroidField(rng, rock, span, config.rocks);
    root.add(field.mesh);
    layers.push({ object: field.mesh, speed: rock.speed, span });
    belts.push(field);
  }

  const ground = groundConfig ? buildGround(groundConfig) : null;
  if (ground) {
    root.add(ground.mesh);
    if (ground.roof) root.add(ground.roof);
  }

  const streakSpan = 120;
  const streaks = tiledField(
    new T.BoxGeometry(1, 1, 1),
    new T.MeshBasicNodeMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.34,
      blending: T.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
    90,
    streakSpan,
    (d, tint) => {
      d.position.set((rng.next() - 0.5) * streakSpan, (rng.next() - 0.5) * 34, -6 - rng.next() * 9);
      d.rotation.set(0, 0, 0);
      d.scale.set(0.4 + rng.next() * 2.1, 0.012 + rng.next() * 0.022, 0.02);
      tint.set(config.streakTint).multiplyScalar(0.3 + rng.next() * 0.8);
    },
  );
  root.add(streaks);
  layers.push({ object: streaks, speed: 26, span: streakSpan });

  return {
    root,
    planet,
    globe,
    ground,
    /** Advances every parallax band; `scale` lets the hangar idle drift slower. */
    update(t: number, scale = 1) {
      for (const belt of belts) belt.tumble(t * scale);
      for (const layer of layers) {
        const shift = (t * layer.speed * scale) % layer.span;
        layer.object.position.x = -shift;
      }
      globe.rotation.y = t * p.spin;
      if (clouds) {
        clouds.rotation.y = t * p.spin * 1.4;
        clouds.rotation.z = Math.sin(t * 0.03) * 0.02;
      }
      skybox.rotation.y = t * 0.0016;
      for (const s of spinners) s.rotation.z = t * 0.07;
      for (const m of moons) m.rotation.y = t * 0.006;
    },
  };
}
