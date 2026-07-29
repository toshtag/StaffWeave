/**
 * API の要求・応答を表す TypeScript 型。
 *
 * JSON Schema と手作業で対応させ、`types.test.ts` で実データが両方を満たすことを検証する。
 * 生成器を挟まないぶん、追加・変更時は必ず両方を更新すること。
 */
import type {
  AttendanceEventType,
  AttendanceSource,
  Locale,
  Role,
  WorkDayState,
} from '@staffweave/domain';

export interface ErrorDetail {
  field?: string;
  message: string;
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: ErrorDetail[];
  };
}

export interface WorkspaceSummary {
  id: string;
  slug: string;
  name: string;
  timeZone: string;
}

export interface EmployeeSummary {
  id: string;
  employeeNumber: string;
  displayName: string;
  organizationId: string;
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  locale: Locale;
  roles: Role[];
  permissions: string[];
}

export interface SessionResponse {
  workspace: WorkspaceSummary;
  user: SessionUser;
  employee: EmployeeSummary | null;
  expiresAt: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  workspaceSlug?: string;
}

export interface UpdatePreferencesRequest {
  locale: Locale;
}

export interface Organization {
  id: string;
  code: string;
  name: string;
  createdAt: string;
}

export interface OrganizationList {
  organizations: Organization[];
}

export interface CreateOrganizationRequest {
  code: string;
  name: string;
}

export interface Site {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  timeZone: string;
  createdAt: string;
}

export interface SiteList {
  sites: Site[];
}

export interface CreateSiteRequest {
  organizationId: string;
  code: string;
  name: string;
  timeZone?: string;
}

export interface Department {
  id: string;
  organizationId: string;
  parentDepartmentId: string | null;
  code: string;
  name: string;
  createdAt: string;
}

export interface DepartmentList {
  departments: Department[];
}

export interface CreateDepartmentRequest {
  organizationId: string;
  parentDepartmentId?: string;
  code: string;
  name: string;
}

export type EmployeeStatus = 'active' | 'suspended' | 'retired';

export interface Employee {
  id: string;
  organizationId: string;
  userId: string | null;
  employeeNumber: string;
  displayName: string;
  primarySiteId: string | null;
  primaryDepartmentId: string | null;
  hiredOn: string | null;
  status: EmployeeStatus;
  createdAt: string;
}

export interface EmployeeList {
  employees: Employee[];
}

export interface AttendanceEventRecord {
  id: string;
  employeeId: string;
  eventType: AttendanceEventType;
  occurredAt: string;
  recordedAt: string;
  businessDate: string;
  source: AttendanceSource;
}

export interface WorkDay {
  businessDate: string;
  employeeId: string;
  state: WorkDayState;
  firstClockInAt: string | null;
  lastClockOutAt: string | null;
  events: AttendanceEventRecord[];
}

export interface RecordAttendanceEventRequest {
  eventType: AttendanceEventType;
  occurredAt?: string;
  requestId: string;
}

export interface RecordAttendanceEventResponse {
  event: AttendanceEventRecord;
  day: WorkDay;
  duplicate: boolean;
}

export interface CreateEmployeeRequest {
  organizationId: string;
  employeeNumber: string;
  displayName: string;
  primarySiteId?: string;
  primaryDepartmentId?: string;
  hiredOn?: string;
  account?: {
    email: string;
    password: string;
    locale?: Locale;
    roles?: Role[];
  };
}
