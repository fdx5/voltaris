import { create } from 'zustand';
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
export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Voltaris': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const result = await response.json().catch(() => ({ error: '서버 응답을 읽을 수 없습니다.' }));
  if (!response.ok) {
    if (response.status === 401) useAccount.setState({ user: null });
    throw new Error(result.error || '요청 실패');
  }
  return result as T;
}
export async function loadAccount() {
  try {
    const { user } = await api<{ user: Pilot }>('/auth/me');
    useAccount.setState({ user, error: '' });
  } catch (e) {
    useAccount.setState({
      error: e instanceof Error && e.message !== '로그인이 필요합니다.' ? e.message : '',
    });
  } finally {
    useAccount.setState({ loading: false });
  }
}
