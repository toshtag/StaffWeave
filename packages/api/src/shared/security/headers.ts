/**
 * 応答へ付ける防御用のヘッダー。
 *
 * セルフホストでは同じプロセスが API と画面の両方を返す。
 * 逆プロキシ側で付けるかどうかは利用者の構成に依るため、製品の側で既定を持つ。
 */

import type { secureHeaders } from 'hono/secure-headers';

type SecureHeadersOptions = NonNullable<Parameters<typeof secureHeaders>[0]>;

/**
 * この画面が実際に必要とする取得先だけを許す。
 *
 * 外部の CDN もフォントも使わないため、既定は自分自身に限れる。
 * `data:` を画像へ許すのは、ビルドが小さな画像を data URI として埋め込むため。
 */
const CONTENT_SECURITY_POLICY: NonNullable<SecureHeadersOptions['contentSecurityPolicy']> = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
  imgSrc: ["'self'", 'data:'],
  fontSrc: ["'self'"],
  connectSrc: ["'self'"],
  // 埋め込みも、別の宛先への送信も、この製品では使わない。
  frameAncestors: ["'none'"],
  frameSrc: ["'none'"],
  objectSrc: ["'none'"],
  formAction: ["'self'"],
  baseUri: ["'none'"],
};

/**
 * HTTPS で終端している構成でのみ送る指示の期間。
 *
 * HTTP で動かしている構成へ送ると、その後 HTTPS へ移るまで画面を開けなくなる。
 */
const STRICT_TRANSPORT_SECURITY = 'max-age=15552000; includeSubDomains';

/**
 * @param httpsOnly HTTPS で終端している構成か。`Strict-Transport-Security` の有無を決める。
 */
export function securityHeaderOptions(httpsOnly: boolean): SecureHeadersOptions {
  return {
    contentSecurityPolicy: { ...CONTENT_SECURITY_POLICY },
    // CSP を読まない実装のために、埋め込みの拒否は古い指定でも重ねて伝える。
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
    // 外部の URL を開いたときに、経路（業務日や識別子を含む）を渡さない。
    referrerPolicy: 'no-referrer',
    strictTransportSecurity: httpsOnly ? STRICT_TRANSPORT_SECURITY : false,
    // 別のオリジンから資材として読み込ませない。
    crossOriginResourcePolicy: 'same-origin',
    crossOriginOpenerPolicy: 'same-origin',
    // 別オリジンの資材を読み込む構成ではないため、要求しない。
    // 有効にすると、将来この画面へ外部の画像を足したときに黙って壊れる。
    crossOriginEmbedderPolicy: false,
  };
}
