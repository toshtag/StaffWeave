import { ATTENDANCE_EVENT_TYPES, ATTENDANCE_SOURCES, CORRECTION_ACTIONS } from '@staffweave/domain';
import { arraySchema, objectSchema } from '../json-schema.js';
import { businessDateSchema, timestampSchema, uuidSchema } from './common.js';
import { attendanceCalculationSchema, workScheduleSchema } from './schedule.js';

export const attendanceEventSchema = objectSchema({
  description: '追記のみの打刻イベント。修正も新しいイベントとして記録される',
  properties: {
    id: uuidSchema,
    employeeId: uuidSchema,
    eventType: { type: 'string', enum: [...ATTENDANCE_EVENT_TYPES] },
    occurredAt: { ...timestampSchema, description: '打刻が起きた時刻' },
    recordedAt: { ...timestampSchema, description: 'サーバーが受け取った時刻' },
    businessDate: businessDateSchema,
    source: { type: 'string', enum: [...ATTENDANCE_SOURCES] },
    correctionAction: {
      oneOf: [{ type: 'string', enum: [...CORRECTION_ACTIONS] }, { type: 'null' }],
      description: '修正イベントの種別。通常の打刻なら null',
    },
    correctsEventId: { oneOf: [uuidSchema, { type: 'null' }] },
    correctionReason: { oneOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: [
    'id',
    'employeeId',
    'eventType',
    'occurredAt',
    'recordedAt',
    'businessDate',
    'source',
    'correctionAction',
    'correctsEventId',
    'correctionReason',
  ],
});

export const breakPeriodSchema = objectSchema({
  properties: {
    startedAt: timestampSchema,
    endedAt: { oneOf: [timestampSchema, { type: 'null' }] },
  },
  required: ['startedAt', 'endedAt'],
});

export const workDaySchema = objectSchema({
  description: '一日分の勤務状態と、その根拠となった打刻イベント',
  properties: {
    businessDate: businessDateSchema,
    employeeId: uuidSchema,
    state: {
      type: 'string',
      enum: ['not_started', 'working', 'on_break', 'finished'],
      description: '出勤前 / 勤務中 / 休憩中 / 退勤済み',
    },
    firstClockInAt: { oneOf: [timestampSchema, { type: 'null' }] },
    lastClockOutAt: { oneOf: [timestampSchema, { type: 'null' }] },
    breaks: arraySchema(breakPeriodSchema),
    events: arraySchema(attendanceEventSchema, '修正を適用した後の有効な打刻'),
    history: arraySchema(attendanceEventSchema, '記録されたすべてのイベント（修正を含む）'),
    schedule: { oneOf: [workScheduleSchema, { type: 'null' }] },
    calculation: { oneOf: [attendanceCalculationSchema, { type: 'null' }] },
  },
  required: [
    'businessDate',
    'employeeId',
    'state',
    'firstClockInAt',
    'lastClockOutAt',
    'breaks',
    'events',
    'history',
    'schedule',
    'calculation',
  ],
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

export const correctAttendanceRequestSchema = objectSchema({
  description: '打刻の修正。元の打刻は書き換えず、修正イベントとして追加される',
  properties: {
    action: { type: 'string', enum: [...CORRECTION_ACTIONS] },
    targetEventId: {
      ...uuidSchema,
      description: 'adjust / void の対象。add では指定しない',
    },
    eventType: {
      type: 'string',
      enum: [...ATTENDANCE_EVENT_TYPES],
      description: 'adjust / add で指定する打刻種別',
    },
    occurredAt: { ...timestampSchema, description: 'adjust / add で指定する打刻時刻' },
    businessDate: {
      ...businessDateSchema,
      description: 'add で対象の業務日を明示する場合に指定する',
    },
    reason: {
      type: 'string',
      minLength: 2,
      maxLength: 500,
      description: '修正の理由。必須',
    },
    requestId: { type: 'string', minLength: 8, maxLength: 128 },
  },
  required: ['action', 'reason', 'requestId'],
});

export const correctAttendanceResponseSchema = objectSchema({
  properties: {
    event: attendanceEventSchema,
    day: workDaySchema,
    duplicate: { type: 'boolean' },
  },
  required: ['event', 'day', 'duplicate'],
});
