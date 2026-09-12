import * as T from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import type { IRenderBackend, Quality } from './IRenderBackend';
import type { GameState } from '../../game/GameState';

import {
  makeShip,
  animateShip,
  makeBoss,
  buildBackdrop,
  enemyGeometry,
  groundGeometry,
  glow,
  ENEMY_TYPES,
  ENEMY_CORE,
  GROUND_TYPES,
  GROUND_CORE,
  type BossModel,
  type SceneName,
} from '../../visual/SceneBuilder';
import { STAGES } from '../../game/stages';
import { ObjectPool } from '../pool/ObjectPool';
import { itemMaterial } from '../../visual/ItemDesign';
import { enemyRotation } from '../../game/HostilePatterns';

/**
 * Debris colours, indexed by a particle's type. Saturated on purpose: the
 * emissive gain below drives one channel past the bloom threshold while the
 * others stay low, so a wreck keeps its hue instead of clipping to white.
 * Steel is the exception and deliberately stays under the threshold, so cold
 * debris reads as debris rather than fire.
 */
const EMBERS = [
  '#ffb45a',
  '#ff6a3c',
  '#8fb0c8',
  '#ffd24a',
  '#b06bff',
  '#6effc0',
  '#5fc8ff',
  '#ff4d5a',
];

/**
 * Draw recipe for one hostile projectile family. `sx/sy/sz` scale the unit
 * geometry by the shot's collision radius, so the sprite always matches the
 * hitbox it is drawn for. `spin` turns the shape; otherwise it is aligned to
 * its own velocity.
 */
type ShotStyle = {
  geometry: T.BufferGeometry;
  hex: string;
  gain: number;
  sx: number;
  sy: number;
  sz: number;
  spin: number;
  capacity: number;
};

function shotStyles(): ShotStyle[] {
  const capsule = () => new T.CapsuleGeometry(1, 5, 3, 6).rotateZ(Math.PI / 2);
  return [
    // ORB
    {
      geometry: new T.SphereGeometry(1, 10, 8),
      hex: '#ff4d6a',
      gain: 2.6,
      sx: 1.15,
      sy: 1.15,
      sz: 1.15,
      spin: 0,
      capacity: 4096,
    },
    // NEEDLE
    {
      geometry: capsule(),
      hex: '#ffd23f',
      gain: 2.8,
      sx: 2.1,
      sy: 0.5,
      sz: 0.5,
      spin: 0,
      capacity: 2048,
    },
    // WAVE
    {
      geometry: new T.OctahedronGeometry(1, 0),
      hex: '#5effb0',
      gain: 2.6,
      sx: 1.5,
      sy: 1.2,
      sz: 1.2,
      spin: 5,
      capacity: 1024,
    },
    // ACCEL
    {
      geometry: new T.ConeGeometry(1, 2.6, 7).rotateZ(-Math.PI / 2),
      hex: '#ff8a3c',
      gain: 2.8,
      sx: 1.4,
      sy: 1,
      sz: 1,
      spin: 0,
      capacity: 1024,
    },
    // HOMING
    {
      geometry: new T.TorusGeometry(0.7, 0.32, 6, 12),
      hex: '#ff5ce0',
      gain: 3,
      sx: 1.5,
      sy: 1.5,
      sz: 1.5,
      spin: 7,
      capacity: 768,
    },
    // PULSE
    {
      geometry: new T.SphereGeometry(1, 14, 10),
      hex: '#9b6bff',
      gain: 2.2,
      sx: 1.05,
      sy: 1.05,
      sz: 1.05,
      spin: 0,
      capacity: 1024,
    },
    // SPLIT
    {
      geometry: new T.IcosahedronGeometry(1, 0),
      hex: '#ff3ca0',
      gain: 2.8,
      sx: 1.4,
      sy: 1.4,
      sz: 1.4,
      spin: -4,
      capacity: 1024,
    },
    // BOUNCE
    {
      geometry: new T.BoxGeometry(1.5, 1.5, 1.5),
      hex: '#b6ff5a',
      gain: 2.4,
      sx: 1.05,
      sy: 1.05,
      sz: 1.05,
      spin: 3,
      capacity: 1024,
    },
    // SHARD
    {
      geometry: new T.TetrahedronGeometry(1.3, 0),
      hex: '#ffa8c0',
      gain: 2.2,
      sx: 1.7,
      sy: 0.85,
      sz: 0.85,
      spin: 0,
      capacity: 1024,
    },
    // PLASMA
    {
      geometry: new T.TorusGeometry(0.8, 0.26, 8, 16),
      hex: '#ff5252',
      gain: 3.2,
      sx: 1.35,
      sy: 1.35,
      sz: 1.35,
      spin: 2.4,
      capacity: 768,
    },
  ];
}

export class ThreeBackend implements IRenderBackend {
  renderer: T.WebGPURenderer;
  canvas: HTMLCanvasElement;
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(30, 16 / 9, 0.1, 220);
  backendName = 'INITIALIZING';
  quality: Quality = 'HIGH';
  bloomEnabled = true;
  hitbox = true;
  reducedMotion = false;
  readonly ship = makeShip();
  private readonly dummy = new T.Object3D();
  private readonly white = new T.Color(1, 1, 1);
  private readonly tint = new T.Color();
  private readonly shotStyle = shotStyles();
  private readonly hostileShots: T.InstancedMesh[] = [];
  private readonly shotCore: T.InstancedMesh;
  private readonly shotHalo: T.InstancedMesh;
  private readonly missiles: T.InstancedMesh;
  private readonly lance: T.InstancedMesh;
  private readonly allShotBatches: T.InstancedMesh[] = [];
  /**
   * Everything the hangar never shows. Holding these back from the first
   * compile is the difference between a few hundred milliseconds and several
   * seconds of black screen; they are warmed up straight afterwards.
   */
  private readonly deferred: T.Object3D[] = [];
  private readonly enemyHulls: T.InstancedMesh[] = [];
  private readonly enemyAccents: (T.InstancedMesh | null)[] = [];
  private readonly enemyCores: T.InstancedMesh;
  private readonly groundHulls: T.InstancedMesh[] = [];
  private readonly groundAccents: (T.InstancedMesh | null)[] = [];
  private readonly groundCores: T.InstancedMesh;
  private readonly bombs: T.InstancedMesh;
  private readonly skyBombs: T.InstancedMesh;
  private readonly options: T.Group[] = [];
  /** The tumbling inner shape of each option, spun independently of its gun. */
  private readonly optionCores: T.Mesh[] = [];
  private readonly itemBatches: T.InstancedMesh[] = [];
  private readonly particles: T.InstancedMesh;
  /** One backdrop and one boss model per stage, swapped by visibility so the
   *  shaders are all compiled up front and a stage change never hitches. */
  private readonly skies: ReturnType<typeof buildBackdrop>[] = [];
  private readonly bosses: BossModel[] = [];
  private stage = 0;
  private readonly shieldMesh: T.Mesh;
  private readonly hitDot: T.Mesh;
  private pipeline: T.RenderPipeline | null = null;
  private bloomNode: ReturnType<typeof bloom> | null = null;
  private readonly engineLight = new T.PointLight('#76dfff', 8, 8, 2);
  private readonly explosionLight = new T.PointLight('#ffa872', 0, 15, 2);
  private readonly bossFire = new T.InstancedMesh(
    new T.SphereGeometry(1, 16, 12),
    new T.MeshBasicNodeMaterial({
      toneMapped: false,
      transparent: true,
      opacity: 0.85,
      blending: T.AdditiveBlending,
      depthWrite: false,
    }),
    24,
  );
  private readonly bossSmoke = new T.InstancedMesh(
    new T.IcosahedronGeometry(1, 2),
    new T.MeshStandardNodeMaterial({
      color: '#25232b',
      roughness: 1,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
    24,
  );
  private readonly bossShockwave = new T.Mesh(
    new T.TorusGeometry(1, 0.025, 8, 96),
    new T.MeshBasicNodeMaterial({
      color: '#ffd8a0',
      toneMapped: false,
      transparent: true,
      blending: T.AdditiveBlending,
      depthWrite: false,
    }),
  );
  private visualTime = 0;
  /**
   * Set once every shader has been compiled. Until then every batch stays in
   * the scene so the compile pass can see it.
   */
  private warmed = false;
  constructor(
    private host: HTMLElement,
    private forceWebGL = false,
    /**
     * Test seam: makes the first start-up fail the way a lost device does,
     * after the compile pass has already hidden the combat batches. Set from
     * `?rendererfail`, and only ever true for one attempt.
     */
    private failFirstBoot = false,
  ) {
    this.renderer = this.makeRenderer(forceWebGL, true);
    this.canvas = this.attach();
    this.scene.background = new T.Color('#03060c');
    this.scene.fog = new T.FogExp2('#060d16', 0.003);
    this.scene.add(new T.HemisphereLight('#b9d6eb', '#15161c', 2.1));
    const sun = new T.DirectionalLight('#e1eff2', 3.5);
    sun.position.set(-9, 13, 20);
    this.scene.add(sun);
    const rim = new T.DirectionalLight('#527991', 3);
    rim.position.set(4, -6, -10);
    this.scene.add(rim);
    // Two up-lights. Open space barely notices them; a cave ceiling would be
    // solid black without them, since every other light points downwards, and
    // the hemisphere light hands a down-facing normal its ground colour.
    const bounce = new T.DirectionalLight('#8fc0e4', 2.6);
    bounce.position.set(-3, -12, 7);
    const bounceFill = new T.DirectionalLight('#4d7fa8', 1.2);
    bounceFill.position.set(7, -9, -6);
    this.scene.add(bounceFill);
    this.scene.add(bounce);
    this.scene.add(this.engineLight, this.explosionLight);
    for (const batch of [this.bossFire, this.bossSmoke]) {
      batch.count = 0;
      batch.frustumCulled = false;
      batch.instanceMatrix.setUsage(T.DynamicDrawUsage);
      this.scene.add(batch);
      this.deferred.push(batch);
    }
    ThreeBackend.tintable(this.bossFire);
    this.bossShockwave.visible = false;
    this.scene.add(this.bossShockwave);
    this.deferred.push(this.bossShockwave);
    const scenes: SceneName[] = ['earth', 'mars', 'jupiter', 'neptune'];
    for (let i = 0; i < scenes.length; i++)
      this.skies.push(buildBackdrop(this.scene, scenes[i], STAGES[i]?.surface ?? null));
    for (const design of ['gatekeeper', 'ares', 'jove', 'nereid'] as const) {
      const model = makeBoss(design);
      this.scene.add(model.root, ...model.pods);
      this.deferred.push(model.root, ...model.pods);
      this.bosses.push(model);
    }
    this.showStage(0);
    this.scene.add(this.ship);

    /* --- Projectiles ------------------------------------------------- */
    const batch = (g: T.BufferGeometry, m: T.Material, capacity: number, order = 20) => {
      const mesh = new T.InstancedMesh(g, m, capacity);
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      this.allShotBatches.push(mesh);
      this.deferred.push(mesh);
      this.scene.add(mesh);
      return mesh;
    };
    const lit = (hex: string, gain: number) => {
      const m = glow(hex, gain);
      m.depthTest = false;
      return m;
    };
    const bolt = new T.CapsuleGeometry(1, 4, 3, 6).rotateZ(Math.PI / 2);
    this.shotHalo = batch(
      bolt.clone(),
      Object.assign(lit('#3fbfff', 1.1), {
        transparent: true,
        opacity: 0.3,
        blending: T.AdditiveBlending,
        depthWrite: false,
      }),
      1024,
      19,
    );
    this.shotCore = batch(bolt, lit('#e8f8ff', 2.6), 1024);
    this.missiles = batch(
      new T.ConeGeometry(1, 3, 6).rotateZ(-Math.PI / 2),
      lit('#ffcf94', 2.6),
      512,
    );
    this.lance = batch(
      new T.CapsuleGeometry(1, 6, 4, 10).rotateZ(Math.PI / 2),
      lit('#a8ecff', 4),
      96,
    );
    this.skyBombs = batch(new T.ConeGeometry(1, 2.6, 6), lit('#a8e6ff', 2.6), 256);
    this.bombs = batch(new T.ConeGeometry(1, 2.6, 6).rotateZ(Math.PI), lit('#ffd06a', 2.6), 256);
    for (const style of this.shotStyle) {
      const shots = batch(style.geometry, lit('#ffffff', 1), style.capacity);
      ThreeBackend.tintable(shots);
      this.hostileShots.push(shots);
    }

    /* --- Enemy fleet -------------------------------------------------- */
    // Less metal than a hero asset would use: at this size the specular
    // lobe is a few pixels wide and everything else falls to black.
    const hullMaterial = new T.MeshStandardNodeMaterial({
      vertexColors: true,
      metalness: 0.3,
      roughness: 0.45,
    });
    const accentMaterial = new T.MeshBasicNodeMaterial({ vertexColors: true, toneMapped: false });
    for (let i = 0; i < ENEMY_TYPES; i++) {
      const parts = enemyGeometry(i);
      const material = hullMaterial.clone();
      material.metalness = 0.58;
      material.roughness = 0.42;
      const hull = new T.InstancedMesh(parts.hull!, material, 256);
      hull.count = 0;
      hull.frustumCulled = false;
      hull.instanceMatrix.setUsage(T.DynamicDrawUsage);
      ThreeBackend.tintable(hull);
      this.enemyHulls.push(hull);
      this.deferred.push(hull);
      this.scene.add(hull);
      if (parts.accent) {
        const accent = new T.InstancedMesh(parts.accent, accentMaterial, 256);
        accent.count = 0;
        accent.frustumCulled = false;
        accent.instanceMatrix.setUsage(T.DynamicDrawUsage);
        this.enemyAccents.push(accent);
        this.deferred.push(accent);
        this.scene.add(accent);
      } else this.enemyAccents.push(null);
    }
    for (let i = 0; i < GROUND_TYPES; i++) {
      const parts = groundGeometry(i);
      const hull = new T.InstancedMesh(parts.hull!, hullMaterial, 64);
      hull.count = 0;
      hull.frustumCulled = false;
      hull.instanceMatrix.setUsage(T.DynamicDrawUsage);
      ThreeBackend.tintable(hull);
      this.groundHulls.push(hull);
      this.deferred.push(hull);
      this.scene.add(hull);
      if (parts.accent) {
        const accent = new T.InstancedMesh(parts.accent, accentMaterial, 64);
        accent.count = 0;
        accent.frustumCulled = false;
        accent.instanceMatrix.setUsage(T.DynamicDrawUsage);
        this.groundAccents.push(accent);
        this.deferred.push(accent);
        this.scene.add(accent);
      } else this.groundAccents.push(null);
    }
    this.groundCores = new T.InstancedMesh(
      new T.SphereGeometry(1, 12, 8),
      new T.MeshBasicNodeMaterial({ toneMapped: false }),
      64,
    );
    this.groundCores.count = 0;
    this.groundCores.frustumCulled = false;
    this.groundCores.instanceMatrix.setUsage(T.DynamicDrawUsage);
    ThreeBackend.tintable(this.groundCores);
    this.deferred.push(this.groundCores);
    this.scene.add(this.groundCores);
    this.enemyCores = new T.InstancedMesh(
      new T.SphereGeometry(1, 12, 8),
      new T.MeshBasicNodeMaterial({ toneMapped: false }),
      256,
    );
    this.enemyCores.count = 0;
    this.enemyCores.frustumCulled = false;
    this.enemyCores.instanceMatrix.setUsage(T.DynamicDrawUsage);
    ThreeBackend.tintable(this.enemyCores);
    this.deferred.push(this.enemyCores);
    this.scene.add(this.enemyCores);

    for (let i = 0; i < 4; i++) {
      // An option is a tumbling core inside a housing that turns with its
      // gun: without the muzzle showing, DIRECTIONAL and ROTATE look the same
      // as trailing along.
      const option = new T.Group();
      const core = new T.Mesh(new T.OctahedronGeometry(0.23, 1), glow('#93ebff', 2));
      const muzzle = new T.Mesh(
        new T.ConeGeometry(0.09, 0.34, 6).rotateZ(-Math.PI / 2).translate(0.3, 0, 0),
        glow('#dff6ff', 2.4),
      );
      const ring = new T.Mesh(
        new T.TorusGeometry(0.3, 0.028, 6, 20).rotateY(Math.PI / 2),
        glow('#4fb6ff', 1.6),
      );
      option.add(core, muzzle, ring);
      this.optionCores.push(core);
      this.options.push(option);
      this.deferred.push(option);
      this.scene.add(option);
      const items = new T.InstancedMesh(new T.PlaneGeometry(1.2, 1.2), itemMaterial(i), 64);
      items.instanceMatrix.setUsage(T.DynamicDrawUsage);
      items.count = 0;
      items.frustumCulled = false;
      this.itemBatches.push(items);
      this.deferred.push(items);
      this.scene.add(items);
    }
    this.particles = new T.InstancedMesh(new T.SphereGeometry(1, 4, 3), glow('#ffffff', 1.8), 3000);
    this.particles.count = 0;
    this.particles.frustumCulled = false;
    this.particles.renderOrder = 18;
    this.particles.instanceMatrix.setUsage(T.DynamicDrawUsage);
    ThreeBackend.tintable(this.particles);
    this.deferred.push(this.particles);
    this.scene.add(this.particles);
    this.shieldMesh = new T.Mesh(new T.TorusGeometry(1.05, 0.025, 6, 48), glow('#9beced', 1.4));
    this.deferred.push(this.shieldMesh);
    this.scene.add(this.shieldMesh);
    this.hitDot = new T.Mesh(new T.SphereGeometry(0.07, 8, 6), glow('#ffffff', 2));
    this.hitDot.renderOrder = 25;
    this.deferred.push(this.hitDot);
    this.scene.add(this.hitDot);
    this.resize();
  }
  private makeRenderer(forceWebGL: boolean, antialias: boolean) {
    return new T.WebGPURenderer({
      antialias,
      alpha: false,
      forceWebGL,
      // A discrete GPU is worth asking for, but on a hybrid laptop the ask can
      // be what fails, so the fallback pass leaves the choice to the browser.
      powerPreference: forceWebGL ? undefined : 'high-performance',
    });
  }
  /** Puts the current renderer's canvas into the host element. */
  private attach() {
    const canvas = this.renderer.domElement;
    canvas.className = 'game-canvas';
    canvas.setAttribute('aria-label', 'VOLTARIS 3D 전투 화면');
    this.host.appendChild(canvas);
    return canvas;
  }
  /** Reveals one stage's backdrop and boss, hiding every other. */
  private showStage(index: number) {
    this.stage = Math.max(0, Math.min(index, this.skies.length - 1));
    for (let i = 0; i < this.skies.length; i++) this.skies[i].root.visible = i === this.stage;
    for (let i = 0; i < this.bosses.length; i++) {
      const active = i === this.stage;
      this.bosses[i].root.visible = false;
      for (const pod of this.bosses[i].pods) pod.visible = active && pod.visible;
    }
  }
  async init() {
    // What the deferred batches looked like before anything touched them. A
    // failed attempt leaves them hidden, and the retry must not inherit that:
    // the batches would then be filtered out of the second compile and stay
    // invisible for the whole session - a game with no enemies and no shots.
    const shown = this.deferred.map((o) => o.visible);
    try {
      await this.boot();
    } catch (e) {
      // WebGPU can be advertised and still fail: an old driver, a blocklisted
      // GPU, a device lost while the first shaders compile. Three picks its
      // backend in the constructor and never retries, so we do - once, on
      // WebGL 2 with the modest context a tired machine is likelier to grant.
      if (this.forceWebGL) throw e;
      console.warn('[VOLTARIS] WebGPU start failed, retrying on WebGL 2:', e);
      this.canvas.remove();
      this.pipeline?.dispose();
      this.pipeline = null;
      try {
        this.renderer.dispose();
      } catch {
        /* it never came up; there is nothing to release */
      }
      this.forceWebGL = true;
      for (let i = 0; i < this.deferred.length; i++) this.deferred[i].visible = shown[i];
      // A machine that just failed to start a renderer gets the modest one:
      // no multisampling, no high-performance request, fewer pixels.
      this.quality = 'MEDIUM';
      this.renderer = this.makeRenderer(true, false);
      this.canvas = this.attach();
      this.resize();
      await this.boot();
    }
  }
  /** Brings the current renderer all the way up to a compiled hangar. */
  private async boot() {
    // A restart compiles from scratch, and the compile pass only sees what is
    // visible: every batch the last session hid as empty comes back first.
    this.warmed = false;
    this.scene.traverse((o) => {
      if ((o as T.InstancedMesh).isInstancedMesh) o.visible = true;
    });
    await this.renderer.init();
    // The backend's own flag, not its class name: a production build mangles
    // class names, so the label used to read WEBGPU whatever was running.
    this.backendName = (this.renderer.backend as { isWebGLBackend?: boolean }).isWebGLBackend
      ? 'WEBGL 2'
      : 'WEBGPU';
    console.info('[VOLTARIS] Active backend:', this.backendName);
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    const scenePass = pass(this.scene, this.camera);
    const output = scenePass.getTextureNode('output');
    this.bloomNode = bloom(output, 0.3, 0.35, 1.15);
    this.bloomNode.setResolutionScale(0.5);
    this.pipeline = new T.RenderPipeline(this.renderer);
    this.pipeline.outputNode = output.add(this.bloomNode);
    // `compileAsync` walks the visible scene, so the hangar only pays for what
    // the hangar draws.
    const held = this.deferred.filter((o) => o.visible);
    for (const o of held) o.visible = false;
    try {
      if (this.failFirstBoot) {
        this.failFirstBoot = false;
        throw new Error('forced renderer failure (?rendererfail)');
      }
      await this.renderer.compileAsync(this.scene, this.camera);
    } finally {
      for (const o of held) o.visible = true;
    }
  }
  /**
   * Compiles everything held back from `init`, after the first frame is up.
   * Runs off the critical path, so the hangar is interactive while the combat
   * shaders build.
   */
  async warmup() {
    await this.renderer.compileAsync(this.scene, this.camera);
    // Then each stage's backdrop in turn, so selecting one later does not
    // stall on shaders that have never been seen.
    const active = this.stage;
    for (let i = 0; i < this.skies.length; i++) {
      if (i === active) continue;
      this.showStage(i);
      await this.renderer.compileAsync(this.scene, this.camera);
    }
    this.showStage(active);
    this.warmed = true;
  }
  resize() {
    const w = Math.max(1, this.host.clientWidth),
      h = Math.max(1, this.host.clientHeight);
    this.camera.aspect = w / h;
    const height = Math.max(18, 32 / this.camera.aspect);
    this.camera.position.set(0, 0, height / 2 / Math.tan(Math.PI / 12));
    this.camera.updateProjectionMatrix();
    const scale = this.quality === 'HIGH' ? 1 : this.quality === 'MEDIUM' ? 0.85 : 0.7;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75) * scale);
    this.renderer.setSize(w, h);
  }
  setQuality(q: Quality) {
    this.quality = q;
    this.resize();
    if (this.bloomNode)
      this.bloomNode.setResolutionScale(q === 'HIGH' ? 0.5 : q === 'MEDIUM' ? 0.35 : 0.25);
  }
  /**
   * Node materials decide whether to multiply in `instanceColor` when the
   * shader is built, and the shader is built once in `init()`. An attribute
   * created later by `setColorAt` is therefore never read, so every batch that
   * will ever be tinted has to declare it up front.
   */
  private static tintable(mesh: T.InstancedMesh) {
    const colors = new Float32Array(mesh.instanceMatrix.count * 3).fill(1);
    mesh.instanceColor = new T.InstancedBufferAttribute(colors, 3);
    mesh.instanceColor.setUsage(T.DynamicDrawUsage);
    return mesh;
  }
  private set(
    i: number,
    batch: T.InstancedMesh,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    angle = 0,
  ) {
    this.dummy.position.set(x, y, z);
    this.dummy.rotation.set(0, 0, angle);
    this.dummy.scale.set(sx, sy, sz);
    this.dummy.updateMatrix();
    batch.setMatrixAt(i, this.dummy.matrix);
  }
  /** Appends one instance, ignoring the write when the batch is already full. */
  private push(
    batch: T.InstancedMesh,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    angle = 0,
  ) {
    if (batch.count >= batch.instanceMatrix.count) return;
    this.set(batch.count++, batch, x, y, z, sx, sy, sz, angle);
  }
  /**
   * Hands one filled batch to the renderer.
   *
   * A visible instanced mesh has its whole matrix buffer handed to the GPU
   * every frame, all of it, however few instances are actually drawn from it.
   * A stage carries a batch per enemy family, per emplacement, per shot
   * style, and all but a handful of them are empty at any one moment: left
   * visible they were three megabytes of upload a frame to draw nothing. An
   * empty batch is therefore dropped from the scene outright, and a filled
   * one uploads only the prefix it filled.
   *
   * Nothing may be hidden before the shaders are built, though: the compile
   * pass walks the visible scene, so a batch hidden while empty would never
   * be compiled and would stall the frame it first appears in.
   */
  private commit(batch: T.InstancedMesh | null | undefined) {
    if (!batch) return;
    const used = batch.count > 0;
    if (this.warmed) batch.visible = used;
    if (!used && this.warmed) return;
    const matrix = batch.instanceMatrix;
    matrix.clearUpdateRanges();
    matrix.addUpdateRange(0, batch.count * 16);
    matrix.needsUpdate = true;
    const color = batch.instanceColor;
    if (color) {
      color.clearUpdateRanges();
      color.addUpdateRange(0, batch.count * 3);
      color.needsUpdate = true;
    }
  }
  private syncPool(pool: ObjectPool, batches: T.InstancedMesh[], alpha: number, spin: boolean) {
    for (const b of batches) b.count = 0;
    for (let i = 0; i < pool.capacity; i++) {
      if (!pool.active[i]) continue;
      const batch = batches[pool.type[i]];
      if (!batch) continue;
      const x = pool.px[i] + (pool.x[i] - pool.px[i]) * alpha,
        y = pool.py[i] + (pool.y[i] - pool.py[i]) * alpha;
      this.push(batch, x, y, 0.2, 1, 1, 1, spin ? this.visualTime * 2 : 0);
    }
    for (const b of batches) this.commit(b);
  }
  /** Player bolts, missiles, the charge lance and all ten hostile families. */
  private syncBullets(g: Readonly<GameState>, alpha: number) {
    for (const b of this.allShotBatches) b.count = 0;
    const p = g.bullets,
      t = this.visualTime;
    for (let i = 0; i < p.capacity; i++) {
      if (!p.active[i]) continue;
      const x = p.px[i] + (p.x[i] - p.px[i]) * alpha,
        y = p.py[i] + (p.y[i] - p.py[i]) * alpha,
        r = p.radius[i],
        aim = Math.atan2(p.vy[i], p.vx[i]);
      switch (p.type[i]) {
        case 1: {
          const k = p.kind[i],
            s = this.shotStyle[k],
            slot = this.hostileShots[k].count;
          this.push(
            this.hostileShots[k],
            x,
            y,
            0.15,
            r * s.sx,
            r * s.sy,
            r * s.sz,
            s.spin ? t * s.spin + i * 0.7 : aim,
          );
          const hostileBatch = this.hostileShots[k];
          if (hostileBatch.count > slot) {
            this.tint
              .set(p.tint[i] || s.hex)
              .lerp(this.white, 0.18)
              .multiplyScalar(s.gain);
            hostileBatch.setColorAt(hostileBatch.count - 1, this.tint);
          }
          break;
        }
        case 2:
          this.push(this.missiles, x, y, 0.15, r * 1.35, r * 0.8, r * 0.8, aim);
          break;
        case 4:
          // Nose down along its own arc, so a salvo reads as falling ordnance.
          this.push(this.bombs, x, y, 0.15, r * 1.1, r * 2.2, r * 1.1, aim + Math.PI / 2);
          break;
        case 5:
          // The mirrored half of a cave salvo, climbing at the roof.
          this.push(this.skyBombs, x, y, 0.15, r * 1.1, r * 2.2, r * 1.1, aim - Math.PI / 2);
          break;
        case 3:
          this.push(this.lance, x, y, 0.15, r * 2.4, r * 0.85, r * 0.85, aim);
          break;
        default:
          // A hairline core inside a soft additive sheath reads as a tracer
          // without the slab of geometry a single fat capsule needs.
          this.push(this.shotCore, x, y, 0.15, r * 1.5, r * 0.38, r * 0.38, aim);
          this.push(this.shotHalo, x, y, 0.14, r * 2.2, r * 0.95, r * 0.95, aim);
      }
    }
    for (const b of this.allShotBatches) this.commit(b);
  }
  private syncEnemies(g: Readonly<GameState>, alpha: number) {
    const e = g.enemies,
      t = this.visualTime;
    for (const b of this.enemyHulls) b.count = 0;
    for (const b of this.enemyAccents) if (b) b.count = 0;
    this.enemyCores.count = 0;
    for (let i = 0; i < e.capacity; i++) {
      if (!e.active[i]) continue;
      const type = e.type[i],
        hull = this.enemyHulls[type];
      if (!hull) continue;
      const x = e.px[i] + (e.x[i] - e.px[i]) * alpha,
        y = e.py[i] + (e.y[i] - e.py[i]) * alpha;
      // SPINNER and TEMPEST read as rotors; the rest just bank as they weave.
      const angle = enemyRotation(type, e.age[i], g.time);
      const slot = hull.count;
      this.push(hull, x, y, 0, 1, 1, 1, angle);
      // instanceColor multiplies the baked hull colours, so a hit reads as the
      // whole airframe flaring white for a frame or two.
      if (hull.count > slot) {
        const flash = g.enemyFlash[i];
        if (flash > 0) {
          const flare = 1 + flash * 26;
          this.tint.setRGB(flare, flare, flare);
          hull.setColorAt(slot, this.tint);
        } else hull.setColorAt(slot, this.white);
      }
      const accent = this.enemyAccents[type];
      if (accent) this.push(accent, x, y, 0, 1, 1, 1, angle);
      const core = ENEMY_CORE[type];
      const pulse = g.enemyTelegraph(i) ? 2 + Math.sin(t * 50) * 0.9 : 1;
      if (this.enemyCores.count < this.enemyCores.instanceMatrix.count) {
        const idx = this.enemyCores.count;
        this.push(
          this.enemyCores,
          x + core.x * Math.cos(angle) - core.y * Math.sin(angle),
          y + core.x * Math.sin(angle) + core.y * Math.cos(angle),
          core.z,
          core.size * pulse,
          core.size * pulse,
          core.size * pulse,
        );
        this.tint.set(core.hex).multiplyScalar(pulse > 1 ? 2.4 : 1.5);
        this.enemyCores.setColorAt(idx, this.tint);
      }
    }
    for (const b of this.enemyHulls) this.commit(b);
    for (const b of this.enemyAccents) this.commit(b);
    this.commit(this.enemyCores);
  }
  /** Emplacements sit on the surface; the lamp marks the muzzle. */
  private syncGround(g: Readonly<GameState>, alpha: number) {
    const p = g.ground,
      t = this.visualTime;
    for (const b of this.groundHulls) b.count = 0;
    for (const b of this.groundAccents) if (b) b.count = 0;
    this.groundCores.count = 0;
    for (let i = 0; i < p.capacity; i++) {
      if (!p.active[i]) continue;
      const type = p.type[i],
        hull = this.groundHulls[type];
      if (!hull) continue;
      const x = p.px[i] + (p.x[i] - p.px[i]) * alpha,
        y = p.py[i] + (p.y[i] - p.py[i]) * alpha;
      // A roof mount is the same model turned over.
      const spin = p.aux[i] === 1 ? Math.PI : 0;
      const slot = hull.count;
      this.push(hull, x, y, 0, 1, 1, 1, spin);
      if (hull.count > slot) {
        const flash = g.groundFlash[i];
        if (flash > 0) {
          const flare = 1 + flash * 26;
          this.tint.setRGB(flare, flare, flare);
        } else this.tint.copy(this.white);
        hull.setColorAt(slot, this.tint);
      }
      const accent = this.groundAccents[type];
      if (accent) this.push(accent, x, y, 0, 1, 1, 1, spin);
      const core = GROUND_CORE[type];
      const pulse = g.groundTelegraph(i) ? 2 + Math.sin(t * 50) * 0.9 : 1;
      if (this.groundCores.count < this.groundCores.instanceMatrix.count) {
        const idx = this.groundCores.count;
        this.push(
          this.groundCores,
          x + (spin ? -core.x : core.x),
          y + (spin ? -core.y : core.y),
          core.z,
          core.size * pulse,
          core.size * pulse,
          core.size * pulse,
        );
        this.tint.set(core.hex).multiplyScalar(pulse > 1 ? 2.4 : 1.5);
        this.groundCores.setColorAt(idx, this.tint);
      }
    }
    for (const b of this.groundHulls) this.commit(b);
    for (const b of this.groundAccents) this.commit(b);
    this.commit(this.groundCores);
  }
  sync(g: Readonly<GameState>, alpha: number, dt: number) {
    this.visualTime += dt;
    const t = this.visualTime;
    const inactive = g.status === 'menu';
    if (g.stageIndex !== this.stage) this.showStage(g.stageIndex);
    this.skies[this.stage].update(t, inactive ? 0.4 : this.reducedMotion ? 0.5 : 1);
    if (inactive) {
      this.ship.position.set(5.5, Math.sin(t * 0.6) * 0.28, 0);
      this.ship.scale.setScalar(3.05);
      this.ship.rotation.set(0.38 + Math.sin(t * 0.3) * 0.08, -0.22, -0.09);
      this.ship.visible = true;
    } else {
      this.ship.position.set(
        g.previousX + (g.x - g.previousX) * alpha,
        g.previousY + (g.y - g.previousY) * alpha,
        0,
      );
      this.ship.scale.setScalar(0.7);
      this.ship.rotation.set(-g.roll * 0.8, 0, g.pitch * 0.55, 'ZXY');
      this.ship.visible =
        g.respawn <= 0 &&
        (g.effects[0] > 0 || g.invincible <= 0 || Math.floor(g.time * 15) % 2 === 0);
    }
    animateShip(this.ship, t, inactive ? 0.35 : Math.min(1, Math.abs(g.roll) + Math.abs(g.pitch)));
    this.engineLight.position.copy(this.ship.position);
    this.engineLight.position.x -= 1;
    this.engineLight.intensity = inactive ? 12 : 5;
    this.shieldMesh.visible = !inactive && g.respawn <= 0 && (g.shield > 0 || g.effects[0] > 0);
    this.shieldMesh.position.set(g.x, g.y, 0.1);
    this.shieldMesh.rotation.z = t * (g.effects[0] > 0 ? 2 : 0.4);
    this.shieldMesh.scale.setScalar(g.effects[0] > 0 ? 1.4 + Math.sin(t * 12) * 0.05 : 1);
    this.hitDot.visible = !inactive && this.hitbox && g.respawn <= 0;
    this.hitDot.position.set(g.x, g.y, 0.65);
    this.syncBullets(g, alpha);
    this.syncEnemies(g, alpha);
    this.syncGround(g, alpha);
    // The surface is periodic, so scrolling it is one translation.
    const surface = this.skies[this.stage].ground;
    if (surface) {
      const shift = -(g.scroll % surface.span);
      surface.mesh.position.x = shift;
      if (surface.roof) surface.roof.position.x = shift;
    }
    this.syncPool(g.items, this.itemBatches, alpha, false);
    if (g.status === 'stress') {
      for (const b of this.enemyHulls) b.count = 0;
      for (const b of this.enemyAccents) if (b) b.count = 0;
      for (let i = 0; i < g.stressShips; i++) {
        const type = i % ENEMY_TYPES,
          x = (i % 10) * 3 - 13.5,
          y = Math.floor(i / 10) * 2 - 5,
          angle = Math.sin(t + i) * 0.2;
        this.push(this.enemyHulls[type], x, y, 0, 1, 1, 1, angle);
        const accent = this.enemyAccents[type];
        if (accent) this.push(accent, x, y, 0, 1, 1, 1, angle);
      }
      for (const b of this.enemyHulls) this.commit(b);
      for (const b of this.enemyAccents) this.commit(b);
    }
    for (let i = 0; i < 4; i++) {
      const o = this.options[i];
      o.visible = !inactive && i < g.optionCount;
      if (o.visible) {
        o.position.set(g.optionX[i], g.optionY[i], 0.3);
        // The housing carries the gun's heading; the core keeps tumbling.
        o.rotation.z = g.optionAngle[i];
        // Held control reads as the drones bracing: a touch larger, and the
        // ring squares up with the ship.
        o.scale.setScalar(g.optionHold ? 1.18 + Math.sin(t * 12) * 0.05 : 1);
        this.optionCores[i].rotation.set(t, t * 1.2, t * 0.7);
      }
    }
    const boss = this.bosses[this.stage];
    boss.root.visible = g.boss && (!g.bossDying || g.bossDeathTime < 6.65);
    boss.root.position.set(g.bossX, g.bossY, 0);
    boss.root.rotation.z = g.bossDying ? Math.sin(t * 27) * 0.012 * g.bossDeathTime : 0;
    boss.ring.rotation.z = g.bossAngle;
    boss.core.rotation.set(0, 0, t * 0.3);
    boss.core.scale.setScalar(g.bossShot < 0.4 ? 1.1 + Math.sin(t * 35) * 0.08 : 1);
    for (let i = 0; i < boss.pods.length; i++) {
      const pod = boss.pods[i];
      pod.visible =
        g.boss &&
        i < g.bossParts &&
        g.partHp[i] > 0 &&
        (!g.bossDying || g.bossDeathTime < 2.4 + i * 0.35);
      pod.position.set(g.partX[i], g.partY[i], 0.4);
      pod.rotation.z = g.bossAngle + (i / boss.pods.length) * Math.PI * 2;
    }
    this.particles.count = 0;
    this.bossFire.count = this.bossSmoke.count = 0;
    const death = g.bossDeathTime;
    this.bossShockwave.visible = g.bossDying && death > 6.65;
    if (g.bossDying) {
      for (let j = 0; j < 24; j++) {
        const n = Math.floor(death * 9) - j;
        const age = death - n / 9;
        if (n < 1 || n / 9 >= 6.65 || age > 2.3) continue;
        const a = n * 2.399963,
          r = 0.6 + (n % 7) * 0.48;
        const x = g.bossX + Math.cos(a) * r,
          y = g.bossY + Math.sin(a) * r * 0.85;
        const size = (0.22 + age * 1.3) * (death > 4.5 ? 1.3 : 1);
        this.push(
          this.bossSmoke,
          x + age * 0.15,
          y + age * 0.6,
          1.3,
          size,
          size * 0.8,
          size * 0.65,
        );
        if (age < 0.65) {
          const f = (0.18 + Math.sin((age / 0.65) * Math.PI) * 0.53) * (death > 4.5 ? 1.4 : 1);
          const index = this.bossFire.count;
          this.push(this.bossFire, x, y, 1.9, f, f, f * 0.8);
          this.tint.set(age < 0.15 ? '#fff3b3' : age < 0.35 ? '#ffab32' : '#ff4018');
          this.tint.multiplyScalar(2.2 * (1 - age / 0.65));
          this.bossFire.setColorAt(index, this.tint);
        }
      }
      this.bossShockwave.position.set(g.bossX, g.bossY, 2.2);
      this.bossShockwave.scale.setScalar(1 + Math.max(0, death - 6.65) * 26);
      this.bossShockwave.material.opacity = Math.max(0, 1 - (death - 6.65) / 0.35);
    }
    this.commit(this.bossFire);
    this.commit(this.bossSmoke);
    const p = g.particles;
    const limit = this.quality === 'LOW' ? 1000 : 3000;
    for (let i = 0; i < p.capacity && this.particles.count < limit; i++) {
      if (!p.active[i]) continue;
      const fade = 1 - p.age[i] / p.life[i],
        s = p.radius[i] * fade;
      const idx = this.particles.count++;
      this.set(idx, this.particles, p.x[i], p.y[i], g.bossDying ? 2.1 : 0.5, s, s, s);
      this.tint.set(EMBERS[p.type[i] % EMBERS.length]);
      this.particles.setColorAt(idx, this.tint);
    }
    this.commit(this.particles);
    this.explosionLight.position.set(g.bossDying ? g.bossX : g.x, g.bossDying ? g.bossY : g.y, 3);
    this.explosionLight.intensity = g.flash * 35;
    const shake = this.reducedMotion ? 0 : g.shake;
    this.camera.position.x = Math.sin(t * 73) * shake * 0.12;
    this.camera.position.y = Math.cos(t * 91) * shake * 0.12;
    if (this.bloomNode) this.bloomNode.strength.value = this.bloomEnabled ? 0.27 : 0;
  }
  render() {
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    if (this.pipeline) this.pipeline.render();
    else this.renderer.render(this.scene, this.camera);
  }
  get drawCalls() {
    return this.renderer.info.render.drawCalls;
  }
  get triangles() {
    return this.renderer.info.render.triangles;
  }
  get geometryCount() {
    return this.renderer.info.memory.geometries;
  }
  dispose() {
    for (const batch of this.itemBatches)
      (batch.material as T.MeshBasicNodeMaterial).map?.dispose();
    this.scene.traverse((obj) => {
      if (obj instanceof T.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
    this.pipeline?.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
