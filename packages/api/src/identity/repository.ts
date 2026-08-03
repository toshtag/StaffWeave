import type { Queryable } from '@staffweave/db';
import type {
  DeviceBrowser,
  DeviceKind,
  DeviceOs,
  DeviceSummary,
  Locale,
  Role,
} from '@staffweave/domain';

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
 * 一覧に出す 1 件。
 *
 * 端末は判別できた系統だけを持つ。この列を持つ前に開いたセッションは、
 * 3 つとも判別できなかったセッションと同じく `device` が null になる。
 * 保存していない名乗りを、こちらの推測で埋めない。
 */
export interface SessionSummaryRecord extends SessionRecord {
  lastSeenAt: Date;
  device: DeviceSummary | null;
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
    /** 端末を判別できなかった場合は省略する。生の名乗りは受け取らない。 */
    device?: DeviceSummary;
  }): Promise<SessionRecord>;
  /**
   * 利用者の、まだ失効していないセッションを新しい順に返す。
   *
   * 期限切れは呼び出し側が落とす。期限の判定は絶対期限も見るため、
   * SQL の `expires_at` だけでは決まらない。ここで半分だけ判定すると、
   * 判定の正本が二か所になる。
   */
  listSessionsOfUser(workspaceId: string, userId: string): Promise<SessionSummaryRecord[]>;
  /**
   * 利用者の特定のセッションを 1 件失効させる。
   *
   * 失効させたら true。他人のセッション、他のワークスペースのセッション、
   * すでに失効しているセッションはいずれも false を返す。
   * 「無い」と「自分のものではない」を呼び出し側から区別できないようにする。
   */
  revokeSessionOfUser(input: {
    workspaceId: string;
    userId: string;
    sessionId: string;
    revokedAt: Date;
  }): Promise<boolean>;
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
   * `exceptSessionId` を渡すと、そのセッションだけ残す。
   * パスワードを変えた本人や、他の端末を切った本人を、その場で締め出さないため。
   */
  revokeSessionsOfUser(input: {
    workspaceId: string;
    userId: string;
    revokedAt: Date;
    exceptSessionId?: string;
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

interface SessionSummaryRow extends SessionRow {
  last_seen_at: Date;
  device_os: DeviceOs | null;
  device_browser: DeviceBrowser | null;
  device_kind: DeviceKind | null;
}

function toSessionSummary(row: SessionSummaryRow): SessionSummaryRecord {
  // 3 つとも判別できていない行は、端末情報なしとして 1 つの null にまとめる。
  // 画面が「何も分からない」を 3 回書き分けずに済む。
  const device =
    row.device_os === null && row.device_browser === null && row.device_kind === null
      ? null
      : { os: row.device_os, browser: row.device_browser, kind: row.device_kind };
  return { ...toSession(row), lastSeenAt: row.last_seen_at, device };
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
        `INSERT INTO sessions
           (workspace_id, user_id, token_hash, issued_at, expires_at, last_seen_at,
            device_os, device_browser, device_kind)
         VALUES ($1, $2, $3, $4, $5, $4, $6, $7, $8)
         RETURNING id, workspace_id, user_id, issued_at, expires_at, revoked_at`,
        [
          input.workspaceId,
          input.userId,
          input.tokenHash,
          input.issuedAt,
          input.expiresAt,
          input.device?.os ?? null,
          input.device?.browser ?? null,
          input.device?.kind ?? null,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('セッションを作成できませんでした');
      return toSession(row);
    },

    async listSessionsOfUser(workspaceId, userId) {
      const rows = await db.query<SessionSummaryRow>(
        `SELECT id, workspace_id, user_id, issued_at, expires_at, revoked_at, last_seen_at,
                device_os, device_browser, device_kind
           FROM sessions
          WHERE workspace_id = $1
            AND user_id = $2
            AND revoked_at IS NULL
          ORDER BY issued_at DESC`,
        [workspaceId, userId],
      );
      return rows.map(toSessionSummary);
    },

    async revokeSessionOfUser(input) {
      // ワークスペースと利用者を条件に含める。識別子を知っているだけでは、
      // 他人のセッションも他のワークスペースのセッションも終わらせられない。
      const rows = await db.query<{ id: string }>(
        `UPDATE sessions
            SET revoked_at = $4
          WHERE workspace_id = $1
            AND user_id = $2
            AND id = $3
            AND revoked_at IS NULL
          RETURNING id`,
        [input.workspaceId, input.userId, input.sessionId, input.revokedAt],
      );
      return rows.length > 0;
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
            AND ($4::uuid IS NULL OR id <> $4)
          RETURNING id`,
        [input.workspaceId, input.userId, input.revokedAt, input.exceptSessionId ?? null],
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
