import { createApp } from '@staffweave/api';
import { describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';

describe('稼働確認エンドポイント（実データベース）', () => {
  it('マイグレーション適用後は ready を返す', async () => {
    const app = createApp({ db: testDatabase() });

    const response = await app.request('/api/ready');
    const body = (await response.json()) as {
      status: string;
      checks: { name: string; ok: boolean }[];
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe('ready');
    expect(body.checks).toEqual([
      { name: 'database', ok: true },
      { name: 'migrations', ok: true },
    ]);
  });

  it('ワークスペースを作成して取得できる', async () => {
    const db = testDatabase();
    const inserted = await db.query<{ id: string; slug: string; time_zone: string }>(
      `INSERT INTO workspaces (slug, name) VALUES ($1, $2)
       RETURNING id, slug, time_zone`,
      ['acme-demo', '検証用ワークスペース'],
    );

    expect(inserted[0]?.slug).toBe('acme-demo');
    expect(inserted[0]?.time_zone).toBe('Asia/Tokyo');
  });

  it('slug の形式が不正な場合は登録できない', async () => {
    const db = testDatabase();
    await expect(
      db.query('INSERT INTO workspaces (slug, name) VALUES ($1, $2)', ['Invalid Slug', 'x']),
    ).rejects.toThrow();
  });

  it('slug は重複できない', async () => {
    const db = testDatabase();
    await db.query('INSERT INTO workspaces (slug, name) VALUES ($1, $2)', ['duplicate-check', 'a']);
    await expect(
      db.query('INSERT INTO workspaces (slug, name) VALUES ($1, $2)', ['duplicate-check', 'b']),
    ).rejects.toThrow();
  });
});
