import type { SessionResponse } from '@staffweave/contracts';
import type { Locale, Role } from '@staffweave/domain';
import {
  expiresAtFrom,
  normalizeEmail,
  permissionsOf,
  sessionStateAt,
  shouldRenew,
} from '@staffweave/domain';
import { ApiError, unauthenticated } from '../shared/errors.js';
import { hashPassword, verifyPassword } from '../shared/security/password.js';
import { generateToken, hashToken } from '../shared/security/tokens.js';
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
  /** 勤怠を見られる組織。空なら制限なし（ワークスペース全体）。 */
  organizationScopes: string[];
  sessionExpiresAt: Date;
}

export interface IdentityServiceDependencies {
  repository: IdentityRepository;
  now: () => Date;
  /** ログイン時にワークスペースが指定されなかった場合の既定値。 */
  defaultWorkspaceSlug: string;
}

export interface LoginInput {
  email: string;
  password: string;
  workspaceSlug?: string;
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  context: AuthenticatedContext;
}

export interface IdentityService {
  login(input: LoginInput): Promise<LoginResult>;
  /** Cookie のトークンから認証情報を復元する。無効なら null。 */
  authenticate(token: string | undefined): Promise<AuthenticatedContext | null>;
  logout(token: string | undefined): Promise<void>;
  updateLocale(context: AuthenticatedContext, locale: Locale): Promise<AuthenticatedContext>;
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

  async function loadContext(
    workspace: WorkspaceRecord,
    user: UserRecord,
    sessionExpiresAt: Date,
  ): Promise<AuthenticatedContext> {
    const [roles, employee, organizationScopes] = await Promise.all([
      repository.listRoles(workspace.id, user.id),
      repository.findEmployeeByUserId(workspace.id, user.id),
      repository.listOrganizationScopes(workspace.id, user.id),
    ]);
    return { workspace, user, roles, employee, organizationScopes, sessionExpiresAt };
  }

  return {
    async login(input) {
      const slug = input.workspaceSlug ?? deps.defaultWorkspaceSlug;
      const workspace = await repository.findWorkspaceBySlug(slug);
      const email = normalizeEmail(input.email);
      const user = workspace ? await repository.findUserByEmail(workspace.id, email) : null;

      const matched = await verifyPassword(
        input.password,
        user?.passwordHash ?? (await placeholderPasswordHash()),
      );

      if (!workspace || !user || !matched || user.status !== 'active') {
        throw new ApiError('unauthenticated', 'メールアドレスまたはパスワードが正しくありません');
      }

      const issuedAt = now();
      const expiresAt = expiresAtFrom(issuedAt);
      const token = generateToken();
      await repository.createSession({
        workspaceId: workspace.id,
        userId: user.id,
        tokenHash: hashToken(token),
        issuedAt,
        expiresAt,
      });

      return { token, expiresAt, context: await loadContext(workspace, user, expiresAt) };
    },

    async authenticate(token) {
      if (!token) return null;
      const session = await repository.findSessionByTokenHash(hashToken(token));
      if (!session) return null;

      const current = now();
      if (sessionStateAt(session, current) !== 'active') return null;

      const [workspace, user] = await Promise.all([
        repository.findWorkspaceById(session.workspaceId),
        repository.findUserById(session.workspaceId, session.userId),
      ]);
      if (!workspace || !user || user.status !== 'active') return null;

      let expiresAt = session.expiresAt;
      if (shouldRenew(session, current)) {
        expiresAt = expiresAtFrom(current);
        await repository.renewSession(session.id, expiresAt, current);
      }

      return loadContext(workspace, user, expiresAt);
    },

    async logout(token) {
      if (!token) return;
      await repository.revokeSessionByTokenHash(hashToken(token), now());
    },

    async updateLocale(context, locale) {
      await repository.updateUserLocale(context.workspace.id, context.user.id, locale);
      return { ...context, user: { ...context.user, locale } };
    },
  };
}

export function requireContext(context: AuthenticatedContext | null): AuthenticatedContext {
  if (!context) throw unauthenticated();
  return context;
}
