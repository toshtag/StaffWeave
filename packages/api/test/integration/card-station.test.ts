/**
 * 据え置き端末が、物理カードの打刻を落とさないこと。
 *
 * これまで、カードの読み取りは読んだその場で送っていた。送れなければ表示して
 * 読み取りへ戻るだけで、ディスクへは残らない。回線が切れている間の打刻は
 * どこにも残らず、端末の前の人は打刻したつもりで立ち去る。
 *
 * ここで通すのは 1 本の筋。
 *
 *   物理カードを読む → 送信待ちへ残る → 端末が落ちて上がり直す
 *   → 回線が戻る → 同じ打刻が 1 回だけ記録される
 *
 * 送る側は製品と同じ `createSender` と `flushSpool` を使う。検査用の送信を
 * 別に書くと、確かめているのは検査のほうになる。
 */

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentRequestError,
  cardFingerprint,
  createAgentLogger,
  createFileSpool,
  createScriptedCardReader,
  createSender,
  flushSpool,
  generateKeyPair,
  readCardIntoSpool,
  signMessage,
} from '@staffweave/agent';
import type {
  CardCredentialList,
  CreateCardRegistrationResponse,
  EnrollDeviceResponse,
  RegisterDeviceResponse,
} from '@staffweave/contracts';
import { canonicalCardEvent, canonicalCardRegistration } from '@staffweave/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';
import {
  authorized,
  createEmployeeWithAccount,
  createOrganization,
  createUser,
  createWorkspace,
  loginAndGetCookie,
  type TestApp,
  testAppFactory,
} from '../support/fixtures.js';

const NOW = '2026-04-01T00:00:00.000Z';
const CARD_MASTER_KEY = 'test-card-fingerprint-master-key';
const RAW_CARD_ID = '04A1B2C3D4E580';

const app = testAppFactory({ now: NOW, cardFingerprintMasterKey: CARD_MASTER_KEY });

interface Device {
  deviceId: string;
  privateKeyPem: string;
  cardKey: string;
  baseUrl: string;
}

let spoolDirectory: string;
let device: Device;
let employeeId: string;

/** 端末の資格情報のうち、この検査が使うところだけ。 */
function credentialsOf(): {
  baseUrl: string;
  deviceId: string;
  workspaceSlug: string;
  privateKeyPem: string;
  publicKeyPem: string;
  nextSequence: number;
} {
  return {
    baseUrl: device.baseUrl,
    deviceId: device.deviceId,
    workspaceSlug: 'default',
    privateKeyPem: device.privateKeyPem,
    publicKeyPem: '',
    nextSequence: 1,
  };
}

/**
 * 送信そのものは、テスト用のアプリへ直接渡す。
 *
 * 署名と本文の組み立ては製品と同じ形にする。ここを簡略にすると、
 * 「送れた」ことだけを確かめて、送っている中身は誰も見ないことになる。
 */
function cardSender(
  instance: TestApp,
  online: () => boolean,
  onAccepted?: () => void,
): (
  credentials: { deviceId: string; privateKeyPem: string },
  input: {
    sequence: number;
    requestId: string;
    cardFingerprint: string;
    eventType?: 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
    occurredAt: string;
    deviceTime: string;
  },
) => Promise<unknown> {
  return async (credentials, input) => {
    if (!online()) throw new Error('接続できません');

    const signature = signMessage(
      credentials.privateKeyPem,
      canonicalCardEvent({
        deviceId: credentials.deviceId,
        sequence: input.sequence,
        requestId: input.requestId,
        cardFingerprint: input.cardFingerprint,
        eventType: input.eventType ?? '',
        occurredAt: input.occurredAt,
        deviceTime: input.deviceTime,
      }),
    );

    const response = await instance.request('/api/device-agent/card-events', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-staffweave-device': credentials.deviceId,
        'x-staffweave-signature': signature,
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      // 製品と同じ型で投げる。別の型にすると、送り直す意味があるかどうかの
      // 判断が検査だけ別の道を通る。
      throw new AgentRequestError(response.status, 'rejected', await response.text());
    }
    onAccepted?.();
    return response.json();
  };
}

beforeEach(async () => {
  spoolDirectory = await mkdtemp(join(tmpdir(), 'staffweave-station-'));

  const db = testDatabase();
  const workspaceId = await createWorkspace(db, { slug: 'default' });
  const organizationId = await createOrganization(db, workspaceId, { code: 'HQ' });
  await createUser(db, workspaceId, { email: 'admin@example.com', roles: ['workspace_admin'] });
  const employee = await createEmployeeWithAccount(db, workspaceId, {
    organizationId,
    employeeNumber: 'E001',
    displayName: '打刻 花子',
    email: 'hanako@example.com',
  });
  employeeId = employee.employeeId;

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

  device = {
    deviceId: enrolled.deviceId,
    privateKeyPem: keyPair.privateKeyPem,
    cardKey: enrolled.cardFingerprintKey ?? '',
    baseUrl: 'https://staffweave.test',
  };

  // 物理カードを、その端末の読み取り経路から登録する。
  const token = (
    (await (
      await instance.request(
        '/api/card-credentials/registrations',
        authorized(adminCookie, { method: 'POST', body: { employeeId, label: '社員証' } }),
      )
    ).json()) as CreateCardRegistrationResponse
  ).registrationToken;

  const reader = createScriptedCardReader([RAW_CARD_ID]);
  const body = {
    registrationToken: token,
    cardFingerprint: cardFingerprint(device.cardKey, await reader.read()),
  };
  const registration = await instance.request('/api/device-agent/card-credentials', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-staffweave-device': device.deviceId,
      'x-staffweave-signature': signMessage(
        device.privateKeyPem,
        canonicalCardRegistration({ deviceId: device.deviceId, ...body }),
      ),
    },
    body: JSON.stringify(body),
  });
  expect(registration.status).toBe(201);
});

afterEach(async () => {
  await rm(spoolDirectory, { recursive: true, force: true });
});

/** 端末の連番。資格情報の代わりに、この検査の中で durable に持つ。 */
function sequences(): { allocate: () => Promise<number>; next: () => number } {
  let next = 1;
  return {
    allocate: async () => {
      const value = next;
      next += 1;
      return value;
    },
    next: () => next,
  };
}

async function tap(allocate: () => Promise<number>): Promise<void> {
  const queued = await readCardIntoSpool({
    reader: createScriptedCardReader([RAW_CARD_ID]),
    spool: createFileSpool(spoolDirectory),
    logger: createAgentLogger(),
    fingerprint: (rawCardId) => cardFingerprint(device.cardKey, rawCardId),
    allocateSequence: allocate,
    running: () => true,
    now: () => new Date(NOW),
  });
  expect(queued).toBe(true);
}

async function flush(
  instance: TestApp,
  online: () => boolean,
  onAccepted?: () => void,
): Promise<{ sent: number; remaining: number; dropped: number }> {
  return flushSpool({
    spool: createFileSpool(spoolDirectory),
    logger: createAgentLogger(),
    send: createSender({
      credentials: async () => credentialsOf(),
      sendEvent: async () => {
        throw new Error('この検査ではカードの打刻だけを送る');
      },
      sendCardEvent: cardSender(instance, online, onAccepted) as never,
      now: () => new Date(NOW),
    }),
  });
}

/** その従業員の、その日の打刻の数。本人の目から数える。 */
async function recordedEvents(instance: TestApp): Promise<number> {
  const cookie = await loginAndGetCookie(instance, { email: 'hanako@example.com' });
  const response = await instance.request('/api/attendance/days/2026-04-01', authorized(cookie));
  const day = (await response.json()) as { events: unknown[] };
  return day.events.length;
}

describe('物理カードの打刻が、回線の切断をまたいで残る', () => {
  it('切れている間に読んだカードは送信待ちに残り、戻ってから 1 回だけ記録される', async () => {
    const instance = app();
    const { allocate } = sequences();
    let online = false;

    await tap(allocate);

    // 切れている間は送れない。送信待ちから消えてはいけない。
    const offline = await flush(instance, () => online);
    expect(offline.sent).toBe(0);
    expect(offline.remaining).toBe(1);
    expect((await createFileSpool(spoolDirectory).list()).length).toBe(1);

    // 端末が落ちて上がり直しても、ディスクに残っているものは消えない。
    // 送信待ちは同じディレクトリを読み直すだけで、状態はメモリに持たない。
    expect((await createFileSpool(spoolDirectory).list())[0]?.kind).toBe('card');

    online = true;
    const restored = await flush(instance, () => online);
    expect(restored.sent).toBe(1);
    expect(restored.remaining).toBe(0);

    expect(await recordedEvents(instance)).toBe(1);
  });

  it('送信待ちに生のカード識別子を書かない', async () => {
    const { allocate } = sequences();
    await tap(allocate);

    const names = await readdir(spoolDirectory);
    const contents = await Promise.all(
      names.map((name) => readFile(join(spoolDirectory, name), 'utf8')),
    );

    // 拾われても物理カードと結び付けられないこと。指紋は残るが、
    // 指紋から元の識別子は戻せない。
    for (const content of contents) {
      expect(content).not.toContain(RAW_CARD_ID);
      expect(content).toContain(cardFingerprint(device.cardKey, RAW_CARD_ID));
    }
  });

  /**
   * サーバーは受理したのに、その応答が端末へ届かなかった場合。
   *
   * 連番を送るときに決めていると、端末は応答が無いので連番を進められない。
   * 次の打刻が同じ連番で出ていき、サーバーからは戻った連番として断られる。
   * 積むときに決めておけば、そうならない。
   */
  it('応答を失っても、重複せず、次の打刻も通る', async () => {
    const instance = app();
    const { allocate } = sequences();
    const online = true;
    let accepted = 0;

    await tap(allocate);

    // 1 回目。サーバーは受理するが、応答が返る手前で切れる。
    // 端末から見れば「送れなかった」ので、送信待ちには残る。
    const lost = await flush(
      instance,
      () => online,
      () => {
        accepted += 1;
        throw new Error('応答を失いました');
      },
    );
    expect(lost.sent).toBe(0);
    expect(accepted).toBe(1);
    expect((await createFileSpool(spoolDirectory).list()).length).toBe(1);

    // 同じ冪等キーと同じ連番で出し直す。重複として受理される。
    const retried = await flush(instance, () => online);
    expect(retried.sent).toBe(1);
    expect(await recordedEvents(instance)).toBe(1);

    // 次の打刻は 1 つ先の連番で出る。戻った連番として断られない。
    await tap(allocate);
    const next = await flush(instance, () => online);
    expect(next.sent).toBe(1);
    expect(next.dropped).toBe(0);
    expect(await recordedEvents(instance)).toBe(2);
  });

  it('失効したカードは断られ、送信待ちから外れる', async () => {
    const instance = app();
    const cookie = await loginAndGetCookie(instance, { email: 'admin@example.com' });
    const credentials = (await (
      await instance.request(`/api/card-credentials?employeeId=${employeeId}`, authorized(cookie))
    ).json()) as CardCredentialList;
    const target = credentials.cardCredentials[0];
    expect(target).toBeDefined();

    await instance.request(
      `/api/card-credentials/${target?.id}/revoke`,
      authorized(cookie, { method: 'POST', body: {} }),
    );

    const { allocate } = sequences();
    await tap(allocate);

    // 送り直しても同じ答えしか返らない。残すと後ろの打刻が出られなくなる。
    const result = await flush(instance, () => true);
    expect(result.sent).toBe(0);
    expect(result.dropped).toBe(1);
    expect((await createFileSpool(spoolDirectory).list()).length).toBe(0);
  });
});
