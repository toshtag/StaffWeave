import { LEAVE_GRANT_BASES } from '@staffweave/domain';
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
    grantBasis: {
      oneOf: [{ type: 'string', enum: [...LEAVE_GRANT_BASES] }, { type: 'null' }],
      description: '自動付与の基準。空なら自動付与しない',
    },
    autoGrantEnabled: {
      type: 'boolean',
      description: '定期実行で自動付与を動かすか。基準を置いただけでは動かさない',
    },
    autoGrantFrom: {
      oneOf: [{ type: 'string', format: 'date' }, { type: 'null' }],
      description: '自動付与を始める日。ここより前へは遡らない',
    },
    grantFixedMonth: {
      oneOf: [{ type: 'integer', minimum: 1, maximum: 12 }, { type: 'null' }],
      description: '一斉付与の基準日の月',
    },
    grantFixedDay: {
      oneOf: [{ type: 'integer', minimum: 1, maximum: 28 }, { type: 'null' }],
      description: '一斉付与の基準日の日。月末の無い年を作らないため 28 までにする',
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
    grantBasis: {
      oneOf: [{ type: 'string', enum: [...LEAVE_GRANT_BASES] }, { type: 'null' }],
    },
    autoGrantEnabled: { type: 'boolean' },
    autoGrantFrom: { oneOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
    grantFixedMonth: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    grantFixedDay: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
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
    'grantBasis',
    'autoGrantEnabled',
    'autoGrantFrom',
    'grantFixedMonth',
    'grantFixedDay',
    'active',
    'createdAt',
  ],
});

export const leaveTypeSettingsListSchema = objectSchema({
  properties: { leaveTypes: arraySchema(leaveTypeSettingsSchema) },
  required: ['leaveTypes'],
});

/**
 * 付与規則と一括付与。
 *
 * 何か月の勤続で何分を付与するかは事業者が決める。
 * 製品は法定の日数を既定値として持たない。規則を置かないかぎり 1 分も付与しない。
 */
export const leaveGrantRuleSchema = objectSchema({
  description: '勤続の段ごとの付与分数',
  properties: {
    id: uuidSchema,
    leaveTypeId: uuidSchema,
    serviceMonths: { type: 'integer', description: 'この勤続月数に達したら付与する' },
    minutes: { type: 'integer' },
    createdAt: timestampSchema,
  },
  required: ['id', 'leaveTypeId', 'serviceMonths', 'minutes', 'createdAt'],
});

export const leaveGrantRuleListSchema = objectSchema({
  properties: { leaveGrantRules: arraySchema(leaveGrantRuleSchema) },
  required: ['leaveGrantRules'],
});

export const createLeaveGrantRuleRequestSchema = objectSchema({
  properties: {
    leaveTypeId: uuidSchema,
    serviceMonths: { type: 'integer', minimum: 0, maximum: 600 },
    minutes: { type: 'integer', minimum: 1, maximum: 525600 },
  },
  required: ['leaveTypeId', 'serviceMonths', 'minutes'],
});

export const listLeaveGrantRulesQuerySchema = objectSchema({
  properties: { leaveTypeId: uuidSchema },
  required: [],
});

export const leaveGrantRunSchema = objectSchema({
  description: '自動付与を処理した日の記録。付与が 0 件の日も残す',
  properties: {
    leaveTypeId: uuidSchema,
    effectiveOn: { type: 'string', format: 'date' },
    ranAt: timestampSchema,
    grantedCount: { type: 'integer', minimum: 0 },
    skippedCount: { type: 'integer', minimum: 0 },
  },
  required: ['leaveTypeId', 'effectiveOn', 'ranAt', 'grantedCount', 'skippedCount'],
});

export const leaveGrantRunListSchema = objectSchema({
  properties: { runs: arraySchema(leaveGrantRunSchema) },
  required: ['runs'],
});

export const listLeaveGrantRunsQuerySchema = objectSchema({
  properties: { leaveTypeId: uuidSchema },
  required: ['leaveTypeId'],
});

export const leaveGrantPreviewSchema = objectSchema({
  description:
    '次に自動付与の対象になる日と人数。処理はしない。' +
    '見せずに動かすと、設定を間違えたことに付与された後で気付く',
  properties: {
    leaveTypeId: uuidSchema,
    effectiveOn: { oneOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
    grantedCount: { type: 'integer', minimum: 0 },
    skippedCount: { type: 'integer', minimum: 0 },
  },
  required: ['leaveTypeId', 'effectiveOn', 'grantedCount', 'skippedCount'],
});

export const runLeaveGrantsResponseSchema = objectSchema({
  description: '自動付与を動かした結果。処理した日ごとの件数',
  properties: { runs: arraySchema(leaveGrantRunSchema) },
  required: ['runs'],
});

export const grantLeaveInBulkRequestSchema = objectSchema({
  description: 'まとめて付与する。付与する分数は規則から決まり、規則が無ければ 1 分も付与しない',
  properties: {
    leaveTypeId: uuidSchema,
    basis: {
      type: 'string',
      enum: [...LEAVE_GRANT_BASES],
      description: 'hire_anniversary は入社記念日の人だけ、fixed_date は対象の全員',
    },
    effectiveOn: { type: 'string', format: 'date' },
    organizationId: uuidSchema,
  },
  required: ['leaveTypeId', 'basis', 'effectiveOn'],
});

export const grantLeaveInBulkResponseSchema = objectSchema({
  properties: {
    granted: arraySchema(
      objectSchema({
        properties: {
          employeeId: uuidSchema,
          minutes: { type: 'integer' },
          serviceMonths: { type: 'integer' },
        },
        required: ['employeeId', 'minutes', 'serviceMonths'],
      }),
    ),
    skipped: arraySchema(
      objectSchema({
        description: '付与しなかった相手と理由。黙って飛ばすと、漏れに気付けない',
        properties: {
          employeeId: uuidSchema,
          reason: {
            type: 'string',
            enum: ['no_hire_date', 'not_anniversary', 'no_rule_reached', 'already_granted'],
          },
        },
        required: ['employeeId', 'reason'],
      }),
    ),
  },
  required: ['granted', 'skipped'],
});

export const leaveExpirationSchema = objectSchema({
  description: 'ある日までに失効する付与と、その時点の残り',
  properties: {
    employeeId: uuidSchema,
    employeeNumber: { type: 'string' },
    leaveTypeId: uuidSchema,
    entryId: { type: 'string' },
    expiresOn: { type: 'string', format: 'date' },
    remainingMinutes: { type: 'integer' },
  },
  required: [
    'employeeId',
    'employeeNumber',
    'leaveTypeId',
    'entryId',
    'expiresOn',
    'remainingMinutes',
  ],
});

export const leaveExpirationListSchema = objectSchema({
  properties: { expirations: arraySchema(leaveExpirationSchema) },
  required: ['expirations'],
});

export const listLeaveExpirationsQuerySchema = objectSchema({
  properties: {
    asOf: { type: 'string', format: 'date' },
    through: { type: 'string', format: 'date', description: 'この日までに失効する分を出す' },
    employeeId: uuidSchema,
  },
  required: ['asOf', 'through'],
});

export const leaveRegisterSchema = objectSchema({
  description: '休暇管理簿の 1 行。台帳から組み立てる',
  properties: {
    employeeId: uuidSchema,
    employeeNumber: { type: 'string' },
    leaveTypeId: uuidSchema,
    from: { type: 'string', format: 'date' },
    to: { type: 'string', format: 'date' },
    openingMinutes: { type: 'integer' },
    grantedMinutes: { type: 'integer' },
    consumedMinutes: { type: 'integer' },
    expiredMinutes: { type: 'integer' },
    adjustedMinutes: { type: 'integer' },
    closingMinutes: { type: 'integer' },
  },
  required: [
    'employeeId',
    'employeeNumber',
    'leaveTypeId',
    'from',
    'to',
    'openingMinutes',
    'grantedMinutes',
    'consumedMinutes',
    'expiredMinutes',
    'adjustedMinutes',
    'closingMinutes',
  ],
});

export const leaveRegisterListSchema = objectSchema({
  properties: { register: arraySchema(leaveRegisterSchema) },
  required: ['register'],
});

export const listLeaveRegisterQuerySchema = objectSchema({
  properties: {
    from: { type: 'string', format: 'date' },
    to: { type: 'string', format: 'date' },
    employeeId: uuidSchema,
  },
  required: ['from', 'to'],
});
