/**
 * 勤務区分と申請種別の一括投入。
 *
 * ここで固定したいのは 3 つ。
 *
 *   1 行でも読めなければ 1 行も取り込まないこと
 *   読めなかった行が、行番号つきで返ること
 *   権限の無い利用者が取り込めないこと
 */
import type { RequestTypeList, WorkCategoryList } from '@staffweave/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';
import {
  authorized,
  createTestApp,
  createUser,
  createWorkspace,
  loginAndGetCookie,
  type TestApp,
} from '../support/fixtures.js';

const app = (): TestApp => createTestApp();

interface Fixture {
  workspaceId: string;
  adminCookie: string;
  plainCookie: string;
}

let fixture: Fixture;

beforeEach(async () => {
  const db = testDatabase();
  const workspaceId = await createWorkspace(db, { slug: 'default' });
  await createUser(db, workspaceId, { email: 'admin@example.com', roles: ['workspace_admin'] });
  await createUser(db, workspaceId, { email: 'plain@example.com', roles: ['employee'] });

  const instance = app();
  fixture = {
    workspaceId,
    adminCookie: await loginAndGetCookie(instance, { email: 'admin@example.com' }),
    plainCookie: await loginAndGetCookie(instance, { email: 'plain@example.com' }),
  };
});

async function csv(
  instance: TestApp,
  path: string,
  body: string,
  cookie: string,
): Promise<Response> {
  return instance.request(path, {
    method: 'POST',
    headers: { cookie, 'content-type': 'text/csv' },
    body,
  });
}

describe('勤務区分の取込', () => {
  const path = '/api/work-categories/imports';
  const header =
    'code,internal_name,display_name,category_type,effective_from,scheduled_start,scheduled_end\n';

  it('複数の行をまとめて取り込む', async () => {
    const instance = app();

    const response = await csv(
      instance,
      path,
      `${header}DAY,日勤,日勤,working_day,2026-04-01,9:00,18:00\n` +
        `NIGHT,夜勤,夜勤,working_day,2026-04-01,22:00,\n`,
      fixture.adminCookie,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ created: 2 });

    const listed = await instance.request('/api/work-categories', authorized(fixture.adminCookie));
    const { workCategories } = (await listed.json()) as WorkCategoryList;
    expect(workCategories.map((row) => row.code).sort()).toEqual(['DAY', 'NIGHT']);
  });

  it('1 行でも読めなければ、何も取り込まない', async () => {
    const instance = app();

    const response = await csv(
      instance,
      path,
      `${header}DAY,日勤,日勤,working_day,2026-04-01,9:00,18:00\n` +
        `BAD,誤り,誤り,unknown_type,2026-04-01,,\n`,
      fixture.adminCookie,
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { details?: { field: string }[] } };
    expect(body.error.details?.[0]?.field).toBe('line:3');

    const listed = await instance.request('/api/work-categories', authorized(fixture.adminCookie));
    expect(((await listed.json()) as WorkCategoryList).workCategories).toEqual([]);
  });

  it('同じ code の期間が重なる行は、まとめて断る', async () => {
    const instance = app();
    await csv(
      instance,
      path,
      `${header}DAY,日勤,日勤,working_day,2026-04-01,9:00,18:00\n`,
      fixture.adminCookie,
    );

    const response = await csv(
      instance,
      path,
      `${header}DAY,日勤,日勤,working_day,2026-06-01,9:00,18:00\n`,
      fixture.adminCookie,
    );

    // 期間が重なる版は DB の排他が断る。
    expect(response.status).toBe(400);
  });

  it('見出しが足りなければ断る', async () => {
    const instance = app();

    const response = await csv(instance, path, 'code\nDAY\n', fixture.adminCookie);

    expect(response.status).toBe(400);
  });

  it('権限の無い利用者は取り込めない', async () => {
    const instance = app();

    const response = await csv(
      instance,
      path,
      `${header}DAY,日勤,日勤,working_day,2026-04-01,9:00,18:00\n`,
      fixture.plainCookie,
    );

    expect(response.status).toBe(403);
  });
});

describe('申請種別の取込', () => {
  const path = '/api/request-types/imports';
  const header = 'code,name,category,approval_steps,requires_leave_type\n';

  it('複数の行をまとめて取り込む', async () => {
    const instance = app();

    const response = await csv(
      instance,
      path,
      `${header}OT,残業,overtime,1,\nPAID,有給,leave,2,true\n`,
      fixture.adminCookie,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ created: 2 });

    const listed = await instance.request('/api/request-types', authorized(fixture.adminCookie));
    const { requestTypes } = (await listed.json()) as RequestTypeList;
    expect(requestTypes.map((row) => row.code).sort()).toEqual(['OT', 'PAID']);
  });

  it('休暇の申請で休暇種別を必須にしない行は断る', async () => {
    const instance = app();

    const response = await csv(
      instance,
      path,
      `${header}PAID,有給,leave,1,false\n`,
      fixture.adminCookie,
    );

    expect(response.status).toBe(400);
  });

  it('段数が範囲の外なら断り、何も取り込まない', async () => {
    const instance = app();

    const response = await csv(
      instance,
      path,
      `${header}OT,残業,overtime,1,\nNG,誤り,other,9,\n`,
      fixture.adminCookie,
    );

    expect(response.status).toBe(400);

    const listed = await instance.request('/api/request-types', authorized(fixture.adminCookie));
    expect(((await listed.json()) as RequestTypeList).requestTypes).toEqual([]);
  });

  it('すでにある code は、行の位置つきで断る', async () => {
    const instance = app();
    await csv(instance, path, `${header}OT,残業,overtime,1,\n`, fixture.adminCookie);

    const response = await csv(
      instance,
      path,
      `${header}OT,残業,overtime,1,\n`,
      fixture.adminCookie,
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain('2 行目');
  });

  it('権限の無い利用者は取り込めない', async () => {
    const instance = app();

    const response = await csv(
      instance,
      path,
      `${header}OT,残業,overtime,1,\n`,
      fixture.plainCookie,
    );

    expect(response.status).toBe(403);
  });
});
