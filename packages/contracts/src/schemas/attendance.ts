import {
  ATTENDANCE_EVENT_TYPES,
  ATTENDANCE_SOURCES,
  BUSINESS_DATE_PATTERN,
} from '@staffweave/domain';
import { arraySchema, objectSchema } from '../json-schema.js';
import { timestampSchema, uuidSchema } from './common.js';

export const businessDateSchema = {
  type: 'string',
  pattern: BUSINESS_DATE_PATTERN.source,
  description: '業務日（YYYY-MM-DD）。暦日ではなく、勤務が属する日',
} as const;

export const attendanceEventSchema = objectSchema({
  description: '追記のみの打刻イベント',
  properties: {
    id: uuidSchema,
    employeeId: uuidSchema,
    eventType: { type: 'string', enum: [...ATTENDANCE_EVENT_TYPES] },
    occurredAt: { ...timestampSchema, description: '打刻が起きた時刻' },
    recordedAt: { ...timestampSchema, description: 'サーバーが受け取った時刻' },
    businessDate: businessDateSchema,
    source: { type: 'string', enum: [...ATTENDANCE_SOURCES] },
  },
  required: ['id', 'employeeId', 'eventType', 'occurredAt', 'recordedAt', 'businessDate', 'source'],
});

export const workDaySchema = objectSchema({
  description: '一日分の勤務状態と、その根拠となった打刻イベント',
  properties: {
    businessDate: businessDateSchema,
    employeeId: uuidSchema,
    state: {
      type: 'string',
      enum: ['not_started', 'working', 'finished'],
      description: '出勤前 / 勤務中 / 退勤済み',
    },
    firstClockInAt: { oneOf: [timestampSchema, { type: 'null' }] },
    lastClockOutAt: { oneOf: [timestampSchema, { type: 'null' }] },
    events: arraySchema(attendanceEventSchema),
  },
  required: ['businessDate', 'employeeId', 'state', 'firstClockInAt', 'lastClockOutAt', 'events'],
});

export const recordAttendanceEventRequestSchema = objectSchema({
  description: '自分の打刻を記録する要求',
  properties: {
    eventType: { type: 'string', enum: [...ATTENDANCE_EVENT_TYPES] },
    occurredAt: {
      ...timestampSchema,
      description: '省略時はサーバーが受け取った時刻を使う',
    },
    requestId: {
      type: 'string',
      minLength: 8,
      maxLength: 128,
      description: '二重送信を防ぐ冪等キー。同じ値の再送は最初の 1 件だけを記録する',
    },
  },
  required: ['eventType', 'requestId'],
});

export const recordAttendanceEventResponseSchema = objectSchema({
  properties: {
    event: attendanceEventSchema,
    day: workDaySchema,
    /** 同じ冪等キーの再送を受け取った場合に true。 */
    duplicate: { type: 'boolean' },
  },
  required: ['event', 'day', 'duplicate'],
});
