import { deriveWebhookSigningKey, verifyWebhook } from '@staffweave/connector';
import type { Database } from '@staffweave/db';
import { migrate } from '@staffweave/db';
import { describe, expect, it } from 'vitest';
import { signWebhookMessage } from '../../src/integration/webhook-signature.js';
import { migrationsUpTo, useTemporaryDatabases } from '../support/migration-database.js';

/**
 * 保存列の改名が、すでに動いている環境を壊さないことを確かめる。
 *
 * 0015 は値を作り直さない。0014 までで登録された送信先は、同じ秘密のまま検証できなければ
 * ならない。作り直してしまうと、受け取り側が控えている秘密が黙って使えなくなる。
 *
 * 検証用の送信先を開発用やテスト用のデータベースへ作らないよう、この検査だけの
 * データベースをその場で用意し、終わったら消す。
 */

/** 0014 までの環境で登録済みだった送信先の秘密。実際に発行された値は使わない。 */
const KNOWN_SECRET = 'staffweave-webhook-test-secret';

const UPGRADED = 'staffweave_migration_upgrade_test';
const FRESH = 'staffweave_migration_fresh_test';

const LAST_VERSION_BEFORE_RENAME = 14;

async function columnsOf(db: Database, table: string): Promise<string[]> {
  const rows = await db.query<{ column_name: string }>(
    'SELECT column_name FROM information_schema.columns WHERE table_name = $1',
    [table],
  );
  return rows.map((row) => row.column_name);
}

const temporary = useTemporaryDatabases([UPGRADED, FRESH], async ({ database }) => {
  // 0014 までを適用し、当時の形で送信先を 1 件登録してから 0015 を適用する。
  await migrate(database(UPGRADED), await migrationsUpTo(LAST_VERSION_BEFORE_RENAME));
  const workspaces = await database(UPGRADED).query<{ id: string }>(
    "INSERT INTO workspaces (slug, name) VALUES ('default', '既定') RETURNING id",
  );
  await database(UPGRADED).query(
    `INSERT INTO webhook_endpoints (workspace_id, name, url, secret_hash, event_types)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      workspaces[0]?.id ?? '',
      '給与システム',
      'https://example.test/hooks',
      deriveWebhookSigningKey(KNOWN_SECRET),
      ['attendance_request.approved'],
    ],
  );
  await migrate(database(UPGRADED));

  await migrate(database(FRESH));
});

const upgraded = () => temporary.database(UPGRADED);
const fresh = () => temporary.database(FRESH);

describe('0014 まで適用済みのデータベース', () => {
  it('保存されていた値をそのまま署名鍵として引き継ぐ', async () => {
    const rows = await upgraded().query<{ signing_key: string }>(
      'SELECT signing_key FROM webhook_endpoints',
    );

    expect(rows[0]?.signing_key).toBe(deriveWebhookSigningKey(KNOWN_SECRET));
  });

  it('改名前の列は残さない', async () => {
    const columns = await columnsOf(upgraded(), 'webhook_endpoints');

    expect(columns).toContain('signing_key');
    expect(columns).not.toContain('secret_hash');
  });

  it('登録済みの送信先の署名を受け取り側が検証できる', async () => {
    const rows = await upgraded().query<{ signing_key: string }>(
      'SELECT signing_key FROM webhook_endpoints',
    );
    const signingKey = rows[0]?.signing_key;
    if (!signingKey) throw new Error('送信先が残っていません');

    const timestamp = '2026-04-01T00:00:00.000Z';
    const body = '{"eventId":"event-1","eventType":"attendance_request.approved","data":{}}';
    const signature = signWebhookMessage(signingKey, {
      eventId: 'event-1',
      eventType: 'attendance_request.approved',
      timestamp,
      body,
    });

    // 改名の前に控えていた秘密で、そのまま検証できなければならない。
    const verified = verifyWebhook(
      KNOWN_SECRET,
      {
        headers: {
          'x-staffweave-event': 'attendance_request.approved',
          'x-staffweave-event-id': 'event-1',
          'x-staffweave-timestamp': timestamp,
          'x-staffweave-signature': signature,
        },
        body,
      },
      { now: new Date(timestamp) },
    );

    expect(verified.eventId).toBe('event-1');
  });

  it('もう一度適用しても何も起きない', async () => {
    const result = await migrate(upgraded());

    expect(result.appliedVersions).toEqual([]);
  });
});

describe('空のデータベース', () => {
  it('最初から署名鍵の列だけを持つ', async () => {
    const columns = await columnsOf(fresh(), 'webhook_endpoints');

    expect(columns).toContain('signing_key');
    expect(columns).not.toContain('secret_hash');
  });

  it('署名鍵の形式を強制する', async () => {
    const workspaces = await fresh().query<{ id: string }>(
      "INSERT INTO workspaces (slug, name) VALUES ('format', '形式') RETURNING id",
    );
    const workspaceId = workspaces[0]?.id ?? '';
    const insert = (signingKey: string) =>
      fresh().query(
        `INSERT INTO webhook_endpoints (workspace_id, name, url, signing_key, event_types)
         VALUES ($1, '送信先', 'https://example.test/hooks', $2, $3)`,
        [workspaceId, signingKey, ['attendance_request.approved']],
      );

    await expect(insert('0'.repeat(64))).resolves.toBeDefined();
    for (const rejected of ['', '0'.repeat(63), '0'.repeat(65), `${'0'.repeat(63)}A`]) {
      await expect(insert(rejected)).rejects.toThrow(/webhook_endpoints_signing_key_format/);
    }
  });
});
