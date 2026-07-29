import type { LoginRequest, SessionResponse } from '@staffweave/contracts';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiRequestError, api } from '../api/client.ts';
import { useLocale } from '../i18n/LocaleProvider.tsx';

type SessionState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'signed_in'; session: SessionResponse };

interface SessionContextValue {
  state: SessionState;
  signIn: (input: LoginRequest) => Promise<void>;
  signOut: () => Promise<void>;
  updateSession: (session: SessionResponse) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const { setLocale } = useLocale();

  const applySession = useCallback(
    (session: SessionResponse) => {
      setState({ status: 'signed_in', session });
      // ログイン後は利用者設定の表示言語を優先する。
      setLocale(session.user.locale);
    },
    [setLocale],
  );

  useEffect(() => {
    let cancelled = false;

    api
      .getSession()
      .then((session) => {
        if (!cancelled) applySession(session);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiRequestError && error.status === 401) {
          setState({ status: 'signed_out' });
          return;
        }
        setState({ status: 'signed_out' });
      });

    return () => {
      cancelled = true;
    };
  }, [applySession]);

  const value = useMemo<SessionContextValue>(
    () => ({
      state,
      signIn: async (input) => {
        applySession(await api.login(input));
      },
      signOut: async () => {
        await api.logout();
        setState({ status: 'signed_out' });
      },
      updateSession: applySession,
    }),
    [state, applySession],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('SessionProvider の内側で使用してください');
  return value;
}
