import {
  API_SCOPES,
  MAXIMUM_WEBHOOK_URL_LENGTH,
  MINIMUM_WEBHOOK_URL_LENGTH,
  WEBHOOK_EVENT_TYPES,
} from '@staffweave/domain';
import { arraySchema, objectSchema } from '../json-schema.js';
import { businessDateSchema, nameSchema, timestampSchema, uuidSchema } from './common.js';

export const apiKeySchema = objectSchema({
  description: 'API キー。生の鍵は作成時の応答にしか現れない',
  properties: {
    id: uuidSchema,
    name: nameSchema,
    prefix: { type: 'string', description: '見分けるための先頭 8 文字' },
    scopes: arraySchema({ type: 'string', enum: [...API_SCOPES] }),
    createdAt: timestampSchema,
    lastUsedAt: { oneOf: [timestampSchema, { type: 'null' }] },
    revokedAt: { oneOf: [timestampSchema, { type: 'null' }] },
  },
  required: ['id', 'name', 'prefix', 'scopes', 'createdAt', 'lastUsedAt', 'revokedAt'],
});

export const apiKeyListSchema = objectSchema({
  properties: { apiKeys: arraySchema(apiKeySchema) },
  required: ['apiKeys'],
});

export const webhookDeliverySchema = objectSchema({
  description: 'Webhook の送信結果。送信ワーカーが記録する',
  properties: {
    id: uuidSchema,
    endpointId: uuidSchema,
    eventType: { type: 'string', enum: [...WEBHOOK_EVENT_TYPES] },
    eventId: uuidSchema,
    attemptedAt: timestampSchema,
    statusCode: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    outcome: { type: 'string', enum: ['delivered', 'failed', 'skipped'] },
    errorMessage: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    attempt: { type: 'integer', description: '何回目の試行だったか' },
  },
  required: [
    'id',
    'endpointId',
    'eventType',
    'eventId',
    'attemptedAt',
    'statusCode',
    'outcome',
    'errorMessage',
    'attempt',
  ],
});

export const webhookDeliveryListSchema = objectSchema({
  properties: { deliveries: arraySchema(webhookDeliverySchema) },
  required: ['deliveries'],
});

export const createApiKeyRequestSchema = objectSchema({
  properties: {
    name: nameSchema,
    scopes: arraySchema({ type: 'string', enum: [...API_SCOPES] }),
  },
  required: ['name', 'scopes'],
});

export const createApiKeyResponseSchema = objectSchema({
  properties: {
    apiKey: apiKeySchema,
    /** この応答でしか返らない。控えておくこと。 */
    secret: { type: 'string' },
  },
  required: ['apiKey', 'secret'],
});

export const webhookEndpointSchema = objectSchema({
  properties: {
    id: uuidSchema,
    name: nameSchema,
    url: { type: 'string' },
    eventTypes: arraySchema({ type: 'string', enum: [...WEBHOOK_EVENT_TYPES] }),
    active: { type: 'boolean' },
    createdAt: timestampSchema,
  },
  required: ['id', 'name', 'url', 'eventTypes', 'active', 'createdAt'],
});

export const webhookEndpointListSchema = objectSchema({
  properties: { endpoints: arraySchema(webhookEndpointSchema) },
  required: ['endpoints'],
});

export const createWebhookEndpointRequestSchema = objectSchema({
  properties: {
    name: nameSchema,
    // format は目安であり、これだけを安全の根拠にしない。
    // 送信先が到達してよいネットワークかどうかは API 側で必ず検査する。
    url: {
      type: 'string',
      format: 'uri',
      minLength: MINIMUM_WEBHOOK_URL_LENGTH,
      maxLength: MAXIMUM_WEBHOOK_URL_LENGTH,
      description: 'http または https の Webhook 送信先。既定では公開ネットワークだけを指定できる',
    },
    eventTypes: arraySchema({ type: 'string', enum: [...WEBHOOK_EVENT_TYPES] }),
  },
  required: ['name', 'url', 'eventTypes'],
});

export const createWebhookEndpointResponseSchema = objectSchema({
  properties: {
    endpoint: webhookEndpointSchema,
    secret: {
      type: 'string',
      description:
        '送信先の登録時に一度だけ返る Webhook 署名用の秘密。' +
        '受け取り側は connector で署名鍵を導出して検証する',
    },
  },
  required: ['endpoint', 'secret'],
});

export const importResultSchema = objectSchema({
  properties: {
    created: { type: 'integer' },
    problems: arraySchema(
      objectSchema({
        properties: { line: { type: 'integer' }, message: { type: 'string' } },
        required: ['line', 'message'],
      }),
    ),
  },
  required: ['created', 'problems'],
});

/**
 * 従業員取り込みの CSV。
 *
 * 契約として示すのは、見出しの名前と必須の列、文字コードだけ。
 * 実際の解釈は API が行うため、ここでは行の形を JSON Schema へ写さない。
 */
export const employeeImportCsvSchema = {
  type: 'string',
  description: [
    'UTF-8 の CSV。1 行目は見出し。',
    '必須の列: organization_code, employee_number, display_name。',
    '任意の列: hired_on（YYYY-MM-DD）。',
    '見出しに必須の列が無い場合は 400 を返す。',
    '行ごとの失敗は取り込みを止めず、応答の problems へ行番号と理由を入れる。',
  ].join(''),
} as const;

export const exportAttendanceQuerySchema = objectSchema({
  properties: { from: businessDateSchema, to: businessDateSchema },
  required: ['from', 'to'],
});

export const exportPayrollQuerySchema = objectSchema({
  properties: {
    period: { type: 'string', pattern: '^\\d{4}-\\d{2}-01$', description: '対象月の 1 日' },
  },
  required: ['period'],
});

export const abandonedDeliverySchema = objectSchema({
  description: '決めた回数だけ試しても送れず、諦めた通知。行は残る',
  properties: {
    id: uuidSchema,
    endpointId: uuidSchema,
    eventType: { type: 'string', enum: [...WEBHOOK_EVENT_TYPES] },
    eventId: uuidSchema,
    occurredAt: timestampSchema,
    attempts: { type: 'integer' },
    abandonedAt: timestampSchema,
    lastError: { oneOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: [
    'id',
    'endpointId',
    'eventType',
    'eventId',
    'occurredAt',
    'attempts',
    'abandonedAt',
    'lastError',
  ],
});

export const abandonedDeliveryListSchema = objectSchema({
  properties: { deliveries: arraySchema(abandonedDeliverySchema) },
  required: ['deliveries'],
});
