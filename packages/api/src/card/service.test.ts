import { generateKeyPairSync, sign } from 'node:crypto';
import type { CardCredentialRecord } from '@staffweave/contracts';
import type { Queryable } from '@staffweave/db';
import { canonicalCardRegistration } from '@staffweave/domain';
import { describe, expect, it } from 'vitest';
import { createApprovalRepository } from '../approval/repository.js';
import { createCalculationRepository } from '../attendance/calculation-repository.js';
import { createAttendanceRepository } from '../attendance/repository.js';
import type { AuditEntry, AuditRepository } from '../audit/repository.js';
import { createDeviceRepository } from '../device/repository.js';
import { createAssignmentRepository } from '../organization/assignment-repository.js';
import { createRequestRepository } from '../request/repository.js';
import { createLaborSystemRepository } from '../schedule/labor-system-repository.js';
import { createScheduleRepository } from '../schedule/repository.js';
import { createWorkCategoryRepository } from '../schedule/work-category-repository.js';
import { createEmployeeVisibilityGuard } from '../shared/employee-visibility.js';
import { ApiError } from '../shared/errors.js';
import { type CardRepository, createCardRepository } from './repository.js';
import { type CardRepositories, createCardService } from './service.js';

/**
 * 条件付き更新が競合に負けたときの応答を固定する。
 *
 * 事前の検査は通っているため、この経路は「使用済み」ではなく
 * 「消費できなかった」ことを表す。資格情報も監査記録も作らない。
 */

const NOW = new Date('2026-04-01T00:00:00.000Z');
const DEVICE_ID = 'device-1';
const WORKSPACE_ID = 'workspace-1';
const REGISTRATION_TOKEN = 'registration-token';
const CARD_FINGERPRINT = 'a'.repeat(64);

/** この経路で使うはずのない問い合わせは、呼ばれた時点で分かるようにする。 */
const unusedDatabase: Queryable = {
  query: async () => {
    throw new Error('カードの登録ではこの問い合わせを使いません');
  },
};

const keyPair = generateKeyPairSync('ed25519');
const publicKeyPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();

function signRegistration(): string {
  const message = canonicalCardRegistration({
    deviceId: DEVICE_ID,
    registrationToken: REGISTRATION_TOKEN,
    cardFingerprint: CARD_FINGERPRINT,
  });
  return sign(null, Buffer.from(message, 'utf8'), keyPair.privateKey).toString('base64');
}

const availableToken = {
  id: 'token-1',
  workspaceId: WORKSPACE_ID,
  employeeId: 'employee-1',
  label: '社員証',
  expiresAt: new Date(NOW.getTime() + 900_000),
  usedAt: null,
};

interface Harness {
  service: ReturnType<typeof createCardService>;
  audited: AuditEntry[];
  inserted: string[];
}

function serviceWith(cards: Partial<CardRepository>): Harness {
  const audited: AuditEntry[] = [];
  const inserted: string[] = [];

  const audit: AuditRepository = {
    record: async (_workspaceId, entry) => {
      audited.push(entry);
    },
    listRecent: async () => [],
  };

  const devices = {
    ...createDeviceRepository(unusedDatabase),
    findForSignature: async () => ({
      device: {
        id: DEVICE_ID,
        siteId: null,
        name: '入口の端末',
        state: 'active' as const,
        enrollments: 1,
        lastSequence: 0,
        enrolledAt: NOW.toISOString(),
        revokedAt: null,
        lastSeenAt: null,
        createdAt: NOW.toISOString(),
      },
      workspaceId: WORKSPACE_ID,
      publicKey: publicKeyPem,
    }),
  };

  const repositories: CardRepositories = {
    attendance: createAttendanceRepository(unusedDatabase),
    schedule: createScheduleRepository(unusedDatabase),
    calculations: createCalculationRepository(unusedDatabase),
    approval: createApprovalRepository(unusedDatabase),
    requests: createRequestRepository(unusedDatabase),
    categories: createWorkCategoryRepository(unusedDatabase),
    laborSystems: createLaborSystemRepository(unusedDatabase),
    cards: {
      ...createCardRepository(unusedDatabase),
      insertCredential: async (_workspaceId, input): Promise<CardCredentialRecord> => {
        inserted.push(input.fingerprint);
        return {
          id: 'credential-1',
          employeeId: input.employeeId,
          label: input.label,
          state: 'active',
          registeredAt: NOW.toISOString(),
          revokedAt: null,
        };
      },
      ...cards,
    },
    devices,
    audit,
  };

  const service = createCardService({
    cards: repositories.cards,
    devices,
    visibility: createEmployeeVisibilityGuard({
      assignments: createAssignmentRepository(unusedDatabase),
      now: () => NOW,
    }),
    now: () => NOW,
    transaction: (fn) => fn(repositories),
  });

  return { service, audited, inserted };
}

describe('registerCard', () => {
  it('条件付き更新が競合に負けたら 409 とし、資格情報も監査記録も作らない', async () => {
    const { service, audited, inserted } = serviceWith({
      findRegistrationTokenByHash: async () => availableToken,
      markRegistrationTokenUsedIfAvailable: async () => false,
    });

    const error = await service
      .registerCard(DEVICE_ID, signRegistration(), {
        registrationToken: REGISTRATION_TOKEN,
        cardFingerprint: CARD_FINGERPRINT,
      })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'conflict', status: 409 });
    expect(inserted).toEqual([]);
    expect(audited).toHaveLength(0);
  });

  it('有効期限の判定と消費の記録に同じ時刻を使う', async () => {
    const consumedAt: Date[] = [];
    const { service, audited } = serviceWith({
      findRegistrationTokenByHash: async () => availableToken,
      markRegistrationTokenUsedIfAvailable: async (_workspaceId, _id, usedAt) => {
        consumedAt.push(usedAt);
        return true;
      },
    });

    await service.registerCard(DEVICE_ID, signRegistration(), {
      registrationToken: REGISTRATION_TOKEN,
      cardFingerprint: CARD_FINGERPRINT,
    });

    expect(consumedAt).toEqual([NOW]);
    expect(audited.map((entry) => entry.action)).toEqual(['card_credential.registered']);
  });

  it('別のワークスペースの登録トークンは 401 とする', async () => {
    const { service } = serviceWith({
      findRegistrationTokenByHash: async () => ({ ...availableToken, workspaceId: 'workspace-2' }),
    });

    const error = await service
      .registerCard(DEVICE_ID, signRegistration(), {
        registrationToken: REGISTRATION_TOKEN,
        cardFingerprint: CARD_FINGERPRINT,
      })
      .catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ code: 'unauthenticated', status: 401 });
  });
});
