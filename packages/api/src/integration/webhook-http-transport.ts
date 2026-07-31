/**
 * Webhook の HTTP 通信。
 *
 * `fetch` は使わない。接続の直前に自分で名前を引き直すため、検査した宛先と
 * 実際につながる宛先が一致する保証がなく、リダイレクトも既定で追ってしまう。
 * ここでは Node.js 標準の低水準クライアントへ、検査済みのアドレスだけを返す
 * `lookup` を渡し、接続先を固定する。
 */

import { request as httpRequest } from 'node:http';
import type { RequestOptions } from 'node:https';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { ResolvedWebhookTarget } from './webhook-network-policy.js';

/** 応答ヘッダーの上限。これを超えた応答は解析せず、通信の失敗として扱う。 */
export const WEBHOOK_MAX_RESPONSE_HEADER_BYTES = 16 * 1024;

/**
 * 応答本文の上限。
 *
 * 本文は保存もログ出力もしないが、接続を閉じるためには読み切る必要がある。
 * 上限を置かないと、送信先が本文を送り続けるだけでワーカーを占有できる。
 */
export const WEBHOOK_MAX_RESPONSE_BODY_BYTES = 64 * 1024;

export interface WebhookResponseSummary {
  statusCode: number;
  /** 本文が上限を超えたため、途中で接続を切ったか。 */
  bodyLimitExceeded: boolean;
}

/** 実際の通信。テストから差し替えられるようにする。 */
export type WebhookTransport = (
  target: ResolvedWebhookTarget,
  headers: Record<string, string>,
  body: string,
  signal: AbortSignal,
) => Promise<WebhookResponseSummary>;

/**
 * 送信に使う要求設定を組み立てる。
 *
 * 接続先の固定と TLS の検証条件は同じ場所で決める。片方だけ変えると、
 * IP を固定したまま証明書の確認先までずれる、といった壊し方ができてしまう。
 */
export function buildRequestOptions(
  target: ResolvedWebhookTarget,
  headers: Record<string, string>,
): RequestOptions & { headers: Record<string, string> } {
  const { url, address, family } = target;
  const secure = url.protocol === 'https:';
  const hostname = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;

  const options: RequestOptions & { headers: Record<string, string> } = {
    protocol: url.protocol,
    hostname,
    port: url.port === '' ? (secure ? 443 : 80) : Number(url.port),
    path: `${url.pathname}${url.search}`,
    method: 'POST',
    // Host は元の URL の authority を使う。接続先を IP へ固定しても、
    // 受け取り側から見た宛先は登録された送信先のままにする。
    headers: { ...headers, host: url.host },
    maxHeaderSize: WEBHOOK_MAX_RESPONSE_HEADER_BYTES,
    // 検査した宛先と接続を一対一で対応させる。別の送信や別の解決結果と socket を共有しない。
    agent: false,
    // 検査済みのアドレスをそのまま返す。ここで名前を引き直さない。
    // 接続側が候補一覧を求めることもあるが、返す候補は常にこの 1 件だけにする。
    lookup: (_hostname, options, callback) => {
      if (options.all === true) callback(null, [{ address, family }]);
      else callback(null, address, family);
    },
  };

  // TLS は接続先の IP ではなく元のホスト名に対して検証する。
  // 証明書の確認を緩めて接続を通すことはしない。
  if (secure && isIP(hostname) === 0) {
    options.servername = hostname;
  }

  return options;
}

export const nodeWebhookTransport: WebhookTransport = (target, headers, body, signal) =>
  new Promise<WebhookResponseSummary>((resolve, reject) => {
    const send = target.url.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = send({ ...buildRequestOptions(target, headers), signal }, (response) => {
      const statusCode = response.statusCode ?? 0;
      let received = 0;
      let exceeded = false;

      response.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (exceeded || received <= WEBHOOK_MAX_RESPONSE_BODY_BYTES) return;
        // 上限を超えた時点で読み取りをやめ、接続を閉じる。本文は保持しない。
        exceeded = true;
        response.destroy();
        request.destroy();
        resolve({ statusCode, bodyLimitExceeded: true });
      });
      response.on('end', () => {
        if (!exceeded) resolve({ statusCode, bodyLimitExceeded: false });
      });
      response.on('error', (error: Error) => {
        if (!exceeded) reject(error);
      });
    });

    request.on('error', reject);
    request.end(body);
  });
