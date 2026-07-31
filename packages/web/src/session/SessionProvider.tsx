import type { LoginRequest, SessionResponse } from '@staffweave/contracts';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.ts';
import { useLocale } from '../i18n/LocaleProvider.tsx';

/**
 * ログイン画面へ戻った理由。
 * 利用者の操作によるログアウトと、有効期限切れで戻された場合を区別する。
 */
export type SessionExpiryReason = 'pending_punches';

type SessionState =
  | { status: 'loading' }
  | { status: 'signed_out'; expiry: SessionExpiryReason | null }
  | { status: 'signed_in'; session: SessionResponse };

interface SessionContextValue {
  state: SessionState;
  signIn: (input: LoginRequest) => Promise<void>;
  signOut: () => Promise<void>;
  updateSession: (session: SessionResponse) => void;
  /**
   * 通信を伴わずに、この端末の上でだけセッションを期限切れにする。
   * 認証が切れていると分かった時点でログイン画面へ戻すために使う。
   */
  markSessionExpired: (reason: SessionExpiryReason) => void;
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
      .catch(() => {
        if (!cancelled) setState({ status: 'signed_out', expiry: null });
      });

    return () => {
      cancelled = true;
    };
  }, [applySession]);

  const markSessionExpired = useCallback((reason: SessionExpiryReason) => {
    setState({ status: 'signed_out', expiry: reason });
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      state,
      signIn: async (input) => {
        applySession(await api.login(input));
      },
      signOut: async () => {
        await api.logout();
        setState({ status: 'signed_out', expiry: null });
      },
      updateSession: applySession,
      markSessionExpired,
    }),
    [state, applySession, markSessionExpired],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('SessionProvider の内側で使用してください');
  return value;
}
