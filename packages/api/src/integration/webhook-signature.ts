import { createHash, createHmac } from 'node:crypto';
import { canonicalWebhookMessage } from '@staffweave/domain';

/**
 * Webhook の署名鍵の導出と署名の生成。
 *
 * 送信側と受け取り側が同じ計算をしていることが、この方式の唯一の担保になる。
 * 計算を一箇所へ集め、connector 側（`deriveWebhookSigningKey`）と対で読めるようにする。
 *
 * 方式は `WEBHOOK_SIGNATURE_SCHEME`、鍵の導出は `WEBHOOK_SIGNING_KEY_DERIVATION` で表す。
 * 対称鍵であるため、送信側は正当な署名を作れる鍵を持つ。受け取り側だけが検証できる
 * 非対称署名ではない。
 */

/**
 * 登録時の秘密から署名鍵を導出する。
 *
 * 戻り値は照合用のハッシュではなく、Webhook 署名を生成できる機密情報である。
 * 保存先・ログ・画面のいずれにおいても、秘密鍵と同じ扱いにする。
 */
export function deriveWebhookSigningKey(signingSecret: string): string {
  return createHash('sha256').update(signingSecret, 'utf8').digest('hex');
}

/**
 * 署名を生成する。
 *
 * 鍵は 16 進数 64 文字を UTF-8 の文字列のまま渡す。
 * `Buffer.from(signingKey, 'hex')` で生の 32 バイトへ戻してはならない。
 * 鍵の表現を変えると、すでに登録済みの送信先の署名がすべて変わる。
 */
export function signWebhookMessage(
  signingKey: string,
  message: { eventId: string; eventType: string; timestamp: string; body: string },
): string {
  return createHmac('sha256', signingKey)
    .update(canonicalWebhookMessage(message), 'utf8')
    .digest('base64');
}
