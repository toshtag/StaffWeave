/**
 * 一度きりの登録トークンが、同時に使われても 1 件しか成立しないことを実データベースで確かめる。
 *
 * ここで見るのは HTTP ではなく、トークンを消費する条件付き更新そのものである。
 * 二つのトランザクションを、どちらもトークンを読み終えた地点でそろえてから
 * 更新へ進ませ、競合を必ず起こす。実時間の待機には頼らない。
 */
import type { DeviceRecord } from '@staffweave/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';
import { createCardRepository } from '../../src/card/repository.js';
import { createDeviceRepository } from '../../src/device/repository.js';
import { hashToken } from '../../src/shared/security/tokens.js';
import { createBarrier } from '../support/concurrency.js';
import {
  createEmployeeWithAccount,
  createOrganization,
  createWorkspace,
} from '../support/fixtures.js';

const NOW = new Date('2026-04-01T00:00:00.000Z');
const ENROLLMENT_TOKEN_HASH = hashToken('enrollment-token');
const REGISTRATION_TOKEN_HASH = hashToken('registration-token');
const PUBLIC_KEY_A = '-----BEGIN PUBLIC KEY-----\nkey-a\n-----END PUBLIC KEY-----\n';
const PUBLIC_KEY_B = '-----BEGIN PUBLIC KEY-----\nkey-b\n-----END PUBLIC KEY-----\n';
/** 同時利用そのものを見る検査なので、期限は必ず先にしておく。 */
const ENROLLMENT_TOKEN_EXPIRES_AT = new Date('2999-01-01T00:00:00.000Z');
const FINGERPRINT_A = 'a'.repeat(64);
const FINGERPRINT_B = 'b'.repeat(64);

interface PendingDevice {
  workspaceId: string;
  deviceId: string;
}

/** 登録待ちの端末を 1 件だけ作る。公開鍵はまだ無い。 */
async function createPendingDevice(): Promise<PendingDevice> {
  const db = testDatabase();
  const workspaceId = await createWorkspace(db, { slug: 'default' });
  const rows = await db.query<{ id: string }>(
    `INSERT INTO devices
       (workspace_id, name, enrollment_token_hash, enrollment_token_expires_at)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [workspaceId, '入口の端末', ENROLLMENT_TOKEN_HASH, ENROLLMENT_TOKEN_EXPIRES_AT],
  );
  const deviceId = rows[0]?.id;
  if (deviceId === undefined) throw new Error('端末を作成できませんでした');
  return { workspaceId, deviceId };
}

interface PendingRegistration {
  workspaceId: string;
  tokenId: string;
  employeeId: string;
}

/** 未使用かつ有効期限内のカード登録トークンを 1 件だけ作る。 */
async function createRegistrationToken(): Promise<PendingRegistration> {
  const db = testDatabase();
  const workspaceId = await createWorkspace(db, { slug: 'default' });
  const organizationId = await createOrganization(db, workspaceId, { code: 'HQ' });
  const { employeeId } = await createEmployeeWithAccount(db, workspaceId, {
    organizationId,
    employeeNumber: 'E001',
    displayName: '勤怠 花子',
    email: 'hanako@example.com',
  });
  const rows = await db.query<{ id: string }>(
    `INSERT INTO card_registration_tokens
       (workspace_id, employee_id, token_hash, label, expires_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [workspaceId, employeeId, REGISTRATION_TOKEN_HASH, '社員証', new Date(NOW.getTime() + 900_000)],
  );
  const tokenId = rows[0]?.id;
  if (tokenId === undefined) throw new Error('登録トークンを作成できませんでした');
  return { workspaceId, tokenId, employeeId };
}

describe('端末登録トークンの同時利用', () => {
  let device: PendingDevice;

  beforeEach(async () => {
    device = await createPendingDevice();
  });

  it('同じトークンを同時に使っても登録が成立するのは 1 件だけ', async () => {
    const db = testDatabase();
    const barrier = createBarrier(2);

    async function enroll(publicKey: string): Promise<DeviceRecord | null> {
      return db.transaction(async (tx) => {
        const devices = createDeviceRepository(tx);
        const found = await devices.findByEnrollmentTokenHash(ENROLLMENT_TOKEN_HASH);
        if (found === null) throw new Error('登録トークンを引けませんでした');

        // 双方が同じ行を読み終えてから更新へ進む。
        await barrier.arriveAndWait();

        return devices.markEnrolledIfPending(found.workspaceId, found.id, {
          enrollmentTokenHash: ENROLLMENT_TOKEN_HASH,
          publicKey,
          enrollments: found.enrollments + 1,
          enrolledAt: NOW,
        });
      });
    }

    const results = await Promise.all([enroll(PUBLIC_KEY_A), enroll(PUBLIC_KEY_B)]);
    const enrolled = results.filter((result) => result !== null);

    expect(enrolled).toHaveLength(1);
    expect(results.filter((result) => result === null)).toHaveLength(1);

    const rows = await db.query<{
      state: string;
      enrollments: number;
      public_key: string | null;
      enrollment_token_hash: string | null;
    }>('SELECT state, enrollments, public_key, enrollment_token_hash FROM devices');

    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe('active');
    expect(rows[0]?.enrollments).toBe(1);
    expect([PUBLIC_KEY_A, PUBLIC_KEY_B]).toContain(rows[0]?.public_key);
    expect(rows[0]?.enrollment_token_hash).toBeNull();
  });

  it('登録を取り消せば登録トークンは消費されない', async () => {
    const db = testDatabase();

    await expect(
      db.transaction(async (tx) => {
        const devices = createDeviceRepository(tx);
        const enrolled = await devices.markEnrolledIfPending(device.workspaceId, device.deviceId, {
          enrollmentTokenHash: ENROLLMENT_TOKEN_HASH,
          publicKey: PUBLIC_KEY_A,
          enrollments: 1,
          enrolledAt: NOW,
        });
        expect(enrolled).not.toBeNull();

        // 監査記録の失敗にあたる。端末の更新も一緒に取り消される。
        throw new Error('監査記録を保存できませんでした');
      }),
    ).rejects.toThrow('監査記録を保存できませんでした');

    const rows = await db.query<{
      state: string;
      enrollments: number;
      public_key: string | null;
      enrollment_token_hash: string | null;
    }>('SELECT state, enrollments, public_key, enrollment_token_hash FROM devices');

    expect(rows[0]?.state).toBe('pending');
    expect(rows[0]?.enrollments).toBe(0);
    expect(rows[0]?.public_key).toBeNull();
    expect(rows[0]?.enrollment_token_hash).toBe(ENROLLMENT_TOKEN_HASH);
  });
});

describe('カード登録トークンの同時利用', () => {
  let registration: PendingRegistration;

  beforeEach(async () => {
    registration = await createRegistrationToken();
  });

  it('同じトークンを同時に使っても資格情報は 1 件しか作られない', async () => {
    const db = testDatabase();
    const barrier = createBarrier(2);

    async function register(fingerprint: string): Promise<string | null> {
      return db.transaction(async (tx) => {
        const cards = createCardRepository(tx);
        const token = await cards.findRegistrationTokenByHash(REGISTRATION_TOKEN_HASH);
        if (token === null) throw new Error('登録トークンを引けませんでした');
        expect(token.usedAt).toBeNull();

        // 双方が未使用であることを確かめてから消費へ進む。
        await barrier.arriveAndWait();

        const consumed = await cards.markRegistrationTokenUsedIfAvailable(
          token.workspaceId,
          token.id,
          NOW,
        );
        if (!consumed) return null;

        const credential = await cards.insertCredential(token.workspaceId, {
          employeeId: token.employeeId,
          fingerprint,
          label: token.label,
          registeredByDeviceId: null,
        });
        return credential.id;
      });
    }

    const results = await Promise.all([register(FINGERPRINT_A), register(FINGERPRINT_B)]);

    expect(results.filter((result) => result !== null)).toHaveLength(1);
    expect(results.filter((result) => result === null)).toHaveLength(1);

    const credentials = await db.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM card_credentials',
    );
    expect(credentials[0]?.count).toBe(1);

    const tokens = await db.query<{ used_at: Date | null }>(
      'SELECT used_at FROM card_registration_tokens',
    );
    expect(tokens[0]?.used_at).not.toBeNull();
  });

  it('登録を取り消せば登録トークンは消費されない', async () => {
    const db = testDatabase();

    await expect(
      db.transaction(async (tx) => {
        const cards = createCardRepository(tx);
        const consumed = await cards.markRegistrationTokenUsedIfAvailable(
          registration.workspaceId,
          registration.tokenId,
          NOW,
        );
        expect(consumed).toBe(true);

        // 資格情報の登録に失敗した場合にあたる。トークンの消費も取り消される。
        throw new Error('カードを登録できませんでした');
      }),
    ).rejects.toThrow('カードを登録できませんでした');

    const rows = await db.query<{ used_at: Date | null }>(
      'SELECT used_at FROM card_registration_tokens',
    );
    expect(rows[0]?.used_at).toBeNull();

    const credentials = await db.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM card_credentials',
    );
    expect(credentials[0]?.count).toBe(0);
  });
});
