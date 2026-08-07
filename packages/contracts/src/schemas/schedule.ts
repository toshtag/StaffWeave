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
    workCategoryId: { oneOf: [uuidSchema, { type: 'null' }] },
    dayType: { type: 'string', enum: [...DAY_TYPES] },
    startMinutes: { oneOf: [startMinutesSchema, { type: 'null' }] },
    endMinutes: { oneOf: [endMinutesSchema, { type: 'null' }] },
    breakMinutes: breakMinutesSchema,
    leaveTypeId: { oneOf: [uuidSchema, { type: 'null' }] },
  },
  required: [
    'employeeId',
    'businessDate',
    'workPatternId',
    'workCategoryId',
    'dayType',
    'startMinutes',
    'endMinutes',
    'breakMinutes',
    'leaveTypeId',
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
    workCategoryId: { oneOf: [uuidSchema, { type: 'null' }] },
    dayType: { type: 'string', enum: [...DAY_TYPES] },
    startMinutes: startMinutesSchema,
    endMinutes: endMinutesSchema,
    breakMinutes: breakMinutesSchema,
    leaveTypeId: uuidSchema,
  },
  required: ['employeeId', 'businessDate'],
});

export const leaveTypeSchema = objectSchema({
  properties: {
    id: uuidSchema,
    code: codeSchema,
    name: nameSchema,
    paid: { type: 'boolean', description: '賃金の扱い。判断材料として持つだけで計算はしない' },
    createdAt: timestampSchema,
  },
  required: ['id', 'code', 'name', 'paid', 'createdAt'],
});

export const leaveTypeListSchema = objectSchema({
  properties: { leaveTypes: arraySchema(leaveTypeSchema) },
  required: ['leaveTypes'],
});

export const createLeaveTypeRequestSchema = objectSchema({
  properties: { code: codeSchema, name: nameSchema, paid: { type: 'boolean' } },
  required: ['code', 'name'],
});

export const workCycleDaySchema = objectSchema({
  properties: {
    position: { type: 'integer', minimum: 0 },
    dayType: { type: 'string', enum: ['working_day', 'non_working_day', 'public_holiday'] },
    workPatternId: { oneOf: [uuidSchema, { type: 'null' }] },
    workCategoryId: { oneOf: [uuidSchema, { type: 'null' }] },
  },
  required: ['position', 'dayType', 'workPatternId', 'workCategoryId'],
});

export const workCycleSchema = objectSchema({
  description: '勤務周期。長さの決まった並びを繰り返す。曜日を前提にしない',
  properties: {
    id: uuidSchema,
    code: codeSchema,
    name: nameSchema,
    cycleLength: { type: 'integer', minimum: 1, maximum: 366 },
    days: arraySchema(workCycleDaySchema),
    createdAt: timestampSchema,
  },
  required: ['id', 'code', 'name', 'cycleLength', 'days', 'createdAt'],
});

export const workCycleListSchema = objectSchema({
  properties: { workCycles: arraySchema(workCycleSchema) },
  required: ['workCycles'],
});

export const createWorkCycleRequestSchema = objectSchema({
  properties: {
    code: codeSchema,
    name: nameSchema,
    cycleLength: { type: 'integer', minimum: 1, maximum: 366 },
    days: arraySchema(
      objectSchema({
        properties: {
          position: { type: 'integer', minimum: 0 },
          dayType: { type: 'string', enum: ['working_day', 'non_working_day', 'public_holiday'] },
          workPatternId: uuidSchema,
          workCategoryId: uuidSchema,
        },
        required: ['position', 'dayType'],
      }),
    ),
  },
  required: ['code', 'name', 'cycleLength', 'days'],
});

export const employeeWorkCycleSchema = objectSchema({
  properties: {
    id: uuidSchema,
    employeeId: uuidSchema,
    workCycleId: uuidSchema,
    anchorDate: businessDateSchema,
    effectiveFrom: businessDateSchema,
    effectiveTo: { oneOf: [businessDateSchema, { type: 'null' }] },
  },
  required: ['id', 'employeeId', 'workCycleId', 'anchorDate', 'effectiveFrom', 'effectiveTo'],
});

export const employeeWorkCycleListSchema = objectSchema({
  properties: { assignments: arraySchema(employeeWorkCycleSchema) },
  required: ['assignments'],
});

export const assignWorkCycleRequestSchema = objectSchema({
  description: '従業員へ勤務周期を割り当てる。有効期間を持たせ、制度の変更を過去へ波及させない',
  properties: {
    employeeId: uuidSchema,
    workCycleId: uuidSchema,
    anchorDate: businessDateSchema,
    effectiveFrom: businessDateSchema,
    effectiveTo: businessDateSchema,
  },
  required: ['employeeId', 'workCycleId', 'anchorDate', 'effectiveFrom'],
});

export const endWorkCycleAssignmentRequestSchema = objectSchema({
  description:
    '勤務周期の割当に終了日を設定する。制度を切り替えるときに、次の割当と期間を重ねないため',
  properties: {
    effectiveTo: businessDateSchema,
  },
  required: ['effectiveTo'],
});

export const generateWorkSchedulesRequestSchema = objectSchema({
  description: '割り当てた勤務周期から、期間分の勤務予定を作る',
  properties: {
    employeeId: uuidSchema,
    from: businessDateSchema,
    to: businessDateSchema,
    /** すでにある予定を置き換えるかどうか。既定では手で直した予定を残す。 */
    overwrite: { type: 'boolean' },
  },
  required: ['employeeId', 'from', 'to'],
});

export const generateWorkSchedulesResponseSchema = objectSchema({
  properties: {
    created: { type: 'integer' },
    skipped: { type: 'integer', description: 'すでに予定があったため作らなかった日数' },
    uncovered: { type: 'integer', description: '割り当てが無く決められなかった日数' },
  },
  required: ['created', 'skipped', 'uncovered'],
});

export const listWorkSchedulesQuerySchema = objectSchema({
  properties: {
    employeeId: uuidSchema,
    from: businessDateSchema,
    to: businessDateSchema,
  },
  required: ['employeeId', 'from', 'to'],
});

/**
 * 割当は有効期間を持ち、従業員ごとに全期間を返す。
 * 予定の一覧と違って期間で絞らないため、別の契約にする。
 */
export const listEmployeeWorkCyclesQuerySchema = objectSchema({
  properties: { employeeId: uuidSchema },
  required: ['employeeId'],
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
    leaveMinutes: { type: 'integer' },
    absenceMinutes: { type: 'integer' },
    legalInsideOvertimeMinutes: {
      oneOf: [{ type: 'integer' }, { type: 'null' }],
      description: '法定内の時間外。1 日の閾値が未設定なら null',
    },
    legalOvertimeMinutes: {
      oneOf: [{ type: 'integer' }, { type: 'null' }],
      description: '法定時間外。1 日の閾値が未設定なら null',
    },
    legalHolidayMinutes: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    nonLegalHolidayMinutes: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    nightOvertimeMinutes: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    nightHolidayMinutes: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    lateMinutes: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    earlyLeaveMinutes: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    beforeScheduleMinutes: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    afterScheduleMinutes: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    deemedMinutes: {
      oneOf: [{ type: 'integer' }, { type: 'null' }],
      description: '給与向けのみなし労働。設定が無ければ null',
    },
    recognizedOvertimeMinutes: {
      oneOf: [{ type: 'integer' }, { type: 'null' }],
      description:
        '認定した所定外。承認しきった残業の上限時刻までに収まる、所定終業より後の実労働。' +
        '所定の時間帯が決まっていない日は null',
    },
    unapprovedOvertimeMinutes: {
      oneOf: [{ type: 'integer' }, { type: 'null' }],
      description: '認定の外に出た所定外。上限を超えた分と、承認の無い所定外',
    },
    approvedHolidayMinutes: {
      oneOf: [{ type: 'integer' }, { type: 'null' }],
      description: '承認のある休日労働',
    },
    unapprovedHolidayMinutes: {
      oneOf: [{ type: 'integer' }, { type: 'null' }],
      description: '承認の無い休日労働',
    },
    basis: objectSchema({
      properties: {
        ruleVersion: { type: 'string' },
        timeZone: { type: 'string' },
        dayType: { type: 'string', enum: [...DAY_TYPES] },
        segments: arraySchema(calculationSegmentSchema),
        steps: arraySchema(calculationStepSchema),
        incomplete: { type: 'boolean' },
        unconfigured: arraySchema(
          { type: 'string' },
          '設定が無いため計算しなかった区分。空でなければ、その区分は null になる',
        ),
        breakOrigins: arraySchema(
          objectSchema({
            properties: {
              origin: { type: 'string', enum: ['actual', 'fixed', 'automatic'] },
              minutes: { type: 'integer' },
              adopted: { type: 'boolean', description: '重なりで捨てた区間は false' },
            },
            required: ['origin', 'minutes', 'adopted'],
          }),
          '採用した休憩と、重なりで捨てた休憩',
        ),
      },
      required: [
        'ruleVersion',
        'timeZone',
        'dayType',
        'segments',
        'steps',
        'incomplete',
        'unconfigured',
        'breakOrigins',
      ],
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
    'leaveMinutes',
    'absenceMinutes',
    'basis',
  ],
});
