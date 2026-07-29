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
  notPermitted: string;
  unimplementedNotice: string;
  sessionExpiresAt: string;
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
  showHistory: string;
  correctedMark: string;
  actionAdjust: string;
  actionVoid: string;
  actionAdd: string;
  originalPunch: string;
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
  notPermitted: 'この情報を表示する権限がありません',
  unimplementedNotice: '休憩、勤務時間の計算、申請・承認はまだ実装されていません。',
  sessionExpiresAt: 'セッション有効期限',
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
  showHistory: '履歴を表示',
  correctedMark: '修正済み',
  actionAdjust: '修正',
  actionVoid: '取消',
  actionAdd: '追加',
  originalPunch: '元の打刻',
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
  notPermitted: 'You do not have permission to view this',
  unimplementedNotice: 'Breaks, worked-time calculation, and approvals are not implemented yet.',
  sessionExpiresAt: 'Session expires at',
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
  showHistory: 'Show history',
  correctedMark: 'Corrected',
  actionAdjust: 'Adjust',
  actionVoid: 'Void',
  actionAdd: 'Add',
  originalPunch: 'Original punch',
};

export const MESSAGES: Record<Locale, Messages> = { 'ja-JP': ja, en };

export const LOCALE_LABELS: Record<Locale, string> = { 'ja-JP': '日本語', en: 'English' };
