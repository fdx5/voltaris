import * as T from 'three/webgpu';
import { float, uv, sin, uniform } from 'three/tsl';
import { depthGeometry, depthStation, type SceneryModel } from './DepthAssets';
import type { Terrain } from '../core/math/Terrain';
import { Random } from '../core/math/Random';
import type { Quality } from '../core/renderer/IRenderBackend';

export const SECTOR_LIGHT = [
  { key: '#fff1d9', fill: '#629adb', haze: '#14273b', metal: '#536c82' },
  { key: '#ffcf9f', fill: '#758bb7', haze: '#382321', metal: '#80634f' },
  { key: '#ffd8a9', fill: '#9370b8', haze: '#302432', metal: '#65505b' },
  { key: '#e3faff', fill: '#529dbf', haze: '#173b49', metal: '#638f9f' },
  { key: '#eadcff', fill: '#796cb9', haze: '#231d3c', metal: '#686386' },
] as const;

/** All geometry is decorative; projected foreground bounds keep the combat corridor clear. */
export class DepthScenery {
  readonly root = new T.Group();
  private readonly station = depthStation();
  private readonly pose = new T.Object3D();
  private readonly tint = new T.Color();
  private readonly seeds = new Float32Array(64 * 4);
  private readonly landmarks = new Map<SceneryModel, T.InstancedMesh>();
  private readonly debris: T.InstancedMesh;
  private readonly foreground: T.InstancedMesh;
  private readonly mist: T.Mesh[] = [];
  private readonly clock = uniform(0);
  private stage = -1;
  private readonly materials: T.MeshStandardNodeMaterial[] = [];
  constructor() {
    this.root.name = 'sector depth scenery';
    this.root.add(this.station);
    const rng = new Random(518173);
    for (let i = 0; i < this.seeds.length; i++) this.seeds[i] = rng.next();
    for (const name of [
      'satelliteDish_detailed',
      'satelliteDish_large',
      'gate_complex',
      'hangar_roundA',
      'structure_detailed',
      'rock_crystalsLargeA',
      'machine_generatorLarge',
    ] as SceneryModel[]) {
      this.landmarks.set(name, this.batch(depthGeometry(name), 5, 0.45));
    }
    this.debris = this.batch(depthGeometry('meteor_detailed'), 40, 0.25);
    this.foreground = this.batch(depthGeometry('rock_largeA'), 8, 0.3);
    for (let i = 0; i < 3; i++) {
      const material = new T.MeshBasicNodeMaterial({
        transparent: true,
        blending: T.AdditiveBlending,
        depthWrite: false,
        fog: false,
        toneMapped: false,
        side: T.DoubleSide,
      });
      const p = uv();
      const across = float(1).sub(p.x.sub(0.5).abs().mul(2)).max(0).pow(3);
      const ends = sin(p.y.mul(Math.PI)).max(0).pow(1.5);
      const striation = sin(p.x.mul(36).add(p.y.mul(3)).add(this.clock.mul(0.12)))
        .mul(0.22)
        .add(0.78);
      material.opacityNode = across.mul(ends).mul(striation).mul(0.055);
      const sheet = new T.Mesh(new T.PlaneGeometry(1, 1), material);
      sheet.rotation.z = -0.35;
      this.root.add(sheet);
      this.mist.push(sheet);
    }
  }
  private batch(geometry: T.BufferGeometry, count: number, metalness: number) {
    const material = new T.MeshStandardNodeMaterial({
      color: '#aab8c9',
      vertexColors: true,
      metalness,
      roughness: 0.56,
    });
    this.materials.push(material);
    const mesh = new T.InstancedMesh(geometry, material, count);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    mesh.setColorAt(0, this.tint);
    this.root.add(mesh);
    return mesh;
  }
  private put(
    mesh: T.InstancedMesh,
    x: number,
    y: number,
    z: number,
    size: number,
    stretch: number,
    angle: number,
    brightness: number,
  ) {
    this.pose.position.set(x, y, z);
    this.pose.scale.set(size, size * stretch, size);
    this.pose.rotation.set(angle * 0.37, angle, angle * 0.21);
    this.pose.updateMatrix();
    mesh.setMatrixAt(mesh.count, this.pose.matrix);
    mesh.setColorAt(mesh.count++, this.tint.setScalar(brightness));
  }
  update(
    time: number,
    stage: number,
    halfWidth: number,
    halfHeight: number,
    cameraZ: number,
    cameraY: number,
    lookX: number,
    lookY: number,
    quality: Quality,
    reducedMotion: boolean,
    active: boolean,
    terrain?: Terrain,
    scroll = 0,
  ) {
    const palette = SECTOR_LIGHT[stage];
    if (stage !== this.stage) {
      this.stage = stage;
      for (const material of this.materials)
        material.color.set(palette.metal).lerp(this.tint.set('#ffffff'), 0.58);
      for (const sheet of this.mist)
        (sheet.material as T.MeshBasicNodeMaterial).color.set(palette.fill);
    }
    const t = time * (active ? (reducedMotion ? 0.35 : 1) : 0.2);
    this.clock.value = t;
    const batches = [...this.landmarks.values(), this.debris, this.foreground];
    for (const mesh of batches) mesh.count = 0;
    const surface = stage === 2 || stage === 3;
    const themes: SceneryModel[][] = [
      ['satelliteDish_detailed', 'hangar_roundA', 'structure_detailed'],
      ['gate_complex', 'satelliteDish_large', 'machine_generatorLarge'],
      ['structure_detailed', 'machine_generatorLarge', 'gate_complex'],
      ['rock_crystalsLargeA', 'rock_crystalsLargeA', 'structure_detailed'],
      ['gate_complex', 'satelliteDish_detailed', 'structure_detailed'],
    ];
    // Authored NASA model keeps its original textured panels, trusses and modules.
    this.station.visible = !surface;
    const stationDepth = -17;
    const stationPerspective = (cameraZ - stationDepth) / cameraZ;
    const stationSize = quality === 'LOW' ? 5.5 : 6.8;
    const stationSpan = halfWidth * 2 * stationPerspective + stationSize * 3;
    this.station.position.set(
      wrap(halfWidth * 0.45 * stationPerspective - t * 1.1, stationSpan) - lookX,
      cameraY + halfHeight * 0.58 * stationPerspective - lookY,
      stationDepth,
    );
    this.station.scale.setScalar(stationSize);
    this.station.rotation.set(0.45, -0.35 + (reducedMotion ? 0 : t * 0.004), -0.25);
    const count = quality === 'LOW' ? 2 : 4;
    for (let i = 0; i < count; i++) {
      const landmark = this.landmarks.get(themes[stage][i % 3])!;
      const s = i * 4,
        depth = surface ? -35 - i * 12 : -55 - i * 18;
      const perspective = (cameraZ - depth) / cameraZ;
      const span = (halfWidth * 2 + 18) * perspective;
      const speed = 0.8 + (count - i) * 0.5;
      const x = wrap(this.seeds[s] * span - t * speed, span) - lookX * 0.8;
      const sign = surface ? -1 : i % 2 ? 1 : -1;
      const baseline =
        cameraY + sign * halfHeight * (surface ? 1.1 : 0.72) * perspective - lookY * 0.6;
      const size = surface ? 2.2 + this.seeds[s + 1] * 1.2 : 3 + this.seeds[s + 1] * 2;
      const y = surface && terrain ? terrain.height(x + scroll, depth) + size * 0.75 : baseline;
      this.put(
        landmark,
        x,
        y,
        depth,
        size,
        1,
        surface ? 0 : 0.25 + i * 0.4 + t * 0.007,
        0.17 + (count - i) * 0.035,
      );
    }
    // Small dim fragments are clearly behind the combat plane; sunlight turns across their faces.
    const debrisCount = quality === 'LOW' ? 10 : quality === 'MEDIUM' ? 20 : 32;
    for (let i = 0; i < debrisCount; i++) {
      const s = i * 4,
        depth = -12 - this.seeds[s + 2] * 35;
      const perspective = (cameraZ - depth) / cameraZ;
      const span = (halfWidth * 2 + 12) * perspective;
      const x = wrap(this.seeds[s] * span - t * (2 + this.seeds[s + 2] * 2), span) - lookX * 1.4;
      const y = cameraY + (this.seeds[s + 1] - 0.5) * halfHeight * 2.8 * perspective - lookY * 1.1;
      this.put(
        this.debris,
        x,
        y,
        depth,
        0.08 + this.seeds[s + 3] * 0.26,
        0.6,
        t * 0.06 + i * 1.7,
        0.25 + this.seeds[s + 3] * 0.3,
      );
    }
    // Near-camera silhouettes only graze the outer 8% of the viewport, never its central lanes.
    if (active && quality !== 'LOW' && !reducedMotion)
      for (let i = 0; i < 6; i++) {
        const s = (40 + i) * 4,
          depth = 2.5 + this.seeds[s + 2] * 2;
        const perspective = (cameraZ - depth) / cameraZ;
        const size = 0.8 + this.seeds[s + 3] * 1.1;
        const span = halfWidth * 2 * perspective + 12;
        const x = wrap(this.seeds[s] * span - t * (3.2 + this.seeds[s + 2] * 1.3), span);
        const sign = i % 2 ? 1 : -1;
        const y = cameraY + sign * (halfHeight * 0.94 * perspective + size * 1.3);
        this.put(this.foreground, x, y, depth, size, 0.7, i + t * 0.03, 0.22);
      }
    for (let i = 0; i < this.mist.length; i++) {
      const sheet = this.mist[i];
      sheet.visible = quality !== 'LOW';
      const depth = -10 - i * 17,
        perspective = (cameraZ - depth) / cameraZ;
      sheet.position.set(
        (i - 1) * halfWidth * 0.9 * perspective - lookX * (3 - i),
        cameraY + halfHeight * 0.35 * perspective,
        depth,
      );
      sheet.scale.set(halfWidth * 0.65 * perspective, halfHeight * 3 * perspective, 1);
    }
    for (const mesh of batches) {
      mesh.visible = mesh.count > 0;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.clearUpdateRanges();
        mesh.instanceColor.addUpdateRange(0, mesh.count * 3);
        mesh.instanceColor.needsUpdate = true;
      }
    }
  }
}

/** Wrap only outside the visible frustum, leaving room for the entire object. */
const wrap = (x: number, span: number) => ((((x + span / 2) % span) + span) % span) - span / 2;
