import { arraySchema, objectSchema } from '../json-schema.js';
import { timestampSchema, uuidSchema } from './common.js';

/** 台帳へ積める記録の種類。 */
export const LEAVE_ENTRY_TYPES = ['grant', 'consume', 'expire', 'adjust', 'reverse'] as const;

export const leaveLedgerEntrySchema = objectSchema({
  description: '休暇台帳の 1 行。追記のみで、あとから書き換えない',
  properties: {
    id: uuidSchema,
    employeeId: uuidSchema,
    leaveTypeId: uuidSchema,
    entryType: { type: 'string', enum: [...LEAVE_ENTRY_TYPES] },
    minutes: { type: 'integer', description: '増える記録は正、減る記録は負' },
    effectiveOn: { type: 'string', format: 'date' },
    expiresOn: {
      oneOf: [{ type: 'string', format: 'date' }, { type: 'null' }],
      description: '付与の失効日。空なら失効しない',
    },
    reversesEntryId: {
      oneOf: [uuidSchema, { type: 'null' }],
      description: '取消のとき、打ち消す相手',
    },
    requestId: { oneOf: [uuidSchema, { type: 'null' }] },
    reason: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    createdAt: timestampSchema,
    createdByUserId: { oneOf: [uuidSchema, { type: 'null' }] },
  },
  required: [
    'id',
    'employeeId',
    'leaveTypeId',
    'entryType',
    'minutes',
    'effectiveOn',
    'expiresOn',
    'reversesEntryId',
    'requestId',
    'reason',
    'createdAt',
    'createdByUserId',
  ],
});

export const leaveLedgerListSchema = objectSchema({
  properties: { entries: arraySchema(leaveLedgerEntrySchema) },
  required: ['entries'],
});

export const leaveBalanceSchema = objectSchema({
  description: '台帳から組み立てた、ある日の残数',
  properties: {
    employeeId: uuidSchema,
    leaveTypeId: uuidSchema,
    asOf: { type: 'string', format: 'date' },
    availableMinutes: { type: 'integer' },
    expiredMinutes: { type: 'integer' },
    remaining: arraySchema(
      objectSchema({
        description: 'まだ消化していない付与の内訳。期限の近い順',
        properties: {
          entryId: { type: 'string' },
          minutes: { type: 'integer' },
          expiresOn: { oneOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
        },
        required: ['entryId', 'minutes', 'expiresOn'],
      }),
    ),
  },
  required: [
    'employeeId',
    'leaveTypeId',
    'asOf',
    'availableMinutes',
    'expiredMinutes',
    'remaining',
  ],
});

export const leaveBalanceListSchema = objectSchema({
  properties: { balances: arraySchema(leaveBalanceSchema) },
  required: ['balances'],
});

export const listLeaveBalancesQuerySchema = objectSchema({
  properties: {
    employeeId: uuidSchema,
    asOf: {
      type: 'string',
      format: 'date',
      description: 'この日の時点の残数。省略すると今日',
    },
  },
  required: ['employeeId'],
});

export const listLeaveLedgerQuerySchema = objectSchema({
  properties: { employeeId: uuidSchema, leaveTypeId: uuidSchema },
  required: ['employeeId'],
});

export const grantLeaveRequestSchema = objectSchema({
  description: '休暇を付与する。失効日は休暇種別の設定から決まる',
  properties: {
    employeeId: uuidSchema,
    leaveTypeId: uuidSchema,
    minutes: { type: 'integer', minimum: 1, maximum: 525600 },
    effectiveOn: { type: 'string', format: 'date' },
    expiresOn: { type: 'string', format: 'date' },
    reason: { type: 'string', minLength: 1, maxLength: 1000 },
  },
  required: ['employeeId', 'leaveTypeId', 'minutes', 'effectiveOn'],
});

export const adjustLeaveRequestSchema = objectSchema({
  description: '残数を手当てする。理由を必ず残す',
  properties: {
    employeeId: uuidSchema,
    leaveTypeId: uuidSchema,
    minutes: { type: 'integer', minimum: -525600, maximum: 525600 },
    effectiveOn: { type: 'string', format: 'date' },
    reason: { type: 'string', minLength: 1, maxLength: 1000 },
  },
  required: ['employeeId', 'leaveTypeId', 'minutes', 'effectiveOn', 'reason'],
});

export const reverseLeaveEntryRequestSchema = objectSchema({
  description: '記録を取り消す。元の行は消さず、打ち消す行を足す',
  properties: {
    reason: { type: 'string', minLength: 1, maxLength: 1000 },
  },
  required: ['reason'],
});

export const updateLeaveTypeRequestSchema = objectSchema({
  description:
    '休暇種別の取得単位と失効を決める。' +
    '製品は既定値を持たない。設定しないかぎり、単位も失効も適用しない',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    paid: { type: 'boolean' },
    unitMinutes: {
      oneOf: [{ type: 'integer', minimum: 1, maximum: 1440 }, { type: 'null' }],
      description: '取得できる最小の単位（分）',
    },
    dayMinutes: {
      oneOf: [{ type: 'integer', minimum: 1, maximum: 1440 }, { type: 'null' }],
      description: '1 日ぶんの分数。日数へ言い換えるときに使う',
    },
    expiresAfterMonths: {
      oneOf: [{ type: 'integer', minimum: 1, maximum: 240 }, { type: 'null' }],
      description: '付与から失効までの月数。空なら失効しない',
    },
    active: { type: 'boolean' },
  },
  required: [],
});

export const leaveTypeSettingsSchema = objectSchema({
  properties: {
    id: uuidSchema,
    code: { type: 'string' },
    name: { type: 'string' },
    paid: { type: 'boolean' },
    unitMinutes: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    dayMinutes: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    expiresAfterMonths: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    active: { type: 'boolean' },
    createdAt: timestampSchema,
  },
  required: [
    'id',
    'code',
    'name',
    'paid',
    'unitMinutes',
    'dayMinutes',
    'expiresAfterMonths',
    'active',
    'createdAt',
  ],
});

export const leaveTypeSettingsListSchema = objectSchema({
  properties: { leaveTypes: arraySchema(leaveTypeSettingsSchema) },
  required: ['leaveTypes'],
});
