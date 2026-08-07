import { APPROVER_POLICIES, STAGED_REQUEST_STATES } from '@staffweave/domain';
import { arraySchema, objectSchema } from '../json-schema.js';
import {
  businessDateSchema,
  codeSchema,
  nameSchema,
  timestampSchema,
  uuidSchema,
} from './common.js';

/** 申請が何について出されたか。承認後の反映先が変わる。 */
export const REQUEST_CATEGORIES = [
  'leave',
  'overtime',
  'holiday_work',
  'attendance_correction',
  'other',
] as const;

export const REQUEST_DECISIONS = ['approved', 'returned'] as const;

export const requestTypeSchema = objectSchema({
  description: '組織が定義する申請種別',
  properties: {
    id: uuidSchema,
    code: codeSchema,
    name: nameSchema,
    category: { type: 'string', enum: [...REQUEST_CATEGORIES] },
    approvalSteps: { type: 'integer', description: '承認の段数。1〜4' },
    requiresReason: { type: 'boolean' },
    requiresLeaveType: { type: 'boolean' },
    requiresTimeRange: { type: 'boolean' },
    requiresOvertimeLimit: { type: 'boolean' },
    active: { type: 'boolean' },
    createdAt: timestampSchema,
  },
  required: [
    'id',
    'code',
    'name',
    'category',
    'approvalSteps',
    'requiresReason',
    'requiresLeaveType',
    'requiresTimeRange',
    'requiresOvertimeLimit',
    'active',
    'createdAt',
  ],
});

export const requestTypeListSchema = objectSchema({
  properties: { requestTypes: arraySchema(requestTypeSchema) },
  required: ['requestTypes'],
});

export const createRequestTypeRequestSchema = objectSchema({
  description: '申請種別を作る。休暇の区分では休暇種別の入力が要る',
  properties: {
    code: codeSchema,
    name: nameSchema,
    category: { type: 'string', enum: [...REQUEST_CATEGORIES] },
    approvalSteps: { type: 'integer', minimum: 1, maximum: 4 },
    requiresReason: { type: 'boolean' },
    requiresLeaveType: { type: 'boolean' },
    requiresTimeRange: { type: 'boolean' },
    requiresOvertimeLimit: { type: 'boolean' },
  },
  required: ['code', 'name', 'category', 'approvalSteps'],
});

export const updateRequestTypeRequestSchema = objectSchema({
  description: '申請種別を直す。' + '段数を変えても、すでに提出された申請は提出時の段数のまま進む',
  properties: {
    name: nameSchema,
    approvalSteps: { type: 'integer', minimum: 1, maximum: 4 },
    requiresReason: { type: 'boolean' },
    requiresLeaveType: { type: 'boolean' },
    requiresTimeRange: { type: 'boolean' },
    requiresOvertimeLimit: { type: 'boolean' },
    active: { type: 'boolean' },
  },
  required: [],
});

export const requestApprovalSchema = objectSchema({
  description: '段ごとの決裁。追記のみ',
  properties: {
    id: uuidSchema,
    step: { type: 'integer' },
    submission: { type: 'integer', description: '何回目の提出に対する決裁か' },
    decision: { type: 'string', enum: [...REQUEST_DECISIONS] },
    decidedByUserId: { oneOf: [uuidSchema, { type: 'null' }] },
    onBehalfOfUserId: {
      oneOf: [uuidSchema, { type: 'null' }],
      description: '代理で決裁したとき、本来の承認者',
    },
    comment: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    decidedAt: timestampSchema,
  },
  required: [
    'id',
    'step',
    'submission',
    'decision',
    'decidedByUserId',
    'onBehalfOfUserId',
    'comment',
    'decidedAt',
  ],
});

export const employeeRequestSchema = objectSchema({
  description: '従業員が出した申請',
  properties: {
    id: uuidSchema,
    requestTypeId: uuidSchema,
    employeeId: uuidSchema,
    state: { type: 'string', enum: [...STAGED_REQUEST_STATES] },
    totalSteps: { type: 'integer', description: '提出時に写した段数' },
    currentStep: { type: 'integer' },
    submissions: { type: 'integer' },
    businessDate: businessDateSchema,
    endsOn: { oneOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
    leaveTypeId: { oneOf: [uuidSchema, { type: 'null' }] },
    startMinutes: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    endMinutes: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    overtimeLimitMinutes: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    reason: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    submittedAt: timestampSchema,
    decidedAt: { oneOf: [timestampSchema, { type: 'null' }] },
    approvals: arraySchema(requestApprovalSchema),
  },
  required: [
    'id',
    'requestTypeId',
    'employeeId',
    'state',
    'totalSteps',
    'currentStep',
    'submissions',
    'businessDate',
    'endsOn',
    'leaveTypeId',
    'startMinutes',
    'endMinutes',
    'overtimeLimitMinutes',
    'reason',
    'submittedAt',
    'decidedAt',
    'approvals',
  ],
});

export const employeeRequestListSchema = objectSchema({
  properties: { requests: arraySchema(employeeRequestSchema) },
  required: ['requests'],
});

export const listEmployeeRequestsQuerySchema = objectSchema({
  properties: {
    employeeId: uuidSchema,
    state: { type: 'string', enum: [...STAGED_REQUEST_STATES] },
    from: businessDateSchema,
    to: businessDateSchema,
    awaitingMe: {
      type: 'string',
      enum: ['true'],
      description:
        'いまの段の決裁が自分の番のものだけを返す。承認の列として使う。' +
        '全部を返すと、自分の番ではない申請が混ざり、押しても断られる',
    },
  },
  required: [],
});

export const submitEmployeeRequestRequestSchema = objectSchema({
  description: '申請を出す。段数は、このときの申請種別の定義から写す',
  properties: {
    requestTypeId: uuidSchema,
    employeeId: uuidSchema,
    businessDate: businessDateSchema,
    endsOn: { type: 'string', format: 'date' },
    leaveTypeId: uuidSchema,
    startMinutes: { type: 'integer', minimum: 0, maximum: 2878 },
    endMinutes: { type: 'integer', minimum: 1, maximum: 2879 },
    overtimeLimitMinutes: { type: 'integer', minimum: 0, maximum: 2879 },
    reason: { type: 'string', minLength: 1, maxLength: 1000 },
  },
  required: ['requestTypeId', 'employeeId', 'businessDate'],
});

export const decideEmployeeRequestRequestSchema = objectSchema({
  description:
    '段を決裁する。' +
    '何段目・何回目の提出に対する決裁かを添えさせ、古い画面からの再送で先へ進めない',
  properties: {
    decision: { type: 'string', enum: [...REQUEST_DECISIONS] },
    step: { type: 'integer', minimum: 1, maximum: 4 },
    submission: { type: 'integer', minimum: 1 },
    onBehalfOfUserId: uuidSchema,
    comment: { type: 'string', minLength: 1, maxLength: 1000 },
  },
  required: ['decision', 'step', 'submission'],
});

export const resubmitEmployeeRequestRequestSchema = objectSchema({
  description: '差し戻された申請を出し直す。1 段目からやり直す',
  properties: {
    endsOn: { type: 'string', format: 'date' },
    leaveTypeId: uuidSchema,
    startMinutes: { type: 'integer', minimum: 0, maximum: 2878 },
    endMinutes: { type: 'integer', minimum: 1, maximum: 2879 },
    overtimeLimitMinutes: { type: 'integer', minimum: 0, maximum: 2879 },
    reason: { type: 'string', minLength: 1, maxLength: 1000 },
  },
  required: [],
});

export const approvalStepSchema = objectSchema({
  description: '段ごとの承認者。approverPolicy が user のときだけ利用者を指す',
  properties: {
    step: { type: 'integer', minimum: 1, maximum: 4 },
    approverUserId: { oneOf: [uuidSchema, { type: 'null' }] },
    approverPolicy: { type: 'string', enum: [...APPROVER_POLICIES] },
  },
  required: ['step', 'approverUserId', 'approverPolicy'],
});

export const approvalRouteSchema = objectSchema({
  properties: {
    requestTypeId: uuidSchema,
    steps: arraySchema(approvalStepSchema),
  },
  required: ['requestTypeId', 'steps'],
});

export const replaceApprovalRouteRequestSchema = objectSchema({
  description: '段ごとの承認者を置き換える。段を足し引きするたびに差分を取ると、消し忘れた段が残る',
  properties: { steps: arraySchema(approvalStepSchema) },
  required: ['steps'],
});

export const approvalDelegationSchema = objectSchema({
  description: '承認の委任。代理で決裁するには、任せた側の記録が要る',
  properties: {
    id: uuidSchema,
    fromUserId: uuidSchema,
    toUserId: uuidSchema,
    effectiveFrom: { type: 'string', format: 'date' },
    effectiveTo: { oneOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
    createdAt: timestampSchema,
  },
  required: ['id', 'fromUserId', 'toUserId', 'effectiveFrom', 'effectiveTo', 'createdAt'],
});

export const approvalDelegationListSchema = objectSchema({
  properties: { delegations: arraySchema(approvalDelegationSchema) },
  required: ['delegations'],
});

export const createApprovalDelegationRequestSchema = objectSchema({
  properties: {
    fromUserId: uuidSchema,
    toUserId: uuidSchema,
    effectiveFrom: { type: 'string', format: 'date' },
    effectiveTo: { oneOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
  },
  required: ['fromUserId', 'toUserId', 'effectiveFrom'],
});
