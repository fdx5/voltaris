import { create } from 'zustand';

export type Locale = 'ko' | 'en';
const STORAGE_KEY = 'voltaris_locale';
const DEFAULT_LOCALE: Locale = 'ko';

/** `?lang=` wins, then a saved preference, then the browser's own language.
 * Safe outside a browser (SSR, unit tests under Node) - falls back to
 * DEFAULT_LOCALE rather than throwing when `location`/`localStorage`/
 * `navigator.language` aren't the real thing. */
function detectLocale(): Locale {
  try {
    const fromQuery = new URLSearchParams(location.search).get('lang');
    if (fromQuery === 'ko' || fromQuery === 'en') {
      localStorage.setItem(STORAGE_KEY, fromQuery);
      return fromQuery;
    }
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ko' || saved === 'en') return saved;
  } catch {
    // Private browsing / blocked storage / non-browser environment.
  }
  const language = typeof navigator === 'object' ? navigator.language : undefined;
  if (!language) return DEFAULT_LOCALE;
  return language.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

export const useLocaleStore = create<{ locale: Locale }>(() => ({ locale: detectLocale() }));

export function setLocale(locale: Locale) {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Ignore - the in-memory store still switches for this session.
  }
  useLocaleStore.setState({ locale });
  document.documentElement.lang = locale;
}

/** Read once outside a component (e.g. for the API client's locale header). */
export const getLocale = () => useLocaleStore.getState().locale;

type Key = keyof typeof STRINGS;
/** Reactive translator: re-renders the caller when the locale changes. */
export function useT() {
  const locale = useLocaleStore((s) => s.locale);
  return (key: Key) => STRINGS[key][locale];
}
/** For the handful of call sites outside React components (Runtime.ts). */
export const t = (key: Key) => STRINGS[key][getLocale()];

const STRINGS = {
  // Header
  BRAND_SUBTITLE: { ko: '볼타리스', en: '' },
  LOGOUT: { ko: '로그아웃', en: 'Log out' },
  LOGOUT_FAILED: { ko: '로그아웃 실패', en: 'Logout failed' },
  SOUND_TOGGLE: { ko: '사운드 켜기 또는 끄기', en: 'Toggle sound' },
  FULLSCREEN: { ko: '전체화면', en: 'Fullscreen' },
  WINDOWED: { ko: '창 모드', en: 'Windowed' },
  SETTINGS: { ko: '설정', en: 'Settings' },
  LANGUAGE_TOGGLE: { ko: 'English로 보기', en: '한국어로 보기' },

  // Main menu
  MAIN_MENU: { ko: '메인 메뉴', en: 'Main menu' },
  LAUNCH_READY_LABEL: { ko: 'BEGIN SORTIE 출격 준비', en: 'BEGIN SORTIE - ready for launch' },
  LAUNCH_INIT_LABEL: { ko: '기체 초기화 중', en: 'Initializing craft' },
  LAUNCH: { ko: '출격', en: 'Launch' },
  PREPARING: { ko: '기체 준비 중', en: 'Preparing craft' },
  PILOT_RANKING: { ko: '파일럿 랭킹', en: 'Pilot rankings' },
  CONTROLS_GUIDE: { ko: '조작 가이드', en: 'Flight manual' },
  BOSS_TRAINING_LABEL: { ko: 'SIMULATION 보스 훈련', en: 'SIMULATION - boss training' },
  BOSS_TRAINING: { ko: '보스 훈련', en: 'Boss training' },
  SELECT: { ko: '선택', en: 'select' },
  CONFIRM: { ko: '결정', en: 'confirm' },
  MISSION_STRIP: { ko: '작전 항로', en: 'Mission route' },
  SECTOR_SELECT_PREFIX: { ko: '작전 선택 ', en: '' },
  LOCKED_STAGE_HINT: {
    ko: '클리어 후 입장할 수 있습니다.',
    en: 'Clear it to unlock this sector.',
  },
  PLANET_EARTH: { ko: '지구', en: 'Earth' },
  PLANET_MARS: { ko: '화성', en: 'Mars' },
  PLANET_JUPITER: { ko: '목성', en: 'Jupiter' },
  PLANET_NEPTUNE: { ko: '해왕성', en: 'Neptune' },
  PLANET_GALAXY: { ko: '은하', en: 'Galaxy' },
  STAGE_CLEAR_REQUIRED_SUFFIX: { ko: '클리어 필요', en: 'clear required' },
  STANDBY: { ko: '출격 대기', en: 'Standing by' },
  TEST_LAB: { ko: '테스트 랩', en: 'Test lab' },

  // In-flight HUD
  TURRET_HINT: {
    ko: '포탑을 파괴하면 해당 포탑의 공격이 사라집니다',
    en: 'Destroying a turret removes its attacks',
  },
  OPTION_MODE_PREFIX: { ko: '옵션 모드', en: 'Option mode' },
  OPTION_MODE_SUFFIX: { ko: '눌러서 전환', en: 'press to switch' },
  OPTION_MODE_TITLE: { ko: '옵션 제어 모드 전환 (Q)', en: 'Switch option control mode (Q)' },
  OPTION_HOLD: { ko: '옵션 홀드', en: 'Option hold' },
  OPTION_HOLD_TITLE: {
    ko: '옵션 홀드 고정 / 해제 (Shift)',
    en: 'Lock/release option hold (Shift)',
  },
  PAUSE: { ko: '일시정지', en: 'Pause' },
  UNEQUIPPED: { ko: '미장착', en: 'Unequipped' },
  SKILL_SLOT_PREFIX: { ko: '특수기술', en: 'Skill' },
  TOUCH_HINT_MOVE: { ko: '화면을 드래그하여 이동', en: 'Drag the screen to move' },
  AUTO_FIRE_ON: { ko: '자동 발사', en: 'Auto-fire on' },
  AUTO_FIRE_OFF: { ko: '자동 발사 꺼짐', en: 'Auto-fire off' },
  TOUCH_HINT_OPTION: { ko: '우측 상단', en: 'top-right' },
  TOUCH_HINT_OPTION_SUFFIX: { ko: '로 옵션 제어', en: 'controls options' },

  // Test lab
  BULLET_TEST_LAB: { ko: '탄막 테스트 랩', en: 'Bullet-hell test lab' },
  BACK_TO_MENU: { ko: '메뉴로 돌아가기', en: 'Back to menu' },
  LAB_DESCRIPTION: {
    ko: '같은 3D 렌더러와 탄환 풀을 사용하는 성능 측정 환경입니다.',
    en: 'A benchmark environment using the same 3D renderer and bullet pool.',
  },
  BULLET_COUNT: { ko: '탄환 수', en: 'Bullet count' },
  SHIP_COUNT: { ko: '기체 수', en: 'Ship count' },
  TEST_QUALITY: { ko: '테스트 화질', en: 'Test quality' },
  GPU_MEMORY_NOTE: {
    ko: 'GPU 메모리와 GC 할당량은 별도 프로파일러 측정이 필요합니다.',
    en: 'GPU memory and GC allocation need a separate profiler to measure.',
  },
  SAVE_METRICS: { ko: '현재 측정값 저장', en: 'Save current metrics' },

  // Pause / continue / result modals
  COMBAT_PAUSED: { ko: '전투 일시정지', en: 'Combat paused' },
  PAUSE_FLAVOR: {
    ko: '호흡을 고르고, 다음 궤도를 준비하세요.',
    en: 'Catch your breath and prepare for the next pass.',
  },
  RESUME_COMBAT: { ko: '전투 재개', en: 'Resume combat' },
  ABANDON_TO_HANGAR: { ko: '출격 포기 · 격납고로', en: 'Abandon sortie - to hangar' },
  SIGNAL_LOST_DESTROYED: { ko: 'SIGNAL LOST / 기체 전멸', en: 'SIGNAL LOST / craft destroyed' },
  REMAINING_CREDITS_PREFIX: { ko: '남은 크레딧', en: 'Credits remaining' },
  SCORE_KEPT_SUFFIX: { ko: '점수는 유지됩니다.', en: '- your score carries over.' },
  RELAUNCH_RESET: {
    ko: '무기 Lv.1, 기체 3대, 특수기술 충전량 0으로 재출격합니다.',
    en: 'Relaunching at weapon Lv.1, 3 lives, and 0% skill charge.',
  },
  RELAUNCH: { ko: '다시 출격', en: 'Relaunch' },
  END_FLIGHT: { ko: '비행 종료', en: 'End flight' },
  GAMEOVER_EYEBROW: { ko: 'GAME OVER / 비행 종료', en: 'GAME OVER' },
  KILLS: { ko: '격추 수', en: 'Kills' },
  MAX_GRAZE: { ko: '최대 그레이즈', en: 'Max graze' },
  FINAL_WEAPON_LEVEL: { ko: '최종 무기 레벨', en: 'Final weapon level' },
  CREDITS_USED: { ko: '사용 크레딧', en: 'Credits used' },
  CLEAR_BONUS: { ko: '클리어 보너스', en: 'Clear bonus' },
  FLIGHT_TIME: { ko: '비행 시간', en: 'Flight time' },
  BOSS_TRAINING_RECORD: { ko: '보스 훈련 기록입니다.', en: 'This is a boss training record.' },
  BUILD_STAGE_COUNT_PREFIX: { ko: '현재 빌드에는', en: 'This build includes' },
  BUILD_STAGE_COUNT_SUFFIX: { ko: '스테이지가 포함되어 있습니다.', en: 'stages.' },
  RUN_SAVED_NOTE: {
    ko: '출격 기록은 계정에 저장되며 전체 파일럿 이력에서 조회할 수 있습니다.',
    en: "Runs are saved to your account and visible in every pilot's flight history.",
  },
  NEXT_STAGE_KEEP_LOADOUT: {
    ko: '다음 스테이지 · 강화 상태 유지',
    en: 'Next stage - keep upgrades',
  },
  RETRY: { ko: '다시 도전', en: 'Retry' },
  RETURN_TO_HANGAR: { ko: '격납고로 돌아가기', en: 'Return to hangar' },

  // Launch modal
  BOSS_TRAINING_EYEBROW_SUFFIX: { ko: '옵션 4기 · 훈련', en: '4 options · Training' },
  CRAFT_WEAPON_SELECT: { ko: '기체 · 무기 선택', en: 'Craft & weapon select' },
  CREDIT_SELECT: { ko: '크레딧 선택', en: 'Select credits' },
  CREDIT_EXPLAIN: { ko: '1 크레딧 = 기체 3대 · 무료 플레이', en: '1 credit = 3 lives · free play' },
  CREDIT_DECREASE: { ko: '크레딧 감소', en: 'Decrease credits' },
  CREDIT_INCREASE: { ko: '크레딧 증가', en: 'Increase credits' },
  TRAINING_BRIEFING: {
    ko: '세 가지 보스 패턴과 파괴 가능한 포탑을 연습합니다.',
    en: 'Practice three boss patterns and its destructible turrets.',
  },
  MISSION_BRIEFING: {
    ko: '방향키 / WASD로 이동 · 자동 사격 · [Q] 옵션 모드 · [Shift] 제어 · [1] 오버드라이브',
    en: 'Arrow keys / WASD to move · auto-fire · [Q] option mode · [Shift] control · [1] overdrive',
  },
  LAUNCH_MISSION_LABEL: { ko: '출격 · LAUNCH MISSION', en: 'LAUNCH MISSION' },
  PILOT_FLIGHT_NOTE: {
    ko: 'PILOT FLIGHT · 일반 모드 클리어 시 다음 스테이지 해금',
    en: 'PILOT FLIGHT · clearing normal mode unlocks the next stage',
  },

  // Settings modal
  GRAPHICS_QUALITY: { ko: '그래픽 품질', en: 'Graphics quality' },
  AUTO_QUALITY_DESC: {
    ko: '3초 평균이 45 FPS 미만이면 자동으로 낮아집니다.',
    en: 'Automatically drops if the 3-second average falls below 45 FPS.',
  },
  MANUAL_QUALITY_DESC: { ko: '수동 화질 설정', en: 'Manual quality setting' },
  AUTO_QUALITY_ADJUST: { ko: '자동 화질 조정', en: 'Auto-adjust quality' },
  TOUCH_SENSITIVITY: { ko: '터치 감도', en: 'Touch sensitivity' },
  RELATIVE_DRAG_SUFFIX: { ko: '상대 드래그', en: 'relative drag' },
  SFX_VOLUME: { ko: '효과음 볼륨', en: 'SFX volume' },
  FIRE_EXPLOSION_ALERT_SUFFIX: { ko: '사격 · 폭발 · 경보', en: 'fire · explosions · alerts' },
  MUSIC_VOLUME: { ko: '음악 볼륨', en: 'Music volume' },
  AUTO_FIRE: { ko: '자동 사격', en: 'Auto-fire' },
  AUTO_FIRE_DESC: {
    ko: '끄면 Z / Space / 게임패드 A로 사격',
    en: 'When off, fire with Z / Space / gamepad A',
  },
  SHOW_HITBOX: { ko: '피격 판정 점 표시', en: 'Show hit point' },
  REDUCE_SHAKE: { ko: '화면 흔들림 줄이기', en: 'Reduce screen shake' },
  BLOOM_EFFECT: { ko: '블룸 발광 효과', en: 'Bloom glow effect' },

  // Controls / flight manual modal
  MOVE_LINE1: { ko: '/ 방향키로 이동.', en: '/ Arrow keys to move.' },
  MOVE_LINE2: {
    ko: '터치는 버튼을 제외한 화면 전체에서 상대 드래그.',
    en: 'Touch: relative drag anywhere except the buttons.',
  },
  MOVE_LINE3: {
    ko: '기체 중앙의 작은 점이 피격 판정입니다.',
    en: "The small dot at your craft's center is the hit point.",
  },
  WEAPONS_LINE1: { ko: '사격은 기본 자동입니다.', en: 'Fire is automatic by default.' },
  WEAPONS_LINE2: { ko: '금색 캡슐로 무기를 강화하고', en: 'Gold capsules upgrade your weapon,' },
  WEAPONS_LINE3: {
    ko: '청색 링을 모아 옵션 기체를 추가하세요.',
    en: 'blue rings add option craft.',
  },
  OPTION_LINE1A: { ko: '모드 전환', en: 'switch mode' },
  OPTION_LINE1B: { ko: '또는 화면 우측 상단', en: 'or top-right' },
  OPTION_LINE1C: { ko: '제어', en: 'control' },
  OPTION_LINE2: {
    ko: '옵션은 1기로 시작하고 청색 링으로 4기까지 늘어납니다.',
    en: 'Options start at 1 and grow to 4 by collecting blue rings.',
  },
  OPTION_LINE3_PREFIX: { ko: '누르는 동안 —', en: 'While held —' },
  TRAIL_LABEL: { ko: '밀착 대형', en: 'tight formation' },
  FREEZE_LABEL: { ko: '위치 고정', en: 'holds position' },
  DIRECTIONAL_LABEL: { ko: '진행 방향 조준', en: 'aims along heading' },
  ROTATE_LABEL: { ko: '기체 공전', en: 'orbits the ship' },
  TIDE_LINE1: { ko: '획득한 오버드라이브 발동.', en: 'Activates a collected overdrive.' },
  TIDE_LINE2: { ko: '적을 격파하면 기술이 충전됩니다.', en: 'Destroying enemies charges skills.' },
  TIDE_LINE3: {
    ko: '적탄 가까이 스치면 점수 배율 상승.',
    en: 'Grazing enemy fire raises your score multiplier.',
  },
  GAMEPAD_HELP: {
    ko: '게임패드: 스틱 이동 · A 사격 · X/Y/B 기술 · RB 옵션 제어 · Start 일시정지',
    en: 'Gamepad: stick to move · A to fire · X/Y/B skills · RB option control · Start pauses',
  },
  LASER_CHARGE_HELP: {
    ko: 'LASER Lv.5 이상: Z / Space를 2초 홀드하면 차지샷을 발사합니다.',
    en: 'LASER Lv.5+: hold Z / Space for 2s to fire a charge shot.',
  },
  ENEMY_TELEGRAPH_HELP: {
    ko: '적의 발광 점멸은 발사 예고입니다. 보스 포탑을 먼저 부숴 탄막을 줄여보세요.',
    en: "An enemy's flashing glow telegraphs its next shot. Destroy boss turrets first to thin the bullet hell.",
  },

  // Records modal
  ALL_PILOTS_EYEBROW: { ko: 'ALL PILOTS / 전체 게임 이력', en: 'ALL PILOTS / full flight history' },

  // Account banner / errors
  SAVING_STATUS: { ko: '플레이 검증 및 기록 저장 중…', en: 'Verifying and saving your run…' },
  LAUNCHING_STATUS: { ko: '출격 승인 중…', en: 'Authorizing launch…' },
  RETRY_SAVE: { ko: '저장 다시 시도', en: 'Retry save' },
  GRAPHICS_INIT_FAILED: {
    ko: '그래픽 초기화에 실패했습니다',
    en: 'Graphics initialization failed',
  },
  WEBGL_FALLBACK: {
    ko: 'WebGL 2 호환 모드로 다시 실행',
    en: 'Restart in WebGL 2 compatibility mode',
  },
  ROTATE_DEVICE: { ko: '가로로 돌려주세요', en: 'Please rotate to landscape' },
  ROTATE_HINT: {
    ko: '최적의 비행을 위해 기기를 가로 방향으로 회전하세요.',
    en: 'Rotate your device to landscape for the best flight experience.',
  },
  CLOSE: { ko: '닫기', en: 'Close' },
  FULLSCREEN_UNSUPPORTED: {
    ko: '이 브라우저에서는 홈 화면에 추가하여 전체화면으로 실행하세요.',
    en: 'On this browser, add to your home screen to run in fullscreen.',
  },

  // Weapon select
  WEAPON_DESC_LASER: {
    ko: '고출력 관통 레이저. 적의 코어를 정밀하게 공략합니다.',
    en: "High-output penetrating laser. Precision strikes on the enemy's core.",
  },
  WEAPON_DESC_MISSILE: {
    ko: 'KESTREL · 자동 추적 미사일 전투기. 넓게 펼친 미사일이 목표를 추격하며, 옵션은 소형 보조 미사일을 발사합니다.',
    en: 'KESTREL · Homing-missile fighter. A wide missile spread pursues targets, and options fire small support missiles.',
  },
  WEAPON_DESC_SPREAD: {
    ko: 'MANTA · 확산 미사일 전투기. 좁고 넓은 탄도를 교차 발사하며, 옵션은 소형 미사일로 집중 사격합니다.',
    en: 'MANTA · Spread-missile fighter. Crosses narrow and wide trajectories, with options concentrating small-missile fire.',
  },

  // Craft roles (loadout screen)
  ROLE_LASER: { ko: '정밀 요격기', en: 'Precision Interceptor' },
  ROLE_MISSILE: { ko: '유도 미사일 전투기', en: 'Homing-Missile Fighter' },
  ROLE_SPREAD: { ko: '광역 제압 전투기', en: 'Area-Suppression Fighter' },

  // src/main.tsx
  PREPARING_HANGAR: {
    ko: 'VOLTARIS · 기체 격납고를 준비하고 있습니다…',
    en: 'VOLTARIS · Preparing the flight hangar…',
  },
  MODEL_LOAD_FAILED: {
    ko: '기체 모델을 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.',
    en: 'Could not load craft models. Check your connection and try again.',
  },
  TRY_AGAIN: { ko: '다시 시도', en: 'Try again' },

  // src/core/Runtime.ts
  WEBGPU_CONTEXT_FAILED: {
    ko: '그래픽 드라이버가 3D 컨텍스트를 열지 못했습니다. 다른 탭을 닫고 새로고침해 주세요.',
    en: 'The graphics driver could not open a 3D context. Close other tabs and refresh.',
  },
  WEBGL2_UNSUPPORTED: {
    ko: '브라우저의 하드웨어 가속이 꺼져 있거나 WebGL 2를 지원하지 않습니다. 브라우저 설정에서 하드웨어 가속을 켜고 새로고침해 주세요.',
    en: 'Hardware acceleration is off or WebGL 2 is unsupported. Enable hardware acceleration in your browser settings and refresh.',
  },
  LAUNCH_FAILED: { ko: '출격할 수 없습니다.', en: 'Could not launch.' },
  SAVE_DELAYED: {
    ko: '저장 응답이 지연되고 있습니다. 저장 다시 시도를 눌러 주세요.',
    en: 'The save is taking longer than expected. Press retry save.',
  },
  SAVE_FAILED: { ko: '기록 저장 실패', en: 'Failed to save the run' },

  // src/core/renderer/ThreeBackend.ts
  COMBAT_CANVAS_LABEL: { ko: 'VOLTARIS 3D 전투 화면', en: 'VOLTARIS 3D combat view' },

  // src/ui/store/useAccount.ts fallbacks
  UNREADABLE_RESPONSE: {
    ko: '서버 응답을 읽을 수 없습니다.',
    en: "Couldn't read the server response.",
  },
  REQUEST_FAILED: { ko: '요청 실패', en: 'Request failed' },
  SERVER_UNRESPONSIVE: {
    ko: '서버가 응답하지 않습니다. 잠시 후 다시 시도해주세요.',
    en: 'The server is not responding. Please try again shortly.',
  },

  // Account.tsx - login/register
  CREATE_PILOT_ACCOUNT: { ko: '파일럿 계정 만들기', en: 'Create a pilot account' },
  PILOT_LOGIN: { ko: '파일럿 로그인', en: 'Pilot login' },
  LOGIN_INTRO: {
    ko: '클리어 기록을 이어가고 모든 파일럿의 비행 이력을 확인하세요.',
    en: "Carry your clear record forward and see every pilot's flight history.",
  },
  LOGIN_FINE_PRINT: {
    ko: '첫 출격은 STAGE 01부터 시작합니다. 일반 모드 클리어 시 다음 스테이지가 열립니다. ID와 게임 이력은 로그인한 모든 사용자에게 공개됩니다.',
    en: 'Your first sortie starts at STAGE 01. Clearing normal mode unlocks the next stage. Your ID and flight history are visible to every logged-in user.',
  },
  USERNAME_LABEL: { ko: '아이디', en: 'ID' },
  USERNAME_PLACEHOLDER: { ko: '영문·숫자·_ 3~24자', en: 'Letters, digits, _ · 3-24 chars' },
  PASSWORD_LABEL: { ko: '비밀번호', en: 'Password' },
  PASSWORD_PLACEHOLDER: { ko: '4자 이상', en: '4+ characters' },
  CONNECTING: { ko: '연결 중…', en: 'Connecting…' },
  CHECKING_SESSION: { ko: '세션 확인 중…', en: 'Checking session…' },
  SIGN_UP_START: { ko: '가입하고 시작', en: 'Sign up and start' },
  LOGIN: { ko: '로그인', en: 'Log in' },
  LOGIN_EXISTING: { ko: '기존 계정으로 로그인', en: 'Log in with an existing account' },
  NEW_HERE_REGISTER: { ko: '처음 오셨나요? 회원가입', en: 'New here? Sign up' },
  LOGIN_FAILED: { ko: '로그인 실패', en: 'Login failed' },

  // Account.tsx - online history
  STATUS_STARTED: { ko: '진행 / 미완료', en: 'In progress' },
  STATUS_CLEAR: { ko: '클리어', en: 'Clear' },
  STATUS_GAMEOVER: { ko: '게임오버', en: 'Game over' },
  STATUS_ABANDONED: { ko: '중도 종료', en: 'Abandoned' },
  TRAINING_PREFIX: { ko: '훈련 · ', en: 'Training · ' },
  HISTORY_FINE_PRINT: {
    ko: '스테이지별 최고 점수 순위 · 일반 모드 클리어만 다음 스테이지를 해금합니다.',
    en: 'Top scores per stage · only a normal-mode clear unlocks the next stage.',
  },
  STAGE_SELECT_LABEL: { ko: '스테이지 선택', en: 'Select stage' },
  PILOT_ID_SEARCH: { ko: '파일럿 ID 검색', en: 'Search pilot ID' },
  PILOT_ID_PLACEHOLDER: { ko: '파일럿 ID (전체 보기: 빈칸)', en: 'Pilot ID (leave blank for all)' },
  SEARCH: { ko: '조회', en: 'Search' },
  MY_RECORDS: { ko: '내 기록', en: 'My records' },
  LOADING_HISTORY: { ko: '이력을 불러오는 중…', en: 'Loading history…' },
  NO_RECORDS: {
    ko: '조건에 맞는 비행 기록이 없습니다.',
    en: 'No flight records match these filters.',
  },
  RANK: { ko: '순위', en: 'Rank' },
  PILOT: { ko: '파일럿', en: 'Pilot' },
  STAGE: { ko: '스테이지', en: 'Stage' },
  RESULT: { ko: '결과', en: 'Result' },
  SCORE: { ko: '점수', en: 'Score' },
  WEAPON: { ko: '무기', en: 'Weapon' },
  TABLE_KILLS: { ko: '격추', en: 'Kills' },
  TIME: { ko: '시간', en: 'Time' },
  LAUNCHED_AT: { ko: '출격 일시', en: 'Launched' },
  PREV: { ko: '이전', en: 'Prev' },
  NEXT: { ko: '다음', en: 'Next' },
} satisfies Record<string, Record<Locale, string>>;
