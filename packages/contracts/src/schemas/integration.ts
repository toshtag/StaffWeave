import { API_SCOPES, WEBHOOK_EVENT_TYPES } from '@staffweave/domain';
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
      minLength: 8,
      maxLength: 2048,
      description: 'http または https の Webhook 送信先。既定では公開ネットワークだけを指定できる',
    },
    eventTypes: arraySchema({ type: 'string', enum: [...WEBHOOK_EVENT_TYPES] }),
  },
  required: ['name', 'url', 'eventTypes'],
});

export const createWebhookEndpointResponseSchema = objectSchema({
  properties: {
    endpoint: webhookEndpointSchema,
    /** 署名の検証に使う秘密。この応答でしか返らない。 */
    secret: { type: 'string' },
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
