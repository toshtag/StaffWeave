/**
 * 打刻時の位置情報。
 *
 * ここで固定したいのは 4 つ。
 *
 *   opt-in していない組織では、送られてきても保存しないこと
 *   位置情報が取れなくても、打刻が残ること
 *   本人と、閲覧範囲に入っている相手だけが読めること
 *   打刻の行と別に持ち、打刻を消さずに位置情報だけを消せること
 */
import type { AttendanceLocationList } from '@staffweave/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';
import {
  authorized,
  createEmployeeWithAccount,
  createOrganization,
  createUser,
  createWorkspace,
  grantOrganizationScope,
  loginAndGetCookie,
  type TestApp,
  testAppFactory,
} from '../support/fixtures.js';

const BUSINESS_DATE = '2026-04-01';
const IN_AT = '2026-04-01T00:00:00.000Z';
const app = testAppFactory({ now: '2026-04-01T06:00:00.000Z' });

const TOKYO_STATION = { latitude: 35.681236, longitude: 139.767125, accuracyMeters: 12 };

interface Fixture {
  workspaceId: string;
  organizationId: string;
  branchId: string;
  employeeId: string;
  employeeCookie: string;
  adminCookie: string;
  managerCookie: string;
  outsiderCookie: string;
}

let fixture: Fixture;

beforeEach(async () => {
  const db = testDatabase();
  const workspaceId = await createWorkspace(db, { slug: 'default' });
  const organizationId = await createOrganization(db, workspaceId, { code: 'HQ' });
  const branchId = await createOrganization(db, workspaceId, { code: 'BR' });

  await createUser(db, workspaceId, { email: 'admin@example.com', roles: ['workspace_admin'] });
  const manager = await createUser(db, workspaceId, {
    email: 'manager@example.com',
    roles: ['organization_manager'],
  });
  await grantOrganizationScope(db, workspaceId, { userId: manager, organizationId });
  const outsider = await createUser(db, workspaceId, {
    email: 'outsider@example.com',
    roles: ['organization_manager'],
  });
  await grantOrganizationScope(db, workspaceId, { userId: outsider, organizationId: branchId });

  const employee = await createEmployeeWithAccount(db, workspaceId, {
    organizationId,
    employeeNumber: 'E001',
    displayName: '位置 花子',
    email: 'hanako@example.com',
  });

  const instance = app();
  fixture = {
    workspaceId,
    organizationId,
    branchId,
    employeeId: employee.employeeId,
    employeeCookie: await loginAndGetCookie(instance, { email: 'hanako@example.com' }),
    adminCookie: await loginAndGetCookie(instance, { email: 'admin@example.com' }),
    managerCookie: await loginAndGetCookie(instance, { email: 'manager@example.com' }),
    outsiderCookie: await loginAndGetCookie(instance, { email: 'outsider@example.com' }),
  };
});

async function optIn(instance: TestApp, locationCapture: boolean): Promise<Response> {
  return instance.request(
    `/api/organizations/${fixture.organizationId}`,
    authorized(fixture.adminCookie, { method: 'PATCH', body: { locationCapture } }),
  );
}

async function punch(
  instance: TestApp,
  requestId: string,
  location?: Record<string, number>,
): Promise<Response> {
  return instance.request(
    '/api/attendance/events',
    authorized(fixture.employeeCookie, {
      method: 'POST',
      body: {
        eventType: 'clock_in',
        requestId,
        occurredAt: IN_AT,
        source: 'mobile',
        ...(location === undefined ? {} : { location }),
      },
    }),
  );
}

async function locations(instance: TestApp, cookie: string): Promise<Response> {
  return instance.request(
    `/api/attendance/locations?employeeId=${fixture.employeeId}` +
      `&from=${BUSINESS_DATE}&to=${BUSINESS_DATE}`,
    authorized(cookie),
  );
}

async function read(instance: TestApp, cookie: string): Promise<AttendanceLocationList> {
  const response = await locations(instance, cookie);
  if (response.status !== 200) throw new Error(`位置情報を読めませんでした: ${response.status}`);
  return (await response.json()) as AttendanceLocationList;
}

describe('組織ごとの opt-in', () => {
  it('既定では、送られてきても保存しない', async () => {
    const instance = app();

    expect((await punch(instance, 'location-off-1', TOKYO_STATION)).status).toBe(201);

    expect((await read(instance, fixture.adminCookie)).locations).toEqual([]);
  });

  it('取ると決めた組織では保存する', async () => {
    const instance = app();
    expect((await optIn(instance, true)).status).toBe(200);

    expect((await punch(instance, 'location-on-1', TOKYO_STATION)).status).toBe(201);

    const { locations: rows } = await read(instance, fixture.adminCookie);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      businessDate: BUSINESS_DATE,
      eventType: 'clock_in',
      accuracyMeters: 12,
    });
    expect(rows[0]?.latitude).toBeCloseTo(35.681236, 5);
  });

  it('取ると決めていても、位置情報が無い打刻は受け付ける', async () => {
    const instance = app();
    await optIn(instance, true);

    expect((await punch(instance, 'location-none-1')).status).toBe(201);
    expect((await read(instance, fixture.adminCookie)).locations).toEqual([]);
  });

  it('opt-in を戻すと、それ以降は保存しない', async () => {
    const instance = app();
    await optIn(instance, true);
    await punch(instance, 'location-toggle-1', TOKYO_STATION);
    await optIn(instance, false);

    // 出勤済みなので、次は退勤で打刻する。
    await instance.request(
      '/api/attendance/events',
      authorized(fixture.employeeCookie, {
        method: 'POST',
        body: {
          eventType: 'clock_out',
          requestId: 'location-toggle-2',
          occurredAt: '2026-04-01T05:00:00.000Z',
          source: 'mobile',
          location: TOKYO_STATION,
        },
      }),
    );

    // 前の分は残るが、新しい分は保存されない。
    expect((await read(instance, fixture.adminCookie)).locations).toHaveLength(1);
  });

  it('位置情報を扱えない利用者は、組織の設定を変えられない', async () => {
    const instance = app();

    const response = await instance.request(
      `/api/organizations/${fixture.organizationId}`,
      authorized(fixture.employeeCookie, { method: 'PATCH', body: { locationCapture: true } }),
    );

    expect(response.status).toBe(403);
  });
});

describe('打刻そのものを失わせない', () => {
  it('緯度が範囲の外なら、打刻ごと断る', async () => {
    const instance = app();
    await optIn(instance, true);

    const response = await punch(instance, 'location-bad-1', {
      latitude: 999,
      longitude: 139.7,
      accuracyMeters: 10,
    });

    // 契約の検証で断る。壊れた値を黙って捨てると、送った側は残ったと思う。
    expect(response.status).toBe(400);
  });
});

describe('閲覧の権限', () => {
  it('本人は自分の位置情報を読める', async () => {
    const instance = app();
    await optIn(instance, true);
    await punch(instance, 'location-self-1', TOKYO_STATION);

    expect((await read(instance, fixture.employeeCookie)).locations).toHaveLength(1);
  });

  it('閲覧範囲に入っている相手は読める', async () => {
    const instance = app();
    await optIn(instance, true);
    await punch(instance, 'location-manager-1', TOKYO_STATION);

    expect((await read(instance, fixture.managerCookie)).locations).toHaveLength(1);
  });

  it('範囲の外の相手は読めない', async () => {
    const instance = app();
    await optIn(instance, true);
    await punch(instance, 'location-outsider-1', TOKYO_STATION);

    expect((await locations(instance, fixture.outsiderCookie)).status).toBe(403);
  });
});

describe('保持期間', () => {
  it('位置情報だけを消しても、打刻は残る', async () => {
    const instance = app();
    await optIn(instance, true);
    await punch(instance, 'location-retention-1', TOKYO_STATION);

    const db = testDatabase();
    await db.query('DELETE FROM attendance_event_locations WHERE workspace_id = $1', [
      fixture.workspaceId,
    ]);

    expect((await read(instance, fixture.adminCookie)).locations).toEqual([]);

    const day = await instance.request(
      `/api/attendance/days/${BUSINESS_DATE}`,
      authorized(fixture.employeeCookie),
    );
    const { events } = (await day.json()) as { events: unknown[] };
    expect(events).toHaveLength(1);
  });
});
