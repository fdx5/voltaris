import { api, useAccount, type Pilot } from '../ui/store/useAccount';
import { Key } from './input/InputManager';
import { GameState, type Weapon } from '../game/GameState';
import { InputManager } from './input/InputManager';
import { GameLoop } from './loop/GameLoop';
import { AudioEngine } from './audio/AudioEngine';
import { asset } from './assets';
import { ThreeBackend } from './renderer/ThreeBackend';
import type { Quality } from './renderer/IRenderBackend';
import { useUI } from '../ui/store/useUI';
/** Weapons that fire a recorded sample instead of the synth blip. */
const FIRE_SAMPLES: Record<Weapon, string> = {
  LASER: asset('/audio/laser.mp3'),
  MISSILE: asset('/audio/laser.mp3'),
  SPREAD: asset('/audio/laser.mp3'),
};
/** Played once when a sector is secured. */
const STAGE_CLEAR = asset('/audio/win.mp3');
const PICKUP_SAMPLES = [
  asset('/audio/powerup.mp3'),
  asset('/audio/optionadd.mp3'),
  asset('/audio/itemadd.mp3'),
  asset('/audio/itemadd.mp3'),
] as const;
/** Wreck samples, chosen by how much hull came apart. */
const WRECK_LIGHT = asset('/audio/11_soft_puff.mp3');
const WRECK_HEAVY = asset('/audio/04_rumble_break.mp3');
const PLAYER_DESTROY = asset('/audio/destroy.mp3');
const BOSS_KILL = asset('/audio/bosskill.mp3');

/**
 * Turns a renderer start-up failure into something the player can act on.
 * By the time this runs the backend has already retried on WebGL 2, so the
 * question left is whether the machine can draw at all.
 */
function graphicsAdvice(e: unknown) {
  const detail = e instanceof Error ? e.message : String(e);
  let webgl2 = false;
  try {
    webgl2 = !!document.createElement('canvas').getContext('webgl2');
  } catch {
    /* a browser that throws here has no WebGL 2 either */
  }
  return webgl2
    ? `그래픽 드라이버가 3D 컨텍스트를 열지 못했습니다. 다른 탭을 닫고 새로고침해 주세요. (${detail})`
    : `브라우저의 하드웨어 가속이 꺼져 있거나 WebGL 2를 지원하지 않습니다. 브라우저 설정에서 하드웨어 가속을 켜고 새로고침해 주세요. (${detail})`;
}

export class Runtime {
  game = new GameState();
  private runId: string | null = null;
  private previousRunId: string | null = null;
  private runEvents: number[][] = [];
  private savePromise: Promise<void> | null = null;
  private pendingResult: { id: string; events: number[][]; outcome: string } | null = null;
  readonly audio = new AudioEngine();
  readonly visual: ThreeBackend;
  readonly input: InputManager;
  readonly loop: GameLoop;
  private hudTime = 0;
  private qualityTime = 0;
  private initialized = false;
  private disposed = false;
  private recorded = false;
  private controller = new AbortController();
  private sounds = new Uint32Array(7);
  private armourHits = 0;
  private novaLaunches = 0;
  private novaBlasts = 0;
  /** Visual-clock time of the last armour blast, so a laser does not machine-gun it. */
  private armourSoundAt = -1;
  private pickupSounds = new Uint32Array(4);
  private lastStatus = 'menu';
  private bossTrack = false;
  private portrait = false;
  private resizeObserver: ResizeObserver;
  constructor(host: HTMLElement) {
    const flags = new URLSearchParams(location.search);
    this.visual = new ThreeBackend(host, flags.has('webgl'), flags.has('rendererfail'));
    // Bound to the frame, not to the canvas: a failed WebGPU start swaps the
    // canvas for a WebGL 2 one, and touch controls must survive that.
    this.input = new InputManager(
      host.parentElement ?? host,
      () => this.game.status === 'playing',
      () => host.getBoundingClientRect(),
    );
    this.resizeObserver = new ResizeObserver(() => {
      if (this.initialized) this.visual.resize();
      this.checkOrientation();
    });
    this.resizeObserver.observe(host);
    this.loop = new GameLoop(this.tick, this.render);
    const signal = this.controller.signal;
    window.addEventListener(
      'resize',
      () => {
        this.visual.resize();
        this.checkOrientation();
      },
      { signal },
    );
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) {
          if (this.game.status === 'playing') this.game.status = 'paused';
          this.input.clear();
          this.audio.suspend();
        }
      },
      { signal },
    );
    window.addEventListener(
      'blur',
      () => {
        if (this.game.status === 'playing') this.game.status = 'paused';
        this.audio.suspend();
      },
      { signal },
    );
  }
  async init() {
    try {
      await this.visual.init();
      if (this.disposed) {
        this.visual.dispose();
        return;
      }
      this.initialized = true;
      useUI.setState({ ready: true, error: '', backend: this.visual.backendName });
      this.visual.sync(this.game, 0, 0);
      this.loop.start();
      this.checkOrientation();
      // Combat shaders build behind the hangar rather than in front of it.
      void this.visual.warmup();
    } catch (e) {
      console.error('[VOLTARIS] renderer init failed', e);
      useUI.setState({ error: graphicsAdvice(e) });
    }
  }
  private checkOrientation() {
    const host = this.visual.canvas.parentElement;
    this.portrait = !!host && host.clientHeight > host.clientWidth;
    if (this.portrait && this.game.status === 'playing') {
      this.game.status = 'paused';
      this.input.clear();
      this.audio.suspend();
    }
  }
  /** `carry` continues a run into the next stage with its upgrades intact. */
  async start(weapon: Weapon, credits: number, practice = false, carry = false, stageIndex = 0) {
    if (useAccount.getState().launching) return;
    // iOS requires audio activation inside the launch gesture, before network awaits.
    void this.audio.unlock();
    useAccount.setState({ launching: true, error: '' });
    try {
      await this.finishRun();
      const autoFire = this.game.autoFire;
      const run = await api<{
        id: string;
        config: { loadout?: { level: number; optionCount: number; shield: number } };
      }>('/runs', {
        stage: stageIndex + 1,
        weapon,
        credits,
        practice,
        autoFire,
        previousRunId: carry ? this.previousRunId : undefined,
      });
      this.input.clear();
      void this.audio.unlock();
      this.audio.preload([
        STAGE_CLEAR,
        WRECK_LIGHT,
        WRECK_HEAVY,
        PLAYER_DESTROY,
        BOSS_KILL,
        ...Object.values(FIRE_SAMPLES),
        ...PICKUP_SAMPLES,
      ]);
      this.game = new GameState();
      this.pickupSounds.fill(0);
      this.sounds.fill(0);
      this.armourHits = 0;
      this.novaLaunches = this.novaBlasts = 0;
      if (run.config.loadout) Object.assign(this.game.loadout, run.config.loadout);
      this.game.start(weapon, credits, practice, !!run.config.loadout, stageIndex);
      this.game.autoFire = autoFire;
      this.runId = run.id;
      this.runEvents = [];
      this.pendingResult = null;
      this.bossTrack = false;
      this.playStageTrack();
      this.recorded = false;
      this.qualityTime = 0;
      this.checkOrientation();
      this.publish();
    } catch (e) {
      useAccount.setState({ error: e instanceof Error ? e.message : '출격할 수 없습니다.' });
      throw e;
    } finally {
      useAccount.setState({ launching: false });
    }
  }
  activate(slot: number) {
    this.log([1, slot]);
    this.game.activate(slot);
  }
  cycleMode() {
    this.log([2]);
    this.game.cycleMode();
  }
  continueRun() {
    this.log([3]);
    this.game.continueRun();
  }
  setAutoFire(enabled: boolean) {
    this.log([4, enabled ? 1 : 0]);
    this.game.autoFire = enabled;
  }
  private log(event: number[]) {
    if (this.runId && !this.pendingResult) this.runEvents.push(event);
  }
  finishRun(): Promise<void> {
    if (this.savePromise) return this.savePromise;
    if (!this.runId) return Promise.resolve();
    if (!this.pendingResult)
      this.pendingResult = {
        id: this.runId,
        events: this.runEvents.slice(),
        outcome: this.game.status,
      };
    const pending = this.pendingResult;
    useAccount.setState({ saving: true, error: '' });
    this.savePromise = api<{ user: Pilot; status: string }>(`/runs/${pending.id}/finish`, {
      events: pending.events,
      outcome: pending.outcome,
    })
      .then(({ user }) => {
        useAccount.setState({ user });
        this.previousRunId = pending.id;
        this.runId = null;
        this.pendingResult = null;
      })
      .catch((e) => {
        useAccount.setState({ error: e instanceof Error ? e.message : '기록 저장 실패' });
        throw e;
      })
      .finally(() => {
        this.savePromise = null;
        useAccount.setState({ saving: false });
      });
    return this.savePromise;
  }
  /** Stage theme, or the boss theme once the boss is on the field. */
  private playStageTrack() {
    const stage = this.game.stage;
    const boss = this.game.boss && stage.bossMusic ? stage.bossMusic : null;
    const track = boss ?? stage.music;
    if (track) this.audio.playTrack(asset(track));
    this.bossTrack = boss !== null;
  }
  menu() {
    void this.finishRun().catch(() => {});
    this.audio.stopTrack();
    this.game.status = 'menu';
    this.game.bullets.clear();
    this.game.enemies.clear();
    this.game.items.clear();
    this.game.particles.clear();
    this.game.boss = false;
    this.input.clear();
    this.publish();
  }
  resume() {
    if (this.portrait) return;
    void this.audio.unlock();
    if (this.game.status === 'paused') this.game.status = 'playing';
    this.input.clear();
    this.publish();
  }
  setQuality(q: Quality, automatic = false) {
    this.visual.setQuality(q);
    useUI.setState({ quality: q, autoQuality: automatic });
  }
  private tick = (dt: number) => {
    this.input.flush();
    if (!this.portrait) {
      const { bits, pressed, dx, dy } = this.input;
      if (
        (this.game.status === 'playing' && !(pressed & Key.Pause)) ||
        this.game.status === 'continue'
      )
        this.log([0, bits & 1023, pressed & 1023, dx, dy]);
      this.game.tick(dt, bits, pressed, dx, dy);
    }
  };
  private render = (alpha: number, dt: number) => {
    if (!this.initialized || this.disposed) return;
    try {
      this.visual.sync(this.game, alpha, dt);
      this.visual.render();
    } catch (e) {
      useUI.setState({ error: e instanceof Error ? e.message : String(e) });
      return;
    }
    const g = this.game;
    const sample = FIRE_SAMPLES[g.weapon];
    if (useUI.getState().bossHp !== g.bossHp)
      useUI.setState({ bossHp: Math.max(0, g.bossHp), bossHpFull: g.stage.boss.hp });
    if (g.bossDeathEvent !== this.sounds[6]) {
      this.sounds[6] = g.bossDeathEvent;
      this.audio.stopTrack();
      void this.audio.jingle(BOSS_KILL, 7);
      this.publish();
    }
    // Shield hits increment hitEvent too; only a lost life triggers this cue.
    const destroyed = g.deaths !== this.sounds[5];
    if (destroyed) {
      void this.audio.jingle(PLAYER_DESTROY);
      this.sounds[5] = g.deaths;
    }
    if (g.shotEvent !== this.sounds[0]) {
      this.sounds[0] = g.shotEvent;
      if (sample) this.audio.fireSample(sample);
      else this.audio.shot();
    }
    if (g.explosionEvent !== this.sounds[1]) {
      if (!destroyed && !g.bossDying)
        this.audio.impactSample(g.explosionHeavy ? WRECK_HEAVY : WRECK_LIGHT);
      this.sounds[1] = g.explosionEvent;
    }
    if (g.pickupEvent !== this.sounds[2]) {
      for (let type = 0; type < PICKUP_SAMPLES.length; type++) {
        const count = g.pickupEventsByType[type];
        for (let n = this.pickupSounds[type]; n < count; n++)
          void this.audio.pickupSample(PICKUP_SAMPLES[type], type === 1 ? 2.4 : 1);
        this.pickupSounds[type] = count;
      }
      this.sounds[2] = g.pickupEvent;
    }
    if (g.warningEvent !== this.sounds[3]) {
      this.audio.warning();
      this.sounds[3] = g.warningEvent;
    }
    if (g.novaLaunchEvent !== this.novaLaunches) {
      if (g.novaLaunchEvent > this.novaLaunches) this.audio.novaLaunch();
      this.novaLaunches = g.novaLaunchEvent;
    }
    if (g.novaEvent !== this.novaBlasts) {
      if (g.novaEvent > this.novaBlasts) {
        this.audio.novaBlast();
        void this.audio.jingle(WRECK_HEAVY);
        void this.audio.jingle(PLAYER_DESTROY);
      }
      this.novaBlasts = g.novaEvent;
    }
    // Every hit on a boss or gunship sets off the blast again, retriggered no
    // faster than about fourteen times a second.
    if (g.armourHitEvent !== this.armourHits) {
      const now = performance.now() / 1000;
      if (g.armourHitEvent > this.armourHits && now - this.armourSoundAt > 0.07) {
        this.audio.armourSample(PLAYER_DESTROY);
        this.armourSoundAt = now;
      }
      this.armourHits = g.armourHitEvent;
    }
    if (g.hitEvent !== this.sounds[4]) {
      if (!destroyed) this.audio.explosion();
      this.sounds[4] = g.hitEvent;
    }
    // A boss arriving cuts the stage theme over to its own.
    if (g.boss !== this.bossTrack && g.stage.bossMusic && g.status === 'playing' && !g.bossDying)
      this.playStageTrack();
    if (this.lastStatus !== g.status) {
      if (g.status === 'playing') this.audio.resume();
      else if (g.status === 'paused') this.audio.suspend();
      else if (g.status === 'gameover' || g.status === 'clear' || g.status === 'stress')
        this.audio.stopTrack();
      // The stage theme gives way to the fanfare the moment the sector falls.
      if (g.status === 'clear') void this.audio.jingle(STAGE_CLEAR);
      this.lastStatus = g.status;
    }
    this.audio.tick(g.status === 'playing' && !g.bossDying, g.boss);
    this.hudTime += dt;
    this.qualityTime += dt;
    if (this.hudTime >= 0.1) {
      this.hudTime = 0;
      this.publish();
    }
    if (this.qualityTime >= 3 && useUI.getState().autoQuality) {
      this.qualityTime = 0;
      if (this.loop.fps > 0 && this.loop.fps < 45 && this.visual.quality !== 'LOW')
        this.setQuality(this.visual.quality === 'HIGH' ? 'MEDIUM' : 'LOW', true);
    }
    if ((g.status === 'clear' || g.status === 'gameover') && !this.recorded) {
      this.recorded = true;
      void this.finishRun().catch(() => {});
      useUI.setState((s) => ({
        records: [
          {
            score: g.score,
            weapon: g.weapon,
            level: g.level,
            credits: g.creditsUsed,
            cleared: g.status === 'clear',
            kills: g.kills,
            seconds: g.time,
            practice: g.practice,
          },
          ...s.records,
        ].slice(0, 20),
      }));
    }
  };
  publish() {
    const g = this.game;
    const mem = performance as Performance & { memory?: { usedJSHeapSize: number } };
    useUI.setState({
      status: g.status,
      stageIndex: g.stageIndex,
      stageName: g.stage.name,
      bossName: g.stage.boss.id,
      score: g.score,
      level: g.level,
      lives: g.lives,
      credits: g.credits,
      creditsUsed: g.creditsUsed,
      mode: g.mode,
      optionCount: g.optionCount,
      optionHold: g.optionHold,
      shield: g.shield,
      graze: g.graze,
      time: g.time,
      kills: g.kills,
      boss: g.boss,
      bossHp: g.bossHp,
      bossDying: g.bossDying,
      bossHpFull: g.stage.boss.hp,
      bossPhase: g.bossPhase,
      bossTime: g.bossTime,
      notice: g.notice,
      noticeTime: g.noticeTime,
      charge: Array.from(g.charge),
      skills: Array.from(g.skills),
      effects: Array.from(g.effects),
      skillUnlocked: g.skillUnlocked,
      continueTime: g.continueTime,
      fps: this.loop.fps,
      frameMs: this.loop.frameMs,
      drawCalls: this.visual.drawCalls,
      triangles: this.visual.triangles,
      geometries: this.visual.geometryCount,
      bullets: g.bullets.count,
      memory: mem.memory ? mem.memory.usedJSHeapSize / 1048576 : null,
      gamepad: this.input.gamepad,
      bonus: g.bonus,
      maxGraze: g.maxGraze,
      deaths: g.deaths,
    });
  }
  dispose() {
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.loop.stop();
    this.controller.abort();
    this.input.dispose();
    this.audio.dispose();
    if (this.initialized) this.visual.dispose();
    else this.visual.canvas.remove();
  }
}
