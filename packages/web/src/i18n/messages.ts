import type { Locale } from '@staffweave/domain';

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
  workspace: string;
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
  unimplementedNotice: string;
  sessionExpiresAt: string;
  changePassword: string;
  currentPassword: string;
  newPassword: string;
  changingPassword: string;
  passwordChanged: string;
  passwordChangeFailed: string;
  otherSessionsSignedOut: string;
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
  outsideScheduleTime: string;
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
}

const ja: Messages = {
  appName: 'staffweave',
  tagline: 'セルフホスト可能な勤怠管理基盤',
  signIn: 'ログイン',
  signOut: 'ログアウト',
  email: 'メールアドレス',
  password: 'パスワード',
  workspace: 'ワークスペース',
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
  unimplementedNotice: '休憩、勤務時間の計算、申請・承認はまだ実装されていません。',
  sessionExpiresAt: 'セッション有効期限',
  changePassword: 'パスワードの変更',
  currentPassword: '現在のパスワード',
  newPassword: '新しいパスワード',
  changingPassword: '変更しています…',
  passwordChanged: 'パスワードを変更しました',
  passwordChangeFailed: 'パスワードを変更できませんでした',
  otherSessionsSignedOut: '他の端末のセッションはログアウトしました。',
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
  outsideScheduleTime: '所定外',
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
};

const en: Messages = {
  appName: 'staffweave',
  tagline: 'Self-hostable workforce time and attendance platform',
  signIn: 'Sign in',
  signOut: 'Sign out',
  email: 'Email address',
  password: 'Password',
  workspace: 'Workspace',
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
  unimplementedNotice: 'Breaks, worked-time calculation, and approvals are not implemented yet.',
  sessionExpiresAt: 'Session expires at',
  changePassword: 'Change password',
  currentPassword: 'Current password',
  newPassword: 'New password',
  changingPassword: 'Changing…',
  passwordChanged: 'Password changed',
  passwordChangeFailed: 'Could not change the password',
  otherSessionsSignedOut: 'Sessions on other devices have been signed out.',
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
  outsideScheduleTime: 'Outside schedule',
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
};

export const MESSAGES: Record<Locale, Messages> = { 'ja-JP': ja, en };

export const LOCALE_LABELS: Record<Locale, string> = { 'ja-JP': '日本語', en: 'English' };
