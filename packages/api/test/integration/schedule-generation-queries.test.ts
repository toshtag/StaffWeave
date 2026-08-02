import type {
  GenerateWorkSchedulesResponse,
  WorkCycleRecord,
  WorkPattern,
} from '@staffweave/contracts';
import type { Database, Queryable, QueryParameter } from '@staffweave/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';
import { createApp } from '../../src/app.js';
import {
  authorized,
  createEmployeeWithAccount,
  createOrganization,
  createUser,
  createWorkspace,
  loginAndGetCookie,
} from '../support/fixtures.js';

/**
 * 勤務予定の生成が、日数に比例して問い合わせを増やさないことを確かめる。
 *
 * 生成の結果は、日ごとに読み直しても一度だけ読んでも変わらない。
 * 変わるのは往復の回数だけであり、日数を変えて比べないと分からない。
 */

const NOW = '2026-04-01T09:00:00.000Z';

/** 実行された SQL を数えるだけの覆い。読み書きは本物のデータベースへそのまま渡す。 */
function countingDatabase(): { queries: string[]; db: Database } {
  const queries: string[] = [];
  const real = testDatabase();

  const wrap = (executor: Queryable): Queryable => ({
    query: async <T = Record<string, unknown>>(
      text: string,
      params: readonly QueryParameter[] = [],
    ): Promise<T[]> => {
      queries.push(text);
      return executor.query<T>(text, params);
    },
  });

  return {
    queries,
    db: {
      query: (text, params) => wrap(real).query(text, params),
      transaction: (fn) => real.transaction((tx) => fn(wrap(tx))),
      session: (fn) => real.session((connection) => fn(wrap(connection))),
      ping: () => real.ping(),
      close: () => real.close(),
    },
  };
}

function matching(queries: readonly string[], pattern: RegExp): number {
  return queries.filter((text) => pattern.test(text)).length;
}

interface Fixture {
  adminCookie: string;
  employeeId: string;
  cycleId: string;
}

async function setUp(): Promise<Fixture> {
  const workspaceId = await createWorkspace(testDatabase(), { slug: 'default' });
  const organizationId = await createOrganization(testDatabase(), workspaceId, { code: 'HQ' });
  await createUser(testDatabase(), workspaceId, {
    email: 'admin@example.com',
    roles: ['workspace_admin'],
  });
  const employee = await createEmployeeWithAccount(testDatabase(), workspaceId, {
    organizationId,
    employeeNumber: 'E001',
    displayName: '勤怠 花子',
    email: 'hanako@example.com',
  });

  const instance = createApp({
    db: testDatabase(),
    defaultWorkspaceSlug: 'default',
    now: () => new Date(NOW),
  });
  const adminCookie = await loginAndGetCookie(instance, { email: 'admin@example.com' });

  const pattern = (await (
    await instance.request(
      '/api/work-patterns',
      authorized(adminCookie, {
        method: 'POST',
        body: { code: 'DAY', name: '日勤', startMinutes: 540, endMinutes: 1080 },
      }),
    )
  ).json()) as WorkPattern;

  const cycle = (await (
    await instance.request(
      '/api/work-cycles',
      authorized(adminCookie, {
        method: 'POST',
        body: {
          code: 'WEEK',
          name: '週 5 日',
          cycleLength: 7,
          days: [
            ...[0, 1, 2, 3, 4].map((position) => ({
              position,
              dayType: 'working_day',
              workPatternId: pattern.id,
            })),
            { position: 5, dayType: 'non_working_day' },
            { position: 6, dayType: 'non_working_day' },
          ],
        },
      }),
    )
  ).json()) as WorkCycleRecord;

  await instance.request(
    '/api/employee-work-cycles',
    authorized(adminCookie, {
      method: 'POST',
      body: {
        employeeId: employee.employeeId,
        workCycleId: cycle.id,
        anchorDate: '2026-04-01',
        effectiveFrom: '2026-04-01',
      },
    }),
  );

  return { adminCookie, employeeId: employee.employeeId, cycleId: cycle.id };
}

describe('勤務予定の生成にかかる問い合わせ', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setUp();
  });

  async function generate(to: string): Promise<{
    result: GenerateWorkSchedulesResponse;
    queries: string[];
  }> {
    const { queries, db } = countingDatabase();
    const instance = createApp({ db, defaultWorkspaceSlug: 'default', now: () => new Date(NOW) });
    const response = await instance.request(
      '/api/work-schedules/generate',
      authorized(fixture.adminCookie, {
        method: 'POST',
        body: { employeeId: fixture.employeeId, from: '2026-04-01', to },
      }),
    );
    return { result: (await response.json()) as GenerateWorkSchedulesResponse, queries };
  }

  it('計算ルールは日数によらず 1 回だけ読む', async () => {
    const short = await generate('2026-04-07');
    const long = await generate('2026-05-31');

    expect(short.result.created).toBe(7);
    // 2 回目は同じ日から始めるため、すでに作った 7 日は飛ばす（4/1〜5/31 の 61 日 − 7 日）。
    expect(long.result.created).toBe(54);
    expect(long.result.skipped).toBe(7);

    expect(matching(short.queries, /calculation_rule_sets/)).toBe(1);
    expect(matching(long.queries, /calculation_rule_sets/)).toBe(1);
  });

  it('既存の予定は期間分をまとめて 1 回で確かめる', async () => {
    const { queries, result } = await generate('2026-04-07');

    // 1 日につき読むのは、計算の入力として使う 1 回だけ。
    // 上書きするかどうかの確認は、期間分をまとめた 1 回で済ませる。
    expect(matching(queries, /SELECT[\s\S]*FROM work_schedules/)).toBe(result.created + 1);
  });

  it('日数を倍にしても、日数に比例しない問い合わせは増えない', async () => {
    const short = await generate('2026-04-07');
    const long = await generate('2026-04-14');

    const fixedCost = (queries: string[]): number =>
      matching(queries, /calculation_rule_sets/) +
      matching(queries, /FROM employees[\s\S]*JOIN workspaces/) +
      matching(queries, /FROM employee_work_cycles/);

    expect(fixedCost(long.queries)).toBe(fixedCost(short.queries));
  });
});
