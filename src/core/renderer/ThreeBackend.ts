import { waitForSceneAssets } from '../../visual/SceneAssets';
import { DepthScenery, SECTOR_LIGHT } from '../../visual/DepthScenery';
import { DepthAccents } from '../../visual/DepthAccents';
import { DestructionEffects } from '../../visual/DestructionEffects';
import { PlasmaWhip } from '../../visual/PlasmaWhip';
import { specialStats } from '../../game/SpecialWeapons';
import * as T from 'three/webgpu';
import {
  attribute,
  float,
  mix,
  normalView,
  pass,
  positionGeometry,
  positionViewDirection,
  uniform,
  vec3,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { IRenderBackend, Quality } from './IRenderBackend';
import { isIOSDevice } from '../device';
import {
  IMPACTS,
  IMPACT_LIFE,
  MAX_LASER_TINT,
  MAX_MISSILE_TINT,
  MAX_SPREAD_TINT,
  type GameState,
} from '../../game/GameState';

import {
  animateShip,
  makeBoss,
  buildBackdrop,
  enemyGeometry,
  finishHull,
  HULL_MATERIALS,
  groundGeometry,
  glow,
  ENEMY_TYPES,
  ENEMY_CORE,
  GROUND_TYPES,
  GROUND_CORE,
  HAZARD_VARIANTS,
  hazardRock,
  type BossModel,
  type BossDesign,
  type SceneName,
} from '../../visual/SceneBuilder';
import { STAGES } from '../../game/stages';
import { makePlayerCraft, makeOrdnance } from '../../visual/PlayerLoadout';
import { ObjectPool } from '../pool/ObjectPool';
import { itemMaterial } from '../../visual/ItemDesign';
import { enemyRotation } from '../../game/HostilePatterns';
import { Shot } from '../../game/entities/BulletPool';
import tuning from '../../../data/tuning.json';
import { t } from '../../ui/i18n';

/**
 * A large hull's own vivid fresnel rim, cycled across the ten large types the
 * same way `BOSS_ACCENT` gives every boss its own identity - the imported
 * hull textures alone don't vary enough to read as "colourful" at a glance.
 */
const LARGE_ACCENT = [
  '#ff3b3b',
  '#ff9a3c',
  '#ffe14d',
  '#7cff4d',
  '#00e6c3',
  '#3ba7ff',
  '#a06bff',
  '#ff5bd6',
  '#ff7b3b',
  '#4dffb8',
];

/*
 * Share shader programs between instanced batches. Below a size limit three.js
 * stores a batch's instance matrices in a uniform buffer named after that
 * batch's node, so every one of the game's ~150 batches - enemy hulls, shot
 * styles, rocks, star layers - compiled its own vertex shader: 370 of them,
 * and on Windows' D3D11 path that alone froze start-up for about twenty
 * seconds. With no uniform-buffer budget every batch takes the instanced
 * attribute path instead, whose shader text is identical from batch to batch.
 * Only instancing consults this limit here (the game has no skinning).
 */
(
  T.NodeBuilder.prototype as unknown as { getUniformBufferLimit: () => number }
).getUniformBufferLimit = () => 0;
import { makeNovaMissile } from '../../visual/NovaMissile';
import { groundUnitMaterial } from '../../visual/GroundUnitMaterial';
import fleetHardpoints from '../../../data/enemies/fleet-hardpoints.json';

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
  private readonly ios = isIOSDevice();
  private disposed = false;
  /** Preparation owns the renderer exclusively; no frame may mutate its scene or target. */
  private warmingUp = 0;
  private readonly preparedStages = new Set<number>();
  /**
   * Count of `warmup()` background compiles currently in flight. `compileAsync`
   * runs across several real frames on some backends, not inside the single
   * synchronous call it looks like - a real frame drawn while one is pending
   * has shown a stray flash of whatever it's compiling (a hull mid-warmup
   * reads as a flat circle at the origin), so `render()` holds the previous
   * frame instead of drawing while this is nonzero. Kept separate from
   * `warmingUp`, which instead guards against a second `prepareStage()` call
   * racing this one - a background compile is expected to be in flight on
   * every ordinary launch and must not trip that guard.
   */
  private compiling = 0;
  /** Set from `sync()`: true whenever anything but the hangar is on screen. */
  private combatActive = false;
  renderer: T.WebGPURenderer;
  canvas: HTMLCanvasElement;
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(30, 16 / 9, 0.1, 220);
  backendName = 'INITIALIZING';
  quality: Quality = 'HIGH';
  bloomEnabled = true;
  hitbox = true;
  reducedMotion = false;
  readonly ship = new T.Group();
  private readonly playerCraft = {
    LASER: makePlayerCraft('LASER'),
    MISSILE: makePlayerCraft('MISSILE'),
    SPREAD: makePlayerCraft('SPREAD'),
  };
  private readonly dummy = new T.Object3D();
  private readonly white = new T.Color(1, 1, 1);
  private readonly tint = new T.Color();
  private readonly shotStyle = shotStyles();
  private readonly hostileShots: T.InstancedMesh[] = [];
  private readonly shotCore: T.InstancedMesh;
  private readonly shotHalo: T.InstancedMesh;
  private readonly missiles: T.InstancedMesh;
  private readonly missileExhaust: T.InstancedMesh;
  /** Hostile homing shots: the same downloaded missile model, recoloured. */
  private readonly hostileMissiles: T.InstancedMesh;
  private readonly hostileMissileExhaust: T.InstancedMesh;
  /** A maxed-out weapon's own shots (see MAX_*_TINT in GameState). */
  private readonly maxLaserCore: T.InstancedMesh;
  private readonly maxLaserHalo: T.InstancedMesh;
  private readonly maxMissiles: T.InstancedMesh;
  private readonly maxMissileExhaust: T.InstancedMesh;
  private readonly maxScatter: T.InstancedMesh;
  private readonly scatter: T.InstancedMesh;
  /** Option drone rounds: emerald pulses, magenta micro-missiles, amber pellets. */
  private readonly optionCore: T.InstancedMesh;
  private readonly optionHalo: T.InstancedMesh;
  private readonly optionMissiles: T.InstancedMesh;
  private readonly optionExhaust: T.InstancedMesh;
  private readonly optionScatter: T.InstancedMesh;
  /** SPREAD's heavy centre round: a hand-built crystal core, not the downloaded pellet model. */
  private readonly spreadCore: T.InstancedMesh;
  private readonly spreadCoreExhaust: T.InstancedMesh;
  private readonly lance: T.InstancedMesh;
  private readonly allShotBatches: T.InstancedMesh[] = [];
  /**
   * Everything the hangar never shows. Holding these back from the first
   * compile is the difference between a few hundred milliseconds and several
   * seconds of black screen; they are warmed up straight afterwards.
   */
  private readonly deferred: T.Object3D[] = [];
  /**
   * Models kept hidden until the moment they are needed - the blast ring of a
   * dying boss, the NOVA BOMB and its detonation. A compile pass skips hidden
   * objects, so `warmup` shows these for its traversal; otherwise their
   * shaders would build in the very frame they first appear.
   */
  private readonly hiddenUntilUsed: T.Object3D[] = [];
  private readonly enemyHulls: T.InstancedMesh[] = [];
  private readonly enemyAccents: (T.InstancedMesh | null)[] = [];
  private readonly enemyCores: T.InstancedMesh;
  /** Jet flames trailing every hostile's engine bells: a soft outer plume and a hot core. */
  private readonly exhaustPlume: T.InstancedMesh;
  private readonly exhaustCore: T.InstancedMesh;
  /** Each hull type burns its own colour, so a mixed squadron reads as mixed. */
  private readonly exhaustTint: T.Color[] = [];
  private readonly groundHulls: T.InstancedMesh[] = [];
  private readonly groundAccents: (T.InstancedMesh | null)[] = [];
  private readonly groundCores: T.InstancedMesh;
  private readonly bombs: T.InstancedMesh;
  private readonly skyBombs: T.InstancedMesh;
  private readonly options: T.Group[] = [];
  /** The tumbling inner shape of each option, spun independently of its gun. */
  private readonly optionCores: T.Mesh[] = [];
  private readonly depthScenery = new DepthScenery();
  private readonly depthAccents = new DepthAccents();
  private readonly keyLight = new T.DirectionalLight('#fff1d9', 3.1);
  private readonly rimLight = new T.DirectionalLight('#629adb', 3.2);
  private reflectionEnvironment: T.Texture | null = null;
  private readonly destruction = new DestructionEffects();
  private readonly plasmaWhip = new PlasmaWhip();
  /** 0 at normal charge, 1 at Lv.8: recolours the blade without a second mesh. */
  private readonly crescentPower = uniform(0);
  private readonly crescents = new T.InstancedMesh(
    ThreeBackend.crescentGeometry(),
    this.crescentMaterial(),
    512,
  );
  private crescentMaterial() {
    const material = new T.MeshStandardNodeMaterial({
      color: '#ffffff',
      vertexColors: true,
      metalness: 0.12,
      roughness: 0.82,
      side: T.DoubleSide,
    });
    const color = attribute<'vec3'>('color', 'vec3');
    const edge = color.r.sub(color.g).max(0).min(1);
    // Lv.8 crescent power-up: a deep red body with a vivid purple edge trim -
    // a visibly different weapon at full charge, not just a bigger hitbox.
    const bodyColor = vec3(0.72, 0.035, 0.07);
    const edgeColor = vec3(0.58, 0.14, 0.98);
    const fullPower = mix(bodyColor, edgeColor, edge);
    material.colorNode = mix(color, fullPower, this.crescentPower);
    // Only the orange cutting edge emits; the green bevel retains real shading.
    const normalGlow = color.mul(edge.mul(0.22).add(0.025));
    const fullPowerGlow = fullPower.mul(edge.mul(0.2).add(0.04));
    material.emissiveNode = mix(normalGlow, fullPowerGlow, this.crescentPower);
    return material;
  }
  private static crescentGeometry() {
    const positions: number[] = [],
      colors: number[] = [],
      indices: number[] = [];
    const rails = [0, 0.12, 0.17, 0.3, 0.46, 0.54, 0.72, 0.83, 0.88, 1];
    const color = new T.Color();
    for (let side = 0; side < 2; side++) {
      for (let i = 0; i <= 64; i++) {
        const angle = -Math.PI / 2 + (i / 64) * Math.PI;
        const y = Math.sin(angle),
          outer = Math.cos(angle);
        // Original band was (outer - oldInner) / 2; retain exactly 3/5.
        const thickness = (outer - 0.45 * (1 - y * y)) * 0.5 * 0.6;
        for (const u of rails) {
          positions.push(
            outer - thickness * u,
            y,
            (side ? -1 : 1) * Math.sin(Math.PI * u) ** 0.7 * outer * (side ? 0.1 : 0.18),
          );
          color.set(
            u <= 0.12 || u >= 0.88
              ? '#ff7608'
              : side
                ? '#073d30'
                : u < 0.3
                  ? '#18694b'
                  : u < 0.54
                    ? '#59a17c'
                    : '#12814f',
          );
          colors.push(color.r, color.g, color.b);
        }
      }
      const offset = side * 65 * rails.length;
      for (let i = 0; i < 64; i++)
        for (let j = 0; j < rails.length - 1; j++) {
          const k = offset + i * rails.length + j,
            n = k + rails.length;
          if (side) indices.push(k, k + 1, n, k + 1, n + 1, n);
          else indices.push(k, n, k + 1, k + 1, n, n + 1);
        }
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }
  /** A faceted core banded by a containment ring - forward along local +X, matching `push`'s angle convention. */
  private static spreadCoreGeometry() {
    const core = new T.OctahedronGeometry(0.55, 0).scale(1.9, 0.62, 0.62);
    const ring = new T.TorusGeometry(0.5, 0.09, 6, 14).toNonIndexed().rotateY(Math.PI / 2);
    const geometry = mergeGeometries([core, ring])!;
    core.dispose();
    ring.dispose();
    return geometry;
  }

  private readonly itemBatches: T.InstancedMesh[] = [];
  private readonly particles: T.InstancedMesh;
  /** Solid rocks in the play field, one body and one outline batch per model. */
  private readonly rockBodies: T.InstancedMesh[] = [];
  private readonly rockRims: T.InstancedMesh[] = [];
  /** Backdrops are created on first entry so startup only loads one sector. */
  private readonly skies: (ReturnType<typeof buildBackdrop> | undefined)[] = [];
  private readonly bosses: BossModel[] = [];
  /** Sparse, indexed by stage - only a stage with a `midBoss` block has one. */
  private readonly midBosses: (BossModel | undefined)[] = [];
  private stage = 0;
  private readonly shieldMesh: T.Mesh;
  private readonly hitDot: T.Mesh;
  private pipeline: T.RenderPipeline | null = null;
  /** The scene pass the pipeline draws through; shaders are compiled for its target. */
  private scenePass: ReturnType<typeof pass> | null = null;
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
  /** Small blasts where shots strike a boss, its pods or a gunship: a hot core and a flare. */
  private readonly hitFire = new T.InstancedMesh(
    new T.SphereGeometry(1, 14, 10),
    new T.MeshBasicNodeMaterial({
      toneMapped: false,
      transparent: true,
      opacity: 0.9,
      blending: T.AdditiveBlending,
      depthWrite: false,
    }),
    IMPACTS * 2,
  );
  /** The NOVA BOMB in flight: airframe, motor flame and a blinking arming lamp. */
  private readonly nova = makeNovaMissile(2.5);
  private readonly novaFlame = new T.Group();
  private readonly novaLamp = new T.Mesh(
    new T.SphereGeometry(1, 12, 8),
    new T.MeshBasicNodeMaterial({ color: '#ff3b2a', toneMapped: false }),
  );
  /**
   * The NOVA BOMB's three-second detonation: a white-out over the whole view,
   * a fireball that swells from white through gold to ember red, three
   * shockwave rings, bursts of fire thrown outward and a rolling smoke pall.
   */
  private readonly novaWhiteout = new T.Mesh(
    new T.PlaneGeometry(1, 1),
    new T.MeshBasicNodeMaterial({
      color: '#fff6e6',
      transparent: true,
      opacity: 0,
      blending: T.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  private readonly novaCore = ThreeBackend.glowSphere(40);
  private readonly novaHalo = ThreeBackend.glowSphere(28);
  private readonly novaRings = [0, 1, 2].map(
    () =>
      new T.Mesh(
        new T.TorusGeometry(1, 0.012, 8, 160),
        new T.MeshBasicNodeMaterial({
          color: '#ffe2b0',
          transparent: true,
          blending: T.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
  );
  private readonly novaFire = ThreeBackend.tintable(
    new T.InstancedMesh(
      new T.SphereGeometry(1, 16, 12),
      new T.MeshBasicNodeMaterial({
        toneMapped: false,
        transparent: true,
        opacity: 0.85,
        blending: T.AdditiveBlending,
        depthWrite: false,
      }),
      48,
    ),
  );
  private readonly novaSmoke = new T.InstancedMesh(
    new T.IcosahedronGeometry(1, 2),
    new T.MeshStandardNodeMaterial({
      color: '#2a2620',
      roughness: 1,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    }),
    24,
  );
  /** Phase of the boss's red damage pulse, advanced at a rate set by its wear. */
  private bossPulse = 0;
  /**
   * Secondary explosions breaking out across a badly damaged boss. Offsets are
   * relative to the boss, so they ride along as it moves.
   */
  private readonly scorch = {
    x: new Float32Array(14),
    y: new Float32Array(14),
    born: new Float32Array(14).fill(-99),
    head: 0,
    due: 0,
  };
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
  /** Eased ship position, normalised to the field, that steers the backdrop view. */
  private readonly look = new T.Vector2();
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
    this.forceWebGL = forceWebGL || this.ios;
    if (this.ios) this.quality = 'MEDIUM';
    this.renderer = this.makeRenderer(this.forceWebGL, !this.ios);
    this.canvas = this.attach();
    this.scene.background = new T.Color('#03060c');
    this.scene.fog = new T.FogExp2('#060d16', 0.003);
    this.scene.add(new T.HemisphereLight('#b9d6eb', '#15161c', 1.65));
    this.keyLight.position.set(-9, 13, 20);
    this.rimLight.position.set(4, -6, -10);
    this.scene.add(this.keyLight, this.rimLight, this.depthScenery.root, this.depthAccents.root);
    this.deferred.push(this.depthAccents.root);
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
    for (const batch of [this.bossFire, this.bossSmoke, this.hitFire, this.crescents]) {
      batch.count = 0;
      batch.frustumCulled = false;
      batch.instanceMatrix.setUsage(T.DynamicDrawUsage);
      this.scene.add(batch);
      this.deferred.push(batch);
    }
    this.scene.add(this.plasmaWhip.root, this.destruction.root);
    this.deferred.push(this.destruction.root);
    this.deferred.push(this.plasmaWhip.root);
    ThreeBackend.tintable(this.bossFire);
    ThreeBackend.tintable(this.hitFire);
    this.bossShockwave.visible = false;
    this.scene.add(this.bossShockwave);
    this.deferred.push(this.bossShockwave);
    this.hiddenUntilUsed.push(this.bossShockwave);
    // One boss model per stage slot, not per unique design - `this.bosses` is
    // indexed positionally by stage index (see `this.bosses[this.stage]`
    // below), so a stage reusing another's design still needs its own entry.
    for (const stage of STAGES) {
      const model = makeBoss(stage.boss.design as BossDesign);
      this.scene.add(model.root, ...model.pods);
      this.deferred.push(model.root, ...model.pods);
      this.bosses.push(model);
      const midBoss = (stage as { midBoss?: { design: string } }).midBoss;
      if (midBoss) {
        const midModel = makeBoss(midBoss.design as BossDesign);
        this.scene.add(midModel.root, ...midModel.pods);
        this.deferred.push(midModel.root, ...midModel.pods);
        this.midBosses[this.bosses.length - 1] = midModel;
      }
    }
    this.showStage(0);
    this.ship.add(...Object.values(this.playerCraft));
    this.scene.add(this.ship);
    // NOVA BOMB: the motor flame trails from the tail toward -X.
    for (const [gain, hex, length, radius] of [
      [0.7, '#ff7a2a', 2.6, 0.34],
      [0.9, '#ffe7a8', 1.2, 0.17],
    ] as const) {
      const cone = new T.Mesh(ThreeBackend.flameGeometry(), ThreeBackend.flameMaterial(gain));
      (cone.material as T.MeshBasicNodeMaterial).color.set(hex).multiplyScalar(1.6);
      cone.scale.set(length, radius, radius);
      cone.userData.length = length;
      this.novaFlame.add(cone);
    }
    this.novaFlame.rotation.z = Math.PI;
    this.novaFlame.position.x = this.nova.tail + 0.05;
    this.novaLamp.scale.setScalar(0.07);
    this.novaLamp.position.set(-this.nova.tail * 0.55, 0, this.nova.radius * 0.6);
    this.nova.root.add(this.novaFlame, this.novaLamp);
    this.novaWhiteout.renderOrder = 1000;
    this.novaWhiteout.frustumCulled = false;
    this.novaCore.renderOrder = this.novaHalo.renderOrder = 60;
    for (const ring of this.novaRings) ring.frustumCulled = false;
    for (const batch of [this.novaFire, this.novaSmoke]) {
      batch.count = 0;
      batch.frustumCulled = false;
      batch.instanceMatrix.setUsage(T.DynamicDrawUsage);
    }
    const novaParts = [
      this.nova.root,
      this.novaWhiteout,
      this.novaCore,
      this.novaHalo,
      ...this.novaRings,
      this.novaFire,
      this.novaSmoke,
    ];
    this.scene.add(...novaParts);
    this.deferred.push(...novaParts);
    this.hiddenUntilUsed.push(...novaParts);

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
    // A maxed-out LASER fires a thick violet beam instead of the usual
    // hairline tracer - reusing the same bolt geometry at a bigger scale
    // (see the MAX_LASER_TINT push below) so the payoff for reaching the
    // weapon's last level is unmistakable at a glance.
    const maxBolt = new T.CapsuleGeometry(1, 4, 3, 6).rotateZ(Math.PI / 2);
    this.maxLaserHalo = batch(
      maxBolt.clone(),
      Object.assign(lit('#9b3fff', 1.3), {
        transparent: true,
        opacity: 0.36,
        blending: T.AdditiveBlending,
        depthWrite: false,
      }),
      256,
      19,
    );
    this.maxLaserCore = batch(maxBolt, lit('#e6cbff', 2.8), 256);
    const ordnance = (
      kind: Parameters<typeof makeOrdnance>[0],
      capacity: number,
      accentOverride?: string,
    ) => {
      const { geometry, material } = makeOrdnance(kind, accentOverride);
      return batch(geometry, material, capacity);
    };
    this.missiles = ordnance('missile-main', 512);
    this.missileExhaust = batch(
      new T.CapsuleGeometry(1, 3, 2, 5).rotateZ(Math.PI / 2),
      Object.assign(lit('#ffb46c', 1.1), {
        transparent: true,
        opacity: 0.22,
        blending: T.AdditiveBlending,
        depthWrite: false,
      }),
      1536,
      18,
    );
    // The same downloaded missile airframe as the player's own KESTREL
    // ordnance, recoloured crimson: a real 3D missile silhouette for hostile
    // homing shots instead of the abstract spinning torus every other
    // hostile shot kind uses, and unmistakably not the player's own orange
    // rounds at a glance.
    this.hostileMissiles = ordnance('missile-main', 384, '#ff2d3f');
    this.hostileMissileExhaust = batch(
      new T.CapsuleGeometry(1, 3, 2, 5).rotateZ(Math.PI / 2),
      Object.assign(lit('#ff5a4d', 1.1), {
        transparent: true,
        opacity: 0.26,
        blending: T.AdditiveBlending,
        depthWrite: false,
      }),
      1152,
      18,
    );
    // A maxed-out MISSILE fires a much bigger, magenta-hot round; a maxed-out
    // SPREAD's own shots (not the drones') double in size and turn amber -
    // both reuse the same downloaded models/geometry as their normal fire,
    // just bigger and recoloured (see MAX_MISSILE_TINT/MAX_SPREAD_TINT).
    this.maxMissiles = ordnance('missile-main', 256, '#ff2ec4');
    this.maxMissileExhaust = batch(
      new T.CapsuleGeometry(1, 3, 2, 5).rotateZ(Math.PI / 2),
      Object.assign(lit('#ff6be0', 1.2), {
        transparent: true,
        opacity: 0.28,
        blending: T.AdditiveBlending,
        depthWrite: false,
      }),
      768,
      18,
    );
    this.scatter = ordnance('spread-main', 1024);
    this.maxScatter = ordnance('spread-main', 384, '#ffcf3d');
    const pulse = new T.SphereGeometry(1, 10, 8);
    this.optionHalo = batch(
      pulse.clone(),
      Object.assign(lit('#19e39a', 1.4), {
        transparent: true,
        opacity: 0.38,
        blending: T.AdditiveBlending,
        depthWrite: false,
      }),
      1024,
      18,
    );
    this.optionCore = batch(pulse, lit('#dcfff0', 2.8), 1024);
    this.optionMissiles = ordnance('missile-option', 512);
    this.optionExhaust = batch(
      new T.CapsuleGeometry(1, 3, 2, 5).rotateZ(Math.PI / 2),
      Object.assign(lit('#b35cff', 1.2), {
        transparent: true,
        opacity: 0.26,
        blending: T.AdditiveBlending,
        depthWrite: false,
      }),
      1536,
      18,
    );
    this.optionScatter = ordnance('spread-option', 1024);
    // A faceted crystal core banded by a containment ring - a fresh
    // procedural silhouette (not a recolour of the downloaded spread-main
    // pellet) so the one heavy round riding down the centre of every SPREAD
    // volley reads as a different kind of ordnance, not just a bigger one.
    this.spreadCore = batch(ThreeBackend.spreadCoreGeometry(), lit('#ff3d6b', 2.4), 128);
    this.spreadCoreExhaust = batch(
      new T.CapsuleGeometry(1, 3, 2, 5).rotateZ(Math.PI / 2),
      Object.assign(lit('#ff88ab', 1.2), {
        transparent: true,
        opacity: 0.3,
        blending: T.AdditiveBlending,
        depthWrite: false,
      }),
      384,
      18,
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
    let largeAccentIndex = 0;
    for (let i = 0; i < ENEMY_TYPES; i++) {
      const parts = enemyGeometry(i);
      const material = hullMaterial.clone();
      material.map = parts.map ?? null;
      const large = fleetHardpoints[i].size === 'large';
      finishHull(
        material,
        parts.surface ?? null,
        undefined,
        large ? LARGE_ACCENT[largeAccentIndex++ % LARGE_ACCENT.length] : undefined,
      );
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
      // Turrets and tanks: sector paint over a scanned metal finish.
      const hull = new T.InstancedMesh(parts.hull!, groundUnitMaterial(i), 64);
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
    // A flame is an open cone with its wide mouth on the nozzle and its tip
    // trailing behind. It fades along its length and toward its silhouette,
    // so under additive blending it reads as a soft glow, not a solid shape.
    const flame = (gain: number) => {
      const mesh = new T.InstancedMesh(
        ThreeBackend.flameGeometry(),
        ThreeBackend.flameMaterial(gain),
        256 * 3,
      );
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      ThreeBackend.tintable(mesh);
      this.deferred.push(mesh);
      this.scene.add(mesh);
      return mesh;
    };
    this.exhaustPlume = flame(0.55);
    this.exhaustCore = flame(0.85);
    // Exhaust hues spread around the wheel; stepping by five keeps
    // neighbouring hull types from burning the same colour.
    const hues = [
      '#4fb6ff',
      '#8a7dff',
      '#ff6fd0',
      '#ff9a3c',
      '#3fe3c0',
      '#ff5a4a',
      '#ffd35a',
      '#6ce4ff',
    ];
    for (let i = 0; i < ENEMY_TYPES; i++)
      this.exhaustTint.push(new T.Color(hues[(i * 5) % hues.length]));
    this.enemyCores.count = 0;
    this.enemyCores.frustumCulled = false;
    this.enemyCores.instanceMatrix.setUsage(T.DynamicDrawUsage);
    ThreeBackend.tintable(this.enemyCores);
    this.deferred.push(this.enemyCores);
    this.scene.add(this.enemyCores);

    for (let i = 0; i < 5; i++) {
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
    }
    // One instanced batch per pickup type (PICKUP_SAMPLES.length in
    // Runtime.ts), unrelated to how many options a ship can carry - only
    // coincidentally the same count (4) before options went to 5.
    for (let i = 0; i < 6; i++) {
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
    for (let v = 0; v < HAZARD_VARIANTS; v++) {
      const rock = hazardRock(v);
      const body = new T.InstancedMesh(rock.geometry, rock.body, tuning.pools.rocks);
      const rim = new T.InstancedMesh(rock.geometry, rock.rim, tuning.pools.rocks);
      for (const mesh of [body, rim]) {
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
        ThreeBackend.tintable(mesh);
        this.deferred.push(mesh);
        this.scene.add(mesh);
      }
      this.rockBodies.push(body);
      this.rockRims.push(rim);
    }
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
    canvas.setAttribute('aria-label', t('COMBAT_CANVAS_LABEL'));
    this.host.appendChild(canvas);
    return canvas;
  }
  /** Reveals one stage's backdrop and boss, hiding every other. */
  private showStage(index: number) {
    this.stage = Math.max(0, Math.min(index, STAGES.length - 1));
    if (!this.skies[this.stage]) {
      this.skies[this.stage] = buildBackdrop(
        this.scene,
        (STAGES[this.stage]?.scene as SceneName) ?? 'earth',
        STAGES[this.stage]?.surface ?? null,
      );
    }
    for (let i = 0; i < this.skies.length; i++) {
      const sky = this.skies[i];
      if (sky) sky.root.visible = i === this.stage;
    }
    for (let i = 0; i < this.bosses.length; i++) {
      const active = i === this.stage;
      this.bosses[i].root.visible = false;
      for (const pod of this.bosses[i].pods) pod.visible = active && pod.visible;
      const midBoss = this.midBosses[i];
      if (midBoss) {
        midBoss.root.visible = false;
        for (const pod of midBoss.pods) pod.visible = active && pod.visible;
      }
    }
    // A stage can request its own camera span (see resize()); re-derive it
    // now rather than waiting for the next window resize.
    this.resize();
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
    this.lightHulls();
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    // iOS draws directly to the canvas: avoid HDR/MSAA and bloom render targets.
    if (!this.ios) {
      const scenePass = pass(this.scene, this.camera);
      this.scenePass = scenePass;
      // What the pass would only settle on its first frame: without it the
      // compile below targets a different buffer and the first frame redoes it.
      scenePass.renderTarget.samples = this.renderer.samples;
      scenePass.renderTarget.texture.type = this.renderer.getOutputBufferType();
      const output = scenePass.getTextureNode('output');
      this.bloomNode = bloom(output, 0.3, 0.35, 1.15);
      this.bloomNode.setResolutionScale(0.5);
      this.pipeline = new T.RenderPipeline(this.renderer);
      this.pipeline.outputNode = output.add(this.bloomNode);
    }
    // `compileAsync` walks the visible scene, so the hangar only pays for what
    // the hangar draws.
    const held = this.deferred.filter((o) => o.visible);
    for (const o of held) o.visible = false;
    try {
      if (this.failFirstBoot) {
        this.failFirstBoot = false;
        throw new Error('forced renderer failure (?rendererfail)');
      }
      await this.compileForPass(this.scene);
    } finally {
      for (const o of held) o.visible = true;
    }
  }
  /**
   * Gives every hull a reflection environment: a dark studio with a warm key
   * panel above, a cool rim strip below and a faint blue horizon, matching the
   * scene's lights. Plating now carries highlights and gradients across its
   * curves instead of flat, unlit colour. Built per renderer, since a WebGL
   * fallback cannot use textures made on the failed WebGPU device.
   */
  private lightHulls() {
    const studio = new T.Scene();
    studio.background = new T.Color('#040609');
    const panel = (
      w: number,
      h: number,
      hex: string,
      gain: number,
      x: number,
      y: number,
      z: number,
    ) => {
      const mesh = new T.Mesh(
        new T.PlaneGeometry(w, h),
        new T.MeshBasicNodeMaterial({
          color: new T.Color(hex).multiplyScalar(gain),
          side: T.DoubleSide,
        }),
      );
      mesh.position.set(x, y, z);
      mesh.lookAt(0, 0, 0);
      studio.add(mesh);
    };
    panel(9, 4, '#fff1dc', 5, -6, 9, 7);
    panel(5, 5, '#dff0ff', 2.2, 8, 4, 8);
    panel(14, 2.2, '#5fa6ff', 2.4, 3, -8, -5);
    panel(3, 12, '#a8c8ff', 1.2, -10, 0, -6);
    const horizon = new T.Mesh(
      new T.TorusGeometry(12, 0.6, 8, 64),
      new T.MeshBasicNodeMaterial({ color: new T.Color('#24476e').multiplyScalar(0.8) }),
    );
    horizon.rotation.x = Math.PI / 2;
    studio.add(horizon);
    const pmrem = new T.PMREMGenerator(this.renderer);
    const environment = pmrem.fromScene(studio, 0.02).texture;
    this.reflectionEnvironment?.dispose();
    this.reflectionEnvironment = environment;
    this.scene.environment = environment;
    this.scene.environmentIntensity = 0.32;
    pmrem.dispose();
    studio.traverse((o) => {
      const mesh = o as T.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      (mesh.material as T.Material).dispose();
    });
    for (const material of HULL_MATERIALS) {
      material.envMap = environment;
      material.envMapIntensity = 0.9;
      material.needsUpdate = true;
    }
  }
  /**
   * Compiles `object` for the scene pass's render target - where every frame is
   * actually drawn - rather than the canvas, with the scene's lights. `compileAsync`
   * itself compiles in the background across several real frames, so the target
   * has to stay pointed at the offscreen pass for its whole duration: restoring
   * it as soon as the call is made (rather than once its promise settles) let
   * its still-pending internal work land on the visible canvas instead.
   */
  private async compileForPass(object: T.Object3D) {
    const previous = this.renderer.getRenderTarget();
    if (this.scenePass) this.renderer.setRenderTarget(this.scenePass.renderTarget);
    try {
      await this.renderer.compileAsync(object, this.camera, this.scene);
    } finally {
      this.renderer.setRenderTarget(previous);
    }
  }
  /**
   * Compiles combat shaders behind the hangar rather than in front of it, one
   * top-level scene object at a time with a yield in between so the hangar
   * (or an active flight) keeps drawing while this runs - a single pass over
   * the whole scene held the page for seconds. Large hulls go first - Stage 1
   * can put one on screen within its first minute, far sooner than a boss
   * ever appears - then boss hulls and the models that appear all at once
   * (boss death shockwave, NOVA BOMB), so all of them are ready long before
   * they are needed.
   */
  async warmup() {
    if (this.ios || this.disposed) return;
    const first = [
      ...this.enemyHulls.filter((_, i) => fleetHardpoints[i]?.size === 'large'),
      ...this.enemyAccents.filter(
        (accent, i): accent is T.InstancedMesh => !!accent && fleetHardpoints[i]?.size === 'large',
      ),
      ...this.bosses.flatMap((boss) => [boss.root, ...boss.pods]),
      ...this.midBosses.flatMap((boss) => (boss ? [boss.root, ...boss.pods] : [])),
      ...this.hiddenUntilUsed,
    ];
    const rest = this.scene.children.filter((object) => !first.includes(object));
    for (const object of [...first, ...rest]) {
      if (this.disposed) return;
      // A flight in progress draws every frame from this same scene; compiling
      // into it concurrently has shown a one-frame flash of whatever's being
      // compiled, so this waits out combat rather than racing it.
      while (this.combatActive) {
        if (this.disposed) return;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      await this.compileShown(object);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  /**
   * Compiles `target` as though all of it were on screen. `compileAsync`
   * skips hidden and frustum-culled objects, so everything under `target` is
   * shown and unculled for the synchronous traversal it starts with - the
   * queued work holds its own object references - and restored before the
   * next frame can draw any of it.
   */
  private async compileShown(target: T.Object3D) {
    const objects: T.Object3D[] = [];
    const flags: boolean[] = [];
    target.traverse((o) => {
      objects.push(o);
      flags.push(o.visible, o.frustumCulled);
      o.visible = true;
      o.frustumCulled = false;
    });
    // A separate counter from `warmingUp`: `prepareStage()` treats a nonzero
    // `warmingUp` as itself already running and rejects a second launch, but
    // this background compile can be mid-flight at that exact moment on
    // every ordinary launch (see `warmup()`) and must not trip that guard.
    this.compiling++;
    try {
      await this.compileForPass(target);
    } finally {
      for (let i = 0; i < objects.length; i++) {
        objects[i].visible = flags[i * 2];
        objects[i].frustumCulled = flags[i * 2 + 1];
      }
      this.compiling--;
    }
  }
  /**
   * Awaited before GameState.start(), including immediate launch and stage
   * transitions. `onProgress` reports 0..1 across model download and texture
   * decode, for a loading indicator.
   *
   * This used to also run an exclusive `compileAsync` + upload-render pass
   * over every combat mesh (all 54 enemy and 12 ground hull types' unique
   * materials) before returning, to pre-warm GPU pipelines and avoid a
   * mid-combat compile stutter. In practice that pass could take well over a
   * minute on real hardware - turning an occasional first-encounter hitch
   * into a multi-minute unresponsive "preparing mission" screen on every
   * single launch. An instant launch beats a pre-warmed pipeline, so this
   * step only loads what's actually necessary to render correctly (scenery
   * models and their textures); combat shaders now compile lazily on first
   * use during play, same as any ordinary Three.js scene.
   */
  async prepareStage(index: number, onProgress?: (fraction: number) => void) {
    if (this.disposed) throw new Error('Renderer disposed');
    const previousStage = this.stage;
    if (this.warmingUp) throw new Error('Mission preparation already in progress');
    this.showStage(index);
    if (this.preparedStages.has(this.stage)) {
      onProgress?.(1);
      return;
    }
    this.warmingUp++;
    try {
      await this.depthScenery.prepareStage(this.stage, (f) => onProgress?.(f * 0.6));
      await waitForSceneAssets((f) => onProgress?.(0.6 + f * 0.4));
      if (this.disposed) throw new Error('Renderer disposed');
      // Additive, depth-read-only effects are order independent: both faces
      // can share a single draw. Avoid the renderer switching shared flame/
      // shockwave materials between front/back variants on first use.
      this.scene.traverse((object) => {
        const mesh = object as T.Mesh;
        if (!mesh.isMesh) return;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (
            material.side === T.DoubleSide &&
            material.blending === T.AdditiveBlending &&
            !material.depthWrite
          )
            material.forceSinglePass = true;
        }
      });
      this.preparedStages.add(this.stage);
      onProgress?.(1);
    } catch (error) {
      if (!this.disposed) this.showStage(previousStage);
      throw error;
    } finally {
      this.warmingUp--;
      if (!this.disposed) this.resize();
      // Only this pass's own listener should ever drive it; never leave a
      // stale callback attached for the next call to invoke unexpectedly.
      waitForSceneAssets();
    }
  }
  resize() {
    if (this.warmingUp || this.compiling) return;
    const w = Math.max(1, this.host.clientWidth),
      h = Math.max(1, this.host.clientHeight);
    this.camera.aspect = w / h;
    // 32 is a reference visible span (world units) most stages fly at; a
    // stage can pull the camera back further by setting its own
    // `cameraHeight` (e.g. a taller arena that needs to stay fully on
    // screen). Read loosely rather than widening StageDef, since only a
    // stage that opts in carries the field.
    const span = (STAGES[this.stage] as { cameraHeight?: number } | undefined)?.cameraHeight ?? 32;
    const height = Math.max(18, span / this.camera.aspect);
    this.camera.position.set(0, 0, height / 2 / Math.tan(Math.PI / 12));
    this.camera.updateProjectionMatrix();
    const scale = this.quality === 'HIGH' ? 1 : this.quality === 'MEDIUM' ? 0.85 : 0.7;
    // Sharp hull textures need the full device resolution on HIGH; lower tiers trade it for speed.
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, this.ios ? 1 : this.quality === 'HIGH' ? 2 : 1.75) * scale,
    );
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
  /** An open cone, wide mouth at the origin, tip one unit along +X. */
  private static flameGeometry() {
    return new T.ConeGeometry(1, 1, 18, 1, true).rotateZ(-Math.PI / 2).translate(0.5, 0, 0);
  }
  /** Fades along the cone and toward its silhouette: a soft additive glow, not a solid. */
  private static flameMaterial(gain: number) {
    const material = new T.MeshBasicNodeMaterial({
      transparent: true,
      blending: T.AdditiveBlending,
      depthWrite: false,
      side: T.DoubleSide,
      toneMapped: false,
    });
    const along = float(1).sub(positionGeometry.x.clamp(0, 1)).pow(1.4);
    const edge = normalView.dot(positionViewDirection).abs().pow(1.3);
    material.opacityNode = along.mul(edge).mul(gain);
    return material;
  }
  /** An additive sphere whose edge falls off softly, for fireballs and halos. */
  private static glowSphere(segments: number) {
    const material = new T.MeshBasicNodeMaterial({
      transparent: true,
      blending: T.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    material.opacityNode = normalView.dot(positionViewDirection).abs().pow(1.6);
    return new T.Mesh(new T.SphereGeometry(1, segments, Math.round(segments * 0.7)), material);
  }
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
    roll = 0,
  ) {
    this.dummy.position.set(x, y, z);
    // Roll about the local X axis first, then turn in the screen plane.
    this.dummy.rotation.set(roll, 0, angle, 'ZXY');
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
    roll = 0,
  ) {
    if (batch.count >= batch.instanceMatrix.count) return;
    this.set(batch.count++, batch, x, y, z, sx, sy, sz, angle, roll);
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
    // An empty batch is never drawn. That holds before the warm-up as well:
    // the warm-up shows each object itself while it compiles, so leaving empty
    // batches visible only made the first frames compile them synchronously.
    batch.visible = used;
    if (!used) return;
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
    this.crescents.count = 0;
    this.crescentPower.value = g.specialWeapon === 'CRESCENT' && g.specialLevel >= 8 ? 1 : 0;
    this.plasmaWhip.update(
      g.whipX,
      g.whipY,
      specialStats(g.weapon, g.specialLevel).width,
      g.time,
      g.whipActive && !g.respawn && g.status === 'playing',
      g.specialWeapon === 'PLASMA' && g.specialLevel >= 8,
    );
    const p = g.bullets,
      t = this.visualTime;
    for (let i = 0; i < p.capacity; i++) {
      if (!p.active[i]) continue;
      const x = p.px[i] + (p.x[i] - p.px[i]) * alpha,
        y = p.py[i] + (p.y[i] - p.py[i]) * alpha,
        r = p.radius[i],
        aim = Math.atan2(p.vy[i], p.vx[i]);
      switch (p.type[i]) {
        case 7:
          // SPREAD's heavy centre round: a slow tumble sells the extra mass
          // a plain forward-facing bolt wouldn't read at this speed.
          this.push(
            this.spreadCoreExhaust,
            x - Math.cos(aim) * r * 3.4,
            y - Math.sin(aim) * r * 3.4,
            0.12,
            r * 1.4,
            r * 0.32,
            r * 0.32,
            aim,
          );
          this.push(this.spreadCore, x, y, 0.15, r, r, r, aim, t * 6 + p.age[i] * 4);
          break;
        case 6:
          this.push(this.crescents, x, y, 0.2, r, r, r, aim, 0.12);
          break;
        case 1: {
          const k = p.kind[i];
          if (k === Shot.HOMING) {
            // A real missile silhouette (see hostileMissiles above) instead
            // of the abstract spinning torus every other hostile kind uses -
            // this is the one hostile shot the player has to actively dodge
            // rather than just weave through, so it gets to read as clearly
            // "incoming ordnance" at a glance.
            for (let tail = 1; tail <= 3; tail++) {
              const distance = r * (2 + tail * 2.2);
              this.push(
                this.hostileMissileExhaust,
                x - Math.cos(aim) * distance,
                y - Math.sin(aim) * distance,
                0.12,
                r * 1.3,
                r * (0.48 - tail * 0.1),
                r * 0.3,
                aim,
              );
            }
            this.push(this.hostileMissiles, x, y, 0.15, r * 1.7, r * 1.7, r * 1.7, aim);
            break;
          }
          const s = this.shotStyle[k],
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
        case 2: {
          const drone = p.option[i] === 1;
          // A maxed-out MISSILE's own shots (never a drone's) fly 3x the
          // usual size in hot magenta instead of the ship's usual orange.
          const maxed = p.tint[i] === MAX_MISSILE_TINT;
          const exhaust = drone
            ? this.optionExhaust
            : maxed
              ? this.maxMissileExhaust
              : this.missileExhaust;
          const bodyScale = drone ? 1.1 : maxed ? 4.65 : 1.55;
          for (let tail = 1; tail <= 3; tail++) {
            const distance = r * (2 + tail * 2.2) * (maxed ? 1.6 : 1);
            this.push(
              exhaust,
              x - Math.cos(aim) * distance,
              y - Math.sin(aim) * distance,
              0.12,
              r * 1.3 * (maxed ? 1.8 : 1),
              r * (0.48 - tail * 0.1) * (maxed ? 1.8 : 1),
              r * 0.3 * (maxed ? 1.8 : 1),
              aim,
            );
          }
          // A drone's micro-missile is slimmer than the ship's own.
          this.push(
            drone ? this.optionMissiles : maxed ? this.maxMissiles : this.missiles,
            x,
            y,
            0.15,
            r * bodyScale,
            r * bodyScale,
            r * bodyScale,
            aim,
          );
          break;
        }
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
          if (p.tint[i] === 0xbca8ff || p.tint[i] === MAX_SPREAD_TINT) {
            // A maxed-out SPREAD's own shots (never a drone's, so this only
            // ever applies when option is 0) double in size and turn amber.
            const maxed = p.tint[i] === MAX_SPREAD_TINT;
            const bodyScale = p.option[i] === 1 ? 1 : maxed ? 2 : 1;
            if (p.option[i] === 1)
              this.push(this.optionScatter, x, y, 0.15, r * 1.3, r * 0.9, r * 0.9, aim);
            else
              this.push(
                maxed ? this.maxScatter : this.scatter,
                x,
                y,
                0.15,
                r * 1.85 * bodyScale,
                r * 1.3 * bodyScale,
                r * 1.3 * bodyScale,
                aim,
              );
            this.push(
              p.option[i] === 1 ? this.optionExhaust : this.missileExhaust,
              x - Math.cos(aim) * r * 4,
              y - Math.sin(aim) * r * 4,
              0.12,
              r,
              r * 0.22,
              r * 0.22,
              aim,
            );
            break;
          }
          if (p.option[i] === 1) {
            // Drone laser: a round, throbbing pulse rather than a long tracer.
            const throb = 1 + Math.sin(t * 30 + i) * 0.15;
            this.push(this.optionCore, x, y, 0.15, r * 1.25, r * 0.7, r * 0.7, aim);
            this.push(this.optionHalo, x, y, 0.14, r * 2.3 * throb, r * 1.45 * throb, r * 1.2, aim);
            break;
          }
          if (p.tint[i] === MAX_LASER_TINT) {
            // A maxed-out LASER's own shot: a thick violet beam instead of
            // the usual hairline tracer.
            this.push(this.maxLaserCore, x, y, 0.15, r * 2.6, r * 0.95, r * 0.95, aim);
            this.push(this.maxLaserHalo, x, y, 0.14, r * 3.6, r * 2, r * 2, aim);
            break;
          }
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
    this.exhaustPlume.count = this.exhaustCore.count = 0;
    for (let i = 0; i < e.capacity; i++) {
      if (!e.active[i]) continue;
      const type = e.type[i],
        hull = this.enemyHulls[type];
      if (!hull) continue;
      const x = e.px[i] + (e.x[i] - e.px[i]) * alpha,
        y = e.py[i] + (e.y[i] - e.py[i]) * alpha;
      // SPINNER and TEMPEST read as rotors; the rest just bank as they weave.
      // Nose and roll follow the weave: top plating shows on the climb,
      // the underside on the dive.
      const angle = enemyRotation(type, e.age[i], g.time) + g.enemyPitch[i],
        bank = g.enemyBank[i];
      const slot = hull.count;
      this.push(hull, x, y, 0, 1, 1, 1, angle, bank);
      // instanceColor multiplies the baked hull colours, so a hit reads as the
      // whole airframe flaring white for a frame or two. A large hull's own
      // plating also darkens toward a scorched red as its HP runs out - it
      // soaks up several times a medium's damage, so a player needs a read on
      // how close it is without watching a health bar.
      if (hull.count > slot) {
        const flash = g.enemyFlash[i];
        if (flash > 0) {
          const flare = 1 + flash * 26;
          this.tint.setRGB(flare, flare, flare);
          hull.setColorAt(slot, this.tint);
        } else if (fleetHardpoints[type].size === 'large') {
          const worn = 1 - T.MathUtils.clamp(e.hp[i] / (g.enemySpawnHp[i] || e.hp[i]), 0, 1);
          this.tint.setRGB(1, 1 - worn * 0.55, 1 - worn * 0.72);
          hull.setColorAt(slot, this.tint);
        } else hull.setColorAt(slot, this.white);
      }
      const accent = this.enemyAccents[type];
      if (accent) this.push(accent, x, y, 0, 1, 1, 1, angle, bank);
      // Burners on each engine bell, turned with the hull. Faster ships burn
      // longer, and every flame flutters on its own phase.
      const thrust = 0.85 + Math.min(0.45, Math.abs(e.vx[i]) / 10);
      const engines = fleetHardpoints[type].engines;
      for (let k = 0; k < engines.length; k++) {
        const [ex, ey, ez, r] = engines[k];
        const ly = ey * Math.cos(bank) - ez * Math.sin(bank),
          lz = ey * Math.sin(bank) + ez * Math.cos(bank);
        const fx = x + ex * Math.cos(angle) - ly * Math.sin(angle),
          fy = y + ex * Math.sin(angle) + ly * Math.cos(angle);
        const flutter =
          1 + Math.sin(t * 33 + i * 1.3 + k * 2.1) * 0.14 + Math.sin(t * 71 + i * 0.7 + k) * 0.07;
        const tint = this.exhaustTint[type];
        let index = this.exhaustPlume.count;
        const plume = r * 1.05;
        this.push(
          this.exhaustPlume,
          fx,
          fy,
          lz,
          r * 7 * thrust * flutter,
          plume,
          plume,
          angle,
          bank,
        );
        if (this.exhaustPlume.count > index)
          this.exhaustPlume.setColorAt(index, this.tint.copy(tint).multiplyScalar(1.2));
        index = this.exhaustCore.count;
        const hot = r * 0.5;
        this.push(this.exhaustCore, fx, fy, lz, r * 3.2 * flutter, hot, hot, angle, bank);
        if (this.exhaustCore.count > index)
          this.exhaustCore.setColorAt(
            index,
            this.tint.copy(tint).lerp(this.white, 0.6).multiplyScalar(1.7),
          );
      }
      const core = ENEMY_CORE[type];
      // The charge lamp swells and breathes before a salvo. A fast strobe here
      // read as the whole airframe shaking.
      const pulse = g.enemyTelegraph(i) ? 1.9 + Math.sin(t * 9) * 0.25 : 1;
      const coreY = core.y * Math.cos(bank) - core.z * Math.sin(bank),
        coreZ = core.y * Math.sin(bank) + core.z * Math.cos(bank);
      if (this.enemyCores.count < this.enemyCores.instanceMatrix.count) {
        const idx = this.enemyCores.count;
        this.push(
          this.enemyCores,
          x + core.x * Math.cos(angle) - coreY * Math.sin(angle),
          y + core.x * Math.sin(angle) + coreY * Math.cos(angle),
          coreZ,
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
    this.commit(this.exhaustPlume);
    this.commit(this.exhaustCore);
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
      // A roof unit is the floor model turned over about its nose axis, so it
      // still faces the player and hangs from the ceiling by its dorsal line.
      const flip = p.aux[i] === 1 ? -1 : 1;
      const slot = hull.count;
      this.push(hull, x, y, 0, 1, flip, flip);
      if (hull.count > slot) {
        const flash = g.groundFlash[i];
        if (flash > 0) {
          const flare = 1 + flash * 26;
          this.tint.setRGB(flare, flare, flare);
        } else this.tint.copy(this.white);
        hull.setColorAt(slot, this.tint);
      }
      const accent = this.groundAccents[type];
      if (accent) this.push(accent, x, y, 0, 1, flip, flip);
      const core = GROUND_CORE[type];
      const pulse = g.groundTelegraph(i) ? 2 + Math.sin(t * 50) * 0.9 : 1;
      if (this.groundCores.count < this.groundCores.instanceMatrix.count) {
        const idx = this.groundCores.count;
        this.push(
          this.groundCores,
          x + core.x,
          y + core.y * flip,
          core.z * flip,
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
  /**
   * Rocks tumble in 3D, so they bypass `push` and its single spin axis. The
   * outline pulses slowly and flares on a hit.
   */
  private syncRocks(g: Readonly<GameState>, alpha: number) {
    const r = g.rocks,
      t = this.visualTime;
    for (const b of this.rockBodies) b.count = 0;
    for (const b of this.rockRims) b.count = 0;
    for (let i = 0; i < r.capacity; i++) {
      if (!r.active[i]) continue;
      const body = this.rockBodies[r.type[i] % HAZARD_VARIANTS],
        rim = this.rockRims[r.type[i] % HAZARD_VARIANTS];
      if (body.count >= body.instanceMatrix.count) continue;
      const x = r.px[i] + (r.x[i] - r.px[i]) * alpha,
        y = r.py[i] + (r.y[i] - r.py[i]) * alpha,
        s = r.radius[i],
        seed = r.aux[i] * 2.39996,
        age = r.age[i];
      this.dummy.position.set(x, y, 0);
      this.dummy.rotation.set(seed + age * 0.7, seed * 1.7 + age * 0.45, seed * 0.6 + age * 0.3);
      this.dummy.scale.setScalar(s);
      this.dummy.updateMatrix();
      const slot = body.count++;
      body.setMatrixAt(slot, this.dummy.matrix);
      const flash = g.rockFlash[i];
      this.tint.setScalar(flash > 0 ? 1 + flash * 20 : 1);
      body.setColorAt(slot, this.tint);
      this.dummy.scale.setScalar(s * 1.1);
      this.dummy.updateMatrix();
      rim.count++;
      rim.setMatrixAt(slot, this.dummy.matrix);
      this.tint.setScalar((0.8 + Math.sin(t * 5 + seed) * 0.2) * (flash > 0 ? 1.8 : 1));
      rim.setColorAt(slot, this.tint);
    }
    for (const b of this.rockBodies) this.commit(b);
    for (const b of this.rockRims) this.commit(b);
  }
  sync(g: Readonly<GameState>, alpha: number, dt: number) {
    if (this.warmingUp || this.compiling) return;
    this.visualTime += dt;
    const t = this.visualTime;
    const inactive = g.status === 'menu';
    this.combatActive = !inactive;
    if (g.stageIndex !== this.stage) this.showStage(g.stageIndex);
    // The backdrop is framed by where the ship flies: diving low tilts the
    // view down toward the planet below, climbing lifts it to open sky.
    const range = STAGES[this.stage]
      ? Math.max(1, (STAGES[this.stage].maxY - STAGES[this.stage].minY) / 2)
      : 7.2;
    const lookX = inactive ? 0 : T.MathUtils.clamp(g.x / 13, -1, 1);
    const lookY = inactive ? 0 : T.MathUtils.clamp(g.y / range, -1, 1);
    const ease = 1 - Math.exp(-dt * (this.reducedMotion ? 1.5 : 3.2));
    this.look.x += (lookX - this.look.x) * ease;
    this.look.y += (lookY - this.look.y) * ease;
    this.skies[this.stage]!.update(
      t,
      inactive ? 0.4 : this.reducedMotion ? 0.5 : 1,
      this.look.x,
      this.look.y * (this.reducedMotion ? 0.5 : 1),
      this.camera.position.z,
      T.MathUtils.clamp(g.time / g.stage.durationSec, 0, 1),
      this.host.clientHeight,
      this.camera.fov,
    );
    const halfHeight = this.camera.position.z * Math.tan(T.MathUtils.degToRad(this.camera.fov / 2));
    this.depthScenery.update(
      t,
      this.stage,
      halfHeight * this.camera.aspect,
      halfHeight,
      this.camera.position.z,
      g.cameraFollowY,
      this.look.x,
      this.look.y,
      this.quality,
      this.reducedMotion,
      !inactive,
      g.terrain ?? undefined,
      g.scroll,
      g.time / g.stage.durationSec,
    );
    this.depthAccents.update(g, t, this.quality === 'LOW', this.reducedMotion);
    const palette = SECTOR_LIGHT[this.stage];
    this.keyLight.color.set(palette.key);
    this.rimLight.color.set(palette.fill);
    this.keyLight.position.set(-9 + Math.sin(t * 0.06) * 2, 13 + g.cameraFollowY, 20);
    this.rimLight.position.y = -6 + g.cameraFollowY;
    (this.scene.fog as T.FogExp2).color.set(palette.haze);
    if (inactive) {
      // The title screen frames the ship above the sector selector.
      this.ship.position.set(3.2, 0.85 + Math.sin(t * 0.6) * 0.2, 0);
      this.ship.scale.setScalar(3.25);
      this.ship.rotation.set(-0.36 + Math.sin(t * 0.3) * 0.025, -0.08, 0.2);
      this.ship.visible = true;
    } else {
      this.ship.position.set(
        g.previousX + (g.x - g.previousX) * alpha,
        g.previousY + (g.y - g.previousY) * alpha,
        0,
      );
      this.ship.scale.setScalar(0.7);
      // Roll about the nose: climbing turns the canopy and dorsal plating to
      // the camera, diving shows the ventral keel and underside panels.
      this.ship.rotation.set(-g.roll * 0.72, g.pitch * 0.13, g.pitch * 0.3, 'ZXY');
      this.ship.visible =
        g.respawn <= 0 &&
        (g.effects[0] > 0 || g.invincible <= 0 || Math.floor(g.time * 15) % 2 === 0);
    }
    for (const [weapon, craft] of Object.entries(this.playerCraft)) {
      craft.visible = weapon === g.weapon;
    }
    animateShip(
      this.playerCraft[g.weapon],
      t,
      inactive ? 0.35 : Math.min(1, Math.abs(g.roll) + Math.abs(g.pitch)),
    );
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
    this.syncRocks(g, alpha);
    // The surface is periodic, so scrolling it is one translation.
    const surface = this.skies[this.stage]!.ground;
    if (surface) {
      const shift = -(g.scroll % surface.span);
      surface.mesh.position.x = shift;
      if (surface.roof) surface.roof.position.x = shift;
    }
    this.commit(this.crescents);
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
    for (let i = 0; i < 5; i++) {
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
    // Whichever boss is actually fighting - the mid-boss model while g.midBoss
    // is up, the real (final) one otherwise. The other stays forced hidden so
    // a stale visible flag from its own last active frame can't linger.
    const model = (g.midBoss ? this.midBosses[this.stage] : undefined) ?? this.bosses[this.stage];
    const inactiveBoss = g.midBoss ? this.bosses[this.stage] : this.midBosses[this.stage];
    if (inactiveBoss) inactiveBoss.root.visible = false;
    const active = g.boss || g.midBoss;
    model.root.visible = active && (!g.bossDying || g.bossDeathTime < 6.65);
    model.root.position.set(g.bossX, g.bossY, 0);
    model.root.rotation.z = g.bossDying
      ? Math.sin(t * 27) * 0.012 * g.bossDeathTime
      : Math.sin(t * 0.48) * 0.009;
    model.ring.rotation.z = g.bossAngle;
    model.core.rotation.set(0, 0, t * 0.3);
    model.core.scale.setScalar(g.bossShot < 0.4 ? 1.1 + Math.sin(t * 35) * 0.08 : 1);
    for (let i = 0; i < model.pods.length; i++) {
      const pod = model.pods[i];
      pod.visible =
        active &&
        i < g.bossParts &&
        g.partHp[i] > 0 &&
        (!g.bossDying || g.bossDeathTime < 2.4 + i * 0.35);
      pod.position.set(g.partX[i], g.partY[i], 0.4);
      pod.rotation.z = Math.sin(t * 1.4 + i) * 0.08;
      if (g.bossDying) {
        const age = Math.max(0, g.bossDeathTime - (1.1 + i * 0.35));
        const angle = i * 2.399963;
        pod.position.x += Math.cos(angle) * age * 2;
        pod.position.y += Math.sin(angle) * age * 2 - age * age * 0.7;
        pod.position.z += age * 0.4;
        pod.rotation.set(age * 1.6, age, angle * age);
      } else pod.rotation.set(0, 0, Math.sin(t * 1.4 + i) * 0.08);
      // Each pod burns its own red glow from its own remaining armour, plus a
      // quick flash on a fresh hit - a pod near death reads as such on its
      // own instead of only the shared hull-wide pulse saying so.
      const podDamage = model.podDamage?.[i];
      if (podDamage) {
        const podWear =
          active && g.partHp[i] > 0
            ? T.MathUtils.clamp(1 - g.partHp[i] / g.bossDef.partHp, 0, 1)
            : 0;
        const podGlow = Math.max(podWear ** 2 * 1.3, (g.partFlash[i] / 0.08) * 0.6);
        podDamage.value = this.reducedMotion ? Math.min(podGlow, 0.8) : podGlow;
      }
    }
    this.particles.count = 0;
    this.bossFire.count = this.bossSmoke.count = 0;
    const death = g.bossDeathTime;
    // Wear: how much of the boss hull is gone. Past half, the whole airframe
    // flushes red on a pulse; the pulse quickens at 70% and again at 90%, where
    // the hull also simmers red between beats and secondary blasts break out,
    // so the fight runs straight on into the destruction sequence.
    const wear = active ? T.MathUtils.clamp(1 - Math.max(0, g.bossHp) / g.bossDef.hp, 0, 1) : 0;
    const beat = wear >= 0.9 ? 3.4 : wear >= 0.7 ? 1.7 : wear >= 0.5 ? 0.8 : 0;
    this.bossPulse += dt * beat;
    let glow = 0;
    if (beat > 0) {
      const wave = 0.5 - 0.5 * Math.cos(this.bossPulse * Math.PI * 2);
      glow = wave ** 3 * (wear >= 0.9 ? 1.9 : wear >= 0.7 ? 1.4 : 1);
      if (wear >= 0.9) glow += 0.32 + Math.sin(t * 23) * 0.08;
    }
    glow = Math.max(glow, (g.bossFlash / 0.08) * 0.55);
    // A phase break rocks the whole hull with a bright flash that eases out
    // across the transition window (GameState.bossTransition, 2s), so a
    // pattern change reads as a real impact rather than just a pause in fire.
    if (g.bossTransition > 0) glow = Math.max(glow, (g.bossTransition / 2) * 2.4);
    if (g.bossDying) glow = (1.3 + Math.min(death, 6) * 0.2) * (0.7 + 0.3 * Math.sin(t * 31));
    if (model.damage) model.damage.value = this.reducedMotion ? Math.min(glow, 0.8) : glow;
    if (wear >= 0.9 && !g.bossDying) model.core.scale.setScalar(1.15 + Math.sin(t * 21) * 0.18);
    const scorchRate =
      g.bossDying || g.status !== 'playing' ? 0 : wear >= 0.9 ? 6 : wear >= 0.7 ? 2.4 : 0;
    const sc = this.scorch;
    if (scorchRate > 0 && (sc.due -= dt) <= 0) {
      const k = sc.head++ % sc.born.length;
      const a = sc.head * 2.399963 + Math.random() * 0.6,
        r = g.bossDef.ringRadius * (0.25 + Math.random() * 0.6);
      sc.x[k] = Math.cos(a) * r;
      sc.y[k] = Math.sin(a) * r * 0.72;
      sc.born[k] = t;
      sc.due = (0.6 + Math.random() * 0.8) / scorchRate;
    }
    if (active && !g.bossDying)
      for (let k = 0; k < sc.born.length; k++) {
        const age = t - sc.born[k];
        if (age < 0 || age > 1.4) continue;
        const x = g.bossX + sc.x[k],
          y = g.bossY + sc.y[k];
        if (wear >= 0.9)
          this.push(
            this.bossSmoke,
            x + age * 0.2,
            y + age * 0.7,
            1.3,
            0.2 + age * 0.55,
            0.16 + age * 0.45,
            0.14 + age * 0.35,
          );
        if (age < 0.5) {
          const f = (0.16 + Math.sin((age / 0.5) * Math.PI) * 0.42) * (wear >= 0.9 ? 1.25 : 1);
          const index = this.bossFire.count;
          this.push(this.bossFire, x, y, 1.9, f, f, f * 0.8);
          this.tint.set(age < 0.1 ? '#fff3b3' : age < 0.28 ? '#ffab32' : '#ff4018');
          this.tint.multiplyScalar(2.2 * (1 - age / 0.5));
          this.bossFire.setColorAt(index, this.tint);
        }
      }
    // Hit blasts: a white-hot flare that swells into an orange fireball and dies red.
    this.hitFire.count = 0;
    for (let k = 0; k < IMPACTS; k++) {
      const age = g.impactAge[k];
      if (age >= IMPACT_LIFE) continue;
      const u = age / IMPACT_LIFE,
        heavy = g.impactHeavy[k] === 1;
      const size =
        (heavy ? 0.46 : 0.32) * (0.3 + Math.sin(Math.min(1, u * 1.8) * Math.PI * 0.5) * 0.85);
      let index = this.hitFire.count;
      this.push(this.hitFire, g.impactX[k], g.impactY[k], 1.6, size, size, size * 0.8);
      this.tint.set(u < 0.18 ? '#fff1c4' : u < 0.45 ? '#ffa23a' : '#ff4516');
      this.tint.multiplyScalar(2.6 * (1 - u));
      this.hitFire.setColorAt(index, this.tint);
      if (u < 0.35) {
        index = this.hitFire.count;
        const core = size * 0.45 * (1 - u / 0.35);
        this.push(this.hitFire, g.impactX[k], g.impactY[k], 1.7, core, core, core);
        this.tint.set('#fffaf0').multiplyScalar(3);
        this.hitFire.setColorAt(index, this.tint);
      }
    }
    this.commit(this.hitFire);
    this.syncNova(g, t);
    this.destruction.root.visible = !inactive;
    this.destruction.update(g.destruction, t, this.quality === 'LOW', this.reducedMotion);
    this.bossShockwave.visible = g.bossDying && death > 6.65;
    if (g.bossDying) {
      for (let j = 0; j < 24; j++) {
        const n = Math.floor(death * 9) - j;
        const age = death - n / 9;
        if (death > 5.5 || n < 1 || n / 9 >= 6.65 || age > 2.3) continue;
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
    const blast = inactive ? -1 : g.novaBlast;
    if (blast >= 0) {
      this.explosionLight.position.set(g.novaBlastX, g.novaBlastY, 4);
      this.explosionLight.intensity = 90 * Math.exp(-blast * 1.3);
    }
    const shake = this.reducedMotion ? 0 : g.shake;
    // The camera itself never zooms to fit a taller stage (Section 5) - it
    // pans vertically instead, tracking the ship 1:1 so screen scale never
    // changes. g.cameraFollowY is 0 on every stage whose range already fits
    // the frame, so this is a no-op there.
    this.camera.position.x = Math.sin(t * 73) * shake * 0.12;
    this.camera.position.y = g.cameraFollowY + Math.cos(t * 91) * shake * 0.12;
    if (this.bloomNode)
      this.bloomNode.strength.value = this.bloomEnabled
        ? 0.27 + (blast >= 0 ? 0.55 * Math.exp(-blast * 1.6) : 0)
        : 0;
  }
  /** Draws the NOVA BOMB in flight and its three-second detonation. */
  private syncNova(g: Readonly<GameState>, t: number) {
    const inactive = g.status === 'menu';
    const flying = !inactive && g.novaActive;
    this.nova.root.visible = flying;
    if (flying) {
      this.nova.root.position.set(g.novaX, g.novaY, 0.3);
      // A slow barrel roll and a motor that burns longer as it builds speed.
      this.nova.root.rotation.x = t * 3;
      const burn = 0.6 + (g.novaSpeed / tuning.nova.maxSpeed) * 0.9;
      for (const [i, cone] of this.novaFlame.children.entries()) {
        const flutter = 1 + Math.sin(t * 41 + i * 2) * 0.12 + Math.sin(t * 67 + i) * 0.06;
        cone.scale.x = (cone.userData.length as number) * burn * flutter;
      }
      this.novaLamp.visible = Math.sin(t * 16) > 0;
    }
    const u = inactive ? -1 : g.novaBlast;
    const burning = u >= 0;
    this.novaWhiteout.visible = burning;
    this.novaCore.visible = burning && u < 0.22;
    this.novaHalo.visible = burning && u < 0.7;
    for (const ring of this.novaRings) ring.visible = false;
    this.novaFire.count = this.novaSmoke.count = 0;
    if (burning) {
      const x = g.novaBlastX,
        y = g.novaBlastY;
      // White-out: full strength almost at once, then draining away.
      const flash =
        (u < 0.06 ? u / 0.06 : Math.exp(-(u - 0.06) * 3.2)) * (this.reducedMotion ? 0.45 : 1);
      (this.novaWhiteout.material as T.MeshBasicNodeMaterial).opacity = flash * 0.4;
      const camera = this.camera.position;
      this.novaWhiteout.position.set(camera.x, camera.y, camera.z - 2);
      const span = 2 * 2 * Math.tan(T.MathUtils.degToRad(this.camera.fov / 2)) * 1.2;
      this.novaWhiteout.scale.set(span * this.camera.aspect, span, 1);
      // Fireball: swells fast, then keeps rolling outward as it cools.
      const fade = u > 2.2 ? Math.max(0, 1 - (u - 2.2) / 0.8) : 1;
      const radius = 1.2 + 5.3 * (1 - Math.exp(-u * 2.6));
      this.novaCore.position.set(x, y, 1.5);
      this.novaCore.scale.setScalar(radius * 0.35);
      const core = this.novaCore.material as T.MeshBasicNodeMaterial;
      core.color.set(u < 0.25 ? '#fffbef' : u < 0.8 ? '#ffd26a' : u < 1.6 ? '#ff8a2e' : '#d8391a');
      core.color.multiplyScalar(3.2 * Math.exp(-u * 0.75) * fade);
      this.novaHalo.position.set(x, y, 1.2);
      this.novaHalo.scale.setScalar(radius * 0.8);
      const halo = this.novaHalo.material as T.MeshBasicNodeMaterial;
      halo.color.set(u < 0.6 ? '#ffc56b' : '#ff5a22');
      halo.color.multiplyScalar(1.3 * Math.exp(-u * 0.9) * fade);
      // Three shockwaves, each a little later, wider and tipped in depth.
      for (const [k, ring] of this.novaRings.entries()) {
        const age = u - k * 0.22;
        if (age <= 0 || age > 1.8) continue;
        ring.visible = true;
        ring.position.set(x, y, 2);
        // Tipped only slightly, so the expanding ring never sweeps through the camera.
        ring.rotation.set(0.18 + k * 0.12, k * 0.1, 0);
        ring.scale.setScalar(1 + age * (11 + k * 3) * (1 - age * 0.2));
        const material = ring.material as T.MeshBasicNodeMaterial;
        material.color.set(k === 0 ? '#fff4d8' : '#ffb56a').multiplyScalar(2.4);
        material.opacity = Math.max(0, 1 - age / 1.8) * 0.45;
      }
      // Turbulent fire and smoke are drawn by DestructionEffects.
    }
    this.commit(this.novaFire);
    this.commit(this.novaSmoke);
  }
  render() {
    if (this.warmingUp || this.compiling) return;
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
    this.disposed = true;
    this.destruction.disposeTextures();
    this.reflectionEnvironment?.dispose();
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
