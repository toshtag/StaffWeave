import type {
  AdjustLeaveRequest,
  AnomalyList,
  ApiKeyList,
  ApiKeyRecord,
  CalculationRuleVersionList,
  CalculationRuleVersionRecord,
  ChangePasswordRequest,
  CloseMonthRequest,
  ClosingReadinessList,
  CorrectAttendanceRequest,
  CorrectAttendanceResponse,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  CreateCalculationRuleVersionRequest,
  CreateDepartmentRequest,
  CreateEmployeeRequest,
  CreateLaborSystemAssignmentRequest,
  CreateOrganizationRequest,
  CreateRequestTypeRequest,
  CreateSiteRequest,
  CreateWorkCategoryRequest,
  DailyRequestList,
  DailyRequestRecord,
  DecideDailyRequestRequest,
  Department,
  DepartmentList,
  DiscrepancyReport,
  Employee,
  EmployeeList,
  ErrorResponse,
  GrantLeaveRequest,
  GrantUserScopeRequest,
  LaborSystemAssignmentList,
  LaborSystemAssignmentRecord,
  LeaveBalanceList,
  LeaveLedgerEntryRecord,
  LeaveLedgerList,
  LeaveTypeSettingsList,
  LeaveTypeSettingsRecord,
  LoginRequest,
  MonthlyClosingRecord,
  MonthlySummaryList,
  Organization,
  OrganizationList,
  RecordAttendanceEventRequest,
  RecordAttendanceEventResponse,
  ReopenMonthRequest,
  RequestTypeList,
  RequestTypeRecord,
  ReverseLeaveEntryRequest,
  RevokedSessions,
  SessionList,
  SessionResponse,
  Site,
  SiteList,
  SubmitDailyRequestRequest,
  UpdateLeaveTypeRequest,
  UpdatePreferencesRequest,
  UpdateRequestTypeRequest,
  UserScopeList,
  UserScopeRecord,
  WorkCategoryList,
  WorkCategoryRecord,
  WorkDay,
} from '@staffweave/contracts';

/**
 * API 呼び出し。
 * 契約（@staffweave/contracts）の型だけを使い、応答の形をここで作らない。
 */

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init.headers,
    },
    credentials: 'same-origin',
  });

  if (response.status === 204) return undefined as T;

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = (body as ErrorResponse | null)?.error;
    throw new ApiRequestError(
      response.status,
      error?.code ?? 'unknown',
      error?.message ?? 'エラーが発生しました',
    );
  }

  return body as T;
}

export const api = {
  getSession: () => request<SessionResponse>('/auth/session'),
  login: (input: LoginRequest) =>
    request<SessionResponse>('/auth/login', { method: 'POST', body: JSON.stringify(input) }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  changePassword: (input: ChangePasswordRequest) =>
    request<void>('/auth/password', { method: 'POST', body: JSON.stringify(input) }),
  listSessions: () => request<SessionList>('/auth/sessions'),
  revokeSession: (sessionId: string) =>
    request<void>(`/auth/sessions/${sessionId}`, { method: 'DELETE' }),
  revokeOtherSessions: () =>
    request<RevokedSessions>('/auth/sessions/revoke-others', { method: 'POST' }),
  updatePreferences: (input: UpdatePreferencesRequest) =>
    request<SessionResponse>('/auth/preferences', {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  listOrganizations: () => request<OrganizationList>('/organizations'),
  listApiKeys: () => request<ApiKeyList>('/api-keys'),
  createApiKey: (input: CreateApiKeyRequest) =>
    request<CreateApiKeyResponse>('/api-keys', { method: 'POST', body: JSON.stringify(input) }),
  revokeApiKey: (apiKeyId: string) =>
    request<ApiKeyRecord>(`/api-keys/${apiKeyId}/revoke`, { method: 'POST' }),
  listAnomalies: (query: { from: string; to: string }) =>
    request<AnomalyList>(`/audit/anomalies?${new URLSearchParams(query).toString()}`),
  getTodayAttendance: () => request<WorkDay>('/attendance/today'),
  getDiscrepancyReport: (businessDate: string) =>
    request<DiscrepancyReport>(`/attendance/days/${businessDate}/discrepancies`),
  getAttendanceDay: (businessDate: string) => request<WorkDay>(`/attendance/days/${businessDate}`),
  correctAttendance: (input: CorrectAttendanceRequest) =>
    request<CorrectAttendanceResponse>('/attendance/corrections', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  submitDailyRequest: (input: SubmitDailyRequestRequest) =>
    request<DailyRequestRecord>('/attendance/requests', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  listDailyRequests: (query: { from: string; to: string; state?: string }) =>
    request<DailyRequestList>(
      `/attendance/requests?${new URLSearchParams(query as Record<string, string>).toString()}`,
    ),
  decideDailyRequest: (
    requestId: string,
    decision: 'approve' | 'return' | 'cancel',
    input: DecideDailyRequestRequest,
  ) =>
    request<DailyRequestRecord>(`/attendance/requests/${requestId}/${decision}`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  closeMonth: (input: CloseMonthRequest) =>
    request<MonthlyClosingRecord>('/monthly-closings/close', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  reopenMonth: (input: ReopenMonthRequest) =>
    request<MonthlyClosingRecord>('/monthly-closings/reopen', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  recordAttendanceEvent: (input: RecordAttendanceEventRequest) =>
    request<RecordAttendanceEventResponse>('/attendance/events', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // 設定の画面が使う経路。読み取りと作成を対にして並べる。
  createOrganization: (input: CreateOrganizationRequest) =>
    request<Organization>('/organizations', { method: 'POST', body: JSON.stringify(input) }),
  listSites: () => request<SiteList>('/sites'),
  createSite: (input: CreateSiteRequest) =>
    request<Site>('/sites', { method: 'POST', body: JSON.stringify(input) }),
  listDepartments: () => request<DepartmentList>('/departments'),
  createDepartment: (input: CreateDepartmentRequest) =>
    request<Department>('/departments', { method: 'POST', body: JSON.stringify(input) }),
  listEmployees: () => request<EmployeeList>('/employees'),
  createEmployee: (input: CreateEmployeeRequest) =>
    request<Employee>('/employees', { method: 'POST', body: JSON.stringify(input) }),
  listUserScopes: () => request<UserScopeList>('/user-scopes'),
  grantUserScope: (input: GrantUserScopeRequest) =>
    request<UserScopeRecord>('/user-scopes', { method: 'POST', body: JSON.stringify(input) }),
  listWorkCategories: () => request<WorkCategoryList>('/work-categories'),
  createWorkCategory: (input: CreateWorkCategoryRequest) =>
    request<WorkCategoryRecord>('/work-categories', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  listCalculationRuleVersions: () =>
    request<CalculationRuleVersionList>('/calculation-rule-versions'),
  createCalculationRuleVersion: (input: CreateCalculationRuleVersionRequest) =>
    request<CalculationRuleVersionRecord>('/calculation-rule-versions', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  listLaborSystemAssignments: (query: { employeeId?: string } = {}) =>
    request<LaborSystemAssignmentList>(
      `/labor-system-assignments?${new URLSearchParams(query as Record<string, string>).toString()}`,
    ),
  assignLaborSystem: (input: CreateLaborSystemAssignmentRequest) =>
    request<LaborSystemAssignmentRecord>('/labor-system-assignments', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  endLaborSystemAssignment: (assignmentId: string, effectiveTo: string) =>
    request<LaborSystemAssignmentRecord>(`/labor-system-assignments/${assignmentId}/end`, {
      method: 'POST',
      body: JSON.stringify({ effectiveTo }),
    }),
  listLeaveTypeSettings: () => request<LeaveTypeSettingsList>('/leave-type-settings'),
  updateLeaveType: (leaveTypeId: string, input: UpdateLeaveTypeRequest) =>
    request<LeaveTypeSettingsRecord>(`/leave-type-settings/${leaveTypeId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  listLeaveLedger: (query: { employeeId: string; leaveTypeId?: string }) =>
    request<LeaveLedgerList>(
      `/leave-ledger?${new URLSearchParams(query as Record<string, string>).toString()}`,
    ),
  listLeaveBalances: (query: { employeeId: string; asOf?: string }) =>
    request<LeaveBalanceList>(
      `/leave-balances?${new URLSearchParams(query as Record<string, string>).toString()}`,
    ),
  grantLeave: (input: GrantLeaveRequest) =>
    request<LeaveLedgerEntryRecord>('/leave-ledger/grants', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  adjustLeave: (input: AdjustLeaveRequest) =>
    request<LeaveLedgerEntryRecord>('/leave-ledger/adjustments', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  reverseLeaveEntry: (entryId: string, input: ReverseLeaveEntryRequest) =>
    request<LeaveLedgerEntryRecord>(`/leave-ledger/${entryId}/reverse`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  listMonthlySummaries: (query: { period: string; employeeId?: string }) =>
    request<MonthlySummaryList>(
      `/monthly-summaries?${new URLSearchParams(query as Record<string, string>).toString()}`,
    ),
  listClosingReadiness: (query: { period: string; employeeId?: string }) =>
    request<ClosingReadinessList>(
      `/monthly-closings/readiness?${new URLSearchParams(query as Record<string, string>).toString()}`,
    ),
  listRequestTypes: () => request<RequestTypeList>('/request-types'),
  createRequestType: (input: CreateRequestTypeRequest) =>
    request<RequestTypeRecord>('/request-types', { method: 'POST', body: JSON.stringify(input) }),
  updateRequestType: (requestTypeId: string, input: UpdateRequestTypeRequest) =>
    request<RequestTypeRecord>(`/request-types/${requestTypeId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
};
