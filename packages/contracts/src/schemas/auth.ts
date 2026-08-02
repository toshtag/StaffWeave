import { MAXIMUM_PASSWORD_LENGTH, MINIMUM_PASSWORD_LENGTH } from '@staffweave/domain';
import { arraySchema, objectSchema } from '../json-schema.js';
import {
  localeSchema,
  nameSchema,
  ORGANIZATION_SCOPE_DESCRIPTION,
  roleSchema,
  uuidSchema,
} from './common.js';

export const workspaceSummarySchema = objectSchema({
  properties: {
    id: uuidSchema,
    slug: { type: 'string' },
    name: nameSchema,
    timeZone: { type: 'string', description: '業務日の判定に使う IANA タイムゾーン名' },
  },
  required: ['id', 'slug', 'name', 'timeZone'],
});

export const employeeSummarySchema = objectSchema({
  properties: {
    id: uuidSchema,
    employeeNumber: { type: 'string' },
    displayName: nameSchema,
    organizationId: uuidSchema,
  },
  required: ['id', 'employeeNumber', 'displayName', 'organizationId'],
});

export const sessionUserSchema = objectSchema({
  properties: {
    id: uuidSchema,
    email: { type: 'string' },
    displayName: nameSchema,
    locale: localeSchema,
    roles: arraySchema(roleSchema),
    permissions: arraySchema({ type: 'string' }),
    organizationScopes: arraySchema(uuidSchema, ORGANIZATION_SCOPE_DESCRIPTION),
  },
  required: ['id', 'email', 'displayName', 'locale', 'roles', 'permissions', 'organizationScopes'],
});

export const sessionResponseSchema = objectSchema({
  properties: {
    workspace: workspaceSummarySchema,
    user: sessionUserSchema,
    /** 利用者に対応する従業員。管理者専用アカウントには存在しない。 */
    employee: { oneOf: [employeeSummarySchema, { type: 'null' }] },
    expiresAt: { type: 'string' },
  },
  required: ['workspace', 'user', 'employee', 'expiresAt'],
});

export const loginRequestSchema = objectSchema({
  description: 'ローカル認証のログイン要求',
  properties: {
    email: { type: 'string', minLength: 3, maxLength: 254 },
    password: {
      type: 'string',
      minLength: MINIMUM_PASSWORD_LENGTH,
      maxLength: MAXIMUM_PASSWORD_LENGTH,
    },
    workspaceSlug: {
      type: 'string',
      description: '省略時はサーバーの既定ワークスペースを使う',
    },
  },
  required: ['email', 'password'],
});

export const changePasswordRequestSchema = objectSchema({
  description: '本人によるパスワードの変更。現在のパスワードの確認を必須にする',
  properties: {
    currentPassword: {
      type: 'string',
      minLength: MINIMUM_PASSWORD_LENGTH,
      maxLength: MAXIMUM_PASSWORD_LENGTH,
    },
    newPassword: {
      type: 'string',
      minLength: MINIMUM_PASSWORD_LENGTH,
      maxLength: MAXIMUM_PASSWORD_LENGTH,
    },
  },
  required: ['currentPassword', 'newPassword'],
});

export const updatePreferencesRequestSchema = objectSchema({
  description: '利用者の表示設定',
  properties: {
    locale: localeSchema,
  },
  required: ['locale'],
});
