/**
 * UI が対応する表示言語。
 * 識別子や API の語は英語のままとし、ここで扱うのは利用者への表示だけ。
 */

export const SUPPORTED_LOCALES = ['ja-JP', 'en'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'ja-JP';

export function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Accept-Language 相当の候補列から、対応している表示言語を選ぶ。
 * 完全一致を優先し、次に言語部分の一致（`ja` → `ja-JP`）を見る。
 */
export function resolveLocale(candidates: readonly string[]): Locale {
  for (const candidate of candidates) {
    const tag = candidate.trim();
    if (isLocale(tag)) return tag;
  }
  for (const candidate of candidates) {
    const language = candidate.trim().split('-')[0]?.toLowerCase();
    if (!language) continue;
    const matched = SUPPORTED_LOCALES.find(
      (locale) => locale.split('-')[0]?.toLowerCase() === language,
    );
    if (matched) return matched;
  }
  return DEFAULT_LOCALE;
}

/** `Accept-Language` ヘッダーを品質値の高い順に並べた候補列へ変換する。 */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part) => {
      const [tag = '', ...parameters] = part.split(';').map((value) => value.trim());
      const quality = parameters
        .map((parameter) => /^q=([0-9.]+)$/.exec(parameter))
        .find((matched) => matched !== null);
      return { tag, quality: quality?.[1] === undefined ? 1 : Number(quality[1]) };
    })
    .filter((entry) => entry.tag !== '' && Number.isFinite(entry.quality))
    .sort((a, b) => b.quality - a.quality)
    .map((entry) => entry.tag);
}
