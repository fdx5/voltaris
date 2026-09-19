import * as T from 'three/webgpu';
import { WHIP_SEGMENTS } from '../game/SpecialWeapons';

/** Shared-vertex ribbons eliminate the corners and seams of overlapping quads.
 * Buffers are allocated once, then rewritten without allocations per frame.
 */
class Ribbon {
  readonly mesh: T.Mesh<T.BufferGeometry, T.MeshBasicNodeMaterial>;
  private readonly positions = new Float32Array((WHIP_SEGMENTS + 1) * 6);
  private readonly colors = new Float32Array((WHIP_SEGMENTS + 1) * 6);
  constructor(color: string, opacity: number, additive = false, electric = false) {
    const geometry = new T.BufferGeometry();
    const indices: number[] = [];
    for (let i = 0; i < WHIP_SEGMENTS; i++) {
      const n = i * 2;
      indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
    }
    geometry.setIndex(indices);
    geometry.setAttribute(
      'position',
      new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage),
    );
    if (electric)
      geometry.setAttribute(
        'color',
        new T.BufferAttribute(this.colors, 3).setUsage(T.DynamicDrawUsage),
      );
    const material = new T.MeshBasicNodeMaterial({
      color,
      opacity,
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
      toneMapped: false,
      vertexColors: electric,
      blending: additive ? T.AdditiveBlending : T.NormalBlending,
    });
    this.mesh = new T.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
  }
  update(
    xs: Float32Array,
    ys: Float32Array,
    width: number,
    time: number,
    scale: number,
    z: number,
    strand = -1,
  ) {
    for (let i = 0; i <= WHIP_SEGMENTS; i++) {
      const prev = Math.max(0, i - 1),
        next = Math.min(WHIP_SEGMENTS, i + 1);
      const dx = xs[next] - xs[prev],
        dy = ys[next] - ys[prev];
      const length = Math.hypot(dx, dy) || 1,
        nx = -dy / length,
        ny = dx / length;
      const t = i / WHIP_SEGMENTS;
      const taper = 0.55 + 0.45 * Math.min(1, t * 18);
      const phase = t * Math.PI * 2 * 9 - time * 19 + strand * Math.PI;
      const wrap = strand < 0 ? 0 : Math.sin(phase);
      const crackle = strand < 0 ? 0 : Math.sin(t * 247 + time * 47) * 0.09;
      const offset = (wrap * 1.17 + crackle) * width * taper;
      const radius = strand < 0 ? width * scale * taper : (0.045 + width * 0.1) * scale * 0.5;
      const cx = xs[i] + nx * offset,
        cy = ys[i] + ny * offset;
      for (let side = 0; side < 2; side++) {
        const k = i * 6 + side * 3,
          sign = side ? 1 : -1;
        this.positions[k] = cx + nx * radius * sign;
        this.positions[k + 1] = cy + ny * radius * sign;
        this.positions[k + 2] = strand < 0 ? z : 0.22 + Math.cos(phase) * width * 0.7;
        // The helix dims behind the column, then flashes lemon-yellow as it
        // crosses the front: an unmistakable wrap instead of a dotted border.
        const front = (Math.cos(phase) + 1) * 0.5;
        this.colors[k] = 0.65 + front * 0.95;
        this.colors[k + 1] = 0.32 + front * 1.0;
        this.colors[k + 2] = 0.015 + front * 0.1;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    if (this.mesh.geometry.attributes.color) this.mesh.geometry.attributes.color.needsUpdate = true;
  }
}
export class PlasmaWhip {
  readonly root = new T.Group();
  private readonly tubePositions = new Float32Array((WHIP_SEGMENTS + 1) * 11 * 3);
  private readonly tube = new T.Mesh(
    new T.BufferGeometry(),
    new T.MeshStandardNodeMaterial({
      color: '#a243ee',
      metalness: 0.35,
      roughness: 0.24,
      emissive: '#6517b5',
      emissiveIntensity: 0.65,
    }),
  );
  private readonly sparks = new T.InstancedMesh(
    new T.PlaneGeometry(1, 1),
    new T.MeshBasicNodeMaterial({
      color: '#ffffff',
      toneMapped: false,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: T.DoubleSide,
    }),
    48,
  );
  private readonly sparkTransform = new T.Object3D();
  private readonly sparkColor = new T.Color();
  private readonly layers = [
    new Ribbon('#6511c9', 0.035, true),
    new Ribbon('#8625f4', 0.09, true),
    new Ribbon('#8822e8', 0.94),
    new Ribbon('#c976ff', 0.88),
    new Ribbon('#e4baff', 0.9, true),
    new Ribbon('#ffffff', 0.98, false, true),
    new Ribbon('#ffffff', 0.98, false, true),
  ];
  constructor() {
    for (const layer of this.layers) this.root.add(layer.mesh);
    this.sparks.count = 0;
    this.sparks.setColorAt(0, this.sparkColor);
    this.sparks.frustumCulled = false;
    this.sparks.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.root.add(this.sparks);
    const indices: number[] = [];
    for (let i = 0; i < WHIP_SEGMENTS; i++)
      for (let j = 0; j < 10; j++) {
        const k = i * 11 + j;
        indices.push(k, k + 1, k + 11, k + 1, k + 12, k + 11);
      }
    this.tube.geometry.setIndex(indices);
    this.tube.geometry.setAttribute(
      'position',
      new T.BufferAttribute(this.tubePositions, 3).setUsage(T.DynamicDrawUsage),
    );
    this.tube.frustumCulled = false;
    this.root.add(this.tube);
    this.root.visible = false;
  }
  update(xs: Float32Array, ys: Float32Array, width: number, time: number, active: boolean) {
    this.root.visible = active;
    if (!active) return;
    for (let i = 0; i <= WHIP_SEGMENTS; i++) {
      const prev = Math.max(0, i - 1),
        next = Math.min(WHIP_SEGMENTS, i + 1);
      const dx = xs[next] - xs[prev],
        dy = ys[next] - ys[prev];
      const length = Math.hypot(dx, dy) || 1;
      const radius = width * (0.55 + 0.45 * Math.min(1, (i / WHIP_SEGMENTS) * 18));
      for (let j = 0; j <= 10; j++) {
        const angle = (j / 10) * Math.PI * 2;
        const k = (i * 11 + j) * 3;
        this.tubePositions[k] = xs[i] - (dy / length) * Math.cos(angle) * radius;
        this.tubePositions[k + 1] = ys[i] + (dx / length) * Math.cos(angle) * radius;
        this.tubePositions[k + 2] = 0.22 + Math.sin(angle) * radius * 0.55;
      }
    }
    this.tube.geometry.attributes.position.needsUpdate = true;
    this.tube.geometry.computeVertexNormals();
    const scales = [1.9, 1.4, 1, 0.48, 0.15, 1, 1];
    this.updateSparks(xs, ys, width, time);
    this.layers.forEach((layer, i) => {
      layer.update(xs, ys, width, time, scales[i], 0.2 + i * 0.012, i < 5 ? -1 : i - 5);
    });
  }
  /** Short, sparse discharges travel out from the column and expire quickly. */
  private updateSparks(xs: Float32Array, ys: Float32Array, width: number, time: number) {
    this.sparks.count = 0;
    for (let i = 0; i < 16; i++) {
      const clock = time * 7 + i * 0.618034;
      const age = clock - Math.floor(clock);
      if (age > 0.42) continue;
      const seed = i * 0.618034 + Math.floor(clock) * 0.137;
      const n = 8 + Math.floor((seed - Math.floor(seed)) * (WHIP_SEGMENTS - 16));
      const dx = xs[n + 1] - xs[n - 1],
        dy = ys[n + 1] - ys[n - 1];
      const length = Math.hypot(dx, dy) || 1;
      const tx = dx / length,
        ty = dy / length,
        side = i % 2 ? 1 : -1;
      const nx = -ty * side,
        ny = tx * side;
      const reach = (0.3 + width * 0.65) * (0.5 + age * 1.8);
      let ax = xs[n] + nx * width * 1.1,
        ay = ys[n] + ny * width * 1.1;
      for (let step = 1; step <= 3; step++) {
        const outward = width * 1.1 + (reach * step) / 3;
        const kink = (step === 1 ? 0.1 : step === 2 ? -0.08 : 0.05) * side;
        const bx = xs[n] + nx * outward + tx * kink;
        const by = ys[n] + ny * outward + ty * kink;
        const slot = this.sparks.count++;
        this.sparkTransform.position.set((ax + bx) / 2, (ay + by) / 2, 0.31);
        this.sparkTransform.rotation.z = Math.atan2(by - ay, bx - ax);
        this.sparkTransform.scale.set(
          Math.hypot(bx - ax, by - ay) + 0.006,
          (0.012 + width * 0.009) * (1 - age),
          1,
        );
        this.sparkTransform.updateMatrix();
        this.sparks.setMatrixAt(slot, this.sparkTransform.matrix);
        this.sparkColor.setRGB(1.4, 1.05, 0.16).multiplyScalar(1 - age / 0.48);
        this.sparks.setColorAt(slot, this.sparkColor);
        ax = bx;
        ay = by;
      }
    }
    this.sparks.instanceMatrix.needsUpdate = true;
    if (this.sparks.instanceColor) this.sparks.instanceColor.needsUpdate = true;
  }
}
