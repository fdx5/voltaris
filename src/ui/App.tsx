import { useAccount, loadAccount, api } from './store/useAccount';
import { LoginScreen, OnlineHistory } from './Account';
import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import {
  ArrowUpRight,
  ArrowRight,
  ChevronRight,
  ChevronLeft,
  Volume2,
  VolumeX,
  Maximize,
  Settings2,
  X,
  Pause,
  Play,
  Crosshair,
  Gamepad2,
  Keyboard,
  Shield,
  Layers,
  Zap,
  Target,
  Move,
  Orbit,
  Activity,
  RotateCcw,
  Lock,
  Check,
  Download,
} from 'lucide-react';
import { Runtime } from '../core/Runtime';
import { useUI } from './store/useUI';
import { STAGES } from '../game/stages';
import { MODES, type Weapon } from '../game/GameState';
import { Key } from '../core/input/InputManager';
import type { Quality } from '../core/renderer/IRenderBackend';
import tuning from '../../data/tuning.json';
const number = (n: number) => Math.floor(n).toLocaleString('en-US');
const clock = (n: number) =>
  `${Math.floor(n / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(n % 60)
    .toString()
    .padStart(2, '0')}`;
type Panel = 'launch' | 'settings' | 'controls' | 'records' | null;
const weaponInfo = {
  LASER: {
    title: 'PRECISION LANCE',
    description: '고출력 관통 레이저. 적의 코어를 정밀하게 공략합니다.',
    stat: 'PENETRATION',
    value: '★★★★★',
  },
  MISSILE: {
    title: 'HOMING ARRAY',
    description: '자동 추적 미사일. 회피에 집중하면서 넓은 전장을 통제합니다.',
    stat: 'TRACKING',
    value: '★★★★★',
  },
  SPREAD: {
    title: 'SCATTER CANNON',
    description: '부채꼴 확산 포탄. 근접 전투와 편대 격파에 특화됩니다.',
    stat: 'COVERAGE',
    value: '★★★★★',
  },
};
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
function GameApp() {
  const account = useAccount();

  const host = useRef<HTMLDivElement>(null),
    runtime = useRef<Runtime | null>(null);
  const ui = useUI();
  const [panel, setPanel] = useState<Panel>(null),
    [weapon, setWeapon] = useState<Weapon>('LASER'),
    [credits, setCredits] = useState(3),
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
    [fullError, setFullError] = useState('');
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
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        await document.documentElement.requestFullscreen();
        const o = screen.orientation as ScreenOrientation & { lock?: (s: string) => Promise<void> };
        await o.lock?.('landscape').catch(() => {});
      }
    } catch {
      setFullError('이 브라우저에서는 홈 화면에 추가하여 전체화면으로 실행하세요.');
      setTimeout(() => setFullError(''), 5000);
    }
  };
  const start = async () => {
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
    a.download = 'zero-lance-performance.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  const active = ui.status !== 'menu';
  return (
    <div className={`app ${active ? 'in-flight' : ''}`}>
      <div className="render-host" ref={host} />
      <div className="vignette" />
      <div className="texture" />
      {!active && (
        <>
          <header className="header">
            <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
              <span className="brand-mark">Z</span>
              <span>
                ZERO LANCE<small>ORBITAL COMMAND</small>
              </span>
            </a>
            <div className="nav-caption">
              <span className="status-dot" /> SYSTEMS {ui.ready ? 'ONLINE' : 'INITIALIZING'}
            </div>
            <div className="header-tools">
              <span className="guest">
                PILOT <b>{account.user?.username}</b>
              </span>
              <button
                aria-label="로그아웃"
                onClick={async () => {
                  try {
                    await r()?.finishRun();
                    await api('/auth/logout', {});
                    useAccount.setState({ user: null, error: '' });
                  } catch (e) {
                    useAccount.setState({
                      error: e instanceof Error ? e.message : '로그아웃 실패',
                    });
                  }
                }}
              >
                로그아웃
              </button>
              <button aria-label="사운드 켜기 또는 끄기" onClick={toggleSound}>
                {muted ? <VolumeX /> : <Volume2 />}
              </button>
              <button aria-label="전체화면" onClick={() => void fullscreen()}>
                <Maximize />
              </button>
              <button aria-label="설정" onClick={() => open('settings')}>
                <Settings2 />
              </button>
            </div>
          </header>
          <main className="command">
            <div className="eyebrow">
              <span /> EARTH DEFENSE INITIATIVE <b>2186</b>
            </div>
            <div className="title">
              <span>ZERO</span>
              <span>
                LANCE<i>™</i>
              </span>
            </div>
            <p className="tagline">THE SILENCE ENDS HERE.</p>
            <p className="intro">
              지구의 마지막 방어선.
              <br />단 한 기의 창으로, 궤도의 어둠을 돌파하라.
            </p>
            <div className="main-actions">
              <button
                className="launch"
                disabled={!ui.ready || account.launching || account.saving}
                onClick={() => {
                  setPractice(false);
                  open('launch');
                }}
              >
                <span>
                  <small>BEGIN SORTIE</small>
                  {ui.ready ? '출격 준비' : '기체 초기화 중'}
                </span>
                <ArrowUpRight size={28} />
              </button>
              <button className="text-button" onClick={() => open('controls')}>
                FLIGHT MANUAL <ArrowRight size={15} />
              </button>
            </div>
            <nav className="secondary">
              <button onClick={() => open('records')}>
                비행 기록 <ChevronRight />
              </button>
              <button onClick={stress} disabled={!ui.ready || account.launching || account.saving}>
                테스트 랩 <Activity size={13} />
              </button>
            </nav>
          </main>
          <div className="ship-label">
            <span className="bracket" />
            <small>INTERCEPTOR CLASS</small>
            <strong>
              ZL–01 <span> / </span> LANCE
            </strong>
            <p>DUAL ION DRIVE · ADAPTIVE ARMAMENT</p>
            <div>
              <span>HULL INTEGRITY</span>
              <i />
              <b>100%</b>
            </div>
          </div>
          <aside className="coordinates">
            N 35° 42′ 18″
            <br />E 139° 41′ 32″<span>ALTITUDE 408 KM</span>
          </aside>
          <section className="mission-strip">
            <div className="mission-heading">
              <span>MISSION SELECT</span>
              <small>04 / 06 SECTORS</small>
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
                    title={locked ? `STAGE ${index} 클리어 후 입장할 수 있습니다.` : mission.name}
                    onClick={() => {
                      setStage(index);
                      setPractice(false);
                      open('launch');
                    }}
                  >
                    <img
                      className="mission-visual"
                      src={`/images/missions/${['earth', 'mars', 'jupiter', 'neptune'][index]}.webp`}
                      alt={['지구', '화성', '목성', '해왕성'][index]}
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
                      <p>{locked ? `STAGE ${index} 클리어 필요` : mission.subtitle}</p>
                    </div>
                    {locked ? <Lock size={20} /> : <ArrowUpRight size={20} />}
                  </button>
                );
              })}
              <button
                className="boss-training"
                disabled={!ui.ready || account.launching || account.saving}
                onClick={() => {
                  setPractice(true);
                  open('launch');
                }}
              >
                <Target size={23} />
                <div>
                  <small>SIMULATION</small>
                  <strong>보스 훈련</strong>
                </div>
                <ChevronRight size={18} />
              </button>
            </div>
          </section>
          <footer className="footer">
            <span>
              <span className="status-dot" /> {ui.backend} <i>/</i>{' '}
              {ui.ready ? `${Math.round(ui.fps)} FPS` : 'CONNECTING'}
            </span>
            <span>
              ORIGINAL ARCADE SHOOTER <i>·</i> FIRST PLAYABLE / 0.1
            </span>
            <button onClick={() => open('controls')}>
              {ui.gamepad ? <Gamepad2 size={14} /> : <Keyboard size={14} />} KEYBOARD · TOUCH ·
              GAMEPAD
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
            <strong>{Math.floor(ui.score).toString().padStart(7, '0')}</strong>
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
              >
                <Orbit size={15} />
                {MODES[ui.mode]}
                <kbd>Q</kbd>
              </button>
              <button
                aria-label="일시정지"
                onClick={() => {
                  r()?.game.pause();
                  r()?.publish();
                }}
              >
                <Pause size={19} />
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
                  PHASE 0{ui.bossPhase} · {clock(180 - ui.bossTime)}
                </span>
              </small>
              <div>
                <i style={{ width: `${Math.max(0, (ui.bossHp / 2400) * 100)}%` }} />
              </div>
              <p>포탑을 파괴하면 해당 포탑의 공격이 사라집니다</p>
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
                {weapon} <b>LV {ui.level}</b>
              </span>
              <div>
                {Array.from({ length: 8 }, (_, i) => (
                  <i key={i} className={i < ui.level ? 'lit' : ''} />
                ))}
              </div>
            </div>
            <p>
              OPTION {ui.optionCount}/4 <i>·</i> SHIELD {ui.shield}
            </p>
          </div>
          <div className="skills">
            {[0, 1, 2].map((i) => (
              <button
                key={i}
                aria-label={`특수기술 ${i + 1}`}
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
                      ? '미장착'
                      : !ui.skillUnlocked
                        ? 'STAGE REWARD'
                        : ui.charge[i] >= 0.999
                          ? ui.skills[i] === 0
                            ? 'READY ? 3s INVINCIBLE'
                            : 'READY'
                          : `${Math.floor(ui.charge[i] * 100)}%`}
                </small>
              </button>
            ))}
          </div>
          <div className="touch-controls">
            <span>화면을 드래그하여 이동 · {autoFire ? '자동 발사' : '자동 발사 꺼짐'}</span>
            <button
              onPointerDown={(e) => {
                e.preventDefault();
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {
                  return;
                }
                r()?.input.set(Key.Hold, true, e.pointerId);
              }}
              onPointerUp={(e) => r()?.input.set(Key.Hold, false, e.pointerId)}
              onPointerCancel={(e) => r()?.input.set(Key.Hold, false, e.pointerId)}
              onLostPointerCapture={(e) => r()?.input.set(Key.Hold, false, e.pointerId)}
              aria-label="누르는 동안 옵션 위치 고정"
            >
              OPTION HOLD
            </button>
          </div>
        </div>
      )}
      {ui.status === 'stress' && (
        <div className="lab">
          <div className="lab-head">
            <div>
              <small>ENGINE VALIDATION / M0</small>
              <h2>탄막 테스트 랩</h2>
            </div>
            <button aria-label="메뉴로 돌아가기" onClick={() => r()?.menu()}>
              <X />
            </button>
          </div>
          <p>같은 3D 렌더러와 탄환 풀을 사용하는 성능 측정 환경입니다.</p>
          <label>
            ACTIVE BULLETS <b>{stressCount}</b>
            <input
              aria-label="탄환 수"
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
              aria-label="기체 수"
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
            aria-label="테스트 화질"
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
            GPU 메모리와 GC 할당량은 별도 프로파일러 측정이 필요합니다.
          </p>
          <button className="primary" onClick={download}>
            <Download size={16} /> 현재 측정값 저장
          </button>
        </div>
      )}
      {ui.status === 'paused' && !panel && (
        <Modal title="FLIGHT PAUSED" eyebrow="전투 일시정지" onClose={() => r()?.resume()}>
          <p>호흡을 고르고, 다음 궤도를 준비하세요.</p>
          <button className="primary wide" onClick={() => r()?.resume()}>
            <Play size={17} /> 전투 재개
          </button>
          <button className="secondary-button wide" onClick={() => open('settings')}>
            설정
          </button>
          <button className="secondary-button wide" onClick={() => r()?.menu()}>
            출격 포기 · 격납고로
          </button>
        </Modal>
      )}
      {ui.status === 'continue' && (
        <Modal title="CONTINUE?" eyebrow="SIGNAL LOST / 기체 전멸">
          <div className="countdown">{Math.ceil(ui.continueTime)}</div>
          <p>
            남은 크레딧 {ui.credits - ui.creditsUsed} · 점수는 유지됩니다.
            <br />
            무기 Lv.1, 기체 3대, 특수기술 충전량 0으로 재출격합니다.
          </p>
          <button
            className="primary wide"
            onClick={() => {
              r()?.continueRun();
              r()?.audio.resume();
              r()?.publish();
            }}
          >
            다시 출격 <ArrowRight size={17} />
          </button>
          <button
            className="secondary-button wide"
            onClick={() => {
              if (r()) r()!.game.status = 'gameover';
            }}
          >
            비행 종료
          </button>
        </Modal>
      )}
      {(ui.status === 'clear' || ui.status === 'gameover') && (
        <Modal
          title={ui.status === 'clear' ? 'SECTOR SECURED' : 'SIGNAL LOST'}
          eyebrow={
            ui.status === 'clear'
              ? `STAGE ${String(ui.stageIndex + 1).padStart(2, '0')} CLEAR / ${ui.stageName}`
              : 'GAME OVER / 비행 종료'
          }
        >
          <div className="result-score">
            <small>TOTAL SCORE</small>
            <strong>{number(ui.score)}</strong>
          </div>
          <div className="result-grid">
            <span>
              격추 수<b>{ui.kills}</b>
            </span>
            <span>
              최대 그레이즈<b>×{ui.maxGraze.toFixed(2)}</b>
            </span>
            <span>
              최종 무기 레벨<b>Lv.{ui.level}</b>
            </span>
            <span>
              사용 크레딧<b>{ui.creditsUsed}</b>
            </span>
            <span>
              클리어 보너스<b>{number(ui.bonus)}</b>
            </span>
            <span>
              비행 시간<b>{clock(ui.time)}</b>
            </span>
          </div>
          <p className="fine">
            {practice
              ? '보스 훈련 기록입니다.'
              : `현재 빌드에는 ${STAGES.length}스테이지가 포함되어 있습니다.`}
            <br />
            출격 기록은 계정에 저장되며 전체 파일럿 이력에서 조회할 수 있습니다.
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
              <ArrowUpRight size={16} /> 다음 스테이지 · 강화 상태 유지
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
            <RotateCcw size={16} /> 다시 도전
          </button>
          <button className="secondary-button wide" onClick={() => r()?.menu()}>
            격납고로 돌아가기
          </button>
        </Modal>
      )}
      {panel === 'launch' && (
        <Modal
          title={practice ? 'BOSS SIMULATION' : 'PREPARE FOR LAUNCH'}
          eyebrow={
            practice
              ? `${STAGES[stage].boss.id} / Lv.6 · 옵션 4기 · 훈련`
              : `MISSION ${String(stage + 1).padStart(2, '0')} / ${STAGES[stage].name}`
          }
          onClose={() => setPanel(null)}
          wide
        >
          <div className="loadout-heading">
            <span>
              01 <b>SELECT ARMAMENT</b>
            </span>
            <small>무기 선택</small>
          </div>
          <div className="weapon-select">
            {(['LASER', 'MISSILE', 'SPREAD'] as Weapon[]).map((w, i) => (
              <button
                key={w}
                onClick={() => setWeapon(w)}
                className={weapon === w ? 'selected' : ''}
              >
                <span className={`weapon-icon weapon-${i}`}>
                  {i === 0 ? <Zap /> : i === 1 ? <Target /> : <Crosshair />}
                </span>
                <strong>{w}</strong>
                <small>{weaponInfo[w].title}</small>
                {weapon === w && <Check size={15} className="check" />}
              </button>
            ))}
          </div>
          <p className="weapon-description">
            {weaponInfo[weapon].description}
            <span>
              {weaponInfo[weapon].stat} <b>{weaponInfo[weapon].value}</b>
            </span>
          </p>
          <div className="credit-select">
            <div>
              <small>02 / FLIGHT RESERVE</small>
              <strong>크레딧 선택</strong>
              <p>1 크레딧 = 기체 3대 · 무료 플레이</p>
            </div>
            <div>
              <button
                aria-label="크레딧 감소"
                disabled={credits === 1}
                onClick={() => setCredits((n) => Math.max(1, n - 1))}
              >
                <ChevronLeft />
              </button>
              <b>{credits.toString().padStart(2, '0')}</b>
              <button
                aria-label="크레딧 증가"
                disabled={credits === 9}
                onClick={() => setCredits((n) => Math.min(9, n + 1))}
              >
                <ChevronRight />
              </button>
            </div>
          </div>
          <div className="briefing">
            <Shield size={17} />
            <p>
              {practice
                ? '세 가지 보스 패턴과 파괴 가능한 포탑을 연습합니다.'
                : '방향키 / WASD로 이동 · 자동 사격 · [Q] 옵션 모드 · [Shift] 제어 · [1] 오버드라이브'}
            </p>
          </div>
          <button
            className="primary wide"
            disabled={!ui.ready || account.launching || account.saving}
            onClick={start}
          >
            출격 · LAUNCH MISSION <ArrowUpRight size={20} />
          </button>
          <p className="fine center">PILOT FLIGHT · 일반 모드 클리어 시 다음 스테이지 해금</p>
        </Modal>
      )}
      {panel === 'settings' && (
        <Modal
          title="FLIGHT SETTINGS"
          eyebrow="SYSTEM CONFIGURATION"
          onClose={() => setPanel(null)}
        >
          <Setting
            label="그래픽 품질"
            description={
              ui.autoQuality ? '3초 평균이 45 FPS 미만이면 자동으로 낮아집니다.' : '수동 화질 설정'
            }
          >
            <select value={ui.quality} onChange={(e) => r()?.setQuality(e.target.value as Quality)}>
              {['HIGH', 'MEDIUM', 'LOW'].map((q) => (
                <option key={q}>{q}</option>
              ))}
            </select>
          </Setting>
          <Setting label="자동 화질 조정">
            <input
              type="checkbox"
              checked={ui.autoQuality}
              onChange={(e) => useUI.setState({ autoQuality: e.target.checked })}
            />
          </Setting>
          <Setting label="터치 감도" description={`${sensitivity.toFixed(1)}× · 상대 드래그`}>
            <input
              aria-label="터치 감도"
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
            label="효과음 볼륨"
            description={`${Math.round(volume * 100)}% · 사격 · 폭발 · 경보`}
          >
            <input
              aria-label="효과음 볼륨"
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
            label="음악 볼륨"
            description={`${Math.round(musicVolume * 100)}% · STAGE ${String(
              ui.stageIndex + 1,
            ).padStart(2, '0')} ${trackName(STAGES[ui.stageIndex].music)}`}
          >
            <input
              aria-label="음악 볼륨"
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
          <Setting label="자동 사격" description="끄면 Z / Space / 게임패드 A로 사격">
            <input
              type="checkbox"
              checked={autoFire}
              onChange={(e) => {
                setAutoFire(e.target.checked);
                r()?.setAutoFire(e.target.checked);
              }}
            />
          </Setting>
          <Setting label="피격 판정 점 표시">
            <input
              type="checkbox"
              checked={hitbox}
              onChange={(e) => {
                setHitbox(e.target.checked);
                if (r()) r()!.visual.hitbox = e.target.checked;
              }}
            />
          </Setting>
          <Setting label="화면 흔들림 줄이기">
            <input
              type="checkbox"
              checked={motion}
              onChange={(e) => {
                setMotion(e.target.checked);
                if (r()) r()!.visual.reducedMotion = e.target.checked;
              }}
            />
          </Setting>
          <Setting label="블룸 발광 효과">
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
                <kbd>W A S D</kbd> / 방향키로 이동.
                <br />
                터치는 화면 왼쪽에서 상대 드래그.
                <br />
                기체 중앙의 작은 점이 피격 판정입니다.
              </p>
            </div>
            <div>
              <Zap />
              <h3>WEAPONS ONLINE</h3>
              <p>
                사격은 기본 자동입니다.
                <br />
                금색 캡슐로 무기를 강화하고
                <br />
                청색 링을 모아 옵션 기체를 추가하세요.
              </p>
            </div>
            <div>
              <Layers />
              <h3>OPTION CONTROL</h3>
              <p>
                <kbd>Q</kbd> 모드 전환 · <kbd>Shift</kbd> 제어
                <br />
                TRAIL 후행 / FREEZE 위치 고정
                <br />
                DIRECTIONAL 조준 / ROTATE 공전
              </p>
            </div>
            <div>
              <Shield />
              <h3>TURN THE TIDE</h3>
              <p>
                <kbd>1</kbd> 획득한 오버드라이브 발동.
                <br />
                적을 격파하면 기술이 충전됩니다.
                <br />
                적탄 가까이 스치면 점수 배율 상승.
              </p>
            </div>
          </div>
          <div className="briefing">
            <Gamepad2 size={21} />
            <p>게임패드: 스틱 이동 · A 사격 · X/Y/B 기술 · RB 옵션 제어 · Start 일시정지</p>
          </div>
          <p className="fine">
            LASER Lv.5 이상: Z / Space를 2초 홀드하면 차지샷을 발사합니다.
            <br />
            적의 발광 점멸은 발사 예고입니다. 보스 포탑을 먼저 부숴 탄막을 줄여보세요.
          </p>
        </Modal>
      )}
      {panel === 'records' && (
        <Modal
          title="FLIGHT RECORDS"
          eyebrow="ALL PILOTS / 전체 게임 이력"
          onClose={() => setPanel(null)}
          wide
        >
          <OnlineHistory />
        </Modal>
      )}
      {(account.error || account.saving || account.launching) && (
        <div className="account-banner" role="status">
          {account.error || (account.saving ? '플레이 검증 및 기록 저장 중…' : '출격 승인 중…')}
          {account.error && (
            <button
              onClick={() =>
                void r()
                  ?.finishRun()
                  .catch(() => {})
              }
            >
              저장 다시 시도
            </button>
          )}
        </div>
      )}
      {ui.error && (
        <div className="fatal">
          <h2>그래픽 초기화에 실패했습니다</h2>
          <p>{ui.error}</p>
          {/* WebGL 2 is retried automatically now, so the link only helps a
              browser whose WebGPU path hangs rather than throws. */}
          <a href="?webgl=1">WebGL 2 호환 모드로 다시 실행</a>
        </div>
      )}
      {fullError && <div className="toast">{fullError}</div>}
      <div className="rotate-overlay">
        <div>↻</div>
        <h2>가로로 돌려주세요</h2>
        <p>최적의 비행을 위해 기기를 가로 방향으로 회전하세요.</p>
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
            <button aria-label="닫기" onClick={onClose}>
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
