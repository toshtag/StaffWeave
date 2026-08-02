import { generateKeyPairSync } from 'node:crypto';
import type { Queryable } from '@staffweave/db';
import { describe, expect, it } from 'vitest';
import { createApprovalRepository } from '../approval/repository.js';
import { createCalculationRepository } from '../attendance/calculation-repository.js';
import { createAttendanceRepository } from '../attendance/repository.js';
import type { AuditEntry, AuditRepository } from '../audit/repository.js';
import { createScheduleRepository } from '../schedule/repository.js';
import { ApiError } from '../shared/errors.js';
import { hashToken } from '../shared/security/tokens.js';
import { createDeviceRepository, type DeviceRepository } from './repository.js';
import { createDeviceService, type DeviceRepositories } from './service.js';

/**
 * 条件付き更新が競合に負けたときの応答を固定する。
 *
 * 事前の検索は成功しているため、この経路は「トークンが無い」ではなく
 * 「消費できなかった」ことを表す。監査記録も残さない。
 */

const NOW = new Date('2026-04-01T00:00:00.000Z');
const ENROLLMENT_TOKEN = 'enrollment-token';

/** この経路で使うはずのない問い合わせは、呼ばれた時点で分かるようにする。 */
const unusedDatabase: Queryable = {
  query: async () => {
    throw new Error('端末の登録ではこの問い合わせを使いません');
  },
};

const pendingDevice = {
  id: 'device-1',
  siteId: null,
  name: '入口の端末',
  state: 'pending' as const,
  enrollments: 0,
  lastSequence: 0,
  enrolledAt: null,
  revokedAt: null,
  lastSeenAt: null,
  createdAt: '2026-03-31T00:00:00.000Z',
  workspaceId: 'workspace-1',
  workspaceSlug: 'default',
  enrollmentTokenExpiresAt: new Date('2026-04-01T00:15:00.000Z'),
};

function publicKeyPem(): string {
  return generateKeyPairSync('ed25519')
    .publicKey.export({ type: 'spki', format: 'pem' })
    .toString();
}

function serviceWith(devices: Partial<DeviceRepository>): {
  service: ReturnType<typeof createDeviceService>;
  audited: AuditEntry[];
} {
  const audited: AuditEntry[] = [];
  const audit: AuditRepository = {
    record: async (_workspaceId, entry) => {
      audited.push(entry);
    },
    listRecent: async () => [],
  };

  const repositories: DeviceRepositories = {
    attendance: createAttendanceRepository(unusedDatabase),
    schedule: createScheduleRepository(unusedDatabase),
    calculations: createCalculationRepository(unusedDatabase),
    approval: createApprovalRepository(unusedDatabase),
    devices: { ...createDeviceRepository(unusedDatabase), ...devices },
    audit,
  };

  const service = createDeviceService({
    repository: createDeviceRepository(unusedDatabase),
    attendance: repositories.attendance,
    now: () => NOW,
    cardFingerprintMasterKey: null,
    transaction: (fn) => fn(repositories),
  });

  return { service, audited };
}

describe('enroll', () => {
  it('条件付き更新が競合に負けたら 409 とし、監査記録を残さない', async () => {
    const { service, audited } = serviceWith({
      findByEnrollmentTokenHash: async () => pendingDevice,
      markEnrolledIfPending: async () => null,
    });

    const error = await service
      .enroll({ enrollmentToken: ENROLLMENT_TOKEN, publicKey: publicKeyPem() })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'conflict', status: 409 });
    expect(audited).toHaveLength(0);
  });

  it('消費した登録トークンのハッシュを更新の条件として渡す', async () => {
    const conditions: string[] = [];
    const { service, audited } = serviceWith({
      findByEnrollmentTokenHash: async () => pendingDevice,
      markEnrolledIfPending: async (_workspaceId, _deviceId, input) => {
        conditions.push(input.enrollmentTokenHash);
        return { ...pendingDevice, state: 'active', enrollments: input.enrollments };
      },
    });

    await service.enroll({ enrollmentToken: ENROLLMENT_TOKEN, publicKey: publicKeyPem() });

    expect(conditions).toEqual([hashToken(ENROLLMENT_TOKEN)]);
    expect(audited.map((entry) => entry.action)).toEqual(['device.enrolled']);
  });

  it('登録トークンが見つからなければ 401 とする', async () => {
    const { service } = serviceWith({ findByEnrollmentTokenHash: async () => null });

    const error = await service
      .enroll({ enrollmentToken: ENROLLMENT_TOKEN, publicKey: publicKeyPem() })
      .catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ code: 'unauthenticated', status: 401 });
  });

  it('期限を過ぎた登録トークンは 401 とし、更新を試みない', async () => {
    let attempted = false;
    const { service, audited } = serviceWith({
      findByEnrollmentTokenHash: async () => ({
        ...pendingDevice,
        enrollmentTokenExpiresAt: new Date(NOW.getTime() - 1),
      }),
      markEnrolledIfPending: async () => {
        attempted = true;
        return null;
      },
    });

    const error = await service
      .enroll({ enrollmentToken: ENROLLMENT_TOKEN, publicKey: publicKeyPem() })
      .catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ code: 'unauthenticated', status: 401 });
    expect(attempted).toBe(false);
    expect(audited).toHaveLength(0);
  });

  // 期限ちょうどは過ぎたものとして扱う。カードの登録トークンと同じ境界にする。
  it('期限ちょうどの登録トークンは受け付けない', async () => {
    const { service } = serviceWith({
      findByEnrollmentTokenHash: async () => ({
        ...pendingDevice,
        enrollmentTokenExpiresAt: NOW,
      }),
    });

    const error = await service
      .enroll({ enrollmentToken: ENROLLMENT_TOKEN, publicKey: publicKeyPem() })
      .catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ code: 'unauthenticated', status: 401 });
  });

  it('期限の確認を更新の条件としても渡す', async () => {
    let received: Date | undefined;
    const { service } = serviceWith({
      findByEnrollmentTokenHash: async () => pendingDevice,
      markEnrolledIfPending: async (_workspaceId, _deviceId, input) => {
        received = input.enrolledAt;
        return { ...pendingDevice, state: 'active', enrollments: input.enrollments };
      },
    });

    await service.enroll({ enrollmentToken: ENROLLMENT_TOKEN, publicKey: publicKeyPem() });

    // 更新は同じ時計で期限を確かめる。読んだ後に期限が来ても、更新の側で断れる。
    expect(received).toEqual(NOW);
  });
});
