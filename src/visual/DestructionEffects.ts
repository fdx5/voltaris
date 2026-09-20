import * as T from 'three/webgpu';
import { float, positionGeometry } from 'three/tsl';
import type { ObjectPool } from '../core/pool/ObjectPool';

/** Bounded, deterministic visual simulation; never consumes gameplay randomness. */
export class DestructionEffects {
  readonly root = new T.Group();
  private readonly transform = new T.Object3D();
  private readonly color = new T.Color();
  private readonly fire: T.InstancedMesh;
  private readonly smoke: T.InstancedMesh;
  private readonly shards: T.InstancedMesh;
  private readonly streaks: T.InstancedMesh;
  private readonly pressure: T.InstancedMesh;
  private readonly plates: T.InstancedMesh;
  constructor() {
    const pressureMaterial = new T.MeshBasicNodeMaterial({
      color: '#ffffff',
      transparent: true,
      blending: T.AdditiveBlending,
      depthWrite: false,
      side: T.DoubleSide,
      toneMapped: false,
    });
    pressureMaterial.opacityNode = float(1)
      .sub(positionGeometry.length().sub(0.9825).abs().div(0.0175))
      .max(0)
      .pow(1.3)
      .mul(0.42);
    this.pressure = this.batch(
      new T.RingGeometry(0.965, 1, 32, 1, 0, Math.PI * 0.38),
      pressureMaterial,
      256,
    );
    this.plates = this.batch(
      new T.BoxGeometry(1, 1, 0.15),
      new T.MeshStandardNodeMaterial({ color: '#a1adba', metalness: 0.85, roughness: 0.3 }),
      384,
    );
    const geometry = new T.PlaneGeometry(2, 2);
    this.fire = this.batch(
      geometry,
      new T.MeshBasicNodeMaterial({
        map: cloudTexture(true),
        color: new T.Color(2.2, 1.8, 1.4),
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
      1000,
    );
    this.smoke = this.batch(
      geometry,
      new T.MeshBasicNodeMaterial({
        map: cloudTexture(false),
        color: '#7b7474',
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
      }),
      700,
    );
    this.shards = this.batch(
      new T.TetrahedronGeometry(1),
      new T.MeshStandardNodeMaterial({
        color: '#71818f',
        metalness: 0.8,
        roughness: 0.32,
      }),
      1000,
    );
    this.streaks = this.batch(
      new T.ConeGeometry(1, 1, 5).rotateZ(-Math.PI / 2),
      new T.MeshBasicNodeMaterial({
        color: '#ffffff',
        transparent: true,
        blending: T.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      1600,
    );
  }
  disposeTextures() {
    (this.fire.material as T.MeshBasicNodeMaterial).map?.dispose();
    (this.smoke.material as T.MeshBasicNodeMaterial).map?.dispose();
  }
  private batch(geometry: T.BufferGeometry, material: T.Material, capacity: number) {
    const mesh = new T.InstancedMesh(geometry, material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    mesh.setColorAt(0, this.color);
    this.root.add(mesh);
    return mesh;
  }
  private put(
    mesh: T.InstancedMesh,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    angle: number,
    tint: string,
    fade = 1,
    roll = 0,
  ) {
    if (mesh.count >= mesh.instanceMatrix.count || sx <= 0 || fade <= 0) return;
    this.transform.position.set(x, y, z);
    this.transform.scale.set(sx, sy, sz);
    this.transform.rotation.set(roll, roll * 0.7, angle);
    this.transform.updateMatrix();
    mesh.setMatrixAt(mesh.count, this.transform.matrix);
    mesh.setColorAt(mesh.count++, this.color.set(tint).multiplyScalar(fade));
  }
  update(events: ObjectPool, time: number, low: boolean, reducedMotion: boolean) {
    void time;
    const batches = [this.fire, this.smoke, this.shards, this.streaks, this.pressure, this.plates];
    for (const batch of batches) batch.count = 0;
    for (let i = 0; i < events.limit; i++) {
      if (!events.active[i]) continue;
      const age = events.age[i],
        size = events.radius[i],
        x = events.x[i],
        y = events.y[i];
      if (events.type[i] === 4) {
        const collapse = Math.max(0, 1 - age / 1.15);
        for (let j = 0; j < (low ? 18 : 48); j++) {
          const a = j * 2.399963 + age * 2;
          const r = size * collapse * (0.3 + (j % 7) * 0.13);
          this.put(
            this.streaks,
            x + Math.cos(a) * r,
            y + Math.sin(a) * r,
            2,
            0.18 + age * 0.3,
            0.015,
            0.015,
            a,
            '#8dccff',
            1.4,
          );
        }
        continue;
      }
      if (events.type[i] === 2 || events.type[i] === 3) {
        for (let j = 0; j < 8; j++) {
          const a = (j * Math.PI) / 4 + 0.2;
          const fade = Math.exp(-age * 3);
          this.put(
            this.streaks,
            x + Math.cos(a) * age * 9,
            y + Math.sin(a) * age * 9,
            1.5,
            size * 2.5 * fade,
            size * 0.055 * fade,
            0.06,
            a,
            events.type[i] === 2 ? '#b8e8ff' : '#fff0ba',
            fade * 2,
          );
        }
      }
      const tier = events.type[i];
      const capital = tier === 1 || tier === 2;
      const variant = Math.floor(events.aux[i]) % 3;
      const axis = variant === 0 ? 0.18 : variant === 1 ? -0.55 : 0.8;
      const fireLife = tier === 2 ? 1.9 : tier === 1 ? 1.55 : tier === 5 ? 0.65 : 1.05;
      const smokeLife = tier === 2 ? 4.3 : tier === 1 ? 3.7 : tier === 5 ? 1.45 : 2.6;
      // Broken, tilted pressure fronts show a shell expanding through depth.
      const waves = tier === 2 ? 3 : tier === 1 || tier === 3 ? 2 : tier === 5 ? 0 : 1;
      for (let wave = 0; wave < waves; wave++) {
        const u = age - wave * (tier === 2 ? 0.11 : 0.24);
        if (u < 0 || u > 1.1) continue;
        const radius = size * (0.25 + u * (tier === 2 ? 5 : 3.4));
        for (let arc = 0; arc < 4; arc++) {
          this.put(
            this.pressure,
            x,
            y,
            1.1 + wave * 0.18,
            radius,
            radius,
            radius,
            (arc * Math.PI) / 2 + axis + u * 0.25,
            tier === 2 ? '#90d9ff' : '#ffb459',
            (1 - u / 1.1) ** 2,
            0.35 + wave * 0.38,
          );
        }
      }
      // Recognisable pieces of armour travel farther and tumble more slowly than sparks.
      if (capital || tier === 3)
        for (let j = 0; j < (low ? 6 : tier === 2 ? 22 : 12); j++) {
          const u = age - (j % 3) * 0.1;
          if (u < 0) continue;
          const a = j * 2.399963 + axis;
          const fade = Math.max(0, 1 - u / smokeLife);
          const reach = size * (0.8 + (j % 4) * 0.23) * u;
          const plate = size * (0.12 + (j % 3) * 0.025) * fade;
          this.put(
            this.plates,
            x + Math.cos(a) * reach,
            y + Math.sin(a) * reach - u * u * 0.38,
            1 + Math.sin(a) * u * 0.8,
            plate * 2,
            plate,
            plate,
            a + u * 1.4,
            u < 0.28 ? '#ffcb7c' : '#8494a0',
            1,
            a + u * 1.9,
          );
        }
      const fullCount = tier === 2 ? 68 : tier === 1 ? 44 : tier === 5 ? 10 : 28;
      const count = low ? Math.ceil(fullCount * 0.5) : fullCount;
      for (let j = 0; j < count; j++) {
        const a = j * 2.399963 + variant * 1.7 + i * 0.73;
        const group = j % (tier === 2 ? 4 : 3);
        const u = age - (capital ? group * 0.19 : (j % 5) * 0.045);
        if (u < 0) continue;
        const speed = (1.5 + (j % 7) * 0.47) * size;
        const reach = speed * (1 - Math.exp(-u * 2)) * 0.65;
        const dx = Math.cos(a),
          dy = Math.sin(a);
        const rupture = capital ? (group - (tier === 2 ? 1.5 : 1)) * size * 0.6 : 0;
        const jet = variant === 1 ? 1.35 : variant === 2 ? 0.75 : 1;
        const px = x + Math.cos(axis) * rupture + dx * reach * jet,
          py = y + Math.sin(axis) * rupture + dy * reach * (variant === 2 ? 1.1 : 0.65);
        const z = 0.8 + Math.sin(a * 3) * size * 0.35;
        const hot = Math.max(0, 1 - u / fireLife);
        const radius = size * (0.3 + (j % 4) * 0.085 + u * 0.8) * hot;
        this.put(
          this.fire,
          px,
          py,
          z,
          radius,
          radius * 0.8,
          radius,
          a + u,
          u < 0.3 ? '#fff6d5' : u < 0.65 ? '#ffca91' : '#d96631',
          hot,
        );
        const smoke = Math.sin(Math.min(1, u / smokeLife) * Math.PI);
        const puff = size * (0.2 + u * (capital ? 0.55 : 0.44)) * smoke;
        this.put(
          this.smoke,
          px - u * 0.3,
          py + u * size * 0.6,
          z - 0.6,
          puff,
          puff * 0.85,
          puff,
          a + u * 0.2,
          '#b5a29b',
          0.65 + hot * 0.35,
        );
        const travel = speed * u * 1.6;
        const fade = Math.max(0, 1 - u / smokeLife);
        const shard = size * (0.035 + (j % 3) * 0.025) * fade;
        this.put(
          this.shards,
          x + dx * travel,
          y + dy * travel - u * u * 0.7,
          z,
          shard * 2.7,
          shard,
          shard * 0.6,
          a + u * 5,
          '#c2a998',
          1,
          u * 4 + a,
        );
        // Fast tapered ejecta, followed by a curved shower of cooling embers.
        for (let k = 0; k < (low ? 1 : 3); k++) {
          const tail = u - k * 0.025;
          if (tail < 0) continue;
          const d = speed * tail * 2.7;
          const light = Math.max(0, 1 - u / 1.4) * (1 - k * 0.24);
          this.put(
            this.streaks,
            x + dx * d,
            y + dy * d - tail * tail * 0.5,
            z + 0.3,
            size * (reducedMotion ? 0.12 : 0.35) * light,
            size * 0.022 * light,
            size * 0.022 * light,
            a,
            u < 0.2 ? '#fff5cf' : '#ff721b',
            light * 2,
          );
        }
      }
    }
    for (const batch of batches) {
      batch.visible = batch.count > 0;
      batch.instanceMatrix.clearUpdateRanges();
      batch.instanceMatrix.addUpdateRange(0, batch.count * 16);
      batch.instanceMatrix.needsUpdate = true;
      if (batch.instanceColor) {
        batch.instanceColor.clearUpdateRanges();
        batch.instanceColor.addUpdateRange(0, batch.count * 3);
        batch.instanceColor.needsUpdate = true;
      }
    }
  }
}

/** Fractal density slices: soft turbulent edges and self-shaded cloud folds.
 * Generated once, without DOM, external textures or gameplay RNG.
 */
function cloudTexture(fire: boolean) {
  const size = 128,
    data = new Uint8Array(size * size * 4);
  const hash = (x: number, y: number) => {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const noise = (x: number, y: number) => {
    const ix = Math.floor(x),
      iy = Math.floor(y);
    let u = x - ix,
      v = y - iy;
    u = u * u * (3 - 2 * u);
    v = v * v * (3 - 2 * v);
    return T.MathUtils.lerp(
      T.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), u),
      T.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), u),
      v,
    );
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const px = ((x + 0.5) / size) * 2 - 1,
        py = ((y + 0.5) / size) * 2 - 1;
      const n =
        noise(px * 3 + 4, py * 3 + 7) * 0.55 +
        noise(px * 7 + 1, py * 7 + 9) * 0.28 +
        noise(px * 16 + 3, py * 16 + 5) * 0.12 +
        noise(px * 33, py * 33) * 0.05;
      const density = Math.max(0, 1 - Math.hypot(px, py) + (n - 0.5) * 0.7);
      const alpha = T.MathUtils.smoothstep(density, 0.03, 0.42);
      const heat = T.MathUtils.clamp(n * 1.25 + density * 0.2, 0, 1);
      const k = (y * size + x) * 4;
      data[k] = fire ? 190 + heat * 65 : 55 + heat * 120;
      data[k + 1] = fire ? 25 + heat ** 2 * 225 : 59 + heat * 112;
      data[k + 2] = fire ? 5 + heat ** 5 * 220 : 68 + heat * 108;
      data[k + 3] = alpha * 255;
    }
  const texture = new T.DataTexture(data, size, size);
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
