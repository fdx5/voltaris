import { useState, useEffect, type FormEvent } from 'react';
import { Medal } from 'lucide-react';
import { api, useAccount, type Pilot } from './store/useAccount';
import { STAGES } from '../game/stages';
import { useT, useLocaleStore } from './i18n';

export function LoginScreen() {
  const account = useAccount();
  const t = useT();
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
      useAccount.setState({ error: e instanceof Error ? e.message : t('LOGIN_FAILED') });
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
          <h2>{register ? t('CREATE_PILOT_ACCOUNT') : t('PILOT_LOGIN')}</h2>
          <p>{t('LOGIN_INTRO')}</p>
          <p className="fine">{t('LOGIN_FINE_PRINT')}</p>
        </div>
        <div className="login-fields">
          <label>
            {t('USERNAME_LABEL')}
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
              placeholder={t('USERNAME_PLACEHOLDER')}
            />
          </label>
          <label>
            {t('PASSWORD_LABEL')}
            <input
              name="password"
              type="password"
              autoComplete={register ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={4}
              maxLength={128}
              required
              placeholder={t('PASSWORD_PLACEHOLDER')}
            />
          </label>
          {account.error && (
            <p className="account-error" role="alert">
              {account.error}
            </p>
          )}
          <button className="primary wide" disabled={busy || account.loading}>
            {busy
              ? t('CONNECTING')
              : account.loading
                ? t('CHECKING_SESSION')
                : register
                  ? t('SIGN_UP_START')
                  : t('LOGIN')}
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
            {register ? t('LOGIN_EXISTING') : t('NEW_HERE_REGISTER')}
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
/** Gold, silver, bronze - the only ranks the leaderboard decorates. */
const MEDAL_TIER: Record<number, 'gold' | 'silver' | 'bronze'> = {
  1: 'gold',
  2: 'silver',
  3: 'bronze',
};
export function OnlineHistory() {
  const user = useAccount((s) => s.user);
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const [page, setPage] = useState(1),
    [stage, setStage] = useState(1),
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
      `/history?page=${page}&stage=${stage}&username=${encodeURIComponent(filter)}&sort=score`,
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
    started: t('STATUS_STARTED'),
    clear: t('STATUS_CLEAR'),
    gameover: t('STATUS_GAMEOVER'),
    abandoned: t('STATUS_ABANDONED'),
  };
  return (
    <div className="online-history">
      <p className="fine">{t('HISTORY_FINE_PRINT')}</p>
      <div className="history-tabs" role="tablist" aria-label={t('STAGE_SELECT_LABEL')}>
        {STAGES.map((s, i) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={stage === i + 1}
            className={`history-tab ${stage === i + 1 ? 'active' : ''}`}
            onClick={() => {
              setPage(1);
              setStage(i + 1);
            }}
          >
            <b>STAGE {i + 1}</b>
            <small>{s.name}</small>
          </button>
        ))}
      </div>
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
          aria-label={t('PILOT_ID_SEARCH')}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={t('PILOT_ID_PLACEHOLDER')}
          maxLength={24}
        />
        <button className="secondary-button" type="submit">
          {t('SEARCH')}
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
          {t('MY_RECORDS')}
        </button>
      </form>
      {error && (
        <p role="alert" className="account-error">
          {error} <button onClick={() => setRefresh((n) => n + 1)}>{t('RETRY')}</button>
        </p>
      )}
      {loading ? (
        <p role="status">{t('LOADING_HISTORY')}</p>
      ) : !data.rows.length ? (
        <p className="empty">{t('NO_RECORDS')}</p>
      ) : (
        <div className="history-scroll">
          <table>
            <thead>
              <tr>
                <th>{t('RANK')}</th>
                <th>{t('PILOT')}</th>
                <th>{t('STAGE')}</th>
                <th>{t('RESULT')}</th>
                <th>{t('SCORE')}</th>
                <th>{t('WEAPON')}</th>
                <th>{t('TABLE_KILLS')}</th>
                <th>{t('TIME')}</th>
                <th>{t('LAUNCHED_AT')}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => {
                const rank = (page - 1) * 20 + i + 1;
                const tier = MEDAL_TIER[rank];
                return (
                  <tr key={row.id} className={tier ? `rank-${tier}` : undefined}>
                    <td className="rank-cell">
                      {tier ? (
                        <span
                          className="rank-medal"
                          title={locale === 'ko' ? `${rank}위` : `Rank #${rank}`}
                        >
                          <Medal size={16} strokeWidth={2.4} />
                        </span>
                      ) : (
                        rank
                      )}
                    </td>
                    <td className={tier ? 'rank-name' : undefined}>{row.username}</td>
                    <td>
                      {row.stage} · {row.stageName}
                    </td>
                    <td>
                      {row.practice ? t('TRAINING_PREFIX') : ''}
                      {labels[row.status]}
                    </td>
                    <td>{row.score.toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US')}</td>
                    <td>
                      {row.weapon} Lv.{row.level}
                    </td>
                    <td>{row.kills}</td>
                    <td>
                      {Math.floor(row.seconds / 60)}:
                      {String(Math.floor(row.seconds % 60)).padStart(2, '0')}
                    </td>
                    <td>
                      {new Date(row.startedAt.replace(' ', 'T') + 'Z').toLocaleString(
                        locale === 'ko' ? 'ko-KR' : 'en-US',
                      )}
                    </td>
                  </tr>
                );
              })}
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
          {t('PREV')}
        </button>
        <span>
          {page} / {data.pages} ·{' '}
          {locale === 'ko' ? `총 ${data.total}회` : `${data.total} runs total`}
        </span>
        <button
          className="secondary-button"
          disabled={page >= data.pages || loading}
          onClick={() => setPage((n) => n + 1)}
        >
          {t('NEXT')}
        </button>
      </div>
    </div>
  );
}
