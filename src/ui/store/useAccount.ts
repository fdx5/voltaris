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
export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers:
      body === undefined
        ? { 'X-Locale': getLocale() }
        : { 'Content-Type': 'application/json', 'X-Voltaris': '1', 'X-Locale': getLocale() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
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
