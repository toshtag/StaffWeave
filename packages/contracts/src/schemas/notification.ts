import { arraySchema, objectSchema } from '../json-schema.js';
import { timestampSchema, uuidSchema } from './common.js';

/**
 * 利用者への通知。
 *
 * 正本は DB に置く。外部への配送を足す場合も、正本はここのまま。
 * 外部だけに置くと、送信に失敗した通知が誰にも見えなくなる。
 */
export const NOTIFICATION_KINDS = [
  'request_submitted',
  'request_approved',
  'request_returned',
  'request_cancelled',
  'request_decided_on_behalf',
] as const;

export const notificationSchema = objectSchema({
  description: '自分あての通知 1 件',
  properties: {
    id: uuidSchema,
    kind: { type: 'string', enum: [...NOTIFICATION_KINDS] },
    subjectType: { type: 'string', enum: ['employee_request'] },
    subjectId: { oneOf: [uuidSchema, { type: 'null' }] },
    summary: { type: 'string', description: '画面へそのまま出せる要約' },
    detail: { type: 'object' },
    occurredAt: timestampSchema,
    readAt: {
      oneOf: [timestampSchema, { type: 'null' }],
      description: '読んだ時刻。未読なら null',
    },
  },
  required: ['id', 'kind', 'subjectType', 'subjectId', 'summary', 'detail', 'occurredAt', 'readAt'],
});

export const notificationListSchema = objectSchema({
  properties: {
    notifications: arraySchema(notificationSchema),
    unreadCount: { type: 'integer' },
  },
  required: ['notifications', 'unreadCount'],
});

export const listNotificationsQuerySchema = objectSchema({
  properties: {
    unreadOnly: { type: 'string', enum: ['true', 'false'] },
  },
  required: [],
});

export const markNotificationsReadRequestSchema = objectSchema({
  description: '自分あての通知を既読にする。他人の識別子を渡しても、その行は動かない',
  properties: { ids: arraySchema(uuidSchema) },
  required: ['ids'],
});

export const markNotificationsReadResponseSchema = objectSchema({
  properties: {
    read: { type: 'integer', description: '未読から既読へ変わった件数' },
    unreadCount: { type: 'integer' },
  },
  required: ['read', 'unreadCount'],
});
