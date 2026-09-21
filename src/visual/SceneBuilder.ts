import { asset } from '../core/assets';
import { buildStarField, type StarPalette } from './StarField';
import { terrainMaterial, type TerrainPbr } from './TerrainMaterial';
import { surfaceEffects } from './SurfaceEffects';
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
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Random } from '../core/math/Random';
import { Terrain } from '../core/math/Terrain';
import enemyDefs from '../../data/enemies/enemy-defs.json';
import fleetDesigns from '../../data/enemies/fleet-designs.json';
import fleetHardpoints from '../../data/enemies/fleet-hardpoints.json';
import groundHardpoints from '../../data/enemies/ground-hardpoints.json';

export function glow(c: string, intensity = 2) {
  const m = new T.MeshBasicNodeMaterial({ color: c, toneMapped: false });
  m.colorNode = color(c).mul(intensity);
  return m;
}

/* ------------------------------------------------------------------ *
 * Player ship
 * ------------------------------------------------------------------ */
export { animateShip } from './PlayerShip';
export {
  loadImportedFleet,
  finishHull,
  HULL_MATERIALS,
  makeImportedShip as makeShip,
  makeImportedBoss as makeBoss,
  importedEnemyGeometry as enemyGeometry,
  importedGroundGeometry as groundGeometry,
} from './ImportedFleet';

/* ------------------------------------------------------------------ *
 * Enemy fleet - 34 individually fitted hulls
 *
 * Every hull is authored nose first along -X (enemies fly right to left).
 * Parts carry their colour in a vertex attribute, so a whole type renders
 * as two instanced draw calls: a lit hull and an additive accent pass.
 * Accent colours are written above 1.0 so the bloom pass catches them.
 * ------------------------------------------------------------------ */
export const ENEMY_TYPES = enemyDefs.length;

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

export type EnemyHulls = {
  hull: T.BufferGeometry | null;
  accent: T.BufferGeometry | null;
  /** Imported hulls: base colour and packed metallic-roughness textures. */
  map?: T.Texture | null;
  surface?: T.Texture | null;
};

// Every entry has its own topology, palette and surface finish.
export const FLEET_STYLE = fleetDesigns.map(
  (unit) => [unit.name, unit.palette[0], unit.palette[1], unit.palette[3], 0.55, 0.42] as const,
);

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
  size: Math.min(0.075, enemyDefs[type].radius * 0.1),
  hex: style[3],
  x: fleetHardpoints[type].muzzles[0][0],
  y: fleetHardpoints[type].muzzles[0][1],
  z: fleetHardpoints[type].muzzles[0][2],
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

export function legacyEnemyGeometry(type: number): EnemyHulls {
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
const TEXTURE_ROOT = asset('/textures/');
const loader = new T.TextureLoader();
const textureCache = new Map<string, T.Texture>();
function loadTexture(path: string, srgb: boolean, repeat = false) {
  const key = `${path}:${srgb}:${repeat}`;
  const cached = textureCache.get(key);
  if (cached) return cached;
  const t = loader.load(TEXTURE_ROOT + path);
  textureCache.set(key, t);
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

function nebulaSheet(
  rng: Random,
  width: number,
  height: number,
  hexA: string,
  hexB: string,
  gain = 1,
) {
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
  material.opacityNode = n
    .pow(2.2)
    .mul(falloff)
    .mul(0.5 * gain);
  return new T.Mesh(new T.PlaneGeometry(width, height), material);
}

/* ------------------------------------------------------------------ *
 * Asteroids
 *
 * Nine photographed rock surfaces (Poly Haven, CC0) with their normal maps,
 * two to each belt class, over five body shapes - lumpy, elongated, shattered,
 * cratered and contact binary - so the belt reads as a mix of real bodies
 * rather than one repeated prop. Each class has its own colour, size band and
 * depth lane.
 * ------------------------------------------------------------------ */
type AsteroidShape = 'lumpy' | 'elongated' | 'shard' | 'cratered' | 'binary';

type RockClass = {
  /** Poly Haven slugs, used as texture file names; variants alternate them. */
  textures: string[];
  /** Body shapes, one instanced batch each; the class's bodies are dealt across them. */
  shapes: AsteroidShape[];
  tint: string;
  roughness: number;
  metalness: number;
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

/**
 * Share of each class's authored count that is actually flown. The belt used
 * to crowd the play field; half as many bodies, each more distinct, reads as
 * a richer scene and gets out of the way of the fight.
 */
const BELT_DENSITY = 0.5;
/** Vertical spread of the belt: tall enough that tilting the view never runs out of rocks. */
const BELT_HEIGHT = 150;

const ROCKS: RockClass[] = [
  // C-type: the big dark carbonaceous bodies drifting furthest out.
  {
    textures: ['dark_rock', 'rock_face'],
    shapes: ['lumpy', 'cratered', 'binary'],
    tint: '#9a958d',
    roughness: 0.96,
    metalness: 0.04,
    lumps: 0.14,
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
    textures: ['gray_rocks', 'rock_05'],
    shapes: ['elongated', 'cratered', 'lumpy'],
    tint: '#a9a7a1',
    roughness: 0.86,
    metalness: 0.1,
    lumps: 0.18,
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
    textures: ['marble_rock_02', 'gray_rocks'],
    shapes: ['shard', 'elongated', 'shard'],
    tint: '#b9c8d8',
    roughness: 0.42,
    metalness: 0.65,
    lumps: 0.1,
    min: 0.4,
    max: 1.5,
    count: 16,
    near: -34,
    far: -58,
    speed: 7.5,
    spin: 0.6,
    bulk: 0.5,
  },
  // Oxidised silicate: rust-red, layered and heavily eroded.
  {
    textures: ['rock_06', 'cliff_side'],
    shapes: ['binary', 'lumpy', 'elongated'],
    tint: '#c08c58',
    roughness: 0.92,
    metalness: 0.07,
    lumps: 0.16,
    min: 0.9,
    max: 3.1,
    count: 14,
    near: -50,
    far: -80,
    speed: 4.8,
    spin: 0.25,
    bulk: 0.9,
  },
  // Rubble: the near lane, small, cracked and tumbling fast.
  {
    textures: ['rock_04', 'rock_boulder_cracked'],
    shapes: ['shard', 'lumpy', 'shard'],
    tint: '#95897b',
    roughness: 0.9,
    metalness: 0.06,
    lumps: 0.2,
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

/**
 * Deterministic 3D value noise, summed over a few octaves. Displacement reads
 * it as a function of direction alone, so every copy of a vertex lands on the
 * same point and the surface stays welded.
 */
function rockNoise(rng: Random) {
  const N = 32;
  const lattice = new Float32Array(N * N * N);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next() * 2 - 1;
  const wrap = (v: number) => ((v % N) + N) % N;
  const at = (x: number, y: number, z: number) => lattice[(wrap(z) * N + wrap(y)) * N + wrap(x)];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const value = (x: number, y: number, z: number) => {
    const x0 = Math.floor(x),
      y0 = Math.floor(y),
      z0 = Math.floor(z);
    const fx = smooth(x - x0),
      fy = smooth(y - y0),
      fz = smooth(z - z0);
    let sum = 0;
    for (let k = 0; k < 8; k++) {
      const dx = k & 1,
        dy = (k >> 1) & 1,
        dz = (k >> 2) & 1;
      sum +=
        at(x0 + dx, y0 + dy, z0 + dz) *
        (dx ? fx : 1 - fx) *
        (dy ? fy : 1 - fy) *
        (dz ? fz : 1 - fz);
    }
    return sum;
  };
  const offset = rng.next() * 17;
  return (x: number, y: number, z: number, octaves = 4) => {
    let sum = 0,
      amp = 0.55,
      freq = 1.6;
    for (let o = 0; o < octaves; o++) {
      sum += value(x * freq + offset, y * freq + offset * 0.7, z * freq - offset) * amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum;
  };
}

/** A random unit vector, drawn so the directions cover the sphere evenly. */
function randomDirection(rng: Random): [number, number, number] {
  const z = rng.next() * 2 - 1,
    a = rng.next() * Math.PI * 2,
    r = Math.sqrt(1 - z * z);
  return [Math.cos(a) * r, Math.sin(a) * r, z];
}

/**
 * The body's radius along a direction, before surface noise. Every shape is a
 * star-shaped function of direction, which is what lets one subdivided sphere
 * be pushed out into any of them without folding over itself.
 */
function shapeField(rng: Random, shape: AsteroidShape) {
  switch (shape) {
    case 'elongated': {
      // A potato: a stretched ellipsoid, never quite symmetrical.
      const a = 1.35 + rng.next() * 0.35,
        b = 0.72 + rng.next() * 0.16,
        c = 0.78 + rng.next() * 0.18;
      return (x: number, y: number, z: number) =>
        1 / Math.sqrt((x / a) ** 2 + (y / b) ** 2 + (z / c) ** 2);
    }
    case 'shard': {
      // A fragment knocked off something larger: a rounded core with planar
      // fracture faces sheared off it.
      const cuts: [number, number, number, number][] = [];
      const count = 5 + Math.floor(rng.next() * 4);
      for (let i = 0; i < count; i++) cuts.push([...randomDirection(rng), 0.58 + rng.next() * 0.3]);
      return (x: number, y: number, z: number) => {
        let r = 1.08;
        for (const [nx, ny, nz, h] of cuts) {
          const d = x * nx + y * ny + z * nz;
          if (d > 0.05) r = Math.min(r, h / d);
        }
        return r;
      };
    }
    case 'cratered': {
      // Bowls with raised rims, from a few large impacts down to pockmarks.
      const craters: [number, number, number, number, number][] = [];
      const count = 5 + Math.floor(rng.next() * 5);
      for (let i = 0; i < count; i++) {
        const size = 0.18 + rng.next() ** 2 * 0.42;
        craters.push([...randomDirection(rng), size, size * (0.22 + rng.next() * 0.12)]);
      }
      return (x: number, y: number, z: number) => {
        let r = 1;
        for (const [cx, cy, cz, size, depth] of craters) {
          const t = Math.acos(Math.min(1, x * cx + y * cy + z * cz)) / size;
          if (t < 1) r -= depth * (1 - t * t);
          else if (t < 1.45) r += depth * 0.35 * Math.sin(((t - 1) / 0.45) * Math.PI);
        }
        return r;
      };
    }
    case 'binary': {
      // Two bodies that met slowly and stuck: a peanut with a waist.
      const lobes: [number, number, number, number][] = [
        [0.42, 0, 0, 0.72],
        [-0.46, 0.08, 0.04, 0.58 + rng.next() * 0.1],
      ];
      return (x: number, y: number, z: number) => {
        let r = 0;
        for (const [cx, cy, cz, radius] of lobes) {
          // Far intersection of the ray from the centre with the lobe.
          const along = x * cx + y * cy + z * cz;
          r = Math.max(
            r,
            along + Math.sqrt(along * along - (cx * cx + cy * cy + cz * cz) + radius ** 2),
          );
        }
        return r;
      };
    }
    default:
      return () => 1;
  }
}

/**
 * A subdivided sphere pushed out into one body shape, then roughened with
 * fractal noise. Normals are computed on the welded mesh so a dense body
 * shades smooth; UVs are box-projected per face, with the axis chosen from
 * the face's direction from the centre rather than its normal, so the
 * projection only changes along six broad seams instead of at every facet.
 */
function asteroidGeometry(rng: Random, detail: number, lumps: number, shape: AsteroidShape) {
  const noise = rockNoise(rng);
  const field = shapeField(rng, shape);
  const welded = mergeVertices(new T.IcosahedronGeometry(1, detail), 1e-5);
  const position = welded.attributes.position as T.BufferAttribute;
  // A ridged octave on top of the smooth one: sharp crests read as weathering.
  const ridge = shape === 'shard' ? 0.5 : 1;
  for (let i = 0; i < position.count; i++) {
    const len = Math.hypot(position.getX(i), position.getY(i), position.getZ(i)) || 1;
    const x = position.getX(i) / len,
      y = position.getY(i) / len,
      z = position.getZ(i) / len;
    const bumps =
      noise(x, y, z) * lumps + (0.5 - Math.abs(noise(z, x, y, 3))) * lumps * 0.35 * ridge;
    const r = field(x, y, z) * (1 + bumps);
    position.setXYZ(i, x * r, y * r, z * r);
  }
  welded.computeVertexNormals();
  const g = welded.toNonIndexed();
  const pos = g.attributes.position as T.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  const shiftU = rng.next(),
    shiftV = rng.next();
  for (let t = 0; t < pos.count; t += 3) {
    const cx = Math.abs(pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)),
      cy = Math.abs(pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)),
      cz = Math.abs(pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2));
    const axis = cx > cy && cx > cz ? 0 : cy > cz ? 1 : 2;
    for (let k = t; k < t + 3; k++) {
      const vx = pos.getX(k),
        vy = pos.getY(k),
        vz = pos.getZ(k);
      uv[k * 2] = (axis === 0 ? vz : vx) * 0.42 + shiftU;
      uv[k * 2 + 1] = (axis === 1 ? vz : vy) * 0.42 + shiftV;
    }
  }
  g.setAttribute('uv', new T.BufferAttribute(uv, 2));
  return g;
}

/** Colour and relief for one photographed rock surface. */
function rockMaps(slug: string) {
  return {
    map: loadTexture(`rocks/${slug}.jpg`, true, true),
    normalMap: loadTexture(`rocks/${slug}_nor.jpg`, false, true),
  };
}

/** A tiled, tumbling belt of one rock class, one instanced batch per body shape. */
function asteroidField(
  rng: Random,
  rock: RockClass,
  span: number,
  mix: { count: number; min: number; max: number; bias: number },
) {
  const variants = rock.shapes.map((shape, v) => ({
    geometry: asteroidGeometry(rng, 7, rock.lumps, shape),
    material: new T.MeshStandardNodeMaterial({
      ...rockMaps(rock.textures[v % rock.textures.length]),
      normalScale: new T.Vector2(1.4, 1.4),
      color: rock.tint,
      roughness: rock.roughness,
      metalness: rock.metalness,
    }),
  }));
  // A near lane takes only a fraction of the scene's extra bodies and size.
  const gain = 1 + (mix.max - 1) * rock.bulk;
  const count = Math.max(
    variants.length,
    Math.round(
      rock.count *
        BELT_DENSITY *
        (BELT_HEIGHT / 95) *
        (1 + (mix.count - 1) * (0.35 + 0.65 * rock.bulk)),
    ),
  );
  const min = rock.min * mix.min,
    max = rock.max * gain;
  const dummy = new T.Object3D(),
    tint = new T.Color();
  const batches = variants.map((variant, v) => {
    const total = Math.ceil((count - v) / variants.length) * 3;
    const mesh = new T.InstancedMesh(variant.geometry, variant.material, total);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    // x y z, sx sy sz, rx ry rz per instance, plus a tumble rate.
    return { mesh, total, base: new Float32Array(total * 9), rate: new Float32Array(total * 3) };
  });
  const filled = new Int32Array(batches.length);
  for (let i = 0; i < count; i++) {
    const batch = batches[i % batches.length];
    const slot = filled[i % batches.length]++;
    const x = (rng.next() - 0.5) * span,
      y = (rng.next() - 0.5) * BELT_HEIGHT,
      z = rock.near - rng.next() * (rock.near - rock.far);
    // A biased roll over the class's size band: mostly small bodies, with the
    // occasional very large one. Raising the bias widens the gap between them.
    const roll = Math.pow(rng.next(), mix.bias);
    const s = min + roll * (max - min);
    const sy = s * (0.7 + rng.next() * 0.55),
      sz = s * (0.7 + rng.next() * 0.55);
    const rx = rng.next() * 6.283,
      ry = rng.next() * 6.283,
      rz = rng.next() * 6.283;
    const wx = (rng.next() - 0.5) * rock.spin,
      wy = (rng.next() - 0.5) * rock.spin,
      wz = (rng.next() - 0.5) * rock.spin;
    // Brightness and a slight warm or cool cast, so no two bodies match.
    const shade = 0.72 + rng.next() * 0.5,
      cast = (rng.next() - 0.5) * 0.12;
    tint.setRGB(shade * (1 + cast), shade, shade * (1 - cast));
    for (let tile = -1; tile <= 1; tile++) {
      const k = slot * 3 + tile + 1;
      batch.base.set([x + tile * span, y, z, s, sy, sz, rx, ry, rz], k * 9);
      batch.rate.set([wx, wy, wz], k * 3);
      batch.mesh.setColorAt(k, tint);
    }
  }
  return {
    meshes: batches.map((b) => b.mesh),
    tumble(t: number) {
      for (const { mesh, total, base, rate } of batches) {
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
      }
    },
  };
}

/**
 * A rock that is actually in the play field and has to be flown around.
 *
 * Built to be told apart at a glance from both the belt behind it and the
 * glowing shots around it: a solid, fully lit body with a hot hazard outline
 * (a back-face shell a size larger), where shots are small emissive shapes
 * with no surface and belt rocks carry no outline at all. Its shapes stay
 * close to round so the collision circle matches what the player sees.
 */
export const HAZARD_VARIANTS = 3;
export function hazardRock(variant: number) {
  const rng = new Random(51377 + variant * 7919);
  const shape = (['lumpy', 'cratered', 'lumpy'] as const)[variant % 3];
  const geometry = asteroidGeometry(rng, 9, 0.12 + variant * 0.03, shape);
  const body = new T.MeshStandardNodeMaterial({
    ...rockMaps(['rock_boulder_cracked', 'dark_rock', 'rock_06'][variant % 3]),
    normalScale: new T.Vector2(1.6, 1.6),
    color: ['#e6d2b8', '#d8cfc3', '#e8b98a'][variant % 3],
    roughness: 0.85,
    metalness: 0.04,
  });
  const rim = new T.MeshBasicNodeMaterial({ side: T.BackSide, toneMapped: false });
  rim.colorNode = color('#ff5a1c').mul(1.9);
  return { geometry, body, rim };
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
].map((core, i) => ({
  ...core,
  size: 0.07,
  x: groundHardpoints[i].muzzles[0][0],
  y: groundHardpoints[i].muzzles[0][1],
  z: groundHardpoints[i].muzzles[0][2],
}));
export function legacyGroundGeometry(type: number): EnemyHulls {
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
export type BossDesign = 'gatekeeper' | 'ares' | 'jove' | 'nereid' | 'warden' | 'sovereign';
export type BossModel = {
  root: T.Group;
  core: T.Mesh;
  ring: T.Group;
  pods: T.Group[];
  /** Strength of the red damage glow across the hull, when the model has one. */
  damage?: { value: number };
  /** One damage-glow uniform per entry in `pods`, so a nearly-dead pod burns
   *  red on its own instead of the whole ring flushing together. */
  podDamage?: { value: number }[];
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

/** Four heavily armoured capital ships with distinct silhouettes and weapon hardpoints. */
export function legacyMakeBoss(design: BossDesign): BossModel {
  const root = new T.Group(),
    ringGroup = new T.Group(),
    k = new Kit(),
    rotor = new Kit();
  const gate = design === 'gatekeeper',
    ares = design === 'ares',
    nereid = design === 'nereid';
  const hull = gate ? '#46525a' : ares ? '#63313a' : nereid ? '#597887' : '#43445f';
  const trim = gate ? '#8f8776' : ares ? '#8d7962' : nereid ? '#91b4bf' : '#8b809d';
  const lamp = gate ? '#ff733e' : ares ? '#ffb546' : nereid ? '#58d8ff' : '#c589ff';
  const dark = gate ? '#171e26' : ares ? '#221c23' : nereid ? '#152936' : '#1c1c2c';
  k.hex = hull;
  rotor.hex = trim;
  const plate = (p: number[][], z = 0, d = 0.35, c = hull) => k.add(armour(p, d, z), c);
  // Recessed structures, overlapping slabs and small service details establish
  // scale; only reactor slits emit light, so the armour keeps its mass.
  if (gate) {
    // GATEKEEPER: a split-jaw orbital execution fortress.
    plate(
      [
        [3.5, -1.8],
        [2.6, -2.8],
        [0.1, -2.45],
        [-0.9, -1.05],
        [-1.4, 0],
        [-0.9, 1.05],
        [0.1, 2.45],
        [2.6, 2.8],
        [3.5, 1.8],
      ],
      -0.65,
      1.2,
      dark,
    );
    for (const side of [-1, 1]) {
      const y = (v: number) => v * side;
      plate(
        [
          [-3.8, y(1.1)],
          [-2.5, y(2.95)],
          [0.8, y(3.25)],
          [2.75, y(2.2)],
          [1.9, y(1.65)],
          [-1.3, y(1.6)],
        ],
        -0.1,
        0.72,
        hull,
      );
      plate(
        [
          [-3.7, y(1.1)],
          [-2.9, y(2.2)],
          [-0.8, y(2.55)],
          [0.5, y(2.5)],
          [-0.3, y(2.07)],
          [-2.1, y(1.75)],
        ],
        0.65,
        0.22,
        trim,
      );
      for (let j = 0; j < 7; j++) {
        const x = -2.2 + j * 0.65;
        k.add(
          box(0.33, 0.76, 0.28, x, y(2.55 - j * 0.065), 0.72, -side * 0.18),
          j % 2 ? dark : hull,
        );
        k.lit(box(0.11, 0.28, 0.028, x, y(2.56 - j * 0.065), 0.89), lamp, 1.35);
      }
      for (let j = 0; j < 3; j++) {
        k.add(tube(0.17, 0.28, 1.3, 16, -2.4, y(1.65 + j * 0.35), 0.35), dark);
        k.add(tube(0.2, 0.22, 0.14, 16, -3.05, y(1.65 + j * 0.35), 0.35), trim);
      }
      plate(
        [
          [-2.7, y(0.75)],
          [-1.5, y(1.4)],
          [-0.9, y(1.25)],
          [-1.3, y(0.6)],
        ],
        0.36,
        0.4,
        hull,
      );
      k.lit(box(0.8, 0.065, 0.04, -1.85, y(0.98), 0.82, side * 0.3), '#ff4a25', 2.2);
    }
    for (let j = 0; j < 6; j++) k.add(box(0.16, 2.7 - j * 0.13, 0.18, 1 + j * 0.32, 0, 0.75), trim);
    rotor.add(ring(1.23, 0.13, 12, 0, 0, 0.6), dark);
  } else if (ares) {
    // ARES: a brutal siege dreadnought, twin forward mass-driver trenches.
    plate(
      [
        [-3.6, -1.35],
        [-2.3, -2.8],
        [0.4, -2.3],
        [3.6, -1.45],
        [3.9, 0],
        [3.6, 1.45],
        [0.4, 2.3],
        [-2.3, 2.8],
        [-3.6, 1.35],
        [-2.25, 0],
      ],
      -0.65,
      1.1,
      dark,
    );
    for (const side of [-1, 1]) {
      const y = (v: number) => v * side;
      plate(
        [
          [-3.8, y(1.05)],
          [-2.6, y(2.75)],
          [-0.6, y(2.65)],
          [0.15, y(1.6)],
          [-1.2, y(0.6)],
        ],
        0.1,
        0.85,
        hull,
      );
      plate(
        [
          [0.2, y(0.65)],
          [3.65, y(0.8)],
          [3.15, y(1.8)],
          [0.6, y(2.3)],
          [-0.3, y(1.55)],
        ],
        0.15,
        0.55,
        hull,
      );
      for (let j = 0; j < 6; j++) {
        const x = -2.6 + j * 0.88;
        k.add(box(0.65, 0.56, 0.18, x, y(1.8), 0.95, -side * 0.16), j % 2 ? trim : hull);
        k.add(box(0.055, 0.51, 0.045, x, y(1.8), 1.06), dark);
        k.lit(box(0.25, 0.055, 0.03, x, y(1.56), 1.07), lamp, 1.5);
      }
      for (let j = 0; j < 3; j++) {
        k.add(tube(0.16, 0.24, 2.7, 16, -2.1, y(0.7 + j * 0.32), 0.62), dark);
        for (let q = 0; q < 4; q++)
          k.add(tube(0.2, 0.2, 0.1, 12, -3.3 + q * 0.5, y(0.7 + j * 0.32), 0.62), trim);
        k.lit(tube(0.12, 0.12, 0.045, 12, -3.5, y(0.7 + j * 0.32), 0.62), lamp, 2);
      }
      for (let j = 0; j < 4; j++) {
        k.add(tube(0.23, 0.3, 0.6, 12, 3.5, y(0.45 + j * 0.35), 0.15), dark);
        k.lit(tube(0.16, 0.16, 0.08, 12, 3.82, y(0.45 + j * 0.35), 0.15), '#ff6c25', 2);
      }
    }
    plate(
      [
        [-1, -0.65],
        [1.9, -0.55],
        [2.65, 0],
        [1.9, 0.55],
        [-1, 0.65],
      ],
      0.65,
      0.42,
      trim,
    );
    for (let j = 0; j < 9; j++) k.add(box(0.065, 0.85, 0.055, 0.3 + j * 0.18, 0, 1.12), dark);
    rotor.add(ring(1.05, 0.14, 8, 0, 0, 0.8), trim);
  } else if (nereid) {
    // NEREID: abyssal biomechanical leviathan, jagged ice plates over a spine.
    for (let j = 0; j < 9; j++) {
      const x = -2.7 + j * 0.72,
        cy = Math.sin(j * 0.42) * 0.45,
        r = 1.65 - j * 0.105;
      k.add(orb(1, x, cy, -0.1, 0.58, r, 0.6), dark);
      for (const side of [-1, 1]) {
        plate(
          [
            [x - 0.48, cy + side * 0.38],
            [x - 0.6, cy + side * r],
            [x + 0.18, cy + side * (r + 0.45)],
            [x + 0.46, cy + side * 0.66],
          ],
          0.15,
          0.44,
          j % 2 ? hull : trim,
        );
        plate(
          [
            [x - 0.35, cy + side * r],
            [x - 0.3, cy + side * (r + 1.15 - j * 0.045)],
            [x + 0.28, cy + side * (r + 0.15)],
          ],
          0.1,
          0.25,
          hull,
        );
        k.lit(box(0.05, r * 0.58, 0.04, x, cy + side * r * 0.7, 0.67, -side * 0.18), lamp, 1.7);
      }
      k.add(box(0.36, 0.58, 0.2, x, cy, 0.56), trim);
    }
    for (const side of [-1, 1]) {
      const y = (v: number) => v * side;
      plate(
        [
          [-4.75, y(0.32)],
          [-3.85, y(1.62)],
          [-2.6, y(1.3)],
          [-2.4, y(0.6)],
          [-3.4, y(0.7)],
        ],
        0.05,
        0.64,
        hull,
      );
      for (let j = 0; j < 5; j++)
        plate(
          [
            [-4.2 + j * 0.34, y(0.72)],
            [-4.05 + j * 0.34, y(0.13)],
            [-3.84 + j * 0.34, y(0.78)],
          ],
          0.12,
          0.2,
          trim,
        );
      k.lit(box(0.65, 0.075, 0.04, -3.2, y(1.05), 0.75, side * 0.23), '#ff584b', 2.2);
    }
    rotor.add(ring(1.12, 0.12, 10, 0, 0, 0.72), dark);
  } else {
    // JOVE: a cathedral-scale blade carrier, interleaved wings and reactor ribs.
    plate(
      [
        [-2, -0.5],
        [-0.5, -1.3],
        [2.85, -0.75],
        [3.4, 0],
        [2.85, 0.75],
        [-0.5, 1.3],
        [-2, 0.5],
      ],
      -0.55,
      1,
      dark,
    );
    for (const side of [-1, 1]) {
      const y = (v: number) => v * side;
      plate(
        [
          [-3.1, y(3.6)],
          [-1.4, y(4.05)],
          [1.2, y(3.5)],
          [3.2, y(1.5)],
          [0.5, y(0.65)],
          [-1, y(1.2)],
        ],
        -0.25,
        0.52,
        hull,
      );
      for (let j = 0; j < 5; j++) {
        const y0 = 0.95 + j * 0.53;
        plate(
          [
            [-1.8 - j * 0.2, y(y0)],
            [0.85, y(y0 + 0.6)],
            [2.8 - j * 0.22, y(y0 + 0.05)],
            [0.05, y(y0 - 0.18)],
          ],
          0.3 + j * 0.04,
          0.2,
          j % 2 ? trim : hull,
        );
        k.lit(box(1.1, 0.04, 0.035, -0.6, y(y0 + 0.06), 0.57 + j * 0.04, side * 0.18), lamp, 1.55);
        k.add(tube(0.08, 0.13, 1.35, 12, -1.7, y(y0), 0.52), dark);
      }
      for (let j = 0; j < 4; j++) {
        plate(
          [
            [1.4, y(0.7 + j * 0.5)],
            [4 - j * 0.25, y(1.1 + j * 0.65)],
            [2.7, y(0.7 + j * 0.5)],
          ],
          -0.2,
          0.22,
          trim,
        );
        k.add(box(0.28, 0.24, 0.42, 0.5, y(0.65 + j * 0.44), 0.75), dark);
      }
    }
    for (let j = 0; j < 7; j++) {
      k.add(box(0.14, 1.7, 0.2, 0.7 + j * 0.27, 0, 0.72), trim);
      k.lit(box(0.045, 0.75, 0.025, 0.7 + j * 0.27, 0, 0.84), lamp, 1.4);
    }
    rotor.add(ring(1.2, 0.12, 12, 0, 0, 0.75), dark);
  }
  // Raised fasteners and recessed maintenance panels, at a much smaller scale
  // than the primary armour. Merged into two batches, not individual draw calls.
  for (let j = 0; j < 32; j++) {
    const a = (j / 32) * Math.PI * 2,
      r = 1.65 + (j % 3) * 0.17;
    k.add(disc(0.047, 0.06, 8, Math.cos(a) * r, Math.sin(a) * r, 0.82), trim);
  }
  k.add(disc(1.14, 0.3, 16, 0, 0, 0.45), dark);
  k.add(ring(1.02, 0.14, 32, 0, 0, 0.78), trim);
  for (let j = 0; j < 12; j++) {
    const a = (j / 12) * Math.PI * 2;
    k.add(box(0.38, 0.1, 0.17, Math.cos(a) * 0.95, Math.sin(a) * 0.95, 0.9, a), hull);
    rotor.lit(box(0.13, 0.045, 0.035, Math.cos(a) * 1.25, Math.sin(a) * 1.25, 0.94, a), lamp, 1.8);
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
    new T.CylinderGeometry(0.68, 0.68, 0.12, 32).rotateX(Math.PI / 2),
    glow(lamp, 1.55),
  );
  core.position.z = 0.86;
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
    // Armoured drone gunship with a recessed lens and vented flank.
    for (const side of [-1, 1]) {
      pk.add(box(0.5, 0.1, 0.13, 0.05, side * 0.35, 0.4), dark);
      for (let v = 0; v < 4; v++)
        pk.add(box(0.04, 0.12, 0.025, -0.2 + v * 0.12, side * 0.35, 0.48), trim);
      pk.add(tube(0.055, 0.085, 0.55, 10, -0.55, side * 0.24, 0.22), dark);
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
  /** Photographic PBR layers; replaces `texture`/`normal`/`roughness` when present. */
  pbr?: TerrainPbr;
};

/** Builds one surface strip from a height field. */
function buildStrip(cfg: GroundConfig, terrain: Terrain, flip: boolean) {
  // Photographic surfaces get twice the mesh: their normal maps light the
  // grain, but the silhouette of every ridge still comes from the geometry.
  const columns = cfg.pbr ? 504 : 252,
    rows = cfg.pbr ? 104 : 52;
  const near = (flip ? cfg.roof?.near : undefined) ?? cfg.near,
    far = (flip ? cfg.roof?.far : undefined) ?? cfg.far;
  const width = cfg.span * 3,
    depth = near - far;
  const geometry = new T.PlaneGeometry(width, depth, columns, rows);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position as T.BufferAttribute;
  const uv = geometry.attributes.uv as T.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const lifts = new Float32Array(position.count);
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
    lifts[i] = lift;
    if (cfg.pbr) {
      // The scans carry the colour; the vertices only add valley shadow and
      // the distance haze.
      shade.setScalar(0.7 + 0.3 * Math.pow(lift, 0.6));
      shade.lerp(haze, Math.pow(away, 1.5) * (flip ? 0.7 : 0.55));
      if (flip) shade.multiplyScalar(1.6);
      colors[i * 3] = shade.r;
      colors[i * 3 + 1] = shade.g;
      colors[i * 3 + 2] = shade.b;
      const tile = cfg.pbr.tile * (flip ? 0.75 : 1);
      uv.setXY(i, x / tile, z / tile + (flip ? 0.37 : 0));
      continue;
    }
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
  geometry.setAttribute('lift', new T.BufferAttribute(lifts, 1));
  geometry.computeVertexNormals();
  if (cfg.pbr) {
    const surface = new T.Mesh(geometry, terrainMaterial(cfg.pbr, flip));
    surface.frustumCulled = false;
    return surface;
  }
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
  const kind = cfg.pbr?.lava ? 'lava' : cfg.pbr?.glow ? 'ice' : null;
  const effects = kind
    ? surfaceEffects(kind, terrain, vault, {
        span: cfg.span,
        near: cfg.near,
        far: cfg.far,
        base: cfg.base,
        roofNear: cfg.roof?.near,
        roofFar: cfg.roof?.far,
      })
    : null;
  // Scenery tied to the ground rides on its mesh, so the scroll carries it.
  if (effects) {
    if (effects.deck.length) mesh.add(...effects.deck);
    if (roof && effects.vault.length) roof.add(...effects.vault);
  }
  return {
    mesh,
    roof,
    terrain,
    vault,
    span: cfg.span,
    speed: cfg.speed,
    atmosphere: effects?.still ?? [],
  };
}

/* ------------------------------------------------------------------ *
 * Backdrop scenes
 * ------------------------------------------------------------------ */
export type SceneName = 'earth' | 'mars' | 'jupiter' | 'neptune' | 'milkyway';

type PlanetConfig = {
  map: string;
  /** Optional PBR support maps; Mars ships colour only. */
  normal?: string;
  specular?: string;
  clouds?: string;
  lights?: string;
  radius: number;
  position: [number, number, number];
  /** Baseline scale the body is built/placed at, before any `drift` eases it elsewhere. Defaults to 1. */
  scale?: number;
  /** CSS-pixel diameter at the start of an approach, independent of resolution. */
  startDiameterPx?: number;
  /** Stage progress interval in which the complete body is visible (end exclusive). */
  visibleDuring?: [number, number];
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
  /**
   * A one-shot, one-way ease over a stage's run (see the `progress` param
   * on `update()`, same mechanism as `galaxy` below) - the planet eases
   * from `position`/`scale` (its own baseline above) at `window[0]` to this
   * end position/scale at `window[1]`, holding at whichever endpoint is
   * nearer outside that range, and never resets mid-stage. Works in either
   * direction: a small end scale reads as receding into the distance
   * (Earth), or a tiny *baseline* `scale` easing up to a normal one reads as
   * approaching out of nowhere (Mars' `secondPlanet` handoff to Jupiter).
   * Omit for a planet that just sits where it's placed, like every other
   * scene's.
   */
  drift?: { position: [number, number, number]; scale: number; window?: [number, number] };
};

type SceneConfig = {
  skyTint: string;
  skyGain: number;
  nebula: [string, string][];
  /** How much of the nebula survives over the black sky, 0 to 1. */
  nebulaGain: number;
  stars: StarPalette;
  planet: PlanetConfig;
  /**
   * A second full planet body, handed off from the first over the run (see
   * `PlanetConfig.drift`) - Mars shrinking away into Jupiter growing in for
   * stage 2. Its position and starting diameter describe the distant body,
   * and its `drift` is where it grows to. Omit for a scene
   * with only the one planet.
   */
  secondPlanet?: PlanetConfig;
  moons: { radius: number; at: [number, number, number]; speed: number; span: number }[];
  /** Multipliers on the shared rock classes: how many, how big, how varied. */
  rocks: { count: number; min: number; max: number; bias: number };
  streakTint: string;
  /**
   * A real photograph, panned into view over a stage's run rather than
   * tiled - see the `progress` param on `update()`. Omit for a scene with
   * no such backdrop.
   */
  galaxy?: {
    /** Final, fully-framed resting position (progress 1). */
    position: [number, number, number];
    /** World units the plane starts offset to +X at progress 0. */
    travel: number;
    width: number;
    height: number;
  };
};

const SCENES: Record<SceneName, SceneConfig> = {
  earth: {
    skyTint: '#6f8fb8',
    skyGain: 0.035,
    nebulaGain: 0.22,
    stars: {
      tints: [
        ['#ffffff', 5],
        ['#cfe0ff', 4],
        ['#9fbfff', 2],
        ['#fff2d8', 2],
        ['#ffd2a1', 1],
        ['#ffb0a0', 0.4],
      ],
      density: 1,
      twinkle: 0.9,
    },
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
      // Low and far right: only the upper limb crosses the play field at
      // the start of the run - it drifts back and shrinks from there (see
      // `drift`) until the whole globe reads as a small, distant world.
      position: [22, -48, -74],
      tilt: -0.28,
      tint: '#8fa4ba',
      halo: ['#2d6cff', '#a8d8ff'],
      haloGain: 0.6,
      glow: '#2f74d8',
      glowGain: 0.16,
      spin: 0.0125,
      terminator: 0,
      // Eases toward a centred, fully-framed position as it pulls away, so
      // the whole planet comes into view partway through the run rather
      // than staying cropped at the corner while it shrinks. The end scale
      // brings its on-screen footprint down to roughly 300x300px at a
      // 1920x1080 reference size.
      drift: { position: [6, -10, -140], scale: 0.39 },
    },
    moons: [{ radius: 4.6, at: [-46, 26, -102], speed: 1.1, span: 260 }],
    rocks: { count: 1, min: 1, max: 1, bias: 2 },
    streakTint: '#9fd0ff',
  },
  mars: {
    skyTint: '#a88068',
    skyGain: 0.03,
    nebulaGain: 0.2,
    stars: {
      tints: [
        ['#ffffff', 4],
        ['#ffe9cf', 4],
        ['#ffc998', 2.5],
        ['#ff9f86', 1.2],
        ['#d4e2ff', 1.5],
      ],
      density: 1.05,
      twinkle: 1,
    },
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
      // Centred and far back, so the whole disc sits inside the frame at
      // the start of the run - it shrinks away to nothing by mid-stage
      // (see `drift`), handing off to Jupiter growing in (`secondPlanet`).
      position: [14, -6, -118],
      tilt: 0.19,
      tint: '#6f5a4a',
      halo: ['#d4531f', '#ffb98a'],
      haloGain: 0.16,
      glow: '#b4552a',
      glowGain: 0.05,
      spin: 0.032,
      terminator: 0.85,
      visibleDuring: [0, 0.5],
      drift: { position: [20, -20, -140], scale: 0.0001, window: [0, 0.5] },
    },
    // Jupiter appears as a 10px speck at mid-stage, then
    // grows across the second half to exactly the on-screen size Mars had
    // at progress 0 - same position Mars started at, and its own scale set
    // so radius*scale (26) matches Mars' own radius at scale 1.
    secondPlanet: {
      map: 'planets/jupiter_color.jpg',
      radius: 46,
      position: [0, 0, -150],
      scale: 0.01,
      startDiameterPx: 10,
      visibleDuring: [0.5, Infinity],
      tilt: 0.06,
      tint: '#8a7358',
      halo: ['#d08a3a', '#ffd9a8'],
      haloGain: 0.34,
      glow: '#b87a3a',
      glowGain: 0.12,
      spin: 0.05,
      terminator: 0.7,
      drift: { position: [14, -6, -118], scale: 26 / 46, window: [0.5, 1] },
    },
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
    skyTint: '#9c8468',
    skyGain: 0.03,
    nebulaGain: 0.18,
    stars: {
      tints: [
        ['#ffffff', 4],
        ['#fff0c8', 4],
        ['#ffd98f', 2],
        ['#c8dcff', 2],
        ['#ffb27a', 0.8],
      ],
      density: 0.95,
      twinkle: 0.85,
    },
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
    skyTint: '#6c8fae',
    skyGain: 0.03,
    nebulaGain: 0.2,
    stars: {
      tints: [
        ['#ffffff', 4],
        ['#d6ecff', 4],
        ['#a4d2ff', 3],
        ['#b8fff4', 1.2],
        ['#e4d4ff', 1],
        ['#fff1d6', 1],
      ],
      density: 1,
      twinkle: 0.95,
    },
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
    // Triton, retrograde and pale.
    moons: [{ radius: 2.6, at: [-40, 16, -96], speed: 2.4, span: 200 }],
    rocks: { count: 0, min: 1, max: 1, bias: 2.4 },
    streakTint: '#bfe4ff',
  },
  milkyway: {
    skyTint: '#5a6fb0',
    skyGain: 0.032,
    nebulaGain: 0.16,
    stars: {
      tints: [
        ['#ffffff', 5],
        ['#cfe0ff', 4],
        ['#e6d4ff', 2],
        ['#fff2d8', 1.4],
        ['#a4d2ff', 1.2],
      ],
      density: 1.15,
      twinkle: 1,
    },
    // Kept dark and sparse relative to the other scenes - the galaxy photo
    // itself is the hero backdrop; painted nebula sheets would compete with it.
    nebula: [
      ['#0d1230', '#2c3f8e'],
      ['#160d30', '#4a2f8e'],
      ['#0a1c33', '#255a7a'],
    ],
    // A small, distant, unlit planetoid glimpsed at the field's edge - a
    // way-marker for a deep-space transit, not a scene-dominating world.
    planet: {
      map: 'planets/moon_color.jpg',
      radius: 7,
      position: [-48, -30, -108],
      tilt: 0.32,
      tint: '#8a90a8',
      halo: ['#6a7fd8', '#c2ccff'],
      haloGain: 0.12,
      glow: '#4a5aa0',
      glowGain: 0.04,
      spin: 0.02,
      terminator: 0.6,
    },
    moons: [],
    rocks: { count: 0, min: 1, max: 1, bias: 2.4 },
    streakTint: '#b8c4ff',
    galaxy: {
      position: [8, 5, -150],
      travel: 130,
      width: 160,
      height: 160,
    },
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
  // Everything but the playable surface hangs from a pivot at the camera, so
  // turning it pans the whole sky as if the camera were looking around.
  const view = new T.Group();
  const sky = new T.Group();
  view.add(sky);
  root.add(view);

  /* --- Milky Way sky shell ------------------------------------------ */
  const skyMaterial = new T.MeshBasicNodeMaterial({
    side: T.BackSide,
    fog: false,
    depthWrite: false,
  });
  const skyMap = texture(loadTexture('space/starfield.jpg', true));
  // Near-black: the painted sky only lends the void a faint depth and tint.
  skyMaterial.colorNode = mix(color('#000102'), skyMap.mul(color(config.skyTint)), float(0.62)).mul(
    config.skyGain,
  );
  const skybox = new T.Mesh(new T.SphereGeometry(168, 48, 32), skyMaterial);
  skybox.renderOrder = -100;
  sky.add(skybox);

  /* --- Nebula sheets ------------------------------------------------- */
  const nebula = new T.Group();
  nebula.position.z = -86;
  sky.add(nebula);
  const nebulaSpan = 320;
  for (let i = 0; i < config.nebula.length; i++) {
    const sheet = nebulaSheet(
      rng,
      150 + rng.next() * 110,
      90 + rng.next() * 60,
      ...config.nebula[i],
      config.nebulaGain,
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

  /* --- Twinkling star field, three parallax depths ------------------ */
  const stars = buildStarField(4417 + Object.keys(SCENES).indexOf(name) * 7919, config.stars);
  sky.add(stars.group);
  layers.push(...stars.layers);

  /* --- The planet ---------------------------------------------------- */
  const sunDir = vec3(-0.42, 0.58, 0.7);
  const viewDir = cameraPosition.sub(positionWorld).normalize();
  const inward = normalWorld.dot(viewDir).abs();
  const limb = float(1).sub(inward).pow(3);
  /**
   * One full planet body (globe, optional clouds, halo, glow) from a
   * `PlanetConfig` - factored out so a scene can host a second one (see
   * `secondPlanet`) without duplicating the whole material/mesh stack.
   */
  function buildPlanetBody(p: PlanetConfig) {
    const group = new T.Group();
    group.name = p.map;
    group.visible = !p.visibleDuring || p.visibleDuring[0] === 0;
    group.position.set(...p.position);
    group.scale.setScalar(p.scale ?? 1);
    group.rotation.z = p.tilt;
    sky.add(group);
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
    group.add(globe);

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
      group.add(clouds);
    }

    // Two shells of scattering: a tight bright limb and a wide soft halo.
    const haloMaterial = new T.MeshBasicNodeMaterial({
      transparent: true,
      side: T.BackSide,
      blending: T.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    haloMaterial.colorNode = mix(color(p.halo[0]), color(p.halo[1]), float(1).sub(inward).pow(2));
    haloMaterial.opacityNode = float(1).sub(inward).pow(2.6).mul(p.haloGain);
    group.add(new T.Mesh(new T.SphereGeometry(p.radius * 1.055, 64, 44), haloMaterial));
    const glowMaterial = new T.MeshBasicNodeMaterial({
      transparent: true,
      side: T.BackSide,
      blending: T.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    glowMaterial.colorNode = color(p.glow);
    glowMaterial.opacityNode = float(1).sub(inward).pow(1.4).mul(p.glowGain);
    group.add(new T.Mesh(new T.SphereGeometry(p.radius * 1.15, 48, 32), glowMaterial));
    const drift = p.drift
      ? {
          start: new T.Vector3(...p.position),
          end: new T.Vector3(...p.drift.position),
          startScale: p.scale ?? 1,
          endScale: p.drift.scale,
          window: p.drift.window ?? ([0, 1] as [number, number]),
        }
      : null;
    return { group, globe, clouds, drift };
  }
  const p = config.planet;
  const { group: planet, globe, clouds, drift: planetDrift } = buildPlanetBody(p);
  const second = config.secondPlanet ? buildPlanetBody(config.secondPlanet) : null;

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
    sky.add(layer);
    layers.push({ object: layer, speed: m.speed, span: m.span });
    moons.push(moon, echo);
  }

  /* --- Asteroid belt: five rock classes, each its own lane ----------- */
  const belts: { tumble: (t: number) => void }[] = [];
  for (const rock of ROCKS) {
    // A zero-count scene builds no belt at all.
    if (config.rocks.count <= 0) break;
    const span = 150;
    const field = asteroidField(rng, rock, span, config.rocks);
    for (const mesh of field.meshes) {
      sky.add(mesh);
      layers.push({ object: mesh, speed: rock.speed, span });
    }
    belts.push(field);
  }

  /* --- Galaxy backdrop: a real photo, panned into view over the stage --- */
  let galaxyPlane: T.Mesh | null = null;
  if (config.galaxy) {
    const g = config.galaxy;
    const galaxyMaterial = new T.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const galaxyMap = texture(loadTexture('space/galaxy.jpg', true));
    galaxyMaterial.colorNode = galaxyMap.rgb;
    // The source photo already fades near-black at its own edges; this just
    // guarantees no hard rectangular seam against the procedural sky behind it.
    const edge = uv().sub(0.5).length().mul(2).clamp(0, 1);
    galaxyMaterial.opacityNode = float(1).sub(edge).pow(1.2);
    galaxyPlane = new T.Mesh(new T.PlaneGeometry(g.width, g.height), galaxyMaterial);
    galaxyPlane.position.set(g.position[0] + g.travel, g.position[1], g.position[2]);
    galaxyPlane.renderOrder = -95;
    sky.add(galaxyPlane);
  }

  const ground = groundConfig ? buildGround(groundConfig) : null;
  if (ground) {
    root.add(ground.mesh);
    if (ground.roof) root.add(ground.roof);
    if (ground.atmosphere.length) root.add(...ground.atmosphere);
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
    68,
    streakSpan,
    (d, tint) => {
      d.position.set((rng.next() - 0.5) * streakSpan, (rng.next() - 0.5) * 64, -6 - rng.next() * 9);
      d.rotation.set(0, 0, 0);
      d.scale.set(0.4 + rng.next() * 2.1, 0.012 + rng.next() * 0.022, 0.02);
      tint.set(config.streakTint).multiplyScalar(0.3 + rng.next() * 0.8);
    },
  );
  sky.add(streaks);
  layers.push({ object: streaks, speed: 26, span: streakSpan });

  return {
    root,
    planet,
    globe,
    ground,
    /**
     * Advances every parallax band; `scale` lets the hangar idle drift slower.
     * `lookX`/`lookY` (-1..1) are where the ship sits in the field: flying low
     * tilts the view down toward what lies below, flying high lifts it. A tilt
     * about the camera moves every depth together; the added lift slides the
     * near layers further than the far ones, which is what sells the depth.
     *
     * `progress` (0-1, elapsed stage time / duration) drives the galaxy
     * backdrop's one-shot reveal pan - unlike the parallax layers above it
     * must not loop, so it stays out of `layers` and is driven directly here.
     */
    update(
      t: number,
      scale = 1,
      lookX = 0,
      lookY = 0,
      cameraZ = 33.6,
      progress = 0,
      viewportHeight = 1080,
      cameraFov = 30,
    ) {
      // A surface stage keeps its terrain fixed, so its sky follows more gently.
      // Vertically most of all: planet and sky bobbing up and down behind a
      // fixed deck made players dizzy, so stages three and four rise and fall
      // a third as far as they used to (0.45 -> 0.15); the sideways pan is kept.
      const reach = ground ? 0.45 : 1;
      const rise = ground ? 0.15 : 1;
      view.position.z = cameraZ;
      sky.position.z = -cameraZ;
      view.rotation.set(-lookY * 0.21 * rise, lookX * 0.05 * reach, 0);
      sky.position.x = -lookX * 1.5 * reach;
      sky.position.y = -lookY * 6 * rise;
      stars.update(t * scale);
      for (const belt of belts) belt.tumble(t * scale);
      for (const layer of layers) {
        const shift = (t * layer.speed * scale) % layer.span;
        // Translational parallax complements perspective without moving the playfield.
        const depth = Math.min(1, layer.speed / 8);
        layer.object.position.x = -shift - lookX * depth * 1.8 * reach;
        layer.object.position.y = -lookY * depth * 1.4 * rise;
      }
      // Same one-shot, progress-driven easing as the galaxy pan below - it
      // only ever eases one way over a run, never resets or reverses. Each
      // planet's own `window` (default the whole run) decides when.
      const applyDrift = (
        group: T.Group,
        body: PlanetConfig,
        drift: {
          start: T.Vector3;
          end: T.Vector3;
          startScale: number;
          endScale: number;
          window: [number, number];
        },
      ) => {
        const [w0, w1] = drift.window;
        const e = T.MathUtils.clamp((progress - w0) / Math.max(1e-6, w1 - w0), 0, 1);
        const ease = e * e * (3 - 2 * e);
        group.position.lerpVectors(drift.start, drift.end, ease);
        const startScale =
          body.startDiameterPx === undefined
            ? drift.startScale
            : (body.startDiameterPx *
                (cameraZ - drift.start.z) *
                Math.tan(T.MathUtils.degToRad(cameraFov / 2))) /
              (Math.max(1, viewportHeight) * body.radius);
        group.scale.setScalar(startScale + (drift.endScale - startScale) * ease);
      };
      const visibleAt = (body: PlanetConfig) =>
        !body.visibleDuring ||
        (progress >= body.visibleDuring[0] && progress < body.visibleDuring[1]);
      planet.visible = visibleAt(p);
      if (planetDrift) applyDrift(planet, p, planetDrift);
      if (second && config.secondPlanet) {
        second.group.visible = visibleAt(config.secondPlanet);
        if (second.drift) applyDrift(second.group, config.secondPlanet, second.drift);
      }
      globe.rotation.y = t * p.spin;
      if (clouds) {
        clouds.rotation.y = t * p.spin * 1.4;
        clouds.rotation.z = Math.sin(t * 0.03) * 0.02;
      }
      if (second && config.secondPlanet) {
        second.globe.rotation.y = t * config.secondPlanet.spin;
        if (second.clouds) {
          second.clouds.rotation.y = t * config.secondPlanet.spin * 1.4;
          second.clouds.rotation.z = Math.sin(t * 0.03) * 0.02;
        }
      }
      skybox.rotation.y = t * 0.0016;
      for (const m of moons) m.rotation.y = t * 0.006;
      if (galaxyPlane && config.galaxy) {
        const g = config.galaxy;
        galaxyPlane.position.x = g.position[0] + g.travel * (1 - T.MathUtils.clamp(progress, 0, 1));
      }
    },
  };
}
