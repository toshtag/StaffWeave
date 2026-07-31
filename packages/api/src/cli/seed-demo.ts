/**
 * デモ用のサンプルデータを作る。
 *
 *   pnpm seed:demo
 *   pnpm seed:demo --slug demo --reset
 *
 * 実在の人物や企業の情報は含めない。すべて説明のための架空の値を使う。
 * 既定のパスワードは分かりやすい値にしてあるため、公開された場所では使わないこと。
 */
import { createDatabase } from '@staffweave/db';
import { loadApiConfig } from '../config.js';
import { createOrganizationRepository } from '../organization/repository.js';
import { hashPassword } from '../shared/security/password.js';

const DEMO_PASSWORD = 'staffweave demo pass';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const config = loadApiConfig();
  const slug = option('slug') ?? 'demo';
  const db = createDatabase({ connectionString: config.databaseUrl });

  try {
    if (hasFlag('reset')) {
      await db.query('DELETE FROM workspaces WHERE slug = $1', [slug]);
      console.log(`既存のデモワークスペース ${slug} を削除しました。`);
    }

    const existing = await db.query<{ id: string }>('SELECT id FROM workspaces WHERE slug = $1', [
      slug,
    ]);
    if (existing.length > 0) {
      throw new Error(
        `ワークスペース ${slug} はすでに存在します。作り直すには --reset を付けてください。`,
      );
    }

    await db.transaction(async (tx) => {
      const workspace = await tx.query<{ id: string }>(
        `INSERT INTO workspaces (slug, name, time_zone)
         VALUES ($1, 'デモ商事', 'Asia/Tokyo') RETURNING id`,
        [slug],
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

      await tx.query(
        `INSERT INTO sites (workspace_id, organization_id, code, name, time_zone)
         VALUES ($1, $2, 'TOKYO', '東京オフィス', 'Asia/Tokyo')`,
        [workspaceId, organizationId],
      );

      await tx.query(
        `INSERT INTO work_patterns (workspace_id, code, name, start_minutes, end_minutes, break_minutes)
         VALUES ($1, 'DAY', '日勤', 540, 1080, 60)`,
        [workspaceId],
      );

      await tx.query(
        `INSERT INTO leave_types (workspace_id, code, name, paid)
         VALUES ($1, 'PAID', '年次有給休暇', true)`,
        [workspaceId],
      );

      const repository = createOrganizationRepository(tx);
      const passwordHash = await hashPassword(DEMO_PASSWORD);

      const people = [
        { email: 'admin@demo.example', name: 'デモ 管理者', roles: ['workspace_admin'] as const },
        {
          email: 'manager@demo.example',
          name: 'デモ 承認者',
          roles: ['organization_manager'] as const,
        },
        { email: 'member@demo.example', name: 'デモ 従業員', roles: ['employee'] as const },
      ];

      let employeeNumber = 1;
      for (const person of people) {
        const user = await repository.createUser(workspaceId, {
          email: person.email,
          passwordHash,
          displayName: person.name,
          locale: 'ja-JP',
          roles: person.roles,
        });

        if (person.roles[0] === 'employee' || person.roles[0] === 'organization_manager') {
          await repository.createEmployee(workspaceId, {
            organizationId,
            userId: user.id,
            employeeNumber: `E${String(employeeNumber).padStart(3, '0')}`,
            displayName: person.name,
            primarySiteId: null,
            primaryDepartmentId: null,
            hiredOn: null,
          });
          employeeNumber += 1;
        }
      }
    });

    console.log(`デモワークスペース ${slug} を作成しました。`);
    console.log('');
    console.log('ログインできる利用者:');
    console.log('  admin@demo.example    ワークスペース管理者');
    console.log('  manager@demo.example  承認者');
    console.log('  member@demo.example   従業員');
    console.log(`パスワードはいずれも: ${DEMO_PASSWORD}`);
    console.log('');
    console.log('このデータは説明のための架空の値です。実運用へは使わないでください。');
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
