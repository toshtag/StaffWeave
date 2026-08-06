import { arraySchema, objectSchema } from '../json-schema.js';
import { timestampSchema, uuidSchema } from './common.js';

/** 勤務区分の種別。法定休日と法定外休日を分けて持つ。 */
export const WORK_CATEGORY_TYPES = [
  'working_day',
  'non_working_day',
  'legal_holiday',
  'leave',
  'absence',
] as const;

/** 区間と区間の間（中抜け）の扱い。 */
export const GAP_TREATMENTS = ['non_working', 'break'] as const;

const fixedBreakSchema = objectSchema({
  description: '固定休憩。打刻が無くても引く時間帯（現地 0 時からの分数）',
  properties: {
    startMinutes: { type: 'integer', minimum: 0, maximum: 2878 },
    endMinutes: { type: 'integer', minimum: 1, maximum: 2879 },
  },
  required: ['startMinutes', 'endMinutes'],
});

const autoBreakSchema = objectSchema({
  description: '自動休憩。実労働が閾値を超えたら、その分だけ引く',
  properties: {
    thresholdMinutes: { type: 'integer', minimum: 1, maximum: 1440 },
    additionalMinutes: { type: 'integer', minimum: 1, maximum: 1440 },
  },
  required: ['thresholdMinutes', 'additionalMinutes'],
});

export const workCategorySchema = objectSchema({
  description: '版管理された勤務区分。同じ code で期間を分けて改定する',
  properties: {
    id: uuidSchema,
    code: { type: 'string' },
    internalName: { type: 'string', description: '管理者が探すための名前' },
    displayName: { type: 'string', description: '従業員へ見せる名前' },
    categoryType: { type: 'string', enum: [...WORK_CATEGORY_TYPES] },
    effectiveFrom: { type: 'string', format: 'date' },
    effectiveTo: { oneOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
    scheduledStartMinutes: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    scheduledEndMinutes: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    prescribedMinutes: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    deemedMinutes: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    nightStartMinutes: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    nightEndMinutes: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    gapTreatment: { type: 'string', enum: [...GAP_TREATMENTS] },
    shift: { type: 'boolean' },
    color: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    countsAsWorkingDay: { type: 'boolean' },
    fixedBreaks: arraySchema(fixedBreakSchema),
    autoBreaks: arraySchema(autoBreakSchema),
    createdAt: timestampSchema,
  },
  required: [
    'id',
    'code',
    'internalName',
    'displayName',
    'categoryType',
    'effectiveFrom',
    'effectiveTo',
    'scheduledStartMinutes',
    'scheduledEndMinutes',
    'prescribedMinutes',
    'deemedMinutes',
    'nightStartMinutes',
    'nightEndMinutes',
    'gapTreatment',
    'shift',
    'color',
    'countsAsWorkingDay',
    'fixedBreaks',
    'autoBreaks',
    'createdAt',
  ],
});

export const workCategoryListSchema = objectSchema({
  properties: { workCategories: arraySchema(workCategorySchema) },
  required: ['workCategories'],
});

export const createWorkCategoryRequestSchema = objectSchema({
  description: '勤務区分の版を作る。同じ code で期間が重なる版は作れない',
  properties: {
    code: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$' },
    internalName: { type: 'string', minLength: 1, maxLength: 100 },
    displayName: { type: 'string', minLength: 1, maxLength: 100 },
    categoryType: { type: 'string', enum: [...WORK_CATEGORY_TYPES] },
    effectiveFrom: { type: 'string', format: 'date' },
    effectiveTo: { oneOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
    scheduledStartMinutes: { type: 'integer', minimum: 0, maximum: 1439 },
    scheduledEndMinutes: { type: 'integer', minimum: 1, maximum: 2879 },
    prescribedMinutes: { type: 'integer', minimum: 0, maximum: 1440 },
    deemedMinutes: { type: 'integer', minimum: 0, maximum: 1440 },
    nightStartMinutes: { type: 'integer', minimum: 0, maximum: 1439 },
    nightEndMinutes: { type: 'integer', minimum: 0, maximum: 1439 },
    gapTreatment: { type: 'string', enum: [...GAP_TREATMENTS] },
    shift: { type: 'boolean' },
    color: { type: 'string', maxLength: 32 },
    countsAsWorkingDay: { type: 'boolean' },
    fixedBreaks: arraySchema(fixedBreakSchema),
    autoBreaks: arraySchema(autoBreakSchema),
  },
  required: ['code', 'internalName', 'displayName', 'categoryType', 'effectiveFrom'],
});

export const calculationRuleVersionSchema = objectSchema({
  description: '適用開始日つきの計算規則。過去の集計は当時の版のまま残る',
  properties: {
    id: uuidSchema,
    effectiveFrom: { type: 'string', format: 'date' },
    dayStartMinutes: { type: 'integer' },
    nightStartMinutes: { type: 'integer' },
    nightEndMinutes: { type: 'integer' },
    roundingMinutes: { type: 'integer' },
    roundingMode: { type: 'string', enum: ['none', 'down', 'nearest'] },
    dailyLegalMinutes: {
      oneOf: [{ type: 'integer' }, { type: 'null' }],
      description: '法定内と法定外を分ける 1 日の閾値。未設定なら法定の区分を計算しない',
    },
    weeklyLegalMinutes: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    weekStartsOn: { type: 'integer', description: '週の開始曜日。0 が日曜' },
    monthStartsOn: { type: 'integer', description: '月の集計の開始日' },
    createdAt: timestampSchema,
  },
  required: [
    'id',
    'effectiveFrom',
    'dayStartMinutes',
    'nightStartMinutes',
    'nightEndMinutes',
    'roundingMinutes',
    'roundingMode',
    'dailyLegalMinutes',
    'weeklyLegalMinutes',
    'weekStartsOn',
    'monthStartsOn',
    'createdAt',
  ],
});

export const calculationRuleVersionListSchema = objectSchema({
  properties: { calculationRuleVersions: arraySchema(calculationRuleVersionSchema) },
  required: ['calculationRuleVersions'],
});

export const createCalculationRuleVersionRequestSchema = objectSchema({
  description: '計算規則の版を作る。同じ適用開始日は 1 つだけ',
  properties: {
    effectiveFrom: { type: 'string', format: 'date' },
    dayStartMinutes: { type: 'integer', minimum: 0, maximum: 1439 },
    nightStartMinutes: { type: 'integer', minimum: 0, maximum: 1439 },
    nightEndMinutes: { type: 'integer', minimum: 0, maximum: 1439 },
    roundingMinutes: { type: 'integer', minimum: 0, maximum: 60 },
    roundingMode: { type: 'string', enum: ['none', 'down', 'nearest'] },
    dailyLegalMinutes: { type: 'integer', minimum: 1, maximum: 1440 },
    weeklyLegalMinutes: { type: 'integer', minimum: 1, maximum: 10080 },
    weekStartsOn: { type: 'integer', minimum: 0, maximum: 6 },
    monthStartsOn: { type: 'integer', minimum: 1, maximum: 28 },
  },
  required: [
    'effectiveFrom',
    'dayStartMinutes',
    'nightStartMinutes',
    'nightEndMinutes',
    'roundingMinutes',
    'roundingMode',
    'weekStartsOn',
    'monthStartsOn',
  ],
});
