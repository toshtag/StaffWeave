/**
 * 外部連携を作るための最小の道具立て。
 *
 * API キーでの読み取りと、Webhook の署名検証だけを提供する。
 * 便利さより、送信側と受信側で計算が食い違わないことを優先する。
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { AnomalyList, SessionObservationList, WorkDay } from '@staffweave/contracts';
import { requireSecureBaseUrl } from '@staffweave/contracts';
import type { WebhookEventType } from '@staffweave/domain';
import { canonicalWebhookMessage, isWebhookEventType, parseCsv } from '@staffweave/domain';

export class ConnectorError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ConnectorError';
    this.status = status;
  }
}

export interface ConnectorOptions {
  /**
   * staffweave の接続先。
   *
   * ループバック以外には https を指定する。API キーと取り出すデータが
   * 暗号化されていない接続を通らないようにするため。
   */
  baseUrl: string;
  /** 作成時にしか手に入らない API キー。 */
  apiKey: string;
}

export interface StaffweaveConnector {
  /** 日次の勤怠と集計を CSV の行として取り出す。 */
  fetchAttendance(query: { from: string; to: string }): Promise<Record<string, string>[]>;
  /** 月次の集計を給与連携向けの行として取り出す。 */
  fetchPayroll(query: { period: string }): Promise<Record<string, string>[]>;
  /** 任意の読み取り API を叩く。契約の型をそのまま使う。 */
  get<T>(path: string): Promise<T>;
}

export function createConnector(options: ConnectorOptions): StaffweaveConnector {
  // API キーを送る前に確かめる。要求を出してからでは遅い。
  const base = requireSecureBaseUrl(options.baseUrl, 'staffweave の接続先');

  async function request(path: string): Promise<Response> {
    const response = await fetch(`${base}/api${path}`, {
      headers: { authorization: `Bearer ${options.apiKey}` },
    });
    if (!response.ok) {
      throw new ConnectorError(response.status, `取得に失敗しました（HTTP ${response.status}）`);
    }
    return response;
  }

  async function fetchCsv(path: string): Promise<Record<string, string>[]> {
    const response = await request(path);
    return parseCsv(await response.text()).rows;
  }

  return {
    fetchAttendance: (query) =>
      fetchCsv(`/exports/attendance.csv?${new URLSearchParams(query).toString()}`),
    fetchPayroll: (query) =>
      fetchCsv(`/exports/payroll.csv?${new URLSearchParams(query).toString()}`),
    async get<T>(path: string): Promise<T> {
      return (await (await request(path)).json()) as T;
    },
  };
}

export interface WebhookRequest {
  headers: {
    'x-staffweave-event'?: string;
    'x-staffweave-event-id'?: string;
    'x-staffweave-timestamp'?: string;
    'x-staffweave-signature'?: string;
  };
  body: string;
}

export interface VerifiedWebhook {
  eventId: string;
  eventType: WebhookEventType;
  occurredAt: string;
  data: unknown;
}

/**
 * 登録時に受け取った秘密から Webhook の署名鍵を導出する。
 *
 * 秘密をそのまま HMAC の鍵にはしない。SHA-256 の小文字 16 進数 64 文字へ変換し、
 * その文字列を UTF-8 のまま鍵として使う。ダイジェストの生の 32 バイトではない。
 *
 * 導出した値は Webhook の署名を生成できる機密情報である。
 * ログ、データベース、画面へ不用意に保存・表示してはならない。
 *
 * 通常は `verifyWebhook()` を使えばよい。この関数は、自前で署名を組み立てる場合や、
 * 送信側との計算の一致を確かめる場合のために公開している。
 */
export function deriveWebhookSigningKey(signingSecret: string): string {
  return createHash('sha256').update(signingSecret, 'utf8').digest('hex');
}

/**
 * Webhook の署名を検証する。
 *
 * 受け取るのは登録時に返された秘密そのもの。署名鍵はここで導出する。
 * 検証は定数時間で行い、一致・不一致の差から情報が漏れないようにする。
 */
export function verifyWebhook(
  signingSecret: string,
  request: WebhookRequest,
  options: { toleranceSeconds?: number; now?: Date } = {},
): VerifiedWebhook {
  const eventId = request.headers['x-staffweave-event-id'];
  const eventType = request.headers['x-staffweave-event'];
  const timestamp = request.headers['x-staffweave-timestamp'];
  const signature = request.headers['x-staffweave-signature'];

  if (!eventId || !eventType || !timestamp || !signature) {
    throw new ConnectorError(400, '署名に必要なヘッダーが足りません');
  }
  if (!isWebhookEventType(eventType)) {
    throw new ConnectorError(400, `未知の出来事です: ${eventType}`);
  }

  const now = options.now ?? new Date();
  const tolerance = (options.toleranceSeconds ?? 300) * 1000;
  const sentAt = new Date(timestamp).getTime();
  if (Number.isNaN(sentAt) || Math.abs(now.getTime() - sentAt) > tolerance) {
    throw new ConnectorError(400, '送信時刻が許容範囲を超えています');
  }

  const signingKey = deriveWebhookSigningKey(signingSecret);
  const expected = createHmac('sha256', signingKey)
    .update(canonicalWebhookMessage({ eventId, eventType, timestamp, body: request.body }), 'utf8')
    .digest('base64');

  const provided = Buffer.from(signature, 'utf8');
  const computed = Buffer.from(expected, 'utf8');
  if (provided.length !== computed.length || !timingSafeEqual(provided, computed)) {
    throw new ConnectorError(401, '署名が一致しません');
  }

  const parsed = JSON.parse(request.body) as VerifiedWebhook;
  return parsed;
}

export type { AnomalyList, SessionObservationList, WorkDay };
