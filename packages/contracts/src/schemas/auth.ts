import {
  DEVICE_BROWSER_VALUES,
  DEVICE_KIND_VALUES,
  DEVICE_OS_VALUES,
  MAXIMUM_PASSWORD_LENGTH,
  MINIMUM_PASSWORD_LENGTH,
} from '@staffweave/domain';
import { arraySchema, objectSchema } from '../json-schema.js';
import {
  localeSchema,
  nameSchema,
  ORGANIZATION_SCOPE_DESCRIPTION,
  roleSchema,
  timestampSchema,
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

/**
 * セッションを開いた端末の要約。
 *
 * 生の User-Agent と送信元アドレスは保存しないため、ここにも現れない。
 * 判別できなかった項目は null になる。表示に使う文字列は画面が言語ごとに決める。
 */
export const sessionDeviceSchema = objectSchema({
  description: 'セッションを開いた端末の系統。判別できない項目は null',
  properties: {
    os: { oneOf: [{ type: 'string', enum: [...DEVICE_OS_VALUES] }, { type: 'null' }] },
    browser: { oneOf: [{ type: 'string', enum: [...DEVICE_BROWSER_VALUES] }, { type: 'null' }] },
    kind: { oneOf: [{ type: 'string', enum: [...DEVICE_KIND_VALUES] }, { type: 'null' }] },
  },
  required: ['os', 'browser', 'kind'],
});

export const sessionSummarySchema = objectSchema({
  description: '自分のセッション 1 件',
  properties: {
    id: uuidSchema,
    /** いま要求を出しているセッションかどうか。画面が「この端末」を示すために使う。 */
    current: { type: 'boolean', description: 'いま要求を出しているセッションかどうか' },
    /** 端末を判別できなかったセッション（この列を持つ前に開いたものを含む）は null。 */
    device: { oneOf: [sessionDeviceSchema, { type: 'null' }] },
    issuedAt: timestampSchema,
    lastSeenAt: timestampSchema,
    expiresAt: timestampSchema,
  },
  required: ['id', 'current', 'device', 'issuedAt', 'lastSeenAt', 'expiresAt'],
});

export const sessionListSchema = objectSchema({
  description: '自分の、まだ有効なセッションの一覧',
  properties: {
    sessions: arraySchema(sessionSummarySchema),
  },
  required: ['sessions'],
});

export const revokedSessionsSchema = objectSchema({
  description: '失効させた件数',
  properties: {
    revoked: { type: 'integer', minimum: 0, description: 'この操作で失効させたセッションの件数' },
  },
  required: ['revoked'],
});

export const updatePreferencesRequestSchema = objectSchema({
  description: '利用者の表示設定',
  properties: {
    locale: localeSchema,
  },
  required: ['locale'],
});

export const resetUserPasswordRequestSchema = objectSchema({
  description:
    '管理者が利用者のパスワードを再設定する。' +
    '再設定した時点で、その利用者のセッションはすべて終わる',
  properties: {
    newPassword: { type: 'string', minLength: 12, maxLength: 200 },
  },
  required: ['newPassword'],
});

export const revokedUserSessionsSchema = objectSchema({
  description: '終わらせたセッションの数',
  properties: { revoked: { type: 'integer' } },
  required: ['revoked'],
});
