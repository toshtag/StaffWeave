import type { CardCredentialRecord } from '@staffweave/contracts';
import type { Queryable } from '@staffweave/db';

export interface CardRegistrationToken {
  id: string;
  workspaceId: string;
  employeeId: string;
  label: string | null;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface CardRepository {
  listCredentials(workspaceId: string): Promise<CardCredentialRecord[]>;
  findCredentialById(
    workspaceId: string,
    cardCredentialId: string,
  ): Promise<CardCredentialRecord | null>;
  /** 指紋から有効な資格情報と持ち主を引く。 */
  findActiveByFingerprint(
    workspaceId: string,
    fingerprint: string,
  ): Promise<{ id: string; employeeId: string; employeeDisplayName: string } | null>;
  insertCredential(
    workspaceId: string,
    input: {
      employeeId: string;
      fingerprint: string;
      label: string | null;
      registeredByDeviceId: string | null;
    },
  ): Promise<CardCredentialRecord>;
  revokeCredential(
    workspaceId: string,
    cardCredentialId: string,
    input: { revokedAt: Date; revokedByUserId: string | null },
  ): Promise<CardCredentialRecord>;

  createRegistrationToken(
    workspaceId: string,
    input: {
      employeeId: string;
      tokenHash: string;
      label: string | null;
      expiresAt: Date;
      createdByUserId: string;
    },
  ): Promise<void>;
  findRegistrationTokenByHash(tokenHash: string): Promise<CardRegistrationToken | null>;
  /**
   * まだ使われておらず、有効期限内の登録トークンだけを使用済みにする。
   *
   * 一度きりを決めるのはこの更新であり、事前の検査ではない。
   * 同じトークンで同時に届いた要求のうち、消費できるのは 1 件だけで、
   * 残りは `false` を受け取る。
   */
  markRegistrationTokenUsedIfAvailable(
    workspaceId: string,
    id: string,
    usedAt: Date,
  ): Promise<boolean>;
}

interface CredentialRow {
  id: string;
  employee_id: string;
  label: string | null;
  state: 'active' | 'revoked';
  registered_at: Date;
  revoked_at: Date | null;
}

const CREDENTIAL_COLUMNS = 'id, employee_id, label, state, registered_at, revoked_at';

function toCredential(row: CredentialRow): CardCredentialRecord {
  return {
    id: row.id,
    employeeId: row.employee_id,
    label: row.label,
    state: row.state,
    registeredAt: row.registered_at.toISOString(),
    revokedAt: row.revoked_at?.toISOString() ?? null,
  };
}

export function createCardRepository(db: Queryable): CardRepository {
  return {
    async listCredentials(workspaceId) {
      const rows = await db.query<CredentialRow>(
        `SELECT ${CREDENTIAL_COLUMNS} FROM card_credentials
          WHERE workspace_id = $1 ORDER BY registered_at DESC`,
        [workspaceId],
      );
      return rows.map(toCredential);
    },

    async findCredentialById(workspaceId, cardCredentialId) {
      const rows = await db.query<CredentialRow>(
        `SELECT ${CREDENTIAL_COLUMNS} FROM card_credentials
          WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, cardCredentialId],
      );
      return rows[0] ? toCredential(rows[0]) : null;
    },

    async findActiveByFingerprint(workspaceId, fingerprint) {
      const rows = await db.query<{
        id: string;
        employee_id: string;
        display_name: string;
      }>(
        `SELECT card_credentials.id, card_credentials.employee_id, employees.display_name
           FROM card_credentials
           JOIN employees
             ON employees.id = card_credentials.employee_id
            AND employees.workspace_id = card_credentials.workspace_id
          WHERE card_credentials.workspace_id = $1
            AND card_credentials.fingerprint = $2
            AND card_credentials.state = 'active'
            AND employees.status = 'active'`,
        [workspaceId, fingerprint],
      );
      const row = rows[0];
      return row
        ? { id: row.id, employeeId: row.employee_id, employeeDisplayName: row.display_name }
        : null;
    },

    async insertCredential(workspaceId, input) {
      const rows = await db.query<CredentialRow>(
        `INSERT INTO card_credentials
           (workspace_id, employee_id, fingerprint, label, registered_by_device_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${CREDENTIAL_COLUMNS}`,
        [workspaceId, input.employeeId, input.fingerprint, input.label, input.registeredByDeviceId],
      );
      const row = rows[0];
      if (!row) throw new Error('カードを登録できませんでした');
      return toCredential(row);
    },

    async revokeCredential(workspaceId, cardCredentialId, input) {
      const rows = await db.query<CredentialRow>(
        `UPDATE card_credentials
            SET state = 'revoked', revoked_at = $3, revoked_by_user_id = $4
          WHERE workspace_id = $1 AND id = $2
          RETURNING ${CREDENTIAL_COLUMNS}`,
        [workspaceId, cardCredentialId, input.revokedAt, input.revokedByUserId],
      );
      const row = rows[0];
      if (!row) throw new Error('カードを失効させられませんでした');
      return toCredential(row);
    },

    async createRegistrationToken(workspaceId, input) {
      await db.query(
        `INSERT INTO card_registration_tokens
           (workspace_id, employee_id, token_hash, label, expires_at, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          workspaceId,
          input.employeeId,
          input.tokenHash,
          input.label,
          input.expiresAt,
          input.createdByUserId,
        ],
      );
    },

    async findRegistrationTokenByHash(tokenHash) {
      const rows = await db.query<{
        id: string;
        workspace_id: string;
        employee_id: string;
        label: string | null;
        expires_at: Date;
        used_at: Date | null;
      }>(
        `SELECT id, workspace_id, employee_id, label, expires_at, used_at
           FROM card_registration_tokens WHERE token_hash = $1`,
        [tokenHash],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        workspaceId: row.workspace_id,
        employeeId: row.employee_id,
        label: row.label,
        expiresAt: row.expires_at,
        usedAt: row.used_at,
      };
    },

    async markRegistrationTokenUsedIfAvailable(workspaceId, id, usedAt) {
      const rows = await db.query<{ id: string }>(
        `UPDATE card_registration_tokens
            SET used_at = $3
          WHERE workspace_id = $1
            AND id = $2
            -- 未使用であることと有効期限内であることを、更新の条件としても課す。
            -- 先に読んだ結果ではなく、この条件に合致したことが消費の証跡になる。
            AND used_at IS NULL
            AND expires_at > $3
          RETURNING id`,
        [workspaceId, id, usedAt],
      );
      // 0 行なら、同じトークンを使う別の要求が先に消費している。
      return rows.length > 0;
    },
  };
}
