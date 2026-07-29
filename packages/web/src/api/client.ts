import type {
  CloseMonthRequest,
  CorrectAttendanceRequest,
  CorrectAttendanceResponse,
  DailyRequestList,
  DailyRequestRecord,
  DecideDailyRequestRequest,
  DiscrepancyReport,
  ErrorResponse,
  LoginRequest,
  MonthlyClosingRecord,
  OrganizationList,
  RecordAttendanceEventRequest,
  RecordAttendanceEventResponse,
  ReopenMonthRequest,
  SessionResponse,
  SubmitDailyRequestRequest,
  UpdatePreferencesRequest,
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
  updatePreferences: (input: UpdatePreferencesRequest) =>
    request<SessionResponse>('/auth/preferences', {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  listOrganizations: () => request<OrganizationList>('/organizations'),
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
};
