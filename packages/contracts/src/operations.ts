import type { JsonSchema } from './json-schema.js';
import {
  businessDateSchema,
  correctAttendanceRequestSchema,
  correctAttendanceResponseSchema,
  recordAttendanceEventRequestSchema,
  recordAttendanceEventResponseSchema,
  workDaySchema,
} from './schemas/attendance.js';
import {
  loginRequestSchema,
  sessionResponseSchema,
  updatePreferencesRequestSchema,
} from './schemas/auth.js';
import { errorResponseSchema } from './schemas/common.js';
import {
  createDepartmentRequestSchema,
  createEmployeeRequestSchema,
  createOrganizationRequestSchema,
  createSiteRequestSchema,
  departmentListSchema,
  departmentSchema,
  employeeListSchema,
  employeeSchema,
  organizationListSchema,
  organizationSchema,
  siteListSchema,
  siteSchema,
} from './schemas/organization.js';

export type HttpMethod = 'get' | 'post' | 'patch' | 'put' | 'delete';

/** 認証方式。フェーズが進むにつれて端末資格情報や API キーが加わる。 */
export type SecurityRequirement = 'public' | 'session';

export interface ResponseContract {
  status: number;
  description: string;
  schema?: JsonSchema;
}

export interface PathParameterContract {
  name: string;
  description: string;
  schema: JsonSchema;
}

export interface OperationContract {
  operationId: string;
  method: HttpMethod;
  /** OpenAPI 形式のパス（`/employees/{employeeId}`）。 */
  path: string;
  summary: string;
  tags: readonly string[];
  security: SecurityRequirement;
  pathParameters?: readonly PathParameterContract[];
  requestBody?: JsonSchema;
  query?: JsonSchema;
  responses: readonly ResponseContract[];
}

const unauthorized: ResponseContract = {
  status: 401,
  description: '認証されていない',
  schema: errorResponseSchema,
};
const forbidden: ResponseContract = {
  status: 403,
  description: '権限が不足している',
  schema: errorResponseSchema,
};
const invalidRequest: ResponseContract = {
  status: 400,
  description: '要求の内容が契約に合わない',
  schema: errorResponseSchema,
};
const conflict: ResponseContract = {
  status: 409,
  description: '既存のデータと衝突している',
  schema: errorResponseSchema,
};

export const operations = {
  login: {
    operationId: 'login',
    method: 'post',
    path: '/auth/login',
    summary: 'ローカル認証でログインし、セッションを開始する',
    tags: ['auth'],
    security: 'public',
    requestBody: loginRequestSchema,
    responses: [
      { status: 200, description: 'ログイン成功', schema: sessionResponseSchema },
      invalidRequest,
      { status: 401, description: '認証情報が一致しない', schema: errorResponseSchema },
    ],
  },
  logout: {
    operationId: 'logout',
    method: 'post',
    path: '/auth/logout',
    summary: '現在のセッションを失効させる',
    tags: ['auth'],
    security: 'public',
    responses: [{ status: 204, description: '失効済み' }],
  },
  getSession: {
    operationId: 'getSession',
    method: 'get',
    path: '/auth/session',
    summary: '現在のセッションと利用者情報を取得する',
    tags: ['auth'],
    security: 'session',
    responses: [
      { status: 200, description: '有効なセッション', schema: sessionResponseSchema },
      unauthorized,
    ],
  },
  updatePreferences: {
    operationId: 'updatePreferences',
    method: 'patch',
    path: '/auth/preferences',
    summary: '表示言語などの利用者設定を更新する',
    tags: ['auth'],
    security: 'session',
    requestBody: updatePreferencesRequestSchema,
    responses: [
      { status: 200, description: '更新後のセッション情報', schema: sessionResponseSchema },
      invalidRequest,
      unauthorized,
    ],
  },
  listOrganizations: {
    operationId: 'listOrganizations',
    method: 'get',
    path: '/organizations',
    summary: '組織の一覧を取得する',
    tags: ['organization'],
    security: 'session',
    responses: [
      { status: 200, description: '組織の一覧', schema: organizationListSchema },
      unauthorized,
      forbidden,
    ],
  },
  createOrganization: {
    operationId: 'createOrganization',
    method: 'post',
    path: '/organizations',
    summary: '組織を登録する',
    tags: ['organization'],
    security: 'session',
    requestBody: createOrganizationRequestSchema,
    responses: [
      { status: 201, description: '登録した組織', schema: organizationSchema },
      invalidRequest,
      unauthorized,
      forbidden,
      conflict,
    ],
  },
  listSites: {
    operationId: 'listSites',
    method: 'get',
    path: '/sites',
    summary: '拠点の一覧を取得する',
    tags: ['organization'],
    security: 'session',
    responses: [
      { status: 200, description: '拠点の一覧', schema: siteListSchema },
      unauthorized,
      forbidden,
    ],
  },
  createSite: {
    operationId: 'createSite',
    method: 'post',
    path: '/sites',
    summary: '拠点を登録する',
    tags: ['organization'],
    security: 'session',
    requestBody: createSiteRequestSchema,
    responses: [
      { status: 201, description: '登録した拠点', schema: siteSchema },
      invalidRequest,
      unauthorized,
      forbidden,
      conflict,
    ],
  },
  listDepartments: {
    operationId: 'listDepartments',
    method: 'get',
    path: '/departments',
    summary: '部門の一覧を取得する',
    tags: ['organization'],
    security: 'session',
    responses: [
      { status: 200, description: '部門の一覧', schema: departmentListSchema },
      unauthorized,
      forbidden,
    ],
  },
  createDepartment: {
    operationId: 'createDepartment',
    method: 'post',
    path: '/departments',
    summary: '部門を登録する',
    tags: ['organization'],
    security: 'session',
    requestBody: createDepartmentRequestSchema,
    responses: [
      { status: 201, description: '登録した部門', schema: departmentSchema },
      invalidRequest,
      unauthorized,
      forbidden,
      conflict,
    ],
  },
  listEmployees: {
    operationId: 'listEmployees',
    method: 'get',
    path: '/employees',
    summary: '従業員の一覧を取得する',
    tags: ['employee'],
    security: 'session',
    responses: [
      { status: 200, description: '従業員の一覧', schema: employeeListSchema },
      unauthorized,
      forbidden,
    ],
  },
  createEmployee: {
    operationId: 'createEmployee',
    method: 'post',
    path: '/employees',
    summary: '従業員を登録する（任意でログイン用の利用者も作成する）',
    tags: ['employee'],
    security: 'session',
    requestBody: createEmployeeRequestSchema,
    responses: [
      { status: 201, description: '登録した従業員', schema: employeeSchema },
      invalidRequest,
      unauthorized,
      forbidden,
      conflict,
    ],
  },
  recordAttendanceEvent: {
    operationId: 'recordAttendanceEvent',
    method: 'post',
    path: '/attendance/events',
    summary: '自分の打刻を記録する（同じ冪等キーの再送は 1 件だけ記録される）',
    tags: ['attendance'],
    security: 'session',
    requestBody: recordAttendanceEventRequestSchema,
    responses: [
      {
        status: 201,
        description: '記録した打刻とその日の状態',
        schema: recordAttendanceEventResponseSchema,
      },
      {
        status: 200,
        description: '同じ冪等キーの再送。既存の記録をそのまま返す',
        schema: recordAttendanceEventResponseSchema,
      },
      invalidRequest,
      unauthorized,
      forbidden,
      {
        status: 409,
        description: '現在の状態では受け付けられない打刻',
        schema: errorResponseSchema,
      },
    ],
  },
  getTodayAttendance: {
    operationId: 'getTodayAttendance',
    method: 'get',
    path: '/attendance/today',
    summary: '自分の当日の勤務状態と打刻を取得する',
    tags: ['attendance'],
    security: 'session',
    responses: [
      { status: 200, description: '当日の勤務状態', schema: workDaySchema },
      unauthorized,
      forbidden,
    ],
  },
  getAttendanceDay: {
    operationId: 'getAttendanceDay',
    method: 'get',
    path: '/attendance/days/{businessDate}',
    summary: '自分の指定した業務日の勤務状態と、修正を含むすべての記録を取得する',
    tags: ['attendance'],
    security: 'session',
    pathParameters: [
      { name: 'businessDate', description: '業務日（YYYY-MM-DD）', schema: businessDateSchema },
    ],
    responses: [
      { status: 200, description: '指定した業務日の勤務状態', schema: workDaySchema },
      invalidRequest,
      unauthorized,
      forbidden,
    ],
  },
  correctAttendance: {
    operationId: 'correctAttendance',
    method: 'post',
    path: '/attendance/corrections',
    summary: '自分の打刻を修正する（元の打刻は書き換えず、修正イベントを追加する）',
    tags: ['attendance'],
    security: 'session',
    requestBody: correctAttendanceRequestSchema,
    responses: [
      {
        status: 201,
        description: '記録した修正とその日の状態',
        schema: correctAttendanceResponseSchema,
      },
      {
        status: 200,
        description: '同じ冪等キーの再送。既存の記録をそのまま返す',
        schema: correctAttendanceResponseSchema,
      },
      invalidRequest,
      unauthorized,
      forbidden,
      { status: 404, description: '対象の打刻が見つからない', schema: errorResponseSchema },
    ],
  },
} as const satisfies Record<string, OperationContract>;

export type OperationId = keyof typeof operations;

export const operationList: readonly OperationContract[] = Object.values(operations);
