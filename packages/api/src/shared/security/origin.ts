/**
 * 送信元（Origin）の検査。
 *
 * セッションは Cookie で運ぶため、ブラウザは別の頁からの要求にも自動で付ける。
 * `SameSite=Lax` は別サイトからの送信を止めるが、同じ登録ドメインの別サブドメインは
 * 「同一サイト」として扱われ、止まらない。社内の別システムが隣のサブドメインに
 * 置かれている構成は珍しくない。
 *
 * 検査するのは、Cookie の資格情報に頼っている要求だけにする。
 * 端末の署名や API キーで来る要求は、ブラウザが自動で付ける資格情報を使わない。
 */

import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { ApiError } from '../errors.js';

/** 本体を変えない方法。ここは検査の対象にしない。 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface OriginCheckOptions {
  /**
   * 明示的に許すオリジン。空なら、要求の `Host` と同じホストだけを許す。
   * 逆プロキシが `Host` を書き換える構成では、ここへ実際のオリジンを並べる。
   */
  allowedOrigins: readonly string[];
  /** 検査の対象にする Cookie の名前。 */
  cookieName: string;
}

/** `https://example.com:443/` のような表記の揺れを吸収する。解釈できない値は null。 */
export function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.hostname === '') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** オリジンのホスト（ポートを含む）が、要求の宛先と同じか。 */
function matchesHost(origin: string, host: string | undefined): boolean {
  if (host === undefined || host === '') return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function createOriginCheck(options: OriginCheckOptions): MiddlewareHandler {
  const allowed = new Set(
    options.allowedOrigins.map((origin) => normalizeOrigin(origin)).filter((o) => o !== null),
  );

  const isAllowed = (c: Context, origin: string): boolean => {
    const normalized = normalizeOrigin(origin);
    if (normalized === null) return false;
    if (allowed.has(normalized)) return true;
    // 明示の指定が無ければ、要求が届いた宛先と同じホストだけを許す。
    return allowed.size === 0 && matchesHost(normalized, c.req.header('host'));
  };

  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    // Cookie を送っていない要求は、ブラウザの資格情報に頼っていない。
    if (getCookie(c, options.cookieName) === undefined) return next();

    const origin = c.req.header('origin');
    // ブラウザは、状態を変える要求へ必ず Origin を付ける。
    // 付いていない要求はブラウザ以外からのものであり、値を偽れる相手には検査が効かない。
    if (origin === undefined) return next();

    if (!isAllowed(c, origin)) {
      throw new ApiError('forbidden', '要求元を確認できません');
    }
    return next();
  };
}
