import { DAY_TYPES } from '@staffweave/domain';
import { arraySchema, objectSchema } from '../json-schema.js';
import {
  businessDateSchema,
  codeSchema,
  nameSchema,
  timestampSchema,
  uuidSchema,
} from './common.js';

/**
 * 予定の時刻は「現地 0 時からの分数」で表す。
 * 日をまたぐ勤務では終業が 1440 分を超える（翌 7:00 なら 1860）。
 */
const startMinutesSchema = { type: 'integer', minimum: 0, maximum: 1439 } as const;
const endMinutesSchema = { type: 'integer', minimum: 1, maximum: 2879 } as const;
const breakMinutesSchema = { type: 'integer', minimum: 0, maximum: 1439 } as const;

export const workPatternSchema = objectSchema({
  description: '勤務パターン。始業・終業・休憩の型',
  properties: {
    id: uuidSchema,
    code: codeSchema,
    name: nameSchema,
    startMinutes: startMinutesSchema,
    endMinutes: endMinutesSchema,
    breakMinutes: breakMinutesSchema,
    createdAt: timestampSchema,
  },
  required: ['id', 'code', 'name', 'startMinutes', 'endMinutes', 'breakMinutes', 'createdAt'],
});

export const workPatternListSchema = objectSchema({
  properties: { workPatterns: arraySchema(workPatternSchema) },
  required: ['workPatterns'],
});

export const createWorkPatternRequestSchema = objectSchema({
  properties: {
    code: codeSchema,
    name: nameSchema,
    startMinutes: startMinutesSchema,
    endMinutes: endMinutesSchema,
    breakMinutes: breakMinutesSchema,
  },
  required: ['code', 'name', 'startMinutes', 'endMinutes'],
});

export const workScheduleSchema = objectSchema({
  description: '特定の従業員・業務日への勤務予定',
  properties: {
    employeeId: uuidSchema,
    businessDate: businessDateSchema,
    workPatternId: { oneOf: [uuidSchema, { type: 'null' }] },
    dayType: { type: 'string', enum: [...DAY_TYPES] },
    startMinutes: { oneOf: [startMinutesSchema, { type: 'null' }] },
    endMinutes: { oneOf: [endMinutesSchema, { type: 'null' }] },
    breakMinutes: breakMinutesSchema,
  },
  required: [
    'employeeId',
    'businessDate',
    'workPatternId',
    'dayType',
    'startMinutes',
    'endMinutes',
    'breakMinutes',
  ],
});

export const workScheduleListSchema = objectSchema({
  properties: { workSchedules: arraySchema(workScheduleSchema) },
  required: ['workSchedules'],
});

export const upsertWorkScheduleRequestSchema = objectSchema({
  description: '勤務予定の登録・更新。勤務パターンを指定すると時刻はそこから埋める',
  properties: {
    employeeId: uuidSchema,
    businessDate: businessDateSchema,
    workPatternId: uuidSchema,
    dayType: { type: 'string', enum: [...DAY_TYPES] },
    startMinutes: startMinutesSchema,
    endMinutes: endMinutesSchema,
    breakMinutes: breakMinutesSchema,
  },
  required: ['employeeId', 'businessDate'],
});

export const listWorkSchedulesQuerySchema = objectSchema({
  properties: {
    employeeId: uuidSchema,
    from: businessDateSchema,
    to: businessDateSchema,
  },
  required: ['employeeId', 'from', 'to'],
});

export const calculationStepSchema = objectSchema({
  properties: { label: { type: 'string' }, minutes: { type: 'integer' } },
  required: ['label', 'minutes'],
});

export const calculationSegmentSchema = objectSchema({
  properties: {
    kind: { type: 'string', enum: ['work', 'break'] },
    startAt: timestampSchema,
    endAt: timestampSchema,
    minutes: { type: 'integer' },
  },
  required: ['kind', 'startAt', 'endAt', 'minutes'],
});

export const attendanceCalculationSchema = objectSchema({
  description: '一日分の計算結果。入力版・ルール版・根拠を伴う',
  properties: {
    version: { type: 'integer', description: '同じ日の計算の版。入力が変わるたびに増える' },
    calculatedAt: timestampSchema,
    inputFingerprint: { type: 'string', description: '計算に使った入力の指紋' },
    ruleVersion: { type: 'string' },
    attendedMinutes: { type: 'integer' },
    workedMinutes: { type: 'integer' },
    breakMinutes: { type: 'integer' },
    scheduledMinutes: { type: 'integer' },
    withinScheduleMinutes: { type: 'integer' },
    outsideScheduleMinutes: { type: 'integer' },
    nightMinutes: { type: 'integer' },
    nonWorkingDayMinutes: { type: 'integer' },
    basis: objectSchema({
      properties: {
        ruleVersion: { type: 'string' },
        timeZone: { type: 'string' },
        dayType: { type: 'string', enum: [...DAY_TYPES] },
        segments: arraySchema(calculationSegmentSchema),
        steps: arraySchema(calculationStepSchema),
        incomplete: { type: 'boolean' },
      },
      required: ['ruleVersion', 'timeZone', 'dayType', 'segments', 'steps', 'incomplete'],
    }),
  },
  required: [
    'version',
    'calculatedAt',
    'inputFingerprint',
    'ruleVersion',
    'attendedMinutes',
    'workedMinutes',
    'breakMinutes',
    'scheduledMinutes',
    'withinScheduleMinutes',
    'outsideScheduleMinutes',
    'nightMinutes',
    'nonWorkingDayMinutes',
    'basis',
  ],
});
