import type {
  ErrorResponse,
  LoginRequest,
  OrganizationList,
  SessionResponse,
  UpdatePreferencesRequest,
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
};
