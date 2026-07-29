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
  unimplementedNotice: '打刻などの勤怠機能はまだ実装されていません。',
  sessionExpiresAt: 'セッション有効期限',
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
  unimplementedNotice: 'Time tracking features are not implemented yet.',
  sessionExpiresAt: 'Session expires at',
};

export const MESSAGES: Record<Locale, Messages> = { 'ja-JP': ja, en };

export const LOCALE_LABELS: Record<Locale, string> = { 'ja-JP': '日本語', en: 'English' };
