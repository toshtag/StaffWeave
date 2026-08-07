/**
 * API の要求・応答を表す TypeScript 型。
 *
 * JSON Schema と手作業で対応させ、`contracts.test.ts` で実データが両方を満たすことを検証する。
 * 生成器を挟まないぶん、追加・変更時は必ず両方を更新すること。
 */
import type {
  AnomalyKind,
  AnomalySeverity,
  ApiScope,
  AttendanceEventType,
  AttendanceSource,
  CalculationBasis,
  ClosingFindingKind,
  CorrectionAction,
  DailyRequestEventType,
  DailyRequestState,
  DayType,
  DeviceBrowser,
  DeviceKind,
  DeviceOs,
  DeviceState,
  Discrepancy,
  Locale,
  MonthlyClosingState,
  Permission,
  Role,
  SessionObservationType,
  WebhookEventType,
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
  /** ロールから導いた権限。画面はこれを見て操作を出し分ける。 */
  permissions: Permission[];
  /**
   * 閲覧対象として明示的に与えられた組織。
   * 空配列は管理対象の組織がないことを表す。全体の閲覧可否はロールが決める。
   */
  organizationScopes: string[];
}

export interface SessionResponse {
  workspace: WorkspaceSummary;
  user: SessionUser;
  employee: EmployeeSummary | null;
  expiresAt: string;
}

/**
 * セッションを開いた端末の系統。
 * 生の User-Agent と送信元アドレスは保存しないため、ここにも現れない。
 */
export interface SessionDevice {
  os: DeviceOs | null;
  browser: DeviceBrowser | null;
  kind: DeviceKind | null;
}

export interface SessionSummary {
  id: string;
  /** いま要求を出しているセッションかどうか。 */
  current: boolean;
  /** 端末を判別できなかったセッションは null。 */
  device: SessionDevice | null;
  issuedAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export interface SessionList {
  sessions: SessionSummary[];
}

export interface RevokedSessions {
  revoked: number;
}

export interface LoginRequest {
  email: string;
  password: string;
  workspaceSlug?: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
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

/** 出勤から退勤までのひと続き。中抜けや分割シフトでは同じ日に複数ある。 */
export interface WorkSessionRecord {
  startedAt: string;
  endedAt: string | null;
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
  leaveTypeId: string | null;
}

export interface LeaveTypeRecord {
  id: string;
  code: string;
  name: string;
  paid: boolean;
  createdAt: string;
}

export interface CreateLeaveTypeRequest {
  code: string;
  name: string;
  paid?: boolean;
}

export interface WorkCycleDayRecord {
  position: number;
  dayType: 'working_day' | 'non_working_day' | 'public_holiday';
  workPatternId: string | null;
}

export interface WorkCycleRecord {
  id: string;
  code: string;
  name: string;
  cycleLength: number;
  days: WorkCycleDayRecord[];
  createdAt: string;
}

export interface CreateWorkCycleRequest {
  code: string;
  name: string;
  cycleLength: number;
  days: { position: number; dayType: WorkCycleDayRecord['dayType']; workPatternId?: string }[];
}

export interface EmployeeWorkCycleRecord {
  id: string;
  employeeId: string;
  workCycleId: string;
  anchorDate: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface EmployeeWorkCycleList {
  assignments: EmployeeWorkCycleRecord[];
}

export interface AssignWorkCycleRequest {
  employeeId: string;
  workCycleId: string;
  anchorDate: string;
  effectiveFrom: string;
  effectiveTo?: string;
}

export interface EndWorkCycleAssignmentRequest {
  effectiveTo: string;
}

export interface GenerateWorkSchedulesRequest {
  employeeId: string;
  from: string;
  to: string;
  overwrite?: boolean;
}

export interface GenerateWorkSchedulesResponse {
  created: number;
  skipped: number;
  uncovered: number;
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
  leaveTypeId?: string;
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
  leaveMinutes: number;
  absenceMinutes: number;
  /** 法定内の時間外。1 日の閾値が未設定なら null。 */
  legalInsideOvertimeMinutes: number | null;
  /** 法定時間外。1 日の閾値が未設定なら null。 */
  legalOvertimeMinutes: number | null;
  legalHolidayMinutes: number | null;
  nonLegalHolidayMinutes: number | null;
  nightOvertimeMinutes: number | null;
  nightHolidayMinutes: number | null;
  lateMinutes: number | null;
  earlyLeaveMinutes: number | null;
  beforeScheduleMinutes: number | null;
  afterScheduleMinutes: number | null;
  /** 給与向けのみなし労働。設定が無ければ null。 */
  deemedMinutes: number | null;
  /**
   * 認定した所定外。承認しきった残業の上限時刻までに収まる、所定終業より後の実労働。
   * 所定の時間帯が決まっていない日は null。
   */
  recognizedOvertimeMinutes: number | null;
  /** 認定の外に出た所定外。上限を超えた分と、承認の無い所定外。 */
  unapprovedOvertimeMinutes: number | null;
  /** 承認のある休日労働。 */
  approvedHolidayMinutes: number | null;
  /** 承認の無い休日労働。 */
  unapprovedHolidayMinutes: number | null;
  basis: CalculationBasis;
}

export interface WorkDay {
  businessDate: string;
  employeeId: string;
  /** 時刻を読む基準になる拠点の IANA タイムゾーン。 */
  timeZone: string;
  state: WorkDayState;
  firstClockInAt: string | null;
  lastClockOutAt: string | null;
  sessions: WorkSessionRecord[];
  breaks: BreakPeriodRecord[];
  /** 修正を適用した後の有効な打刻。 */
  events: AttendanceEventRecord[];
  /** 記録されたすべてのイベント（修正を含む、追記順）。 */
  history: AttendanceEventRecord[];
  schedule: WorkScheduleRecord | null;
  calculation: AttendanceCalculationRecord | null;
  request: DailyRequestRecord | null;
  closing: MonthlyClosingRecord | null;
  /** 申請中・承認済み・締め済みでないため、打刻や修正を受け付けられるか。 */
  editable: boolean;
}

export interface RequestTransitionRecord {
  fromState: DailyRequestState;
  toState: DailyRequestState;
  event: DailyRequestEventType;
  actorUserId: string | null;
  comment: string | null;
  occurredAt: string;
}

export interface DailyRequestRecord {
  id: string;
  employeeId: string;
  businessDate: string;
  state: DailyRequestState;
  submissions: number;
  returns: number;
  submittedAt: string | null;
  decidedAt: string | null;
  decidedByUserId: string | null;
  transitions: RequestTransitionRecord[];
}

export interface DailyRequestList {
  requests: DailyRequestRecord[];
}

export interface SubmitDailyRequestRequest {
  businessDate: string;
  comment?: string;
}

export interface DecideDailyRequestRequest {
  comment?: string;
}

export interface MonthlyClosingRecord {
  employeeId: string;
  period: string;
  state: MonthlyClosingState;
  reopens: number;
  closedAt: string | null;
  closedByUserId: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
}

export interface MonthlyClosingList {
  closings: MonthlyClosingRecord[];
}

export interface CloseMonthRequest {
  employeeId: string;
  period: string;
}

export interface ReopenMonthRequest {
  employeeId: string;
  period: string;
  reason: string;
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
  /** 画面からの打刻の入力元。端末や修正はこの経路では指定できない。 */
  source?: 'web' | 'mobile';
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

export interface DeviceRecord {
  id: string;
  siteId: string | null;
  name: string;
  state: DeviceState;
  enrollments: number;
  lastSequence: number;
  enrolledAt: string | null;
  revokedAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface DeviceList {
  devices: DeviceRecord[];
}

export interface RegisterDeviceRequest {
  name: string;
  siteId?: string;
  /** 有効時間（分）。既定は 15 分。 */
  expiresInMinutes?: number;
}

export interface RegisterDeviceResponse {
  device: DeviceRecord;
  /** 登録トークンはこの応答でしか返らない。 */
  enrollmentToken: string;
  /** この時刻を過ぎた登録トークンは使えない。 */
  enrollmentTokenExpiresAt: string;
}

export interface EnrollDeviceRequest {
  enrollmentToken: string;
  publicKey: string;
}

export interface EnrollDeviceResponse {
  deviceId: string;
  workspaceSlug: string;
  device: DeviceRecord;
  /** IC カードの指紋を計算するための鍵。設定されていなければ返らない。 */
  cardFingerprintKey?: string;
}

export interface DeviceEventRequest {
  sequence: number;
  requestId: string;
  employeeNumber: string;
  eventType: AttendanceEventType;
  occurredAt: string;
  deviceTime: string;
}

export interface DeviceEventResponse {
  outcome: 'accepted' | 'duplicate';
  attendanceEventId: string | null;
  businessDate: string;
  sequenceStep: number;
  clockSkewSeconds: number;
}

export interface DeviceReceiptRecord {
  deviceId: string;
  sequence: number;
  requestId: string;
  receivedAt: string;
  deviceTime: string;
  clockSkewSeconds: number;
  sequenceStep: number;
  attendanceEventId: string | null;
  businessDate: string | null;
  outcome: 'accepted' | 'duplicate' | 'rejected';
}

export interface DeviceReceiptList {
  receipts: DeviceReceiptRecord[];
}

export interface CardCredentialRecord {
  id: string;
  employeeId: string;
  label: string | null;
  state: 'active' | 'revoked';
  registeredAt: string;
  revokedAt: string | null;
}

export interface CardCredentialList {
  cardCredentials: CardCredentialRecord[];
}

export interface CreateCardRegistrationRequest {
  employeeId: string;
  label?: string;
  expiresInMinutes?: number;
}

export interface CreateCardRegistrationResponse {
  registrationToken: string;
  expiresAt: string;
}

export interface RegisterCardRequest {
  registrationToken: string;
  cardFingerprint: string;
}

export interface CardEventRequest {
  sequence: number;
  requestId: string;
  cardFingerprint: string;
  eventType?: AttendanceEventType;
  occurredAt: string;
  deviceTime: string;
}

export interface CardEventResponse {
  outcome: 'accepted' | 'duplicate';
  attendanceEventId: string | null;
  eventType: AttendanceEventType;
  businessDate: string;
  employeeDisplayName: string;
  sequenceStep: number;
  clockSkewSeconds: number;
}

export interface SessionObservationRecord {
  id: string;
  employeeId: string;
  observationType: SessionObservationType;
  occurredAt: string;
  recordedAt: string;
  businessDate: string;
  workstationName: string | null;
}

export interface SessionObservationList {
  observations: SessionObservationRecord[];
}

export interface RecordSessionObservationsRequest {
  sequence: number;
  requestId: string;
  workstationName: string;
  observations: {
    employeeNumber: string;
    observationType: SessionObservationType;
    occurredAt: string;
  }[];
}

export interface RecordSessionObservationsResponse {
  outcome: 'accepted' | 'duplicate';
  accepted: number;
  skipped: number;
}

export interface DiscrepancyReport {
  businessDate: string;
  employeeId: string;
  discrepancies: Discrepancy[];
  observations: SessionObservationRecord[];
}

export interface AssignmentContractRecord {
  id: string;
  code: string;
  name: string;
  employerOrganizationId: string;
  hostOrganizationId: string;
  startsOn: string;
  endsOn: string | null;
  createdAt: string;
}

export interface CreateAssignmentContractRequest {
  code: string;
  name: string;
  employerOrganizationId: string;
  hostOrganizationId: string;
  startsOn: string;
  endsOn?: string;
}

export interface EmployeeAssignmentRecord {
  id: string;
  employeeId: string;
  assignmentContractId: string;
  workplaceSiteId: string | null;
  startsOn: string;
  endsOn: string | null;
}

export interface EmployeeAssignmentList {
  assignments: EmployeeAssignmentRecord[];
}

export interface EndEmployeeAssignmentRequest {
  endsOn: string;
}

export interface CreateEmployeeAssignmentRequest {
  employeeId: string;
  assignmentContractId: string;
  workplaceSiteId?: string;
  startsOn: string;
  endsOn?: string;
}

export interface UserScopeRecord {
  userId: string;
  organizationId: string;
  grantedAt: string;
}

export interface UserScopeList {
  scopes: UserScopeRecord[];
}

export interface GrantUserScopeRequest {
  userId: string;
  organizationId: string;
}

export interface AnomalyRecord {
  kind: AnomalyKind;
  severity: AnomalySeverity;
  summary: string;
  employeeId: string | null;
  businessDate: string | null;
  deviceId: string | null;
  detectedAt: string;
  evidence: Record<string, unknown>;
}

export interface AnomalyList {
  anomalies: AnomalyRecord[];
}

export interface AuditLogRecord {
  id: string;
  occurredAt: string;
  actorKind: 'user' | 'device' | 'system';
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  summary: string;
  detail: Record<string, unknown>;
}

export interface AuditLogList {
  logs: AuditLogRecord[];
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ApiKeyList {
  apiKeys: ApiKeyRecord[];
}

export interface CreateApiKeyRequest {
  name: string;
  scopes: ApiScope[];
}

export interface CreateApiKeyResponse {
  apiKey: ApiKeyRecord;
  /** この応答でしか返らない。 */
  secret: string;
}

export interface WebhookEndpointRecord {
  id: string;
  name: string;
  url: string;
  eventTypes: WebhookEventType[];
  active: boolean;
  createdAt: string;
}

export interface CreateWebhookEndpointResponse {
  endpoint: WebhookEndpointRecord;
  /** 署名の検証に使う秘密。この応答でしか返らない。 */
  secret: string;
}

export interface ImportResult {
  created: number;
  problems: { line: number; message: string }[];
}

/** 勤務区分の種別。 */
export type WorkCategoryType =
  | 'working_day'
  | 'non_working_day'
  | 'legal_holiday'
  | 'leave'
  | 'absence';

/** 区間と区間の間（中抜け）の扱い。 */
export type GapTreatment = 'non_working' | 'break';

export interface WorkCategoryFixedBreak {
  startMinutes: number;
  endMinutes: number;
}

export interface WorkCategoryAutoBreak {
  thresholdMinutes: number;
  additionalMinutes: number;
}

/** 版管理された勤務区分。同じ code で期間を分けて改定する。 */
export interface WorkCategoryRecord {
  id: string;
  code: string;
  internalName: string;
  displayName: string;
  categoryType: WorkCategoryType;
  effectiveFrom: string;
  effectiveTo: string | null;
  scheduledStartMinutes: number | null;
  scheduledEndMinutes: number | null;
  prescribedMinutes: number | null;
  deemedMinutes: number | null;
  nightStartMinutes: number | null;
  nightEndMinutes: number | null;
  gapTreatment: GapTreatment;
  shift: boolean;
  color: string | null;
  countsAsWorkingDay: boolean;
  fixedBreaks: WorkCategoryFixedBreak[];
  autoBreaks: WorkCategoryAutoBreak[];
  createdAt: string;
}

export interface CreateWorkCategoryRequest {
  code: string;
  internalName: string;
  displayName: string;
  categoryType: WorkCategoryType;
  effectiveFrom: string;
  effectiveTo?: string | null;
  scheduledStartMinutes?: number;
  scheduledEndMinutes?: number;
  prescribedMinutes?: number;
  deemedMinutes?: number;
  nightStartMinutes?: number;
  nightEndMinutes?: number;
  gapTreatment?: GapTreatment;
  shift?: boolean;
  color?: string;
  countsAsWorkingDay?: boolean;
  fixedBreaks?: WorkCategoryFixedBreak[];
  autoBreaks?: WorkCategoryAutoBreak[];
}

export interface WorkCategoryList {
  workCategories: WorkCategoryRecord[];
}

/** 適用開始日つきの計算規則。 */
export interface CalculationRuleVersionRecord {
  id: string;
  effectiveFrom: string;
  dayStartMinutes: number;
  nightStartMinutes: number;
  nightEndMinutes: number;
  roundingMinutes: number;
  roundingMode: 'none' | 'down' | 'nearest';
  /** 法定内と法定外を分ける 1 日の閾値。未設定なら法定の区分を計算しない。 */
  dailyLegalMinutes: number | null;
  weeklyLegalMinutes: number | null;
  weekStartsOn: number;
  monthStartsOn: number;
  createdAt: string;
}

export interface CalculationRuleVersionList {
  calculationRuleVersions: CalculationRuleVersionRecord[];
}

export interface CreateCalculationRuleVersionRequest {
  effectiveFrom: string;
  dayStartMinutes: number;
  nightStartMinutes: number;
  nightEndMinutes: number;
  roundingMinutes: number;
  roundingMode: 'none' | 'down' | 'nearest';
  dailyLegalMinutes?: number;
  weeklyLegalMinutes?: number;
  weekStartsOn: number;
  monthStartsOn: number;
}

export interface CalculationRuleVersionList {
  calculationRuleVersions: CalculationRuleVersionRecord[];
}

/** 労働形態。 */
export type LaborSystemType = 'normal' | 'flex' | 'discretionary' | 'variable';

/** 清算期間の総枠を、法定に合わせるか所定に合わせるか。 */
export type SettlementBasis = 'legal' | 'prescribed';

export interface LaborSystemAssignmentRecord {
  id: string;
  employeeId: string;
  systemType: LaborSystemType;
  effectiveFrom: string;
  effectiveTo: string | null;
  settlementMonths: number | null;
  settlementStartsOn: string | null;
  settlementBasis: SettlementBasis | null;
  settlementTotalMinutes: number | null;
  coreStartMinutes: number | null;
  coreEndMinutes: number | null;
  flexibleStartMinutes: number | null;
  flexibleEndMinutes: number | null;
  deemedMinutes: number | null;
  createdAt: string;
}

export interface CreateLaborSystemAssignmentRequest {
  employeeId: string;
  systemType: LaborSystemType;
  effectiveFrom: string;
  effectiveTo?: string | null;
  settlementMonths?: number;
  settlementStartsOn?: string;
  settlementBasis?: SettlementBasis;
  settlementTotalMinutes?: number;
  coreStartMinutes?: number;
  coreEndMinutes?: number;
  flexibleStartMinutes?: number;
  flexibleEndMinutes?: number;
  deemedMinutes?: number;
}

export interface EndLaborSystemAssignmentRequest {
  effectiveTo: string;
}

export interface LaborSystemAssignmentList {
  laborSystemAssignments: LaborSystemAssignmentRecord[];
}

/** 休暇台帳へ積める記録の種類。 */
export type LeaveEntryTypeValue = 'grant' | 'consume' | 'expire' | 'adjust' | 'reverse';

/** 休暇台帳の 1 行。追記のみで、あとから書き換えない。 */
export interface LeaveLedgerEntryRecord {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  entryType: LeaveEntryTypeValue;
  /** 増える記録は正、減る記録は負。 */
  minutes: number;
  effectiveOn: string;
  expiresOn: string | null;
  reversesEntryId: string | null;
  requestId: string | null;
  reason: string | null;
  createdAt: string;
  createdByUserId: string | null;
}

export interface LeaveLedgerList {
  entries: LeaveLedgerEntryRecord[];
}

/** 台帳から組み立てた、ある日の残数。 */
export interface LeaveBalanceRecord {
  employeeId: string;
  leaveTypeId: string;
  asOf: string;
  availableMinutes: number;
  expiredMinutes: number;
  remaining: { entryId: string; minutes: number; expiresOn: string | null }[];
}

export interface LeaveBalanceList {
  balances: LeaveBalanceRecord[];
}

export interface GrantLeaveRequest {
  employeeId: string;
  leaveTypeId: string;
  minutes: number;
  effectiveOn: string;
  expiresOn?: string;
  reason?: string;
}

export interface AdjustLeaveRequest {
  employeeId: string;
  leaveTypeId: string;
  minutes: number;
  effectiveOn: string;
  reason: string;
}

export interface ReverseLeaveEntryRequest {
  reason: string;
}

/** 取得の単位と失効を持つ休暇種別。設定しないかぎり、どちらも適用しない。 */
export interface LeaveTypeSettingsRecord {
  id: string;
  code: string;
  name: string;
  paid: boolean;
  unitMinutes: number | null;
  dayMinutes: number | null;
  expiresAfterMonths: number | null;
  active: boolean;
  createdAt: string;
}

export interface LeaveTypeSettingsList {
  leaveTypes: LeaveTypeSettingsRecord[];
}

export interface UpdateLeaveTypeRequest {
  name?: string;
  paid?: boolean;
  unitMinutes?: number | null;
  dayMinutes?: number | null;
  expiresAfterMonths?: number | null;
  active?: boolean;
}

/** 申請が何について出されたか。承認後の反映先が変わる。 */
export type RequestCategory =
  | 'leave'
  | 'overtime'
  | 'holiday_work'
  | 'attendance_correction'
  | 'other';

export type RequestDecision = 'approved' | 'returned';

/** 組織が定義する申請種別。 */
export interface RequestTypeRecord {
  id: string;
  code: string;
  name: string;
  category: RequestCategory;
  approvalSteps: number;
  requiresReason: boolean;
  requiresLeaveType: boolean;
  requiresTimeRange: boolean;
  requiresOvertimeLimit: boolean;
  active: boolean;
  createdAt: string;
}

export interface RequestTypeList {
  requestTypes: RequestTypeRecord[];
}

export interface CreateRequestTypeRequest {
  code: string;
  name: string;
  category: RequestCategory;
  approvalSteps: number;
  requiresReason?: boolean;
  requiresLeaveType?: boolean;
  requiresTimeRange?: boolean;
  requiresOvertimeLimit?: boolean;
}

export interface UpdateRequestTypeRequest {
  name?: string;
  approvalSteps?: number;
  requiresReason?: boolean;
  requiresLeaveType?: boolean;
  requiresTimeRange?: boolean;
  requiresOvertimeLimit?: boolean;
  active?: boolean;
}

/** 段ごとの決裁。追記のみ。 */
export interface RequestApprovalRecord {
  id: string;
  step: number;
  submission: number;
  decision: RequestDecision;
  decidedByUserId: string | null;
  onBehalfOfUserId: string | null;
  comment: string | null;
  decidedAt: string;
}

/** 従業員が出した申請。 */
export interface EmployeeRequestRecord {
  id: string;
  requestTypeId: string;
  employeeId: string;
  state: 'submitted' | 'approved' | 'returned' | 'cancelled';
  /** 提出時に写した段数。定義を変えても、この申請では動かない。 */
  totalSteps: number;
  currentStep: number;
  submissions: number;
  businessDate: string;
  endsOn: string | null;
  leaveTypeId: string | null;
  startMinutes: number | null;
  endMinutes: number | null;
  overtimeLimitMinutes: number | null;
  reason: string | null;
  submittedAt: string;
  decidedAt: string | null;
  approvals: RequestApprovalRecord[];
}

export interface EmployeeRequestList {
  requests: EmployeeRequestRecord[];
}

export interface SubmitEmployeeRequestRequest {
  requestTypeId: string;
  employeeId: string;
  businessDate: string;
  endsOn?: string;
  leaveTypeId?: string;
  startMinutes?: number;
  endMinutes?: number;
  overtimeLimitMinutes?: number;
  reason?: string;
}

export interface DecideEmployeeRequestRequest {
  decision: RequestDecision;
  step: number;
  submission: number;
  onBehalfOfUserId?: string;
  comment?: string;
}

export interface ResubmitEmployeeRequestRequest {
  endsOn?: string;
  leaveTypeId?: string;
  startMinutes?: number;
  endMinutes?: number;
  overtimeLimitMinutes?: number;
  reason?: string;
}

/** 月次の合計。法定の区分は、閾値が未設定なら null。 */
export interface MonthlyTotals {
  attendedMinutes: number;
  workedMinutes: number;
  breakMinutes: number;
  scheduledMinutes: number;
  withinScheduleMinutes: number;
  outsideScheduleMinutes: number;
  nightMinutes: number;
  nonWorkingDayMinutes: number;
  leaveMinutes: number;
  absenceMinutes: number;
  legalInsideOvertimeMinutes: number | null;
  legalOvertimeMinutes: number | null;
  legalHolidayMinutes: number | null;
  nonLegalHolidayMinutes: number | null;
  nightOvertimeMinutes: number | null;
  nightHolidayMinutes: number | null;
  lateMinutes: number | null;
  earlyLeaveMinutes: number | null;
  deemedMinutes: number | null;
  /** 承認しきった申請から来る、認定した分と認定の外に出た分。 */
  recognizedOvertimeMinutes: number | null;
  unapprovedOvertimeMinutes: number | null;
  approvedHolidayMinutes: number | null;
  unapprovedHolidayMinutes: number | null;
  workedDays: number;
  leaveDays: number;
  countedDays: number;
}

/**
 * 週・清算期間・変形労働の対象期間の集計。
 *
 * 区切りは設定から決まる。設定が無ければ、その種類の期間は返らない。
 */
export interface PeriodSummaryRecord {
  employeeId: string;
  kind: 'week' | 'settlement';
  from: string;
  to: string;
  /** 清算期間のとき、その制度。週では null。 */
  laborSystemType: LaborSystemType | null;
  workedMinutes: number;
  scheduledMinutes: number;
  outsideScheduleMinutes: number;
  nightMinutes: number;
  nonWorkingDayMinutes: number;
  leaveMinutes: number;
  absenceMinutes: number;
  recognizedOvertimeMinutes: number | null;
  legalOvertimeMinutes: number | null;
  workedDays: number;
  countedDays: number;
  /** 期間の総枠。未設定なら null。 */
  totalMinutes: number | null;
  /** 総枠との差（実労働 − 総枠）。総枠が未設定なら null。 */
  differenceMinutes: number | null;
  /** 締め済みの月を含むか。 */
  includesClosedMonth: boolean;
}

export interface PeriodSummaryList {
  summaries: PeriodSummaryRecord[];
}

/** 締めた時点で固めた集計。あとから日次を直しても動かない。 */
export interface MonthlySnapshotRecord extends MonthlyTotals {
  sequence: number;
  closedAt: string;
  closedByUserId: string | null;
}

export interface MonthlySummaryRecord extends MonthlyTotals {
  employeeId: string;
  employeeNumber: string;
  displayName: string;
  period: string;
  closingState: 'open' | 'closed' | null;
  snapshot: MonthlySnapshotRecord | null;
  /** 締めた値といまの値が食い違っているか。 */
  driftedFromSnapshot: boolean;
}

export interface MonthlySummaryList {
  summaries: MonthlySummaryRecord[];
}

export interface ClosingFindingRecord {
  kind: ClosingFindingKind;
  severity: 'blocking' | 'advisory';
  businessDate: string;
}

export interface ClosingReadiness {
  employeeId: string;
  period: string;
  findings: ClosingFindingRecord[];
  /** 実務が止まるものが残っているか。 */
  blocked: boolean;
}

export interface ClosingReadinessList {
  readiness: ClosingReadiness[];
}

export interface RecalculateAttendanceRequest {
  employeeId: string;
  from: string;
  to: string;
}

export interface RecalculateAttendanceResponse {
  examinedDays: number;
  /** 新しい版を作った日の数。入力が変わらなければ作らない。 */
  recalculatedDays: number;
  /** 締められていて動かさなかった日。 */
  skippedClosedDays: string[];
}

/** 決めた回数だけ試しても送れず、諦めた通知。行は残る。 */
export interface AbandonedDeliveryRecord {
  id: string;
  endpointId: string;
  eventType: WebhookEventType;
  eventId: string;
  occurredAt: string;
  attempts: number;
  abandonedAt: string;
  lastError: string | null;
}

export interface AbandonedDeliveryList {
  deliveries: AbandonedDeliveryRecord[];
}

export interface ResetUserPasswordRequest {
  newPassword: string;
}

export interface RevokedUserSessions {
  revoked: number;
}
