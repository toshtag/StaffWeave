/**
 * ログインの失敗の回数制限。
 *
 * 断っているあいだは照合そのものを行わないため、正しいパスワードでも入れない。
 * 「断られている」ことは応答から区別できない。登録の有無を漏らさないため。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';
import {
  createUser,
  createWorkspace,
  login,
  TEST_PASSWORD,
  testAppFactory,
} from '../support/fixtures.js';

const POLICY = {
  account: { maxFailures: 3, windowMs: 60_000, blockMs: 300_000 },
  source: { maxFailures: 100, windowMs: 60_000, blockMs: 300_000 },
};

const START = '2026-04-01T00:00:00.000Z';

const app = testAppFactory({ now: START, loginAttemptPolicy: POLICY });

async function failLogin(instance: ReturnType<typeof app>, email = 'admin@example.com') {
  return login(instance, { email, password: 'wrong-password-value' });
}

describe('ログイン試行の制限', () => {
  beforeEach(async () => {
    const workspaceId = await createWorkspace(testDatabase(), { slug: 'default', name: '既定' });
    await createUser(testDatabase(), workspaceId, {
      email: 'admin@example.com',
      displayName: '管理 太郎',
      roles: ['workspace_admin'],
    });
    await createUser(testDatabase(), workspaceId, {
      email: 'other@example.com',
      displayName: '別 花子',
      roles: ['workspace_admin'],
    });
  });

  it('失敗が続くと、正しいパスワードでも受け付けない', async () => {
    const instance = app();
    for (let index = 0; index < POLICY.account.maxFailures; index += 1) {
      expect((await failLogin(instance)).status).toBe(401);
    }

    const correct = await login(instance, { email: 'admin@example.com' });
    expect(correct.status).toBe(401);
    // 断られたことを応答から区別できない。
    await expect(correct.json()).resolves.toEqual({
      error: {
        code: 'unauthenticated',
        message: 'メールアドレスまたはパスワードが正しくありません',
      },
    });
  });

  it('断る時間が過ぎれば入れる', async () => {
    const instance = app();
    for (let index = 0; index < POLICY.account.maxFailures; index += 1) await failLogin(instance);

    const later = new Date(new Date(START).getTime() + POLICY.account.blockMs + 1).toISOString();
    expect((await login(app({ now: later }), { email: 'admin@example.com' })).status).toBe(200);
  });

  it('他の利用者の失敗に巻き込まれない', async () => {
    const instance = app();
    for (let index = 0; index < POLICY.account.maxFailures; index += 1) {
      await failLogin(instance, 'other@example.com');
    }

    expect((await login(instance, { email: 'admin@example.com' })).status).toBe(200);
  });

  it('入れたら、その利用者の失敗の記録は消える', async () => {
    const instance = app();
    // 上限の 1 つ手前まで失敗させてから入る。
    for (let index = 0; index < POLICY.account.maxFailures - 1; index += 1)
      await failLogin(instance);
    expect((await login(instance, { email: 'admin@example.com' })).status).toBe(200);

    // 記録が消えていれば、ここから改めて上限まで失敗できる。
    for (let index = 0; index < POLICY.account.maxFailures - 1; index += 1)
      await failLogin(instance);
    expect((await login(instance, { email: 'admin@example.com' })).status).toBe(200);
  });

  it('窓が過ぎれば数え直す', async () => {
    const instance = app();
    for (let index = 0; index < POLICY.account.maxFailures - 1; index += 1)
      await failLogin(instance);

    const later = new Date(new Date(START).getTime() + POLICY.account.windowMs + 1).toISOString();
    const afterWindow = app({ now: later });
    for (let index = 0; index < POLICY.account.maxFailures - 1; index += 1) {
      await failLogin(afterWindow);
    }

    expect((await login(afterWindow, { email: 'admin@example.com' })).status).toBe(200);
  });

  it('存在しない利用者への失敗も数える', async () => {
    // 数え方から登録の有無を漏らさない。
    const instance = app();
    for (let index = 0; index < POLICY.account.maxFailures; index += 1) {
      await failLogin(instance, 'nobody@example.com');
    }

    const rows = await testDatabase().query<{ failures: number }>(
      "SELECT failures FROM login_attempts WHERE scope = 'account'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.failures).toBe(POLICY.account.maxFailures);
  });

  it('断っている要求では照合を行わない', async () => {
    const instance = app();

    // 断られていない失敗は照合（scrypt）を通る。これを基準にする。
    // 絶対の時間で測ると、計算資源の混み具合で落ちる。
    const measure = async (run: () => Promise<unknown>): Promise<number> => {
      const startedAt = process.hrtime.bigint();
      await run();
      return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    };

    const verified = await measure(() => failLogin(instance, 'other@example.com'));

    for (let index = 0; index < POLICY.account.maxFailures; index += 1) await failLogin(instance);
    const blocked = await measure(() =>
      login(instance, { email: 'admin@example.com', password: TEST_PASSWORD }),
    );

    expect(blocked).toBeLessThan(verified / 2);
  });
});
