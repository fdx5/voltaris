import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Send } from 'lucide-react';
import { api, useAccount } from './store/useAccount';
import { useT, useLocaleStore } from './i18n';

interface GuestbookRow {
  id: string;
  username: string;
  message: string;
  createdAt: string;
}
const MAX_LENGTH = 500;
const MAX_LINES = 8;

export function Guestbook() {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const user = useAccount((s) => s.user);
  const [page, setPage] = useState(1),
    [data, setData] = useState<{ rows: GuestbookRow[]; total: number; pages: number }>({
      rows: [],
      total: 0,
      pages: 1,
    }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [posting, setPosting] = useState(false),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api<typeof data>(`/guestbook?page=${page}`, undefined, controller.signal)
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, refresh]);
  const lineCount = message.split('\n').length;
  const tooManyLines = lineCount > MAX_LINES;
  const trimmed = message.trim();
  const canPost = !!trimmed && trimmed.length <= MAX_LENGTH && !tooManyLines && !posting;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canPost) return;
    setPosting(true);
    setError('');
    try {
      await api('/guestbook', { message: trimmed });
      setMessage('');
      // Newest first, page 1 - jump there so the pilot sees their own entry land.
      if (page === 1) setRefresh((n) => n + 1);
      else setPage(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPosting(false);
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit(e);
    }
  };
  return (
    <div className="guestbook">
      <p className="fine">{t('GUESTBOOK_FINE_PRINT')}</p>
      <form className="guestbook-form" onSubmit={submit}>
        <div className="guestbook-input-wrap">
          <textarea
            className="guestbook-textarea"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('GUESTBOOK_PLACEHOLDER')}
            maxLength={MAX_LENGTH}
            rows={3}
            aria-label={t('GUESTBOOK_PLACEHOLDER')}
            disabled={posting}
          />
          <div className={`guestbook-meta ${tooManyLines ? 'guestbook-meta-warn' : ''}`}>
            <span>{tooManyLines ? t('GUESTBOOK_TOO_MANY_LINES') : t('GUESTBOOK_SEND_HINT')}</span>
            <span>
              {message.length} / {MAX_LENGTH}
            </span>
          </div>
        </div>
        <button className="primary guestbook-send" disabled={!canPost}>
          <Send size={16} aria-hidden="true" />
          {posting ? t('GUESTBOOK_SENDING') : t('GUESTBOOK_SEND')}
        </button>
      </form>
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">{t('GUESTBOOK_LOADING')}</p>
      ) : !data.rows.length ? (
        <p className="empty">{t('GUESTBOOK_EMPTY')}</p>
      ) : (
        <div className="guestbook-scroll">
          <ul className="guestbook-list">
            {data.rows.map((row) => (
              <li
                key={row.id}
                className={`guestbook-entry ${row.username === user?.username ? 'guestbook-entry-mine' : ''}`}
              >
                <div className="guestbook-entry-head">
                  <span className="guestbook-name">{row.username}</span>
                  <time className="guestbook-time" dateTime={row.createdAt}>
                    {new Date(row.createdAt.replace(' ', 'T') + 'Z').toLocaleString(
                      locale === 'ko' ? 'ko-KR' : 'en-US',
                    )}
                  </time>
                </div>
                <p className="guestbook-message">{row.message}</p>
              </li>
            ))}
          </ul>
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
          {locale === 'ko' ? `총 ${data.total}건` : `${data.total} entries total`}
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
