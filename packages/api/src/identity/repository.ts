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

export interface IdentityRepository {
  findWorkspaceBySlug(slug: string): Promise<WorkspaceRecord | null>;
  findWorkspaceById(workspaceId: string): Promise<WorkspaceRecord | null>;
  findUserByEmail(workspaceId: string, email: string): Promise<UserRecord | null>;
  findUserById(workspaceId: string, userId: string): Promise<UserRecord | null>;
  listRoles(workspaceId: string, userId: string): Promise<Role[]>;
  findEmployeeByUserId(workspaceId: string, userId: string): Promise<EmployeeLinkRecord | null>;
  updateUserLocale(workspaceId: string, userId: string, locale: Locale): Promise<void>;
  createSession(input: {
    workspaceId: string;
    userId: string;
    tokenHash: string;
    issuedAt: Date;
    expiresAt: Date;
  }): Promise<SessionRecord>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  renewSession(sessionId: string, expiresAt: Date, seenAt: Date): Promise<void>;
  revokeSessionByTokenHash(tokenHash: string, revokedAt: Date): Promise<void>;
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

    async findWorkspaceById(workspaceId) {
      const rows = await db.query<WorkspaceRow>(
        'SELECT id, slug, name, time_zone FROM workspaces WHERE id = $1',
        [workspaceId],
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

    async findUserById(workspaceId, userId) {
      const rows = await db.query<UserRow>(
        `SELECT id, workspace_id, email, password_hash, display_name, locale, status
           FROM users
          WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, userId],
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

    async findSessionByTokenHash(tokenHash) {
      const rows = await db.query<SessionRow>(
        `SELECT id, workspace_id, user_id, issued_at, expires_at, revoked_at
           FROM sessions
          WHERE token_hash = $1`,
        [tokenHash],
      );
      return rows[0] ? toSession(rows[0]) : null;
    },

    async renewSession(sessionId, expiresAt, seenAt) {
      await db.query('UPDATE sessions SET expires_at = $2, last_seen_at = $3 WHERE id = $1', [
        sessionId,
        expiresAt,
        seenAt,
      ]);
    },

    async revokeSessionByTokenHash(tokenHash, revokedAt) {
      await db.query(
        'UPDATE sessions SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL',
        [tokenHash, revokedAt],
      );
    },
  };
}
