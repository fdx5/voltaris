import { formationPosition } from './formations';
import {
  bossSalvo,
  enemyBank,
  enemyPitch,
  enemyRotation,
  enemySalvo,
  groundSalvo,
  heavySalvo,
  type SalvoShot,
} from './HostilePatterns';
import fleetDesigns from '../../data/enemies/fleet-designs.json';
import fleetHardpoints from '../../data/enemies/fleet-hardpoints.json';
import groundHardpoints from '../../data/enemies/ground-hardpoints.json';
import tuning from '../../data/tuning.json';
import defs from '../../data/enemies/enemy-defs.json';
import emplacements from '../../data/enemies/ground-defs.json';
import weapons from '../../data/weapons/weapon-levels.json';
import { Random, clamp } from '../core/math/Random';
import { Terrain } from '../core/math/Terrain';
import { ObjectPool } from '../core/pool/ObjectPool';
import { BulletPool, Shot } from './entities/BulletPool';
import { STAGES, type StageDef } from './stages';
import { SpatialHash, segmentCircle } from './systems/SpatialHash';
import { Key } from '../core/input/InputManager';
export type Weapon = keyof typeof weapons;
export type Mode = 'TRAIL' | 'FREEZE' | 'DIRECTIONAL' | 'ROTATE';
/** Shape of a stage's `boss` (and optional `midBoss`) block. */
type BossConfig = StageDef['boss'];
/** When a stage with a `midBoss` block fights it - the 3:00 mark. */
const MID_BOSS_TIME = 180;
export type Status = 'menu' | 'playing' | 'paused' | 'continue' | 'gameover' | 'clear' | 'stress';
/**
 * Keeps a value inside [low, high] without a hard stop: the last fifth of the
 * range compresses smoothly, so a weave nearing the edge eases off it.
 */
function softLimit(v: number, low: number, high: number) {
  const mid = (low + high) / 2,
    half = (high - low) / 2;
  if (half <= 0) return mid;
  const u = (v - mid) / half,
    mag = Math.abs(u);
  if (mag <= 0.8) return v;
  return mid + Math.sign(u) * (0.8 + 0.2 * Math.tanh((mag - 0.8) / 0.2)) * half;
}
/** Impact bursts kept on screen at once, and how long each one burns. */
export const IMPACTS = 48;
/** Skill index of the NOVA BOMB, fitted to the second special slot (key 2). */
export const NOVA_SKILL = 6;
export const IMPACT_LIFE = 0.42;
export const MODES: Mode[] = ['TRAIL', 'FREEZE', 'DIRECTIONAL', 'ROTATE'];
/** What holding the control key does in each mode, for the on-screen notice. */
export const MODE_NOTE = ['밀착 대형', '위치 고정', '진행 방향 조준', '기체 공전'];
/** Frames an option lags behind the ship's path, per option, while trailing. */
const TRAIL_LAG = 22;
type PendingSalvo = {
  shot: SalvoShot;
  source: 'enemy' | 'ground' | 'boss';
  index: number;
  generation: number;
  remaining: number;
  speed: number;
  tint: number;
};
export class GameState {
  private pendingSalvos: PendingSalvo[] = [];
  readonly bullets = new BulletPool(tuning.pools.bullets);
  readonly enemies = new ObjectPool(tuning.pools.enemies);
  readonly particles = new ObjectPool(tuning.pools.particles);
  readonly items = new ObjectPool(tuning.pools.items);
  /** Emplacements riding the scrolling surface of a ground stage. */
  readonly ground = new ObjectPool(tuning.pools.ground);
  readonly groundFlash = new Float32Array(tuning.pools.ground);
  readonly groundGrid = new SpatialHash(tuning.pools.ground);
  /**
   * Rocks drifting through the play field. Unlike the belt in the backdrop
   * these are solid: they ram the ship and stop its shots. `type` picks the
   * model, `aux` is the rock's authored index (it seeds the tumble).
   */
  readonly rocks = new ObjectPool(tuning.pools.rocks);
  readonly rockFlash = new Float32Array(tuning.pools.rocks);
  /** The next authored rock still to enter. */
  private hazardIndex = 0;
  /** Seconds of hit flash left on each live enemy, so a hull that is being
   *  worn down reads as taking damage rather than shrugging it off. */
  readonly enemyFlash = new Float32Array(tuning.pools.enemies);
  /**
   * Roll about each hostile's nose and the tilt of its nose, in radians, both
   * following its vertical speed: climbing turns the dorsal plating to the
   * camera, diving shows the underside, as the player's ship does. Read by the
   * renderer, and by salvos so rounds leave the muzzle where it is drawn.
   */
  readonly enemyBank = new Float32Array(tuning.pools.enemies);
  /**
   * Recent hits on armoured targets - the boss, its pods and medium gunships -
   * as a ring of small explosions at the point of impact. `impactAge` counts
   * up from zero; the renderer draws each one until it burns out.
   */
  readonly impactX = new Float32Array(IMPACTS);
  readonly impactY = new Float32Array(IMPACTS);
  readonly impactAge = new Float32Array(IMPACTS).fill(IMPACT_LIFE);
  readonly impactHeavy = new Uint8Array(IMPACTS);
  private impactHead = 0;
  /** Counts hits on armoured targets; the runtime plays a blast per hit. */
  armourHitEvent = 0;
  /** Seconds of hit flash left on the boss hull. */
  bossFlash = 0;
  /**
   * The NOVA BOMB. Launched straight ahead from the ship's nose, it builds
   * speed and detonates on reaching `tuning.nova.detonateX` - about 200 px in
   * from the right edge of a 1280 px wide view. A fixed world line keeps the
   * blast deterministic, so a recorded run replays identically on the server.
   */
  novaActive = false;
  novaX = 0;
  novaY = 0;
  novaSpeed = 0;
  /** Seconds since the blast, while its three-second fireball burns; -1 otherwise. */
  novaBlast = -1;
  novaBlastX = 0;
  novaBlastY = 0;
  novaLaunchEvent = 0;
  novaEvent = 0;
  readonly enemyPitch = new Float32Array(tuning.pools.enemies);
  /**
   * Every hostile keeps flying right to left without pause, and weaves on its
   * own vertical path: two blended waves and a slow drift, each with its own
   * amplitude, rate and phase, plus a gentle pull toward the player's height.
   * The path is smooth by construction, so nothing ever jerks or stutters.
   * A separate generator keeps drops and explosions on their old sequence.
   */
  private readonly motion = {
    rng: new Random(0x5eed1e55),
    generation: new Uint32Array(tuning.pools.enemies).fill(0xffffffff),
    /** Seconds since this hull's own clock started (ignores squad delay). */
    clock: new Float32Array(tuning.pools.enemies),
    hold: new Float32Array(tuning.pools.enemies),
    pace: new Float32Array(tuning.pools.enemies),
    track: new Float32Array(tuning.pools.enemies),
    pull: new Float32Array(tuning.pools.enemies),
    /** amplitude, rate and phase for the main wave, the ripple and the drift. */
    wave: new Float32Array(tuning.pools.enemies * 9),
  };
  readonly grid = new SpatialHash(tuning.pools.enemies);
  readonly bulletGrid = new SpatialHash(tuning.pools.bullets);
  readonly rng = new Random();
  readonly optionX = new Float32Array(4);
  readonly optionY = new Float32Array(4);
  readonly optionAngle = new Float32Array(4);
  readonly historyX = new Float32Array(512);
  readonly historyY = new Float32Array(512);
  private historyHead = 0;
  readonly skills = new Int8Array([0, -1, -1]);
  readonly charge = new Float32Array(3);
  readonly effects = new Float32Array(tuning.skills.length);
  readonly partHp = new Float32Array(10);
  readonly partX = new Float32Array(10);
  readonly partY = new Float32Array(10);
  readonly replay = new Float32Array(60 * 600 * 3);
  readonly replayPressed = new Uint16Array(60 * 600);
  replayFrames = 0;
  replayOverflow = false;
  /** Which stage of the run is loaded; drives spawns, boss and backdrop. */
  stageIndex = 0;
  stage: StageDef = STAGES[0];
  /**
   * World units the surface has slid past. Terrain height is periodic, so the
   * simulation and the renderer both seat things with `x + scroll` and agree
   * without sharing any state.
   */
  scroll = 0;
  /** Null on stages flown in open space. */
  terrain: Terrain | null = null;
  /**
   * The cave roof. Built from the same height field with the relief inverted,
   * so ridges hang down instead of rising up.
   */
  roof: Terrain | null = null;
  status: Status = 'menu';
  weapon: Weapon = 'LASER';
  mode = 0;
  /** True while the option control key is down; the HUD lights up with it. */
  optionHold = false;
  /** Heading DIRECTIONAL last aimed at, kept while the stick is centred. */
  private optionAim = 0;
  level = 1;
  optionCount = 0;
  shield = 0;
  x = -7;
  y = 0;
  previousX = -7;
  previousY = 0;
  roll = 0;
  pitch = 0;
  frame = 0;
  time = 0;
  score = 0;
  kills = 0;
  lives = 3;
  credits = 3;
  creditsUsed = 1;
  graze = 1;
  maxGraze = 1;
  rank = 0;
  deaths = 0;
  invincible = 0;
  respawn = 0;
  fireTimer = 0;
  bombTimer = 0;
  chargeShot = 0;
  boss = false;
  bossHp = 0;
  bossX = 20;
  bossY = 0;
  bossTime = 0;
  bossPhase = 1;
  bossTransition = 0;
  bossShot = 1.6;
  bossAngle = 0;
  /** Counts fired boss volleys so patterns can rotate between them. */
  volley = 0;
  /** How many of the boss fight's every-20-seconds items have gone out already. */
  private bossItemsSent = 0;
  /** A stage with a `midBoss` block fights it partway through, independent of the real (final) boss. */
  midBoss = false;
  midBossDefeated = false;
  bossDefeated = false;
  bossKillTime = 0;
  bossDying = false;
  bossDeathTime = 0;
  bossDeathEvent = 0;
  bonus = 0;
  continueTime = 10;
  notice = '';
  noticeTime = 0;
  shake = 0;
  flash = 0;
  autoFire = true;
  practice = false;
  skillUnlocked = false;
  stressCount = 1500;
  stressShips = 20;
  shotEvent = 0;
  explosionEvent = 0;
  /** Set with each explosion: true for a heavy hull, false for a light one. */
  explosionHeavy = false;
  pickupEvent = 0;
  readonly pickupEventsByType = new Uint32Array(4);
  warningEvent = 0;
  hitEvent = 0;
  /**
   * Upgrade state a cleared stage hands to the next one. A fresh sortie wipes
   * it; clearing a stage saves whatever the player finished with.
   */
  readonly loadout = { level: 1, optionCount: 0, shield: 0 };
  private spawnIndex = 0;
  private itemIndex = 0;
  private dropCounter = 0;
  private groundIndex = 0;
  private groundTimer = 0;
  /**
   * Four pending squad slots preserve authored wave timing even when multiple
   * waves start on the same frame. Each squad is emitted as a complete layout.
   */
  private readonly laneWave = new Int32Array(4).fill(-1);
  private readonly laneLeft = new Int32Array(4);
  private readonly laneSpawned = new Int32Array(4);
  private readonly laneTimer = new Float32Array(4);
  start(weapon: Weapon, credits: number, practice = false, carry = false, stageIndex = 0) {
    this.stageIndex = clamp(stageIndex, 0, STAGES.length - 1);
    this.stage = STAGES[this.stageIndex];
    this.bullets.clear();
    this.pendingSalvos.length = 0;
    this.enemies.clear();
    this.particles.clear();
    this.items.clear();
    this.ground.clear();
    this.groundFlash.fill(0);
    this.rocks.clear();
    this.rockFlash.fill(0);
    this.hazardIndex = 0;
    this.scroll = 0;
    this.groundIndex = 0;
    this.groundTimer = 0;
    const surface = this.stage.surface;
    this.terrain = surface
      ? new Terrain(
          surface.span,
          surface.base,
          surface.relief,
          surface.seed,
          undefined,
          undefined,
          0,
          'flare' in surface ? surface.flare : 0,
        )
      : null;
    this.roof =
      surface && surface.roof
        ? new Terrain(
            surface.span,
            surface.roof.base,
            -surface.roof.relief,
            surface.roof.seed,
            surface.roof.lane,
            surface.roof.reach,
            'depthSlope' in surface.roof ? surface.roof.depthSlope : 0,
            'flare' in surface.roof ? surface.roof.flare : 0,
          )
        : null;
    this.rng.seed = 0x1a2b3c4d;
    this.motion.rng.seed = 0x5eed1e55;
    this.motion.generation.fill(0xffffffff);
    this.enemyBank.fill(0);
    this.enemyPitch.fill(0);
    this.status = 'playing';
    this.weapon = weapon;
    this.credits = credits;
    this.creditsUsed = 1;
    this.practice = practice;
    if (!carry) this.loadout.level = this.loadout.optionCount = this.loadout.shield = 0;
    this.level = practice ? 6 : Math.max(1, carry ? this.loadout.level : 1);
    // Every sortie flies with one option, so option control is something the
    // player has from the first stage rather than a reward for surviving to
    // the first blue ring. Rings still stack it up to four.
    this.optionCount = practice ? 4 : Math.max(1, carry ? this.loadout.optionCount : 0);
    this.x = this.previousX = -7;
    this.y = this.previousY = 0;
    this.frame = this.time = this.score = this.kills = this.deaths = this.rank = 0;
    this.graze = this.maxGraze = 1;
    this.lives = 3;
    this.shield = carry ? this.loadout.shield : 0;
    this.invincible = 2;
    this.respawn = this.fireTimer = this.chargeShot = this.bombTimer = 0;
    this.roll = this.pitch = 0;
    this.boss = false;
    this.bossHp = 0;
    this.bossDying = false;
    this.bossDeathTime = 0;
    this.bossPhase = 1;
    this.bossDefeated = false;
    this.midBoss = false;
    this.midBossDefeated = false;
    this.bossTime = this.bonus = this.bossKillTime = this.volley = 0;
    this.effects.fill(0);
    this.skills.set([0, NOVA_SKILL, -1]);
    this.skillUnlocked = practice;
    this.charge.fill(practice ? 1 : 0);
    // Every sortie opens with one NOVA BOMB armed; kills arm the next.
    this.charge[1] = 1;
    this.novaActive = false;
    this.novaBlast = -1;
    this.optionX.fill(-7);
    this.optionY.fill(0);
    this.optionAngle.fill(0);
    this.historyX.fill(-7);
    this.historyY.fill(0);
    this.historyHead = 0;
    this.spawnIndex = this.itemIndex = this.dropCounter = 0;
    this.laneWave.fill(-1);
    this.laneLeft.fill(0);
    this.laneSpawned.fill(0);
    this.laneTimer.fill(0);
    this.replayFrames = 0;
    this.replayOverflow = false;
    this.flash = this.shake = 0;
    this.enemyFlash.fill(0);
    this.impactAge.fill(IMPACT_LIFE);
    this.bossFlash = 0;
    this.announce(
      practice
        ? this.stage.boss.id + ' / 보스 훈련'
        : this.stage.name + ' / ' + this.stage.subtitle,
      4,
    );
    if (practice) this.spawnBoss();
  }
  announce(text: string, seconds = 2) {
    this.notice = text;
    this.noticeTime = seconds;
  }
  /** Rotates through the option control modes and says what the key now does. */
  cycleMode() {
    this.mode = (this.mode + 1) % 4;
    this.announce(`OPTION ${MODES[this.mode]} / ${MODE_NOTE[this.mode]}`, 1.6);
  }
  pause() {
    if (this.status === 'playing') this.status = 'paused';
    else if (this.status === 'paused') this.status = 'playing';
  }
  continueRun() {
    if (this.status !== 'continue' || this.creditsUsed >= this.credits) return;
    this.creditsUsed++;
    this.lives = 3;
    this.level = 1;
    this.optionCount = 1;
    this.shield = 0;
    this.charge.fill(0);
    this.effects.fill(0);
    this.rank = Math.max(0, this.rank - 40);
    this.invincible = 2;
    this.respawn = 0;
    this.bullets.clear();
    this.pendingSalvos.length = 0;
    this.status = 'playing';
    this.announce('RE-ENTRY / 전투 재개');
  }
  activate(slot: number) {
    if (this.bossDying) return;
    if (this.status !== 'playing' || this.respawn > 0 || slot < 0 || slot > 2) return;
    const skill = this.skills[slot];
    if (skill < 0 || this.charge[slot] < 0.999 || (!this.skillUnlocked && skill === 0)) return;
    if (skill === NOVA_SKILL) {
      // One bomb in the air or burning at a time; the charge is kept until it can fly.
      if (this.novaActive || this.novaBlast >= 0) return;
      this.charge[slot] = 0;
      this.novaActive = true;
      this.novaX = this.x + 1.1;
      this.novaY = this.y;
      this.novaSpeed = tuning.nova.launchSpeed;
      this.novaLaunchEvent++;
      this.announce(tuning.skills[skill].name);
      return;
    }
    this.charge[slot] = 0;
    this.effects[skill] = tuning.skills[skill].duration;
    this.flash = 0.35;
    if (skill === 0) this.invincible = Math.max(this.invincible, tuning.skills[0].duration);
    if (skill === 2) {
      this.invincible = Math.max(this.invincible, 1);
      this.x = clamp(this.x + 7, tuning.world.minX, tuning.world.maxX);
    }
    if (skill === 3) {
      this.optionCount = 0;
      for (let i = 0; i < this.enemies.limit; i++)
        if (this.enemies.active[i]) this.damageEnemy(i, 40);
    }
    if (skill === 5) this.shield = 3;
    this.announce(tuning.skills[skill].name);
    this.warningEvent++;
  }
  tick(dt: number, bits = 0, pressed = 0, dx = 0, dy = 0) {
    if (this.status === 'stress') {
      this.tickStress(dt);
      return;
    }
    if (this.status === 'continue') {
      this.continueTime -= dt;
      if (this.continueTime <= 0) this.status = 'gameover';
      return;
    }
    if (pressed & Key.Pause) {
      this.pause();
      return;
    }
    if (this.status !== 'playing') return;
    if (this.replayFrames < this.replay.length / 3) {
      this.replayPressed[this.replayFrames] = pressed;
      const p = this.replayFrames++ * 3;
      this.replay[p] = bits;
      this.replay[p + 1] = dx;
      this.replay[p + 2] = dy;
    } else this.replayOverflow = true;
    this.frame++;
    this.time += dt;
    this.noticeTime = Math.max(0, this.noticeTime - dt);
    this.shake = Math.max(0, this.shake - dt * 2);
    this.flash = Math.max(0, this.flash - dt * 2);
    this.bossFlash = Math.max(0, this.bossFlash - dt);
    // The blast keeps burning through a boss's death sequence, which it may have started.
    if (this.novaBlast >= 0 && (this.novaBlast += dt) >= tuning.nova.blast) this.novaBlast = -1;
    for (let k = 0; k < IMPACTS; k++)
      this.impactAge[k] = Math.min(IMPACT_LIFE, this.impactAge[k] + dt);
    if (this.bossDying) {
      this.updateBossDeath(dt);
      return;
    }
    this.invincible = Math.max(0, this.invincible - dt);
    this.respawn = Math.max(0, this.respawn - dt);
    for (let i = 0; i < this.effects.length; i++)
      this.effects[i] = Math.max(0, this.effects[i] - dt);
    if (pressed & Key.Mode) this.cycleMode();
    if (pressed & Key.Skill1) this.activate(0);
    if (pressed & Key.Skill2) this.activate(1);
    if (pressed & Key.Skill3) this.activate(2);
    this.previousX = this.x;
    this.previousY = this.y;
    let ax = (bits & Key.Right ? 1 : 0) - (bits & Key.Left ? 1 : 0),
      ay = (bits & Key.Up ? 1 : 0) - (bits & Key.Down ? 1 : 0);
    if (ax && ay) {
      ax *= Math.SQRT1_2;
      ay *= Math.SQRT1_2;
    }
    if (!this.respawn) {
      const speed = tuning.player.speed + (this.level - 1) * 0.65;
      this.x = clamp(this.x + ax * speed * dt + dx, tuning.world.minX, tuning.world.maxX);
      this.y = clamp(this.y + ay * speed * dt + dy, this.stage.minY, this.stage.maxY);
    }
    // Bank hard enough to show the hull's flank, and tip the nose the way
    // the ship is actually travelling.
    const climb = this.y - this.previousY;
    this.roll += (clamp(climb * -14, -1.15, 1.15) - this.roll) * 0.2;
    this.pitch += (clamp(climb * 3.4, -0.34, 0.34) - this.pitch) * 0.16;
    this.updateOptions(bits, ax, ay);
    if (this.frame % 320 === 0) this.rank = clamp(this.rank + 1, 0, 100);
    const enemyDt = dt * (this.effects[0] > 0 ? 0.6 : 1);
    if (this.stage.surface) this.scroll += this.stage.surface.speed * dt;
    this.spawn(dt);
    this.advanceSalvos(enemyDt);
    this.updateEnemies(enemyDt);
    this.updateRocks(enemyDt);
    if (this.terrain) this.updateGround(enemyDt);
    if (this.boss || this.midBoss) this.updateBoss(enemyDt);
    this.updateNova(dt);
    if (this.bossDying) return;
    this.fireTimer -= dt;
    const firing = !this.respawn && (this.autoFire || bits & Key.Fire);
    // Held-fire time must not bank credit: without the clamp a 1.5s respawn
    // leaves the timer 1.5s in debt and the ship fires once per tick on the
    // way back out, welding its bolts into one solid beam.
    if (!firing) this.fireTimer = Math.max(this.fireTimer, 0);
    else if (this.fireTimer <= 0) {
      // Preserve the authored fan at every level, while reducing rounds per
      // second (including options) to 1/3 MISSILE and 1/2 SPREAD.
      const intervalScale = this.weapon === 'MISSILE' ? 3 : this.weapon === 'SPREAD' ? 2 : 1;
      this.fireTimer += intervalScale / weapons[this.weapon][this.level - 1].rate;
      this.fireWeapon(this.x + 0.7, this.y, 0);
      for (let i = 0; i < this.optionCount; i++)
        this.fireWeapon(this.optionX[i], this.optionY[i], this.optionAngle[i], true);
      this.shotEvent++;
    }
    // Surface stages arm a ground salvo alongside the main gun: two bombs at
    // minimum power, five at maximum, spaced so one pass rakes a whole line.
    if (this.terrain) {
      this.bombTimer -= dt;
      if (firing && this.bombTimer <= 0) {
        this.bombTimer += 1 / tuning.combat.groundMissile.rate;
        this.fireGroundSalvo();
      }
    }
    if (bits & Key.Fire && this.weapon === 'LASER' && this.level >= 5) {
      this.chargeShot += dt;
      if (this.chargeShot >= 2) {
        this.chargeShot = 0;
        for (let j = -1; j <= 1; j++)
          this.bullets.fire(this.x + 1, this.y + j * 0.3, 45, 0, 3, 0.16, 8, 255);
        this.flash = 0.15;
      }
    } else this.chargeShot = 0;
    this.updateBullets(dt, enemyDt);
    this.collisions();
    if (this.bossDying) return;
    this.updateItems(dt);
    this.particles.move(dt);
  }
  /**
   * Places the option drones for the frame.
   *
   * The mode picks what the control key does while it is held; let go and the
   * options fall back into the trail behind the ship. Every mode does
   * something visible, so cycling with `Q` always reads as a change:
   * TRAIL pulls them into a tight line beside the ship, FREEZE pins them where
   * they stand, DIRECTIONAL turns their guns to the stick, ROTATE swings them
   * around the hull.
   */
  private updateOptions(bits: number, ax: number, ay: number) {
    this.historyHead = (this.historyHead + 1) % 512;
    this.historyX[this.historyHead] = this.x;
    this.historyY[this.historyHead] = this.y;
    const hold = (bits & Key.Hold) !== 0;
    this.optionHold = hold;
    if (hold && (ax || ay)) this.optionAim = Math.atan2(ay, ax);
    for (let i = 0; i < 4; i++) {
      // FREEZE: the drone keeps the position it already holds, and keeps
      // firing from it.
      if (hold && this.mode === 1) continue;
      if (hold && this.mode === 3) {
        const a = this.time * 2.2 + (i * Math.PI) / 2;
        this.optionX[i] = this.x + Math.cos(a) * 1.8;
        this.optionY[i] = this.y + Math.sin(a) * 1.8;
        // Guns point outwards along the orbit, so the ring covers every side.
        this.optionAngle[i] = a;
        continue;
      }
      // TRAIL closes the formation up while held: same path, a fifth of the
      // lag, so a held burst lands as one column instead of a smear.
      const tight = hold && this.mode === 0;
      const lag = tight ? 4 : TRAIL_LAG;
      const h = (this.historyHead - lag * (i + 1) + 512) % 512;
      this.optionX[i] = this.historyX[h] - (i + 1) * (tight ? 0.16 : 0.45);
      this.optionY[i] = this.historyY[h];
      // A ship that stops flying has its own trail land on top of it, and the
      // drones disappear inside the hull. They keep a stand-off behind it.
      const gap = (tight ? 0.55 : 0.85) + i * 0.5;
      this.optionX[i] = Math.min(this.optionX[i], this.x - gap);
      this.optionAngle[i] = hold && this.mode === 2 ? this.optionAim : 0;
    }
  }
  /**
   * Fires one volley of the equipped weapon. The ship and its option drones
   * shoot the same number of rounds for the same damage, but in patterns of
   * their own - and the renderer colours drone rounds differently - so the
   * player can always tell their own fire from their escorts'.
   *
   * - LASER: the ship fires parallel tracers; drones fire pulses that cross
   *   and uncross from volley to volley.
   * - MISSILE: the ship fires a steady fan; drones throw quicker micro-missiles
   *   in a wider fan.
   * - SPREAD: the ship sprays a wide, breathing fan; drones fire a tight,
   *   stuttering stream.
   */
  private fireWeapon(x: number, y: number, angle: number, option = false) {
    const w = weapons[this.weapon][this.level - 1];
    const damage = w.damage * (this.effects[0] > 0 ? 2 : 1);
    const beat = this.shotEvent % 2 ? 1 : -1;
    for (let j = 0; j < w.count; j++) {
      const mid = j - (w.count - 1) / 2;
      let spread = 0,
        offset = 0,
        speed = 30;
      if (this.weapon === 'LASER') {
        offset = mid * (option ? 0.14 : 0.3);
        spread = option ? mid * beat * 0.07 : 0;
        speed = option ? 26 : 30;
      } else if (this.weapon === 'MISSILE') {
        offset = mid * 0.16;
        spread = mid * (option ? 0.46 : 0.28);
        speed = option ? 24 : 18;
      } else {
        spread = option ? mid * 0.045 : mid * (beat > 0 ? 0.15 : 0.11);
        offset = option ? beat * 0.06 : 0;
      }
      const a = angle + spread;
      const slot = this.bullets.fire(
        x,
        y + offset,
        Math.cos(a) * speed,
        Math.sin(a) * speed,
        this.weapon === 'MISSILE' ? 2 : 0,
        w.width,
        damage,
        w.pierce,
      );
      if (slot < 0) continue;
      if (this.weapon === 'SPREAD') this.bullets.tint[slot] = 0xbca8ff;
      if (option) this.bullets.option[slot] = 1;
    }
  }
  /**
   * Hull integrity scaling applied at spawn. Every type is authored once; the
   * stage sets the baseline, and it climbs as the sortie runs so the last
   * formations of a stage are meaningfully tougher than the first.
   */
  get hullScale() {
    const progress = clamp(this.time / this.stage.durationSec, 0, 1);
    return this.stage.hull * (1 + tuning.combat.hullRamp * progress);
  }
  /**
   * Off-screen culling/engage thresholds below are tuned against the camera's
   * default ~32-unit reference span (see ThreeBackend.resize). A stage that
   * opts into a wider `cameraHeight` (a taller arena, zoomed further out)
   * needs those thresholds scaled up by the same factor, or bullets/enemies
   * will pop in and out while still visible on the now-larger screen.
   */
  get worldScale() {
    const cameraHeight = (this.stage as { cameraHeight?: number }).cameraHeight;
    return cameraHeight ? cameraHeight / 32 : 1;
  }
  /**
   * The camera never zooms out - screen scale stays identical on every
   * stage. A stage whose `maxY - minY` doesn't fit inside the visible frame
   * (Section 5's tripled range does not) instead has the camera pan
   * vertically to follow the ship, clamped so it never scrolls past the
   * stage's own top/bottom edge. `half` is a conservative estimate of the
   * visible half-height (stage 1's own ±7.2 fits inside it with margin at
   * every aspect ratio this game supports) - exact per-aspect precision
   * isn't needed here, only "never shows past the level bounds."
   */
  get cameraFollowY() {
    const half = 9;
    const span = this.stage.maxY - this.stage.minY;
    if (span <= half * 2) return 0;
    return clamp(this.y, this.stage.minY + half, this.stage.maxY - half);
  }
  /** Height of the deck, or of the roof, at a point on the field. */
  surfaceAt(x: number, roof = false) {
    const field = roof ? this.roof : this.terrain;
    return field ? field.height(x + this.scroll, 0) : 0;
  }
  /** Bombs in one salvo: 2 at Lv.1, then one more every two power levels. */
  get salvoSize() {
    return 2 + Math.min(3, Math.floor((this.level - 1) / 2));
  }
  private fireGroundSalvo() {
    const m = tuning.combat.groundMissile;
    const count = this.salvoSize;
    for (let j = 0; j < count; j++) {
      // Each bomb leaves with a little more forward speed than the last, so a
      // single salvo lands as an evenly spaced line of craters.
      const forward = m.lead + j * m.spread;
      this.bullets.fire(this.x + 0.5, this.y - 0.2, forward, m.drop, 4, 0.16, m.damage, 1);
      // In a cave the same salvo is mirrored at the roof.
      if (this.roof)
        this.bullets.fire(this.x + 0.5, this.y + 0.2, forward, -m.drop, 5, 0.16, m.damage, 1);
    }
    this.shotEvent++;
  }
  /** A bomb reaching the surface cracks everything inside its blast. */
  private detonate(x: number, y: number) {
    const m = tuning.combat.groundMissile;
    this.burst(x, y, emplacements[1].burst);
    const g = this.ground;
    for (let i = 0; i < g.limit; i++) {
      if (!g.active[i]) continue;
      if ((g.x[i] - x) ** 2 + (g.y[i] - y) ** 2 > (m.blast + g.radius[i]) ** 2) continue;
      this.damageGround(i, m.damage);
    }
  }
  damageGround(i: number, damage: number) {
    const g = this.ground;
    if (!g.active[i]) return;
    g.hp[i] -= damage;
    if (g.hp[i] > 0) {
      this.groundFlash[i] = 0.09;
      return;
    }
    const d = emplacements[g.type[i]];
    this.kills++;
    this.score += Math.floor(d.score * this.graze);
    this.burst(g.x[i], g.y[i] + d.radius * 0.4, d.burst);
    for (let s = 0; s < 3; s++)
      if (this.skills[s] >= 0)
        this.charge[s] = Math.min(1, this.charge[s] + 1 / tuning.skills[this.skills[s]].kills);
    g.release(i);
  }
  private spawn(dt: number) {
    if (this.practice) return;
    for (let lane = 0; lane < 4; lane++) {
      if (this.laneWave[lane] < 0) continue;
      this.laneTimer[lane] -= dt;
      if (this.laneTimer[lane] > 0) continue;
      const wave = this.stage.spawns[this.laneWave[lane]];
      const ordinal = this.laneWave[lane];
      const count = this.waveSize(wave.count, ordinal, wave.type);
      // A squad enters together, with real lateral and depth separation.
      while (this.laneLeft[lane] > 0) {
        const n = this.laneSpawned[lane]++;
        const d = defs[wave.type];
        const pos = formationPosition(
          ordinal,
          n,
          count,
          d.radius,
          wave.y,
          this.stage.minY + d.radius + 0.4,
          // The stage's own ceiling, not the world's: a cave stage kept the
          // world bound and spread formations up into the vault, where the
          // player - held below it - had no way to reach them.
          this.stage.maxY - d.radius - 0.4,
          this.worldScale,
        );
        this.spawnEnemy(wave.type, pos.x, pos.y, 3 + (ordinal % 6), 0);
        this.laneLeft[lane]--;
      }
      this.laneWave[lane] = -1;
    }
    // A boss fight (mid or final) is the encounter, not a backdrop for one -
    // reinforcements stop queuing up while either is under way, though
    // whatever's already in flight keeps flying.
    while (
      !this.boss &&
      !this.midBoss &&
      this.spawnIndex < this.stage.spawns.length &&
      this.time >= this.stage.spawns[this.spawnIndex].time
    ) {
      const lane = this.laneWave.indexOf(-1);
      if (lane < 0) break;
      const ordinal = this.spawnIndex++;
      this.laneWave[lane] = ordinal;
      const next = this.stage.spawns[ordinal];
      this.laneLeft[lane] = this.waveSize(next.count, ordinal, next.type);
      this.laneSpawned[lane] = 0;
      this.laneTimer[lane] = 0;
    }
    if (this.terrain) {
      this.groundTimer -= dt;
      while (
        this.groundIndex < this.stage.ground.length &&
        this.time >= this.stage.ground[this.groundIndex].time &&
        this.groundTimer <= 0
      ) {
        const g = this.stage.ground[this.groundIndex++];
        const d = emplacements[g.type];
        const roof = 'roof' in g && g.roof === 1;
        for (let unit = 0; unit < (this.stageIndex === 2 ? 3 : 1); unit++) {
          const x = 17.4 + unit * (d.radius * 2 + 1.1);
          const i = this.ground.acquire(
            x,
            this.surfaceAt(x, roof),
            0,
            0,
            g.type,
            1e9,
            d.radius,
            Math.max(1, Math.round(d.hp * this.hullScale)),
          );
          if (i >= 0) {
            this.groundFlash[i] = 0;
            this.ground.aux[i] = roof ? 1 : 0;
          }
        }
        this.groundTimer = 0.35;
      }
    }
    // Rocks stop coming once the boss is due; the fight is its own hazard.
    const hazards = this.stage.hazards;
    while (
      this.hazardIndex < hazards.length &&
      this.time >= hazards[this.hazardIndex].time &&
      this.time < this.stage.durationSec
    ) {
      const n = this.hazardIndex++,
        h = hazards[n];
      const i = this.rocks.acquire(
        17.5 + h.size,
        h.y,
        -h.speed,
        h.drift,
        n % 3,
        1e9,
        h.size,
        Math.round(tuning.hazards.hp * h.size),
      );
      if (i >= 0) {
        this.rockFlash[i] = 0;
        this.rocks.aux[i] = n;
      }
    }
    if (
      this.itemIndex < this.stage.items.length &&
      this.time >= this.stage.items[this.itemIndex].time
    ) {
      const item = this.stage.items[this.itemIndex++];
      this.items.acquire(12, item.y, -4, 0, item.type, 12, 0.5);
    }
    const midBossDef = (this.stage as { midBoss?: BossConfig }).midBoss;
    if (
      midBossDef &&
      !this.midBoss &&
      !this.midBossDefeated &&
      !this.boss &&
      this.time >= MID_BOSS_TIME
    )
      this.spawnBoss('mid');
    if (this.time >= this.stage.durationSec && !this.boss && !this.midBoss && !this.bossDefeated)
      this.spawnBoss('final');
  }
  /**
   * The first formation launches three ships, the next four, and so on: a
   * ceiling that opens by one per wave until each formation's authored size
   * takes over. Medium gunships are the exception: see `mediumCount`.
   */
  private waveSize(count: number, ordinal: number, type: number) {
    if (fleetHardpoints[type].size === 'medium') return this.mediumCount;
    return (
      Math.max(1, Math.min(count, this.stage.firstWave + ordinal * tuning.spawn.growth)) *
      (this.stageIndex === 2 ? 2 : 1)
    );
  }
  /** How far through the stage's pre-boss run the sortie is, 0..1. */
  private get progress() {
    return clamp(this.time / this.stage.durationSec, 0, 1);
  }
  /**
   * Medium gunships fly as mini-bosses: one at a time early in the first
   * stage, building with the clock and with each stage to four abreast.
   */
  get mediumCount() {
    return clamp(1 + Math.floor(this.progress * 2.2 + this.stageIndex * 0.7), 1, 4);
  }
  /** Medium hull integrity over the base scaling: 2.5x at first, 4x by the last stage's end. */
  get mediumArmour() {
    return 2.5 + 1.5 * clamp(this.progress * 0.55 + this.stageIndex * 0.15, 0, 1);
  }
  private spawnEnemy(type: number, x: number, y: number, pattern: number, n: number) {
    const d = defs[type];
    const armour = fleetHardpoints[type].size === 'medium' ? this.mediumArmour : 1;
    const hp = Math.max(1, Math.round(d.hp * this.hullScale * armour));
    const i = this.enemies.acquire(x, y, -d.speed, 0, type, 30, d.radius, hp);
    if (i >= 0) {
      this.enemyFlash[i] = 0;
      this.enemies.aux[i] = pattern;
      this.enemies.life[i] = y;
      this.enemies.age[i] = -n * 0.08;
    }
  }
  private updateEnemies(dt: number) {
    const e = this.enemies;
    for (let i = 0; i < e.limit; i++) {
      if (!e.active[i]) continue;
      const d = defs[e.type[i]];
      e.px[i] = e.x[i];
      e.py[i] = e.y[i];
      e.age[i] += dt;
      this.enemyFlash[i] = Math.max(0, this.enemyFlash[i] - dt);
      if (this.motion.generation[i] !== e.generation[i]) this.initMotion(i);
      const m = this.motion;
      // A steady run across the field at this hull's own speed.
      const cruise = d.speed * m.pace[i];
      if (e.vx[i] > -cruise) e.vx[i] += (-cruise - e.vx[i]) * Math.min(1, dt * 1.5);
      e.x[i] += e.vx[i] * dt;
      const a = e.age[i];
      const t = (m.clock[i] += dt);
      // Leaves the squad slot on a smoothstep, so the weave grows in gently.
      const blend = clamp((t - m.hold[i]) / 1.4, 0, 1);
      const engage = blend * blend * (3 - 2 * blend);
      const w = m.wave,
        k = i * 9;
      let weave = 0;
      for (let n = 0; n < 9; n += 3) weave += w[k + n] * Math.sin(t * w[k + n + 1] + w[k + n + 2]);
      // Low-passed pull toward the player's altitude: a trend, never a snap.
      const goal = clamp(this.y - e.life[i], -4, 4);
      m.track[i] += (goal - m.track[i]) * Math.min(1, dt * 0.7);
      const low = this.stage.minY + d.radius,
        high = this.stage.maxY - d.radius;
      e.y[i] = softLimit(e.life[i] + (weave + m.track[i] * m.pull[i]) * engage, low, high);
      e.vy[i] = dt > 0 ? (e.y[i] - e.py[i]) / dt : 0;
      // Attitude eases toward what the vertical speed calls for.
      const view = (fleetHardpoints[e.type[i]].viewDegrees * Math.PI) / 180;
      const ease = Math.min(1, dt * 5);
      this.enemyBank[i] += (enemyBank(e.vy[i], view) - this.enemyBank[i]) * ease;
      this.enemyPitch[i] += (enemyPitch(e.vy[i]) - this.enemyPitch[i]) * ease;
      if (e.x[i] < -18 * this.worldScale) {
        e.release(i);
        continue;
      }
      const period = this.firePeriod(e.type[i]);
      if (a > 0.45 && a % period >= period - dt && e.x[i] < 16.5 * this.worldScale)
        this.queueSalvo(
          this.hostilePlan(
            e.type[i],
            Math.atan2(this.y - e.y[i], this.x - e.x[i]),
            Math.floor(a / period),
          ),
          'enemy',
          i,
          tuning.combat.enemyBulletSpeed * d.fire.speed * (1 + this.rank * 0.0035),
          parseInt(fleetDesigns[e.type[i]].palette[1].slice(1), 16),
        );
    }
  }
  /** Flies the NOVA BOMB to its detonation line and times the burning blast. */
  private updateNova(dt: number) {
    const nova = tuning.nova;
    if (this.novaActive) {
      this.novaSpeed = Math.min(nova.maxSpeed, this.novaSpeed + nova.acceleration * dt);
      this.novaX += this.novaSpeed * dt;
      // A ragged smoke trail spilling from the motor.
      const a = this.rng.next() - 0.5;
      this.particles.acquire(
        this.novaX - 1.25,
        this.novaY + a * 0.25,
        -3 - this.rng.next() * 3,
        a * 1.6,
        2,
        0.35 + this.rng.next() * 0.25,
        0.09 + this.rng.next() * 0.07,
      );
      if (this.novaX >= nova.detonateX) this.detonateNova();
    }
  }
  /**
   * The NOVA BOMB goes off: a white-out flash, every hostile round on the
   * field erased along with every volley still queued, and one massive hit on
   * every unit in play - enough to break a stage-three gunship outright.
   */
  private detonateNova() {
    const nova = tuning.nova;
    this.novaActive = false;
    this.novaBlast = 0;
    this.novaBlastX = this.novaX;
    this.novaBlastY = this.novaY;
    this.effects[NOVA_SKILL] = nova.blast;
    this.flash = 1;
    this.shake = Math.max(this.shake, 1.5);
    this.novaEvent++;
    const b = this.bullets;
    for (let i = 0; i < b.limit; i++) if (b.active[i] && b.type[i] === 1) b.release(i);
    this.pendingSalvos.length = 0;
    const [x, y, damage] = [this.novaBlastX, this.novaBlastY, nova.damage];
    for (let i = 0; i < this.enemies.limit; i++)
      if (this.enemies.active[i]) this.damageEnemy(i, damage, x, y);
    for (let i = 0; i < this.ground.limit; i++)
      if (this.ground.active[i]) this.damageGround(i, damage);
    for (let i = 0; i < this.rocks.limit; i++) if (this.rocks.active[i]) this.damageRock(i, damage);
    if (this.boss && !this.bossDying) {
      for (let p = 0; p < this.bossParts; p++) {
        if (this.partHp[p] <= 0) continue;
        this.partHp[p] -= damage;
        if (this.partHp[p] <= 0) {
          this.explode(this.partX[p], this.partY[p], 55);
          this.score += 4000;
        }
      }
      if (this.bossTransition <= 0) {
        this.bossHp -= damage;
        this.bossFlash = 0.08;
        if (this.bossHp <= 0) this.finish(true);
      }
    }
  }
  /** Rolls one hull's speed and flight path the first time its slot is seen. */
  private initMotion(i: number) {
    const m = this.motion,
      e = this.enemies,
      r = m.rng,
      roll = (min: number, max: number) => min + r.next() * (max - min);
    m.generation[i] = e.generation[i];
    m.clock[i] = 0;
    m.track[i] = 0;
    this.enemyBank[i] = this.enemyPitch[i] = 0;
    const small = fleetHardpoints[e.type[i]].size === 'small';
    // Small hulls are quicker in both directions; no two ships share a speed.
    m.pace[i] = small ? roll(1.3, 1.8) : roll(1.05, 1.4);
    m.hold[i] = roll(0.2, 1.1);
    m.pull[i] = 0;
    const phase = () => roll(0, Math.PI * 2);
    const style = r.next();
    let wave: number[];
    if (style < 0.45) {
      // Weaver: two blended waves and a slow drift, loosely following the player.
      const amp = small ? roll(1.5, 3.1) : roll(0.8, 1.9),
        rate = small ? roll(0.9, 1.9) : roll(0.5, 1.1);
      m.pull[i] = r.next() < 0.4 ? 0 : roll(0.15, 0.45);
      wave = [
        amp,
        rate,
        phase(),
        amp * roll(0.1, 0.28),
        rate * roll(1.4, 2.2),
        phase(),
        roll(0, 1.8),
        roll(0.18, 0.42),
        phase(),
      ];
    } else if (style < 0.72) {
      // Lancer: holds its line dead straight and charges through at speed.
      m.pace[i] *= small ? roll(1.3, 1.6) : roll(1.1, 1.25);
      wave = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    } else if (style < 0.87) {
      // Diver: level flight that bends into one long swoop at the player's altitude.
      m.pull[i] = roll(0.75, 1);
      m.hold[i] += roll(0.4, 1.4);
      wave = [0, 0, 0, 0, 0, 0, roll(0, 0.6), roll(0.3, 0.5), phase()];
    } else {
      // Glider: one broad, unhurried rise and fall across the field.
      m.pace[i] *= roll(0.85, 1);
      wave = [roll(2.2, 3.6), roll(0.22, 0.45), phase(), 0, 0, 0, 0, 0, 0];
    }
    m.wave.set(wave, i * 9);
  }
  /**
   * A light hull fires its authored salvo. A medium gunship fires like a
   * mini-boss: its authored salvo opens every third volley, and the two in
   * between are dense barrages of its own.
   */
  private hostilePlan(type: number, aim: number, cycle: number) {
    return fleetHardpoints[type].size === 'medium' && cycle % 3 !== 0
      ? heavySalvo(type, aim, cycle)
      : enemySalvo(type, aim, cycle);
  }
  /** Rocks coast straight through, glancing off the top and bottom of the field. */
  private updateRocks(dt: number) {
    const r = this.rocks;
    for (let i = 0; i < r.limit; i++) {
      if (!r.active[i]) continue;
      r.px[i] = r.x[i];
      r.py[i] = r.y[i];
      r.age[i] += dt;
      this.rockFlash[i] = Math.max(0, this.rockFlash[i] - dt);
      r.x[i] += r.vx[i] * dt;
      r.y[i] += r.vy[i] * dt;
      const inset = r.radius[i] * 0.5;
      if (
        (r.y[i] < this.stage.minY + inset && r.vy[i] < 0) ||
        (r.y[i] > this.stage.maxY - inset && r.vy[i] > 0)
      )
        r.vy[i] *= -1;
      if (r.x[i] < -18 * this.worldScale - r.radius[i]) r.release(i);
    }
  }
  damageRock(i: number, damage: number) {
    const r = this.rocks;
    if (!r.active[i]) return;
    r.hp[i] -= damage;
    if (r.hp[i] > 0) {
      this.rockFlash[i] = 0.08;
      return;
    }
    const size = r.radius[i];
    this.score += Math.floor(tuning.hazards.score * size);
    this.burst(r.x[i], r.y[i], {
      count: Math.round(30 * size),
      speed: 2,
      spread: 5,
      life: 0.6,
      size: 0.16 * size,
      ring: 0,
      shake: 0.2 * size,
      palette: [2, 2, 0],
    });
    r.release(i);
  }
  /**
   * Emplacements do not move under their own power: the surface carries them,
   * so `x + scroll` stays put and each one keeps its spot on the ground.
   */
  private updateGround(dt: number) {
    const g = this.ground,
      speed = this.stage.surface!.speed;
    for (let i = 0; i < g.limit; i++) {
      if (!g.active[i]) continue;
      const d = emplacements[g.type[i]];
      g.px[i] = g.x[i];
      g.py[i] = g.y[i];
      g.age[i] += dt;
      this.groundFlash[i] = Math.max(0, this.groundFlash[i] - dt);
      g.x[i] -= speed * dt;
      g.y[i] = this.surfaceAt(g.x[i], g.aux[i] === 1);
      if (g.x[i] < -18 * this.worldScale) {
        g.release(i);
        continue;
      }
      const period = d.period / (1 + this.rank * 0.006) / this.stage.pressure;
      // A roof mount's muzzle hangs below its footing, not above it.
      const muzzle = g.aux[i] === 1 ? -d.radius : d.radius;
      if (g.age[i] > 0.6 && g.age[i] % period >= period - dt && g.x[i] < 15 * this.worldScale)
        this.queueSalvo(
          groundSalvo(
            g.type[i],
            Math.atan2(this.y - g.y[i] - muzzle, this.x - g.x[i]),
            Math.floor(g.age[i] / period),
          ),
          'ground',
          i,
          tuning.combat.enemyBulletSpeed * d.fire.speed,
          0,
        );
    }
  }
  /** Launches one hostile shot and seeds the scratch its flight rule needs. */
  private hostileShot(x: number, y: number, angle: number, speed: number, kind: number, tint = 0) {
    const param =
      kind === Shot.WAVE
        ? speed
        : kind === Shot.ACCEL
          ? 2.2
          : kind === Shot.SPLIT
            ? 0.9
            : kind === Shot.BOUNCE
              ? 3
              : kind === Shot.HOMING
                ? 2.6
                : 0;
    const index = this.bullets.fire(
      x,
      y,
      Math.cos(angle) * speed,
      Math.sin(angle) * speed,
      1,
      tuning.combat.shotRadius[kind],
      1,
      1,
      kind,
      param,
    );
    if (index >= 0) this.bullets.tint[index] = tint;
    return index;
  }
  private queueSalvo(
    plan: SalvoShot[],
    source: PendingSalvo['source'],
    index: number,
    speed: number,
    tint: number,
  ) {
    const pool = source === 'ground' ? this.ground : this.enemies;
    const generation = source === 'boss' ? this.bossPhase : pool.generation[index];
    for (const shot of plan) {
      if (this.pendingSalvos.length >= 2048) break;
      const entry = { shot, source, index, generation, remaining: shot.delay, speed, tint };
      if (shot.delay <= 0) this.launchSalvoShot(entry);
      else this.pendingSalvos.push(entry);
    }
  }
  private launchSalvoShot(entry: PendingSalvo) {
    const { shot, source, index, generation } = entry;
    let x: number, y: number;
    if (source === 'boss') {
      if (
        !this.boss ||
        this.bossDying ||
        this.bossPhase !== generation ||
        (index >= 0 && this.partHp[index] <= 0)
      )
        return;
      x = index < 0 ? this.bossX : this.partX[index];
      y = index < 0 ? this.bossY : this.partY[index];
      x += shot.dx;
      y += shot.dy;
    } else {
      const pool = source === 'ground' ? this.ground : this.enemies;
      if (!pool.active[index] || pool.generation[index] !== generation) return;
      const type = pool.type[index];
      if (source === 'enemy') {
        const mounts = fleetHardpoints[type].muzzles;
        const mount = mounts[shot.mount % mounts.length];
        const angle = enemyRotation(type, pool.age[index], this.time) + this.enemyPitch[index];
        const bank = this.enemyBank[index];
        // Roll about the nose first, then the in-plane turn, as the renderer does.
        const my = mount[1] * Math.cos(bank) - mount[2] * Math.sin(bank);
        x = pool.x[index] + mount[0] * Math.cos(angle) - my * Math.sin(angle) + shot.dx;
        y = pool.y[index] + mount[0] * Math.sin(angle) + my * Math.cos(angle) + shot.dy;
      } else {
        // Roof craft are the floor model turned over about X: only height flips.
        const sign = pool.aux[index] === 1 ? -1 : 1;
        const mounts = groundHardpoints[type].muzzles;
        const mount = mounts[shot.mount % mounts.length];
        x = pool.x[index] + mount[0] + shot.dx;
        y = pool.y[index] + (mount[1] + shot.dy) * sign;
      }
    }
    this.hostileShot(x, y, shot.angle, entry.speed * shot.speed, shot.kind, entry.tint);
  }
  private advanceSalvos(dt: number) {
    let write = 0;
    for (const entry of this.pendingSalvos) {
      entry.remaining -= dt;
      if (entry.remaining <= 0) this.launchSalvoShot(entry);
      else this.pendingSalvos[write++] = entry;
    }
    this.pendingSalvos.length = write;
  }
  /**
   * Seconds between one hull's volleys. Rank tightens it; a low-powered ship
   * gets it opened back up, so a Lv.1 pilot faces half the volume and the
   * discount closes as they arm up.
   */
  private firePeriod(type: number) {
    const { min, full } = tuning.combat.powerFire;
    const power = min + (1 - min) * clamp((this.level - 1) / (full - 1), 0, 1);
    return defs[type].period / (1 + this.rank * 0.006) / power / this.stage.pressure;
  }
  /** True while an emplacement is winding up its next volley. */
  groundTelegraph(i: number) {
    const d = emplacements[this.ground.type[i]];
    const period = d.period / (1 + this.rank * 0.006) / this.stage.pressure;
    return (
      this.ground.age[i] > 0.6 && this.ground.age[i] % period > period - tuning.combat.telegraph
    );
  }
  enemyTelegraph(i: number) {
    const period = this.firePeriod(this.enemies.type[i]);
    return (
      this.enemies.age[i] > 0.45 && this.enemies.age[i] % period > period - tuning.combat.telegraph
    );
  }
  /**
   * Whichever boss is currently active - the stage's `midBoss` mid-fight, its
   * `boss` (the real, final one) otherwise. `this.boss` and `this.midBoss`
   * are never both true at once.
   */
  get bossDef() {
    return this.midBoss ? (this.stage as { midBoss?: BossConfig }).midBoss! : this.stage.boss;
  }
  /** Pods mounted on the current boss. */
  get bossParts() {
    return this.bossDef.parts;
  }
  spawnBoss(kind: 'mid' | 'final' = 'final') {
    this.bossDying = false;
    this.bossDeathTime = 0;
    this.midBoss = kind === 'mid';
    this.boss = kind === 'final';
    const def = this.bossDef;
    this.bossHp = def.hp;
    this.bossX = 20;
    this.bossY = 0;
    this.bossTime = 0;
    this.bossPhase = 1;
    this.bossTransition = 2;
    this.bossShot = 2;
    this.bossAngle = 0;
    this.volley = 0;
    this.bossItemsSent = 0;
    this.partHp.fill(0);
    this.partHp.fill(def.partHp, 0, def.parts);
    this.announce('WARNING / ' + def.id + ' 接近', 4);
    this.warningEvent++;
  }
  private updateBoss(dt: number) {
    this.bossTime += dt;
    // A boss fight is the one stretch of a stage with no scripted items, and
    // by far the longest single stretch without a power-up - so it gets its
    // own clock instead, guaranteeing one every 20 seconds rather than
    // leaving the player to fight the whole encounter on whatever loadout
    // they arrived with.
    const itemsDue = Math.floor(this.bossTime / 20);
    if (itemsDue > this.bossItemsSent) {
      this.bossItemsSent = itemsDue;
      const type = this.rng.next() < 0.5 ? 0 : 1;
      const y = clamp((this.rng.next() - 0.5) * 10, this.stage.minY + 1, this.stage.maxY - 1);
      this.items.acquire(12, y, -4, 0, type, 12, 0.5);
    }
    this.bossX += (10 - this.bossX) * dt * 0.65;
    this.bossY = Math.sin(this.bossTime * 0.45) * 1.6;
    this.bossAngle += dt * (0.22 + this.bossPhase * 0.08);
    const parts = this.bossParts,
      ring = this.bossDef.ringRadius;
    for (let p = 0; p < parts; p++) {
      const a = this.bossAngle + (p / parts) * Math.PI * 2;
      this.partX[p] = this.bossX + Math.cos(a) * ring;
      this.partY[p] = this.bossY + Math.sin(a) * ring;
    }
    const full = this.bossDef.hp;
    const phase = this.bossHp > full * 0.6 ? 1 : this.bossHp > full * 0.25 ? 2 : 3;
    if (phase !== this.bossPhase) {
      this.bossPhase = phase;
      this.bossTransition = 2;
      this.bullets.clear();
      this.pendingSalvos.length = 0;
      this.shake = 0.4;
      this.announce('PHASE 0' + phase + ' / 패턴 변경', 2);
      this.warningEvent++;
    }
    if (this.bossTransition > 0) {
      this.bossTransition -= dt;
      return;
    }
    this.bossShot -= dt;
    if (this.bossShot <= 0) {
      this.bossShot =
        (this.bossPhase === 1 ? 1.9 : this.bossPhase === 2 ? 1.55 : 1.2) *
        [1, 0.88, 0.76, 0.65, 0.58][this.stageIndex] *
        (this.bossTime > tuning.combat.bossLimit ? 0.8 : 1);
      const aim = Math.atan2(this.y - this.bossY, this.x - this.bossX);
      const colors = [0xff9a70, 0xffd377, 0xd1b2ff, 0x80efe4, 0xb0a8ff];
      this.queueSalvo(
        bossSalvo(this.stageIndex, this.bossPhase, this.volley, aim),
        'boss',
        -1,
        4.4,
        colors[this.stageIndex],
      );
      for (let pod = 0; pod < this.bossParts; pod++) {
        if (this.partHp[pod] <= 0) continue;
        const angle = Math.atan2(this.y - this.partY[pod], this.x - this.partX[pod]);
        const plan: SalvoShot[] = [];
        if (this.stageIndex === 0) {
          for (const side of [-1, 1])
            plan.push({
              mount: 0,
              dx: 0,
              dy: side * 0.17,
              angle: angle + side * 0.13,
              speed: 0.85,
              kind: Shot.ORB,
              delay: 0.2,
            });
        } else if (this.stageIndex === 1) {
          for (let j = 0; j < 3; j++)
            plan.push({
              mount: 0,
              dx: 0,
              dy: 0,
              angle,
              speed: 1.0 + j * 0.1,
              kind: Shot.NEEDLE,
              delay: j * 0.12,
            });
        } else if (this.stageIndex === 2) {
          for (let j = 0; j < 3; j++)
            plan.push({
              mount: 0,
              dx: 0,
              dy: 0,
              angle: angle + (j - 1) * 0.32,
              speed: 0.7,
              kind: Shot.PLASMA,
              delay: j * 0.15,
            });
        } else {
          for (let j = 0; j < 2; j++)
            plan.push({
              mount: 0,
              dx: 0,
              dy: 0,
              angle: angle + (j ? 0.21 : -0.21),
              speed: 0.8,
              kind: Shot.WAVE,
              delay: pod * 0.055 + j * 0.22,
            });
        }
        this.queueSalvo(plan, 'boss', pod, 4.6, colors[this.stageIndex]);
      }
      this.volley++;
    }
    if (this.effects[4] > 0) {
      this.bossHp -= 90 * dt;
      if (this.bossHp <= 0) this.finish(true);
    }
  }
  private updateBullets(dt: number, enemyDt: number) {
    const b = this.bullets;
    for (let i = 0; i < b.limit; i++) {
      if (!b.active[i]) continue;
      b.px[i] = b.x[i];
      b.py[i] = b.y[i];
      b.age[i] += dt;
      if (b.type[i] === 2) {
        let tx = this.boss ? this.bossX : 25,
          ty = this.boss ? this.bossY : b.y[i],
          best = 10000;
        for (let j = 0; j < this.enemies.limit; j++) {
          if (!this.enemies.active[j] || this.enemies.x[j] < b.x[i] - 2) continue;
          const d = (this.enemies.x[j] - b.x[i]) ** 2 + (this.enemies.y[j] - b.y[i]) ** 2;
          if (d < best) {
            best = d;
            tx = this.enemies.x[j];
            ty = this.enemies.y[j];
          }
        }
        const a = Math.atan2(ty - b.y[i], tx - b.x[i]);
        b.vx[i] += (Math.cos(a) * 22 - b.vx[i]) * dt * 3;
        b.vy[i] += (Math.sin(a) * 22 - b.vy[i]) * dt * 3;
      }
      if (b.type[i] === 4 && this.terrain) {
        const deck = this.surfaceAt(b.x[i]);
        if (b.y[i] <= deck + 0.2) {
          this.detonate(b.x[i], deck);
          b.release(i);
          continue;
        }
      }
      if (b.type[i] === 5 && this.roof) {
        const vault = this.surfaceAt(b.x[i], true);
        if (b.y[i] >= vault - 0.2) {
          this.detonate(b.x[i], vault);
          b.release(i);
          continue;
        }
      }
      if (b.type[i] === 1 && this.steerShot(i, enemyDt)) continue;
      const t = b.type[i] === 1 ? enemyDt : dt;
      b.x[i] += b.vx[i] * t;
      b.y[i] += b.vy[i] * t;
      if (
        Math.abs(b.x[i]) > 23 * this.worldScale ||
        Math.abs(b.y[i] - this.cameraFollowY) > 13 ||
        b.age[i] > 12
      )
        b.release(i);
    }
  }
  /**
   * Applies one hostile projectile's flight rule for the frame.
   * Returns true when the shot consumed itself (a splitter), so the caller
   * skips the usual integration step.
   */
  private steerShot(i: number, dt: number) {
    const b = this.bullets;
    switch (b.kind[i]) {
      // Weaves around its launch heading without drifting off course.
      case Shot.WAVE: {
        const a = b.heading[i],
          cruise = b.param[i],
          lateral = Math.cos(b.age[i] * 7.5) * 3.2;
        b.vx[i] = Math.cos(a) * cruise - Math.sin(a) * lateral;
        b.vy[i] = Math.sin(a) * cruise + Math.cos(a) * lateral;
        break;
      }
      // Lobbed shells: lazy on release, dangerous by the time they arrive.
      case Shot.ACCEL: {
        if (b.vx[i] * b.vx[i] + b.vy[i] * b.vy[i] < 196) {
          const gain = 1 + b.param[i] * dt;
          b.vx[i] *= gain;
          b.vy[i] *= gain;
        }
        break;
      }
      // Steers for a couple of seconds, then commits to its heading.
      case Shot.HOMING: {
        if (b.param[i] > 0) {
          b.param[i] -= dt;
          const speed = Math.hypot(b.vx[i], b.vy[i]) || 1;
          const want = Math.atan2(this.y - b.y[i], this.x - b.x[i]);
          const diff = Math.atan2(Math.sin(want - b.heading[i]), Math.cos(want - b.heading[i]));
          b.heading[i] += clamp(diff, -1.7 * dt, 1.7 * dt);
          b.vx[i] = Math.cos(b.heading[i]) * speed;
          b.vy[i] = Math.sin(b.heading[i]) * speed;
        }
        break;
      }
      // Bursts into a three way fan once its fuse runs out.
      case Shot.SPLIT: {
        b.param[i] -= dt;
        if (b.param[i] <= 0) {
          const speed = Math.hypot(b.vx[i], b.vy[i]) || 3,
            a = b.heading[i],
            x = b.x[i],
            y = b.y[i];
          const tint = b.tint[i];
          b.release(i);
          for (let k = -1; k <= 1; k++)
            this.hostileShot(x, y, a + k * 0.44, speed * 0.92, Shot.ORB, tint);
          return true;
        }
        break;
      }
      // Rebounds off the top and bottom of the play field a few times.
      case Shot.BOUNCE: {
        if (b.param[i] > 0 && (b.y[i] > 7 || b.y[i] < -7)) {
          b.param[i] -= 1;
          b.vy[i] *= -1;
          b.y[i] = clamp(b.y[i], -6.98, 6.98);
          b.py[i] = b.y[i];
          b.heading[i] = Math.atan2(b.vy[i], b.vx[i]);
        }
        break;
      }
      // Heavy plasma sheds speed, so it lingers as a moving wall.
      case Shot.PULSE: {
        const drag = 1 - 0.22 * dt;
        b.vx[i] *= drag;
        b.vy[i] *= drag;
        break;
      }
      // Blooms as it travels; late graze attempts are punished.
      case Shot.PLASMA:
        b.radius[i] = Math.min(b.radius[i] + 0.05 * dt, 0.34);
        break;
    }
    return false;
  }
  private collisions() {
    const b = this.bullets,
      e = this.enemies;
    this.grid.clear();
    this.bulletGrid.clear();
    for (let i = 0; i < e.limit; i++) if (e.active[i]) this.grid.insert(i, e.x[i], e.y[i]);
    for (let i = 0; i < b.limit; i++)
      if (b.active[i] && b.type[i] === 1) this.bulletGrid.insert(i, b.x[i], b.y[i]);
    this.groundGrid.clear();
    for (let i = 0; i < this.ground.limit; i++)
      if (this.ground.active[i]) this.groundGrid.insert(i, this.ground.x[i], this.ground.y[i]);
    const r = this.rocks;
    for (let i = 0; i < b.limit; i++) {
      if (!b.active[i] || b.type[i] === 1) continue;
      // Bombs are the only thing that can touch the surface, and the only
      // thing the air wing can safely ignore.
      if (b.type[i] === 4 || b.type[i] === 5) {
        this.groundGrid.query(b.x[i], b.y[i], 2.4);
        for (let n = 0; n < this.groundGrid.resultCount; n++) {
          const j = this.groundGrid.results[n];
          if (!this.ground.active[j]) continue;
          if (
            segmentCircle(
              b.px[i],
              b.py[i],
              b.x[i],
              b.y[i],
              this.ground.x[j],
              this.ground.y[j] + this.ground.radius[j] * (this.ground.aux[j] === 1 ? -0.5 : 0.5),
              this.ground.radius[j] + b.radius[i],
            )
          ) {
            this.detonate(b.x[i], b.y[i]);
            b.release(i);
            break;
          }
        }
        continue;
      }
      // A rock is solid: whatever it stops never reaches the ships behind it,
      // piercing rounds included.
      for (let j = 0; j < r.limit && b.active[i]; j++) {
        if (
          r.active[j] &&
          segmentCircle(b.px[i], b.py[i], b.x[i], b.y[i], r.x[j], r.y[j], r.radius[j] + b.radius[i])
        ) {
          this.damageRock(j, b.hp[i]);
          b.release(i);
        }
      }
      if (!b.active[i]) continue;
      this.grid.query(b.x[i], b.y[i], 2.6);
      for (let n = 0; n < this.grid.resultCount; n++) {
        const j = this.grid.results[n];
        if (!e.active[j] || b.lastHit[i] === j) continue;
        if (
          segmentCircle(b.px[i], b.py[i], b.x[i], b.y[i], e.x[j], e.y[j], e.radius[j] + b.radius[i])
        ) {
          this.damageEnemy(j, b.hp[i], b.px[i], b.py[i]);
          b.lastHit[i] = j;
          if (--b.aux[i] <= 0) {
            b.release(i);
            break;
          }
        }
      }
      if (!b.active[i] || (!this.boss && !this.midBoss) || this.bossTransition > 0) continue;
      for (let p = 0; p < this.bossParts; p++) {
        if (this.partHp[p] <= 0 || !b.active[i]) continue;
        if (
          segmentCircle(
            b.px[i],
            b.py[i],
            b.x[i],
            b.y[i],
            this.partX[p],
            this.partY[p],
            0.7 + b.radius[i],
          )
        ) {
          this.partHp[p] -= b.hp[i];
          if (this.partHp[p] > 0)
            this.impact(this.partX[p], this.partY[p], 0.55, b.px[i], b.py[i], false);
          b.release(i);
          if (this.partHp[p] <= 0) {
            this.explode(this.partX[p], this.partY[p], 55);
            this.score += 4000;
          }
        }
      }
      if (
        b.active[i] &&
        segmentCircle(
          b.px[i],
          b.py[i],
          b.x[i],
          b.y[i],
          this.bossX,
          this.bossY,
          this.bossDef.coreRadius + b.radius[i],
        )
      ) {
        this.bossHp -= b.hp[i];
        this.bossFlash = 0.08;
        this.impact(this.bossX, this.bossY, this.bossDef.coreRadius, b.px[i], b.py[i], true);
        b.release(i);
        if (this.bossHp <= 0) {
          this.finish(true);
          break;
        }
      }
    }
    if (this.respawn > 0 || this.status !== 'playing') return;
    this.bulletGrid.query(this.x, this.y, 2.5);
    for (let n = 0; n < this.bulletGrid.resultCount; n++) {
      const i = this.bulletGrid.results[n];
      if (!b.active[i]) continue;
      const d = (b.x[i] - this.x) ** 2 + (b.y[i] - this.y) ** 2;
      if (this.effects[1] > 0 && d < 4) {
        b.type[i] = 0;
        b.kind[i] = 0;
        b.vx[i] = 30;
        b.vy[i] = 0;
        b.heading[i] = 0;
        b.radius[i] = 0.1;
        b.hp[i] = 2;
        b.aux[i] = 1;
        continue;
      }
      if (d < (tuning.player.grazeRadius + b.radius[i]) ** 2 && !b.grazed[i]) {
        b.grazed[i] = 1;
        this.graze = clamp(this.graze + 0.01, 1, 5);
        this.maxGraze = Math.max(this.graze, this.maxGraze);
        this.score += 10;
      }
      if (
        this.invincible <= 0 &&
        segmentCircle(
          b.px[i],
          b.py[i],
          b.x[i],
          b.y[i],
          this.x,
          this.y,
          tuning.player.hitRadius + b.radius[i] * 0.8,
        )
      ) {
        b.release(i);
        this.hit();
        break;
      }
    }
    if (this.invincible > 0) return;
    for (let j = 0; j < r.limit; j++) {
      const reach = r.radius[j] * tuning.hazards.hitScale + tuning.player.hitRadius;
      if (r.active[j] && (r.x[j] - this.x) ** 2 + (r.y[j] - this.y) ** 2 < reach ** 2) {
        this.hit();
        break;
      }
    }
    if (this.invincible > 0) return;
    this.grid.query(this.x, this.y, 2.2);
    for (let n = 0; n < this.grid.resultCount; n++) {
      const j = this.grid.results[n];
      if (
        (e.x[j] - this.x) ** 2 + (e.y[j] - this.y) ** 2 <
        (e.radius[j] + tuning.player.hitRadius) ** 2
      ) {
        this.hit();
        break;
      }
    }
    const hull = this.bossDef.coreRadius + 0.25;
    if (
      (this.boss || this.midBoss) &&
      (this.x - this.bossX) ** 2 + (this.y - this.bossY) ** 2 < hull ** 2
    )
      this.hit();
    if (this.boss || this.midBoss)
      for (let p = 0; p < this.bossParts; p++) {
        if (
          this.partHp[p] > 0 &&
          (this.x - this.partX[p]) ** 2 + (this.y - this.partY[p]) ** 2 < 0.8 ** 2
        )
          this.hit();
      }
  }
  /**
   * Marks a hit on an armoured target: a small blast on the hull's surface on
   * the side the shot came from, a few sparks, and a hit event for the audio.
   */
  private impact(
    cx: number,
    cy: number,
    radius: number,
    fromX: number,
    fromY: number,
    heavy: boolean,
  ) {
    const dx = fromX - cx,
      dy = fromY - cy,
      length = Math.hypot(dx, dy) || 1;
    // A little scatter so a stream of hits reads as separate blasts.
    const reach = radius * (0.55 + this.rng.next() * 0.35);
    const k = this.impactHead++ % IMPACTS;
    this.impactX[k] = cx + (dx / length) * reach + (this.rng.next() - 0.5) * radius * 0.5;
    this.impactY[k] = cy + (dy / length) * reach + (this.rng.next() - 0.5) * radius * 0.5;
    this.impactAge[k] = 0;
    this.impactHeavy[k] = heavy ? 1 : 0;
    this.armourHitEvent++;
    for (let n = 0; n < 3; n++) {
      const a = this.rng.next() * Math.PI * 2,
        speed = 3 + this.rng.next() * 4;
      this.particles.acquire(
        this.impactX[k],
        this.impactY[k],
        Math.cos(a) * speed,
        Math.sin(a) * speed,
        n % 2,
        0.16 + this.rng.next() * 0.12,
        0.05 + this.rng.next() * 0.04,
      );
    }
  }
  damageEnemy(i: number, damage: number, fromX = this.x, fromY = this.y) {
    if (!this.enemies.active[i]) return;
    this.enemies.hp[i] -= damage;
    if (this.enemies.hp[i] > 0) {
      this.enemyFlash[i] = 0.09;
      if (fleetHardpoints[this.enemies.type[i]].size === 'medium')
        this.impact(
          this.enemies.x[i],
          this.enemies.y[i],
          this.enemies.radius[i],
          fromX,
          fromY,
          false,
        );
      // Two sparks off the hull. The pool refuses when it is full, so a wall
      // of simultaneous hits costs nothing extra.
      for (let k = 0; k < 2; k++) {
        const a = this.rng.next() * Math.PI * 2;
        this.particles.acquire(
          this.enemies.x[i],
          this.enemies.y[i],
          Math.cos(a) * 3.5,
          Math.sin(a) * 3.5,
          2,
          0.12,
          0.05,
        );
      }
      return;
    }
    const e = this.enemies;
    this.kills++;
    this.score += Math.floor(defs[e.type[i]].score * this.graze);
    this.burst(e.x[i], e.y[i], defs[e.type[i]].burst);
    for (let s = 0; s < 3; s++)
      if (this.skills[s] >= 0)
        this.charge[s] = Math.min(1, this.charge[s] + 1 / tuning.skills[this.skills[s]].kills);
    if (this.kills % 12 === 0) this.rank = clamp(this.rank + 1, 0, 100);
    // Carriers are the supply line, on a fixed rotation: power, option, then
    // nothing. Everything else drops only on a rare roll, so the bulk of the
    // player's power now comes back from the wrecks of their own ships.
    if (e.type[i] === 2) {
      const slot = this.dropCounter++ % 3;
      if (slot < 2) this.items.acquire(e.x[i], e.y[i], -4, 0, slot, 12, 0.5);
    } else if (this.rng.next() < tuning.combat.dropChance)
      this.items.acquire(e.x[i], e.y[i], -4, 0, 0, 12, 0.5);
    if (e.type[i] === 3 && !this.skillUnlocked)
      this.items.acquire(e.x[i], e.y[i], -4, 0, 3, 12, 0.5);
    e.release(i);
  }
  hit() {
    if (this.bossDying) return;
    if (this.invincible > 0 || this.respawn > 0) return;
    this.hitEvent++;
    this.shake = 0.8;
    this.flash = 0.5;
    if (this.shield > 0) {
      this.shield--;
      this.invincible = 0.8;
      return;
    }
    this.explode(this.x, this.y, 65);
    this.lives--;
    this.deaths++;
    this.graze = 1;
    // A destroyed ship comes back with both specials armed and ready - a
    // guaranteed way back into the fight rather than leaving the comeback to
    // however charge happened to sit at the moment of death.
    this.skillUnlocked = true;
    this.charge[0] = 1;
    this.charge[1] = 1;
    // Losing a well-upgraded ship costs the most, so it drops the most back:
    // three at Lv.8, two from Lv.3, one below that. These are the main way
    // power returns to the player, which is why enemy drops stay rare.
    const relief = this.level >= 8 ? 3 : this.level >= 3 ? 2 : 1;
    for (let i = 0; i < relief; i++)
      this.items.acquire(
        clamp(this.x + 2 + i * 1.5, tuning.world.minX, 11),
        clamp(this.y + (i - (relief - 1) / 2) * 1.6, -6, 6),
        -2.2,
        0,
        0,
        14,
        0.5,
      );
    this.level = Math.max(1, this.level - tuning.combat.powerPenalty);
    this.rank = Math.max(0, this.rank - 15);
    // The options break away as rings to be caught again, all but the one the
    // ship always carries.
    for (let i = 1; i < this.optionCount; i++)
      this.items.acquire(this.optionX[i], this.optionY[i], -1, 0, 1, 8, 0.5);
    this.optionCount = 1;
    this.respawn = 1.5;
    this.invincible = 3.5;
    if (this.lives <= 0) {
      this.status = this.creditsUsed < this.credits ? 'continue' : 'gameover';
      this.continueTime = 10;
    }
  }
  private updateItems(dt: number) {
    const a = this.items;
    for (let i = 0; i < a.limit; i++) {
      if (!a.active[i]) continue;
      a.px[i] = a.x[i];
      a.py[i] = a.y[i];
      a.age[i] += dt;
      const dx = this.x - a.x[i],
        dy = this.y - a.y[i],
        d = dx * dx + dy * dy;
      if (d < 36 && this.respawn <= 0) {
        const length = Math.sqrt(d) || 1;
        a.x[i] += (dx / length) * 12 * dt;
        a.y[i] += (dy / length) * 12 * dt;
      } else {
        a.x[i] += a.vx[i] * dt;
        a.y[i] += ((Math.cos((a.age[i] * Math.PI * 2) / 1.2) * 0.8 * Math.PI * 2) / 1.2) * dt;
      }
      if (d < 0.75 && this.respawn <= 0) {
        const type = a.type[i];
        if (type === 0) {
          if (this.level < 8) {
            this.level++;
            this.rank = clamp(this.rank + 2, 0, 100);
          } else this.score += 5000;
          this.announce('POWER UP / Lv.' + this.level, 1.3);
        } else if (type === 1) {
          this.optionCount = Math.min(4, this.optionCount + 1);
          this.announce('OPTION ONLINE / ' + this.optionCount, 1.3);
        } else if (type === 2) {
          this.shield = 3;
          this.announce('SHIELD / 3 HITS', 1.3);
        } else {
          this.skillUnlocked = true;
          this.charge[0] = 1;
          this.announce('OVERDRIVE 획득 / [1] 발동', 3);
        }
        this.pickupEvent++;
        this.pickupEventsByType[type]++;
        a.release(i);
      } else if (a.x[i] < -18 * this.worldScale || a.age[i] > 15) {
        this.score = Math.max(0, this.score - 500);
        a.release(i);
      }
    }
  }
  /** The wreck a specific hull leaves: its own shape, colour and weight. */
  private burst(x: number, y: number, b: (typeof defs)[number]['burst']) {
    this.explosionEvent++;
    // Debris count stands in for mass: a skiff puffs, a cruiser comes apart.
    this.explosionHeavy = b.count >= 34;
    this.shake = Math.max(this.shake, b.shake);
    for (let j = 0; j < b.count; j++) {
      // A ring burst throws its debris out evenly; everything else scatters.
      const a = b.ring
        ? (j / b.count) * Math.PI * 2 + this.rng.next() * 0.25
        : this.rng.next() * Math.PI * 2;
      const speed = b.speed + this.rng.next() * b.spread;
      this.particles.acquire(
        x,
        y,
        Math.cos(a) * speed,
        Math.sin(a) * speed,
        b.palette[j % b.palette.length],
        b.life * (0.6 + this.rng.next() * 0.8),
        b.size * (0.5 + this.rng.next()),
      );
    }
  }
  explode(x: number, y: number, count: number) {
    this.explosionEvent++;
    this.explosionHeavy = count >= 40;
    this.shake = Math.max(this.shake, count > 40 ? 0.4 : 0.08);
    for (let j = 0; j < count; j++) {
      const a = this.rng.next() * Math.PI * 2,
        s = 2 + this.rng.next() * 8;
      this.particles.acquire(
        x,
        y,
        Math.cos(a) * s,
        Math.sin(a) * s,
        j % 3,
        0.3 + this.rng.next() * 0.6,
        0.06 + this.rng.next() * 0.13,
      );
    }
  }
  private finish(defeated: boolean) {
    if (defeated && !this.bossDying) {
      this.bossHp = 0;
      this.bossDying = true;
      this.bossDeathTime = 0;
      this.bossKillTime = this.bossTime;
      this.bossDeathEvent++;
      this.novaActive = false;
      this.bullets.clear();
      this.pendingSalvos.length = 0;
      this.enemies.clear();
      this.ground.clear();
      this.rocks.clear();
      this.noticeTime = 0;
      this.shake = 0.5;
      return;
    }
    if (this.midBoss) {
      // The mid-boss going down ends only its own fight - the stage (and the
      // run) keeps going, unlike the real boss's finish below.
      this.midBoss = false;
      this.midBossDefeated = defeated;
      this.bossHp = 0;
      this.bossDying = false;
      this.bullets.clear();
      this.pendingSalvos.length = 0;
      if (defeated) this.announce('MID-BOSS DOWN / 전투 속개', 3);
      return;
    }
    this.bossDefeated = defeated;
    // Whatever the player finishes a stage with is what they start the next
    // one with; a death mid-stage has already taken its cut by now.
    this.loadout.level = this.level;
    this.loadout.optionCount = this.optionCount;
    this.loadout.shield = this.shield;
    this.boss = false;
    this.bossKillTime = this.bossTime;
    this.bossHp = 0;
    this.bonus =
      (this.deaths === 0 ? tuning.score.noMiss : 0) +
      this.level * tuning.score.powerBonus +
      (defeated ? Math.floor(Math.max(0, 1 - this.bossTime / 180) * 100000) : 0);
    this.score += this.bonus + (defeated ? tuning.score.boss : 0);
    this.bullets.clear();
    this.pendingSalvos.length = 0;
    this.bossDying = false;
    this.status = 'clear';
  }
  /** Fixed-step cinematic stays in the replay, with combat frozen for seven seconds. */
  private updateBossDeath(dt: number) {
    const before = this.bossDeathTime;
    this.bossDeathTime = Math.min(7, before + dt);
    const t = this.bossDeathTime;
    this.particles.move(dt);
    // Sweep detonations over the whole silhouette, not just the central reactor.
    if (Math.floor(t * 9) > Math.floor(before * 9) && t < 6.7) {
      const n = Math.floor(t * 9);
      const a = n * 2.399963;
      const r = 0.6 + (n % 7) * 0.48;
      this.explode(
        this.bossX + Math.cos(a) * r,
        this.bossY + Math.sin(a) * r * 0.85,
        t > 4.5 ? 65 : 32,
      );
      this.shake = t > 4.5 ? 0.55 : 0.22;
      this.flash = t > 4.5 ? 0.12 : 0.04;
    }
    if (before < 6.65 && t >= 6.65) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        this.explode(this.bossX + Math.cos(a) * 2.3, this.bossY + Math.sin(a) * 2.3, 110);
      }
      this.flash = 0.75;
      this.shake = 0.9;
    }
    if (t >= 7 - 1e-8) this.finish(true);
  }
  startStress() {
    this.status = 'stress';
    this.bullets.clear();
    this.pendingSalvos.length = 0;
    this.enemies.clear();
    this.items.clear();
    this.particles.clear();
    this.rocks.clear();
    this.boss = false;
    this.setStressCount(this.stressCount);
  }
  setStressCount(count: number) {
    this.stressCount = count;
    this.bullets.clear();
    this.pendingSalvos.length = 0;
    for (let i = 0; i < count; i++) {
      const a = this.rng.next() * Math.PI * 2;
      this.bullets.fire(
        this.rng.next() * 32 - 16,
        this.rng.next() * 16 - 8,
        Math.cos(a) * 3,
        Math.sin(a) * 3,
        1,
        0.12,
      );
    }
  }
  private tickStress(dt: number) {
    this.time += dt;
    const b = this.bullets;
    for (let i = 0; i < b.limit; i++) {
      if (!b.active[i]) continue;
      b.px[i] = b.x[i];
      b.py[i] = b.y[i];
      b.x[i] += b.vx[i] * dt;
      b.y[i] += b.vy[i] * dt;
      if (b.x[i] > 16 || b.x[i] < -16) b.vx[i] *= -1;
      if (b.y[i] > 8 || b.y[i] < -8) b.vy[i] *= -1;
    }
    this.bulletGrid.clear();
    for (let i = 0; i < b.limit; i++) if (b.active[i]) this.bulletGrid.insert(i, b.x[i], b.y[i]);
    this.bulletGrid.query(0, 0, 1);
  }
}
