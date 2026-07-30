import { arraySchema, objectSchema } from '../json-schema.js';
import {
  businessDateSchema,
  codeSchema,
  nameSchema,
  ORGANIZATION_SCOPE_DESCRIPTION,
  timestampSchema,
  uuidSchema,
} from './common.js';

export const assignmentContractSchema = objectSchema({
  description: '雇用元と受入組織のあいだの契約',
  properties: {
    id: uuidSchema,
    code: codeSchema,
    name: nameSchema,
    employerOrganizationId: uuidSchema,
    hostOrganizationId: uuidSchema,
    startsOn: businessDateSchema,
    endsOn: { oneOf: [businessDateSchema, { type: 'null' }] },
    createdAt: timestampSchema,
  },
  required: [
    'id',
    'code',
    'name',
    'employerOrganizationId',
    'hostOrganizationId',
    'startsOn',
    'endsOn',
    'createdAt',
  ],
});

export const assignmentContractListSchema = objectSchema({
  properties: { contracts: arraySchema(assignmentContractSchema) },
  required: ['contracts'],
});

export const createAssignmentContractRequestSchema = objectSchema({
  properties: {
    code: codeSchema,
    name: nameSchema,
    employerOrganizationId: uuidSchema,
    hostOrganizationId: uuidSchema,
    startsOn: businessDateSchema,
    endsOn: businessDateSchema,
  },
  required: ['code', 'name', 'employerOrganizationId', 'hostOrganizationId', 'startsOn'],
});

export const employeeAssignmentSchema = objectSchema({
  description: '従業員の配属。実際に働く組織と拠点を決める',
  properties: {
    id: uuidSchema,
    employeeId: uuidSchema,
    assignmentContractId: uuidSchema,
    workplaceSiteId: { oneOf: [uuidSchema, { type: 'null' }] },
    startsOn: businessDateSchema,
    endsOn: { oneOf: [businessDateSchema, { type: 'null' }] },
  },
  required: ['id', 'employeeId', 'assignmentContractId', 'workplaceSiteId', 'startsOn', 'endsOn'],
});

export const employeeAssignmentListSchema = objectSchema({
  properties: { assignments: arraySchema(employeeAssignmentSchema) },
  required: ['assignments'],
});

export const createEmployeeAssignmentRequestSchema = objectSchema({
  properties: {
    employeeId: uuidSchema,
    assignmentContractId: uuidSchema,
    workplaceSiteId: uuidSchema,
    startsOn: businessDateSchema,
    endsOn: businessDateSchema,
  },
  required: ['employeeId', 'assignmentContractId', 'startsOn'],
});

export const userScopeSchema = objectSchema({
  description: ORGANIZATION_SCOPE_DESCRIPTION,
  properties: {
    userId: uuidSchema,
    organizationId: uuidSchema,
    grantedAt: timestampSchema,
  },
  required: ['userId', 'organizationId', 'grantedAt'],
});

export const userScopeListSchema = objectSchema({
  properties: { scopes: arraySchema(userScopeSchema) },
  required: ['scopes'],
});

export const grantUserScopeRequestSchema = objectSchema({
  properties: { userId: uuidSchema, organizationId: uuidSchema },
  required: ['userId', 'organizationId'],
});
