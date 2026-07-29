import {
  DAILY_REQUEST_EVENTS,
  DAILY_REQUEST_STATES,
  MONTHLY_CLOSING_STATES,
} from '@staffweave/domain';
import { arraySchema, objectSchema } from '../json-schema.js';
import { businessDateSchema, timestampSchema, uuidSchema } from './common.js';

const commentSchema = { type: 'string', minLength: 1, maxLength: 1000 } as const;

export const requestTransitionSchema = objectSchema({
  description: '申請の状態が変わった記録。追記のみ',
  properties: {
    fromState: { type: 'string', enum: [...DAILY_REQUEST_STATES] },
    toState: { type: 'string', enum: [...DAILY_REQUEST_STATES] },
    event: { type: 'string', enum: [...DAILY_REQUEST_EVENTS] },
    actorUserId: { oneOf: [uuidSchema, { type: 'null' }] },
    comment: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    occurredAt: timestampSchema,
  },
  required: ['fromState', 'toState', 'event', 'actorUserId', 'comment', 'occurredAt'],
});

export const dailyRequestSchema = objectSchema({
  description: '一日分の勤怠に対する申請',
  properties: {
    id: uuidSchema,
    employeeId: uuidSchema,
    businessDate: businessDateSchema,
    state: { type: 'string', enum: [...DAILY_REQUEST_STATES] },
    submissions: { type: 'integer' },
    returns: { type: 'integer' },
    submittedAt: { oneOf: [timestampSchema, { type: 'null' }] },
    decidedAt: { oneOf: [timestampSchema, { type: 'null' }] },
    decidedByUserId: { oneOf: [uuidSchema, { type: 'null' }] },
    transitions: arraySchema(requestTransitionSchema),
  },
  required: [
    'id',
    'employeeId',
    'businessDate',
    'state',
    'submissions',
    'returns',
    'submittedAt',
    'decidedAt',
    'decidedByUserId',
    'transitions',
  ],
});

export const dailyRequestListSchema = objectSchema({
  properties: { requests: arraySchema(dailyRequestSchema) },
  required: ['requests'],
});

export const submitDailyRequestRequestSchema = objectSchema({
  properties: {
    businessDate: businessDateSchema,
    comment: commentSchema,
  },
  required: ['businessDate'],
});

export const decideDailyRequestRequestSchema = objectSchema({
  description: '承認・差し戻し・取消。差し戻しではコメントを必須とする',
  properties: { comment: commentSchema },
  required: [],
});

export const listDailyRequestsQuerySchema = objectSchema({
  properties: {
    employeeId: uuidSchema,
    from: businessDateSchema,
    to: businessDateSchema,
    state: { type: 'string', enum: [...DAILY_REQUEST_STATES] },
  },
  required: ['from', 'to'],
});

export const periodSchema = {
  type: 'string',
  pattern: '^\\d{4}-\\d{2}-01$',
  description: '締め期間。その月の 1 日で表す（2026-04-01）',
} as const;

export const monthlyClosingSchema = objectSchema({
  properties: {
    employeeId: uuidSchema,
    period: periodSchema,
    state: { type: 'string', enum: [...MONTHLY_CLOSING_STATES] },
    reopens: { type: 'integer' },
    closedAt: { oneOf: [timestampSchema, { type: 'null' }] },
    closedByUserId: { oneOf: [uuidSchema, { type: 'null' }] },
    reopenedAt: { oneOf: [timestampSchema, { type: 'null' }] },
    reopenReason: { oneOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: [
    'employeeId',
    'period',
    'state',
    'reopens',
    'closedAt',
    'closedByUserId',
    'reopenedAt',
    'reopenReason',
  ],
});

export const monthlyClosingListSchema = objectSchema({
  properties: { closings: arraySchema(monthlyClosingSchema) },
  required: ['closings'],
});

export const closeMonthRequestSchema = objectSchema({
  properties: { employeeId: uuidSchema, period: periodSchema },
  required: ['employeeId', 'period'],
});

export const reopenMonthRequestSchema = objectSchema({
  description: '締めの解除。理由を必須とし、記録に残す',
  properties: {
    employeeId: uuidSchema,
    period: periodSchema,
    reason: { type: 'string', minLength: 2, maxLength: 500 },
  },
  required: ['employeeId', 'period', 'reason'],
});

export const listMonthlyClosingsQuerySchema = objectSchema({
  properties: {
    employeeId: uuidSchema,
    from: periodSchema,
    to: periodSchema,
  },
  required: ['from', 'to'],
});
