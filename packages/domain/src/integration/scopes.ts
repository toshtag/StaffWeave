/**
 * API キーのスコープと Webhook の種別。
 *
 * 外部連携に渡す権限は、画面の利用者が持つロールとは別に管理する。
 * 連携ごとに必要な範囲だけを渡せるようにするため。
 */

export const API_SCOPES = [
  /** 勤怠と集計の読み取り */
  'attendance:read',
  /** 打刻の記録 */
  'attendance:write',
  /** 給与連携向けの出力 */
  'payroll:read',
  /** 組織・従業員の読み取り */
  'organization:read',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}

export const API_SCOPE_LABELS: Record<ApiScope, string> = {
  'attendance:read': '勤怠と集計の読み取り',
  'attendance:write': '打刻の記録',
  'payroll:read': '給与連携向けの出力',
  'organization:read': '組織・従業員の読み取り',
};

/** キーが与えられた範囲を満たしているか。 */
export function hasScope(granted: readonly string[], required: ApiScope): boolean {
  return granted.includes(required);
}

export const WEBHOOK_EVENT_TYPES = [
  /** 日次申請が承認された */
  'attendance_request.approved',
  /** 日次申請が差し戻された */
  'attendance_request.returned',
  /** 月次締めが行われた */
  'monthly_closing.closed',
  /** 月次締めが解除された */
  'monthly_closing.reopened',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export function isWebhookEventType(value: string): value is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Webhook の署名対象。
 *
 * 受け取り側は同じ文字列を組み立てて署名を検証する。
 * 送信時刻を含めることで、古い通知の使い回しに気付けるようにする。
 */
export function canonicalWebhookMessage(input: {
  eventId: string;
  eventType: string;
  timestamp: string;
  body: string;
}): string {
  return ['staffweave-webhook/1', input.eventId, input.eventType, input.timestamp, input.body].join(
    '\n',
  );
}
