/**
 * 保持期間を過ぎた記録の削除。
 *
 * これまでの手順は、生の SQL の `DELETE` の例を示した直後に「消した記録も
 * 監査へ残してください」と求めていた。示した SQL は監査を残さないため、
 * 手順のとおりに実行しても要件を満たせない。
 *
 * ここで固定したいのは 4 つ。
 *
 *   事前確認では 1 行も消さないこと
 *   境界より前だけを消し、境界より後は残すこと
 *   消したことが監査へ残ること
 *   二度実行しても壊れないこと
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';
import { createAuditRepository } from '../../src/audit/repository.js';
import { runRetention } from '../../src/operations/retention.js';
import {
  createEmployeeWithAccount,
  createOrganization,
  createWorkspace,
} from '../support/fixtures.js';

const NOW = new Date('2026-10-01T00:00:00.000Z');

interface Fixture {
  workspaceId: string;
  employeeId: string;
}

let fixture: Fixture;

beforeEach(async () => {
  const db = testDatabase();
  const workspaceId = await createWorkspace(db, { slug: 'default' });
  const organizationId = await createOrganization(db, workspaceId, { code: 'HQ' });
  const employee = await createEmployeeWithAccount(db, workspaceId, {
    organizationId,
    employeeNumber: 'E001',
    displayName: '保持 花子',
    email: 'hanako@example.com',
  });
  fixture = { workspaceId, employeeId: employee.employeeId };
});

/** 打刻と、その位置情報を 1 件置く。位置情報だけが保持の対象になる。 */
async function addLocation(capturedAt: string): Promise<void> {
  const db = testDatabase();
  const events = await db.query<{ id: string }>(
    `INSERT INTO attendance_events
       (workspace_id, employee_id, event_type, occurred_at, business_date, source, request_id)
     VALUES ($1, $2, 'clock_in', $3::timestamptz, '2026-01-01', 'web', $4)
     RETURNING id`,
    [fixture.workspaceId, fixture.employeeId, capturedAt, `retention-${capturedAt}`],
  );
  const event = events[0];
  if (!event) throw new Error('打刻を用意できませんでした');

  await db.query(
    `INSERT INTO attendance_event_locations
       (event_id, workspace_id, latitude, longitude, accuracy_meters, captured_at)
     VALUES ($1, $2, 35.0, 139.0, 10, $3::timestamptz)`,
    [event.id, fixture.workspaceId, capturedAt],
  );
}

async function locationCount(): Promise<number> {
  const rows = await testDatabase().query<{ count: string }>(
    'SELECT count(*)::text AS count FROM attendance_event_locations WHERE workspace_id = $1',
    [fixture.workspaceId],
  );
  return Number(rows[0]?.count ?? '0');
}

async function retentionAudits(): Promise<{ summary: string; detail: Record<string, unknown> }[]> {
  const rows = await testDatabase().query<{ summary: string; detail: Record<string, unknown> }>(
    `SELECT summary, detail FROM audit_logs
      WHERE workspace_id = $1 AND action = 'retention.applied'
      ORDER BY occurred_at`,
    [fixture.workspaceId],
  );
  return rows;
}

function retention(apply: boolean) {
  const db = testDatabase();
  return db.transaction((tx) =>
    runRetention(
      { db: tx, audit: createAuditRepository(tx) },
      {
        workspaceId: fixture.workspaceId,
        // 400 日で切る。手順の目安と同じ値にする。
        days: new Map([['attendance-locations', 400]]),
        apply,
        now: NOW,
      },
    ),
  );
}

describe('保持期間による削除', () => {
  it('事前確認では、件数だけを出して 1 行も消さない', async () => {
    // 境界より前と後を 1 件ずつ。
    await addLocation('2025-01-01T00:00:00.000Z');
    await addLocation('2026-09-01T00:00:00.000Z');

    const outcome = await retention(false);

    expect(outcome.applied).toBe(false);
    expect(outcome.rows[0]).toMatchObject({ name: 'attendance-locations', count: 1 });
    expect(await locationCount()).toBe(2);
    // 何も消していないため、監査も残さない。
    expect(await retentionAudits()).toEqual([]);
  });

  it('境界より前だけを消し、境界より後は残す', async () => {
    await addLocation('2025-01-01T00:00:00.000Z');
    await addLocation('2026-09-01T00:00:00.000Z');

    const outcome = await retention(true);

    expect(outcome.applied).toBe(true);
    expect(outcome.rows[0]?.count).toBe(1);
    expect(await locationCount()).toBe(1);
  });

  /**
   * 消したことを監査へ残す。残さないと、「無い」のか「消した」のかを
   * あとから区別できない。
   */
  it('消した件数が監査へ残る', async () => {
    await addLocation('2025-01-01T00:00:00.000Z');

    await retention(true);

    const audits = await retentionAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]?.summary).toContain('1 件');
    expect(audits[0]?.detail).toMatchObject({
      rows: [expect.objectContaining({ name: 'attendance-locations', count: 1 })],
    });
  });

  it('二度実行しても、二度目は 0 件になる', async () => {
    await addLocation('2025-01-01T00:00:00.000Z');

    await retention(true);
    const second = await retention(true);

    expect(second.rows[0]?.count).toBe(0);
    expect(await locationCount()).toBe(0);
  });

  it('消せない対象は名前で断る', async () => {
    const db = testDatabase();
    await expect(
      db.transaction((tx) =>
        runRetention(
          { db: tx, audit: createAuditRepository(tx) },
          {
            workspaceId: fixture.workspaceId,
            days: new Map([['attendance_events', 1]]),
            apply: true,
            now: NOW,
          },
        ),
      ),
    ).rejects.toThrow('消せない対象です');
  });
});
