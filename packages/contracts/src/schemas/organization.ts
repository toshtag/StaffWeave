import { MAXIMUM_PASSWORD_LENGTH, MINIMUM_PASSWORD_LENGTH } from '@staffweave/domain';
import { arraySchema, objectSchema } from '../json-schema.js';
import {
  codeSchema,
  localeSchema,
  nameSchema,
  roleSchema,
  timestampSchema,
  uuidSchema,
} from './common.js';

export const organizationSchema = objectSchema({
  properties: {
    id: uuidSchema,
    code: codeSchema,
    name: nameSchema,
    createdAt: timestampSchema,
  },
  required: ['id', 'code', 'name', 'createdAt'],
});

export const organizationListSchema = objectSchema({
  properties: { organizations: arraySchema(organizationSchema) },
  required: ['organizations'],
});

export const createOrganizationRequestSchema = objectSchema({
  properties: { code: codeSchema, name: nameSchema },
  required: ['code', 'name'],
});

export const siteSchema = objectSchema({
  properties: {
    id: uuidSchema,
    organizationId: uuidSchema,
    code: codeSchema,
    name: nameSchema,
    timeZone: { type: 'string' },
    createdAt: timestampSchema,
  },
  required: ['id', 'organizationId', 'code', 'name', 'timeZone', 'createdAt'],
});

export const siteListSchema = objectSchema({
  properties: { sites: arraySchema(siteSchema) },
  required: ['sites'],
});

export const createSiteRequestSchema = objectSchema({
  properties: {
    organizationId: uuidSchema,
    code: codeSchema,
    name: nameSchema,
    timeZone: {
      type: 'string',
      description: '省略時はワークスペースのタイムゾーンを使う',
    },
  },
  required: ['organizationId', 'code', 'name'],
});

export const departmentSchema = objectSchema({
  properties: {
    id: uuidSchema,
    organizationId: uuidSchema,
    parentDepartmentId: { oneOf: [uuidSchema, { type: 'null' }] },
    code: codeSchema,
    name: nameSchema,
    createdAt: timestampSchema,
  },
  required: ['id', 'organizationId', 'parentDepartmentId', 'code', 'name', 'createdAt'],
});

export const departmentListSchema = objectSchema({
  properties: { departments: arraySchema(departmentSchema) },
  required: ['departments'],
});

export const createDepartmentRequestSchema = objectSchema({
  properties: {
    organizationId: uuidSchema,
    parentDepartmentId: uuidSchema,
    code: codeSchema,
    name: nameSchema,
  },
  required: ['organizationId', 'code', 'name'],
});

export const employeeSchema = objectSchema({
  properties: {
    id: uuidSchema,
    organizationId: uuidSchema,
    userId: { oneOf: [uuidSchema, { type: 'null' }] },
    employeeNumber: codeSchema,
    displayName: nameSchema,
    primarySiteId: { oneOf: [uuidSchema, { type: 'null' }] },
    primaryDepartmentId: { oneOf: [uuidSchema, { type: 'null' }] },
    hiredOn: { oneOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
    status: { type: 'string', enum: ['active', 'suspended', 'retired'] },
    createdAt: timestampSchema,
  },
  required: [
    'id',
    'organizationId',
    'userId',
    'employeeNumber',
    'displayName',
    'primarySiteId',
    'primaryDepartmentId',
    'hiredOn',
    'status',
    'createdAt',
  ],
});

export const employeeListSchema = objectSchema({
  properties: { employees: arraySchema(employeeSchema) },
  required: ['employees'],
});

export const createEmployeeRequestSchema = objectSchema({
  properties: {
    organizationId: uuidSchema,
    employeeNumber: codeSchema,
    displayName: nameSchema,
    primarySiteId: uuidSchema,
    primaryDepartmentId: uuidSchema,
    hiredOn: { type: 'string', format: 'date' },
    /** 併せてログイン用の利用者を作る場合に指定する。 */
    account: objectSchema({
      properties: {
        email: { type: 'string', minLength: 3, maxLength: 254 },
        password: {
          type: 'string',
          minLength: MINIMUM_PASSWORD_LENGTH,
          maxLength: MAXIMUM_PASSWORD_LENGTH,
        },
        locale: localeSchema,
        roles: arraySchema(roleSchema),
      },
      required: ['email', 'password'],
    }),
  },
  required: ['organizationId', 'employeeNumber', 'displayName'],
});
