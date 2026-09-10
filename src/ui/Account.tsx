import { useState, useEffect, type FormEvent } from 'react';
import { api, useAccount, type Pilot } from './store/useAccount';
import { STAGES } from '../game/stages';

export function LoginScreen() {
  const account = useAccount();
  const [register, setRegister] = useState(false),
    [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    useAccount.setState({ error: '' });
    try {
      const { user } = await api<{ user: Pilot }>(`/auth/${register ? 'register' : 'login'}`, {
        username,
        password,
      });
      setPassword('');
      useAccount.setState({ user });
    } catch (e) {
      useAccount.setState({ error: e instanceof Error ? e.message : '로그인 실패' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-intro">
          <small>ORBITAL COMMAND / PILOT ACCESS</small>
          <h1>VOLTARIS</h1>
          <h2>{register ? '파일럿 계정 만들기' : '파일럿 로그인'}</h2>
          <p>클리어 기록을 이어가고 모든 파일럿의 비행 이력을 확인하세요.</p>
          <p className="fine">
            첫 출격은 STAGE 01부터 시작합니다. 일반 모드 클리어 시 다음 스테이지가 열립니다. ID와
            게임 이력은 로그인한 모든 사용자에게 공개됩니다.
          </p>
        </div>
        <div className="login-fields">
          <label>
            아이디
            <input
              name="username"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              pattern="[a-zA-Z0-9_]{3,24}"
              minLength={3}
              maxLength={24}
              required
              placeholder="영문·숫자·_ 3~24자"
            />
          </label>
          <label>
            비밀번호
            <input
              name="password"
              type="password"
              autoComplete={register ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={10}
              maxLength={128}
              required
              placeholder="10자 이상"
            />
          </label>
          {account.error && (
            <p className="account-error" role="alert">
              {account.error}
            </p>
          )}
          <button className="primary wide" disabled={busy || account.loading}>
            {busy
              ? '연결 중…'
              : account.loading
                ? '세션 확인 중…'
                : register
                  ? '가입하고 시작'
                  : '로그인'}
          </button>
          <button
            className="secondary-button wide"
            type="button"
            disabled={busy}
            onClick={() => {
              setRegister(!register);
              useAccount.setState({ error: '' });
            }}
          >
            {register ? '기존 계정으로 로그인' : '처음 오셨나요? 회원가입'}
          </button>
        </div>
      </form>
    </main>
  );
}
interface HistoryRow {
  id: string;
  username: string;
  stage: number;
  stageName: string;
  practice: number;
  weapon: string;
  status: string;
  score: number;
  kills: number;
  seconds: number;
  level: number;
  startedAt: string;
}
export function OnlineHistory() {
  const user = useAccount((s) => s.user);
  const [page, setPage] = useState(1),
    [stage, setStage] = useState('0'),
    [username, setUsername] = useState(''),
    [filter, setFilter] = useState(''),
    [data, setData] = useState<{ rows: HistoryRow[]; total: number; pages: number }>({
      rows: [],
      total: 0,
      pages: 1,
    }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api<typeof data>(
      `/history?page=${page}&stage=${stage}&username=${encodeURIComponent(filter)}`,
      undefined,
      controller.signal,
    )
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, stage, filter, refresh]);
  const labels: Record<string, string> = {
    started: '진행 / 미완료',
    clear: '클리어',
    gameover: '게임오버',
    abandoned: '중도 종료',
  };
  return (
    <div className="online-history">
      <p className="fine">
        전체 파일럿의 실제 출격 기록 · 일반 모드 클리어만 다음 스테이지를 해금합니다.
      </p>
      <form
        className="history-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setFilter(username.trim());
          setRefresh((n) => n + 1);
        }}
      >
        <input
          aria-label="파일럿 ID 검색"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="파일럿 ID (전체 보기: 빈칸)"
          maxLength={24}
        />
        <select
          aria-label="스테이지 필터"
          value={stage}
          onChange={(e) => {
            setPage(1);
            setStage(e.target.value);
          }}
        >
          <option value="0">모든 스테이지</option>
          {STAGES.map((s, i) => (
            <option key={s.id} value={i + 1}>
              STAGE {i + 1}
            </option>
          ))}
        </select>
        <button className="secondary-button" type="submit">
          조회
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            setUsername(user?.username || '');
            setFilter(user?.username || '');
            setPage(1);
          }}
        >
          내 기록
        </button>
      </form>
      {error && (
        <p role="alert" className="account-error">
          {error} <button onClick={() => setRefresh((n) => n + 1)}>다시 시도</button>
        </p>
      )}
      {loading ? (
        <p role="status">이력을 불러오는 중…</p>
      ) : !data.rows.length ? (
        <p className="empty">조건에 맞는 비행 기록이 없습니다.</p>
      ) : (
        <div className="history-scroll">
          <table>
            <thead>
              <tr>
                <th>파일럿</th>
                <th>스테이지</th>
                <th>결과</th>
                <th>점수</th>
                <th>무기</th>
                <th>격추</th>
                <th>시간</th>
                <th>출격 일시</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.username}</td>
                  <td>
                    {row.stage} · {row.stageName}
                  </td>
                  <td>
                    {row.practice ? '훈련 · ' : ''}
                    {labels[row.status]}
                  </td>
                  <td>{row.score.toLocaleString()}</td>
                  <td>
                    {row.weapon} Lv.{row.level}
                  </td>
                  <td>{row.kills}</td>
                  <td>
                    {Math.floor(row.seconds / 60)}:
                    {String(Math.floor(row.seconds % 60)).padStart(2, '0')}
                  </td>
                  <td>{new Date(row.startedAt.replace(' ', 'T') + 'Z').toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="history-pages">
        <button
          className="secondary-button"
          disabled={page <= 1 || loading}
          onClick={() => setPage((n) => n - 1)}
        >
          이전
        </button>
        <span>
          {page} / {data.pages} · 총 {data.total}회
        </span>
        <button
          className="secondary-button"
          disabled={page >= data.pages || loading}
          onClick={() => setPage((n) => n + 1)}
        >
          다음
        </button>
      </div>
    </div>
  );
}
