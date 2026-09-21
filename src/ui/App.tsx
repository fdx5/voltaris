import { useAccount, loadAccount, api } from './store/useAccount';
import { LoginScreen, OnlineHistory } from './Account';
import { Guestbook } from './Guestbook';
import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import {
  ArrowUpRight,
  ArrowRight,
  ChevronRight,
  ChevronLeft,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Settings2,
  X,
  Pause,
  Play,
  Gamepad2,
  Keyboard,
  Shield,
  Layers,
  Zap,
  Target,
  Move,
  Orbit,
  Magnet,
  Activity,
  Trophy,
  RotateCcw,
  Lock,
  Check,
  Download,
  Clock,
  NotebookPen,
} from 'lucide-react';
import { Runtime } from '../core/Runtime';
import { PLAYER_CRAFT } from '../visual/PlayerLoadout';
import { asset } from '../core/assets';
import { useUI } from './store/useUI';
import { STAGES } from '../game/stages';
import { MODES, type Weapon } from '../game/GameState';
import { Key } from '../core/input/InputManager';
import type { Quality } from '../core/renderer/IRenderBackend';
import tuning from '../../data/tuning.json';
import { useT, useLocaleStore, setLocale } from './i18n';
const number = (n: number) => Math.floor(n).toLocaleString('en-US');
const clock = (n: number) =>
  `${Math.floor(n / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(n % 60)
    .toString()
    .padStart(2, '0')}`;
type Panel = 'launch' | 'settings' | 'controls' | 'records' | 'recent' | 'guestbook' | null;
const weaponInfo = {
  LASER: {
    title: 'PRECISION LANCE',
    descriptionKey: 'WEAPON_DESC_LASER',
    stat: 'PENETRATION',
    value: '★★★★★',
  },
  MISSILE: {
    title: 'HOMING ARRAY',
    descriptionKey: 'WEAPON_DESC_MISSILE',
    stat: 'TRACKING',
    value: '★★★★★',
  },
  SPREAD: {
    title: 'SCATTER CANNON',
    descriptionKey: 'WEAPON_DESC_SPREAD',
    stat: 'COVERAGE',
    value: '★★★★★',
  },
} as const;
/** `/audio/space-engine.mp3` -> `SPACE ENGINE`, for the settings readout. */
const trackName = (url: string) =>
  (url.split('/').pop() ?? '')
    .replace(/\.\w+$/, '')
    .replace(/[-_]/g, ' ')
    .toUpperCase();

export function App() {
  const account = useAccount();
  useEffect(() => {
    void loadAccount();
  }, []);
  return account.user ? <GameApp key={account.user.id} /> : <LoginScreen />;
}
const ROLE_KEY = { LASER: 'ROLE_LASER', MISSILE: 'ROLE_MISSILE', SPREAD: 'ROLE_SPREAD' } as const;
function GameApp() {
  const account = useAccount();
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const host = useRef<HTMLDivElement>(null),
    runtime = useRef<Runtime | null>(null);
  const ui = useUI();
  const [panel, setPanel] = useState<Panel>(null),
    [weapon, setWeapon] = useState<Weapon>('LASER'),
    [credits, setCredits] = useState(10),
    [muted, setMuted] = useState(false),
    [volume, setVolume] = useState(0.5),
    [musicVolume, setMusicVolume] = useState(0.5),
    [sensitivity, setSensitivity] = useState(1),
    [autoFire, setAutoFire] = useState(true),
    [hitbox, setHitbox] = useState(true),
    [motion, setMotion] = useState(false),
    [bloom, setBloom] = useState(true),
    [stressCount, setStressCount] = useState(1500),
    [stressShips, setStressShips] = useState(20),
    [practice, setPractice] = useState(false),
    [stage, setStage] = useState(0),
    [fullError, setFullError] = useState(''),
    [full, setFull] = useState(false);
  // The player can leave fullscreen with the system back gesture or Escape, so
  // the button follows the document rather than its own memory of the state.
  useEffect(() => {
    const sync = () => setFull(!!document.fullscreenElement);
    sync();
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  useEffect(() => {
    if (!host.current) return;
    const r = new Runtime(host.current);
    runtime.current = r;
    void r.init();
    return () => {
      r.dispose();
      runtime.current = null;
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && panel) {
        setPanel(null);
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [panel]);
  const r = () => runtime.current;
  const enterFullscreen = async () => {
    if (!document.documentElement.requestFullscreen) {
      throw new Error('Fullscreen is unavailable');
    }
    await document.documentElement.requestFullscreen();
    const o = screen.orientation as ScreenOrientation & { lock?: (s: string) => Promise<void> };
    await o.lock?.('landscape').catch(() => {});
  };
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await enterFullscreen();
    } catch {
      setFullError(t('FULLSCREEN_UNSUPPORTED'));
      setTimeout(() => setFullError(''), 5000);
    }
  };
  const start = async () => {
    // Asked for inside the click, before anything is awaited: a browser only
    // grants fullscreen while the gesture that asked for it is still live. On
    // a phone the address bar costs a fifth of a landscape screen, so a sortie
    // takes the whole display and the HUD button hands it back.
    if (matchMedia('(any-pointer: coarse)').matches && !document.fullscreenElement)
      void enterFullscreen().catch(() => {
        /* iOS refuses outside of video; the game still runs windowed */
      });
    try {
      await r()?.start(weapon, credits, practice, false, stage);
      setPanel(null);
    } catch {
      /* shown in account banner */
    }
  };
  const advance = async () => {
    const next = Math.min(stage + 1, STAGES.length - 1);
    try {
      await r()?.start(weapon, credits, false, true, next);
      setStage(next);
    } catch {
      /* shown in account banner */
    }
  };
  const toggleSound = () => {
    void r()?.audio.unlock();
    r()?.audio.toggle();
    setMuted(r()?.audio.muted ?? false);
  };
  const open = (p: Panel) => {
    if (ui.status === 'playing') r()?.game.pause();
    setPanel(p);
  };
  const stress = () => {
    r()?.game.startStress();
    setPanel(null);
    r()?.publish();
  };
  const download = () => {
    const payload = {
      version: '0.1.0',
      backend: ui.backend,
      quality: ui.quality,
      bullets: ui.bullets,
      ships: stressShips,
      fps: ui.fps,
      frameMs: ui.frameMs,
      drawCalls: ui.drawCalls,
      triangles: ui.triangles,
      jsHeapMB: ui.memory,
      gpuMemory: 'not measured',
      gcBytesPerFrame: 'not measured',
      device: navigator.userAgent,
      timestamp: new Date().toISOString(),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'voltaris-performance.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  const active = ui.status !== 'menu';
  return (
    <div className={`app ${active ? 'in-flight' : 'sortie-menu'}`}>
      <div className="render-host" ref={host} />
      <div className="vignette" />
      <div className="texture" />
      {!active && (
        <>
          <div className="flight-scenery" aria-hidden="true">
            <div className="flight-slash" />
            <div className="flight-slash flight-slash-second" />
          </div>
          <header className="header">
            <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
              <span>VOLTARIS{t('BRAND_SUBTITLE') && <small>{t('BRAND_SUBTITLE')}</small>}</span>
            </a>
            <div className="header-tools">
              <span className="guest">
                PILOT <b>{account.user?.username}</b>
              </span>
              <button
                className="lang-toggle"
                onClick={() => setLocale(locale === 'ko' ? 'en' : 'ko')}
              >
                {locale === 'ko' ? 'EN' : 'KO'}
              </button>
              <button
                aria-label={t('LOGOUT')}
                onClick={async () => {
                  try {
                    await r()?.finishRun();
                    await api('/auth/logout', {});
                    useAccount.setState({ user: null, error: '' });
                  } catch (e) {
                    useAccount.setState({
                      error: e instanceof Error ? e.message : t('LOGOUT_FAILED'),
                    });
                  }
                }}
              >
                {t('LOGOUT')}
              </button>
              <button aria-label={t('SOUND_TOGGLE')} onClick={toggleSound}>
                {muted ? <VolumeX /> : <Volume2 />}
              </button>
              <button
                className="fullscreen-button"
                aria-label={t('FULLSCREEN')}
                onClick={() => void fullscreen()}
              >
                <Maximize />
              </button>
              <button aria-label={t('SETTINGS')} onClick={() => open('settings')}>
                <Settings2 />
              </button>
            </div>
          </header>
          <main className="command">
            <nav
              className="flight-menu"
              aria-label={t('MAIN_MENU')}
              onKeyDown={(event) => {
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                const buttons = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
                );
                const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? buttons.length - 1
                      : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                        buttons.length;
                event.preventDefault();
                buttons[next]?.focus();
              }}
            >
              <button
                className="flight-choice launch"
                aria-label={ui.ready ? t('LAUNCH_READY_LABEL') : t('LAUNCH_INIT_LABEL')}
                disabled={!ui.ready || account.launching || account.saving}
                onClick={() => {
                  setPractice(false);
                  open('launch');
                }}
              >
                <span className="choice-index" aria-hidden="true">
                  01
                </span>
                <span className="menu-button">
                  <Play size={18} aria-hidden="true" />
                  {ui.ready ? t('LAUNCH') : t('PREPARING')}
                  <ChevronRight size={16} aria-hidden="true" />
                </span>
              </button>
              <button className="flight-choice rank-choice" onClick={() => open('records')}>
                <span className="choice-index" aria-hidden="true">
                  02
                </span>
                <span className="menu-button">
                  <Trophy size={18} aria-hidden="true" className="rank-choice-icon" />
                  {t('PILOT_RANKING')}
                  <ChevronRight size={16} aria-hidden="true" />
                </span>
              </button>
              <button className="flight-choice recent-choice" onClick={() => open('recent')}>
                <span className="choice-index" aria-hidden="true">
                  03
                </span>
                <span className="menu-button">
                  <Clock size={18} aria-hidden="true" />
                  {t('RECENT_SORTIES')}
                  <ChevronRight size={16} aria-hidden="true" />
                </span>
              </button>
              <button className="flight-choice guide-choice" onClick={() => open('controls')}>
                <span className="choice-index" aria-hidden="true">
                  04
                </span>
                <span className="menu-button">
                  <Keyboard size={18} aria-hidden="true" />
                  {t('CONTROLS_GUIDE')}
                  <ChevronRight size={16} aria-hidden="true" />
                </span>
              </button>
              <button
                className="flight-choice training-choice"
                aria-label={t('BOSS_TRAINING_LABEL')}
                disabled={!ui.ready || account.launching || account.saving}
                onClick={() => {
                  setPractice(true);
                  open('launch');
                }}
              >
                <span className="choice-index" aria-hidden="true">
                  05
                </span>
                <span className="menu-button">
                  <Target size={18} aria-hidden="true" />
                  {t('BOSS_TRAINING')}
                  <ChevronRight size={16} aria-hidden="true" />
                </span>
              </button>
              <button className="flight-choice guestbook-choice" onClick={() => open('guestbook')}>
                <span className="choice-index" aria-hidden="true">
                  06
                </span>
                <span className="menu-button">
                  <NotebookPen size={18} aria-hidden="true" />
                  {t('GUESTBOOK')}
                  <ChevronRight size={16} aria-hidden="true" />
                </span>
              </button>
            </nav>
            <p className="menu-hint">
              <span>↑ ↓</span> {t('SELECT')} <span>ENTER</span> {t('CONFIRM')}
            </p>
          </main>
          <div className="ship-label">
            <small>VL–01</small>
            <strong>PEREGRINE</strong>
          </div>
          <section className="mission-strip" aria-label={t('MISSION_STRIP')}>
            <div className="mission-heading">
              <span>
                {t('SECTOR_SELECT_PREFIX')}
                <em>SELECT SECTOR</em>
              </span>
              <small>
                {String(account.user?.clearedStages.length ?? 0).padStart(2, '0')} /{' '}
                {String(STAGES.length).padStart(2, '0')} CLEARED
              </small>
            </div>
            <div className="mission-cards">
              {STAGES.map((mission, index) => {
                const locked = index + 1 > (account.user?.unlockedStage ?? 1);
                const cleared = account.user?.clearedStages.includes(index + 1);
                return (
                  <button
                    key={mission.id}
                    className={
                      'mission' + (stage === index ? ' selected' : '') + (locked ? ' locked' : '')
                    }
                    disabled={!ui.ready || locked || account.launching || account.saving}
                    aria-current={stage === index ? 'step' : undefined}
                    title={locked ? `STAGE ${index} ${t('LOCKED_STAGE_HINT')}` : mission.name}
                    onClick={() => {
                      setStage(index);
                      setPractice(false);
                      open('launch');
                    }}
                  >
                    <img
                      className="mission-visual"
                      src={`/images/missions/${['earth', 'mars', 'jupiter', 'neptune', 'milkyway'][index]}.webp`}
                      alt={t(
                        (
                          [
                            'PLANET_EARTH',
                            'PLANET_MARS',
                            'PLANET_JUPITER',
                            'PLANET_NEPTUNE',
                            'PLANET_GALAXY',
                          ] as const
                        )[index],
                      )}
                      width="65"
                      height="63"
                      decoding="async"
                    />
                    <div>
                      <small>
                        STAGE {String(index + 1).padStart(2, '0')}{' '}
                        <span>{locked ? 'LOCKED' : cleared ? 'CLEARED' : 'AVAILABLE'}</span>
                      </small>
                      <strong>{mission.name}</strong>
                      <p>
                        {locked
                          ? `STAGE ${index} ${t('STAGE_CLEAR_REQUIRED_SUFFIX')}`
                          : mission.subtitle}
                      </p>
                    </div>
                    {locked ? (
                      <Lock size={20} />
                    ) : cleared ? (
                      <Check size={20} />
                    ) : (
                      <ArrowUpRight size={20} />
                    )}
                  </button>
                );
              })}
            </div>
          </section>
          <footer className="footer">
            <span>
              {ui.ready ? t('STANDBY') : t('PREPARING')} <i>/</i> {ui.backend}
            </span>
            <span>
              {String(account.user?.clearedStages.length ?? 0).padStart(2, '0')} /{' '}
              {String(STAGES.length).padStart(2, '0')} SECTORS CLEARED
            </span>
            <button onClick={stress} disabled={!ui.ready || account.launching || account.saving}>
              {t('TEST_LAB')} <Activity size={12} />
            </button>
          </footer>
        </>
      )}
      {active && ui.status !== 'stress' && (
        <div className="play-frame">
          <div className="hud top-left">
            <small>
              SCORE <span>×{ui.graze.toFixed(2)}</span>
            </small>
            <strong aria-label={`SCORE ${Math.floor(ui.score).toLocaleString('en-US')}`}>
              {Math.floor(ui.score).toLocaleString('en-US')}
            </strong>
            <p>
              STAGE {String(ui.stageIndex + 1).padStart(2, '0')} <i>/</i> {ui.stageName}
            </p>
          </div>
          <div className="hud top-right">
            <div>
              <button
                onClick={() => {
                  r()?.cycleMode();
                  r()?.publish();
                }}
                className="mode-button"
                aria-label={`${t('OPTION_MODE_PREFIX')} ${MODES[ui.mode]} · ${t('OPTION_MODE_SUFFIX')}`}
                title={t('OPTION_MODE_TITLE')}
              >
                <Orbit size={15} />
                <span>{MODES[ui.mode]}</span>
                <b>×{ui.optionCount}</b>
                <kbd>Q</kbd>
              </button>
              {/* Latching, not momentary: a phone cannot hold a button down and
                  steer at the same time. Shift still works the old way, and
                  either source lighting the bit lights this control. */}
              <button
                className={'hold-button' + (ui.optionHold ? ' on' : '')}
                aria-pressed={ui.optionHold}
                aria-label={t('OPTION_HOLD')}
                title={t('OPTION_HOLD_TITLE')}
                onClick={() => {
                  const input = r()?.input;
                  if (input) input.set(Key.Hold, !input.latched(Key.Hold));
                  r()?.publish();
                }}
              >
                <Magnet size={15} />
                <span>HOLD</span>
                <i>{ui.optionHold ? 'ON' : 'OFF'}</i>
              </button>
              {/* Handing the screen back is a tap away, for a player who
                  wants the browser chrome again. */}
              <button
                className="frame-button"
                aria-label={full ? t('WINDOWED') : t('FULLSCREEN')}
                onClick={() => void fullscreen()}
              >
                {full ? <Minimize size={16} /> : <Maximize size={16} />}
              </button>
              <button
                className="frame-button"
                aria-label={t('PAUSE')}
                onClick={() => {
                  r()?.game.pause();
                  r()?.publish();
                }}
              >
                <Pause size={17} />
              </button>
            </div>
            <small>
              {clock(ui.time)} <span>{Math.round(ui.fps)} FPS</span>
            </small>
          </div>
          {ui.boss && (
            <div className="boss-hud">
              <small>
                {ui.bossName}{' '}
                <span>
                  {ui.bossDying
                    ? 'REACTOR COLLAPSE'
                    : `PHASE 0${ui.bossPhase} / ${Math.ceil(Math.max(0, ui.bossHp))} / ${ui.bossHpFull} HP`}
                </span>
              </small>
              <div
                role="progressbar"
                aria-label="Boss HP"
                aria-valuemin={0}
                aria-valuemax={ui.bossHpFull}
                aria-valuenow={Math.max(0, ui.bossHp)}
              >
                {/* Against the boss's own hull, not a constant: the later
                    bosses carry several times what the first one did, and a
                    fixed divisor ran the bar off the side of the screen. */}
                <i
                  style={{
                    width: `${Math.max(0, Math.min(100, (ui.bossHp / Math.max(1, ui.bossHpFull)) * 100))}%`,
                    background:
                      ui.bossHp / ui.bossHpFull <= 0.3
                        ? '#ff3b45'
                        : ui.bossHp / ui.bossHpFull < 0.7
                          ? 'linear-gradient(90deg, #ff932d, #ffda45)'
                          : '#329dff',
                  }}
                />
              </div>
              <p>{t('TURRET_HINT')}</p>
            </div>
          )}
          {ui.noticeTime > 0 && ui.status === 'playing' && (
            <div
              className={`notice ${ui.notice.startsWith('WARNING') ? 'warning' : ''}`}
              key={ui.notice}
            >
              <span>
                {ui.notice.startsWith('WARNING') ? '⚠ THREAT DETECTED' : 'FLIGHT COMMUNICATION'}
              </span>
              <strong>{ui.notice}</strong>
            </div>
          )}
          <div className="hud bottom-left">
            <div className="lives">
              {[0, 1, 2].map((i) => (
                <span key={i} className={i < ui.lives ? 'alive' : ''}>
                  ◢
                </span>
              ))}
              <small>
                CREDIT {ui.credits - ui.creditsUsed + 1}
                <i> / {ui.credits}</i>
              </small>
            </div>
            <div className="power">
              <span>
                {ui.specialWeapon === 'PLASMA'
                  ? 'PLASMA WHIP'
                  : ui.specialWeapon === 'CRESCENT'
                    ? 'CRESCENT BEAM'
                    : weapon}{' '}
                <b>LV {ui.specialWeapon ? ui.specialLevel : ui.level}</b>
              </span>
              <div>
                {Array.from({ length: 8 }, (_, i) => (
                  <i
                    key={i}
                    className={i < (ui.specialWeapon ? ui.specialLevel : ui.level) ? 'lit' : ''}
                  />
                ))}
              </div>
            </div>
            <p>
              OPTION {ui.optionCount}/5 <i>·</i> SHIELD {ui.shield}
            </p>
          </div>
          <div className="skills">
            {[0, 1, 2].map((i) => (
              <button
                key={i}
                aria-label={`${t('SKILL_SLOT_PREFIX')} ${i + 1}`}
                disabled={
                  ui.skills[i] < 0 || ui.charge[i] < 0.999 || (i === 0 && !ui.skillUnlocked)
                }
                onClick={() => r()?.activate(i)}
                style={{ '--charge': `${ui.charge[i] * 100}%` } as CSSProperties}
              >
                <span>
                  <kbd>{i + 1}</kbd>
                  {ui.skills[i] < 0 ? <Lock size={16} /> : <Zap size={19} />}
                </span>
                <strong>
                  {ui.skills[i] < 0 ? 'EMPTY SLOT' : tuning.skills[ui.skills[i]].name}
                </strong>
                <small>
                  {ui.skills[i] >= 0 && ui.effects[ui.skills[i]] > 0
                    ? `${ui.skills[i] === 0 ? 'INVINCIBLE' : 'ACTIVE'} ${ui.effects[ui.skills[i]].toFixed(1)}s`
                    : ui.skills[i] < 0
                      ? t('UNEQUIPPED')
                      : !ui.skillUnlocked
                        ? 'STAGE REWARD'
                        : ui.charge[i] >= 0.999
                          ? ui.skills[i] === 0
                            ? 'READY · 3s INVINCIBLE'
                            : 'READY'
                          : `${Math.floor(ui.charge[i] * 100)}%`}
                </small>
              </button>
            ))}
          </div>
          <div className="touch-controls">
            <span>
              {t('TOUCH_HINT_MOVE')} · {autoFire ? t('AUTO_FIRE_ON') : t('AUTO_FIRE_OFF')} ·{' '}
              {t('TOUCH_HINT_OPTION')} <b>OPTION</b> / <b>HOLD</b> {t('TOUCH_HINT_OPTION_SUFFIX')}
            </span>
          </div>
        </div>
      )}
      {ui.status === 'stress' && (
        <div className="lab">
          <div className="lab-head">
            <div>
              <small>ENGINE VALIDATION / M0</small>
              <h2>{t('BULLET_TEST_LAB')}</h2>
            </div>
            <button aria-label={t('BACK_TO_MENU')} onClick={() => r()?.menu()}>
              <X />
            </button>
          </div>
          <p>{t('LAB_DESCRIPTION')}</p>
          <label>
            ACTIVE BULLETS <b>{stressCount}</b>
            <input
              aria-label={t('BULLET_COUNT')}
              type="range"
              min="500"
              max="4000"
              step="100"
              value={stressCount}
              onChange={(e) => {
                const n = +e.target.value;
                setStressCount(n);
                r()?.game.setStressCount(n);
              }}
            />
          </label>
          <label>
            3D ENEMIES <b>{stressShips}</b>
            <input
              aria-label={t('SHIP_COUNT')}
              type="range"
              min="0"
              max="100"
              step="5"
              value={stressShips}
              onChange={(e) => {
                setStressShips(+e.target.value);
                if (r()) r()!.game.stressShips = +e.target.value;
              }}
            />
          </label>
          <div className="metrics">
            <div>
              <strong>{ui.fps.toFixed(1)}</strong>
              <small>FPS</small>
            </div>
            <div>
              <strong>{ui.frameMs.toFixed(2)}</strong>
              <small>MS / FRAME</small>
            </div>
            <div>
              <strong>{ui.drawCalls}</strong>
              <small>DRAW CALLS</small>
            </div>
            <div>
              <strong>{ui.memory?.toFixed(1) ?? 'N/A'}</strong>
              <small>JS HEAP / MB</small>
            </div>
          </div>
          <label className="toggle-row">
            BLOOM
            <input
              type="checkbox"
              checked={bloom}
              onChange={(e) => {
                setBloom(e.target.checked);
                if (r()) r()!.visual.bloomEnabled = e.target.checked;
              }}
            />
          </label>
          <select
            aria-label={t('TEST_QUALITY')}
            value={ui.quality}
            onChange={(e) => r()?.setQuality(e.target.value as Quality)}
          >
            {['HIGH', 'MEDIUM', 'LOW'].map((q) => (
              <option key={q}>{q}</option>
            ))}
          </select>
          <p className="fine">
            {ui.backend} · {number(ui.triangles)} triangles
            <br />
            {t('GPU_MEMORY_NOTE')}
          </p>
          <button className="primary" onClick={download}>
            <Download size={16} /> {t('SAVE_METRICS')}
          </button>
        </div>
      )}
      {ui.status === 'paused' && !panel && (
        <Modal title="FLIGHT PAUSED" eyebrow={t('COMBAT_PAUSED')} onClose={() => r()?.resume()}>
          <p>{t('PAUSE_FLAVOR')}</p>
          <button className="primary wide" onClick={() => r()?.resume()}>
            <Play size={17} /> {t('RESUME_COMBAT')}
          </button>
          <button className="secondary-button wide" onClick={() => open('settings')}>
            {t('SETTINGS')}
          </button>
          <button className="secondary-button wide" onClick={() => r()?.menu()}>
            {t('ABANDON_TO_HANGAR')}
          </button>
        </Modal>
      )}
      {ui.status === 'continue' && (
        <Modal title="CONTINUE?" eyebrow={t('SIGNAL_LOST_DESTROYED')}>
          <div className="countdown">{Math.ceil(ui.continueTime)}</div>
          <p>
            {t('REMAINING_CREDITS_PREFIX')} {ui.credits - ui.creditsUsed} · {t('SCORE_KEPT_SUFFIX')}
            <br />
            {t('RELAUNCH_RESET')}
          </p>
          <button
            className="primary wide"
            onClick={() => {
              r()?.continueRun();
              r()?.audio.resume();
              r()?.publish();
            }}
          >
            {t('RELAUNCH')} <ArrowRight size={17} />
          </button>
          <button
            className="secondary-button wide"
            onClick={() => {
              if (r()) r()!.game.status = 'gameover';
            }}
          >
            {t('END_FLIGHT')}
          </button>
        </Modal>
      )}
      {(ui.status === 'clear' || ui.status === 'gameover') && (
        <Modal
          title={ui.status === 'clear' ? 'SECTOR SECURED' : 'SIGNAL LOST'}
          eyebrow={
            ui.status === 'clear'
              ? `STAGE ${String(ui.stageIndex + 1).padStart(2, '0')} CLEAR / ${ui.stageName}`
              : t('GAMEOVER_EYEBROW')
          }
        >
          <div className="result-score">
            <small>TOTAL SCORE</small>
            <strong>{number(ui.score)}</strong>
          </div>
          <div className="result-grid">
            <span>
              {t('KILLS')}
              <b>{ui.kills}</b>
            </span>
            <span>
              {t('MAX_GRAZE')}
              <b>×{ui.maxGraze.toFixed(2)}</b>
            </span>
            <span>
              {t('FINAL_WEAPON_LEVEL')}
              <b>Lv.{ui.level}</b>
            </span>
            <span>
              {t('CREDITS_USED')}
              <b>{ui.creditsUsed}</b>
            </span>
            <span>
              {t('CLEAR_BONUS')}
              <b>{number(ui.bonus)}</b>
            </span>
            <span>
              {t('FLIGHT_TIME')}
              <b>{clock(ui.time)}</b>
            </span>
          </div>
          <p className="fine">
            {practice
              ? t('BOSS_TRAINING_RECORD')
              : `${t('BUILD_STAGE_COUNT_PREFIX')} ${STAGES.length} ${t('BUILD_STAGE_COUNT_SUFFIX')}`}
            <br />
            {t('RUN_SAVED_NOTE')}
          </p>
          {ui.status === 'clear' && !practice && ui.stageIndex < STAGES.length - 1 && (
            <button
              className="primary wide"
              disabled={
                account.saving ||
                account.launching ||
                (account.user?.unlockedStage ?? 1) < stage + 2
              }
              onClick={advance}
            >
              <ArrowUpRight size={16} /> {t('NEXT_STAGE_KEEP_LOADOUT')}
            </button>
          )}
          <button
            className={
              ui.status === 'clear' && !practice && ui.stageIndex < STAGES.length - 1
                ? 'secondary-button wide'
                : 'primary wide'
            }
            onClick={start}
          >
            <RotateCcw size={16} /> {t('RETRY')}
          </button>
          <button className="secondary-button wide" onClick={() => r()?.menu()}>
            {t('RETURN_TO_HANGAR')}
          </button>
        </Modal>
      )}
      {panel === 'launch' && (
        <Modal
          title={practice ? 'BOSS SIMULATION' : 'PREPARE FOR LAUNCH'}
          eyebrow={
            practice
              ? `${STAGES[stage].boss.id} / Lv.6 · ${t('BOSS_TRAINING_EYEBROW_SUFFIX')}`
              : `MISSION ${String(stage + 1).padStart(2, '0')} / ${STAGES[stage].name}`
          }
          onClose={() => setPanel(null)}
          wide
        >
          <div className="loadout-heading">
            <span>
              01 <b>SELECT ARMAMENT</b>
            </span>
            <small>{t('CRAFT_WEAPON_SELECT')}</small>
          </div>
          <div className="weapon-select">
            {(['LASER', 'MISSILE', 'SPREAD'] as Weapon[]).map((w) => (
              <button
                key={w}
                onClick={() => setWeapon(w)}
                aria-label={`${w} ${weaponInfo[w].title}`}
                aria-pressed={weapon === w}
                style={{ '--craft-color': PLAYER_CRAFT[w].color } as CSSProperties}
                className={weapon === w ? 'selected' : ''}
              >
                <span className="craft-preview">
                  <img
                    src={asset(`/images/ships/${w.toLowerCase()}.png`)}
                    alt={`${PLAYER_CRAFT[w].name} ${t(ROLE_KEY[w])}`}
                  />
                </span>
                <span className="craft-name">{PLAYER_CRAFT[w].name}</span>
                <strong>{w}</strong>
                <small>{weaponInfo[w].title}</small>
                {weapon === w && <Check size={15} className="check" />}
              </button>
            ))}
          </div>
          <p className="weapon-description">
            {t(weaponInfo[weapon].descriptionKey)}
            <span>
              {weaponInfo[weapon].stat} <b>{weaponInfo[weapon].value}</b>
            </span>
          </p>
          <div className="credit-select">
            <div>
              <small>02 / FLIGHT RESERVE</small>
              <strong>{t('CREDIT_SELECT')}</strong>
              <p>{t('CREDIT_EXPLAIN')}</p>
            </div>
            <div>
              <button
                aria-label={t('CREDIT_DECREASE')}
                disabled={credits === 1}
                onClick={() => setCredits((n) => Math.max(1, n - 1))}
              >
                <ChevronLeft />
              </button>
              <b>{credits.toString().padStart(2, '0')}</b>
              <button
                aria-label={t('CREDIT_INCREASE')}
                disabled={credits === 15}
                onClick={() => setCredits((n) => Math.min(15, n + 1))}
              >
                <ChevronRight />
              </button>
            </div>
          </div>
          <div className="briefing">
            <Shield size={17} />
            <p>{practice ? t('TRAINING_BRIEFING') : t('MISSION_BRIEFING')}</p>
          </div>
          <button
            className="primary wide"
            disabled={!ui.ready || account.launching || account.saving}
            onClick={start}
          >
            {t('LAUNCH_MISSION_LABEL')} <ArrowUpRight size={20} />
          </button>
          <p className="fine center">{t('PILOT_FLIGHT_NOTE')}</p>
        </Modal>
      )}
      {panel === 'settings' && (
        <Modal
          title="FLIGHT SETTINGS"
          eyebrow="SYSTEM CONFIGURATION"
          onClose={() => setPanel(null)}
        >
          <Setting
            label={t('GRAPHICS_QUALITY')}
            description={ui.autoQuality ? t('AUTO_QUALITY_DESC') : t('MANUAL_QUALITY_DESC')}
          >
            <select value={ui.quality} onChange={(e) => r()?.setQuality(e.target.value as Quality)}>
              {['HIGH', 'MEDIUM', 'LOW'].map((q) => (
                <option key={q}>{q}</option>
              ))}
            </select>
          </Setting>
          <Setting label={t('AUTO_QUALITY_ADJUST')}>
            <input
              type="checkbox"
              checked={ui.autoQuality}
              onChange={(e) => useUI.setState({ autoQuality: e.target.checked })}
            />
          </Setting>
          <Setting
            label={t('TOUCH_SENSITIVITY')}
            description={`${sensitivity.toFixed(1)}× · ${t('RELATIVE_DRAG_SUFFIX')}`}
          >
            <input
              aria-label={t('TOUCH_SENSITIVITY')}
              type="range"
              min=".5"
              max="2"
              step=".1"
              value={sensitivity}
              onChange={(e) => {
                setSensitivity(+e.target.value);
                if (r()) r()!.input.sensitivity = +e.target.value;
              }}
            />
          </Setting>
          <Setting
            label={t('SFX_VOLUME')}
            description={`${Math.round(volume * 100)}% · ${t('FIRE_EXPLOSION_ALERT_SUFFIX')}`}
          >
            <input
              aria-label={t('SFX_VOLUME')}
              type="range"
              min="0"
              max="1"
              step=".05"
              value={volume}
              onChange={(e) => {
                setVolume(+e.target.value);
                void r()?.audio.unlock();
                r()?.audio.setVolume(+e.target.value);
              }}
            />
          </Setting>
          <Setting
            label={t('MUSIC_VOLUME')}
            description={`${Math.round(musicVolume * 100)}% · STAGE ${String(
              ui.stageIndex + 1,
            ).padStart(2, '0')} ${trackName(STAGES[ui.stageIndex].music)}`}
          >
            <input
              aria-label={t('MUSIC_VOLUME')}
              type="range"
              min="0"
              max="1"
              step=".05"
              value={musicVolume}
              onChange={(e) => {
                setMusicVolume(+e.target.value);
                void r()?.audio.unlock();
                r()?.audio.setMusicVolume(+e.target.value);
              }}
            />
          </Setting>
          <Setting label={t('AUTO_FIRE')} description={t('AUTO_FIRE_DESC')}>
            <input
              type="checkbox"
              checked={autoFire}
              onChange={(e) => {
                setAutoFire(e.target.checked);
                r()?.setAutoFire(e.target.checked);
              }}
            />
          </Setting>
          <Setting label={t('SHOW_HITBOX')}>
            <input
              type="checkbox"
              checked={hitbox}
              onChange={(e) => {
                setHitbox(e.target.checked);
                if (r()) r()!.visual.hitbox = e.target.checked;
              }}
            />
          </Setting>
          <Setting label={t('REDUCE_SHAKE')}>
            <input
              type="checkbox"
              checked={motion}
              onChange={(e) => {
                setMotion(e.target.checked);
                if (r()) r()!.visual.reducedMotion = e.target.checked;
              }}
            />
          </Setting>
          <Setting label={t('BLOOM_EFFECT')}>
            <input
              type="checkbox"
              checked={bloom}
              onChange={(e) => {
                setBloom(e.target.checked);
                if (r()) r()!.visual.bloomEnabled = e.target.checked;
              }}
            />
          </Setting>
        </Modal>
      )}
      {panel === 'controls' && (
        <Modal
          title="FLIGHT MANUAL"
          eyebrow="KNOW YOUR INTERCEPTOR"
          onClose={() => setPanel(null)}
          wide
        >
          <div className="manual-grid">
            <div>
              <Move />
              <h3>MOVE & EVADE</h3>
              <p>
                <kbd>W A S D</kbd> {t('MOVE_LINE1')}
                <br />
                {t('MOVE_LINE2')}
                <br />
                {t('MOVE_LINE3')}
              </p>
            </div>
            <div>
              <Zap />
              <h3>WEAPONS ONLINE</h3>
              <p>
                {t('WEAPONS_LINE1')}
                <br />
                {t('WEAPONS_LINE2')}
                <br />
                {t('WEAPONS_LINE3')}
              </p>
            </div>
            <div>
              <Layers />
              <h3>OPTION CONTROL</h3>
              <p>
                <kbd>Q</kbd> {t('OPTION_LINE1A')} · <kbd>Shift</kbd> {t('OPTION_LINE1B')}{' '}
                <b>HOLD</b> {t('OPTION_LINE1C')}
                <br />
                {t('OPTION_LINE2')}
                <br />
                {t('OPTION_LINE3_PREFIX')} TRAIL {t('TRAIL_LABEL')} / FREEZE {t('FREEZE_LABEL')}
                <br />
                DIRECTIONAL {t('DIRECTIONAL_LABEL')} / ROTATE {t('ROTATE_LABEL')}
              </p>
            </div>
            <div>
              <Shield />
              <h3>TURN THE TIDE</h3>
              <p>
                <kbd>1</kbd> {t('TIDE_LINE1')}
                <br />
                {t('TIDE_LINE2')}
                <br />
                {t('TIDE_LINE3')}
              </p>
            </div>
          </div>
          <div className="briefing">
            <Gamepad2 size={21} />
            <p>{t('GAMEPAD_HELP')}</p>
          </div>
          <p className="fine">
            {t('LASER_CHARGE_HELP')}
            <br />
            {t('ENEMY_TELEGRAPH_HELP')}
          </p>
        </Modal>
      )}
      {panel === 'records' && (
        <Modal
          title="FLIGHT RECORDS"
          eyebrow={t('ALL_PILOTS_EYEBROW')}
          onClose={() => setPanel(null)}
          wide
        >
          <OnlineHistory />
        </Modal>
      )}
      {panel === 'recent' && (
        <Modal
          title="SORTIE LOG"
          eyebrow={t('RECENT_SORTIES_EYEBROW')}
          onClose={() => setPanel(null)}
          wide
        >
          <OnlineHistory mode="recent" />
        </Modal>
      )}
      {panel === 'guestbook' && (
        <Modal
          title="PILOT LOG"
          eyebrow={t('GUESTBOOK_EYEBROW')}
          onClose={() => setPanel(null)}
          wide
        >
          <Guestbook />
        </Modal>
      )}
      {(account.error || account.saving || account.launching) && (
        <div className="account-banner" role="status">
          {account.error || (account.saving ? t('SAVING_STATUS') : t('LAUNCHING_STATUS'))}
          {!account.error && account.launching && (
            <>
              {' '}
              {Math.round(account.launchProgress * 100)}%
              <div className="account-banner-bar">
                <div
                  className="account-banner-fill"
                  style={{ width: `${Math.max(4, account.launchProgress * 100)}%` }}
                />
              </div>
            </>
          )}
          {account.error && (
            <button
              onClick={() =>
                void r()
                  ?.finishRun()
                  .catch(() => {})
              }
            >
              {t('RETRY_SAVE')}
            </button>
          )}
        </div>
      )}
      {ui.error && (
        <div className="fatal">
          <h2>{t('GRAPHICS_INIT_FAILED')}</h2>
          <p>{ui.error}</p>
          {/* WebGL 2 is retried automatically now, so the link only helps a
              browser whose WebGPU path hangs rather than throws. */}
          <a href="?webgl=1">{t('WEBGL_FALLBACK')}</a>
        </div>
      )}
      {fullError && <div className="toast">{fullError}</div>}
      <div className="rotate-overlay">
        <div>↻</div>
        <h2>{t('ROTATE_DEVICE')}</h2>
        <p>{t('ROTATE_HINT')}</p>
        <span>LANDSCAPE FLIGHT ONLY</span>
      </div>
    </div>
  );
}
function Modal({
  title,
  eyebrow,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
  onClose?: () => void;
  wide?: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? 'modal-wide' : ''}`}
        onKeyDown={(e) => {
          if (e.key !== 'Tab') return;
          const nodes = ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input,select,a[href]',
          );
          if (!nodes?.length) return;
          const first = nodes[0],
            last = nodes[nodes.length - 1];
          if (
            e.shiftKey &&
            (document.activeElement === first || document.activeElement === ref.current)
          ) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="modal-heading">
          <small>{eyebrow}</small>
          {onClose && (
            <button aria-label={t('CLOSE')} onClick={onClose}>
              <X size={20} />
            </button>
          )}
          <h2>{title}</h2>
        </div>
        {children}
      </div>
    </div>
  );
}
function Setting({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <label className="setting">
      <span>
        {label}
        {description && <small>{description}</small>}
      </span>
      {children}
    </label>
  );
}
