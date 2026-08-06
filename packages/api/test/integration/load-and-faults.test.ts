/**
 * まとまった量と、途中で壊れたときの振る舞い。
 *
 * 締め日には、同じ時間帯へ打刻と集計が集まる。数が増えたときに壊れる作りは、
 * 少ない件数の検査では見えない。ここでは「量」と「途中で失敗すること」を、
 * 手元と CI の両方で同じように起こせる形にして確かめる。
 *
 * 目当ては速さの計測ではない。何ミリ秒で終わったかを条件にすると、
 * 走らせる機械の速さで合否が変わる検査になる。
 * 見るのは「数が増えても結果が正しいか」と「途中で失敗しても壊れないか」。
 */
import type { WorkDay } from '@staffweave/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';
import {
  authorized,
  createEmployeeWithAccount,
  createOrganization,
  createTestApp,
  createUser,
  createWorkspace,
  loginAndGetCookie,
  type TestApp,
} from '../support/fixtures.js';

const app = (): TestApp => createTestApp({ now: () => new Date('2026-04-01T09:00:00.000Z') });

interface Fixture {
  workspaceId: string;
  employeeId: string;
  adminCookie: string;
  employeeCookie: string;
}

let fixture: Fixture;

beforeEach(async () => {
  const db = testDatabase();
  const workspaceId = await createWorkspace(db, { slug: 'default' });
  const organizationId = await createOrganization(db, workspaceId, { code: 'HQ' });
  await createUser(db, workspaceId, { email: 'admin@example.com', roles: ['workspace_admin'] });
  const employee = await createEmployeeWithAccount(db, workspaceId, {
    organizationId,
    employeeNumber: 'E001',
    displayName: '負荷 花子',
    email: 'hanako@example.com',
  });
  const instance = app();
  fixture = {
    workspaceId,
    employeeId: employee.employeeId,
    adminCookie: await loginAndGetCookie(instance, { email: 'admin@example.com' }),
    employeeCookie: await loginAndGetCookie(instance, { email: 'hanako@example.com' }),
  };
});

describe('まとまった量', () => {
  it('同じ冪等キーの打刻が同時に届いても、記録は 1 件だけになる', async () => {
    const instance = app();
    const send = async (): Promise<Response> =>
      instance.request(
        '/api/attendance/events',
        authorized(fixture.employeeCookie, {
          method: 'POST',
          body: {
            eventType: 'clock_in',
            requestId: 'load-same-request',
            occurredAt: '2026-04-01T00:00:00.000Z',
          },
        }),
      );

    const responses = await Promise.all(Array.from({ length: 20 }, send));

    // 断られた要求があってはいけない。再送は受け入れつつ、記録は増やさない。
    expect(responses.every((response) => response.status === 200 || response.status === 201)).toBe(
      true,
    );
    const rows = await testDatabase().query<{ count: number }>(
      'SELECT count(*)::int AS count FROM attendance_events',
    );
    expect(rows[0]?.count).toBe(1);
  });

  it('1 日に何度も出入りしても、区間が積み上がる', async () => {
    const instance = app();

    // 順に送る。同時に送ると、出勤と退勤のどちらが先に着くかで結果が変わり、
    // 量ではなく順番を見る検査になってしまう。
    for (let index = 0; index < 20; index += 1) {
      await instance.request(
        '/api/attendance/events',
        authorized(fixture.employeeCookie, {
          method: 'POST',
          body: {
            eventType: index % 2 === 0 ? 'clock_in' : 'clock_out',
            requestId: `load-sequence-${String(index).padStart(3, '0')}`,
            occurredAt: new Date(Date.UTC(2026, 3, 1, 0, index)).toISOString(),
          },
        }),
      );
    }

    const day = await instance.request(
      '/api/attendance/days/2026-04-01',
      authorized(fixture.employeeCookie),
    );
    const body = (await day.json()) as WorkDay;

    // 10 回の出勤と 10 回の退勤。区間は 10 本になる。
    expect(body.events).toHaveLength(20);
    expect(body.sessions).toHaveLength(10);
  });

  it('1 か月ぶんの日次があっても、月次は 1 回の要求で返る', async () => {
    // 4 月は 30 日まで。存在しない日を作ると、量ではなく日付の誤りで落ちる。
    const values: string[] = [];
    const parameters: (string | number)[] = [fixture.workspaceId, fixture.employeeId];
    for (let index = 0; index < 30; index += 1) {
      const date = `2026-04-${String(index + 1).padStart(2, '0')}`;
      const base = parameters.length + 1;
      values.push(
        `($1, $2, $${base}, 1, $${base + 1}, 'test', 540, 480, 60, 480, 480, 0, 0, 0, 0, 0, '{}'::jsonb)`,
      );
      parameters.push(date, `load-${date}`);
    }
    await testDatabase().query(
      `INSERT INTO attendance_calculations
         (workspace_id, employee_id, business_date, version, input_fingerprint, rule_version,
          attended_minutes, worked_minutes, break_minutes, scheduled_minutes,
          within_schedule_minutes, outside_schedule_minutes, night_minutes,
          non_working_day_minutes, leave_minutes, absence_minutes, basis)
       VALUES ${values.join(',')}`,
      parameters,
    );

    const response = await app().request(
      `/api/monthly-summaries?period=2026-04-01&employeeId=${fixture.employeeId}`,
      authorized(fixture.adminCookie),
    );

    expect(response.status).toBe(200);
    const { summaries } = (await response.json()) as {
      summaries: { workedMinutes: number; countedDays: number }[];
    };
    expect(summaries[0]).toMatchObject({ workedMinutes: 30 * 480, countedDays: 30 });
  });
});

describe('途中で壊れたとき', () => {
  it('保存の途中で落ちても、半端な記録を残さない', async () => {
    const db = testDatabase();
    let calls = 0;
    /*
     * 監査記録の書き込みだけを失敗させる。打刻と同じトランザクションで確定するため、
     * 片方だけが残れば「打刻はあるが誰が入れたか分からない」状態になる。
     *
     * 差し替えるのはトランザクションの中の問い合わせ。外側の query を差し替えても、
     * トランザクションは自分の接続を使うため、そこには届かない。
     */
    const failing = {
      ...db,
      transaction: <T>(fn: (tx: never) => Promise<T>): Promise<T> =>
        db.transaction((tx) =>
          fn({
            ...tx,
            query: async <R>(text: string, parameters?: readonly unknown[]): Promise<R[]> => {
              // 打刻の監査記録だけを狙う。監査記録すべてを止めると、
              // ログインの経路まで巻き込み、認証で断られて別の話になる。
              const isPunchAudit =
                text.includes('INSERT INTO audit_logs') &&
                (parameters ?? []).some(
                  (value) => typeof value === 'string' && value.startsWith('attendance_event'),
                );
              if (isPunchAudit) {
                calls += 1;
                throw new Error('検証のために監査記録を失敗させました');
              }
              return tx.query<R>(text, parameters as never);
            },
          } as never),
        ),
    };

    // 時刻は他の検査と揃える。揃えないと、セッションが期限切れになり、
    // 保存の途中で落ちたかどうかではなく、認証で断られた結果を見ることになる。
    const response = await createTestApp({
      db: failing as never,
      now: () => new Date('2026-04-01T09:00:00.000Z'),
    }).request(
      '/api/attendance/events',
      authorized(fixture.employeeCookie, {
        method: 'POST',
        body: {
          eventType: 'clock_in',
          requestId: 'fault-audit-fails',
          occurredAt: '2026-04-01T00:00:00.000Z',
        },
      }),
    );

    expect(response.status).toBe(500);
    expect(calls).toBeGreaterThan(0);
    const rows = await db.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM attendance_events',
    );
    // 打刻だけが残ることはない。
    expect(rows[0]?.count).toBe(0);
  });

  it('データベースへ届かないとき、入口は動いたまま不調を返す', async () => {
    const unreachable = {
      query: async () => {
        throw new Error('接続できません');
      },
      transaction: async () => {
        throw new Error('接続できません');
      },
      session: async () => {
        throw new Error('接続できません');
      },
      ping: async () => {
        throw new Error('接続できません');
      },
      close: async () => {},
    };

    const instance = createTestApp({ db: unreachable as never });
    const ready = await instance.request('/api/ready');
    const health = await instance.request('/api/health');

    // 生存は返す。落として再起動させても、データベースが戻るまでは同じことになる。
    expect(health.status).toBe(200);
    // 受け入れ可否は不調として返す。振り分ける側が外せるようにする。
    expect(ready.status).toBe(503);
  });
});
