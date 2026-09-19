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
      const radius = strand < 0 ? width * scale * taper : (0.045 + width * 0.1) * scale;
      const cx = xs[i] + nx * offset,
        cy = ys[i] + ny * offset;
      for (let side = 0; side < 2; side++) {
        const k = i * 6 + side * 3,
          sign = side ? 1 : -1;
        this.positions[k] = cx + nx * radius * sign;
        this.positions[k + 1] = cy + ny * radius * sign;
        this.positions[k + 2] = z;
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
  private readonly layers = [
    new Ribbon('#6511c9', 0.22, true),
    new Ribbon('#8625f4', 0.4, true),
    new Ribbon('#8822e8', 0.94),
    new Ribbon('#c976ff', 0.88),
    new Ribbon('#e4baff', 0.9, true),
    new Ribbon('#ffffff', 0.98, false, true),
    new Ribbon('#ffffff', 0.98, false, true),
  ];
  constructor() {
    for (const layer of this.layers) this.root.add(layer.mesh);
    this.root.visible = false;
  }
  update(xs: Float32Array, ys: Float32Array, width: number, time: number, active: boolean) {
    this.root.visible = active;
    if (!active) return;
    const scales = [1.9, 1.4, 1, 0.48, 0.15, 1, 1];
    this.layers.forEach((layer, i) => {
      layer.update(xs, ys, width, time, scales[i], 0.2 + i * 0.012, i < 5 ? -1 : i - 5);
    });
  }
}
