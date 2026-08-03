import type { SessionResponse, SessionSummary } from '@staffweave/contracts';
import type { Locale, LoginAttemptPolicy, Role } from '@staffweave/domain';
import {
  absoluteExpiresAtFrom,
  afterLoginFailure,
  expiresAtFrom,
  isLoginBlocked,
  normalizeEmail,
  permissionsOf,
  renewedExpiresAt,
  sessionStateAt,
  shouldRenew,
  summarizeUserAgent,
  validatePassword,
} from '@staffweave/domain';
import type { AuditRepository } from '../audit/repository.js';
import { ApiError, invalidRequest } from '../shared/errors.js';
import type { StructuredLogger } from '../shared/logger.js';
import { hashPassword, verifyPassword } from '../shared/security/password.js';
import { generateToken, hashToken } from '../shared/security/tokens.js';
import type { LoginAttemptRepository, LoginAttemptScope } from './login-attempt-repository.js';
import type {
  EmployeeLinkRecord,
  IdentityRepository,
  UserRecord,
  WorkspaceRecord,
} from './repository.js';

/**
 * 存在しない利用者でも照合処理を走らせ、応答時間の差から
 * 「そのメールアドレスが登録されているか」が分からないようにするためのダミー。
 */
let absentUserPasswordHash: string | undefined;

async function placeholderPasswordHash(): Promise<string> {
  absentUserPasswordHash ??= await hashPassword('staffweave-absent-user-placeholder');
  return absentUserPasswordHash;
}

export interface AuthenticatedContext {
  workspace: WorkspaceRecord;
  user: UserRecord;
  roles: Role[];
  employee: EmployeeLinkRecord | null;
  /**
   * 閲覧対象として明示的に与えられた組織。
   * 空配列は管理対象の組織がないことを表す。ワークスペース全体を見られるかどうかは
   * ここではなく `workspace_admin` ロールが決める。
   */
  organizationScopes: string[];
  /** いま使っているセッション。一覧で「この端末」を示し、自分自身を失効させないために持つ。 */
  sessionId: string;
  sessionExpiresAt: Date;
}

export interface IdentityServiceDependencies {
  repository: IdentityRepository;
  now: () => Date;
  /** ログイン時にワークスペースが指定されなかった場合の既定値。 */
  defaultWorkspaceSlug: string;
  /** 失敗の回数を数える先。 */
  loginAttempts: LoginAttemptRepository;
  /** 何回で断るか、いつ数え直すか。単位ごとに分ける。 */
  loginAttemptPolicy: { account: LoginAttemptPolicy; source: LoginAttemptPolicy };
  /** 断ったことを記録する先。応答では断ったことを区別できるようにしない。 */
  logger: StructuredLogger;
  /** パスワードの変更を残す先。秘密値そのものは残さない。 */
  audit: AuditRepository;
}

export interface LoginInput {
  email: string;
  password: string;
  workspaceSlug?: string;
  /**
   * 送信元を表す値。分からない場合は省略する。
   * 省略すると、その要求は送信元では数えない（利用者ごとの制限は効く）。
   */
  source?: string;
  /**
   * 端末の名乗り。一覧で端末を見分けるための系統だけを取り出して保存する。
   * 名乗りそのものは保存しない。判別できなくてもログインは断らない。
   */
  userAgent?: string;
}

export interface LoginResult {
  token: string;
  /** アイドル期限。操作が続けば延びる。 */
  expiresAt: Date;
  /** 絶対期限。操作が続いても延びない。Cookie の保持期間はこちらに合わせる。 */
  absoluteExpiresAt: Date;
  context: AuthenticatedContext;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface IdentityService {
  login(input: LoginInput): Promise<LoginResult>;
  /**
   * 本人のパスワードを変える。
   *
   * 現在のパスワードを確かめてから変更し、他のセッションを失効させる。
   * 手元のセッションだけは残し、変更した本人を締め出さない。
   */
  changePassword(context: AuthenticatedContext, input: ChangePasswordInput): Promise<void>;
  /** Cookie のトークンから認証情報を復元する。無効なら null。 */
  authenticate(token: string | undefined): Promise<AuthenticatedContext | null>;
  logout(token: string | undefined): Promise<void>;
  updateLocale(context: AuthenticatedContext, locale: Locale): Promise<AuthenticatedContext>;
  /** 本人の、まだ有効なセッションを新しい順に返す。 */
  listSessions(context: AuthenticatedContext): Promise<SessionSummary[]>;
  /**
   * 本人のセッションを 1 件失効させる。
   *
   * いま使っているセッションは断る。一覧から自分を消してしまうと、
   * 画面は残ったまま次の要求で締め出される。手元を終わらせるのはログアウトの役目。
   */
  revokeSession(context: AuthenticatedContext, sessionId: string): Promise<void>;
  /** いま使っているセッション以外をまとめて失効させ、失効させた件数を返す。 */
  revokeOtherSessions(context: AuthenticatedContext): Promise<number>;
}

export function toSessionResponse(context: AuthenticatedContext): SessionResponse {
  return {
    workspace: {
      id: context.workspace.id,
      slug: context.workspace.slug,
      name: context.workspace.name,
      timeZone: context.workspace.timeZone,
    },
    user: {
      id: context.user.id,
      email: context.user.email,
      displayName: context.user.displayName,
      locale: context.user.locale,
      roles: context.roles,
      permissions: permissionsOf(context.roles),
      organizationScopes: context.organizationScopes,
    },
    employee: context.employee,
    expiresAt: context.sessionExpiresAt.toISOString(),
  };
}

export function createIdentityService(deps: IdentityServiceDependencies): IdentityService {
  const { repository, now } = deps;

  /** 断っている単位があればその名前を返す。断っていなければ null。 */
  async function blockedScope(
    accountKey: string,
    source: string | undefined,
    at: Date,
  ): Promise<LoginAttemptScope | null> {
    if (isLoginBlocked(await deps.loginAttempts.find('account', accountKey), at)) return 'account';
    if (source === undefined) return null;
    return isLoginBlocked(await deps.loginAttempts.find('source', source), at) ? 'source' : null;
  }

  /** 失敗を数える。単位ごとに別の基準で数え、片方が断っても他方は数え続ける。 */
  async function countFailure(
    accountKey: string,
    source: string | undefined,
    at: Date,
  ): Promise<void> {
    const scopes: [LoginAttemptScope, string, LoginAttemptPolicy][] = [
      ['account', accountKey, deps.loginAttemptPolicy.account],
      ...(source === undefined
        ? []
        : ([['source', source, deps.loginAttemptPolicy.source]] as [
            LoginAttemptScope,
            string,
            LoginAttemptPolicy,
          ][])),
    ];

    for (const [scope, key, policy] of scopes) {
      const next = afterLoginFailure(await deps.loginAttempts.find(scope, key), at, policy);
      await deps.loginAttempts.save(scope, key, next);
      if (next.blockedUntil !== null) {
        deps.logger.info('auth.login_blocking', { scope, failures: next.failures });
      }
    }
  }

  async function loadContext(
    workspace: WorkspaceRecord,
    user: UserRecord,
    sessionId: string,
    sessionExpiresAt: Date,
  ): Promise<AuthenticatedContext> {
    const [roles, employee, organizationScopes] = await Promise.all([
      repository.listRoles(workspace.id, user.id),
      repository.findEmployeeByUserId(workspace.id, user.id),
      repository.listOrganizationScopes(workspace.id, user.id),
    ]);
    return { workspace, user, roles, employee, organizationScopes, sessionId, sessionExpiresAt };
  }

  return {
    async login(input) {
      const slug = input.workspaceSlug ?? deps.defaultWorkspaceSlug;
      const email = normalizeEmail(input.email);
      // 利用者が実在するかに関わらず同じ鍵で数える。数え方から登録の有無を漏らさない。
      const accountKey = `${slug} ${email}`;
      const current = now();

      // 断っている相手には、照合そのものを行わない。
      // 応答を返すためだけに scrypt を走らせると、断っていても資源を使わせられる。
      const blocked = await blockedScope(accountKey, input.source, current);
      if (blocked !== null) {
        deps.logger.info('auth.login_blocked', { scope: blocked, workspaceSlug: slug });
        throw new ApiError('unauthenticated', 'メールアドレスまたはパスワードが正しくありません');
      }

      const workspace = await repository.findWorkspaceBySlug(slug);
      const user = workspace ? await repository.findUserByEmail(workspace.id, email) : null;

      const matched = await verifyPassword(
        input.password,
        user?.passwordHash ?? (await placeholderPasswordHash()),
      );

      if (!workspace || !user || !matched || user.status !== 'active') {
        await countFailure(accountKey, input.source, current);
        throw new ApiError('unauthenticated', 'メールアドレスまたはパスワードが正しくありません');
      }

      // 入れた時点で、その利用者への失敗の記録は用済み。
      // 送信元の記録は残す。正しい資格情報を 1 つ持つだけで数え直せてしまうため。
      await deps.loginAttempts.clear('account', accountKey);

      const issuedAt = now();
      const expiresAt = expiresAtFrom(issuedAt);
      const token = generateToken();
      // 名乗りは系統へ落としてから渡す。生の値をこの先へ持って行かない。
      const device = summarizeUserAgent(input.userAgent);
      const session = await repository.createSession({
        workspaceId: workspace.id,
        userId: user.id,
        tokenHash: hashToken(token),
        issuedAt,
        expiresAt,
        ...(device === null ? {} : { device }),
      });

      return {
        token,
        expiresAt,
        absoluteExpiresAt: absoluteExpiresAtFrom(issuedAt),
        context: await loadContext(workspace, user, session.id, expiresAt),
      };
    },

    async authenticate(token) {
      if (!token) return null;
      // 認証は要求のたびに通る。復元に要る一式は 1 回で読む。
      const found = await repository.findSessionContextByTokenHash(hashToken(token));
      if (!found) return null;

      const { session, workspace, user } = found;
      const current = now();
      if (sessionStateAt(session, current) !== 'active') return null;
      if (user.status !== 'active') return null;

      let expiresAt = session.expiresAt;
      if (shouldRenew(session, current)) {
        expiresAt = renewedExpiresAt(session, current);
        await repository.renewSession(session.id, expiresAt, current);
      }

      return {
        workspace,
        user,
        roles: found.roles,
        employee: found.employee,
        organizationScopes: found.organizationScopes,
        sessionId: session.id,
        sessionExpiresAt: expiresAt,
      };
    },

    async changePassword(context, input) {
      const { workspace, user } = context;
      // 現在のパスワードを確かめる。漏れた Cookie だけで変えられないようにする。
      if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
        throw new ApiError('unauthenticated', '現在のパスワードが正しくありません');
      }

      const problems = validatePassword(input.newPassword);
      if (problems.length > 0) {
        throw invalidRequest(
          problems.map((problem) => ({ field: 'newPassword', message: problem })),
        );
      }

      await repository.updateUserPassword(
        workspace.id,
        user.id,
        await hashPassword(input.newPassword),
      );

      // 古いパスワードで開かれたセッションは、変更の時点で終わらせる。
      const revoked = await repository.revokeSessionsOfUser({
        workspaceId: workspace.id,
        userId: user.id,
        revokedAt: now(),
        exceptSessionId: context.sessionId,
      });

      // 記録するのは変更が行われた事実だけ。古い値も新しい値も残さない。
      await deps.audit.record(workspace.id, {
        actorKind: 'user',
        actorUserId: user.id,
        action: 'auth.password_changed',
        targetType: 'user',
        targetId: user.id,
        summary: 'パスワードを変更しました',
        detail: { revokedSessions: revoked },
      });
    },

    async logout(token) {
      if (!token) return;
      await repository.revokeSessionByTokenHash(hashToken(token), now());
    },

    async updateLocale(context, locale) {
      await repository.updateUserLocale(context.workspace.id, context.user.id, locale);
      return { ...context, user: { ...context.user, locale } };
    },

    async listSessions(context) {
      const current = now();
      const rows = await repository.listSessionsOfUser(context.workspace.id, context.user.id);
      // 期限切れは保存の層では落とせない。絶対期限は発行時刻から決まるため、
      // 期限の判定はドメインの 1 か所に任せる。
      return rows
        .filter((row) => sessionStateAt(row, current) === 'active')
        .map((row) => ({
          id: row.id,
          current: row.id === context.sessionId,
          device: row.device,
          issuedAt: row.issuedAt.toISOString(),
          lastSeenAt: row.lastSeenAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
        }));
    },

    async revokeSession(context, sessionId) {
      if (sessionId === context.sessionId) {
        throw invalidRequest([
          {
            field: 'sessionId',
            message: 'いま使っているセッションは、ログアウトで終了してください',
          },
        ]);
      }

      const revoked = await repository.revokeSessionOfUser({
        workspaceId: context.workspace.id,
        userId: context.user.id,
        sessionId,
        revokedAt: now(),
      });
      // 他人のセッションも、すでに失効しているセッションも同じ応答にする。
      // 区別できると、識別子を当てて「そのセッションが存在するか」を確かめられる。
      if (!revoked) throw new ApiError('not_found', 'セッションが見つかりません');

      await deps.audit.record(context.workspace.id, {
        actorKind: 'user',
        actorUserId: context.user.id,
        action: 'auth.session_revoked',
        targetType: 'session',
        targetId: sessionId,
        summary: 'セッションを失効させました',
      });
    },

    async revokeOtherSessions(context) {
      // 残す 1 件は識別子で指定する。トークンの持ち回りを増やさない。
      const revoked = await repository.revokeSessionsOfUser({
        workspaceId: context.workspace.id,
        userId: context.user.id,
        revokedAt: now(),
        exceptSessionId: context.sessionId,
      });

      await deps.audit.record(context.workspace.id, {
        actorKind: 'user',
        actorUserId: context.user.id,
        action: 'auth.other_sessions_revoked',
        targetType: 'user',
        targetId: context.user.id,
        summary: '他の端末のセッションを失効させました',
        detail: { revokedSessions: revoked },
      });

      return revoked;
    },
  };
}
