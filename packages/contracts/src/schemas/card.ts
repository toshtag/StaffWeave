import { ATTENDANCE_EVENT_TYPES } from '@staffweave/domain';
import { arraySchema, objectSchema } from '../json-schema.js';
import { timestampSchema, uuidSchema } from './common.js';

/** 一方向の指紋。生のカード識別子はここへ現れない。 */
export const cardFingerprintSchema = {
  type: 'string',
  pattern: '^[0-9a-f]{64}$',
  description: 'カード識別子から Agent が計算した一方向の指紋（16 進 64 文字）',
} as const;

export const cardCredentialSchema = objectSchema({
  properties: {
    id: uuidSchema,
    employeeId: uuidSchema,
    label: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    state: { type: 'string', enum: ['active', 'revoked'] },
    registeredAt: timestampSchema,
    revokedAt: { oneOf: [timestampSchema, { type: 'null' }] },
  },
  required: ['id', 'employeeId', 'label', 'state', 'registeredAt', 'revokedAt'],
});

export const cardCredentialListSchema = objectSchema({
  properties: { cardCredentials: arraySchema(cardCredentialSchema) },
  required: ['cardCredentials'],
});

export const createCardRegistrationRequestSchema = objectSchema({
  description: 'カード登録用の一度きりのトークンを発行する',
  properties: {
    employeeId: uuidSchema,
    label: { type: 'string', minLength: 1, maxLength: 100 },
    /** 有効時間（分）。既定は 15 分。 */
    expiresInMinutes: { type: 'integer', minimum: 1, maximum: 1440 },
  },
  required: ['employeeId'],
});

export const createCardRegistrationResponseSchema = objectSchema({
  properties: {
    registrationToken: { type: 'string' },
    expiresAt: timestampSchema,
  },
  required: ['registrationToken', 'expiresAt'],
});

export const registerCardRequestSchema = objectSchema({
  description: 'Agent が読み取ったカードの指紋を、登録トークンと結び付ける',
  properties: {
    registrationToken: { type: 'string', minLength: 16, maxLength: 256 },
    cardFingerprint: cardFingerprintSchema,
  },
  required: ['registrationToken', 'cardFingerprint'],
});

export const cardEventRequestSchema = objectSchema({
  description: '端末がカードの読み取りから作る打刻イベント',
  properties: {
    sequence: { type: 'integer', minimum: 1 },
    requestId: { type: 'string', minLength: 8, maxLength: 128 },
    cardFingerprint: cardFingerprintSchema,
    eventType: {
      type: 'string',
      enum: [...ATTENDANCE_EVENT_TYPES],
      description: '省略時は現在の状態から決める（出勤前なら出勤、勤務中なら退勤）',
    },
    occurredAt: timestampSchema,
    deviceTime: timestampSchema,
  },
  required: ['sequence', 'requestId', 'cardFingerprint', 'occurredAt', 'deviceTime'],
});

export const cardEventResponseSchema = objectSchema({
  properties: {
    outcome: { type: 'string', enum: ['accepted', 'duplicate'] },
    attendanceEventId: { oneOf: [uuidSchema, { type: 'null' }] },
    eventType: { type: 'string', enum: [...ATTENDANCE_EVENT_TYPES] },
    businessDate: { type: 'string' },
    /** カードの持ち主。端末の画面に出して本人が確認できるようにする。 */
    employeeDisplayName: { type: 'string' },
    sequenceStep: { type: 'integer' },
    clockSkewSeconds: { type: 'integer' },
  },
  required: [
    'outcome',
    'attendanceEventId',
    'eventType',
    'businessDate',
    'employeeDisplayName',
    'sequenceStep',
    'clockSkewSeconds',
  ],
});
