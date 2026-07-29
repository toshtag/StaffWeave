/**
 * API の要求・応答を表す TypeScript 型。
 *
 * JSON Schema と手作業で対応させ、`types.test.ts` で実データが両方を満たすことを検証する。
 * 生成器を挟まないぶん、追加・変更時は必ず両方を更新すること。
 */
import type {
  AttendanceEventType,
  AttendanceSource,
  CalculationBasis,
  CorrectionAction,
  DayType,
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
  correctionAction: CorrectionAction | null;
  correctsEventId: string | null;
  correctionReason: string | null;
}

export interface BreakPeriodRecord {
  startedAt: string;
  endedAt: string | null;
}

export interface WorkPattern {
  id: string;
  code: string;
  name: string;
  startMinutes: number;
  endMinutes: number;
  breakMinutes: number;
  createdAt: string;
}

export interface WorkPatternList {
  workPatterns: WorkPattern[];
}

export interface CreateWorkPatternRequest {
  code: string;
  name: string;
  startMinutes: number;
  endMinutes: number;
  breakMinutes?: number;
}

export interface WorkScheduleRecord {
  employeeId: string;
  businessDate: string;
  workPatternId: string | null;
  dayType: DayType;
  startMinutes: number | null;
  endMinutes: number | null;
  breakMinutes: number;
}

export interface WorkScheduleList {
  workSchedules: WorkScheduleRecord[];
}

export interface UpsertWorkScheduleRequest {
  employeeId: string;
  businessDate: string;
  workPatternId?: string;
  dayType?: DayType;
  startMinutes?: number;
  endMinutes?: number;
  breakMinutes?: number;
}

export interface AttendanceCalculationRecord {
  version: number;
  calculatedAt: string;
  inputFingerprint: string;
  ruleVersion: string;
  attendedMinutes: number;
  workedMinutes: number;
  breakMinutes: number;
  scheduledMinutes: number;
  withinScheduleMinutes: number;
  outsideScheduleMinutes: number;
  nightMinutes: number;
  nonWorkingDayMinutes: number;
  basis: CalculationBasis;
}

export interface WorkDay {
  businessDate: string;
  employeeId: string;
  state: WorkDayState;
  firstClockInAt: string | null;
  lastClockOutAt: string | null;
  breaks: BreakPeriodRecord[];
  /** 修正を適用した後の有効な打刻。 */
  events: AttendanceEventRecord[];
  /** 記録されたすべてのイベント（修正を含む、追記順）。 */
  history: AttendanceEventRecord[];
  schedule: WorkScheduleRecord | null;
  calculation: AttendanceCalculationRecord | null;
}

export interface CorrectAttendanceRequest {
  action: CorrectionAction;
  targetEventId?: string;
  eventType?: AttendanceEventType;
  occurredAt?: string;
  businessDate?: string;
  reason: string;
  requestId: string;
}

export interface CorrectAttendanceResponse {
  event: AttendanceEventRecord;
  day: WorkDay;
  duplicate: boolean;
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
