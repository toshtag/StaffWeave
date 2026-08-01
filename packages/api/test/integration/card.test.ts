import {
  cardFingerprint,
  createScriptedCardReader,
  generateKeyPair,
  signMessage,
} from '@staffweave/agent';
import type {
  CardCredentialList,
  CardCredentialRecord,
  CardEventResponse,
  CreateCardRegistrationResponse,
  EnrollDeviceResponse,
  RegisterDeviceResponse,
} from '@staffweave/contracts';
import { canonicalCardEvent, canonicalCardRegistration } from '@staffweave/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';
import { createApp } from '../../src/app.js';
import { deriveCardFingerprintKey } from '../../src/shared/security/card-fingerprint-key.js';
import {
  authorized,
  createEmployeeWithAccount,
  createOrganization,
  createUser,
  createWorkspace,
  loginAndGetCookie,
} from '../support/fixtures.js';

const NOW = '2026-04-01T00:00:00.000Z';
/** 端末へ渡す鍵の元になる共通の鍵。端末が受け取るのは Workspace ごとに導出した鍵。 */
const CARD_MASTER_KEY = 'test-card-fingerprint-master-key';

function app(now: string = NOW, masterKey: string | null = CARD_MASTER_KEY) {
  return createApp({
    db: testDatabase(),
    defaultWorkspaceSlug: 'default',
    now: () => new Date(now),
    cardFingerprintMasterKey: masterKey,
  });
}

type App = ReturnType<typeof app>;

interface Fixture {
  adminCookie: string;
  employeeId: string;
  secondEmployeeId: string;
  device: { deviceId: string; privateKeyPem: string; cardKey: string };
}

async function setUp(): Promise<Fixture> {
  const workspaceId = await createWorkspace(testDatabase(), { slug: 'default' });
  const organizationId = await createOrganization(testDatabase(), workspaceId, { code: 'HQ' });
  await createUser(testDatabase(), workspaceId, {
    email: 'admin@example.com',
    roles: ['workspace_admin'],
  });
  const first = await createEmployeeWithAccount(testDatabase(), workspaceId, {
    organizationId,
    employeeNumber: 'E001',
    displayName: '勤怠 花子',
    email: 'hanako@example.com',
  });
  const second = await createEmployeeWithAccount(testDatabase(), workspaceId, {
    organizationId,
    employeeNumber: 'E002',
    displayName: '打刻 次郎',
    email: 'jiro@example.com',
  });

  const instance = app();
  const adminCookie = await loginAndGetCookie(instance, { email: 'admin@example.com' });

  const registered = (await (
    await instance.request(
      '/api/devices',
      authorized(adminCookie, { method: 'POST', body: { name: '入口の端末' } }),
    )
  ).json()) as RegisterDeviceResponse;

  const keyPair = generateKeyPair();
  const enrolled = (await (
    await instance.request('/api/device-agent/enroll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        enrollmentToken: registered.enrollmentToken,
        publicKey: keyPair.publicKeyPem,
      }),
    })
  ).json()) as EnrollDeviceResponse;

  // 端末が受け取るのは、その Workspace 用に導出した鍵。共通の鍵そのものは渡らない。
  expect(enrolled.cardFingerprintKey).toBe(deriveCardFingerprintKey(CARD_MASTER_KEY, workspaceId));

  return {
    adminCookie,
    employeeId: first.employeeId,
    secondEmployeeId: second.employeeId,
    device: {
      deviceId: enrolled.deviceId,
      privateKeyPem: keyPair.privateKeyPem,
      cardKey: enrolled.cardFingerprintKey ?? '',
    },
  };
}

async function issueRegistrationToken(
  instance: App,
  fixture: Fixture,
  employeeId: string,
): Promise<string> {
  const response = await instance.request(
    '/api/card-credentials/registrations',
    authorized(fixture.adminCookie, { method: 'POST', body: { employeeId, label: '社員証' } }),
  );
  return ((await response.json()) as CreateCardRegistrationResponse).registrationToken;
}

async function registerCard(
  instance: App,
  fixture: Fixture,
  input: { registrationToken: string; rawCardId: string },
): Promise<Response> {
  const body = {
    registrationToken: input.registrationToken,
    cardFingerprint: cardFingerprint(fixture.device.cardKey, input.rawCardId),
  };
  const signature = signMessage(
    fixture.device.privateKeyPem,
    canonicalCardRegistration({ deviceId: fixture.device.deviceId, ...body }),
  );

  return instance.request('/api/device-agent/card-credentials', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-staffweave-device': fixture.device.deviceId,
      'x-staffweave-signature': signature,
    },
    body: JSON.stringify(body),
  });
}

async function tapCard(
  instance: App,
  fixture: Fixture,
  input: { sequence: number; requestId: string; rawCardId: string; eventType?: string },
): Promise<Response> {
  const body = {
    sequence: input.sequence,
    requestId: input.requestId,
    cardFingerprint: cardFingerprint(fixture.device.cardKey, input.rawCardId),
    ...(input.eventType === undefined ? {} : { eventType: input.eventType }),
    occurredAt: NOW,
    deviceTime: NOW,
  };
  const signature = signMessage(
    fixture.device.privateKeyPem,
    canonicalCardEvent({
      deviceId: fixture.device.deviceId,
      sequence: body.sequence,
      requestId: body.requestId,
      cardFingerprint: body.cardFingerprint,
      eventType: (input.eventType ?? '') as '',
      occurredAt: body.occurredAt,
      deviceTime: body.deviceTime,
    }),
  );

  return instance.request('/api/device-agent/card-events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-staffweave-device': fixture.device.deviceId,
      'x-staffweave-signature': signature,
    },
    body: JSON.stringify(body),
  });
}

describe('カードの登録', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setUp();
  });

  it('登録トークンと読み取った指紋を結び付けて登録できる', async () => {
    const instance = app();
    const token = await issueRegistrationToken(instance, fixture, fixture.employeeId);
    const response = await registerCard(instance, fixture, {
      registrationToken: token,
      rawCardId: '0123456789ABCDEF',
    });
    const credential = (await response.json()) as CardCredentialRecord;

    expect(response.status).toBe(201);
    expect(credential.state).toBe('active');
    expect(credential.employeeId).toBe(fixture.employeeId);
  });

  it('生のカード識別子は保存されない', async () => {
    const instance = app();
    const token = await issueRegistrationToken(instance, fixture, fixture.employeeId);
    await registerCard(instance, fixture, {
      registrationToken: token,
      rawCardId: '0123456789ABCDEF',
    });

    const rows = await testDatabase().query<{ fingerprint: string }>(
      'SELECT fingerprint FROM card_credentials',
    );
    expect(rows[0]?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.fingerprint).not.toContain('0123456789ABCDEF');

    // 応答にも指紋は含めない。
    const listed = await instance.request('/api/card-credentials', authorized(fixture.adminCookie));
    const body = (await listed.json()) as CardCredentialList;
    expect(JSON.stringify(body)).not.toContain(rows[0]?.fingerprint ?? '');
  });

  it('同じカードを別の従業員へ登録できない', async () => {
    const instance = app();
    const firstToken = await issueRegistrationToken(instance, fixture, fixture.employeeId);
    await registerCard(instance, fixture, {
      registrationToken: firstToken,
      rawCardId: 'DUPLICATE-CARD',
    });

    const secondToken = await issueRegistrationToken(instance, fixture, fixture.secondEmployeeId);
    const response = await registerCard(instance, fixture, {
      registrationToken: secondToken,
      rawCardId: 'DUPLICATE-CARD',
    });

    expect(response.status).toBe(409);
  });

  it('登録トークンは一度しか使えない', async () => {
    const instance = app();
    const token = await issueRegistrationToken(instance, fixture, fixture.employeeId);
    await registerCard(instance, fixture, { registrationToken: token, rawCardId: 'CARD-A' });
    const second = await registerCard(instance, fixture, {
      registrationToken: token,
      rawCardId: 'CARD-B',
    });

    expect(second.status).toBe(401);
  });

  it('登録に失敗した登録トークンは消費されず、別のカードで使い直せる', async () => {
    const instance = app();
    const firstToken = await issueRegistrationToken(instance, fixture, fixture.employeeId);
    await registerCard(instance, fixture, {
      registrationToken: firstToken,
      rawCardId: 'TAKEN-CARD',
    });

    // すでに他人が使っているカードで登録し、失敗させる。
    const secondToken = await issueRegistrationToken(instance, fixture, fixture.secondEmployeeId);
    const rejected = await registerCard(instance, fixture, {
      registrationToken: secondToken,
      rawCardId: 'TAKEN-CARD',
    });
    expect(rejected.status).toBe(409);

    const retried = await registerCard(instance, fixture, {
      registrationToken: secondToken,
      rawCardId: 'FREE-CARD',
    });

    expect(retried.status).toBe(201);
    expect(((await retried.json()) as CardCredentialRecord).employeeId).toBe(
      fixture.secondEmployeeId,
    );
  });

  it('有効期限が切れた登録トークンは使えない', async () => {
    const instance = app();
    const token = await issueRegistrationToken(instance, fixture, fixture.employeeId);

    // 16 分後の時計で登録しようとする（既定の有効時間は 15 分）。
    const later = app('2026-04-01T00:16:00.000Z');
    const response = await registerCard(later, fixture, {
      registrationToken: token,
      rawCardId: 'CARD-A',
    });

    expect(response.status).toBe(401);
  });

  it('署名が合わなければ登録できない', async () => {
    const instance = app();
    const token = await issueRegistrationToken(instance, fixture, fixture.employeeId);

    const response = await instance.request('/api/device-agent/card-credentials', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-staffweave-device': fixture.device.deviceId,
        'x-staffweave-signature': Buffer.from('not a signature').toString('base64'),
      },
      body: JSON.stringify({
        registrationToken: token,
        cardFingerprint: cardFingerprint(fixture.device.cardKey, 'CARD-A'),
      }),
    });

    expect(response.status).toBe(401);
  });
});

describe('カードによる打刻', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await setUp();
    const instance = app();
    const token = await issueRegistrationToken(instance, fixture, fixture.employeeId);
    await registerCard(instance, fixture, {
      registrationToken: token,
      rawCardId: 'EMPLOYEE-CARD',
    });
  });

  it('ひと触りで出勤し、次のひと触りで退勤する', async () => {
    const instance = app();

    const first = await tapCard(instance, fixture, {
      sequence: 1,
      requestId: 'card-tap-1',
      rawCardId: 'EMPLOYEE-CARD',
    });
    const firstBody = (await first.json()) as CardEventResponse;

    expect(first.status).toBe(201);
    expect(firstBody.eventType).toBe('clock_in');
    expect(firstBody.employeeDisplayName).toBe('勤怠 花子');

    const second = await tapCard(instance, fixture, {
      sequence: 2,
      requestId: 'card-tap-2',
      rawCardId: 'EMPLOYEE-CARD',
    });
    expect(((await second.json()) as CardEventResponse).eventType).toBe('clock_out');
  });

  it('休憩中のひと触りは休憩終了になる', async () => {
    const instance = app();
    await tapCard(instance, fixture, {
      sequence: 1,
      requestId: 'card-break-in',
      rawCardId: 'EMPLOYEE-CARD',
    });
    await tapCard(instance, fixture, {
      sequence: 2,
      requestId: 'card-break-start',
      rawCardId: 'EMPLOYEE-CARD',
      eventType: 'break_start',
    });

    const response = await tapCard(instance, fixture, {
      sequence: 3,
      requestId: 'card-break-end',
      rawCardId: 'EMPLOYEE-CARD',
    });

    expect(((await response.json()) as CardEventResponse).eventType).toBe('break_end');
  });

  it('退勤後のひと触りは受け付けない', async () => {
    const instance = app();
    await tapCard(instance, fixture, {
      sequence: 1,
      requestId: 'card-done-1',
      rawCardId: 'EMPLOYEE-CARD',
    });
    await tapCard(instance, fixture, {
      sequence: 2,
      requestId: 'card-done-2',
      rawCardId: 'EMPLOYEE-CARD',
    });

    const response = await tapCard(instance, fixture, {
      sequence: 3,
      requestId: 'card-done-3',
      rawCardId: 'EMPLOYEE-CARD',
    });

    expect(response.status).toBe(409);
  });

  it('同じ冪等キーの再送は 1 件しか記録しない', async () => {
    const instance = app();
    const input = { sequence: 1, requestId: 'card-idempotent', rawCardId: 'EMPLOYEE-CARD' };

    const first = await tapCard(instance, fixture, input);
    const second = await tapCard(instance, fixture, input);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);

    const rows = await testDatabase().query<{ count: number }>(
      'SELECT count(*)::int AS count FROM attendance_events',
    );
    expect(rows[0]?.count).toBe(1);
  });

  it('別の経路で勤務状態が変わっても、再送は最初の応答を返す', async () => {
    const instance = app();
    const first = await tapCard(instance, fixture, {
      sequence: 1,
      requestId: 'card-replay-in',
      rawCardId: 'EMPLOYEE-CARD',
    });
    const firstBody = (await first.json()) as CardEventResponse;
    expect(firstBody.eventType).toBe('clock_in');

    // 最初の送信のあとに、別の要求で退勤まで進める。
    const clockOut = await tapCard(instance, fixture, {
      sequence: 2,
      requestId: 'card-replay-out',
      rawCardId: 'EMPLOYEE-CARD',
    });
    expect(((await clockOut.json()) as CardEventResponse).eventType).toBe('clock_out');

    const resent = await tapCard(instance, fixture, {
      sequence: 1,
      requestId: 'card-replay-in',
      rawCardId: 'EMPLOYEE-CARD',
    });
    const resentBody = (await resent.json()) as CardEventResponse;

    expect(resent.status).toBe(200);
    expect(resentBody).toEqual({ ...firstBody, outcome: 'duplicate' });
  });

  it('断った要求の再送は、あいだにカードを登録しても同じ理由で断る', async () => {
    const instance = app();
    const rejected = await tapCard(instance, fixture, {
      sequence: 1,
      requestId: 'card-late-registration',
      rawCardId: 'LATE-CARD',
    });
    const reason = ((await rejected.json()) as { error: { message: string } }).error.message;
    expect(rejected.status).toBe(404);

    const token = await issueRegistrationToken(instance, fixture, fixture.secondEmployeeId);
    await registerCard(instance, fixture, { registrationToken: token, rawCardId: 'LATE-CARD' });

    const resent = await tapCard(instance, fixture, {
      sequence: 1,
      requestId: 'card-late-registration',
      rawCardId: 'LATE-CARD',
    });

    expect(resent.status).toBe(404);
    expect(((await resent.json()) as { error: { message: string } }).error.message).toBe(reason);

    const rows = await testDatabase().query<{ count: number }>(
      'SELECT count(*)::int AS count FROM attendance_events',
    );
    expect(rows[0]?.count).toBe(0);
  });

  it('打刻を断った要求も記録に残し、再送へ同じ理由を返す', async () => {
    const instance = app();
    for (const [index, requestId] of ['card-closed-in', 'card-closed-out'].entries()) {
      await tapCard(instance, fixture, {
        sequence: index + 1,
        requestId,
        rawCardId: 'EMPLOYEE-CARD',
      });
    }

    const input = { sequence: 3, requestId: 'card-closed-again', rawCardId: 'EMPLOYEE-CARD' };
    const rejected = await tapCard(instance, fixture, input);
    const reason = ((await rejected.json()) as { error: { message: string } }).error.message;
    expect(rejected.status).toBe(409);

    const resent = await tapCard(instance, fixture, input);
    expect(resent.status).toBe(409);
    expect(((await resent.json()) as { error: { message: string } }).error.message).toBe(reason);

    const receipts = await testDatabase().query<{
      outcome: string;
      rejection_code: string | null;
      rejection_message: string | null;
    }>(
      `SELECT outcome, rejection_code, rejection_message FROM device_event_receipts
        WHERE request_id = $1`,
      [input.requestId],
    );
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      outcome: 'rejected',
      rejection_code: 'conflict',
      rejection_message: reason,
    });
  });

  it('受領記録に応答の再現へ必要な値を残す', async () => {
    const response = await tapCard(app(), fixture, {
      sequence: 1,
      requestId: 'card-receipt-values',
      rawCardId: 'EMPLOYEE-CARD',
    });
    const body = (await response.json()) as CardEventResponse;

    const receipts = await testDatabase().query<{
      attendance_event_id: string | null;
      business_date: string;
      event_type: string | null;
      outcome: string;
      rejection_code: string | null;
    }>(
      `SELECT attendance_event_id, to_char(business_date, 'YYYY-MM-DD') AS business_date,
              event_type, outcome, rejection_code
         FROM device_event_receipts`,
    );

    expect(receipts[0]).toEqual({
      attendance_event_id: body.attendanceEventId,
      business_date: body.businessDate,
      event_type: 'clock_in',
      outcome: 'accepted',
      rejection_code: null,
    });
  });

  it('登録されていないカードは受け付けない', async () => {
    const response = await tapCard(app(), fixture, {
      sequence: 1,
      requestId: 'card-unknown',
      rawCardId: 'UNKNOWN-CARD',
    });

    expect(response.status).toBe(404);

    const receipts = await testDatabase().query<{ detail: { reason?: string } }>(
      'SELECT detail FROM device_event_receipts',
    );
    expect(receipts[0]?.detail.reason).toBe('unknown_card');
  });

  it('失効させたカードは使えない', async () => {
    const instance = app();
    const listed = await instance.request('/api/card-credentials', authorized(fixture.adminCookie));
    const credential = ((await listed.json()) as CardCredentialList).cardCredentials[0];
    expect(credential).toBeDefined();

    const revoked = await instance.request(
      `/api/card-credentials/${credential?.id}/revoke`,
      authorized(fixture.adminCookie, { method: 'POST' }),
    );
    expect(((await revoked.json()) as CardCredentialRecord).state).toBe('revoked');

    const response = await tapCard(instance, fixture, {
      sequence: 1,
      requestId: 'card-after-revoke',
      rawCardId: 'EMPLOYEE-CARD',
    });
    expect(response.status).toBe(404);
  });

  it('失効させたカードを別の従業員へ登録し直せる', async () => {
    const instance = app();
    const listed = await instance.request('/api/card-credentials', authorized(fixture.adminCookie));
    const credential = ((await listed.json()) as CardCredentialList).cardCredentials[0];
    await instance.request(
      `/api/card-credentials/${credential?.id}/revoke`,
      authorized(fixture.adminCookie, { method: 'POST' }),
    );

    const token = await issueRegistrationToken(instance, fixture, fixture.secondEmployeeId);
    const response = await registerCard(instance, fixture, {
      registrationToken: token,
      rawCardId: 'EMPLOYEE-CARD',
    });

    expect(response.status).toBe(201);
    expect(((await response.json()) as CardCredentialRecord).employeeId).toBe(
      fixture.secondEmployeeId,
    );
  });

  it('二重に失効させられない', async () => {
    const instance = app();
    const listed = await instance.request('/api/card-credentials', authorized(fixture.adminCookie));
    const credential = ((await listed.json()) as CardCredentialList).cardCredentials[0];

    await instance.request(
      `/api/card-credentials/${credential?.id}/revoke`,
      authorized(fixture.adminCookie, { method: 'POST' }),
    );
    const second = await instance.request(
      `/api/card-credentials/${credential?.id}/revoke`,
      authorized(fixture.adminCookie, { method: 'POST' }),
    );

    expect(second.status).toBe(409);
  });
});

describe('検証用の読み取りアダプター', () => {
  it('実機なしで登録から打刻までを流せる', async () => {
    const fixture = await setUp();
    const instance = app();
    const reader = createScriptedCardReader(['SCRIPTED-CARD', 'SCRIPTED-CARD']);

    const token = await issueRegistrationToken(instance, fixture, fixture.employeeId);
    const registered = await registerCard(instance, fixture, {
      registrationToken: token,
      rawCardId: await reader.read(),
    });
    expect(registered.status).toBe(201);

    const tapped = await tapCard(instance, fixture, {
      sequence: 1,
      requestId: 'scripted-card-tap',
      rawCardId: await reader.read(),
    });
    expect(tapped.status).toBe(201);
    expect(((await tapped.json()) as CardEventResponse).eventType).toBe('clock_in');
  });
});

describe('カード機能の設定', () => {
  it('指紋鍵が設定されていなければ登録時に鍵を返さない', async () => {
    const workspaceId = await createWorkspace(testDatabase(), { slug: 'default' });
    await createUser(testDatabase(), workspaceId, {
      email: 'admin@example.com',
      roles: ['workspace_admin'],
    });

    const instance = app(NOW, null);
    const cookie = await loginAndGetCookie(instance, { email: 'admin@example.com' });
    const registered = (await (
      await instance.request(
        '/api/devices',
        authorized(cookie, { method: 'POST', body: { name: '端末' } }),
      )
    ).json()) as RegisterDeviceResponse;

    const enrolled = (await (
      await instance.request('/api/device-agent/enroll', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enrollmentToken: registered.enrollmentToken,
          publicKey: generateKeyPair().publicKeyPem,
        }),
      })
    ).json()) as EnrollDeviceResponse;

    expect(enrolled.cardFingerprintKey).toBeUndefined();
  });
});
