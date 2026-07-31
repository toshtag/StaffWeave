import { copyFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from '@staffweave/db';
import { createDatabase, MIGRATIONS_DIR, migrate } from '@staffweave/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSessionObservationRepository } from '../../src/session/repository.js';

/**
 * 受領記録の追加が、すでに動いている環境を壊さないことを確かめる。
 *
 * 0016 は観測テーブルへ触れない。1 回の要求に複数の観測が入る以上、観測行へ
 * 冪等キーの一意制約を置くと通常の複数件送信が 2 件目で失敗する。
 * 0015 までに保存された観測がそのまま残り、複数件の保存も続けられることを固定する。
 * 0017 はその再送判定を支える索引を足すだけで、観測の内容も件数も変えない。
 *
 * 検証用のデータを開発用やテスト用のデータベースへ作らないよう、この検査だけの
 * データベースをその場で用意し、終わったら消す。
 */

const UPGRADED = 'staffweave_session_receipt_upgrade_test';
const INDEXED = 'staffweave_session_request_index_test';
const FRESH = 'staffweave_session_receipt_fresh_test';

const LAST_VERSION_BEFORE_RECEIPTS = 15;
const LAST_VERSION_BEFORE_REQUEST_INDEX = 16;

const REQUEST_INDEX = 'workstation_session_observations_request_idx';

/** 0016 より前に受け取った、観測が 2 件入るまとめ送り。 */
const LEGACY_REQUEST_ID = 'legacy-session-request';

function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL が設定されていません。');
  return url;
}

function urlFor(databaseName: string): string {
  const url = new URL(requireTestDatabaseUrl());
  url.pathname = `/${databaseName}`;
  return url.toString();
}

/** 指定した版までのマイグレーションだけを置いた一時ディレクトリ。内容は原本と同一にする。 */
async function migrationsUpTo(version: number): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'staffweave-migrations-'));
  for (const fileName of await readdir(MIGRATIONS_DIR)) {
    if (!fileName.endsWith('.sql')) continue;
    if (Number(fileName.slice(0, 4)) > version) continue;
    await copyFile(join(MIGRATIONS_DIR, fileName), join(directory, fileName));
  }
  return directory;
}

interface Workspace {
  workspaceId: string;
  employeeId: string;
  deviceId: string;
}

/** 観測と受領記録を保存できる最小の一式を作る。 */
async function createWorkspaceWith(db: Database, slug: string): Promise<Workspace> {
  const workspaces = await db.query<{ id: string }>(
    'INSERT INTO workspaces (slug, name) VALUES ($1, $2) RETURNING id',
    [slug, slug],
  );
  const workspaceId = workspaces[0]?.id ?? '';
  const organizations = await db.query<{ id: string }>(
    "INSERT INTO organizations (workspace_id, code, name) VALUES ($1, 'HQ', '本社') RETURNING id",
    [workspaceId],
  );
  const employees = await db.query<{ id: string }>(
    `INSERT INTO employees (workspace_id, organization_id, employee_number, display_name)
     VALUES ($1, $2, 'E001', '勤怠 花子') RETURNING id`,
    [workspaceId, organizations[0]?.id ?? ''],
  );
  const devices = await db.query<{ id: string }>(
    `INSERT INTO devices (workspace_id, name, state, public_key)
     VALUES ($1, 'PC 監視', 'active', 'public-key') RETURNING id`,
    [workspaceId],
  );
  return {
    workspaceId,
    employeeId: employees[0]?.id ?? '',
    deviceId: devices[0]?.id ?? '',
  };
}

async function insertObservation(
  db: Database,
  workspace: Workspace,
  input: { observationType: string; requestId: string },
): Promise<void> {
  await db.query(
    `INSERT INTO workstation_session_observations
       (workspace_id, employee_id, device_id, observation_type, occurred_at,
        business_date, request_id, workstation_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'desk-01')`,
    [
      workspace.workspaceId,
      workspace.employeeId,
      workspace.deviceId,
      input.observationType,
      new Date('2026-04-01T00:00:00.000Z'),
      '2026-04-01',
      input.requestId,
    ],
  );
}

async function insertReceipt(
  db: Database,
  workspace: Workspace,
  input: { requestId: string; sequence?: number },
): Promise<void> {
  await db.query(
    `INSERT INTO workstation_session_receipts
       (workspace_id, device_id, request_id, sequence, sequence_step, outcome, accepted, skipped)
     VALUES ($1, $2, $3, $4, 1, 'accepted', 2, 0)`,
    [workspace.workspaceId, workspace.deviceId, input.requestId, input.sequence ?? 1],
  );
}

/** 冪等キーで観測を引くための索引。定義そのものではなく、引ける形かどうかを見る。 */
async function requestIndexOf(db: Database): Promise<string | undefined> {
  const rows = await db.query<{ indexdef: string }>(
    `SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'workstation_session_observations'
        AND indexname = $1`,
    [REQUEST_INDEX],
  );
  return rows[0]?.indexdef;
}

let admin: Database;
let upgraded: Database;
let indexed: Database;
let fresh: Database;
let upgradedWorkspace: Workspace;
let indexedWorkspace: Workspace;
let freshWorkspace: Workspace;

beforeAll(async () => {
  admin = createDatabase({ connectionString: urlFor('postgres'), maxConnections: 1 });
  for (const name of [UPGRADED, INDEXED, FRESH]) {
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.query(`CREATE DATABASE ${name}`);
  }

  upgraded = createDatabase({ connectionString: urlFor(UPGRADED), maxConnections: 1 });
  indexed = createDatabase({ connectionString: urlFor(INDEXED), maxConnections: 1 });
  fresh = createDatabase({ connectionString: urlFor(FRESH), maxConnections: 1 });

  // 0015 までを適用し、当時の形でまとめ送り 1 回分を保存してから 0016 を適用する。
  await migrate(upgraded, await migrationsUpTo(LAST_VERSION_BEFORE_RECEIPTS));
  upgradedWorkspace = await createWorkspaceWith(upgraded, 'default');
  for (const observationType of ['sign_in', 'lock']) {
    await insertObservation(upgraded, upgradedWorkspace, {
      observationType,
      requestId: LEGACY_REQUEST_ID,
    });
  }
  await migrate(upgraded);

  // 0016 までを適用した環境へ、索引だけを足す 0017 を当てる。
  await migrate(indexed, await migrationsUpTo(LAST_VERSION_BEFORE_REQUEST_INDEX));
  indexedWorkspace = await createWorkspaceWith(indexed, 'default');
  for (const observationType of ['sign_in', 'lock']) {
    await insertObservation(indexed, indexedWorkspace, {
      observationType,
      requestId: LEGACY_REQUEST_ID,
    });
  }
  await migrate(indexed);

  await migrate(fresh);
  freshWorkspace = await createWorkspaceWith(fresh, 'default');
}, 60_000);

afterAll(async () => {
  await upgraded?.close();
  await indexed?.close();
  await fresh?.close();
  for (const name of [UPGRADED, INDEXED, FRESH]) {
    await admin?.query(`DROP DATABASE IF EXISTS ${name}`);
  }
  await admin?.close();
});

describe('0015 まで適用済みのデータベース', () => {
  it('保存されていた観測をそのまま残す', async () => {
    const rows = await upgraded.query<{ observation_type: string }>(
      'SELECT observation_type FROM workstation_session_observations WHERE request_id = $1',
      [LEGACY_REQUEST_ID],
    );

    expect(rows.map((row) => row.observation_type).sort()).toEqual(['lock', 'sign_in']);
  });

  it('受け取り済みの要求へ受領記録を作り足さない', async () => {
    const rows = await upgraded.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM workstation_session_receipts',
    );

    // 当時の観測には連番も欠落数も残っていない。作れない記録を推測で埋めない。
    expect(rows[0]?.count).toBe(0);
  });

  it('もう一度適用しても何も起きない', async () => {
    const result = await migrate(upgraded);

    expect(result.appliedVersions).toEqual([]);
  });
});

describe('0016 まで適用済みのデータベース', () => {
  it('冪等キーで観測を引ける索引を足す', async () => {
    const definition = await requestIndexOf(indexed);

    expect(definition).toBeDefined();
    expect(definition).toContain('workstation_session_observations');
    expect(definition).toContain('workspace_id');
    expect(definition).toContain('request_id');
    // 1 回の要求に観測が複数入るため、一意索引にはできない。
    expect(definition).not.toContain('UNIQUE');
  });

  it('保存されていた観測をそのまま残す', async () => {
    const rows = await indexed.query<{ observation_type: string }>(
      'SELECT observation_type FROM workstation_session_observations WHERE request_id = $1',
      [LEGACY_REQUEST_ID],
    );

    expect(rows.map((row) => row.observation_type).sort()).toEqual(['lock', 'sign_in']);
  });

  it('索引を足したあとも同じ冪等キーの観測を保存できる', async () => {
    await insertObservation(indexed, indexedWorkspace, {
      observationType: 'sign_out',
      requestId: LEGACY_REQUEST_ID,
    });

    const rows = await indexed.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM workstation_session_observations WHERE request_id = $1',
      [LEGACY_REQUEST_ID],
    );
    expect(rows[0]?.count).toBe(3);
  });

  it('受領記録のない要求を、観測から再送と判定できる', async () => {
    const observations = createSessionObservationRepository(indexed);

    await expect(
      observations.existsLegacyRequest(indexedWorkspace.workspaceId, LEGACY_REQUEST_ID),
    ).resolves.toBe(true);
    await expect(
      observations.existsLegacyRequest(indexedWorkspace.workspaceId, 'unknown-session-request'),
    ).resolves.toBe(false);
  });

  it('もう一度適用しても何も起きない', async () => {
    const result = await migrate(indexed);

    expect(result.appliedVersions).toEqual([]);
  });
});

describe('空のデータベース', () => {
  it('最初から冪等キーの索引を持つ', async () => {
    const definition = await requestIndexOf(fresh);

    expect(definition).toBeDefined();
    expect(definition).not.toContain('UNIQUE');
  });

  it('同じ冪等キーの観測を複数保存できる', async () => {
    for (const observationType of ['sign_in', 'lock', 'sign_out']) {
      await insertObservation(fresh, freshWorkspace, {
        observationType,
        requestId: 'fresh-session-request',
      });
    }

    const rows = await fresh.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM workstation_session_observations WHERE request_id = $1',
      ['fresh-session-request'],
    );
    expect(rows[0]?.count).toBe(3);
  });

  it('同じワークスペースでは同じ冪等キーの受領記録を 1 件しか持てない', async () => {
    await insertReceipt(fresh, freshWorkspace, { requestId: 'unique-session-request' });

    await expect(
      insertReceipt(fresh, freshWorkspace, { requestId: 'unique-session-request', sequence: 2 }),
    ).rejects.toThrow(/workstation_session_receipts_request_key/);
  });

  it('ワークスペースが違えば同じ冪等キーを使える', async () => {
    const other = await createWorkspaceWith(fresh, 'other');

    await expect(
      insertReceipt(fresh, other, { requestId: 'unique-session-request' }),
    ).resolves.toBeUndefined();
  });

  it('受領記録の内容を強制する', async () => {
    const invalid = (columns: string, values: string) =>
      fresh.query(
        `INSERT INTO workstation_session_receipts
           (workspace_id, device_id, request_id, ${columns})
         VALUES ($1, $2, $3, ${values})`,
        [freshWorkspace.workspaceId, freshWorkspace.deviceId, 'invalid-session-request'],
      );

    await expect(
      invalid('sequence, sequence_step, outcome, accepted, skipped', "0, 1, 'accepted', 0, 0"),
    ).rejects.toThrow(/sequence_positive/);
    await expect(
      invalid('sequence, sequence_step, outcome, accepted, skipped', "1, 1, 'duplicate', 0, 0"),
    ).rejects.toThrow(/outcome_values/);
    await expect(
      invalid('sequence, sequence_step, outcome, accepted, skipped', "1, 1, 'accepted', -1, 0"),
    ).rejects.toThrow(/counts_non_negative/);
    await expect(
      fresh.query(
        `INSERT INTO workstation_session_receipts
           (workspace_id, device_id, request_id, sequence, sequence_step, outcome, accepted, skipped)
         VALUES ($1, $2, 'short', 1, 1, 'accepted', 0, 0)`,
        [freshWorkspace.workspaceId, freshWorkspace.deviceId],
      ),
    ).rejects.toThrow(/request_length/);
  });

  it('端末が別のワークスペースなら受領記録を作れない', async () => {
    const other = await createWorkspaceWith(fresh, 'foreign');

    await expect(
      insertReceipt(
        fresh,
        { ...freshWorkspace, deviceId: other.deviceId },
        {
          requestId: 'foreign-session-request',
        },
      ),
    ).rejects.toThrow(/workstation_session_receipts_device_fkey/);
  });

  it('受領記録は書き換えられない', async () => {
    await insertReceipt(fresh, freshWorkspace, { requestId: 'append-only-request' });

    await expect(
      fresh.query('DELETE FROM workstation_session_receipts WHERE request_id = $1', [
        'append-only-request',
      ]),
    ).rejects.toThrow(/追記のみ/);
  });
});
