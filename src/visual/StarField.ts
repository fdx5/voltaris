import * as T from 'three/webgpu';
import { attribute, exp, float, max, sin, uniform, uv, vec3 } from 'three/tsl';
import { Random } from '../core/math/Random';

/**
 * A black sky carried by thousands of individually twinkling stars.
 *
 * Each star is one camera-facing quad in an instanced batch. Its brightness,
 * colour, twinkle rate, phase and depth ride in per-instance attributes, and
 * the fragment shader draws a Gaussian core with a faint halo; the brightest
 * few also carry four-point diffraction glints. Twinkle is two incommensurate
 * sines, so no star pulses on a visible beat and no two fall into step.
 */
export type StarPalette = {
  /** Spectral tints with a relative weight each. */
  tints: [string, number][];
  /** Overall multiplier on the star count. */
  density: number;
  /** 0 - steady, 1 - strong scintillation. */
  twinkle: number;
};

type Layer = {
  count: number;
  span: number;
  height: number;
  near: number;
  far: number;
  /** Quad size range in world units; the visible core is about a third. */
  size: [number, number];
  bright: [number, number];
  speed: number;
  glints: number;
};

// Heights cover the view tilting with the ship's altitude, not just a level frame.
const LAYERS: Layer[] = [
  // Sparse near-field dust supplies scale cues without obscuring hostile fire.
  {
    count: 90,
    span: 100,
    height: 65,
    near: -14,
    far: -28,
    size: [0.06, 0.19],
    bright: [0.12, 0.35],
    speed: 8.5,
    glints: 0,
  },
  // Deep field: a dust of pinpricks, barely drifting.
  {
    count: 4900,
    span: 320,
    height: 200,
    near: -120,
    far: -155,
    size: [0.32, 0.8],
    bright: [0.3, 1.0],
    speed: 0.22,
    glints: 0,
  },
  // Middle distance: most of the recognisable stars.
  {
    count: 2000,
    span: 250,
    height: 160,
    near: -80,
    far: -110,
    size: [0.3, 1.05],
    bright: [0.35, 1.2],
    speed: 1.1,
    glints: 0.03,
  },
  // Foreground: few, bright, and quick enough to sell the parallax.
  {
    count: 330,
    span: 200,
    height: 115,
    near: -48,
    far: -66,
    size: [0.28, 0.95],
    bright: [0.55, 1.6],
    speed: 4.2,
    glints: 0.12,
  },
];

export function buildStarField(seed: number, palette: StarPalette) {
  const rng = new Random(seed);
  const clock = uniform(0);
  const group = new T.Group();
  group.name = 'star field';
  const layers: { object: T.Object3D; speed: number; span: number }[] = [];
  const weights = palette.tints.reduce((sum, [, w]) => sum + w, 0);
  const tint = new T.Color();
  const pickTint = () => {
    let roll = rng.next() * weights;
    for (const [hex, w] of palette.tints) {
      roll -= w;
      if (roll <= 0) return tint.set(hex);
    }
    return tint.set(palette.tints[0][0]);
  };

  for (const layer of LAYERS) {
    const count = Math.round(layer.count * palette.density);
    // Two tiles side by side; the group wraps by one span.
    const total = count * 2;
    const geometry = new T.PlaneGeometry(1, 1);
    const colours = new Float32Array(total * 3);
    const twinkle = new Float32Array(total * 4);
    const glints = new Float32Array(total);
    // Additive but drawn in the opaque pass, early: a planet or moon rendered
    // afterwards covers the stars behind it instead of wearing them as freckles.
    const material = new T.MeshBasicNodeMaterial({
      transparent: false,
      blending: T.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const p = uv().sub(0.5).mul(2);
    const r2 = p.dot(p);
    const glint = attribute<'float'>('starGlint', 'float');
    // A glinting star's quad is larger to carry its spikes; its core is not.
    const core = exp(r2.mul(glint.mul(150).add(26)).negate());
    const halo = exp(r2.mul(glint.mul(26).add(5)).negate()).mul(0.22);
    const spike = exp(p.x.abs().mul(-38))
      .mul(exp(p.y.abs().mul(-3.2)))
      .add(exp(p.y.abs().mul(-38)).mul(exp(p.x.abs().mul(-3.2))))
      .mul(glint)
      .mul(0.55);
    const shape = core.add(halo).add(spike).mul(float(1).sub(r2).max(0));
    const motion = attribute<'vec4'>('starTwinkle', 'vec4');
    // x: phase, y: rate, z: depth, w: second-rate ratio.
    const wave = sin(clock.mul(motion.y).add(motion.x))
      .mul(0.6)
      .add(sin(clock.mul(motion.y.mul(motion.w)).add(motion.x.mul(2.3))).mul(0.4));
    const pulse = float(1)
      .sub(motion.z)
      .add(motion.z.mul(wave.mul(0.5).add(0.5)));
    const starColour = attribute<'vec3'>('starColour', 'vec3');
    // A hint of white in the core keeps coloured stars from reading as paint.
    const lit = starColour.mul(shape).add(vec3(shape.mul(core).mul(0.25)));
    material.colorNode = lit.mul(pulse.mul(pulse));
    material.opacityNode = max(shape, float(0)).mul(pulse).clamp(0, 1);

    const mesh = new T.InstancedMesh(geometry, material, total);
    const dummy = new T.Object3D();
    for (let i = 0; i < count; i++) {
      const x = (rng.next() - 0.5) * layer.span;
      const y = (rng.next() - 0.5) * layer.height;
      const z = layer.near - rng.next() * (layer.near - layer.far);
      // Cubed roll: a sky of faint stars with a rare bright one.
      const roll = rng.next() ** 3;
      const size = layer.size[0] + (layer.size[1] - layer.size[0]) * roll;
      const bright =
        layer.bright[0] + (layer.bright[1] - layer.bright[0]) * (roll * 0.7 + rng.next() * 0.3);
      pickTint().multiplyScalar(bright);
      const hasGlint = rng.next() < layer.glints * (0.4 + roll * 2) ? 1 : 0;
      const phase = rng.next() * Math.PI * 2,
        rate = 0.6 + rng.next() * 2.6,
        depth = (0.18 + rng.next() * 0.5) * palette.twinkle,
        ratio = 1.37 + rng.next() * 0.9;
      for (let tile = 0; tile < 2; tile++) {
        const k = i + tile * count;
        dummy.position.set(x + tile * layer.span, y, z);
        dummy.scale.setScalar(size * (hasGlint ? 2.6 : 1));
        dummy.updateMatrix();
        mesh.setMatrixAt(k, dummy.matrix);
        tint.toArray(colours, k * 3);
        twinkle.set([phase, rate, depth, ratio], k * 4);
        glints[k] = hasGlint;
      }
    }
    geometry.setAttribute('starColour', new T.InstancedBufferAttribute(colours, 3));
    geometry.setAttribute('starTwinkle', new T.InstancedBufferAttribute(twinkle, 4));
    geometry.setAttribute('starGlint', new T.InstancedBufferAttribute(glints, 1));
    mesh.frustumCulled = false;
    mesh.renderOrder = -80;
    group.add(mesh);
    layers.push({ object: mesh, speed: layer.speed, span: layer.span });
  }
  return {
    group,
    layers,
    update(t: number) {
      clock.value = t;
    },
  };
}
