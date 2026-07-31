/**
 * Webhook 送信先の URL と署名に関する取り決め。
 *
 * 長さの上限は、API 契約と実際の検査の両方が同じ値を使う。
 * 二箇所へ数値を書くと、契約だけが厳しく実装は素通り、という状態を作れてしまう。
 */

/**
 * 署名方式。送信側と受信側が同じ計算をしていることを、コードと文書で一意に指せるようにする。
 *
 * 対称鍵の HMAC であり、送信側は署名を作れる鍵を持つ。
 * 受け取り側だけが検証できる非対称署名ではない。
 */
export const WEBHOOK_SIGNATURE_SCHEME = 'hmac-sha256-v1' as const;

/**
 * 署名鍵の導出方法。
 *
 * 登録時に返す秘密を SHA-256 にかけ、小文字 16 進数 64 文字にしたものを鍵とする。
 * ダイジェストの生の 32 バイトではなく、この 64 文字を UTF-8 のまま鍵として使う。
 */
export const WEBHOOK_SIGNING_KEY_DERIVATION = 'sha256-hex-v1' as const;

/** `http://a.example` を下回る長さの文字列は URL として扱わない。 */
export const MINIMUM_WEBHOOK_URL_LENGTH = 8;

/**
 * 保存と送信で扱う URL の上限。
 * 正規化で percent encoding が増えるため、入力と正規化後の両方をこの値で見る。
 */
export const MAXIMUM_WEBHOOK_URL_LENGTH = 2048;
