/**
 * E2E 用データベースの準備。
 *
 * 開発用・統合テスト用とは別のデータベースを使い、画面操作でデータが混ざらないようにする。
 * 実行のたびに業務データを消し、既知の初期状態から始める。
 */
// パスワードのハッシュ化は API と同じ実装を使う。
import { hashPassword } from '@staffweave/api';
import { createDatabase, migrate } from '@staffweave/db';

export const E2E_DATABASE_NAME = 'staffweave_e2e';

export interface SeededAccount {
  email: string;
  password: string;
  employeeNumber: string;
  displayName: string;
}

/**
 * 検証用の従業員。
 * 画面テストはファイルごとに別の従業員を使い、打刻の状態が互いに干渉しないようにする。
 */
export const E2E_EMPLOYEE: SeededAccount = {
  email: 'employee@example.test',
  password: 'staffweave e2e pass',
  employeeNumber: 'E001',
  displayName: '検証 太郎',
};

export const E2E_MOBILE_EMPLOYEE: SeededAccount = {
  email: 'mobile@example.test',
  password: 'staffweave e2e pass',
  employeeNumber: 'E002',
  displayName: '検証 花子',
};

/** セッションが切れた後の送信待ち打刻を確かめるための従業員。 */
export const E2E_PENDING_PUNCH_EMPLOYEE: SeededAccount = {
  email: 'pending-punch@example.test',
  password: 'staffweave e2e pass',
  employeeNumber: 'E003',
  displayName: '検証 三郎',
};

/** 送信待ち打刻の持ち主。同じ端末を後から使う利用者と対にして使う。 */
export const E2E_PUNCH_OWNER_EMPLOYEE: SeededAccount = {
  email: 'punch-owner@example.test',
  password: 'staffweave e2e pass',
  employeeNumber: 'E004',
  displayName: '検証 四郎',
};

/** 上の従業員の打刻を送ってはならない、同じ端末の別の利用者。 */
export const E2E_PUNCH_BYSTANDER_EMPLOYEE: SeededAccount = {
  email: 'punch-bystander@example.test',
  password: 'staffweave e2e pass',
  employeeNumber: 'E005',
  displayName: '検証 五郎',
};

const SEEDED_ACCOUNTS = [
  E2E_EMPLOYEE,
  E2E_MOBILE_EMPLOYEE,
  E2E_PENDING_PUNCH_EMPLOYEE,
  E2E_PUNCH_OWNER_EMPLOYEE,
  E2E_PUNCH_BYSTANDER_EMPLOYEE,
];

export function e2eDatabaseUrl(): string {
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error('DATABASE_URL が設定されていません。.env を用意してください。');
  }
  const url = new URL(base);
  url.pathname = `/${E2E_DATABASE_NAME}`;
  return url.toString();
}

async function ensureDatabaseExists(): Promise<void> {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL が設定されていません。');

  const admin = createDatabase({ connectionString: base });
  try {
    const rows = await admin.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM pg_database WHERE datname = $1',
      [E2E_DATABASE_NAME],
    );
    if (rows[0]?.count === 0) {
      await admin.query(`CREATE DATABASE ${E2E_DATABASE_NAME}`);
    }
  } finally {
    await admin.close();
  }
}

export default async function prepareDatabase(): Promise<void> {
  await ensureDatabaseExists();

  const db = createDatabase({ connectionString: e2eDatabaseUrl() });
  try {
    await migrate(db);

    const tables = await db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`,
    );
    if (tables.length > 0) {
      const names = tables.map((row) => `"${row.tablename}"`).join(', ');
      await db.query(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
    }

    await db.transaction(async (tx) => {
      const workspace = await tx.query<{ id: string }>(
        `INSERT INTO workspaces (slug, name, time_zone)
         VALUES ('default', '検証用ワークスペース', 'Asia/Tokyo') RETURNING id`,
      );
      const workspaceId = workspace[0]?.id;
      if (!workspaceId) throw new Error('ワークスペースを作成できませんでした');

      const organization = await tx.query<{ id: string }>(
        `INSERT INTO organizations (workspace_id, code, name)
         VALUES ($1, 'HQ', '本社') RETURNING id`,
        [workspaceId],
      );
      const organizationId = organization[0]?.id;
      if (!organizationId) throw new Error('組織を作成できませんでした');

      for (const account of SEEDED_ACCOUNTS) {
        const user = await tx.query<{ id: string }>(
          `INSERT INTO users (workspace_id, email, password_hash, display_name)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [workspaceId, account.email, await hashPassword(account.password), account.displayName],
        );
        const userId = user[0]?.id;
        if (!userId) throw new Error('利用者を作成できませんでした');

        await tx.query(
          "INSERT INTO user_roles (workspace_id, user_id, role) VALUES ($1, $2, 'employee')",
          [workspaceId, userId],
        );

        await tx.query(
          `INSERT INTO employees
             (workspace_id, organization_id, user_id, employee_number, display_name)
           VALUES ($1, $2, $3, $4, $5)`,
          [workspaceId, organizationId, userId, account.employeeNumber, account.displayName],
        );
      }
    });
  } finally {
    await db.close();
  }
}
