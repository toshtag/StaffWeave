import { generateKeyPair, signPayload } from '@staffweave/agent';
import type {
  DeviceEventResponse,
  DeviceReceiptList,
  DeviceRecord,
  EnrollDeviceResponse,
  RegisterDeviceResponse,
} from '@staffweave/contracts';
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

const NOW = '2026-04-01T00:00:00.000Z';

function app(now: string = NOW) {
  return createApp({
    db: testDatabase(),
    defaultWorkspaceSlug: 'default',
    now: () => new Date(now),
  });
}

type App = ReturnType<typeof app>;

interface Fixture {
  adminCookie: string;
  employeeCookie: string;
}

async function setUp(): Promise<Fixture> {
  const workspaceId = await createWorkspace(testDatabase(), { slug: 'default' });
  const organizationId = await createOrganization(testDatabase(), workspaceId, { code: 'HQ' });
  await createUser(testDatabase(), workspaceId, {
    email: 'admin@example.com',
    roles: ['workspace_admin'],
  });
  await createEmployeeWithAccount(testDatabase(), workspaceId, {
    organizationId,
    employeeNumber: 'E001',
    displayName: '勤怠 花子',
    email: 'hanako@example.com',
  });

  const instance = app();
  return {
    adminCookie: await loginAndGetCookie(instance, { email: 'admin@example.com' }),
    employeeCookie: await loginAndGetCookie(instance, { email: 'hanako@example.com' }),
  };
}

async function registerDevice(instance: App, cookie: string): Promise<RegisterDeviceResponse> {
  const response = await instance.request(
    '/api/devices',
    authorized(cookie, { method: 'POST', body: { name: '入口の端末' } }),
  );
  return (await response.json()) as RegisterDeviceResponse;
}

interface EnrolledDevice {
  deviceId: string;
  privateKeyPem: string;
}

async function enrollDevice(instance: App, cookie: string): Promise<EnrolledDevice> {
  const registered = await registerDevice(instance, cookie);
  const keyPair = generateKeyPair();
  const response = await instance.request('/api/device-agent/enroll', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      enrollmentToken: registered.enrollmentToken,
      publicKey: keyPair.publicKeyPem,
    }),
  });
  const enrolled = (await response.json()) as EnrollDeviceResponse;
  return { deviceId: enrolled.deviceId, privateKeyPem: keyPair.privateKeyPem };
}

interface EventInput {
  sequence: number;
  requestId: string;
  employeeNumber?: string;
  eventType?: 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
  occurredAt?: string;
  deviceTime?: string;
}

async function sendSignedEvent(
  instance: App,
  device: EnrolledDevice,
  input: EventInput,
  overrides: { signature?: string; deviceId?: string } = {},
): Promise<Response> {
  const payload = {
    sequence: input.sequence,
    requestId: input.requestId,
    employeeNumber: input.employeeNumber ?? 'E001',
    eventType: input.eventType ?? ('clock_in' as const),
    occurredAt: input.occurredAt ?? NOW,
    deviceTime: input.deviceTime ?? NOW,
  };

  const signature =
    overrides.signature ??
    signPayload(device.privateKeyPem, { deviceId: device.deviceId, ...payload });

  return instance.request('/api/device-agent/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-staffweave-device': overrides.deviceId ?? device.deviceId,
      'x-staffweave-signature': signature,
    },
    body: JSON.stringify(payload),
  });
}

describe('端末の登録', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setUp();
  });

  it('登録トークンを発行し、Agent が公開鍵を登録できる', async () => {
    const instance = app();
    const registered = await registerDevice(instance, fixture.adminCookie);

    expect(registered.device.state).toBe('pending');
    expect(registered.enrollmentToken.length).toBeGreaterThan(16);

    const keyPair = generateKeyPair();
    const response = await instance.request('/api/device-agent/enroll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        enrollmentToken: registered.enrollmentToken,
        publicKey: keyPair.publicKeyPem,
      }),
    });
    const enrolled = (await response.json()) as EnrollDeviceResponse;

    expect(response.status).toBe(200);
    expect(enrolled.device.state).toBe('active');
    expect(enrolled.device.enrollments).toBe(1);
    expect(enrolled.workspaceSlug).toBe('default');
  });

  it('登録トークンは一度しか使えない', async () => {
    const instance = app();
    const registered = await registerDevice(instance, fixture.adminCookie);
    const body = {
      enrollmentToken: registered.enrollmentToken,
      publicKey: generateKeyPair().publicKeyPem,
    };

    await instance.request('/api/device-agent/enroll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const second = await instance.request('/api/device-agent/enroll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect(second.status).toBe(401);
  });

  it('Ed25519 でない鍵は受け付けない', async () => {
    const instance = app();
    const registered = await registerDevice(instance, fixture.adminCookie);

    const response = await instance.request('/api/device-agent/enroll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        enrollmentToken: registered.enrollmentToken,
        publicKey: '-----BEGIN PUBLIC KEY-----\nnot-a-real-key\n-----END PUBLIC KEY-----\n',
      }),
    });

    expect(response.status).toBe(400);
  });

  it('従業員ロールは端末を登録できない', async () => {
    const response = await app().request(
      '/api/devices',
      authorized(fixture.employeeCookie, { method: 'POST', body: { name: '勝手な端末' } }),
    );
    expect(response.status).toBe(403);
  });
});

describe('署名イベントの受理', () => {
  let fixture: Fixture;
  let device: EnrolledDevice;

  beforeEach(async () => {
    fixture = await setUp();
    device = await enrollDevice(app(), fixture.adminCookie);
  });

  it('署名が正しければ打刻として記録される', async () => {
    const response = await sendSignedEvent(app(), device, {
      sequence: 1,
      requestId: 'device-request-1',
    });
    const body = (await response.json()) as DeviceEventResponse;

    expect(response.status).toBe(201);
    expect(body.outcome).toBe('accepted');
    expect(body.attendanceEventId).not.toBeNull();
    expect(body.sequenceStep).toBe(1);

    const rows = await testDatabase().query<{ source: string }>(
      'SELECT source FROM attendance_events',
    );
    expect(rows[0]?.source).toBe('device');
  });

  it('署名が合わなければ受け付けない', async () => {
    const response = await sendSignedEvent(
      app(),
      device,
      { sequence: 1, requestId: 'device-bad-signature' },
      { signature: Buffer.from('not a signature').toString('base64') },
    );

    expect(response.status).toBe(401);
    const rows = await testDatabase().query<{ count: number }>(
      'SELECT count(*)::int AS count FROM attendance_events',
    );
    expect(rows[0]?.count).toBe(0);
  });

  it('本文を改ざんすると受け付けない', async () => {
    const instance = app();
    const signature = signPayload(device.privateKeyPem, {
      deviceId: device.deviceId,
      sequence: 1,
      requestId: 'device-tampered',
      employeeNumber: 'E001',
      eventType: 'clock_in',
      occurredAt: NOW,
      deviceTime: NOW,
    });

    const response = await instance.request('/api/device-agent/events', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-staffweave-device': device.deviceId,
        'x-staffweave-signature': signature,
      },
      // 署名した内容と異なる従業員番号を送る。
      body: JSON.stringify({
        sequence: 1,
        requestId: 'device-tampered',
        employeeNumber: 'E999',
        eventType: 'clock_in',
        occurredAt: NOW,
        deviceTime: NOW,
      }),
    });

    expect(response.status).toBe(401);
  });

  it('同じ冪等キーの再送は 1 件しか記録しない', async () => {
    const instance = app();
    const input = { sequence: 1, requestId: 'device-idempotent' };

    const first = await sendSignedEvent(instance, device, input);
    const second = await sendSignedEvent(instance, device, input);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(((await second.json()) as DeviceEventResponse).outcome).toBe('duplicate');

    const rows = await testDatabase().query<{ count: number }>(
      'SELECT count(*)::int AS count FROM attendance_events',
    );
    expect(rows[0]?.count).toBe(1);
  });

  it('連番の欠落を受け入れたうえで記録に残す', async () => {
    const instance = app();
    await sendSignedEvent(instance, device, { sequence: 1, requestId: 'device-seq-1' });

    const response = await sendSignedEvent(instance, device, {
      sequence: 5,
      requestId: 'device-seq-5',
      eventType: 'clock_out',
    });
    const body = (await response.json()) as DeviceEventResponse;

    expect(response.status).toBe(201);
    expect(body.sequenceStep).toBe(4);

    const receipts = await testDatabase().query<{
      sequence_step: number;
      detail: { sequenceGap?: number };
    }>('SELECT sequence_step, detail FROM device_event_receipts ORDER BY sequence');
    expect(receipts[1]?.detail.sequenceGap).toBe(3);
  });

  it('連番が戻った送信は断り、記録に残す', async () => {
    const instance = app();
    await sendSignedEvent(instance, device, { sequence: 3, requestId: 'device-seq-3' });

    const response = await sendSignedEvent(instance, device, {
      sequence: 2,
      requestId: 'device-seq-2',
      eventType: 'clock_out',
    });

    expect(response.status).toBe(409);

    const receipts = await testDatabase().query<{ outcome: string }>(
      'SELECT outcome FROM device_event_receipts WHERE sequence = 2',
    );
    expect(receipts[0]?.outcome).toBe('rejected');
  });

  it('断った要求の再送は、受理せずに同じ理由で断る', async () => {
    const instance = app();
    await sendSignedEvent(instance, device, { sequence: 3, requestId: 'device-seq-ahead' });

    const input = {
      sequence: 2,
      requestId: 'device-rejected-retry',
      eventType: 'clock_out',
    } as const;
    const rejected = await sendSignedEvent(instance, device, input);
    const reason = ((await rejected.json()) as { error: { message: string } }).error.message;
    expect(rejected.status).toBe(409);

    const resent = await sendSignedEvent(instance, device, input);

    expect(resent.status).toBe(409);
    expect(((await resent.json()) as { error: { message: string } }).error.message).toBe(reason);
  });

  it('端末時計のずれを記録する', async () => {
    const response = await sendSignedEvent(app(), device, {
      sequence: 1,
      requestId: 'device-clock-skew',
      // 端末の時計が 5 分進んでいる。
      deviceTime: '2026-04-01T00:05:00.000Z',
    });
    const body = (await response.json()) as DeviceEventResponse;

    expect(body.clockSkewSeconds).toBe(300);

    const receipts = await testDatabase().query<{ detail: { notableClockSkew?: boolean } }>(
      'SELECT detail FROM device_event_receipts',
    );
    expect(receipts[0]?.detail.notableClockSkew).toBe(true);
  });

  it('存在しない従業員番号は 404 を返す', async () => {
    const response = await sendSignedEvent(app(), device, {
      sequence: 1,
      requestId: 'device-unknown-employee',
      employeeNumber: 'E999',
    });
    expect(response.status).toBe(404);
  });

  it('受け付けられない打刻は 409 を返す', async () => {
    const instance = app();
    await sendSignedEvent(instance, device, { sequence: 1, requestId: 'device-order-1' });
    const response = await sendSignedEvent(instance, device, {
      sequence: 2,
      requestId: 'device-order-2',
      eventType: 'clock_in',
    });

    expect(response.status).toBe(409);
  });
});

describe('端末の失効', () => {
  let fixture: Fixture;
  let device: EnrolledDevice;

  beforeEach(async () => {
    fixture = await setUp();
    device = await enrollDevice(app(), fixture.adminCookie);
  });

  it('失効した端末の署名イベントは受け付けない', async () => {
    const instance = app();
    const revoked = await instance.request(
      `/api/devices/${device.deviceId}/revoke`,
      authorized(fixture.adminCookie, { method: 'POST' }),
    );
    expect(((await revoked.json()) as DeviceRecord).state).toBe('revoked');

    const response = await sendSignedEvent(instance, device, {
      sequence: 1,
      requestId: 'device-after-revoke',
    });
    expect(response.status).toBe(401);
  });

  it('二重に失効させられない', async () => {
    const instance = app();
    await instance.request(
      `/api/devices/${device.deviceId}/revoke`,
      authorized(fixture.adminCookie, { method: 'POST' }),
    );
    const second = await instance.request(
      `/api/devices/${device.deviceId}/revoke`,
      authorized(fixture.adminCookie, { method: 'POST' }),
    );
    expect(second.status).toBe(409);
  });

  it('受信記録を後から確認できる', async () => {
    const instance = app();
    await sendSignedEvent(instance, device, { sequence: 1, requestId: 'device-receipt-1' });

    const response = await instance.request(
      `/api/devices/${device.deviceId}/receipts`,
      authorized(fixture.adminCookie),
    );
    const body = (await response.json()) as DeviceReceiptList;

    expect(response.status).toBe(200);
    expect(body.receipts).toHaveLength(1);
    expect(body.receipts[0]?.outcome).toBe('accepted');
  });

  it('受信記録は書き換えられない', async () => {
    await sendSignedEvent(app(), device, { sequence: 1, requestId: 'device-receipt-lock' });

    await expect(
      testDatabase().query("UPDATE device_event_receipts SET outcome = 'rejected'"),
    ).rejects.toThrow(/追記のみ/);
  });
});

describe('ワークスペース境界（端末）', () => {
  it('別ワークスペースの端末は見えない', async () => {
    const first = await createWorkspace(testDatabase(), { slug: 'default' });
    const second = await createWorkspace(testDatabase(), { slug: 'other' });
    await createUser(testDatabase(), first, {
      email: 'admin@example.com',
      roles: ['workspace_admin'],
    });
    await createUser(testDatabase(), second, {
      email: 'admin@example.com',
      roles: ['workspace_admin'],
    });

    const instance = app();
    const firstCookie = await loginAndGetCookie(instance, { email: 'admin@example.com' });
    const secondCookie = await loginAndGetCookie(instance, {
      email: 'admin@example.com',
      workspaceSlug: 'other',
    });

    const registered = await registerDevice(instance, firstCookie);

    const response = await instance.request(
      `/api/devices/${registered.device.id}/revoke`,
      authorized(secondCookie, { method: 'POST' }),
    );
    expect(response.status).toBe(404);
  });
});
