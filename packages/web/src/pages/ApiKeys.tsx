import type { ApiKeyRecord, SessionResponse } from '@staffweave/contracts';
import { API_SCOPES, type ApiScope } from '@staffweave/domain';
import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api } from '../api/client.ts';
import { useLocale } from '../i18n/LocaleProvider.tsx';

/**
 * 外部連携へ渡す API キーの管理。
 *
 * 生の鍵は作成の応答にしか現れない。控える機会は一度きりであることを画面でも示し、
 * 利用者が自分で閉じるまで消さない。自動で閉じると、目を離した隙に控える機会が消える。
 *
 * 失効させた鍵も一覧に残す。消してしまうと、外部連携が動かなくなった原因が
 * 「鍵を失効させたから」なのか「そもそも作っていないのか」を後から辿れない。
 */

type State =
  | { status: 'loading' }
  | { status: 'ready'; apiKeys: ApiKeyRecord[] }
  | { status: 'forbidden' }
  | { status: 'failed'; message: string };

/** 作成の直後だけ手元に置く、控えるための値。 */
interface IssuedSecret {
  name: string;
  secret: string;
}

export function ApiKeys({ session }: { session: SessionResponse }): React.JSX.Element | null {
  const { locale, messages } = useLocale();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiScope[]>([]);
  const [issued, setIssued] = useState<IssuedSecret | null>(null);
  const [copied, setCopied] = useState(false);
  /** 進行中の操作。同じ操作を二度押しさせない。 */
  const [pending, setPending] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const canManage = session.user.permissions.includes('user.manage');

  const load = useCallback(async (): Promise<void> => {
    try {
      const body = await api.listApiKeys();
      setState({ status: 'ready', apiKeys: body.apiKeys });
    } catch (error) {
      // 権限が無いことは失敗として見せない。節ごと出さないほうが分かりやすい。
      setState(
        error instanceof ApiRequestError && error.status === 403
          ? { status: 'forbidden' }
          : {
              status: 'failed',
              message:
                error instanceof ApiRequestError ? error.message : messages.apiKeyCreateFailed,
            },
      );
    }
  }, [messages.apiKeyCreateFailed]);

  useEffect(() => {
    if (!canManage) {
      setState({ status: 'forbidden' });
      return;
    }
    void load();
  }, [canManage, load]);

  async function create(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (scopes.length === 0) {
      setFormError(messages.selectAtLeastOneScope);
      return;
    }
    setFormError(null);
    setPending('create');
    try {
      const created = await api.createApiKey({ name, scopes });
      // 控える機会は一度きり。応答から受け取った値をここでだけ手元に置く。
      setIssued({ name: created.apiKey.name, secret: created.secret });
      setCopied(false);
      setName('');
      setScopes([]);
      await load();
    } catch (error) {
      setFormError(error instanceof ApiRequestError ? error.message : messages.apiKeyCreateFailed);
    } finally {
      setPending(null);
    }
  }

  async function revoke(apiKeyId: string): Promise<void> {
    setPending(apiKeyId);
    try {
      await api.revokeApiKey(apiKeyId);
      await load();
    } catch (error) {
      setFormError(error instanceof ApiRequestError ? error.message : messages.apiKeyRevokeFailed);
    } finally {
      setPending(null);
    }
  }

  function toggleScope(scope: ApiScope): void {
    setScopes((current) =>
      current.includes(scope) ? current.filter((held) => held !== scope) : [...current, scope],
    );
  }

  async function copySecret(secret: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      // 書き込みを断られる構成もある。値は画面に出したままなので、手で控えられる。
      setCopied(false);
    }
  }

  if (state.status === 'forbidden') return null;

  return (
    <section className="card">
      <h2>{messages.apiKeys}</h2>
      <p className="subtitle">{messages.apiKeysHint}</p>

      {state.status === 'loading' && <p>{messages.loading}</p>}

      {state.status === 'failed' && (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      )}

      {issued !== null && (
        <div className="issued-secret" role="status">
          <p>
            {messages.apiKeyCreated}: {issued.name}
          </p>
          <p>{messages.apiKeySecretOnce}</p>
          <code className="secret-value">{issued.secret}</code>
          <div className="form-actions">
            <button type="button" onClick={() => void copySecret(issued.secret)}>
              {copied ? messages.apiKeySecretCopied : messages.copySecret}
            </button>
            <button type="button" onClick={() => setIssued(null)}>
              {messages.dismissSecret}
            </button>
          </div>
        </div>
      )}

      {state.status === 'ready' && (
        <>
          {state.apiKeys.length === 0 ? (
            <p>{messages.noApiKeys}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">{messages.apiKeyName}</th>
                  <th scope="col">{messages.apiKeyPrefix}</th>
                  <th scope="col">{messages.apiKeyScopes}</th>
                  <th scope="col">{messages.apiKeyCreatedAt}</th>
                  <th scope="col">{messages.apiKeyLastUsedAt}</th>
                  <th scope="col">
                    <span className="visually-hidden">{messages.revokeApiKey}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.apiKeys.map((apiKey) => (
                  <tr key={apiKey.id}>
                    <td>
                      {apiKey.name}
                      {apiKey.revokedAt !== null && (
                        <span className="badge">{messages.apiKeyRevoked}</span>
                      )}
                    </td>
                    <td>
                      <code>{apiKey.prefix}</code>
                    </td>
                    <td>{apiKey.scopes.map((scope) => messages.apiScope[scope]).join(', ')}</td>
                    <td>{new Date(apiKey.createdAt).toLocaleString(locale)}</td>
                    <td>
                      {apiKey.lastUsedAt === null
                        ? messages.apiKeyNeverUsed
                        : new Date(apiKey.lastUsedAt).toLocaleString(locale)}
                    </td>
                    <td>
                      {/* 失効済みの鍵に操作は要らない。並べても押せることを確かめるだけになる。 */}
                      {apiKey.revokedAt === null && (
                        <button
                          type="button"
                          onClick={() => void revoke(apiKey.id)}
                          disabled={pending !== null}
                        >
                          {pending === apiKey.id ? messages.revokingApiKey : messages.revokeApiKey}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <form onSubmit={(event) => void create(event)}>
            <div className="field">
              <label htmlFor="api-key-name">{messages.apiKeyName}</label>
              <input
                id="api-key-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <fieldset className="field">
              <legend>{messages.apiKeyScopes}</legend>
              {API_SCOPES.map((scope) => (
                <label key={scope} className="checkbox">
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={() => toggleScope(scope)}
                  />
                  {messages.apiScope[scope]}
                </label>
              ))}
            </fieldset>
            <div className="form-actions">
              <button type="submit" disabled={pending !== null}>
                {pending === 'create' ? messages.creatingApiKey : messages.createApiKey}
              </button>
            </div>
          </form>

          {formError !== null && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
        </>
      )}
    </section>
  );
}
