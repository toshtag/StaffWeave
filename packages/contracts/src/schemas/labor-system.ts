import { arraySchema, objectSchema } from '../json-schema.js';
import { timestampSchema, uuidSchema } from './common.js';

/** 労働形態。ロードマップで扱うと決めた 4 つだけを持つ。 */
export const LABOR_SYSTEM_TYPES = ['normal', 'flex', 'discretionary', 'variable'] as const;

/** 清算期間の総枠を、法定に合わせるか所定に合わせるか。 */
export const SETTLEMENT_BASES = ['legal', 'prescribed'] as const;

export const laborSystemAssignmentSchema = objectSchema({
  description: '従業員へ期間で割り当てた労働形態。制度ごとの値は事業者が決める',
  properties: {
    id: uuidSchema,
    employeeId: uuidSchema,
    systemType: { type: 'string', enum: [...LABOR_SYSTEM_TYPES] },
    effectiveFrom: { type: 'string', format: 'date' },
    effectiveTo: { oneOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
    settlementMonths: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    settlementStartsOn: { oneOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
    settlementBasis: {
      oneOf: [{ type: 'string', enum: [...SETTLEMENT_BASES] }, { type: 'null' }],
    },
    settlementTotalMinutes: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    coreStartMinutes: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    coreEndMinutes: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    flexibleStartMinutes: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    flexibleEndMinutes: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    deemedMinutes: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    createdAt: timestampSchema,
  },
  required: [
    'id',
    'employeeId',
    'systemType',
    'effectiveFrom',
    'effectiveTo',
    'settlementMonths',
    'settlementStartsOn',
    'settlementBasis',
    'settlementTotalMinutes',
    'coreStartMinutes',
    'coreEndMinutes',
    'flexibleStartMinutes',
    'flexibleEndMinutes',
    'deemedMinutes',
    'createdAt',
  ],
});

export const laborSystemAssignmentListSchema = objectSchema({
  properties: { laborSystemAssignments: arraySchema(laborSystemAssignmentSchema) },
  required: ['laborSystemAssignments'],
});

export const createLaborSystemAssignmentRequestSchema = objectSchema({
  description:
    '労働形態を割り当てる。制度ごとに必要な値がそろっていなければ受け付けない。' +
    '製品は既定値を持たないため、揃っていない割当は計算のたびに未設定を返すだけになる',
  properties: {
    employeeId: uuidSchema,
    systemType: { type: 'string', enum: [...LABOR_SYSTEM_TYPES] },
    effectiveFrom: { type: 'string', format: 'date' },
    effectiveTo: { oneOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
    settlementMonths: { type: 'integer', minimum: 1, maximum: 12 },
    settlementStartsOn: { type: 'string', format: 'date' },
    settlementBasis: { type: 'string', enum: [...SETTLEMENT_BASES] },
    settlementTotalMinutes: { type: 'integer', minimum: 1, maximum: 1000000 },
    coreStartMinutes: { type: 'integer', minimum: 0, maximum: 1439 },
    coreEndMinutes: { type: 'integer', minimum: 1, maximum: 1440 },
    flexibleStartMinutes: { type: 'integer', minimum: 0, maximum: 1439 },
    flexibleEndMinutes: { type: 'integer', minimum: 1, maximum: 1440 },
    deemedMinutes: { type: 'integer', minimum: 0, maximum: 1440 },
  },
  required: ['employeeId', 'systemType', 'effectiveFrom'],
});

export const endLaborSystemAssignmentRequestSchema = objectSchema({
  description: '割当へ終了日を設定する。次の制度を始める前に、前の制度を閉じる',
  properties: { effectiveTo: { type: 'string', format: 'date' } },
  required: ['effectiveTo'],
});
