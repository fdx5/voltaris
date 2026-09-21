// Server-side error message localization. Every error the API surfaces to a
// client is a KEY into MESSAGES rather than raw prose, so the same error can
// be rendered in the caller's own language - the client sends its resolved
// locale as an X-Locale header (falling back to Accept-Language), see
// resolveLocale below.
export const LOCALES = ['ko', 'en'];
export const DEFAULT_LOCALE = 'ko';

export const MESSAGES = {
  DB_NOT_READY: { ko: '데이터베이스 연결 대기 중', en: 'Waiting for database connection' },
  FORBIDDEN_REQUEST: { ko: '허용되지 않은 요청입니다.', en: 'This request is not allowed.' },
  RATE_LIMITED: {
    ko: '요청이 많습니다. 잠시 후 다시 시도하세요.',
    en: 'Too many requests. Try again shortly.',
  },
  AUTH_RATE_LIMITED: {
    ko: '로그인 시도가 많습니다. 15분 후 다시 시도하세요.',
    en: 'Too many login attempts. Try again in 15 minutes.',
  },
  CREDENTIALS_FORMAT: {
    ko: 'ID는 영문·숫자·_ 3~24자, 비밀번호는 4~128자로 입력하세요.',
    en: 'ID must be 3-24 letters/digits/underscore; password must be 4-128 characters.',
  },
  USERNAME_TAKEN: { ko: '이미 사용 중인 ID입니다.', en: 'This ID is already taken.' },
  INVALID_CREDENTIALS: {
    ko: 'ID 또는 비밀번호가 올바르지 않습니다.',
    en: 'Incorrect ID or password.',
  },
  LOGIN_REQUIRED: { ko: '로그인이 필요합니다.', en: 'Please log in.' },
  INVALID_LAUNCH_CONFIG: {
    ko: '출격 설정이 올바르지 않습니다.',
    en: 'Invalid launch configuration.',
  },
  STAGE_LOCKED: { ko: '이전 스테이지를 먼저 클리어하세요.', en: 'Clear the previous stage first.' },
  INVALID_CONTINUE_RUN: {
    ko: '이어하기 기록이 올바르지 않습니다.',
    en: 'Invalid continue-run record.',
  },
  RUN_NOT_FOUND: { ko: '출격 기록을 찾을 수 없습니다.', en: 'Launch record not found.' },
  GAME_UPDATED: {
    ko: '게임이 업데이트되었습니다. 메뉴에서 새로 출격하세요.',
    en: 'The game has been updated. Please launch again from the menu.',
  },
  SAVE_IN_PROGRESS: {
    ko: '이 출격 기록을 저장 중입니다. 잠시 후 다시 시도하세요.',
    en: 'This run is already being saved. Try again shortly.',
  },
  CLEAR_VERIFICATION_FAILED: {
    ko: '클리어 검증에 실패했습니다. 다음 스테이지는 해금되지 않았습니다.',
    en: 'Clear verification failed. The next stage was not unlocked.',
  },
  SEARCH_INVALID: { ko: '검색 조건이 올바르지 않습니다.', en: 'Invalid search parameters.' },
  GUESTBOOK_INVALID: {
    ko: '방명록 내용은 1자 이상 500자 이하, 8줄 이하로 입력하세요.',
    en: 'Guestbook messages must be 1-500 characters and at most 8 lines.',
  },
  GUESTBOOK_RATE_LIMITED: {
    ko: '방명록 작성이 너무 많습니다. 잠시 후 다시 시도하세요.',
    en: 'Too many guestbook posts. Try again shortly.',
  },
  API_NOT_FOUND: { ko: 'API를 찾을 수 없습니다.', en: 'API endpoint not found.' },
  SERVER_ERROR: {
    ko: '서버 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.',
    en: 'A server error occurred. Please try again shortly.',
  },
  VERIFIER_BUSY: {
    ko: '검증 서버가 사용 중입니다. 잠시 후 저장을 다시 시도하세요.',
    en: 'The verification server is busy. Try saving again shortly.',
  },
  VERIFY_TIMEOUT: {
    ko: '검증 시간 초과. 다시 시도하세요.',
    en: 'Verification timed out. Try again.',
  },
  VERIFY_FAILED: { ko: '검증 실패. 다시 시도하세요.', en: 'Verification failed. Try again.' },
  VERIFY_START_FAILED: {
    ko: '검증 작업을 시작할 수 없습니다. 다시 시도하세요.',
    en: 'Could not start verification. Try again.',
  },
  VERIFY_SHUTDOWN: {
    ko: '검증 서버가 종료되었습니다. 다시 시도하세요.',
    en: 'The verification server shut down. Try again.',
  },
  REPLAY_UNVERIFIABLE: {
    ko: '플레이 기록을 검증할 수 없습니다.',
    en: 'Could not verify the play record.',
  },
};

/** `X-Locale` (set by the client from its own resolved locale) wins; falls
 * back to the standard `Accept-Language` header, then Korean. */
export function resolveLocale(req) {
  const explicit = req.get('X-Locale');
  if (LOCALES.includes(explicit)) return explicit;
  const accept = (req.get('Accept-Language') || '').toLowerCase();
  if (accept.startsWith('ko')) return 'ko';
  if (accept) return 'en';
  return DEFAULT_LOCALE;
}

export const t = (locale, key) => MESSAGES[key]?.[locale] ?? MESSAGES[key]?.[DEFAULT_LOCALE] ?? key;
