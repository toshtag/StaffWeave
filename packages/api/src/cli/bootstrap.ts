/**
 * セルフホストの初期化。
 * ワークスペースと最初のワークスペース管理者を作成する。
 *
 *   pnpm bootstrap --email admin@example.com
 *   pnpm bootstrap --slug head-office --name "本社" --email admin@example.com
 *
 * パスワードを指定しない場合は生成して一度だけ表示する。
 * 生成値は保存されないため、その場で控えること。
 */
import { randomBytes } from 'node:crypto';
import { createDatabase } from '@staffweave/db';
import { isValidEmail, normalizeEmail, validatePassword } from '@staffweave/domain';
import { loadApiConfig } from '../config.js';
import { createOrganizationRepository } from '../organization/repository.js';
import { hashPassword } from '../shared/security/password.js';

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function generatePassword(): string {
  return randomBytes(18).toString('base64url');
}

async function main(): Promise<void> {
  const config = loadApiConfig();
  const slug = readOption('slug') ?? config.defaultWorkspaceSlug;
  const name = readOption('name') ?? '既定のワークスペース';
  const timeZone = readOption('time-zone') ?? 'Asia/Tokyo';
  const email = normalizeEmail(readOption('email') ?? '');
  const displayName = readOption('display-name') ?? '管理者';

  if (!isValidEmail(email)) {
    throw new Error('--email に有効なメールアドレスを指定してください');
  }

  const password = readOption('password') ?? generatePassword();
  const generated = readOption('password') === undefined;
  const passwordProblems = validatePassword(password);
  if (passwordProblems.length > 0) {
    throw new Error(`パスワードが条件を満たしません: ${passwordProblems.join(', ')}`);
  }

  const db = createDatabase({ connectionString: config.databaseUrl });

  try {
    const result = await db.transaction(async (tx) => {
      const existing = await tx.query<{ id: string }>('SELECT id FROM workspaces WHERE slug = $1', [
        slug,
      ]);

      const workspaceId =
        existing[0]?.id ??
        (
          await tx.query<{ id: string }>(
            'INSERT INTO workspaces (slug, name, time_zone) VALUES ($1, $2, $3) RETURNING id',
            [slug, name, timeZone],
          )
        )[0]?.id;

      if (!workspaceId) throw new Error('ワークスペースを作成できませんでした');

      const duplicate = await tx.query<{ id: string }>(
        'SELECT id FROM users WHERE workspace_id = $1 AND email = $2',
        [workspaceId, email],
      );
      if (duplicate.length > 0) {
        throw new Error(`利用者 ${email} はすでに登録されています`);
      }

      const repository = createOrganizationRepository(tx);
      const user = await repository.createUser(workspaceId, {
        email,
        passwordHash: await hashPassword(password),
        displayName,
        locale: 'ja-JP',
        roles: ['workspace_admin'],
      });

      return { workspaceId, userId: user.id, created: existing.length === 0 };
    });

    console.log(
      result.created
        ? `ワークスペース ${slug} を作成しました（${result.workspaceId}）`
        : `既存のワークスペース ${slug} を使用しました（${result.workspaceId}）`,
    );
    console.log(`ワークスペース管理者を作成しました: ${email}`);
    if (generated) {
      console.log('');
      console.log(`初期パスワード: ${password}`);
      console.log('この値は再表示できません。ログイン後に変更してください。');
    }
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
