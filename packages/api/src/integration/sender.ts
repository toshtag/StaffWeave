/**
 * Webhook の HTTP 送信。
 *
 * ここが担うのは送信と結果の正規化だけで、どの行を送るかは呼び出し側が決める。
 * 送信先の安全性（内部ネットワーク宛の拒否、名前解決、リダイレクト先の検証）は
 * この関数の手前に置く予定で、まだ実装していない。
 */

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

/** 実際の通信。テストから差し替えられるようにする。 */
export type WebhookTransport = (
  url: string,
  headers: Record<string, string>,
  body: string,
  signal: AbortSignal,
) => Promise<Response>;

export type WebhookSender = (request: WebhookRequest) => Promise<WebhookSendResult>;

export interface WebhookSenderDependencies {
  transport?: WebhookTransport;
  /** この時間で完了しない送信は打ち切る。ワーカーが無期限に滞留しないようにする。 */
  timeoutMs: number;
}

const defaultTransport: WebhookTransport = (url, headers, body, signal) =>
  fetch(url, { method: 'POST', headers, body, signal });

function toResult(response: Response): WebhookSendResult {
  return {
    outcome: response.ok ? 'delivered' : 'failed',
    statusCode: response.status,
    errorMessage: response.ok ? null : `HTTP ${response.status}`,
  };
}

export function createWebhookSender(deps: WebhookSenderDependencies): WebhookSender {
  const transport = deps.transport ?? defaultTransport;

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

    const attempt = transport(request.url, request.headers, request.body, controller.signal).then(
      toResult,
      (error: unknown): WebhookSendResult => ({
        outcome: 'failed',
        statusCode: null,
        errorMessage: error instanceof Error ? error.message : '送信に失敗しました',
      }),
    );

    try {
      return await Promise.race([attempt, expired]);
    } finally {
      clearTimeout(timer);
    }
  };
}
