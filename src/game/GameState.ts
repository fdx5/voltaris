import { formationPosition } from './formations';
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
export type Status = 'menu' | 'playing' | 'paused' | 'continue' | 'gameover' | 'clear' | 'stress';
export const MODES: Mode[] = ['TRAIL', 'FREEZE', 'DIRECTIONAL', 'ROTATE'];
/** What holding the control key does in each mode, for the on-screen notice. */
export const MODE_NOTE = ['밀착 대형', '위치 고정', '진행 방향 조준', '기체 공전'];
/** Frames an option lags behind the ship's path, per option, while trailing. */
const TRAIL_LAG = 22;
export class GameState {
  readonly bullets = new BulletPool(tuning.pools.bullets);
  readonly enemies = new ObjectPool(tuning.pools.enemies);
  readonly particles = new ObjectPool(tuning.pools.particles);
  readonly items = new ObjectPool(tuning.pools.items);
  /** Emplacements riding the scrolling surface of a ground stage. */
  readonly ground = new ObjectPool(tuning.pools.ground);
  readonly groundFlash = new Float32Array(tuning.pools.ground);
  readonly groundGrid = new SpatialHash(tuning.pools.ground);
  /** Seconds of hit flash left on each live enemy, so a hull that is being
   *  worn down reads as taking damage rather than shrugging it off. */
  readonly enemyFlash = new Float32Array(tuning.pools.enemies);
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
  readonly effects = new Float32Array(6);
  readonly partHp = new Float32Array(8);
  readonly partX = new Float32Array(8);
  readonly partY = new Float32Array(8);
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
  bossDefeated = false;
  bossKillTime = 0;
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
    this.enemies.clear();
    this.particles.clear();
    this.items.clear();
    this.ground.clear();
    this.groundFlash.fill(0);
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
    this.bossPhase = 1;
    this.bossDefeated = false;
    this.bossTime = this.bonus = this.bossKillTime = this.volley = 0;
    this.effects.fill(0);
    this.skills.set([0, -1, -1]);
    this.skillUnlocked = practice;
    this.charge.fill(practice ? 1 : 0);
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
    this.status = 'playing';
    this.announce('RE-ENTRY / 전투 재개');
  }
  activate(slot: number) {
    if (this.status !== 'playing' || this.respawn > 0 || slot < 0 || slot > 2) return;
    const skill = this.skills[slot];
    if (skill < 0 || this.charge[slot] < 0.999 || (!this.skillUnlocked && skill === 0)) return;
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
      for (let i = 0; i < this.enemies.capacity; i++)
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
    this.invincible = Math.max(0, this.invincible - dt);
    this.respawn = Math.max(0, this.respawn - dt);
    for (let i = 0; i < 6; i++) this.effects[i] = Math.max(0, this.effects[i] - dt);
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
    this.updateEnemies(enemyDt);
    if (this.terrain) this.updateGround(enemyDt);
    if (this.boss) this.updateBoss(enemyDt);
    this.fireTimer -= dt;
    const firing = !this.respawn && (this.autoFire || bits & Key.Fire);
    // Held-fire time must not bank credit: without the clamp a 1.5s respawn
    // leaves the timer 1.5s in debt and the ship fires once per tick on the
    // way back out, welding its bolts into one solid beam.
    if (!firing) this.fireTimer = Math.max(this.fireTimer, 0);
    else if (this.fireTimer <= 0) {
      this.fireTimer += 1 / weapons[this.weapon][this.level - 1].rate;
      this.fireWeapon(this.x + 0.7, this.y, 0);
      for (let i = 0; i < this.optionCount; i++)
        this.fireWeapon(this.optionX[i], this.optionY[i], this.optionAngle[i]);
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
  private fireWeapon(x: number, y: number, angle: number) {
    const w = weapons[this.weapon][this.level - 1];
    const damage = w.damage * (this.effects[0] > 0 ? 2 : 1);
    for (let j = 0; j < w.count; j++) {
      const mid = j - (w.count - 1) / 2;
      const a =
        angle + (this.weapon === 'SPREAD' ? mid * 0.13 : this.weapon === 'MISSILE' ? mid * 0.2 : 0);
      this.bullets.fire(
        x,
        y + (this.weapon === 'LASER' ? mid * 0.3 : 0),
        Math.cos(a) * (this.weapon === 'MISSILE' ? 18 : 30),
        Math.sin(a) * (this.weapon === 'MISSILE' ? 18 : 30),
        this.weapon === 'MISSILE' ? 2 : 0,
        w.width,
        damage,
        w.pierce,
      );
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
    for (let i = 0; i < g.capacity; i++) {
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
      const count = this.waveSize(wave.count, ordinal);
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
        );
        this.spawnEnemy(wave.type, pos.x, pos.y, 3 + (ordinal % 6), 0);
        this.laneLeft[lane]--;
      }
      this.laneWave[lane] = -1;
    }
    while (
      this.spawnIndex < this.stage.spawns.length &&
      this.time >= this.stage.spawns[this.spawnIndex].time
    ) {
      const lane = this.laneWave.indexOf(-1);
      if (lane < 0) break;
      const ordinal = this.spawnIndex++;
      this.laneWave[lane] = ordinal;
      this.laneLeft[lane] = this.waveSize(this.stage.spawns[ordinal].count, ordinal);
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
        const x = 17.4;
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
        this.groundTimer = 0.35;
      }
    }
    if (
      this.itemIndex < this.stage.items.length &&
      this.time >= this.stage.items[this.itemIndex].time
    ) {
      const item = this.stage.items[this.itemIndex++];
      this.items.acquire(12, item.y, -4, 0, item.type, 12, 0.5);
    }
    if (this.time >= this.stage.durationSec && !this.boss && !this.bossDefeated) this.spawnBoss();
  }
  /**
   * The first formation launches three ships, the next four, and so on: a
   * ceiling that opens by one per wave until each formation's authored size
   * takes over. Heavy hulls are authored one or two strong and are unaffected.
   */
  private waveSize(count: number, ordinal: number) {
    return Math.max(1, Math.min(count, this.stage.firstWave + ordinal * tuning.spawn.growth));
  }
  private spawnEnemy(type: number, x: number, y: number, pattern: number, n: number) {
    const d = defs[type];
    const hp = Math.max(1, Math.round(d.hp * this.hullScale));
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
    for (let i = 0; i < e.capacity; i++) {
      if (!e.active[i]) continue;
      const d = defs[e.type[i]];
      e.px[i] = e.x[i];
      e.py[i] = e.y[i];
      e.age[i] += dt;
      this.enemyFlash[i] = Math.max(0, this.enemyFlash[i] - dt);
      // Turret hulls brake into their lane, hold it, then run for the edge.
      if (d.hover > -50 && e.x[i] <= d.hover && e.age[i] < 13) e.vx[i] -= e.vx[i] * dt * 2.6;
      else if (e.vx[i] > -d.speed) e.vx[i] += (-d.speed - e.vx[i]) * dt * 1.5;
      e.x[i] += e.vx[i] * dt;
      const a = e.age[i];
      const weave = e.aux[i] >= 3 ? 0.18 : e.aux[i] === 1 ? 1.5 : 0.65;
      e.y[i] = e.life[i] + Math.sin(a * (e.aux[i] === 1 ? 2 : 1.3) * d.freq) * weave * d.amp;
      if (e.x[i] < -18) {
        e.release(i);
        continue;
      }
      const period = this.firePeriod(e.type[i]);
      if (a > 0.45 && a % period >= period - dt && e.x[i] < 16.5)
        this.fireVolley(e.x[i] - 0.4, e.y[i], a, d.fire);
    }
  }
  /**
   * Emplacements do not move under their own power: the surface carries them,
   * so `x + scroll` stays put and each one keeps its spot on the ground.
   */
  private updateGround(dt: number) {
    const g = this.ground,
      speed = this.stage.surface!.speed;
    for (let i = 0; i < g.capacity; i++) {
      if (!g.active[i]) continue;
      const d = emplacements[g.type[i]];
      g.px[i] = g.x[i];
      g.py[i] = g.y[i];
      g.age[i] += dt;
      this.groundFlash[i] = Math.max(0, this.groundFlash[i] - dt);
      g.x[i] -= speed * dt;
      g.y[i] = this.surfaceAt(g.x[i], g.aux[i] === 1);
      if (g.x[i] < -18) {
        g.release(i);
        continue;
      }
      const period = d.period / (1 + this.rank * 0.006) / this.stage.pressure;
      // A roof mount's muzzle hangs below its footing, not above it.
      const muzzle = g.aux[i] === 1 ? -d.radius : d.radius;
      if (g.age[i] > 0.6 && g.age[i] % period >= period - dt && g.x[i] < 15)
        this.fireVolley(g.x[i], g.y[i] + muzzle, g.age[i], d.fire);
    }
  }
  /** Launches one hostile shot and seeds the scratch its flight rule needs. */
  private hostileShot(x: number, y: number, angle: number, speed: number, kind: number) {
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
    return this.bullets.fire(
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
  }
  private fireVolley(x: number, y: number, a: number, f: (typeof defs)[number]['fire']) {
    const speed = tuning.combat.enemyBulletSpeed * f.speed * (1 + this.rank * 0.0035);
    // Volley size is scaled per stage too, never below a single shot.
    const count = Math.max(1, Math.round(f.count * this.stage.volley));
    const mid = (count - 1) / 2;
    const aim = Math.atan2(this.y - y, this.x - x);
    switch (f.pattern) {
      case 'ring':
        for (let j = 0; j < count; j++)
          this.hostileShot(x, y, (j / count) * Math.PI * 2 + a * 0.6, speed, f.kind);
        break;
      case 'spiral':
        for (let j = 0; j < count; j++)
          this.hostileShot(x, y, (j / count) * Math.PI * 2 + a * 2.1, speed, f.kind);
        break;
      case 'cross':
        for (let j = 0; j < count; j++)
          this.hostileShot(
            x,
            y,
            (j / count) * Math.PI * 2 + Math.sin(a * 0.5) * 0.4,
            speed,
            f.kind,
          );
        break;
      // A tight stream down one line: the tail catches up with the head.
      case 'burst':
        for (let j = 0; j < count; j++)
          this.hostileShot(x, y, aim + (j - mid) * f.spread, speed * (1 + j * 0.16), f.kind);
        break;
      // Slow shells thrown flat that pick up speed on the way in.
      case 'lob':
        for (let j = 0; j < count; j++)
          this.hostileShot(x, y, Math.PI + (j - mid) * f.spread, speed, f.kind);
        break;
      // Two parallel streams off the wingtips, tail catching the head.
      case 'twin':
        for (let j = 0; j < count; j++)
          for (const side of [-1, 1])
            this.hostileShot(x, y + side * f.spread, aim, speed * (1 + j * 0.13), f.kind);
        break;
      // A rosette: petals of three, the whole flower turning between volleys.
      case 'petal':
        for (let j = 0; j < count; j++) {
          const base = (j / count) * Math.PI * 2 + a * 0.8;
          for (let k = -1; k <= 1; k++) this.hostileShot(x, y, base + k * f.spread, speed, f.kind);
        }
        break;
      // A fan that swings across the field like a searchlight.
      case 'sweep': {
        const centre = Math.PI + Math.sin(a * 0.9) * 1.05;
        for (let j = 0; j < count; j++)
          this.hostileShot(x, y, centre + (j - mid) * f.spread, speed, f.kind);
        break;
      }
      // Shells rolled off a column, each falling away at its own angle.
      case 'rain':
        for (let j = 0; j < count; j++)
          this.hostileShot(
            x,
            y + (j - mid) * f.spread,
            Math.PI - 0.85 + (j / (count - 1 || 1)) * 1.7,
            speed,
            f.kind,
          );
        break;
      // A rank of shots abreast, advancing as one line.
      case 'wall':
        for (let j = 0; j < count; j++)
          this.hostileShot(x, y + (j - mid) * f.spread, Math.PI, speed, f.kind);
        break;
      default:
        for (let j = 0; j < count; j++)
          this.hostileShot(x, y, aim + (j - mid) * f.spread, speed, f.kind);
    }
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
  /** Pods mounted on the current boss. */
  get bossParts() {
    return this.stage.boss.parts;
  }
  spawnBoss() {
    this.boss = true;
    this.bossHp = this.stage.boss.hp;
    this.bossX = 20;
    this.bossY = 0;
    this.bossTime = 0;
    this.bossPhase = 1;
    this.bossTransition = 2;
    this.bossShot = 2;
    this.bossAngle = 0;
    this.volley = 0;
    this.partHp.fill(0);
    this.partHp.fill(this.stage.boss.partHp, 0, this.bossParts);
    this.announce('WARNING / ' + this.stage.boss.id + ' 接近', 4);
    this.warningEvent++;
  }
  private updateBoss(dt: number) {
    this.bossTime += dt;
    this.bossX += (10 - this.bossX) * dt * 0.65;
    this.bossY = Math.sin(this.bossTime * 0.45) * 1.6;
    this.bossAngle += dt * (0.22 + this.bossPhase * 0.08);
    const parts = this.bossParts,
      ring = this.stage.boss.ringRadius;
    for (let p = 0; p < parts; p++) {
      const a = this.bossAngle + (p / parts) * Math.PI * 2;
      this.partX[p] = this.bossX + Math.cos(a) * ring;
      this.partY[p] = this.bossY + Math.sin(a) * ring;
    }
    if (this.bossTime > tuning.combat.bossLimit) {
      this.finish(false);
      return;
    }
    const full = this.stage.boss.hp;
    const phase = this.bossHp > full * 0.6 ? 1 : this.bossHp > full * 0.25 ? 2 : 3;
    if (phase !== this.bossPhase) {
      this.bossPhase = phase;
      this.bossTransition = 2;
      this.bullets.clear();
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
      this.bossShot = this.bossPhase === 1 ? 1.6 : this.bossPhase === 2 ? 1.25 : 0.9;
      if (this.stage.boss.design === 'ares') this.aresVolley();
      else if (this.stage.boss.design === 'nereid') this.nereidVolley();
      else this.gatekeeperVolley();
      this.volley++;
    }
    if (this.effects[4] > 0) {
      this.bossHp -= 90 * dt;
      if (this.bossHp <= 0) this.finish(true);
    }
  }
  /** GATEKEEPER: concentric rings, a sweeping wall, then splitting spokes. */
  private gatekeeperVolley() {
    const count = this.bossPhase === 3 ? 36 : this.bossPhase === 2 ? 19 : 26;
    const gap =
      Math.atan2(this.y - this.bossY, this.x - this.bossX) + Math.sin(this.bossTime) * 0.5;
    const ringKind =
      this.bossPhase === 3 ? Shot.SHARD : this.volley % 3 === 2 ? Shot.PULSE : Shot.ORB;
    for (let j = 0; j < count; j++) {
      // Phase 2: a sweeping wall of darts with a moving, traversable opening.
      if (this.bossPhase === 2) {
        const y = -7.2 + j * 0.8;
        const opening = Math.sin(this.bossTime * 0.55) * 4.5;
        if (Math.abs(y - opening) < 1.3) continue;
        this.hostileShot(this.bossX - 1.4, y, Math.PI, 5.3, Shot.NEEDLE);
        continue;
      }
      const angle = (j / count) * Math.PI * 2 + this.bossTime * 0.13;
      const diff = Math.atan2(Math.sin(angle - gap), Math.cos(angle - gap));
      if (Math.abs(diff) < 0.23) continue;
      // Phase 3 alternates spoke speeds; phase 1 uses concentric rings.
      const speed = this.bossPhase === 3 ? 3.8 + (j % 3) * 0.8 : 3.95;
      this.hostileShot(
        this.bossX + Math.cos(angle) * 1.4,
        this.bossY + Math.sin(angle) * 1.4,
        angle,
        speed,
        ringKind,
      );
    }
    // Every fourth volley the ring is laced with weaving shots.
    if (this.bossPhase !== 2 && this.volley % 4 === 3)
      for (let j = 0; j < 10; j++)
        this.hostileShot(
          this.bossX,
          this.bossY,
          (j / 10) * Math.PI * 2 - this.bossTime * 0.4,
          3.1,
          Shot.WAVE,
        );
    const partKind =
      this.bossPhase === 3 ? Shot.HOMING : this.bossPhase === 2 ? Shot.SPLIT : Shot.NEEDLE;
    this.podVolley(partKind, 5, 0.13, 1);
  }
  /** ARES CROWN: counter-rotating arms, closing walls, then a turning flower. */
  private aresVolley() {
    const t = this.bossTime;
    const aim = Math.atan2(this.y - this.bossY, this.x - this.bossX);
    if (this.bossPhase === 1) {
      for (let arm = 0; arm < 2; arm++) {
        const spin = arm === 0 ? t * 1.5 : -t * 1.5;
        for (let j = 0; j < 6; j++) {
          const angle = spin + (j / 6) * Math.PI * 2 + arm * Math.PI;
          this.hostileShot(
            this.bossX + Math.cos(angle) * 1.9,
            this.bossY + Math.sin(angle) * 1.9,
            angle,
            4.2,
            Shot.ORB,
          );
        }
      }
      if (this.volley % 3 === 2)
        for (let j = 0; j < 14; j++)
          this.hostileShot(this.bossX, this.bossY, (j / 14) * Math.PI * 2, 2.4, Shot.PULSE);
    } else if (this.bossPhase === 2) {
      // A full-height curtain whose gap walks, plus a homing fan through it.
      const gap = Math.sin(t * 0.7) * 4.2;
      for (let j = 0; j < 20; j++) {
        const y = -7.4 + j * 0.78;
        if (Math.abs(y - gap) < 1.5) continue;
        this.hostileShot(this.bossX - 1.8, y, Math.PI, 5.6, Shot.NEEDLE);
      }
      for (let k = -2; k <= 2; k++)
        this.hostileShot(this.bossX, this.bossY, aim + k * 0.2, 4.6, Shot.HOMING);
    } else {
      for (let j = 0; j < 9; j++) {
        const base = (j / 9) * Math.PI * 2 + t * 0.9;
        for (let k = -1; k <= 1; k++)
          this.hostileShot(
            this.bossX,
            this.bossY,
            base + k * 0.13,
            4.4 + Math.abs(k) * 0.7,
            Shot.SHARD,
          );
      }
      for (let j = 0; j < 6; j++)
        this.hostileShot(this.bossX, this.bossY, aim + (j - 2.5) * 0.26, 2.6, Shot.ACCEL);
    }
    const podKind =
      this.bossPhase === 3 ? Shot.SPLIT : this.bossPhase === 2 ? Shot.WAVE : Shot.NEEDLE;
    this.podVolley(podKind, 5.4, 0.1, this.bossPhase === 1 ? 1 : 2);
  }
  /**
   * NEREID fights the cave rather than the open field: closing pincers, a
   * drifting lattice you have to thread, then ice shed from both surfaces at
   * once. Nothing it throws is a ring or a spoke.
   */
  private nereidVolley() {
    const t = this.bossTime;
    const aim = Math.atan2(this.y - this.bossY, this.x - this.bossX);
    if (this.bossPhase === 1) {
      // Pincers: two arcs sweeping in from the roof and the deck together.
      const close = Math.sin(t * 0.5) * 0.6;
      for (const side of [-1, 1])
        for (let j = 0; j < 9; j++) {
          const a = Math.PI + side * (0.28 + j * 0.1 + close);
          this.hostileShot(this.bossX - 1.2, this.bossY + side * 1.4, a, 4.4, Shot.SHARD);
        }
      if (this.volley % 3 === 2)
        for (let j = 0; j < 5; j++)
          this.hostileShot(this.bossX, this.bossY, aim + (j - 2) * 0.16, 3.2, Shot.WAVE);
    } else if (this.bossPhase === 2) {
      // A lattice: slow columns crossed by slow rows, leaving gaps that move.
      const drift = (t * 0.9) % 2.4;
      for (let j = 0; j < 9; j++) {
        const y = -6.6 + j * 1.65 + drift;
        if (Math.abs(y) > 7.4) continue;
        this.hostileShot(this.bossX - 1.6, y, Math.PI, 2.9, Shot.PULSE);
      }
      for (let j = 0; j < 4; j++)
        this.hostileShot(
          this.bossX - 1.6,
          this.bossY,
          Math.PI + (j - 1.5) * 0.42,
          3.6,
          Shot.BOUNCE,
        );
      for (let k = -1; k <= 1; k++)
        this.hostileShot(this.bossX, this.bossY, aim + k * 0.22, 4.4, Shot.HOMING);
    } else {
      // Calving: ice falls from the vault and rises off the deck at once,
      // accelerating as it crosses the corridor.
      for (let j = 0; j < 7; j++) {
        const x = this.bossX - 2 - j * 1.9;
        this.hostileShot(x, 7.2, -Math.PI / 2 - 0.16, 2.6, Shot.ACCEL);
        this.hostileShot(x, -7.2, Math.PI / 2 - 0.16, 2.6, Shot.ACCEL);
      }
      for (let j = 0; j < 8; j++)
        this.hostileShot(this.bossX, this.bossY, aim + (j - 3.5) * 0.13, 4.8, Shot.SPLIT);
    }
    const podKind =
      this.bossPhase === 3 ? Shot.PLASMA : this.bossPhase === 2 ? Shot.NEEDLE : Shot.ORB;
    this.podVolley(podKind, 5.2, 0.11, this.bossPhase === 1 ? 1 : 2);
  }
  /** Aimed fan from every pod still standing. */
  private podVolley(kind: number, speed: number, spread: number, wing: number) {
    for (let p = 0; p < this.bossParts; p++) {
      if (this.partHp[p] <= 0) continue;
      const a = Math.atan2(this.y - this.partY[p], this.x - this.partX[p]);
      for (let k = -wing; k <= wing; k++)
        this.hostileShot(this.partX[p], this.partY[p], a + k * spread, speed, kind);
    }
  }
  private updateBullets(dt: number, enemyDt: number) {
    const b = this.bullets;
    for (let i = 0; i < b.capacity; i++) {
      if (!b.active[i]) continue;
      b.px[i] = b.x[i];
      b.py[i] = b.y[i];
      b.age[i] += dt;
      if (b.type[i] === 2) {
        let tx = this.boss ? this.bossX : 25,
          ty = this.boss ? this.bossY : b.y[i],
          best = 10000;
        for (let j = 0; j < this.enemies.capacity; j++) {
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
      if (Math.abs(b.x[i]) > 23 || Math.abs(b.y[i]) > 13 || b.age[i] > 12) b.release(i);
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
          b.release(i);
          for (let k = -1; k <= 1; k++)
            this.hostileShot(x, y, a + k * 0.44, speed * 0.92, Shot.ORB);
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
    for (let i = 0; i < e.capacity; i++) if (e.active[i]) this.grid.insert(i, e.x[i], e.y[i]);
    for (let i = 0; i < b.capacity; i++)
      if (b.active[i] && b.type[i] === 1) this.bulletGrid.insert(i, b.x[i], b.y[i]);
    this.groundGrid.clear();
    for (let i = 0; i < this.ground.capacity; i++)
      if (this.ground.active[i]) this.groundGrid.insert(i, this.ground.x[i], this.ground.y[i]);
    for (let i = 0; i < b.capacity; i++) {
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
      this.grid.query(b.x[i], b.y[i], 2.6);
      for (let n = 0; n < this.grid.resultCount; n++) {
        const j = this.grid.results[n];
        if (!e.active[j] || b.lastHit[i] === j) continue;
        if (
          segmentCircle(b.px[i], b.py[i], b.x[i], b.y[i], e.x[j], e.y[j], e.radius[j] + b.radius[i])
        ) {
          this.damageEnemy(j, b.hp[i]);
          b.lastHit[i] = j;
          if (--b.aux[i] <= 0) {
            b.release(i);
            break;
          }
        }
      }
      if (!b.active[i] || !this.boss || this.bossTransition > 0) continue;
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
          this.stage.boss.coreRadius + b.radius[i],
        )
      ) {
        this.bossHp -= b.hp[i];
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
    const hull = this.stage.boss.coreRadius + 0.25;
    if (this.boss && (this.x - this.bossX) ** 2 + (this.y - this.bossY) ** 2 < hull ** 2)
      this.hit();
    if (this.boss)
      for (let p = 0; p < this.bossParts; p++) {
        if (
          this.partHp[p] > 0 &&
          (this.x - this.partX[p]) ** 2 + (this.y - this.partY[p]) ** 2 < 0.8 ** 2
        )
          this.hit();
      }
  }
  damageEnemy(i: number, damage: number) {
    if (!this.enemies.active[i]) return;
    this.enemies.hp[i] -= damage;
    if (this.enemies.hp[i] > 0) {
      this.enemyFlash[i] = 0.09;
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
    for (let i = 0; i < a.capacity; i++) {
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
        a.release(i);
      } else if (a.x[i] < -18 || a.age[i] > 15) {
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
    this.explode(this.bossX, this.bossY, 400);
    this.flash = 1;
    this.status = 'clear';
  }
  startStress() {
    this.status = 'stress';
    this.bullets.clear();
    this.enemies.clear();
    this.items.clear();
    this.particles.clear();
    this.boss = false;
    this.setStressCount(this.stressCount);
  }
  setStressCount(count: number) {
    this.stressCount = count;
    this.bullets.clear();
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
    for (let i = 0; i < b.capacity; i++) {
      if (!b.active[i]) continue;
      b.px[i] = b.x[i];
      b.py[i] = b.y[i];
      b.x[i] += b.vx[i] * dt;
      b.y[i] += b.vy[i] * dt;
      if (b.x[i] > 16 || b.x[i] < -16) b.vx[i] *= -1;
      if (b.y[i] > 8 || b.y[i] < -8) b.vy[i] *= -1;
    }
    this.bulletGrid.clear();
    for (let i = 0; i < b.capacity; i++) if (b.active[i]) this.bulletGrid.insert(i, b.x[i], b.y[i]);
    this.bulletGrid.query(0, 0, 1);
  }
}
