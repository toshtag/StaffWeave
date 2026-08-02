import type { Queryable } from '@staffweave/db';
import type { Locale, Role } from '@staffweave/domain';

/**
 * 認証・利用者まわりの永続化。
 *
 * すべてのメソッドはワークスペースを跨いだ読み書きができない形にする。
 * セッションはトークンのハッシュからワークスペースを決めるため、これだけが例外的に
 * ワークスペース指定なしで引ける。
 */

export interface WorkspaceRecord {
  id: string;
  slug: string;
  name: string;
  timeZone: string;
}

export interface UserRecord {
  id: string;
  workspaceId: string;
  email: string;
  passwordHash: string;
  displayName: string;
  locale: Locale;
  status: 'active' | 'suspended';
}

export interface EmployeeLinkRecord {
  id: string;
  employeeNumber: string;
  displayName: string;
  organizationId: string;
}

export interface SessionRecord {
  id: string;
  workspaceId: string;
  userId: string;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

/**
 * セッションから一意に決まる一式。
 * 要求のたびに復元するため、分けて引かず 1 回で読む。
 */
export interface SessionContextRecord {
  session: SessionRecord;
  workspace: WorkspaceRecord;
  user: UserRecord;
  roles: Role[];
  employee: EmployeeLinkRecord | null;
  organizationScopes: string[];
}

export interface IdentityRepository {
  findWorkspaceBySlug(slug: string): Promise<WorkspaceRecord | null>;
  findUserByEmail(workspaceId: string, email: string): Promise<UserRecord | null>;
  listRoles(workspaceId: string, userId: string): Promise<Role[]>;
  /**
   * 利用者へ明示的に与えられた閲覧対象の組織。
   * 空配列は管理対象の組織がないことを表す。全体の閲覧可否はロールが決める。
   */
  listOrganizationScopes(workspaceId: string, userId: string): Promise<string[]>;
  findEmployeeByUserId(workspaceId: string, userId: string): Promise<EmployeeLinkRecord | null>;
  updateUserLocale(workspaceId: string, userId: string, locale: Locale): Promise<void>;
  updateUserPassword(workspaceId: string, userId: string, passwordHash: string): Promise<void>;
  createSession(input: {
    workspaceId: string;
    userId: string;
    tokenHash: string;
    issuedAt: Date;
    expiresAt: Date;
  }): Promise<SessionRecord>;
  /**
   * トークンのハッシュから、認証に要る一式をまとめて引く。
   * セッション・ワークスペース・利用者・ロール・従業員・閲覧範囲はすべて
   * セッションから外部キーでたどれるため、分けて引く理由がない。
   */
  findSessionContextByTokenHash(tokenHash: string): Promise<SessionContextRecord | null>;
  renewSession(sessionId: string, expiresAt: Date, seenAt: Date): Promise<void>;
  revokeSessionByTokenHash(tokenHash: string, revokedAt: Date): Promise<void>;
  /**
   * 利用者のセッションをまとめて失効させる。
   *
   * `exceptTokenHash` を渡すと、そのセッションだけ残す。
   * パスワードを変えた本人を、その場でログアウトさせないため。
   */
  revokeSessionsOfUser(input: {
    workspaceId: string;
    userId: string;
    revokedAt: Date;
    exceptTokenHash?: string;
  }): Promise<number>;
}

interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  time_zone: string;
}

interface UserRow {
  id: string;
  workspace_id: string;
  email: string;
  password_hash: string;
  display_name: string;
  locale: Locale;
  status: 'active' | 'suspended';
}

interface SessionRow {
  id: string;
  workspace_id: string;
  user_id: string;
  issued_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

function toWorkspace(row: WorkspaceRow): WorkspaceRecord {
  return { id: row.id, slug: row.slug, name: row.name, timeZone: row.time_zone };
}

function toUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    email: row.email,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    locale: row.locale,
    status: row.status,
  };
}

interface SessionContextRow extends SessionRow {
  slug: string;
  workspace_name: string;
  time_zone: string;
  email: string;
  password_hash: string;
  user_display_name: string;
  locale: Locale;
  status: 'active' | 'suspended';
  employee_id: string | null;
  employee_number: string | null;
  employee_display_name: string | null;
  organization_id: string | null;
  roles: Role[];
  organization_ids: string[];
}

function toSessionContext(row: SessionContextRow): SessionContextRecord {
  return {
    session: toSession(row),
    workspace: {
      id: row.workspace_id,
      slug: row.slug,
      name: row.workspace_name,
      timeZone: row.time_zone,
    },
    user: {
      id: row.user_id,
      workspaceId: row.workspace_id,
      email: row.email,
      passwordHash: row.password_hash,
      displayName: row.user_display_name,
      locale: row.locale,
      status: row.status,
    },
    roles: row.roles,
    employee:
      row.employee_id === null ||
      row.employee_number === null ||
      row.employee_display_name === null ||
      row.organization_id === null
        ? null
        : {
            id: row.employee_id,
            employeeNumber: row.employee_number,
            displayName: row.employee_display_name,
            organizationId: row.organization_id,
          },
    organizationScopes: row.organization_ids,
  };
}

function toSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export function createIdentityRepository(db: Queryable): IdentityRepository {
  return {
    async findWorkspaceBySlug(slug) {
      const rows = await db.query<WorkspaceRow>(
        'SELECT id, slug, name, time_zone FROM workspaces WHERE slug = $1',
        [slug],
      );
      return rows[0] ? toWorkspace(rows[0]) : null;
    },

    async findUserByEmail(workspaceId, email) {
      const rows = await db.query<UserRow>(
        `SELECT id, workspace_id, email, password_hash, display_name, locale, status
           FROM users
          WHERE workspace_id = $1 AND email = $2`,
        [workspaceId, email],
      );
      return rows[0] ? toUser(rows[0]) : null;
    },

    async listRoles(workspaceId, userId) {
      const rows = await db.query<{ role: Role }>(
        'SELECT role FROM user_roles WHERE workspace_id = $1 AND user_id = $2 ORDER BY role',
        [workspaceId, userId],
      );
      return rows.map((row) => row.role);
    },

    async listOrganizationScopes(workspaceId, userId) {
      const rows = await db.query<{ organization_id: string }>(
        `SELECT organization_id FROM user_organization_scopes
          WHERE workspace_id = $1 AND user_id = $2 ORDER BY organization_id`,
        [workspaceId, userId],
      );
      return rows.map((row) => row.organization_id);
    },

    async findEmployeeByUserId(workspaceId, userId) {
      const rows = await db.query<{
        id: string;
        employee_number: string;
        display_name: string;
        organization_id: string;
      }>(
        `SELECT id, employee_number, display_name, organization_id
           FROM employees
          WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceId, userId],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        employeeNumber: row.employee_number,
        displayName: row.display_name,
        organizationId: row.organization_id,
      };
    },

    async updateUserLocale(workspaceId, userId, locale) {
      await db.query(
        'UPDATE users SET locale = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2',
        [workspaceId, userId, locale],
      );
    },

    async updateUserPassword(workspaceId, userId, passwordHash) {
      await db.query(
        'UPDATE users SET password_hash = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2',
        [workspaceId, userId, passwordHash],
      );
    },

    async createSession(input) {
      const rows = await db.query<SessionRow>(
        `INSERT INTO sessions (workspace_id, user_id, token_hash, issued_at, expires_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $4)
         RETURNING id, workspace_id, user_id, issued_at, expires_at, revoked_at`,
        [input.workspaceId, input.userId, input.tokenHash, input.issuedAt, input.expiresAt],
      );
      const row = rows[0];
      if (!row) throw new Error('セッションを作成できませんでした');
      return toSession(row);
    },

    async findSessionContextByTokenHash(tokenHash) {
      const rows = await db.query<SessionContextRow>(
        `SELECT sessions.id,
                sessions.workspace_id,
                sessions.user_id,
                sessions.issued_at,
                sessions.expires_at,
                sessions.revoked_at,
                workspaces.slug,
                workspaces.name AS workspace_name,
                workspaces.time_zone,
                users.email,
                users.password_hash,
                users.display_name AS user_display_name,
                users.locale,
                users.status,
                employees.id AS employee_id,
                employees.employee_number,
                employees.display_name AS employee_display_name,
                employees.organization_id,
                coalesce(granted.roles, '{}') AS roles,
                coalesce(scoped.organization_ids, '{}') AS organization_ids
           FROM sessions
           JOIN workspaces ON workspaces.id = sessions.workspace_id
           JOIN users
             ON users.id = sessions.user_id
            AND users.workspace_id = sessions.workspace_id
           LEFT JOIN employees
             ON employees.user_id = users.id
            AND employees.workspace_id = sessions.workspace_id
           -- 並び順は分けて引いていたときと同じにする。応答へそのまま出る。
           LEFT JOIN LATERAL (
             SELECT array_agg(user_roles.role ORDER BY user_roles.role) AS roles
               FROM user_roles
              WHERE user_roles.workspace_id = sessions.workspace_id
                AND user_roles.user_id = sessions.user_id
           ) AS granted ON true
           LEFT JOIN LATERAL (
             SELECT array_agg(scopes.organization_id ORDER BY scopes.organization_id)
                      AS organization_ids
               FROM user_organization_scopes AS scopes
              WHERE scopes.workspace_id = sessions.workspace_id
                AND scopes.user_id = sessions.user_id
           ) AS scoped ON true
          WHERE sessions.token_hash = $1`,
        [tokenHash],
      );
      const row = rows[0];
      return row ? toSessionContext(row) : null;
    },

    async renewSession(sessionId, expiresAt, seenAt) {
      await db.query('UPDATE sessions SET expires_at = $2, last_seen_at = $3 WHERE id = $1', [
        sessionId,
        expiresAt,
        seenAt,
      ]);
    },

    async revokeSessionsOfUser(input) {
      const rows = await db.query<{ id: string }>(
        `UPDATE sessions
            SET revoked_at = $3
          WHERE workspace_id = $1
            AND user_id = $2
            AND revoked_at IS NULL
            AND ($4::text IS NULL OR token_hash <> $4)
          RETURNING id`,
        [input.workspaceId, input.userId, input.revokedAt, input.exceptTokenHash ?? null],
      );
      return rows.length;
    },

    async revokeSessionByTokenHash(tokenHash, revokedAt) {
      await db.query(
        'UPDATE sessions SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL',
        [tokenHash, revokedAt],
      );
    },
  };
}
