import type { JsonSchema } from './json-schema.js';
import {
  closeMonthRequestSchema,
  dailyRequestListSchema,
  dailyRequestSchema,
  decideDailyRequestRequestSchema,
  listDailyRequestsQuerySchema,
  listMonthlyClosingsQuerySchema,
  monthlyClosingListSchema,
  monthlyClosingSchema,
  reopenMonthRequestSchema,
  submitDailyRequestRequestSchema,
} from './schemas/approval.js';
import {
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
import { businessDateSchema, errorResponseSchema, uuidSchema } from './schemas/common.js';
import {
  deviceEventRequestSchema,
  deviceEventResponseSchema,
  deviceListSchema,
  deviceReceiptListSchema,
  deviceSchema,
  enrollDeviceRequestSchema,
  enrollDeviceResponseSchema,
  registerDeviceRequestSchema,
  registerDeviceResponseSchema,
} from './schemas/device.js';
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
import {
  createWorkPatternRequestSchema,
  listWorkSchedulesQuerySchema,
  upsertWorkScheduleRequestSchema,
  workPatternListSchema,
  workPatternSchema,
  workScheduleListSchema,
  workScheduleSchema,
} from './schemas/schedule.js';

export type HttpMethod = 'get' | 'post' | 'patch' | 'put' | 'delete';

/** 認証方式。フェーズが進むにつれて API キーが加わる。 */
export type SecurityRequirement = 'public' | 'session' | 'deviceSignature';

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
  listWorkPatterns: {
    operationId: 'listWorkPatterns',
    method: 'get',
    path: '/work-patterns',
    summary: '勤務パターンの一覧を取得する',
    tags: ['schedule'],
    security: 'session',
    responses: [
      { status: 200, description: '勤務パターンの一覧', schema: workPatternListSchema },
      unauthorized,
      forbidden,
    ],
  },
  createWorkPattern: {
    operationId: 'createWorkPattern',
    method: 'post',
    path: '/work-patterns',
    summary: '勤務パターンを登録する',
    tags: ['schedule'],
    security: 'session',
    requestBody: createWorkPatternRequestSchema,
    responses: [
      { status: 201, description: '登録した勤務パターン', schema: workPatternSchema },
      invalidRequest,
      unauthorized,
      forbidden,
      conflict,
    ],
  },
  listWorkSchedules: {
    operationId: 'listWorkSchedules',
    method: 'get',
    path: '/work-schedules',
    summary: '指定した従業員・期間の勤務予定を取得する',
    tags: ['schedule'],
    security: 'session',
    query: listWorkSchedulesQuerySchema,
    responses: [
      { status: 200, description: '勤務予定の一覧', schema: workScheduleListSchema },
      invalidRequest,
      unauthorized,
      forbidden,
    ],
  },
  upsertWorkSchedule: {
    operationId: 'upsertWorkSchedule',
    method: 'put',
    path: '/work-schedules',
    summary: '勤務予定を登録・更新する',
    tags: ['schedule'],
    security: 'session',
    requestBody: upsertWorkScheduleRequestSchema,
    responses: [
      { status: 200, description: '登録した勤務予定', schema: workScheduleSchema },
      invalidRequest,
      unauthorized,
      forbidden,
      {
        status: 404,
        description: '従業員または勤務パターンが見つからない',
        schema: errorResponseSchema,
      },
    ],
  },
  submitDailyRequest: {
    operationId: 'submitDailyRequest',
    method: 'post',
    path: '/attendance/requests',
    summary: '自分の日次勤怠を申請する（差し戻された申請の再提出も同じ操作）',
    tags: ['approval'],
    security: 'session',
    requestBody: submitDailyRequestRequestSchema,
    responses: [
      { status: 200, description: '提出後の申請', schema: dailyRequestSchema },
      invalidRequest,
      unauthorized,
      forbidden,
      { status: 409, description: '現在の状態では提出できない', schema: errorResponseSchema },
    ],
  },
  listDailyRequests: {
    operationId: 'listDailyRequests',
    method: 'get',
    path: '/attendance/requests',
    summary: '日次申請を一覧する（従業員を指定しない場合は承認対象を返す）',
    tags: ['approval'],
    security: 'session',
    query: listDailyRequestsQuerySchema,
    responses: [
      { status: 200, description: '申請の一覧', schema: dailyRequestListSchema },
      invalidRequest,
      unauthorized,
      forbidden,
    ],
  },
  approveDailyRequest: {
    operationId: 'approveDailyRequest',
    method: 'post',
    path: '/attendance/requests/{requestId}/approve',
    summary: '日次申請を承認する',
    tags: ['approval'],
    security: 'session',
    pathParameters: [{ name: 'requestId', description: '申請の識別子', schema: uuidSchema }],
    requestBody: decideDailyRequestRequestSchema,
    responses: [
      { status: 200, description: '承認後の申請', schema: dailyRequestSchema },
      invalidRequest,
      unauthorized,
      forbidden,
      { status: 404, description: '申請が見つからない', schema: errorResponseSchema },
      { status: 409, description: '現在の状態では承認できない', schema: errorResponseSchema },
    ],
  },
  returnDailyRequest: {
    operationId: 'returnDailyRequest',
    method: 'post',
    path: '/attendance/requests/{requestId}/return',
    summary: '日次申請を差し戻す（理由のコメントが必須）',
    tags: ['approval'],
    security: 'session',
    pathParameters: [{ name: 'requestId', description: '申請の識別子', schema: uuidSchema }],
    requestBody: decideDailyRequestRequestSchema,
    responses: [
      { status: 200, description: '差し戻し後の申請', schema: dailyRequestSchema },
      invalidRequest,
      unauthorized,
      forbidden,
      { status: 404, description: '申請が見つからない', schema: errorResponseSchema },
      { status: 409, description: '現在の状態では差し戻せない', schema: errorResponseSchema },
    ],
  },
  cancelDailyRequest: {
    operationId: 'cancelDailyRequest',
    method: 'post',
    path: '/attendance/requests/{requestId}/cancel',
    summary: '自分の日次申請を取り消す',
    tags: ['approval'],
    security: 'session',
    pathParameters: [{ name: 'requestId', description: '申請の識別子', schema: uuidSchema }],
    requestBody: decideDailyRequestRequestSchema,
    responses: [
      { status: 200, description: '取消後の申請', schema: dailyRequestSchema },
      invalidRequest,
      unauthorized,
      forbidden,
      { status: 404, description: '申請が見つからない', schema: errorResponseSchema },
      { status: 409, description: '現在の状態では取り消せない', schema: errorResponseSchema },
    ],
  },
  listMonthlyClosings: {
    operationId: 'listMonthlyClosings',
    method: 'get',
    path: '/monthly-closings',
    summary: '月次締めの状態を一覧する',
    tags: ['approval'],
    security: 'session',
    query: listMonthlyClosingsQuerySchema,
    responses: [
      { status: 200, description: '締めの一覧', schema: monthlyClosingListSchema },
      invalidRequest,
      unauthorized,
      forbidden,
    ],
  },
  closeMonth: {
    operationId: 'closeMonth',
    method: 'post',
    path: '/monthly-closings/close',
    summary: '指定した従業員・期間の月次締めを行う',
    tags: ['approval'],
    security: 'session',
    requestBody: closeMonthRequestSchema,
    responses: [
      { status: 200, description: '締めた期間', schema: monthlyClosingSchema },
      invalidRequest,
      unauthorized,
      forbidden,
      {
        status: 409,
        description: '未承認の申請が残っている、またはすでに締め済み',
        schema: errorResponseSchema,
      },
    ],
  },
  reopenMonth: {
    operationId: 'reopenMonth',
    method: 'post',
    path: '/monthly-closings/reopen',
    summary: '月次締めを解除する（理由が必須）',
    tags: ['approval'],
    security: 'session',
    requestBody: reopenMonthRequestSchema,
    responses: [
      { status: 200, description: '解除した期間', schema: monthlyClosingSchema },
      invalidRequest,
      unauthorized,
      forbidden,
      {
        status: 409,
        description: '締められていない期間は解除できない',
        schema: errorResponseSchema,
      },
    ],
  },
  listDevices: {
    operationId: 'listDevices',
    method: 'get',
    path: '/devices',
    summary: '打刻端末の一覧を取得する',
    tags: ['device'],
    security: 'session',
    responses: [
      { status: 200, description: '端末の一覧', schema: deviceListSchema },
      unauthorized,
      forbidden,
    ],
  },
  registerDevice: {
    operationId: 'registerDevice',
    method: 'post',
    path: '/devices',
    summary: '端末の枠を作り、一度きりの登録トークンを発行する',
    tags: ['device'],
    security: 'session',
    requestBody: registerDeviceRequestSchema,
    responses: [
      { status: 201, description: '登録トークンつきの端末', schema: registerDeviceResponseSchema },
      invalidRequest,
      unauthorized,
      forbidden,
      { status: 404, description: '拠点が見つからない', schema: errorResponseSchema },
    ],
  },
  revokeDevice: {
    operationId: 'revokeDevice',
    method: 'post',
    path: '/devices/{deviceId}/revoke',
    summary: '端末を失効させ、以後の署名イベントを受け付けないようにする',
    tags: ['device'],
    security: 'session',
    pathParameters: [{ name: 'deviceId', description: '端末の識別子', schema: uuidSchema }],
    responses: [
      { status: 200, description: '失効した端末', schema: deviceSchema },
      unauthorized,
      forbidden,
      { status: 404, description: '端末が見つからない', schema: errorResponseSchema },
      { status: 409, description: 'すでに失効している', schema: errorResponseSchema },
    ],
  },
  listDeviceReceipts: {
    operationId: 'listDeviceReceipts',
    method: 'get',
    path: '/devices/{deviceId}/receipts',
    summary: '端末から届いたイベントの受信記録を取得する',
    tags: ['device'],
    security: 'session',
    pathParameters: [{ name: 'deviceId', description: '端末の識別子', schema: uuidSchema }],
    responses: [
      { status: 200, description: '受信記録', schema: deviceReceiptListSchema },
      unauthorized,
      forbidden,
      { status: 404, description: '端末が見つからない', schema: errorResponseSchema },
    ],
  },
  enrollDevice: {
    operationId: 'enrollDevice',
    method: 'post',
    path: '/device-agent/enroll',
    summary: 'Agent が登録トークンと引き換えに公開鍵を登録する',
    tags: ['device'],
    security: 'public',
    requestBody: enrollDeviceRequestSchema,
    responses: [
      { status: 200, description: '登録した端末', schema: enrollDeviceResponseSchema },
      invalidRequest,
      { status: 401, description: '登録トークンが一致しない', schema: errorResponseSchema },
      {
        status: 409,
        description: 'すでに登録済み、または失効している',
        schema: errorResponseSchema,
      },
    ],
  },
  recordDeviceEvent: {
    operationId: 'recordDeviceEvent',
    method: 'post',
    path: '/device-agent/events',
    summary: '端末が署名した打刻イベントを受け取る',
    tags: ['device'],
    security: 'deviceSignature',
    requestBody: deviceEventRequestSchema,
    responses: [
      { status: 201, description: '受理した打刻', schema: deviceEventResponseSchema },
      { status: 200, description: '同じ冪等キーの再送', schema: deviceEventResponseSchema },
      invalidRequest,
      {
        status: 401,
        description: '署名が一致しない、または端末が有効でない',
        schema: errorResponseSchema,
      },
      { status: 404, description: '従業員が見つからない', schema: errorResponseSchema },
      {
        status: 409,
        description: '現在の状態では受け付けられない打刻',
        schema: errorResponseSchema,
      },
    ],
  },
} as const satisfies Record<string, OperationContract>;

export type OperationId = keyof typeof operations;

export const operationList: readonly OperationContract[] = Object.values(operations);
