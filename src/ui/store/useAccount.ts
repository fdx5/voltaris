import { create } from 'zustand';
import { getLocale, t } from '../i18n';
export interface Pilot {
  id: string;
  username: string;
  unlockedStage: number;
  clearedStages: number[];
}
export const useAccount = create<{
  user: Pilot | null;
  loading: boolean;
  error: string;
  saving: boolean;
  launching: boolean;
}>(() => ({ user: null, loading: true, error: '', saving: false, launching: false }));
/** A server error carries a machine-readable `code` alongside its already-localized `message`. */
export class ApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}
/**
 * A caller with its own longer-running budget (see Runtime.finishRun's 55s
 * replay-verification window) passes its own `signal` and is left alone
 * entirely. Every other call - session check on load, login, logout, run
 * launch - had no ceiling at all: a hung server (or a dropped connection)
 * left it awaiting forever, which is what permanently soft-locked the login
 * screen on "Checking session..." with no error and no way to retry.
 */
const DEFAULT_TIMEOUT_MS = 30000;
export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers:
        body === undefined
          ? { 'X-Locale': getLocale() }
          : { 'Content-Type': 'application/json', 'X-Voltaris': '1', 'X-Locale': getLocale() },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (e) {
    if (!signal && e instanceof Error && e.name === 'TimeoutError')
      throw new ApiError(t('SERVER_UNRESPONSIVE'), 'TIMEOUT');
    throw e;
  }
  const result = await response
    .json()
    .catch(() => ({ error: t('UNREADABLE_RESPONSE'), code: 'UNREADABLE_RESPONSE' }));
  if (!response.ok) {
    if (response.status === 401) useAccount.setState({ user: null });
    throw new ApiError(result.error || t('REQUEST_FAILED'), result.code);
  }
  return result as T;
}
export async function loadAccount() {
  try {
    const { user } = await api<{ user: Pilot }>('/auth/me');
    useAccount.setState({ user, error: '' });
  } catch (e) {
    const suppressed = e instanceof ApiError && e.code === 'LOGIN_REQUIRED';
    useAccount.setState({
      error: e instanceof Error && !suppressed ? e.message : '',
    });
  } finally {
    useAccount.setState({ loading: false });
  }
}
