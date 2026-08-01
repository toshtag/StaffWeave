import type {
  CardCredentialRecord,
  CardEventRequest,
  CardEventResponse,
  CreateCardRegistrationRequest,
  CreateCardRegistrationResponse,
  RegisterCardRequest,
} from '@staffweave/contracts';
import type { AttendanceEventType } from '@staffweave/domain';
import {
  acceptsSignedEvents,
  canonicalCardEvent,
  canonicalCardRegistration,
  clockSkewSeconds,
  evaluateSequence,
  isNotableClockSkew,
  nextCardPunch,
  validateOccurredAt,
} from '@staffweave/domain';
import { loadWorkDay } from '../attendance/day.js';
import type { AttendanceRepositories } from '../attendance/record.js';
import { recordAttendanceEvent, resolveBusinessDate } from '../attendance/record.js';
import { resolveTimeZoneForEmployee } from '../attendance/service.js';
import type { AuditRepository } from '../audit/repository.js';
import type { DeviceRepository } from '../device/repository.js';
import { verifySignature } from '../device/signature.js';
import type { AuthenticatedContext } from '../identity/service.js';
import { isForeignKeyViolation, isUniqueViolation } from '../shared/database-errors.js';
import type { EmployeeVisibilityGuard } from '../shared/employee-visibility.js';
import { ApiError, invalidRequest, notFound } from '../shared/errors.js';
import { generateToken, hashToken } from '../shared/security/tokens.js';
import type { CardRepository } from './repository.js';

export interface CardRepositories extends AttendanceRepositories {
  cards: CardRepository;
  devices: DeviceRepository;
  audit: AuditRepository;
}

export interface CardServiceDependencies {
  cards: CardRepository;
  devices: DeviceRepository;
  visibility: EmployeeVisibilityGuard;
  now: () => Date;
  transaction<T>(fn: (repositories: CardRepositories) => Promise<T>): Promise<T>;
}

export interface CardService {
  listCredentials(context: AuthenticatedContext): Promise<CardCredentialRecord[]>;
  createRegistration(
    context: AuthenticatedContext,
    input: CreateCardRegistrationRequest,
  ): Promise<CreateCardRegistrationResponse>;
  revokeCredential(
    context: AuthenticatedContext,
    cardCredentialId: string,
  ): Promise<CardCredentialRecord>;
  registerCard(
    deviceId: string,
    signature: string,
    input: RegisterCardRequest,
  ): Promise<CardCredentialRecord>;
  recordCardEvent(
    deviceId: string,
    signature: string,
    input: CardEventRequest,
  ): Promise<{ result: CardEventResponse; created: boolean }>;
}

const DEFAULT_REGISTRATION_MINUTES = 15;

export function createCardService(deps: CardServiceDependencies): CardService {
  /** 端末を署名で認証し、ワークスペースと公開鍵を得る。 */
  async function authenticateDevice(
    deviceId: string,
    signature: string,
    message: string,
  ): Promise<{ workspaceId: string }> {
    const found = await deps.devices.findForSignature(deviceId);
    if (!found || found.publicKey === null || !acceptsSignedEvents(found.device.state)) {
      throw new ApiError('unauthenticated', '端末を認証できません');
    }
    if (!verifySignature(found.publicKey, message, signature)) {
      throw new ApiError('unauthenticated', '端末を認証できません');
    }
    return { workspaceId: found.workspaceId };
  }

  return {
    async listCredentials(context) {
      const credentials = await deps.cards.listCredentials(context.workspace.id);
      return deps.visibility.filterVisible(
        context,
        credentials,
        (credential) => credential.employeeId,
      );
    },

    async createRegistration(context, input) {
      const token = generateToken();
      const expiresAt = new Date(
        deps.now().getTime() + (input.expiresInMinutes ?? DEFAULT_REGISTRATION_MINUTES) * 60_000,
      );

      try {
        await deps.cards.createRegistrationToken(context.workspace.id, {
          employeeId: input.employeeId,
          tokenHash: hashToken(token),
          label: input.label ?? null,
          expiresAt,
          createdByUserId: context.user.id,
        });
      } catch (error) {
        if (isForeignKeyViolation(error)) throw notFound('従業員');
        throw error;
      }

      return { registrationToken: token, expiresAt: expiresAt.toISOString() };
    },

    async revokeCredential(context, cardCredentialId) {
      const workspaceId = context.workspace.id;
      return deps.transaction(async ({ cards, audit }) => {
        const existing = await cards.findCredentialById(workspaceId, cardCredentialId);
        if (!existing) throw notFound('カードの資格情報');
        if (existing.state === 'revoked') {
          throw new ApiError('conflict', 'このカードはすでに失効しています');
        }

        const revoked = await cards.revokeCredential(workspaceId, cardCredentialId, {
          revokedAt: deps.now(),
          revokedByUserId: context.user.id,
        });

        await audit.record(workspaceId, {
          actorKind: 'user',
          actorUserId: context.user.id,
          action: 'card_credential.revoked',
          targetType: 'card_credential',
          targetId: cardCredentialId,
          summary: 'IC カードの資格情報を失効させました',
          detail: { employeeId: existing.employeeId, label: existing.label },
        });

        return revoked;
      });
    },

    async registerCard(deviceId, signature, input) {
      const { workspaceId } = await authenticateDevice(
        deviceId,
        signature,
        canonicalCardRegistration({
          deviceId,
          registrationToken: input.registrationToken,
          cardFingerprint: input.cardFingerprint,
        }),
      );

      // 登録トークンの照合から消費までを一つのトランザクションに収める。
      // 先に読んだ結果は判断材料にすぎず、一度きりを決めるのは条件付きの更新である。
      const tokenHash = hashToken(input.registrationToken);

      return deps.transaction(async ({ cards, audit }) => {
        const token = await cards.findRegistrationTokenByHash(tokenHash);
        if (!token || token.workspaceId !== workspaceId) {
          throw new ApiError('unauthenticated', '登録トークンが一致しません');
        }

        // 有効期限の判定と消費の記録で時刻がずれないよう、一度だけ決める。
        const now = deps.now();
        if (token.usedAt !== null) {
          throw new ApiError('unauthenticated', 'この登録トークンはすでに使われています');
        }
        if (token.expiresAt.getTime() <= now.getTime()) {
          throw new ApiError('unauthenticated', 'この登録トークンは有効期限が切れています');
        }

        // 資格情報より先にトークンを消費し、同時に届いた要求をトークンの行で直列化する。
        // 後続が失敗すれば、この消費も一緒に取り消される。
        const consumed = await cards.markRegistrationTokenUsedIfAvailable(
          workspaceId,
          token.id,
          now,
        );
        if (!consumed) {
          throw new ApiError('conflict', 'この登録トークンはすでに使用されています');
        }

        let credential: CardCredentialRecord;
        try {
          credential = await cards.insertCredential(workspaceId, {
            employeeId: token.employeeId,
            fingerprint: input.cardFingerprint,
            label: token.label,
            registeredByDeviceId: deviceId,
          });
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new ApiError('conflict', 'このカードはすでに別の従業員に登録されています');
          }
          throw error;
        }

        await audit.record(workspaceId, {
          actorKind: 'device',
          actorUserId: null,
          action: 'card_credential.registered',
          targetType: 'card_credential',
          targetId: credential.id,
          summary: 'IC カードの資格情報を登録しました',
          detail: { employeeId: token.employeeId, deviceId, label: token.label },
        });

        return credential;
      });
    },

    async recordCardEvent(deviceId, signature, input) {
      const { workspaceId } = await authenticateDevice(
        deviceId,
        signature,
        canonicalCardEvent({
          deviceId,
          sequence: input.sequence,
          requestId: input.requestId,
          cardFingerprint: input.cardFingerprint,
          eventType: input.eventType ?? '',
          occurredAt: input.occurredAt,
          deviceTime: input.deviceTime,
        }),
      );

      const now = deps.now();
      const occurredAt = new Date(input.occurredAt);
      const deviceTime = new Date(input.deviceTime);
      if (Number.isNaN(occurredAt.getTime()) || Number.isNaN(deviceTime.getTime())) {
        throw invalidRequest([{ field: 'occurredAt', message: '日時として解釈できません' }]);
      }
      if (validateOccurredAt(occurredAt, now).length > 0) {
        throw invalidRequest([
          {
            field: 'occurredAt',
            message: '打刻時刻が受け入れ範囲を超えています。端末の時計を確認してください',
          },
        ]);
      }

      const skew = clockSkewSeconds(deviceTime, now);

      const outcome = await deps.transaction(async (repositories) => {
        const { cards, devices, attendance } = repositories;
        if (!(await devices.lock(workspaceId, deviceId))) throw notFound('端末');

        const existingReceipt = await devices.findReceiptByRequestId(
          workspaceId,
          deviceId,
          input.requestId,
        );

        const device = await devices.findById(workspaceId, deviceId);
        if (!device) throw notFound('端末');

        const credential = await cards.findActiveByFingerprint(workspaceId, input.cardFingerprint);
        if (!credential) {
          // カードが未登録であることは端末へ伝える。誰のカードかは分からないままにする。
          const error = notFound('登録されたカード');
          await devices.insertReceipt(workspaceId, {
            deviceId,
            sequence: input.sequence,
            requestId: input.requestId,
            receivedAt: now,
            deviceTime,
            clockSkewSeconds: skew,
            sequenceStep: input.sequence - device.lastSequence,
            outcome: 'rejected',
            rejection: { code: error.code, message: error.message },
            detail: { reason: 'unknown_card' },
          });
          return { kind: 'rejected' as const, error };
        }

        const timeZone = await resolveTimeZoneForEmployee(
          attendance,
          workspaceId,
          credential.employeeId,
        );

        // 種別が指定されていなければ、今の状態から一意に決める。
        let eventType: AttendanceEventType;
        if (input.eventType !== undefined) {
          eventType = input.eventType;
        } else {
          const businessDate = await resolveBusinessDate(
            repositories,
            workspaceId,
            credential.employeeId,
            'clock_out',
            occurredAt,
            timeZone,
          );
          const day = await loadWorkDay(
            repositories,
            workspaceId,
            credential.employeeId,
            businessDate,
            timeZone,
          );
          const decided = nextCardPunch(day.state);
          if (decided === null) {
            return {
              kind: 'rejected' as const,
              error: new ApiError('conflict', 'すでに退勤済みです'),
            };
          }
          eventType = decided;
        }

        const sequenceStep = input.sequence - device.lastSequence;
        if (
          existingReceipt === null &&
          evaluateSequence(device.lastSequence, input.sequence) === 'replay'
        ) {
          const error = new ApiError('conflict', '連番がすでに受け取った値以下です');
          await devices.insertReceipt(workspaceId, {
            deviceId,
            sequence: input.sequence,
            requestId: input.requestId,
            receivedAt: now,
            deviceTime,
            clockSkewSeconds: skew,
            sequenceStep,
            outcome: 'rejected',
            rejection: { code: error.code, message: error.message },
            detail: { reason: 'sequence_replay', lastSequence: device.lastSequence },
          });
          return { kind: 'rejected' as const, error };
        }

        let recorded: Awaited<ReturnType<typeof recordAttendanceEvent>>;
        try {
          recorded = await recordAttendanceEvent(
            repositories,
            {
              workspaceId,
              employeeId: credential.employeeId,
              employeeDisplayName: credential.employeeDisplayName,
              actorKind: 'device',
              userId: null,
              deviceId,
            },
            {
              eventType,
              occurredAt: input.occurredAt,
              requestId: `card:${deviceId}:${input.requestId}`,
            },
            'device',
            occurredAt,
            timeZone,
          );
        } catch (error) {
          if (error instanceof ApiError && error.code === 'conflict') {
            await devices.insertReceipt(workspaceId, {
              deviceId,
              sequence: input.sequence,
              requestId: input.requestId,
              receivedAt: now,
              deviceTime,
              clockSkewSeconds: skew,
              sequenceStep,
              outcome: 'rejected',
              rejection: { code: error.code, message: error.message },
              detail: { reason: 'punch_rejected' },
            });
            return { kind: 'rejected' as const, error };
          }
          throw error;
        }

        if (existingReceipt === null) {
          await devices.insertReceipt(workspaceId, {
            deviceId,
            sequence: input.sequence,
            requestId: input.requestId,
            receivedAt: now,
            deviceTime,
            clockSkewSeconds: skew,
            sequenceStep,
            attendanceEventId: recorded.result.event.id,
            businessDate: recorded.result.event.businessDate,
            eventType: recorded.result.event.eventType,
            outcome: recorded.created ? 'accepted' : 'duplicate',
            detail: {
              cardCredentialId: credential.id,
              ...(sequenceStep > 1 ? { sequenceGap: sequenceStep - 1 } : {}),
              ...(isNotableClockSkew(skew) ? { notableClockSkew: true } : {}),
            },
          });
          await devices.updateSequence(workspaceId, deviceId, {
            lastSequence: input.sequence,
            lastSeenAt: now,
          });
        }

        return {
          kind: 'ok' as const,
          result: {
            outcome: recorded.created ? ('accepted' as const) : ('duplicate' as const),
            attendanceEventId: recorded.result.event.id,
            eventType: recorded.result.event.eventType,
            businessDate: recorded.result.event.businessDate,
            employeeDisplayName: credential.employeeDisplayName,
            sequenceStep,
            clockSkewSeconds: skew,
          },
          created: recorded.created,
        };
      });

      if (outcome.kind === 'rejected') throw outcome.error;
      return { result: outcome.result, created: outcome.created };
    },
  };
}
