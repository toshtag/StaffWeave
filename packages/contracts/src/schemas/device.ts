import { ATTENDANCE_EVENT_TYPES, DEVICE_STATES } from '@staffweave/domain';
import { arraySchema, objectSchema } from '../json-schema.js';
import {
  codeSchema,
  nameSchema,
  signedDeviceSequenceSchema,
  timestampSchema,
  uuidSchema,
} from './common.js';

export const deviceSchema = objectSchema({
  description: '打刻端末',
  properties: {
    id: uuidSchema,
    siteId: { oneOf: [uuidSchema, { type: 'null' }] },
    name: nameSchema,
    state: { type: 'string', enum: [...DEVICE_STATES] },
    enrollments: { type: 'integer' },
    lastSequence: {
      type: 'integer',
      description:
        'この端末から受理した署名要求の最終連番。打刻イベント・カード打刻・PC セッション観測で共有する',
    },
    enrolledAt: { oneOf: [timestampSchema, { type: 'null' }] },
    revokedAt: { oneOf: [timestampSchema, { type: 'null' }] },
    lastSeenAt: { oneOf: [timestampSchema, { type: 'null' }] },
    createdAt: timestampSchema,
  },
  required: [
    'id',
    'siteId',
    'name',
    'state',
    'enrollments',
    'lastSequence',
    'enrolledAt',
    'revokedAt',
    'lastSeenAt',
    'createdAt',
  ],
});

export const deviceListSchema = objectSchema({
  properties: { devices: arraySchema(deviceSchema) },
  required: ['devices'],
});

export const registerDeviceRequestSchema = objectSchema({
  description: '端末の枠を作り、一度きりの登録トークンを発行する',
  properties: {
    name: nameSchema,
    siteId: uuidSchema,
    /** 有効時間（分）。既定は 15 分。カードの登録トークンと同じ扱いにする。 */
    expiresInMinutes: { type: 'integer', minimum: 1, maximum: 1440 },
  },
  required: ['name'],
});

export const registerDeviceResponseSchema = objectSchema({
  properties: {
    device: deviceSchema,
    /** 登録トークンはこの応答でしか返さない。サーバーはハッシュだけを保存する。 */
    enrollmentToken: { type: 'string' },
    /** この時刻を過ぎた登録トークンは使えない。 */
    enrollmentTokenExpiresAt: timestampSchema,
  },
  required: ['device', 'enrollmentToken', 'enrollmentTokenExpiresAt'],
});

export const enrollDeviceRequestSchema = objectSchema({
  description: 'Agent が登録トークンと引き換えに公開鍵を登録する',
  properties: {
    enrollmentToken: { type: 'string', minLength: 16, maxLength: 256 },
    publicKey: {
      type: 'string',
      minLength: 32,
      maxLength: 4096,
      description: 'Ed25519 公開鍵（SPKI PEM）。秘密鍵はサーバーへ送らない',
    },
  },
  required: ['enrollmentToken', 'publicKey'],
});

export const enrollDeviceResponseSchema = objectSchema({
  properties: {
    deviceId: uuidSchema,
    workspaceSlug: { type: 'string' },
    device: deviceSchema,
    /**
     * IC カードの指紋を計算するための鍵。
     * サーバーの設定に鍵が無い場合は返らず、カード機能は使えない。
     */
    cardFingerprintKey: { type: 'string' },
  },
  required: ['deviceId', 'workspaceSlug', 'device'],
});

export const deviceEventRequestSchema = objectSchema({
  description: '端末が署名して送る打刻イベント',
  properties: {
    sequence: signedDeviceSequenceSchema,
    requestId: { type: 'string', minLength: 8, maxLength: 128 },
    employeeNumber: codeSchema,
    eventType: { type: 'string', enum: [...ATTENDANCE_EVENT_TYPES] },
    occurredAt: timestampSchema,
    deviceTime: { ...timestampSchema, description: '送信時点の端末の時計' },
  },
  required: ['sequence', 'requestId', 'employeeNumber', 'eventType', 'occurredAt', 'deviceTime'],
});

export const deviceEventResponseSchema = objectSchema({
  properties: {
    outcome: {
      type: 'string',
      enum: ['accepted', 'duplicate'],
      description: 'accepted は新規受理、duplicate は同じ冪等キーの再送',
    },
    attendanceEventId: { oneOf: [uuidSchema, { type: 'null' }] },
    businessDate: { type: 'string' },
    /** 直前の連番との差。1 より大きければ欠落がある。 */
    sequenceStep: { type: 'integer' },
    clockSkewSeconds: { type: 'integer' },
  },
  required: ['outcome', 'attendanceEventId', 'businessDate', 'sequenceStep', 'clockSkewSeconds'],
});

export const deviceReceiptSchema = objectSchema({
  description: '端末から届いたイベントの受信記録',
  properties: {
    deviceId: uuidSchema,
    sequence: { type: 'integer' },
    requestId: { type: 'string' },
    receivedAt: timestampSchema,
    deviceTime: timestampSchema,
    clockSkewSeconds: { type: 'integer' },
    sequenceStep: { type: 'integer' },
    attendanceEventId: { oneOf: [uuidSchema, { type: 'null' }] },
    businessDate: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    outcome: { type: 'string', enum: ['accepted', 'duplicate', 'rejected'] },
  },
  required: [
    'deviceId',
    'sequence',
    'requestId',
    'receivedAt',
    'deviceTime',
    'clockSkewSeconds',
    'sequenceStep',
    'attendanceEventId',
    'businessDate',
    'outcome',
  ],
});

export const deviceReceiptListSchema = objectSchema({
  properties: { receipts: arraySchema(deviceReceiptSchema) },
  required: ['receipts'],
});
