import type {
  EmployeeStatus,
  LaborSystemType,
  LeaveEntryTypeValue,
  RequestCategory,
  WorkCategoryType,
} from '@staffweave/contracts';
import type {
  ApiScope,
  ClosingFindingKind,
  DeviceBrowser,
  DeviceKind,
  DeviceOs,
  Locale,
} from '@staffweave/domain';

/**
 * 画面に出す文言。
 * 識別子は英語のまま保ち、翻訳の追加で構造が変わらないようにする。
 */
export interface Messages {
  appName: string;
  tagline: string;
  signIn: string;
  signOut: string;
  email: string;
  password: string;
  signingIn: string;
  signInFailed: string;
  networkError: string;
  language: string;
  loading: string;
  signedInAs: string;
  roles: string;
  employeeNumber: string;
  noEmployeeLinked: string;
  organizations: string;
  organizationCode: string;
  organizationName: string;
  noOrganizations: string;
  sessionExpiresAt: string;
  changePassword: string;
  currentPassword: string;
  newPassword: string;
  changingPassword: string;
  passwordChanged: string;
  passwordChangeFailed: string;
  otherSessionsSignedOut: string;
  activeSessions: string;
  activeSessionsHint: string;
  sessionDevice: string;
  sessionIssuedAt: string;
  sessionLastSeenAt: string;
  thisDevice: string;
  unknownDevice: string;
  revokeSession: string;
  revokingSession: string;
  revokeOtherSessions: string;
  revokingOtherSessions: string;
  otherSessionsRevoked: string;
  noOtherSessions: string;
  sessionRevokeFailed: string;
  /** 端末の系統。判別できた分だけを画面の言語で書き直す。 */
  deviceOs: Record<DeviceOs, string>;
  deviceBrowser: Record<DeviceBrowser, string>;
  deviceKind: Record<DeviceKind, string>;
  apiKeys: string;
  apiKeysHint: string;
  apiKeyName: string;
  apiKeyPrefix: string;
  apiKeyScopes: string;
  apiKeyCreatedAt: string;
  apiKeyLastUsedAt: string;
  apiKeyNeverUsed: string;
  createApiKey: string;
  creatingApiKey: string;
  apiKeyCreated: string;
  apiKeySecretOnce: string;
  apiKeySecretCopied: string;
  copySecret: string;
  dismissSecret: string;
  revokeApiKey: string;
  revokingApiKey: string;
  apiKeyRevoked: string;
  noApiKeys: string;
  apiKeyCreateFailed: string;
  apiKeyRevokeFailed: string;
  selectAtLeastOneScope: string;
  /** スコープの説明。契約に現れる値を画面の言語で書き直す。 */
  apiScope: Record<ApiScope, string>;
  today: string;
  clockIn: string;
  clockOut: string;
  stateNotStarted: string;
  stateWorking: string;
  stateFinished: string;
  firstClockInAt: string;
  lastClockOutAt: string;
  punchHistory: string;
  noPunchYet: string;
  punchFailed: string;
  employeeRequiredForPunch: string;
  stateOnBreak: string;
  breakStart: string;
  breakEnd: string;
  breaks: string;
  breakInProgress: string;
  correct: string;
  voidPunch: string;
  addPunch: string;
  correctionReason: string;
  correctionTime: string;
  correctionTimeNonexistent: string;
  correctionTimeMalformed: string;
  timeZoneNotice: string;
  correctionType: string;
  save: string;
  cancel: string;
  recordHistory: string;
  actionAdjust: string;
  actionVoid: string;
  actionAdd: string;
  originalPunch: string;
  calculation: string;
  workedTime: string;
  breakTime: string;
  scheduledTime: string;
  notifications: string;
  noNotifications: string;
  markAllRead: string;
  outsideScheduleTime: string;
  recognizedOvertimeTime: string;
  unapprovedOvertimeTime: string;
  approvedHolidayTime: string;
  unapprovedHolidayTime: string;
  nightTime: string;
  nonWorkingDayTime: string;
  calculationPending: string;
  calculationIncomplete: string;
  calculationVersion: string;
  formatDuration: (minutes: number) => string;
  request: string;
  submitRequest: string;
  cancelRequest: string;
  requestDraft: string;
  requestSubmitted: string;
  requestApproved: string;
  requestReturned: string;
  requestCancelled: string;
  notRequestedYet: string;
  editingLocked: string;
  approvals: string;
  approve: string;
  returnRequest: string;
  returnReason: string;
  noPendingRequests: string;
  requestHistory: string;
  offlineNotice: string;
  pendingPunches: (count: number) => string;
  legacyPendingPunches: string;
  unreadablePendingPunches: string;
  punchBlockedAuthentication: string;
  punchBlockedPermission: string;
  punchBlockedRetry: string;
  punchBlockedStorageUnreadable: string;
  punchBlockedStorageNotRecorded: string;
  punchBlockedStorageRetained: string;
  recheckStoredPunches: string;
  punchOwnerUnverified: string;
  retryPendingPunches: string;
  sessionExpiredWithPendingPunches: string;
  skipToMain: string;
  discrepancies: string;
  noDiscrepancies: string;
  discrepancyNotice: string;
  discrepancyMinutes: (minutes: number) => string;
  anomalies: string;
  noAnomalies: string;
  anomalyNotice: string;
  downloadCsv: string;
  severityWarning: string;
  severityInfo: string;
  /** 設定の画面。項目が多いため、他と混ぜず 1 つのまとまりとして持つ。 */
  admin: AdminMessages;
}
/** 設定の画面の文言。 */
export interface AdminMessages {
  title: string;
  openConsole: string;
  backToHome: string;
  nothingVisible: string;
  notVisible: string;
  moduleTablistLabel: string;
  moduleOrganization: string;
  moduleEmployee: string;
  moduleWork: string;
  moduleLeave: string;
  moduleRequest: string;
  sectionOrganizations: string;
  sectionSites: string;
  sectionDepartments: string;
  sectionEmployees: string;
  sectionUserScopes: string;
  sectionWorkCategories: string;
  sectionCalculationRules: string;
  sectionLaborSystems: string;
  sectionLeaveTypes: string;
  sectionLeaveLedger: string;
  sectionRequestTypes: string;
  organizationsHint: string;
  sitesHint: string;
  departmentsHint: string;
  employeesHint: string;
  userScopesHint: string;
  workCategoriesHint: string;
  calculationRulesHint: string;
  laborSystemsHint: string;
  leaveTypesHint: string;
  leaveLedgerHint: string;
  requestTypesHint: string;
  noRecords: string;
  noSites: string;
  noDepartments: string;
  noEmployees: string;
  noUserScopes: string;
  noWorkCategories: string;
  noCalculationRules: string;
  noLaborSystems: string;
  noLeaveTypes: string;
  noLeaveEntries: string;
  noRequestTypes: string;
  loadFailed: string;
  saveFailed: string;
  save: string;
  saving: string;
  saved: string;
  addNew: string;
  editSettings: string;
  editRow: string;
  copyToForm: string;
  rowActions: string;
  code: string;
  codeHint: string;
  name: string;
  internalName: string;
  displayName: string;
  createdAt: string;
  organization: string;
  timeZone: string;
  timeZoneHint: string;
  parentDepartment: string;
  noParentDepartment: string;
  employeeNumber: string;
  employee: string;
  status: string;
  hiredOn: string;
  account: string;
  accountNone: string;
  accountLinked: string;
  createAccount: string;
  initialPasswordHint: string;
  employeeStatus: Record<EmployeeStatus, string>;
  userId: string;
  userIdHint: string;
  grantedAt: string;
  categoryType: string;
  workCategoryType: Record<WorkCategoryType, string>;
  workCategoryCodeHint: string;
  effectiveFrom: string;
  effectiveFromHint: string;
  effectiveTo: string;
  openEnded: string;
  scheduledHours: string;
  scheduledStart: string;
  scheduledEnd: string;
  scheduledEndHint: string;
  clockHint: string;
  fixedBreaks: string;
  fixedBreakStart: string;
  fixedBreakEnd: string;
  fixedBreakHint: string;
  shift: string;
  yes: string;
  no: string;
  unconfigured: string;
  ruleEffectiveFromHint: string;
  dayStartMinutes: string;
  dayStartHint: string;
  nightBand: string;
  nightStartMinutes: string;
  nightEndMinutes: string;
  rounding: string;
  roundingMinutes: string;
  roundingModeLabel: string;
  roundingMode: Record<'none' | 'down' | 'nearest', string>;
  dailyLegalMinutes: string;
  weeklyLegalMinutes: string;
  legalThresholdHint: string;
  weekStartsOn: string;
  weekStartsOnHint: string;
  monthStartsOn: string;
  laborSystem: string;
  laborSystemType: Record<LaborSystemType, string>;
  settlementPeriod: string;
  settlementMonths: string;
  settlementStartsOn: string;
  settlementHint: string;
  deemedMinutes: string;
  deemedHint: string;
  months: string;
  endAssignment: string;
  paidLeave: string;
  unitMinutes: string;
  unitMinutesHint: string;
  dayMinutes: string;
  dayMinutesHint: string;
  expiresAfterMonths: string;
  expiresAfterMonthsHint: string;
  neverExpires: string;
  activeLabel: string;
  pickLeaveTypeToEdit: string;
  leaveType: string;
  entryType: string;
  leaveEntryType: Record<LeaveEntryTypeValue, string>;
  minutes: string;
  effectiveOn: string;
  expiresOn: string;
  reason: string;
  grantLeave: string;
  grantMinutesHint: string;
  grantEffectiveOnHint: string;
  reverseEntry: string;
  reversedFromConsole: string;
  noBalance: string;
  expiredMinutesLabel: string;
  requestCategory: string;
  requestCategoryLabel: Record<RequestCategory, string>;
  requestCategoryHint: string;
  approvalSteps: string;
  approvalStepsHint: string;
  requiredInputs: string;
  timeRange: string;
  overtimeLimit: string;
  editingRequestType: string;
  stopEditing: string;
  moduleMonthly: string;
  sectionLeaveGrantRules: string;
  leaveGrantRulesHint: string;
  noLeaveGrantRules: string;
  grantServiceMonths: string;
  grantMinutes: string;
  grantBasis: string;
  grantBasisLabel: { fixed_date: string; hire_anniversary: string };
  grantEffectiveOn: string;
  runBulkGrant: string;
  bulkGrantOutcome: (granted: number, skipped: number) => string;
  sectionLeaveRegister: string;
  leaveRegisterHint: string;
  noLeaveRegister: string;
  registerOpening: string;
  registerGranted: string;
  registerConsumed: string;
  registerExpired: string;
  registerAdjusted: string;
  registerClosing: string;
  sectionLeaveExpirations: string;
  leaveExpirationsHint: string;
  noLeaveExpirations: string;
  remainingMinutes: string;
  asOf: string;
  through: string;
  importCsv: string;
  importCsvHint: string;
  imported: (count: number) => string;
  sectionMonthlySummaries: string;
  sectionPeriodSummaries: string;
  periodSummariesHint: string;
  noPeriodSummaries: string;
  periodKind: string;
  periodKindLabel: { week: string; settlement: string };
  periodFrom: string;
  periodTo: string;
  periodTotalMinutes: string;
  periodDifferenceMinutes: string;
  periodIncludesClosedMonth: string;
  periodEmployeeHint: string;
  employeeId: string;
  sectionClosingReadiness: string;
  monthlySummariesHint: string;
  closingReadinessHint: string;
  noMonthlySummaries: string;
  noClosingReadiness: string;
  period: string;
  periodHint: string;
  workedDays: string;
  workedMinutes: string;
  outsideMinutes: string;
  nightMinutes: string;
  legalOvertimeMinutes: string;
  recognizedOvertimeMinutes: string;
  unapprovedOvertimeMinutes: string;
  leaveMinutes: string;
  closingState: string;
  closingStateLabel: Record<'open' | 'closed', string>;
  closingOpen: string;
  closedTotal: string;
  driftedFromSnapshot: string;
  blocked: string;
  remaining: string;
  nothingRemaining: string;
  closingFinding: Record<ClosingFindingKind, string>;
  closingSeverity: Record<'blocking' | 'advisory', string>;
}

const ja: Messages = {
  appName: 'StaffWeave',
  tagline: 'セルフホスト可能な勤怠管理基盤',
  signIn: 'ログイン',
  signOut: 'ログアウト',
  email: 'メールアドレス',
  password: 'パスワード',
  signingIn: 'ログインしています',
  signInFailed: 'メールアドレスまたはパスワードが正しくありません',
  networkError: 'サーバーへ接続できませんでした',
  language: '表示言語',
  loading: '読み込んでいます',
  signedInAs: 'ログイン中',
  roles: 'ロール',
  employeeNumber: '従業員番号',
  noEmployeeLinked: 'この利用者に従業員は紐づいていません',
  organizations: '組織',
  organizationCode: 'コード',
  organizationName: '名称',
  noOrganizations: '組織はまだ登録されていません',
  sessionExpiresAt: 'セッション有効期限',
  changePassword: 'パスワードの変更',
  currentPassword: '現在のパスワード',
  newPassword: '新しいパスワード',
  changingPassword: '変更しています…',
  passwordChanged: 'パスワードを変更しました',
  passwordChangeFailed: 'パスワードを変更できませんでした',
  otherSessionsSignedOut: '他の端末のセッションはログアウトしました。',
  activeSessions: 'ログイン中の端末',
  activeSessionsHint: '覚えのない端末があれば、その行をログアウトしてください。',
  sessionDevice: '端末',
  sessionIssuedAt: 'ログイン日時',
  sessionLastSeenAt: '最終利用',
  thisDevice: 'この端末',
  unknownDevice: '不明な端末',
  revokeSession: 'ログアウトさせる',
  revokingSession: 'ログアウトさせています…',
  revokeOtherSessions: '他の端末からログアウトする',
  revokingOtherSessions: 'ログアウトしています…',
  otherSessionsRevoked: '他の端末のセッションを終了しました',
  noOtherSessions: '他の端末からのログインはありません。',
  sessionRevokeFailed: 'セッションを終了できませんでした',
  deviceOs: {
    windows: 'Windows',
    macos: 'macOS',
    ios: 'iOS',
    ipados: 'iPadOS',
    android: 'Android',
    chromeos: 'ChromeOS',
    linux: 'Linux',
  },
  deviceBrowser: {
    chrome: 'Chrome',
    safari: 'Safari',
    firefox: 'Firefox',
    edge: 'Edge',
    opera: 'Opera',
    samsung: 'Samsung Internet',
  },
  deviceKind: {
    desktop: 'パソコン',
    mobile: 'スマートフォン',
    tablet: 'タブレット',
  },
  apiKeys: 'API キー',
  apiKeysHint: '外部連携へ渡す鍵です。鍵の値は作成した直後の一度しか表示されません。',
  apiKeyName: '名前',
  apiKeyPrefix: '先頭 8 文字',
  apiKeyScopes: '許す範囲',
  apiKeyCreatedAt: '作成日時',
  apiKeyLastUsedAt: '最終利用',
  apiKeyNeverUsed: '未使用',
  createApiKey: 'API キーを作る',
  creatingApiKey: '作成しています…',
  apiKeyCreated: 'API キーを作成しました',
  apiKeySecretOnce: 'この値は今だけ表示されます。控えてから閉じてください。',
  apiKeySecretCopied: '控えました',
  copySecret: '鍵をコピーする',
  dismissSecret: '控えたので閉じる',
  revokeApiKey: '失効させる',
  revokingApiKey: '失効させています…',
  apiKeyRevoked: '失効済み',
  noApiKeys: 'API キーはまだありません。',
  apiKeyCreateFailed: 'API キーを作成できませんでした',
  apiKeyRevokeFailed: 'API キーを失効させられませんでした',
  selectAtLeastOneScope: '許す範囲を 1 つ以上選んでください',
  apiScope: {
    'attendance:read': '勤怠と集計の読み取り',
    'attendance:write': '打刻の記録',
    'payroll:read': '給与連携向けの出力',
    'organization:read': '組織・従業員の読み取り',
  },
  today: '本日の勤怠',
  clockIn: '出勤',
  clockOut: '退勤',
  stateNotStarted: '出勤前',
  stateWorking: '勤務中',
  stateFinished: '退勤済み',
  firstClockInAt: '出勤時刻',
  lastClockOutAt: '退勤時刻',
  punchHistory: '本日の打刻',
  noPunchYet: 'まだ打刻はありません',
  punchFailed: '打刻を記録できませんでした',
  employeeRequiredForPunch: 'この利用者には従業員が紐づいていないため、打刻できません',
  stateOnBreak: '休憩中',
  breakStart: '休憩開始',
  breakEnd: '休憩終了',
  breaks: '休憩',
  breakInProgress: '休憩中',
  correct: '修正',
  voidPunch: '取消',
  addPunch: '打刻を追加',
  correctionReason: '修正理由',
  correctionTime: '修正後の時刻',
  correctionTimeNonexistent:
    'その時刻は夏時間の切り替わりで存在しません。前後の時刻を指定してください。',
  correctionTimeMalformed: '日時として読み取れません。',
  timeZoneNotice: '時刻の基準',
  correctionType: '打刻の種別',
  save: '保存',
  cancel: 'やめる',
  recordHistory: '記録の履歴',
  actionAdjust: '修正',
  actionVoid: '取消',
  actionAdd: '追加',
  originalPunch: '元の打刻',
  calculation: '集計',
  workedTime: '実労働',
  breakTime: '休憩',
  scheduledTime: '所定労働',
  notifications: '通知',
  noNotifications: '新しい通知はありません。',
  markAllRead: 'すべて既読にする',
  outsideScheduleTime: '所定外',
  recognizedOvertimeTime: '認定時間外',
  unapprovedOvertimeTime: '未承認の所定外',
  approvedHolidayTime: '承認済みの休日労働',
  unapprovedHolidayTime: '未承認の休日労働',
  nightTime: '深夜帯',
  nonWorkingDayTime: '休日労働',
  calculationPending: '打刻がないため集計はまだありません',
  calculationIncomplete: '退勤していないため、集計は途中の値です',
  calculationVersion: '計算版',
  formatDuration: (minutes) =>
    minutes === 0 ? '0分' : `${Math.floor(minutes / 60)}時間${minutes % 60}分`,
  request: '申請',
  submitRequest: 'この日の勤怠を申請する',
  cancelRequest: '申請を取り消す',
  requestDraft: '未申請',
  requestSubmitted: '申請中',
  requestApproved: '承認済み',
  requestReturned: '差し戻し',
  requestCancelled: '取消済み',
  notRequestedYet: 'まだ申請していません',
  editingLocked: 'この日は打刻の追加や修正ができません',
  approvals: '承認待ちの申請',
  approve: '承認',
  returnRequest: '差し戻し',
  returnReason: '差し戻しの理由',
  noPendingRequests: '承認待ちの申請はありません',
  requestHistory: '申請の履歴',
  offlineNotice: 'オフラインです。打刻は端末に残し、接続が戻ったら送ります。',
  pendingPunches: (count) => `送信待ちの打刻が ${count} 件あります`,
  legacyPendingPunches:
    '以前の形式で保存された送信待ち打刻があります。所有者を確認できないため、自動送信していません。',
  unreadablePendingPunches:
    '読み取れない送信待ち打刻がこの端末に残っています。自動送信せず、元の内容を退避しています。',
  punchBlockedAuthentication:
    '再ログインが必要です。送信待ちの打刻はこの端末に残しています。削除されていません。',
  punchBlockedPermission:
    '権限または従業員の設定を確認してください。送信待ちの打刻はこの端末に残しています。',
  punchBlockedRetry: 'いま送信できません。送信待ちの打刻はこの端末に残しています。',
  punchBlockedStorageUnreadable:
    'この端末に保存された送信待ち打刻を確認できません。新しい打刻はまだ受け付けていません。ブラウザの保存設定を確認して、保存内容を再確認してください。',
  punchBlockedStorageNotRecorded:
    'この端末に打刻を安全に保存できなかったため、今回の打刻は記録されていません。保存設定と空き容量を確認して、もう一度打刻してください。',
  punchBlockedStorageRetained:
    '端末の送信待ち情報を更新できませんでした。同じ打刻を安全に再送できるよう保持しています。保存設定を確認して再送してください。',
  recheckStoredPunches: '保存内容を再確認',
  punchOwnerUnverified:
    '打刻に必要な利用者情報を確認できません。再ログインしても解消しない場合は、管理者へ連絡してください。',
  retryPendingPunches: '再送する',
  sessionExpiredWithPendingPunches:
    'セッションの有効期限が切れました。送信待ちの打刻はこの端末に残っています。同じ利用者でログインすると再送します。',
  skipToMain: '本文へ移動',
  discrepancies: 'PC の利用記録との食い違い',
  noDiscrepancies: '打刻と PC の利用記録に食い違いはありません',
  discrepancyNotice: 'これは確認のための材料です。打刻や集計が自動で書き換わることはありません。',
  discrepancyMinutes: (minutes) => `${minutes} 分`,
  anomalies: '確認が必要な記録',
  noAnomalies: '確認が必要な記録はありません',
  anomalyNotice: '検出したものが不正であるとは限りません。根拠を確かめたうえで判断してください。',
  downloadCsv: 'CSV で取り出す',
  severityWarning: '要確認',
  severityInfo: '参考',
  admin: {
    title: '設定',
    openConsole: '設定を開く',
    backToHome: 'ホームへ戻る',
    nothingVisible: 'あなたが設定できる項目はありません。',
    notVisible: 'この設定を見る権限がありません。',
    moduleTablistLabel: '設定のモジュール',
    moduleOrganization: '組織',
    moduleEmployee: '従業員',
    moduleWork: '勤務',
    moduleLeave: '休暇',
    moduleRequest: '申請',
    sectionOrganizations: '組織',
    sectionSites: '拠点',
    sectionDepartments: '部門',
    sectionEmployees: '従業員',
    sectionUserScopes: '閲覧範囲',
    sectionWorkCategories: '勤務区分',
    sectionCalculationRules: '計算規則の版',
    sectionLaborSystems: '労働形態',
    sectionLeaveTypes: '休暇種別',
    sectionLeaveLedger: '休暇の台帳',
    sectionRequestTypes: '申請種別と承認経路',
    organizationsHint: 'ここが空だと、拠点も部門も従業員も置けません。最初に作ります。',
    sitesHint:
      '業務日の切り替わりは拠点の時計で決まります。時間帯を間違えると勤怠が 1 日ずれます。',
    departmentsHint: '上位の部門を指すと階層になります。',
    employeesHint:
      'ログイン用の利用者を同時に作れます。カードや端末だけで打刻する働き方では作りません。',
    userScopesHint:
      '誰の勤怠を見られるかを組織で決めます。ワークスペース全体を見られるかどうかは、この設定ではなくロールが決めます。',
    workCategoriesHint:
      '同じコードで期間を分けて改定します。過去の集計は当時の版のまま残り、改定で書き換わりません。',
    calculationRulesHint:
      '労務計算の値は事業者が決めます。製品は既定値を持ちません。設定しないかぎり、法定の区分は計算しません。',
    laborSystemsHint: '制度ごとに要る値が違います。そろっていない割当は受け付けません。',
    leaveTypesHint:
      '取得の単位・1 日ぶんの分数・失効までの月数は事業者が決めます。設定しないかぎり適用しません。',
    leaveLedgerHint:
      '残数は保存していません。ここに出るのは台帳から組み立てた値です。記録は書き換えられないため、間違いは打ち消す行で直します。',
    requestTypesHint:
      '承認の段数がそのまま経路になります。段数を変えても、すでに提出された申請は提出時の段数のまま進みます。',
    noRecords: 'まだ登録されていません。',
    noSites: '拠点はまだありません。組織を作ってから登録します。',
    noDepartments: '部門はまだありません。',
    noEmployees: '従業員はまだ登録されていません。',
    noUserScopes: '閲覧範囲を与えた利用者はいません。',
    noWorkCategories: '勤務区分はまだありません。',
    noCalculationRules: '計算規則の版はまだありません。',
    noLaborSystems: '労働形態の割当はまだありません。',
    noLeaveTypes: '休暇種別はまだありません。',
    noLeaveEntries: 'この従業員の台帳に記録はありません。',
    noRequestTypes: '申請種別はまだありません。',
    loadFailed: '読み込めませんでした',
    saveFailed: '保存できませんでした',
    save: '保存',
    saving: '保存しています…',
    saved: '保存しました',
    addNew: '新しく作る',
    editSettings: '設定を直す',
    editRow: 'この行を直す',
    copyToForm: '写して作る',
    rowActions: '行の操作',
    code: 'コード',
    codeHint: '英数字とハイフン、下線が使えます。あとから変えられません。',
    name: '名称',
    internalName: '管理用の名称',
    displayName: '従業員へ見せる名称',
    createdAt: '作成日時',
    organization: '組織',
    timeZone: '時間帯',
    timeZoneHint: '空欄なら組織の時間帯を使います。例: Asia/Tokyo',
    parentDepartment: '上位の部門',
    noParentDepartment: '（上位なし）',
    employeeNumber: '従業員番号',
    employee: '従業員',
    status: '状態',
    hiredOn: '入社日',
    account: 'ログイン',
    accountNone: 'なし',
    accountLinked: 'あり',
    createAccount: 'ログイン用の利用者も作る',
    initialPasswordHint: '初回のパスワードです。本人に変えてもらってください。',
    employeeStatus: { active: '在籍', suspended: '休止', retired: '退職' },
    userId: '利用者の識別子',
    userIdHint: '利用者一覧の識別子を貼り付けます。',
    grantedAt: '付与日時',
    categoryType: '区分の種別',
    workCategoryType: {
      working_day: '所定労働日',
      non_working_day: '法定外休日',
      legal_holiday: '法定休日',
      leave: '休暇',
      absence: '欠勤',
    },
    workCategoryCodeHint: '同じコードで期間を分けると、改定として重なります。',
    effectiveFrom: '適用開始日',
    effectiveFromHint: '同じコードで期間が重なる版は作れません。',
    effectiveTo: '適用終了日',
    openEnded: '（終了日なし）',
    scheduledHours: '所定の時間帯',
    scheduledStart: '所定の開始',
    scheduledEnd: '所定の終了',
    scheduledEndHint: '日をまたぐ勤務は 26:00 のように 24 時を超えて書きます。',
    clockHint: '時:分の形で書きます。例: 09:00',
    fixedBreaks: '固定休憩',
    fixedBreakStart: '固定休憩の開始',
    fixedBreakEnd: '固定休憩の終了',
    fixedBreakHint: '打刻が無くても引く時間帯です。空欄なら引きません。',
    shift: 'シフト',
    yes: 'はい',
    no: 'いいえ',
    unconfigured: '未設定',
    ruleEffectiveFromHint: '同じ適用開始日の版は 1 つだけです。',
    dayStartMinutes: '日の始まり（分）',
    dayStartHint: '深夜勤務を前日として数えるなら、0 より後ろにします。',
    nightBand: '深夜帯',
    nightStartMinutes: '深夜帯の開始（分）',
    nightEndMinutes: '深夜帯の終了（分）',
    rounding: '丸め',
    roundingMinutes: '丸めの単位（分）',
    roundingModeLabel: '丸め方',
    roundingMode: { none: '丸めない', down: '切り捨て', nearest: '近い方へ' },
    dailyLegalMinutes: '1 日の法定の閾値（分）',
    weeklyLegalMinutes: '1 週の法定の閾値（分）',
    legalThresholdHint:
      '空欄なら未設定として扱い、法定内と法定外を分けません。0 と未設定は別のものです。',
    weekStartsOn: '週の開始曜日',
    weekStartsOnHint: '0 が日曜、1 が月曜です。',
    monthStartsOn: '月の集計の開始日',
    laborSystem: '労働形態',
    laborSystemType: {
      normal: '通常',
      flex: 'フレックス',
      discretionary: '裁量',
      variable: '変形',
    },
    settlementPeriod: '清算期間',
    settlementMonths: '清算期間の月数',
    settlementStartsOn: '清算期間の起算日',
    settlementHint: 'フレックスと変形では、清算期間がそろっていないと割り当てられません。',
    deemedMinutes: 'みなし分数',
    deemedHint: '裁量では、実績にかかわらずこの分数を働いたものとして扱います。',
    months: 'か月',
    endAssignment: '終了日を入れる',
    paidLeave: '有給',
    unitMinutes: '取得の単位（分）',
    unitMinutesHint:
      '480 なら 1 日単位、240 なら半日単位、60 なら時間単位です。空欄なら制限しません。',
    dayMinutes: '1 日ぶんの分数',
    dayMinutesHint: '日数へ言い換えるときと、時間帯の指定がない申請で引く量に使います。',
    expiresAfterMonths: '失効までの月数',
    expiresAfterMonthsHint: '空欄なら失効しません。',
    neverExpires: '失効しない',
    activeLabel: '使える',
    pickLeaveTypeToEdit: '直したい休暇種別の行から「この行を直す」を押してください。',
    leaveType: '休暇種別',
    entryType: '記録の種類',
    leaveEntryType: {
      grant: '付与',
      consume: '取得',
      expire: '失効',
      adjust: '手当て',
      reverse: '取消',
    },
    minutes: '分数',
    effectiveOn: '効力の日',
    expiresOn: '失効日',
    reason: '理由',
    grantLeave: '休暇を付与する',
    grantMinutesHint: '分で入れます。1 日 8 時間なら 480 です。',
    grantEffectiveOnHint: 'この日から使えるようになります。失効日は休暇種別の設定から決まります。',
    reverseEntry: '取り消す',
    reversedFromConsole: '設定画面からの取消',
    noBalance: 'この従業員に休暇の残数はありません。',
    expiredMinutesLabel: '失効',
    requestCategory: '区分',
    requestCategoryLabel: {
      leave: '休暇',
      overtime: '残業',
      holiday_work: '休日出勤',
      attendance_correction: '打刻修正',
      other: 'その他',
    },
    requestCategoryHint: '休暇の区分は、承認しきったときに休暇の台帳へ反映されます。',
    approvalSteps: '承認の段数',
    approvalStepsHint: '1 から 4 まで。提出済みの申請の段数は、ここを変えても動きません。',
    requiredInputs: '入力を求める項目',
    timeRange: '時間帯',
    overtimeLimit: '残業の上限時刻',
    editingRequestType: 'この申請種別を直しています。',
    stopEditing: 'やめて新しく作る',
    moduleMonthly: '月次',
    sectionLeaveGrantRules: '付与規則と一括付与',
    leaveGrantRulesHint:
      '勤続の段ごとに付与する分数を決めます。段を置かないかぎり、自動でも一斉でも 1 分も付与しません。',
    noLeaveGrantRules: '段がありません。勤続と分数を決めてください。',
    grantServiceMonths: '勤続（月）',
    grantMinutes: '付与（分）',
    grantBasis: '付与の基準',
    grantBasisLabel: { fixed_date: '一斉付与', hire_anniversary: '入社日基準' },
    grantEffectiveOn: '付与日',
    runBulkGrant: 'まとめて付与する',
    bulkGrantOutcome: (granted: number, skipped: number) =>
      `${granted} 名へ付与し、${skipped} 名は付与しませんでした。`,
    sectionLeaveRegister: '休暇管理簿',
    leaveRegisterHint: '期首・付与・消化・失効・期末を、台帳から組み立てて出します。',
    noLeaveRegister: 'この期間に記録がありません。',
    registerOpening: '期首（分）',
    registerGranted: '付与（分）',
    registerConsumed: '消化（分）',
    registerExpired: '失効（分）',
    registerAdjusted: '手当て（分）',
    registerClosing: '期末（分）',
    sectionLeaveExpirations: '失効の予定',
    leaveExpirationsHint: '指定した日までに失効する付与と、その時点の残りを出します。',
    noLeaveExpirations: 'この範囲に失効する付与はありません。',
    remainingMinutes: '残り（分）',
    asOf: '基準日',
    through: 'この日まで',
    importCsv: 'CSV で取り込む',
    importCsvHint:
      '取り出した CSV と同じ列で書きます。1 行でも読めなければ、1 行も取り込みません。',
    imported: (count: number) => `${count} 件を取り込みました。`,
    sectionMonthlySummaries: '月次の集計',
    sectionPeriodSummaries: '期間の集計',
    periodSummariesHint:
      '週・清算期間・変形労働の対象期間の合計です。区切りは計算規則の版と労働形態の割当が決めます。' +
      '設定が無い区切りは出ません。',
    noPeriodSummaries:
      'この範囲に集計する期間がありません。従業員と区切りの設定を確かめてください。',
    periodKind: '区切り',
    periodKindLabel: { week: '週', settlement: '清算期間' },
    periodFrom: '開始日',
    periodTo: '終了日',
    periodTotalMinutes: '総枠（分）',
    periodDifferenceMinutes: '総枠との差（分）',
    periodIncludesClosedMonth: '締め済みを含む',
    periodEmployeeHint: '従業員の識別子を入れます。',
    employeeId: '従業員',
    sectionClosingReadiness: '締める前の確認',
    monthlySummariesHint:
      '出ているのは、日次を足し合わせたいまの値です。締めた月は、締めた時点で固めた値も並びます。',
    closingReadinessHint:
      '締める前に残っているものです。ここは締めを止めません。止めるかどうかは運用が決めます。',
    noMonthlySummaries: 'この月の集計はありません。',
    noClosingReadiness: 'この月に確認することはありません。',
    period: '対象月',
    periodHint: '月の 1 日を選びます。',
    workedDays: '出勤日数',
    workedMinutes: '実労働（分）',
    outsideMinutes: '所定外（分）',
    nightMinutes: '深夜（分）',
    legalOvertimeMinutes: '法定時間外（分）',
    recognizedOvertimeMinutes: '認定時間外（分）',
    unapprovedOvertimeMinutes: '未承認の所定外（分）',
    leaveMinutes: '休暇（分）',
    closingState: '締め',
    closingStateLabel: { open: '未締め', closed: '締め済み' },
    closingOpen: '未締め',
    closedTotal: '締めた時点の実労働（分）',
    driftedFromSnapshot: 'いまの値と違う',
    blocked: '止まっている',
    remaining: '残っているもの',
    nothingRemaining: 'ありません',
    closingFinding: {
      open_work_day: '退勤していない',
      not_requested: '申請していない',
      not_approved: '承認されていない',
      returned: '差し戻したまま',
      flagged: '修正が入っている',
    },
    closingSeverity: { blocking: '要対応', advisory: '参考' },
  },
};

const en: Messages = {
  appName: 'StaffWeave',
  tagline: 'Self-hostable workforce time and attendance platform',
  signIn: 'Sign in',
  signOut: 'Sign out',
  email: 'Email address',
  password: 'Password',
  signingIn: 'Signing in',
  signInFailed: 'Email address or password is incorrect',
  networkError: 'Could not reach the server',
  language: 'Language',
  loading: 'Loading',
  signedInAs: 'Signed in as',
  roles: 'Roles',
  employeeNumber: 'Employee number',
  noEmployeeLinked: 'No employee record is linked to this user',
  organizations: 'Organizations',
  organizationCode: 'Code',
  organizationName: 'Name',
  noOrganizations: 'No organizations have been registered yet',
  sessionExpiresAt: 'Session expires at',
  changePassword: 'Change password',
  currentPassword: 'Current password',
  newPassword: 'New password',
  changingPassword: 'Changing…',
  passwordChanged: 'Password changed',
  passwordChangeFailed: 'Could not change the password',
  otherSessionsSignedOut: 'Sessions on other devices have been signed out.',
  activeSessions: 'Signed-in devices',
  activeSessionsHint: 'If you do not recognise a device, sign that row out.',
  sessionDevice: 'Device',
  sessionIssuedAt: 'Signed in at',
  sessionLastSeenAt: 'Last used',
  thisDevice: 'This device',
  unknownDevice: 'Unknown device',
  revokeSession: 'Sign out',
  revokingSession: 'Signing out…',
  revokeOtherSessions: 'Sign out other devices',
  revokingOtherSessions: 'Signing out…',
  otherSessionsRevoked: 'Sessions on other devices have been ended',
  noOtherSessions: 'No other devices are signed in.',
  sessionRevokeFailed: 'Could not end the session',
  deviceOs: {
    windows: 'Windows',
    macos: 'macOS',
    ios: 'iOS',
    ipados: 'iPadOS',
    android: 'Android',
    chromeos: 'ChromeOS',
    linux: 'Linux',
  },
  deviceBrowser: {
    chrome: 'Chrome',
    safari: 'Safari',
    firefox: 'Firefox',
    edge: 'Edge',
    opera: 'Opera',
    samsung: 'Samsung Internet',
  },
  deviceKind: {
    desktop: 'Computer',
    mobile: 'Phone',
    tablet: 'Tablet',
  },
  apiKeys: 'API keys',
  apiKeysHint:
    'Keys handed to external integrations. A key value is shown only once, right after it is created.',
  apiKeyName: 'Name',
  apiKeyPrefix: 'First 8 characters',
  apiKeyScopes: 'Allowed scope',
  apiKeyCreatedAt: 'Created at',
  apiKeyLastUsedAt: 'Last used',
  apiKeyNeverUsed: 'Never used',
  createApiKey: 'Create API key',
  creatingApiKey: 'Creating…',
  apiKeyCreated: 'API key created',
  apiKeySecretOnce: 'This value is shown only now. Copy it before closing.',
  apiKeySecretCopied: 'Copied',
  copySecret: 'Copy key',
  dismissSecret: 'I have copied it — close',
  revokeApiKey: 'Revoke',
  revokingApiKey: 'Revoking…',
  apiKeyRevoked: 'Revoked',
  noApiKeys: 'No API keys yet.',
  apiKeyCreateFailed: 'Could not create the API key',
  apiKeyRevokeFailed: 'Could not revoke the API key',
  selectAtLeastOneScope: 'Select at least one scope',
  apiScope: {
    'attendance:read': 'Read attendance and totals',
    'attendance:write': 'Record punches',
    'payroll:read': 'Payroll export',
    'organization:read': 'Read organizations and employees',
  },
  today: "Today's attendance",
  clockIn: 'Clock in',
  clockOut: 'Clock out',
  stateNotStarted: 'Not started',
  stateWorking: 'Working',
  stateFinished: 'Finished',
  firstClockInAt: 'Clocked in at',
  lastClockOutAt: 'Clocked out at',
  punchHistory: "Today's punches",
  noPunchYet: 'No punches recorded yet',
  punchFailed: 'Could not record the punch',
  employeeRequiredForPunch: 'No employee record is linked to this user, so punching is unavailable',
  stateOnBreak: 'On break',
  breakStart: 'Start break',
  breakEnd: 'End break',
  breaks: 'Breaks',
  breakInProgress: 'In progress',
  correct: 'Correct',
  voidPunch: 'Void',
  addPunch: 'Add a punch',
  correctionReason: 'Reason',
  correctionTime: 'Corrected time',
  correctionTimeNonexistent:
    'That local time does not exist because of a daylight saving change. Pick a time before or after it.',
  correctionTimeMalformed: 'This is not a valid date and time.',
  timeZoneNotice: 'Times shown in',
  correctionType: 'Punch type',
  save: 'Save',
  cancel: 'Cancel',
  recordHistory: 'Record history',
  actionAdjust: 'Adjust',
  actionVoid: 'Void',
  actionAdd: 'Add',
  originalPunch: 'Original punch',
  calculation: 'Totals',
  workedTime: 'Worked',
  breakTime: 'Break',
  scheduledTime: 'Scheduled',
  notifications: 'Notifications',
  noNotifications: 'No new notifications.',
  markAllRead: 'Mark all as read',
  outsideScheduleTime: 'Outside schedule',
  recognizedOvertimeTime: 'Recognized overtime',
  unapprovedOvertimeTime: 'Overtime without approval',
  approvedHolidayTime: 'Approved holiday work',
  unapprovedHolidayTime: 'Holiday work without approval',
  nightTime: 'Night hours',
  nonWorkingDayTime: 'Non-working day',
  calculationPending: 'No punches yet, so there is nothing to total',
  calculationIncomplete: 'Not clocked out yet, so these totals are provisional',
  calculationVersion: 'Calculation version',
  formatDuration: (minutes) =>
    minutes === 0 ? '0m' : `${Math.floor(minutes / 60)}h ${minutes % 60}m`,
  request: 'Request',
  submitRequest: 'Submit this day for approval',
  cancelRequest: 'Cancel the request',
  requestDraft: 'Not submitted',
  requestSubmitted: 'Awaiting approval',
  requestApproved: 'Approved',
  requestReturned: 'Returned',
  requestCancelled: 'Cancelled',
  notRequestedYet: 'Not submitted yet',
  editingLocked: 'Punches for this day can no longer be added or corrected',
  approvals: 'Requests awaiting approval',
  approve: 'Approve',
  returnRequest: 'Return',
  returnReason: 'Reason for returning',
  noPendingRequests: 'No requests are awaiting approval',
  requestHistory: 'Request history',
  offlineNotice: 'You are offline. Punches stay on this device and are sent once you reconnect.',
  pendingPunches: (count) => `${count} punch(es) waiting to be sent`,
  legacyPendingPunches:
    'Some punches are stored in an older format. Their owner cannot be confirmed, so they are not sent automatically.',
  unreadablePendingPunches:
    'Unreadable pending punches remain on this device. They have been preserved separately and are not sent automatically.',
  punchBlockedAuthentication:
    'Signing in again is required. Punches waiting to be sent remain on this device and have not been deleted.',
  punchBlockedPermission:
    'Check your permissions or employee record. Punches waiting to be sent remain on this device.',
  punchBlockedRetry:
    'Punches cannot be sent right now. They remain on this device waiting to be sent.',
  punchBlockedStorageUnreadable:
    'The pending punches stored on this device cannot be checked. New punches are not accepted yet. Check the browser storage settings, then check the stored punches again.',
  punchBlockedStorageNotRecorded:
    'This punch was not recorded because it could not be stored safely on this device. Check the storage settings and available space, then punch again.',
  punchBlockedStorageRetained:
    'The pending-punch data could not be updated on this device. The same punch is being kept for a safe retry. Check the storage settings and retry.',
  recheckStoredPunches: 'Check stored punches',
  punchOwnerUnverified:
    'The user information required for punching could not be verified. Sign in again, or contact an administrator if the problem continues.',
  retryPendingPunches: 'Retry',
  sessionExpiredWithPendingPunches:
    'Your session has expired. Punches waiting to be sent remain on this device and are sent once you sign in as the same user.',
  skipToMain: 'Skip to main content',
  discrepancies: 'Differences from workstation activity',
  noDiscrepancies: 'No differences between punches and workstation activity',
  discrepancyNotice:
    'These are for review only. Punches and totals are never changed automatically.',
  discrepancyMinutes: (minutes) => `${minutes} min`,
  anomalies: 'Records that need review',
  noAnomalies: 'Nothing needs review',
  anomalyNotice: 'A detection does not mean wrongdoing. Check the evidence before deciding.',
  downloadCsv: 'Download as CSV',
  severityWarning: 'Needs review',
  severityInfo: 'For reference',
  admin: {
    title: 'Settings',
    openConsole: 'Open settings',
    backToHome: 'Back to home',
    nothingVisible: 'There are no settings you can change.',
    notVisible: 'You do not have permission to view this setting.',
    moduleTablistLabel: 'Settings modules',
    moduleOrganization: 'Organization',
    moduleEmployee: 'People',
    moduleWork: 'Work',
    moduleLeave: 'Leave',
    moduleRequest: 'Requests',
    sectionOrganizations: 'Organizations',
    sectionSites: 'Sites',
    sectionDepartments: 'Departments',
    sectionEmployees: 'Employees',
    sectionUserScopes: 'Visibility',
    sectionWorkCategories: 'Work categories',
    sectionCalculationRules: 'Calculation rule versions',
    sectionLaborSystems: 'Labour systems',
    sectionLeaveTypes: 'Leave types',
    sectionLeaveLedger: 'Leave ledger',
    sectionRequestTypes: 'Request types and approval routes',
    organizationsHint:
      'Without one, you cannot add sites, departments, or employees. Create this first.',
    sitesHint:
      'The business date turns over on the site clock. A wrong time zone shifts that site by a whole day.',
    departmentsHint: 'Point at a parent department to build a hierarchy.',
    employeesHint:
      'A sign-in account can be created at the same time. People who punch only by card or terminal do not need one.',
    userScopesHint:
      'Grants decide whose attendance a user can see. Whether they see the whole workspace is decided by their role, not here.',
    workCategoriesHint:
      'Revise by adding a version under the same code. Past results keep the version that computed them.',
    calculationRulesHint:
      'Labour calculation values are set by the operator. The product ships no defaults, and leaves legal splits uncomputed until set.',
    laborSystemsHint: 'Each system needs different values. An assignment missing them is rejected.',
    leaveTypesHint:
      'Unit of use, minutes per day, and months to expiry are set by the operator, and none apply until set.',
    leaveLedgerHint:
      'Balances are not stored; these are built from the ledger. Entries cannot be edited, so mistakes are corrected by adding a reversing entry.',
    requestTypesHint:
      'The number of approval steps is the route. Changing it does not move requests that were already submitted.',
    noRecords: 'Nothing has been registered yet.',
    noSites: 'No sites yet. Create an organization first.',
    noDepartments: 'No departments yet.',
    noEmployees: 'No employees have been registered yet.',
    noUserScopes: 'No user has been granted visibility.',
    noWorkCategories: 'No work categories yet.',
    noCalculationRules: 'No calculation rule versions yet.',
    noLaborSystems: 'No labour system assignments yet.',
    noLeaveTypes: 'No leave types yet.',
    noLeaveEntries: 'This employee has no ledger entries.',
    noRequestTypes: 'No request types yet.',
    loadFailed: 'Could not load',
    saveFailed: 'Could not save',
    save: 'Save',
    saving: 'Saving…',
    saved: 'Saved',
    addNew: 'Add new',
    editSettings: 'Edit settings',
    editRow: 'Edit this row',
    copyToForm: 'Copy into form',
    rowActions: 'Row actions',
    code: 'Code',
    codeHint: 'Letters, digits, hyphen and underscore. It cannot be changed later.',
    name: 'Name',
    internalName: 'Internal name',
    displayName: 'Name shown to employees',
    createdAt: 'Created at',
    organization: 'Organization',
    timeZone: 'Time zone',
    timeZoneHint: 'Leave empty to use the organization time zone. Example: Asia/Tokyo',
    parentDepartment: 'Parent department',
    noParentDepartment: '(no parent)',
    employeeNumber: 'Employee number',
    employee: 'Employee',
    status: 'Status',
    hiredOn: 'Hired on',
    account: 'Sign-in',
    accountNone: 'None',
    accountLinked: 'Linked',
    createAccount: 'Also create a sign-in account',
    initialPasswordHint: 'The first password. Ask the person to change it.',
    employeeStatus: { active: 'Active', suspended: 'Suspended', retired: 'Retired' },
    userId: 'User identifier',
    userIdHint: 'Paste the identifier from the user list.',
    grantedAt: 'Granted at',
    categoryType: 'Category type',
    workCategoryType: {
      working_day: 'Working day',
      non_working_day: 'Non-legal holiday',
      legal_holiday: 'Legal holiday',
      leave: 'Leave',
      absence: 'Absence',
    },
    workCategoryCodeHint: 'Splitting periods under one code makes them revisions of each other.',
    effectiveFrom: 'Effective from',
    effectiveFromHint: 'Versions under one code may not overlap.',
    effectiveTo: 'Effective to',
    openEnded: '(no end date)',
    scheduledHours: 'Scheduled hours',
    scheduledStart: 'Scheduled start',
    scheduledEnd: 'Scheduled end',
    scheduledEndHint: 'For shifts crossing midnight, write past 24, e.g. 26:00.',
    clockHint: 'Write as hours:minutes, e.g. 09:00',
    fixedBreaks: 'Fixed breaks',
    fixedBreakStart: 'Fixed break start',
    fixedBreakEnd: 'Fixed break end',
    fixedBreakHint: 'Deducted even without a punch. Leave empty to deduct nothing.',
    shift: 'Shift',
    yes: 'Yes',
    no: 'No',
    unconfigured: 'Not set',
    ruleEffectiveFromHint: 'Only one version per effective date.',
    dayStartMinutes: 'Day starts at (minutes)',
    dayStartHint: 'Move past 0 to count overnight work as the previous day.',
    nightBand: 'Night band',
    nightStartMinutes: 'Night band starts at (minutes)',
    nightEndMinutes: 'Night band ends at (minutes)',
    rounding: 'Rounding',
    roundingMinutes: 'Rounding unit (minutes)',
    roundingModeLabel: 'Rounding mode',
    roundingMode: { none: 'None', down: 'Down', nearest: 'Nearest' },
    dailyLegalMinutes: 'Daily legal threshold (minutes)',
    weeklyLegalMinutes: 'Weekly legal threshold (minutes)',
    legalThresholdHint:
      'Empty means not set, and legal splits are not computed. Not set is different from zero.',
    weekStartsOn: 'Week starts on',
    weekStartsOnHint: '0 is Sunday, 1 is Monday.',
    monthStartsOn: 'Month starts on day',
    laborSystem: 'Labour system',
    laborSystemType: {
      normal: 'Standard',
      flex: 'Flexitime',
      discretionary: 'Discretionary',
      variable: 'Variable',
    },
    settlementPeriod: 'Settlement period',
    settlementMonths: 'Settlement months',
    settlementStartsOn: 'Settlement starts on',
    settlementHint: 'Flexitime and variable systems need a settlement period.',
    deemedMinutes: 'Deemed minutes',
    deemedHint: 'Discretionary work counts these minutes regardless of what was recorded.',
    months: ' months',
    endAssignment: 'Set an end date',
    paidLeave: 'Paid',
    unitMinutes: 'Unit of use (minutes)',
    unitMinutesHint: '480 for whole days, 240 for half days, 60 for hours. Empty means no limit.',
    dayMinutes: 'Minutes per day',
    dayMinutesHint: 'Used to express days, and to deduct requests that name no time range.',
    expiresAfterMonths: 'Months until expiry',
    expiresAfterMonthsHint: 'Empty means it never expires.',
    neverExpires: 'Never expires',
    activeLabel: 'Available',
    pickLeaveTypeToEdit: 'Choose "Edit this row" on the leave type you want to change.',
    leaveType: 'Leave type',
    entryType: 'Entry type',
    leaveEntryType: {
      grant: 'Grant',
      consume: 'Use',
      expire: 'Expiry',
      adjust: 'Adjustment',
      reverse: 'Reversal',
    },
    minutes: 'Minutes',
    effectiveOn: 'Effective on',
    expiresOn: 'Expires on',
    reason: 'Reason',
    grantLeave: 'Grant leave',
    grantMinutesHint: 'In minutes. An eight-hour day is 480.',
    grantEffectiveOnHint:
      'Usable from this date. The expiry date comes from the leave type settings.',
    reverseEntry: 'Reverse',
    reversedFromConsole: 'Reversed from the settings screen',
    noBalance: 'This employee has no leave balance.',
    expiredMinutesLabel: 'Expired',
    requestCategory: 'Category',
    requestCategoryLabel: {
      leave: 'Leave',
      overtime: 'Overtime',
      holiday_work: 'Holiday work',
      attendance_correction: 'Attendance correction',
      other: 'Other',
    },
    requestCategoryHint: 'Leave requests post to the leave ledger once fully approved.',
    approvalSteps: 'Approval steps',
    approvalStepsHint:
      'One to four. Requests already submitted keep the count they were sent with.',
    requiredInputs: 'Required inputs',
    timeRange: 'Time range',
    overtimeLimit: 'Overtime limit',
    editingRequestType: 'Editing this request type.',
    stopEditing: 'Stop and add a new one',
    moduleMonthly: 'Monthly',
    sectionLeaveGrantRules: 'Grant rules and bulk grant',
    leaveGrantRulesHint:
      'Minutes granted at each length of service. Without a rule, neither the automatic nor the bulk grant gives a single minute.',
    noLeaveGrantRules: 'No rules yet. Decide the length of service and the minutes.',
    grantServiceMonths: 'Service (months)',
    grantMinutes: 'Granted (minutes)',
    grantBasis: 'Grant basis',
    grantBasisLabel: { fixed_date: 'Fixed date', hire_anniversary: 'Hire anniversary' },
    grantEffectiveOn: 'Effective on',
    runBulkGrant: 'Grant in bulk',
    bulkGrantOutcome: (granted: number, skipped: number) =>
      `Granted to ${granted}; skipped ${skipped}.`,
    sectionLeaveRegister: 'Leave register',
    leaveRegisterHint: 'Opening, granted, used, expired and closing, rebuilt from the ledger.',
    noLeaveRegister: 'No records in this range.',
    registerOpening: 'Opening (minutes)',
    registerGranted: 'Granted (minutes)',
    registerConsumed: 'Used (minutes)',
    registerExpired: 'Expired (minutes)',
    registerAdjusted: 'Adjusted (minutes)',
    registerClosing: 'Closing (minutes)',
    sectionLeaveExpirations: 'Upcoming expirations',
    leaveExpirationsHint: 'Grants expiring by the chosen date, with what is left of them.',
    noLeaveExpirations: 'Nothing expires in this range.',
    remainingMinutes: 'Remaining (minutes)',
    asOf: 'As of',
    through: 'Through',
    importCsv: 'Import CSV',
    importCsvHint:
      'Use the same columns as the exported CSV. If a single row cannot be read, nothing is imported.',
    imported: (count: number) => `Imported ${count} rows.`,
    sectionMonthlySummaries: 'Monthly totals',
    sectionPeriodSummaries: 'Period totals',
    periodSummariesHint:
      'Totals for weeks, flex settlement periods and variable working-hour periods. ' +
      'The boundaries come from the calculation rule version and the labor system assignment. ' +
      'Boundaries that are not configured do not appear.',
    noPeriodSummaries:
      'No periods to total in this range. Check the employee and the boundary settings.',
    periodKind: 'Boundary',
    periodKindLabel: { week: 'Week', settlement: 'Settlement period' },
    periodFrom: 'From',
    periodTo: 'To',
    periodTotalMinutes: 'Total allowance (minutes)',
    periodDifferenceMinutes: 'Difference from allowance (minutes)',
    periodIncludesClosedMonth: 'Includes a closed month',
    periodEmployeeHint: 'Enter the employee identifier.',
    employeeId: 'Employee',
    sectionClosingReadiness: 'Before closing',
    monthlySummariesHint:
      'These are the live totals built from daily results. Closed months also show the values fixed at closing.',
    closingReadinessHint:
      'What is still outstanding before closing. This does not block closing; the operator decides.',
    noMonthlySummaries: 'No totals for this month.',
    noClosingReadiness: 'Nothing to check for this month.',
    period: 'Month',
    periodHint: 'Pick the first day of the month.',
    workedDays: 'Days worked',
    workedMinutes: 'Worked (minutes)',
    outsideMinutes: 'Outside schedule (minutes)',
    nightMinutes: 'Night (minutes)',
    legalOvertimeMinutes: 'Legal overtime (minutes)',
    recognizedOvertimeMinutes: 'Recognized overtime (minutes)',
    unapprovedOvertimeMinutes: 'Overtime without approval (minutes)',
    leaveMinutes: 'Leave (minutes)',
    closingState: 'Closing',
    closingStateLabel: { open: 'Open', closed: 'Closed' },
    closingOpen: 'Open',
    closedTotal: 'Worked at closing (minutes)',
    driftedFromSnapshot: 'differs from live',
    blocked: 'Blocked',
    remaining: 'Outstanding',
    nothingRemaining: 'None',
    closingFinding: {
      open_work_day: 'not clocked out',
      not_requested: 'not submitted',
      not_approved: 'not approved',
      returned: 'returned and not resubmitted',
      flagged: 'has corrections',
    },
    closingSeverity: { blocking: 'Action needed', advisory: 'For reference' },
  },
};

export const MESSAGES: Record<Locale, Messages> = { 'ja-JP': ja, en };

export const LOCALE_LABELS: Record<Locale, string> = { 'ja-JP': '日本語', en: 'English' };
