import * as T from 'three/webgpu';
import {
  attribute,
  color,
  float,
  fract,
  mix,
  positionLocal,
  sin,
  smoothstep,
  texture,
  time,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import { Random } from '../core/math/Random';
import type { Terrain } from '../core/math/Terrain';
import { asset } from '../core/assets';

/**
 * Atmosphere for the two surface sectors. Everything animates on the GPU from
 * per-instance seeds and the renderer clock, so none of it costs a draw-call
 * update or a matrix upload per frame.
 *
 * - Io: embers and ash rising off the lava fields, and sulphur plumes - the
 *   umbrella eruptions Io is known for - standing on the far horizon.
 * - Glacial vault: icicles hanging from the vault, ice glitter falling through
 *   the corridor, and cold mist rolling over the deck.
 */

/**
 * A drifting cloud of glowing motes. `rise` is world units a second, negative
 * to fall; `drift` slides the cloud to the left so it keeps pace with the
 * scrolling ground rather than hanging in place.
 */
function motes(
  count: number,
  box: { x: number; y: [number, number]; z: [number, number] },
  look: { hot: string; cool: string; size: [number, number]; rise: number; drift: number },
  seed: number,
) {
  const rng = new Random(seed);
  const geometry = new T.PlaneGeometry(1, 1);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count * 4; i++) seeds[i] = rng.next();
  geometry.setAttribute('mote', new T.InstancedBufferAttribute(seeds, 4));
  const material = new T.MeshBasicNodeMaterial({
    transparent: true,
    blending: T.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const s = attribute<'vec4'>('mote', 'vec4');
  const height = box.y[1] - box.y[0];
  // Each mote cycles through the box on its own clock and speed.
  const cycle = fract(
    time
      .mul(s.w.mul(0.6).add(0.4))
      .mul(Math.abs(look.rise) / height)
      .add(s.y),
  );
  const y =
    look.rise > 0 ? cycle.mul(height).add(box.y[0]) : float(box.y[1]).sub(cycle.mul(height));
  const x = fract(s.x.sub(time.mul(look.drift / box.x)))
    .sub(0.5)
    .mul(box.x)
    .add(sin(time.mul(s.w.mul(1.7).add(0.6)).add(s.z.mul(40))).mul(0.35));
  const z = s.z.mul(box.z[1] - box.z[0]).add(box.z[0]);
  const size = s.w.mul(look.size[1] - look.size[0]).add(look.size[0]);
  material.positionNode = vec3(x, y, z).add(positionLocal.mul(size));
  // Soft round sprite that fades in low and out high, cooling as it goes.
  const r = uv().sub(0.5).length().mul(2);
  const life = smoothstep(0, 0.15, cycle).mul(float(1).sub(smoothstep(0.7, 1, cycle)));
  material.colorNode = mix(color(look.cool), color(look.hot), float(1).sub(cycle)).mul(2.2);
  material.opacityNode = float(1).sub(r).clamp(0, 1).pow(1.6).mul(life);
  const mesh = new T.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.renderOrder = 30;
  return mesh;
}

/** Io's sulphur plumes: tall additive fountains that bloom into an umbrella canopy. */
function plumes(terrain: Terrain, span: number, far: number) {
  const group = new T.Group();
  const material = new T.MeshBasicNodeMaterial({
    transparent: true,
    blending: T.AdditiveBlending,
    depthWrite: false,
    side: T.DoubleSide,
    toneMapped: false,
  });
  const p = uv();
  const column = float(1)
    .sub(p.x.sub(0.5).abs().mul(2).div(p.y.mul(0.9).add(0.12)))
    .clamp(0, 1);
  const canopy = float(1)
    .sub(vec2(p.x.sub(0.5).mul(1.1), p.y.sub(0.82).mul(3.2)).length().mul(1.6))
    .clamp(0, 1);
  const shimmer = sin(time.mul(0.7).add(p.y.mul(9)))
    .mul(0.12)
    .add(0.88);
  const shape = column
    .mul(float(1).sub(smoothstep(0.55, 0.85, p.y)))
    .max(canopy)
    .mul(shimmer);
  material.colorNode = mix(color('#ffe7a6'), color('#7fb8ff'), p.y.clamp(0, 1).pow(1.5)).mul(0.9);
  material.opacityNode = shape
    .pow(1.4)
    .mul(float(1).sub(smoothstep(0.92, 1, p.y)))
    .mul(0.5);
  const geometry = new T.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const rng = new Random(5117);
  // Three tiles of the scrolling strip, two eruptions a tile, so the wrap is seamless.
  for (let tile = -1; tile <= 1; tile++)
    for (const at of [0.23, 0.71]) {
      const x = (at + (rng.next() - 0.5) * 0.08) * span - span / 2 + tile * span;
      const z = far + 6 + rng.next() * 4;
      const plume = new T.Mesh(geometry, material);
      const height = 16 + rng.next() * 9;
      plume.scale.set(height * 0.75, height, 1);
      plume.position.set(x, terrain.height(x, z) - 0.5, z);
      group.add(plume);
    }
  return group;
}

/** Icicles along the vault, seated on its actual height field and tapering down. */
function icicles(vault: Terrain, span: number, near: number, far: number) {
  const rng = new Random(90431);
  const count = 900;
  const geometry = new T.ConeGeometry(1, 1, 7, 1).rotateX(Math.PI).translate(0, -0.5, 0);
  const material = new T.MeshStandardNodeMaterial({
    color: '#bfe4f7',
    roughness: 0.12,
    metalness: 0.05,
    transparent: true,
    opacity: 0.9,
  });
  // Light caught inside the ice, brightest at the tips.
  material.emissiveNode = color('#3aa0e0')
    .mul(positionLocal.y.negate().add(0.1).clamp(0, 1))
    .mul(0.8);
  const mesh = new T.InstancedMesh(geometry, material, count);
  const dummy = new T.Object3D();
  let n = 0;
  for (let i = 0; i < count; i++) {
    const x = (rng.next() - 0.5) * span * 3;
    const z = far + rng.next() * (near - far) * 0.85;
    const length = 0.25 + Math.pow(rng.next(), 2.2) * 1.5;
    const width = length * (0.09 + rng.next() * 0.06);
    dummy.position.set(x, vault.height(x, z) + 0.05, z);
    dummy.scale.set(width, length, width);
    dummy.rotation.set((rng.next() - 0.5) * 0.12, rng.next() * 6.28, (rng.next() - 0.5) * 0.12);
    dummy.updateMatrix();
    mesh.setMatrixAt(n++, dummy.matrix);
  }
  mesh.count = n;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Cold mist: low sheets of drifting haze that thin out as they climb.
 *
 * Every pow() in this file clamps its base first: uv overshoots [0, 1] by a
 * hair at a plane's edge, a negative base makes pow() NaN, and one NaN pixel
 * is smeared across the whole frame by the bloom pass - the screen goes black.
 */
function mist(base: number, near: number) {
  const group = new T.Group();
  const noise = new T.TextureLoader().load(asset('/textures/terrain/snow_01_height.jpg'));
  noise.wrapS = noise.wrapT = T.RepeatWrapping;
  for (const [depth, lift, speed] of [
    [near - 12, 0.4, 0.018],
    [near - 26, 0.9, 0.011],
  ]) {
    const material = new T.MeshBasicNodeMaterial({
      transparent: true,
      blending: T.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const p = uv();
    const flow = texture(noise, vec2(p.x.mul(3).add(time.mul(speed)), p.y.mul(0.8))).r;
    const band = float(1)
      .sub(p.y)
      .clamp(0, 1)
      .pow(2.2)
      .mul(smoothstep(0, 0.12, p.y));
    material.colorNode = color('#7cc4ec');
    material.opacityNode = flow.smoothstep(0.35, 0.75).mul(band).mul(0.16);
    const sheet = new T.Mesh(new T.PlaneGeometry(160, 5), material);
    sheet.position.set(0, base + 2.5 + lift, depth);
    sheet.renderOrder = 25;
    group.add(sheet);
  }
  return group;
}

export type SurfaceEffects = {
  /** Scrolls with the deck. */
  deck: T.Object3D[];
  /** Scrolls with the vault. */
  vault: T.Object3D[];
  /** Stays in place; moves on its own. */
  still: T.Object3D[];
};

export function surfaceEffects(
  kind: 'lava' | 'ice',
  deck: Terrain,
  vault: Terrain | null,
  cfg: {
    span: number;
    near: number;
    far: number;
    base: number;
    roofNear?: number;
    roofFar?: number;
  },
): SurfaceEffects {
  if (kind === 'lava')
    return {
      deck: [plumes(deck, cfg.span, cfg.far)],
      vault: [],
      still: [
        motes(
          260,
          { x: 44, y: [cfg.base - 1, cfg.base + 12], z: [-14, 6] },
          { hot: '#ffcf5a', cool: '#ff3a0a', size: [0.05, 0.16], rise: 1.6, drift: 3.5 },
          2203,
        ),
        motes(
          140,
          { x: 60, y: [cfg.base, cfg.base + 16], z: [-30, -12] },
          { hot: '#b39a86', cool: '#3d302a', size: [0.12, 0.35], rise: 0.7, drift: 2.2 },
          7741,
        ),
      ],
    };
  return {
    deck: [],
    vault: vault
      ? [icicles(vault, cfg.span, cfg.roofNear ?? cfg.near, cfg.roofFar ?? cfg.far)]
      : [],
    still: [
      motes(
        420,
        { x: 46, y: [cfg.base - 1, cfg.base + 15], z: [-12, 8] },
        { hot: '#ffffff', cool: '#9fd8ff', size: [0.03, 0.09], rise: -1.1, drift: 2.8 },
        3319,
      ),
      mist(cfg.base, cfg.near),
    ],
  };
}
