/**
 * 設定の画面から出した取込用の CSV を、そのまま取り込めること。
 *
 * 画面の表は、見出しも値も表示の言語で出す。取込は機械の見出しと値を求める。
 * 同じ CSV を両方に使うと、表示の言語を変えただけで取り込めなくなる。
 *
 * そこで「表示用の出力」と「取込用の出力」を分けた。ここでは、取込用の側が
 * 本当に往復できることを固定する。画面の列の定義と取込の契約が離れると、
 * 往復できない CSV が「取込用」という名前で出続ける。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';
import {
  authorized,
  createOrganization,
  createTestApp,
  createUser,
  createWorkspace,
  loginAndGetCookie,
  type TestApp,
} from '../support/fixtures.js';

const app = (): TestApp => createTestApp();

let adminCookie: string;

beforeEach(async () => {
  const db = testDatabase();
  const workspaceId = await createWorkspace(db, { slug: 'default' });
  await createOrganization(db, workspaceId, { code: 'HQ' });
  await createUser(db, workspaceId, { email: 'admin@example.com', roles: ['workspace_admin'] });
  adminCookie = await loginAndGetCookie(app(), { email: 'admin@example.com' });
});

/** 画面が出す取込用の CSV と同じ列。定義が離れれば、この検査が落ちる。 */
const WORK_CATEGORY_COLUMNS = [
  'code',
  'internal_name',
  'display_name',
  'category_type',
  'effective_from',
  'effective_to',
  'scheduled_start',
  'scheduled_end',
  'shift',
  'counts_as_working_day',
] as const;

const REQUEST_TYPE_COLUMNS = [
  'code',
  'name',
  'category',
  'approval_steps',
  'requires_reason',
  'requires_leave_type',
  'requires_time_range',
  'requires_overtime_limit',
] as const;

function csv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const quote = (value: string): string => `"${value.replaceAll('"', '""')}"`;
  return [header.map(quote).join(','), ...rows.map((row) => row.map(quote).join(','))].join('\n');
}

async function importCsv(instance: TestApp, path: string, text: string): Promise<Response> {
  return instance.request(path, {
    method: 'POST',
    headers: { cookie: adminCookie, 'content-type': 'text/csv' },
    body: text,
  });
}

describe('取込用の CSV の往復', () => {
  it('勤務区分は、出した形をそのまま戻せる', async () => {
    const instance = app();
    const text = csv(WORK_CATEGORY_COLUMNS, [
      ['DAY', '通常勤務', '日勤', 'working_day', '2026-04-01', '', '540', '1080', 'false', 'true'],
      [
        'NIGHT',
        '夜勤',
        '夜勤',
        'working_day',
        '2026-04-01',
        '2026-12-31',
        '1320',
        '1800',
        'true',
        'true',
      ],
    ]);

    const first = await importCsv(instance, '/api/work-categories/imports', text);
    expect(first.status).toBe(200);

    // 出した形のまま、値の集合も機械の値で戻せる。
    const listed = await instance.request('/api/work-categories', authorized(adminCookie));
    const { workCategories } = (await listed.json()) as {
      workCategories: { code: string; categoryType: string; countsAsWorkingDay: boolean }[];
    };
    expect(workCategories.map((row) => row.code).sort()).toEqual(['DAY', 'NIGHT']);
    expect(workCategories[0]?.categoryType).toBe('working_day');
    expect(workCategories.every((row) => row.countsAsWorkingDay)).toBe(true);
  });

  it('申請種別も、出した形をそのまま戻せる', async () => {
    const instance = app();
    const text = csv(REQUEST_TYPE_COLUMNS, [
      ['OT', '残業', 'overtime', '2', 'true', 'false', 'false', 'true'],
      ['LEAVE', '休暇', 'leave', '1', 'true', 'true', 'false', 'false'],
    ]);

    const response = await importCsv(instance, '/api/request-types/imports', text);
    expect(response.status).toBe(200);

    const listed = await instance.request('/api/request-types', authorized(adminCookie));
    const { requestTypes } = (await listed.json()) as {
      requestTypes: { code: string; category: string; approvalSteps: number }[];
    };
    expect(requestTypes.map((row) => row.code).sort()).toEqual(['LEAVE', 'OT']);
    expect(requestTypes.find((row) => row.code === 'OT')?.approvalSteps).toBe(2);
  });

  /**
   * 表示の名前を機械の見出しとして扱う形へ戻すと、この検査が落ちる。
   */
  it('表示の言語の見出しでは取り込めない', async () => {
    const instance = app();
    const text = csv(
      ['コード', '管理用の名称', '従業員へ見せる名称', '区分の種別', '適用開始日'],
      [['DAY', '通常勤務', '日勤', '勤務日', '2026-04-01']],
    );

    const response = await importCsv(instance, '/api/work-categories/imports', text);

    expect(response.status).toBe(400);
  });

  it('値の集合を表示の名前で書くと取り込めない', async () => {
    const instance = app();
    const text = csv(WORK_CATEGORY_COLUMNS, [
      ['DAY', '通常勤務', '日勤', '勤務日', '2026-04-01', '', '', '', 'false', 'true'],
    ]);

    const response = await importCsv(instance, '/api/work-categories/imports', text);

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('勤務日');
  });
});
