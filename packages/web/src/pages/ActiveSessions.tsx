import type { SessionDevice, SessionSummary } from '@staffweave/contracts';
import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api } from '../api/client.ts';
import { useLocale } from '../i18n/LocaleProvider.tsx';
import type { Messages } from '../i18n/messages.ts';

/**
 * ログイン中の端末の一覧と、その終了。
 *
 * 見えるのも終わらせられるのも本人の分だけ。いま使っているセッションは
 * 行からは終わらせられない。画面が残ったまま次の要求で締め出されるのを避けるため、
 * 手元を終わらせるのはログアウトの役目にしている。
 */

type State =
  | { status: 'loading' }
  | { status: 'ready'; sessions: SessionSummary[] }
  | { status: 'failed'; message: string };

/**
 * 端末の呼び名。
 *
 * 保存しているのは系統だけで、表示に使う文字列は画面が言語ごとに決める。
 * 判別できなかった項目は書かない。「不明」を並べても手掛かりは増えない。
 */
function deviceLabel(device: SessionDevice | null, messages: Messages): string {
  if (device === null) return messages.unknownDevice;
  const parts = [
    device.os === null ? null : messages.deviceOs[device.os],
    device.browser === null ? null : messages.deviceBrowser[device.browser],
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) {
    return device.kind === null ? messages.unknownDevice : messages.deviceKind[device.kind];
  }
  const named = parts.join(' / ');
  return device.kind === null ? named : `${named}（${messages.deviceKind[device.kind]}）`;
}

export function ActiveSessions(): React.JSX.Element {
  const { locale, messages } = useLocale();
  const [state, setState] = useState<State>({ status: 'loading' });
  /** 進行中の操作。同じ行を二度押しさせない。 */
  const [pending, setPending] = useState<string | null>(null);
  const [revokedOthers, setRevokedOthers] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const body = await api.listSessions();
      setState({ status: 'ready', sessions: body.sessions });
    } catch (error) {
      setState({
        status: 'failed',
        message: error instanceof ApiRequestError ? error.message : messages.sessionRevokeFailed,
      });
    }
  }, [messages.sessionRevokeFailed]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(sessionId: string): Promise<void> {
    setPending(sessionId);
    setRevokedOthers(false);
    try {
      await api.revokeSession(sessionId);
      await load();
    } catch (error) {
      setState({
        status: 'failed',
        message: error instanceof ApiRequestError ? error.message : messages.sessionRevokeFailed,
      });
    } finally {
      setPending(null);
    }
  }

  async function revokeOthers(): Promise<void> {
    setPending('others');
    try {
      await api.revokeOtherSessions();
      setRevokedOthers(true);
      await load();
    } catch (error) {
      setState({
        status: 'failed',
        message: error instanceof ApiRequestError ? error.message : messages.sessionRevokeFailed,
      });
    } finally {
      setPending(null);
    }
  }

  const sessions = state.status === 'ready' ? state.sessions : [];
  const others = sessions.filter((session) => !session.current);

  return (
    <section className="card">
      <h2>{messages.activeSessions}</h2>
      <p className="subtitle">{messages.activeSessionsHint}</p>

      {state.status === 'loading' && <p>{messages.loading}</p>}

      {state.status === 'failed' && (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      )}

      {state.status === 'ready' && (
        <>
          <table>
            <thead>
              <tr>
                <th scope="col">{messages.sessionDevice}</th>
                <th scope="col">{messages.sessionIssuedAt}</th>
                <th scope="col">{messages.sessionLastSeenAt}</th>
                <th scope="col">{messages.sessionExpiresAt}</th>
                <th scope="col">
                  <span className="visually-hidden">{messages.revokeSession}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id}>
                  <td>
                    {deviceLabel(session.device, messages)}
                    {session.current && <span className="badge">{messages.thisDevice}</span>}
                  </td>
                  <td>{new Date(session.issuedAt).toLocaleString(locale)}</td>
                  <td>{new Date(session.lastSeenAt).toLocaleString(locale)}</td>
                  <td>{new Date(session.expiresAt).toLocaleString(locale)}</td>
                  <td>
                    {/* いま使っている行には操作を置かない。手元はログアウトで終わらせる。 */}
                    {!session.current && (
                      <button
                        type="button"
                        onClick={() => void revoke(session.id)}
                        disabled={pending !== null}
                      >
                        {pending === session.id ? messages.revokingSession : messages.revokeSession}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {others.length === 0 ? (
            <p>{messages.noOtherSessions}</p>
          ) : (
            <div className="form-actions">
              <button type="button" onClick={() => void revokeOthers()} disabled={pending !== null}>
                {pending === 'others'
                  ? messages.revokingOtherSessions
                  : messages.revokeOtherSessions}
              </button>
            </div>
          )}

          {revokedOthers && <p role="status">{messages.otherSessionsRevoked}</p>}
        </>
      )}
    </section>
  );
}
