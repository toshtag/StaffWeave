import { useLocale } from './i18n/LocaleProvider.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { SignInPage } from './pages/SignInPage.tsx';
import { useSession } from './session/SessionProvider.tsx';

export function App(): React.JSX.Element {
  const { state } = useSession();
  const { messages } = useLocale();

  if (state.status === 'loading') {
    return (
      <main className="centered">
        <p>{messages.loading}</p>
      </main>
    );
  }

  if (state.status === 'signed_out') return <SignInPage />;

  return <HomePage session={state.session} />;
}
