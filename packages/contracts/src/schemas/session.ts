import { DISCREPANCY_KINDS, SESSION_OBSERVATION_TYPES } from '@staffweave/domain';
import { arraySchema, objectSchema } from '../json-schema.js';
import { businessDateSchema, codeSchema, timestampSchema, uuidSchema } from './common.js';

export const sessionObservationSchema = objectSchema({
  description: 'PC セッションの観測。勤務時間そのものではなく、確認のための記録',
  properties: {
    id: uuidSchema,
    employeeId: uuidSchema,
    observationType: { type: 'string', enum: [...SESSION_OBSERVATION_TYPES] },
    occurredAt: timestampSchema,
    recordedAt: timestampSchema,
    businessDate: businessDateSchema,
    workstationName: { oneOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: [
    'id',
    'employeeId',
    'observationType',
    'occurredAt',
    'recordedAt',
    'businessDate',
    'workstationName',
  ],
});

export const sessionObservationListSchema = objectSchema({
  properties: { observations: arraySchema(sessionObservationSchema) },
  required: ['observations'],
});

export const recordSessionObservationsRequestSchema = objectSchema({
  description: '端末がまとめて送る PC セッションの観測',
  properties: {
    sequence: { type: 'integer', minimum: 1 },
    requestId: { type: 'string', minLength: 8, maxLength: 128 },
    workstationName: { type: 'string', minLength: 1, maxLength: 200 },
    observations: arraySchema(
      objectSchema({
        properties: {
          employeeNumber: codeSchema,
          observationType: { type: 'string', enum: [...SESSION_OBSERVATION_TYPES] },
          occurredAt: timestampSchema,
        },
        required: ['employeeNumber', 'observationType', 'occurredAt'],
      }),
    ),
  },
  required: ['sequence', 'requestId', 'workstationName', 'observations'],
});

export const recordSessionObservationsResponseSchema = objectSchema({
  properties: {
    outcome: { type: 'string', enum: ['accepted', 'duplicate'] },
    accepted: { type: 'integer', description: '記録した観測の件数' },
    skipped: { type: 'integer', description: '従業員が見つからず記録できなかった件数' },
  },
  required: ['outcome', 'accepted', 'skipped'],
});

export const discrepancySchema = objectSchema({
  description: '打刻と PC の観測の食い違い。根拠を添える',
  properties: {
    kind: { type: 'string', enum: [...DISCREPANCY_KINDS] },
    minutes: { type: 'integer' },
    evidence: objectSchema({
      properties: {
        from: { oneOf: [timestampSchema, { type: 'null' }] },
        to: { oneOf: [timestampSchema, { type: 'null' }] },
        note: { type: 'string' },
      },
      required: ['from', 'to', 'note'],
    }),
  },
  required: ['kind', 'minutes', 'evidence'],
});

export const discrepancyReportSchema = objectSchema({
  properties: {
    businessDate: businessDateSchema,
    employeeId: uuidSchema,
    discrepancies: arraySchema(discrepancySchema),
    observations: arraySchema(sessionObservationSchema),
  },
  required: ['businessDate', 'employeeId', 'discrepancies', 'observations'],
});

export const listSessionObservationsQuerySchema = objectSchema({
  properties: {
    employeeId: uuidSchema,
    from: businessDateSchema,
    to: businessDateSchema,
  },
  required: ['from', 'to'],
});
