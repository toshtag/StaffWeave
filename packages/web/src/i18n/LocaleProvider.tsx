import type { Locale } from '@staffweave/domain';
import { DEFAULT_LOCALE, isLocale, resolveLocale } from '@staffweave/domain';
import type { ReactNode } from 'react';
import { createContext, useContext, useMemo, useState } from 'react';
import type { Messages } from './messages.ts';
import { MESSAGES } from './messages.ts';

const STORAGE_KEY = 'staffweave.locale';

interface LocaleContextValue {
  locale: Locale;
  messages: Messages;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * ログイン前はブラウザの言語設定と保存値から、ログイン後は利用者設定から表示言語を決める。
 */
function initialLocale(): Locale {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored !== null && isLocale(stored)) return stored;
  return resolveLocale(window.navigator.languages ?? [DEFAULT_LOCALE]);
}

export function LocaleProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      messages: MESSAGES[locale],
      setLocale: (next) => {
        window.localStorage.setItem(STORAGE_KEY, next);
        document.documentElement.lang = next;
        setLocaleState(next);
      },
    }),
    [locale],
  );

  document.documentElement.lang = locale;

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('LocaleProvider の内側で使用してください');
  return value;
}
