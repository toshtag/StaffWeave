import { ANOMALY_KINDS } from '@staffweave/domain';
import { arraySchema, objectSchema } from '../json-schema.js';
import { businessDateSchema, timestampSchema, uuidSchema } from './common.js';

export const anomalySchema = objectSchema({
  description: '検出した異常。不正と決めつけず、確認のための材料として示す',
  properties: {
    kind: { type: 'string', enum: [...ANOMALY_KINDS] },
    severity: { type: 'string', enum: ['info', 'warning'] },
    summary: { type: 'string', description: '画面へそのまま出せる説明' },
    employeeId: { oneOf: [uuidSchema, { type: 'null' }] },
    businessDate: { oneOf: [businessDateSchema, { type: 'null' }] },
    deviceId: { oneOf: [uuidSchema, { type: 'null' }] },
    detectedAt: timestampSchema,
    /** 判定の根拠。何を見てそう言えるのかを残す。 */
    evidence: { type: 'object', additionalProperties: true },
  },
  required: [
    'kind',
    'severity',
    'summary',
    'employeeId',
    'businessDate',
    'deviceId',
    'detectedAt',
    'evidence',
  ],
});

export const anomalyListSchema = objectSchema({
  properties: { anomalies: arraySchema(anomalySchema) },
  required: ['anomalies'],
});

export const auditLogSchema = objectSchema({
  properties: {
    id: uuidSchema,
    occurredAt: timestampSchema,
    actorKind: { type: 'string', enum: ['user', 'device', 'system'] },
    actorUserId: { oneOf: [uuidSchema, { type: 'null' }] },
    action: { type: 'string' },
    targetType: { type: 'string' },
    targetId: { oneOf: [uuidSchema, { type: 'null' }] },
    summary: { type: 'string' },
    detail: { type: 'object', additionalProperties: true },
  },
  required: [
    'id',
    'occurredAt',
    'actorKind',
    'actorUserId',
    'action',
    'targetType',
    'targetId',
    'summary',
    'detail',
  ],
});

export const auditLogListSchema = objectSchema({
  properties: { logs: arraySchema(auditLogSchema) },
  required: ['logs'],
});

export const listAnomaliesQuerySchema = objectSchema({
  properties: {
    from: businessDateSchema,
    to: businessDateSchema,
    employeeId: uuidSchema,
    format: { type: 'string', enum: ['json', 'csv'], description: '省略時は json' },
  },
  required: ['from', 'to'],
});
