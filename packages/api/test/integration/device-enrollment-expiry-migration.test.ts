import type { Database } from '@staffweave/db';
import { migrate } from '@staffweave/db';
import { describe, expect, it } from 'vitest';
import { migrationsUpTo, useTemporaryDatabases } from '../support/migration-database.js';

/**
 * 登録トークンの有効期限が、すでに動いている環境で何をするかを固定する。
 *
 * 0024 より前に発行された登録トークンには期限が無い。移行で期限を先送りすると、
 * 漏えい済みのトークンを使える状態のまま引き継ぐことになる。
 * 作成時刻から既定の有効時間を足した値を入れ、古いものは使えなくする。
 *
 * 検証用のデータを開発用やテスト用のデータベースへ作らないよう、この検査だけの
 * データベースをその場で用意し、終わったら消す。
 */

const UPGRADED = 'staffweave_device_enrollment_expiry_test';

const LAST_VERSION_BEFORE_EXPIRY = 23;

/** 0024 より前の形で、登録待ちの端末を作る。期限の列はまだ無い。 */
async function insertPendingDevice(
  db: Database,
  input: { name: string; tokenHash: string; createdAt: string },
): Promise<void> {
  const workspaces = await db.query<{ id: string }>(
    "SELECT id FROM workspaces WHERE slug = 'default'",
  );
  await db.query(
    `INSERT INTO devices (workspace_id, name, enrollment_token_hash, created_at)
     VALUES ($1, $2, $3, $4)`,
    [workspaces[0]?.id ?? '', input.name, input.tokenHash, input.createdAt],
  );
}

const temporary = useTemporaryDatabases([UPGRADED], async ({ database }) => {
  const db = database(UPGRADED);
  await migrate(db, await migrationsUpTo(LAST_VERSION_BEFORE_EXPIRY));
  await db.query("INSERT INTO workspaces (slug, name) VALUES ('default', '既定')");

  await insertPendingDevice(db, {
    name: '古い端末',
    tokenHash: 'legacy-old-token-hash',
    createdAt: '2020-01-01T00:00:00.000Z',
  });
  await insertPendingDevice(db, {
    name: '有効な端末',
    tokenHash: 'legacy-fresh-token-hash',
    // 適用時点からは十分に先。期限が作成時刻から決まることだけを確かめる。
    createdAt: '2999-01-01T00:00:00.000Z',
  });

  await migrate(db);
});

const upgraded = () => temporary.database(UPGRADED);

async function expiryOf(name: string): Promise<Date | null> {
  const rows = await upgraded().query<{ enrollment_token_expires_at: Date | null }>(
    'SELECT enrollment_token_expires_at FROM devices WHERE name = $1',
    [name],
  );
  return rows[0]?.enrollment_token_expires_at ?? null;
}

describe('0023 まで適用済みのデータベース', () => {
  it('既存の登録トークンへ作成時刻から 15 分後の期限を入れる', async () => {
    expect((await expiryOf('古い端末'))?.toISOString()).toBe('2020-01-01T00:15:00.000Z');
    expect((await expiryOf('有効な端末'))?.toISOString()).toBe('2999-01-01T00:15:00.000Z');
  });

  it('登録トークンを持たない端末には期限を入れない', async () => {
    const db = upgraded();
    await db.query(
      `UPDATE devices
          SET state = 'revoked', enrollment_token_hash = NULL, enrollment_token_expires_at = NULL
        WHERE name = '古い端末'`,
    );

    expect(await expiryOf('古い端末')).toBeNull();
  });

  it('トークンと期限の片方だけを持つ行を作れない', async () => {
    await expect(
      upgraded().query(
        "UPDATE devices SET enrollment_token_expires_at = NULL WHERE name = '有効な端末'",
      ),
    ).rejects.toThrow(/devices_enrollment_token_needs_expiry/);
  });
});
