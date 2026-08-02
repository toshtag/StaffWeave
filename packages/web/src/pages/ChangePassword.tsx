import { useState } from 'react';
import { ApiRequestError, api } from '../api/client.ts';
import { useLocale } from '../i18n/LocaleProvider.tsx';

/**
 * 本人によるパスワードの変更。
 *
 * 現在のパスワードを確かめてから変える。変更すると、この端末以外のセッションは終わる。
 * 入力した値は状態にも履歴にも残さず、成功したら空へ戻す。
 */

type State =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'changed' }
  | { status: 'failed'; message: string };

export function ChangePassword(): React.JSX.Element {
  const { messages } = useLocale();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [state, setState] = useState<State>({ status: 'idle' });

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setState({ status: 'saving' });
    try {
      await api.changePassword({ currentPassword, newPassword });
      // 入力欄に残しておく理由がない。変更が済んだ時点で消す。
      setCurrentPassword('');
      setNewPassword('');
      setState({ status: 'changed' });
    } catch (error) {
      setState({
        status: 'failed',
        message: error instanceof ApiRequestError ? error.message : messages.passwordChangeFailed,
      });
    }
  }

  return (
    <section className="card">
      <h2>{messages.changePassword}</h2>
      <form onSubmit={(event) => void submit(event)}>
        <div className="field">
          <label htmlFor="current-password">{messages.currentPassword}</label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="new-password">{messages.newPassword}</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
        </div>
        <div className="form-actions">
          <button type="submit" disabled={state.status === 'saving'}>
            {state.status === 'saving' ? messages.changingPassword : messages.changePassword}
          </button>
        </div>
      </form>

      {state.status === 'changed' && (
        <p role="status">
          {messages.passwordChanged}
          {messages.otherSessionsSignedOut}
        </p>
      )}
      {state.status === 'failed' && (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      )}
    </section>
  );
}
