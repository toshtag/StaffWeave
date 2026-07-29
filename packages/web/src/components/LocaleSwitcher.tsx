import { isLocale, SUPPORTED_LOCALES } from '@staffweave/domain';
import { api } from '../api/client.ts';
import { useLocale } from '../i18n/LocaleProvider.tsx';
import { LOCALE_LABELS } from '../i18n/messages.ts';
import { useSession } from '../session/SessionProvider.tsx';

/**
 * 表示言語の切り替え。
 * ログイン中は利用者設定として保存し、次回以降どの端末でも同じ言語で表示する。
 */
export function LocaleSwitcher(): React.JSX.Element {
  const { locale, messages, setLocale } = useLocale();
  const { state, updateSession } = useSession();

  return (
    <label className="locale-switcher">
      <span className="visually-hidden">{messages.language}</span>
      <select
        value={locale}
        onChange={(event) => {
          const next = event.target.value;
          if (!isLocale(next)) return;
          setLocale(next);
          if (state.status === 'signed_in') {
            void api.updatePreferences({ locale: next }).then(updateSession);
          }
        }}
      >
        {SUPPORTED_LOCALES.map((value) => (
          <option key={value} value={value}>
            {LOCALE_LABELS[value]}
          </option>
        ))}
      </select>
    </label>
  );
}
