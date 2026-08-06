import { CLOSING_FINDING_KINDS } from '@staffweave/domain';
import { arraySchema, objectSchema } from '../json-schema.js';
import { businessDateSchema, timestampSchema, uuidSchema } from './common.js';

/**
 * 月次の集計と、締め前の確認。
 *
 * 法定の区分は、閾値が未設定なら `null` を返す。0 ではない。
 * 0 だと「計算した結果 0 分だった」と読めてしまい、未設定と区別がつかない。
 */
const nullableMinutes = { oneOf: [{ type: 'integer' }, { type: 'null' }] } as const;

const totalsProperties = {
  attendedMinutes: { type: 'integer' },
  workedMinutes: { type: 'integer' },
  breakMinutes: { type: 'integer' },
  scheduledMinutes: { type: 'integer' },
  withinScheduleMinutes: { type: 'integer' },
  outsideScheduleMinutes: { type: 'integer' },
  nightMinutes: { type: 'integer' },
  nonWorkingDayMinutes: { type: 'integer' },
  leaveMinutes: { type: 'integer' },
  absenceMinutes: { type: 'integer' },
  legalInsideOvertimeMinutes: nullableMinutes,
  legalOvertimeMinutes: nullableMinutes,
  legalHolidayMinutes: nullableMinutes,
  nonLegalHolidayMinutes: nullableMinutes,
  nightOvertimeMinutes: nullableMinutes,
  nightHolidayMinutes: nullableMinutes,
  lateMinutes: nullableMinutes,
  earlyLeaveMinutes: nullableMinutes,
  deemedMinutes: nullableMinutes,
  workedDays: { type: 'integer' },
  leaveDays: { type: 'integer' },
  countedDays: { type: 'integer' },
} as const;

const TOTALS_REQUIRED = Object.keys(totalsProperties);

export const monthlySnapshotSchema = objectSchema({
  description: '締めた時点で固めた集計。あとから日次を直しても、この値は動かない',
  properties: {
    sequence: { type: 'integer', description: '何回目の締めか' },
    closedAt: timestampSchema,
    closedByUserId: { oneOf: [uuidSchema, { type: 'null' }] },
    ...totalsProperties,
  },
  required: ['sequence', 'closedAt', 'closedByUserId', ...TOTALS_REQUIRED],
});

export const monthlySummarySchema = objectSchema({
  description: 'その月の集計。日次を足し合わせた、いまの値',
  properties: {
    employeeId: uuidSchema,
    employeeNumber: { type: 'string' },
    displayName: { type: 'string' },
    period: { type: 'string', format: 'date' },
    closingState: {
      oneOf: [{ type: 'string', enum: ['open', 'closed'] }, { type: 'null' }],
    },
    ...totalsProperties,
    snapshot: {
      oneOf: [monthlySnapshotSchema, { type: 'null' }],
      description: '締めたときの値。締めていなければ null',
    },
    /** 締めた値といまの値が食い違っているか。 */
    driftedFromSnapshot: { type: 'boolean' },
  },
  required: [
    'employeeId',
    'employeeNumber',
    'displayName',
    'period',
    'closingState',
    ...TOTALS_REQUIRED,
    'snapshot',
    'driftedFromSnapshot',
  ],
});

export const monthlySummaryListSchema = objectSchema({
  properties: { summaries: arraySchema(monthlySummarySchema) },
  required: ['summaries'],
});

export const listMonthlySummariesQuerySchema = objectSchema({
  properties: {
    employeeId: uuidSchema,
    period: { type: 'string', format: 'date', description: '対象月の 1 日' },
  },
  required: ['period'],
});

export const closingFindingSchema = objectSchema({
  description: '締める前に残っているもの',
  properties: {
    kind: { type: 'string', enum: [...CLOSING_FINDING_KINDS] },
    severity: { type: 'string', enum: ['blocking', 'advisory'] },
    businessDate: businessDateSchema,
  },
  required: ['kind', 'severity', 'businessDate'],
});

export const closingReadinessSchema = objectSchema({
  description: '締める前の確認。締めを止めるかどうかは運用が決める',
  properties: {
    employeeId: uuidSchema,
    period: { type: 'string', format: 'date' },
    findings: arraySchema(closingFindingSchema),
    /** 実務が止まるものが残っているか。 */
    blocked: { type: 'boolean' },
  },
  required: ['employeeId', 'period', 'findings', 'blocked'],
});

export const closingReadinessListSchema = objectSchema({
  properties: { readiness: arraySchema(closingReadinessSchema) },
  required: ['readiness'],
});

export const recalculateAttendanceRequestSchema = objectSchema({
  description:
    '日次の計算をやり直す。締めた月は動かさない。' +
    '設定を直したあと、過去の日へ反映するために使う',
  properties: {
    employeeId: uuidSchema,
    from: businessDateSchema,
    to: businessDateSchema,
  },
  required: ['employeeId', 'from', 'to'],
});

export const recalculateAttendanceResponseSchema = objectSchema({
  properties: {
    /** 見た日の数。 */
    examinedDays: { type: 'integer' },
    /** 新しい版を作った日の数。入力が変わらなければ作らない。 */
    recalculatedDays: { type: 'integer' },
    /** 締められていて動かさなかった日。 */
    skippedClosedDays: arraySchema(businessDateSchema),
  },
  required: ['examinedDays', 'recalculatedDays', 'skippedClosedDays'],
});
