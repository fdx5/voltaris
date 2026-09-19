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
import { STAGES } from '../game/stages';
import { packReplay } from './replayCodec';
import { t } from '../ui/i18n';
/**
 * A stage's music, in the order a run actually hears it. Every stage has at
 * least 'intro'/'final'; 'mid'/'second' only exist for a stage with a
 * midBoss (falls back to the surrounding track when its own is missing, so
 * a plain two-track stage behaves exactly as before).
 */
type TrackPhase = 'intro' | 'mid' | 'second' | 'final';
function trackPhaseOf(g: GameState): TrackPhase {
  if (g.boss) return 'final';
  if (g.midBoss) return 'mid';
  if (g.midBossDefeated) return 'second';
  return 'intro';
}
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
  asset('/audio/itemadd.mp3'),
  asset('/audio/itemadd.mp3'),
] as const;
/** Wreck samples, chosen by how much hull came apart. */
const WRECK_LIGHT = asset('/audio/11_soft_puff.mp3');
const WRECK_HEAVY = asset('/audio/04_rumble_break.mp3');
const PLAYER_DESTROY = asset('/audio/destroy.mp3');
const BOSS_KILL = asset('/audio/bosskill.mp3');
/** "Chunky Explosion" by Joth (CC0, OpenGameArt); see public/ASSET-CREDITS.md. */
const NOVA_BLAST = asset('/audio/nova-blast.mp3');

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
    ? `${t('WEBGPU_CONTEXT_FAILED')} (${detail})`
    : `${t('WEBGL2_UNSUPPORTED')} (${detail})`;
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
  /**
   * Seconds left before the auto-quality watcher starts trusting the FPS
   * average. Shader compilation and texture upload right after boot can
   * stall the first few seconds on perfectly capable hardware, which would
   * otherwise read as "too slow" and downgrade quality that never needed it.
   */
  private qualityGrace = 7;
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
  private pickupSounds = new Uint32Array(6);
  private lastStatus = 'menu';
  /** Which of a stage's (up to 4) music tracks is currently playing. */
  private trackPhase: TrackPhase = 'intro';
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
      useUI.setState({
        ready: true,
        error: '',
        backend: this.visual.backendName,
        quality: this.visual.quality,
      });
      this.visual.sync(this.game, 0, 0);
      this.loop.start();
      this.checkOrientation();
      // Combat shaders build behind the hangar rather than in front of it.
      void this.visual.warmup().catch((e) => console.warn('[VOLTARIS] shader warmup skipped', e));
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
    // Unlock the actual media element too, synchronously in the launch tap.
    // Resuming Web Audio alone does not authorize HTMLAudioElement on iOS.
    const launchTrack = STAGES[stageIndex]?.music;
    if (launchTrack) this.audio.playTrack(asset(launchTrack));
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
        NOVA_BLAST,
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
      this.trackPhase = 'intro';
      this.playStageTrack();
      this.recorded = false;
      this.qualityTime = 0;
      this.checkOrientation();
      this.publish();
    } catch (e) {
      this.audio.stopTrack();
      useAccount.setState({ error: e instanceof Error ? e.message : t('LAUNCH_FAILED') });
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
        events: packReplay(this.runEvents),
        outcome: this.game.status,
      };
    const pending = this.pendingResult;
    useAccount.setState({ saving: true, error: '' });
    const controller = new AbortController();
    // A few seconds above ReplayVerifier's own timeoutMs (server/verify.mjs),
    // which itself budgets for verifying a MAX_REPLAY_FRAMES-length replay.
    const timeout = setTimeout(() => controller.abort(), 55000);
    this.savePromise = api<{ user: Pilot; status: string }>(
      `/runs/${pending.id}/finish`,
      {
        events: pending.events,
        outcome: pending.outcome,
      },
      controller.signal,
    )
      .then(({ user }) => {
        useAccount.setState({ user });
        this.previousRunId = pending.id;
        this.runId = null;
        this.pendingResult = null;
      })
      .catch((e) => {
        useAccount.setState({
          error: controller.signal.aborted
            ? t('SAVE_DELAYED')
            : e instanceof Error
              ? e.message
              : t('SAVE_FAILED'),
        });
        throw e;
      })
      .finally(() => {
        clearTimeout(timeout);
        this.savePromise = null;
        useAccount.setState({ saving: false });
      });
    return this.savePromise;
  }
  /** Whichever of the stage's (up to 4) tracks matches where the run is now. */
  private playStageTrack() {
    const stage = this.game.stage as {
      music?: string;
      midBossMusic?: string;
      music2?: string;
      bossMusic?: string;
    };
    const phase = trackPhaseOf(this.game);
    const track =
      phase === 'final'
        ? stage.bossMusic
        : phase === 'mid'
          ? (stage.midBossMusic ?? stage.bossMusic)
          : phase === 'second'
            ? (stage.music2 ?? stage.music)
            : stage.music;
    if (track) this.audio.playTrack(asset(track));
    // Fetch whatever comes next while this phase plays, so its cut-in has no gap.
    const next =
      phase === 'intro'
        ? (stage.midBossMusic ?? stage.bossMusic)
        : phase === 'mid'
          ? (stage.music2 ?? stage.music)
          : phase === 'second'
            ? stage.bossMusic
            : undefined;
    if (next && next !== track) this.audio.preloadTrack(asset(next));
    this.trackPhase = phase;
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
    this.audio.resume();
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
      useUI.setState({ bossHp: Math.max(0, g.bossHp), bossHpFull: g.bossDef.hp });
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
        void this.audio.novaBlast(NOVA_BLAST);
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
    // A mid-boss, the second half, or the real boss arriving each cut the
    // theme over to their own track.
    if (trackPhaseOf(g) !== this.trackPhase && g.status === 'playing' && !g.bossDying)
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
    this.audio.tick(g.status === 'playing' && !g.bossDying, g.boss || g.midBoss);
    this.hudTime += dt;
    this.qualityTime += dt;
    if (this.hudTime >= 0.1) {
      this.hudTime = 0;
      this.publish();
    }
    if (this.qualityGrace > 0) {
      this.qualityGrace -= dt;
      this.qualityTime = 0;
    } else if (this.qualityTime >= 3 && useUI.getState().autoQuality) {
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
      bossName: g.bossDef.id,
      score: g.score,
      level: g.level,
      specialWeapon: g.specialWeapon,
      specialLevel: g.specialLevel,
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
      boss: g.boss || g.midBoss,
      bossHp: g.bossHp,
      bossDying: g.bossDying,
      bossHpFull: g.bossDef.hp,
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
