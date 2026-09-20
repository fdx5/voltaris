import * as T from 'three/webgpu';
import { float, uv, sin, uniform } from 'three/tsl';
import { depthModel, loadDepthAssets } from './DepthAssets';
import { sceneryPass, SCENERY_MODELS, SCENERY_SCHEDULE, type SceneryModel } from './ScenerySchedule';
import type { Terrain } from '../core/math/Terrain';
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
  private readonly models = new Map<SceneryModel, T.Group>();
  private readonly bottoms = new Map<SceneryModel, number>();
  private readonly bounds = new T.Box3();
  private readonly mist: T.Mesh[] = [];
  private readonly clock = uniform(0);
  private stage = -1;
  /**
   * Groups that just received their first real content, still hidden, and
   * haven't been handed to the renderer for a background shader/texture
   * warm-up yet - see `takePendingCompiles`. Populating a model as soon as
   * it finishes loading rather than only at the moment its scheduled pass
   * begins is what gives that warm-up somewhere to actually happen before
   * the group is revealed; without it, the very first frame a downloaded
   * model becomes visible is also the first frame its shader compiles and
   * its textures upload, which reads as a stutter mid-flight.
   */
  private readonly pendingCompile: T.Object3D[] = [];
  constructor() {
    this.root.name = 'NASA curated nonrepeating scenery';
    for (const name of SCENERY_MODELS) {
      const group = new T.Group();
      group.visible = false;
      this.models.set(name, group);
      this.root.add(group);
    }
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
  /** Drains the groups queued for a background compile since the last call. */
  takePendingCompiles(): T.Object3D[] {
    return this.pendingCompile.splice(0, this.pendingCompile.length);
  }
  /**
   * Adds a model's downloaded content to its (still hidden) group the
   * moment it's ready. Parked well outside the frustum rather than at the
   * origin: the renderer's background warm-up (`compileParked` in
   * ThreeBackend) has to force the group visible and unculled for a moment
   * to compile it at all, and a stray frame drawn mid-compile must land
   * nowhere near the play field instead of flashing a full-scale ship at
   * (0, 0).
   */
  private ensurePopulated(name: SceneryModel, ground: boolean) {
    const group = this.models.get(name)!;
    if (group.children.length) return;
    const model = depthModel(name);
    if (!model) return;
    group.add(model);
    group.position.set(0, 0, 0);
    group.scale.setScalar(1);
    group.rotation.set(ground ? 0 : 0.3, -0.6, ground ? 0 : -0.25);
    // Bounds must be measured at the origin - `bottoms` is a local offset,
    // reused verbatim (scaled by pass.size) once this model is on screen.
    this.bottoms.set(name, this.bounds.setFromObject(group).min.y);
    group.position.set(400, 400, -60);
    this.pendingCompile.push(group);
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
    stageProgress = 0,
  ) {
    const palette = SECTOR_LIGHT[stage];
    if (stage !== this.stage) {
      this.stage = stage;
      // Decoration loading never blocks combat or substitutes a low-detail model.
      void loadDepthAssets(stage).catch(() => undefined);
      for (const sheet of this.mist)
        (sheet.material as T.MeshBasicNodeMaterial).color.set(palette.fill);
    }
    const t = time * (active ? (reducedMotion ? 0.35 : 1) : 0.2);
    this.clock.value = t;
    for (const group of this.models.values()) group.visible = false;
    // Every model this stage will ever show gets populated (hidden) as soon
    // as its download resolves, not just the one due right now - see
    // `pendingCompile`'s note for why the lead time matters.
    for (const scheduled of SCENERY_SCHEDULE[stage] ?? [])
      this.ensurePopulated(scheduled.model, !!scheduled.ground);
    const pass = sceneryPass(stage, active ? stageProgress : 0.1);
    if (pass) {
      const group = this.models.get(pass.model)!;
      group.visible = group.children.length > 0;
      const depth = pass.ground ? -10 : -17;
      const perspective = (cameraZ - depth) / cameraZ;
      const phase = active ? (stageProgress - pass.start) / (pass.end - pass.start) : 0.55;
      const extent = halfWidth * perspective + pass.size * 2;
      const x = (1 - phase * 2) * extent - lookX;
      const y =
        pass.ground && terrain
          ? terrain.height(x + scroll, depth) -
            (this.bottoms.get(pass.model) ?? 0) * pass.size +
            0.025
          : cameraY + halfHeight * 0.58 * perspective - lookY;
      group.position.set(x, y, depth);
      group.scale.setScalar(pass.size);
      // Fixed pose keeps authored panel highlights stable as the model passes.
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
  }
}
