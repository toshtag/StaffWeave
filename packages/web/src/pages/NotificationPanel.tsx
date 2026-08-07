import type { NotificationRecord } from '@staffweave/contracts';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import { useLocale } from '../i18n/LocaleProvider.tsx';

/**
 * 自分あての通知。
 *
 * 承認待ちの一覧を自分から見に行くまで気付けなかったものを、ここへ出す。
 * 読めるのは本人あてのものだけで、他人の通知は届かない。
 */
export function NotificationPanel(): React.JSX.Element | null {
  const { messages, locale } = useLocale();
  const [notifications, setNotifications] = useState<NotificationRecord[] | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  const load = useCallback(async (): Promise<void> => {
    const body = await api.listNotifications({});
    setNotifications(body.notifications);
    setUnreadCount(body.unreadCount);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load().catch(() => {
      if (!cancelled) setNotifications([]);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const markAllRead = useCallback(async (): Promise<void> => {
    const unread = (notifications ?? []).filter((entry) => entry.readAt === null);
    if (unread.length === 0) return;
    await api.markNotificationsRead({ ids: unread.map((entry) => entry.id) });
    await load();
  }, [load, notifications]);

  if (notifications === null) {
    return (
      <section className="card">
        <h2>{messages.notifications}</h2>
        <p>{messages.loading}</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>
        {messages.notifications}
        {unreadCount > 0 && <span className="badge">{unreadCount}</span>}
      </h2>
      {notifications.length === 0 ? (
        <p className="notice">{messages.noNotifications}</p>
      ) : (
        <>
          <ul className="notification-list">
            {notifications.map((entry) => (
              <li key={entry.id} className={entry.readAt === null ? 'unread' : undefined}>
                <span>{entry.summary}</span>
                <span className="time-zone">
                  {new Date(entry.occurredAt).toLocaleString(locale)}
                </span>
              </li>
            ))}
          </ul>
          {unreadCount > 0 && (
            <button type="button" onClick={() => void markAllRead()}>
              {messages.markAllRead}
            </button>
          )}
        </>
      )}
    </section>
  );
}
