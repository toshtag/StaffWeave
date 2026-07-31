/**
 * Webhook の HTTP 送信。
 *
 * ここが担うのは、送信先の検査と通信をつなぎ、上限時間と結果の正規化を行うところまで。
 * どの行を送るかは呼び出し側が決め、宛先が安全かは webhook-network-policy が決める。
 *
 * 送信のたびに名前解決からやり直す。登録時に安全だった送信先でも、その後に
 * 解決結果が内部アドレスへ変わることがあり、登録時の検査だけでは防げない。
 */

import type { WebhookResponseSummary, WebhookTransport } from './webhook-http-transport.js';
import { nodeWebhookTransport, WEBHOOK_MAX_RESPONSE_BODY_BYTES } from './webhook-http-transport.js';
import type { WebhookHostResolver, WebhookNetworkPolicyMode } from './webhook-network-policy.js';
import { createWebhookNetworkPolicy, WebhookTargetError } from './webhook-network-policy.js';

export interface WebhookRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface WebhookSendResult {
  outcome: 'delivered' | 'failed';
  statusCode: number | null;
  errorMessage: string | null;
}

export type WebhookSender = (request: WebhookRequest) => Promise<WebhookSendResult>;

export interface WebhookSenderDependencies {
  /** 送信先として許すネットワークの範囲。API 側の登録時検査と同じ値を使う。 */
  networkPolicy: WebhookNetworkPolicyMode;
  /** この時間で完了しない送信は打ち切る。ワーカーが無期限に滞留しないようにする。 */
  timeoutMs: number;
  resolver?: WebhookHostResolver;
  transport?: WebhookTransport;
}

function toResult(response: WebhookResponseSummary): WebhookSendResult {
  if (response.bodyLimitExceeded) {
    return {
      outcome: 'failed',
      statusCode: response.statusCode,
      errorMessage: `Webhook 応答本文が ${WEBHOOK_MAX_RESPONSE_BODY_BYTES} バイトの上限を超えました`,
    };
  }

  const { statusCode } = response;
  if (statusCode >= 200 && statusCode < 300) {
    return { outcome: 'delivered', statusCode, errorMessage: null };
  }
  // 転送先は追わない。追うと署名した宛先と実際の宛先が変わり、
  // 外部の URL から内部の URL へ誘導されても止められない。
  if (statusCode >= 300 && statusCode < 400) {
    return {
      outcome: 'failed',
      statusCode,
      errorMessage: `HTTP ${statusCode}（リダイレクトには追従しません）`,
    };
  }
  return { outcome: 'failed', statusCode, errorMessage: `HTTP ${statusCode}` };
}

export function createWebhookSender(deps: WebhookSenderDependencies): WebhookSender {
  const policy = createWebhookNetworkPolicy({
    mode: deps.networkPolicy,
    ...(deps.resolver === undefined ? {} : { resolver: deps.resolver }),
  });
  const transport = deps.transport ?? nodeWebhookTransport;

  return async (request) => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    // 打ち切りは中断信号だけに任せない。信号を見ない実装を渡されても上限を守るため。
    const expired = new Promise<WebhookSendResult>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({
          outcome: 'failed',
          statusCode: null,
          errorMessage: `送信が ${deps.timeoutMs} ミリ秒で完了しませんでした`,
        });
      }, deps.timeoutMs);
    });

    const attempt = (async () => {
      // 名前解決も送信全体の上限時間へ含める。中断できないと打ち切りが効かない。
      const target = await policy.resolve(request.url, controller.signal);
      // 名前解決に上限時間を使い切っていたら、新しい接続は開かない。
      if (controller.signal.aborted) {
        throw new Error(`送信が ${deps.timeoutMs} ミリ秒で完了しませんでした`);
      }
      return transport(target, request.headers, request.body, controller.signal);
    })().then(toResult, (error: unknown): WebhookSendResult => {
      // 検査で弾いた理由は利用者向けの文言をそのまま残す。内部アドレスは含まれない。
      if (error instanceof WebhookTargetError) {
        return { outcome: 'failed', statusCode: null, errorMessage: error.message };
      }
      return {
        outcome: 'failed',
        statusCode: null,
        errorMessage: error instanceof Error ? error.message : '送信に失敗しました',
      };
    });

    try {
      return await Promise.race([attempt, expired]);
    } finally {
      clearTimeout(timer);
    }
  };
}
