import { useId, useState } from 'react';
import { ApiRequestError } from '../api/client.ts';
import { LocaleSwitcher } from '../components/LocaleSwitcher.tsx';
import { useLocale } from '../i18n/LocaleProvider.tsx';
import { useSession } from '../session/SessionProvider.tsx';

export function SignInPage(): React.JSX.Element {
  const { messages } = useLocale();
  const { signIn } = useSession();
  const emailId = useId();
  const passwordId = useId();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="centered">
      <header className="page-header">
        <h1>{messages.appName}</h1>
        <p className="subtitle">{messages.tagline}</p>
        <LocaleSwitcher />
      </header>

      <form
        className="card"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitting(true);
          setError(null);
          signIn({ email, password })
            .catch((cause: unknown) => {
              setError(
                cause instanceof ApiRequestError ? messages.signInFailed : messages.networkError,
              );
            })
            .finally(() => setSubmitting(false));
        }}
      >
        <div className="field">
          <label htmlFor={emailId}>{messages.email}</label>
          <input
            id={emailId}
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor={passwordId}>{messages.password}</label>
          <input
            id={passwordId}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {error !== null && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" disabled={submitting}>
          {submitting ? messages.signingIn : messages.signIn}
        </button>
      </form>
    </main>
  );
}
