import type {
  DeviceEventRequest,
  DeviceEventResponse,
  DeviceReceiptRecord,
  DeviceRecord,
  EnrollDeviceRequest,
  EnrollDeviceResponse,
  RegisterDeviceRequest,
  RegisterDeviceResponse,
} from '@staffweave/contracts';
import {
  acceptsSignedEvents,
  applyDeviceEvent,
  clockSkewSeconds,
  evaluateSequence,
  isNotableClockSkew,
  validateOccurredAt,
} from '@staffweave/domain';
import type { AttendanceRepositories } from '../attendance/record.js';
import { recordAttendanceEvent } from '../attendance/record.js';
import { resolveTimeZoneForEmployee } from '../attendance/service.js';
import type { AuditRepository } from '../audit/repository.js';
import type { AuthenticatedContext } from '../identity/service.js';
import { isForeignKeyViolation } from '../shared/database-errors.js';
import { ApiError, invalidRequest, notFound } from '../shared/errors.js';
import { hashToken } from '../shared/security/tokens.js';
import type { DeviceRepository } from './repository.js';
import { generateEnrollmentToken, isSupportedDeviceKey, verifySignedEvent } from './signature.js';

export interface DeviceRepositories extends AttendanceRepositories {
  devices: DeviceRepository;
  audit: AuditRepository;
}

export interface DeviceServiceDependencies {
  repository: DeviceRepository;
  attendance: AttendanceRepositories['attendance'];
  now: () => Date;
  transaction<T>(fn: (repositories: DeviceRepositories) => Promise<T>): Promise<T>;
}

export interface DeviceService {
  list(context: AuthenticatedContext): Promise<DeviceRecord[]>;
  register(
    context: AuthenticatedContext,
    input: RegisterDeviceRequest,
  ): Promise<RegisterDeviceResponse>;
  revoke(context: AuthenticatedContext, deviceId: string): Promise<DeviceRecord>;
  listReceipts(context: AuthenticatedContext, deviceId: string): Promise<DeviceReceiptRecord[]>;
  enroll(input: EnrollDeviceRequest): Promise<EnrollDeviceResponse>;
  recordEvent(
    deviceId: string,
    signature: string,
    input: DeviceEventRequest,
  ): Promise<{ result: DeviceEventResponse; created: boolean }>;
}

/** 端末からの冪等キーは端末ごとに独立しているため、従業員側では端末を混ぜて扱う。 */
function attendanceRequestId(deviceId: string, requestId: string): string {
  return `device:${deviceId}:${requestId}`;
}

export function createDeviceService(deps: DeviceServiceDependencies): DeviceService {
  return {
    list: (context) => deps.repository.list(context.workspace.id),

    async register(context, input) {
      const token = generateEnrollmentToken();
      try {
        const device = await deps.repository.create(context.workspace.id, {
          name: input.name,
          siteId: input.siteId ?? null,
          enrollmentTokenHash: hashToken(token),
        });
        return { device, enrollmentToken: token };
      } catch (error) {
        if (isForeignKeyViolation(error)) throw notFound('拠点');
        throw error;
      }
    },

    async revoke(context, deviceId) {
      const workspaceId = context.workspace.id;
      return deps.transaction(async ({ devices, audit }) => {
        const existing = await devices.findById(workspaceId, deviceId);
        if (!existing) throw notFound('端末');

        const next = applyDeviceEvent(
          { state: existing.state, context: { enrollments: existing.enrollments } },
          'REVOKE',
        );
        if (!next) throw new ApiError('conflict', 'この端末はすでに失効しています');

        const revoked = await devices.markRevoked(workspaceId, deviceId, deps.now());

        await audit.record(workspaceId, {
          actorKind: 'user',
          actorUserId: context.user.id,
          action: 'device.revoked',
          targetType: 'device',
          targetId: deviceId,
          summary: `端末「${existing.name}」を失効させました`,
          detail: { deviceId, previousState: existing.state },
        });

        return revoked;
      });
    },

    async listReceipts(context, deviceId) {
      const device = await deps.repository.findById(context.workspace.id, deviceId);
      if (!device) throw notFound('端末');
      return deps.repository.listReceipts(context.workspace.id, deviceId, 200);
    },

    async enroll(input) {
      if (!isSupportedDeviceKey(input.publicKey)) {
        throw invalidRequest([
          { field: 'publicKey', message: 'Ed25519 の公開鍵（SPKI PEM）を指定してください' },
        ]);
      }

      const found = await deps.repository.findByEnrollmentTokenHash(
        hashToken(input.enrollmentToken),
      );
      if (!found) {
        throw new ApiError('unauthenticated', '登録トークンが一致しません');
      }

      const next = applyDeviceEvent(
        { state: found.state, context: { enrollments: found.enrollments } },
        'ENROLL',
      );
      if (!next) {
        throw new ApiError('conflict', 'この端末は登録できる状態ではありません');
      }

      return deps.transaction(async ({ devices, audit }) => {
        const device = await devices.markEnrolled(found.workspaceId, found.id, {
          publicKey: input.publicKey,
          enrollments: next.context.enrollments,
          enrolledAt: deps.now(),
        });

        await audit.record(found.workspaceId, {
          actorKind: 'device',
          actorUserId: null,
          action: 'device.enrolled',
          targetType: 'device',
          targetId: device.id,
          summary: `端末「${device.name}」が登録されました`,
          detail: { deviceId: device.id },
        });

        return { deviceId: device.id, workspaceSlug: found.workspaceSlug, device };
      });
    },

    async recordEvent(deviceId, signature, input) {
      const found = await deps.repository.findForSignature(deviceId);
      // 端末が存在しない場合と署名が合わない場合を区別せず、同じ応答を返す。
      if (!found || found.publicKey === null || !acceptsSignedEvents(found.device.state)) {
        throw new ApiError('unauthenticated', '端末を認証できません');
      }

      const verified = verifySignedEvent(
        found.publicKey,
        {
          deviceId,
          sequence: input.sequence,
          requestId: input.requestId,
          employeeNumber: input.employeeNumber,
          eventType: input.eventType,
          occurredAt: input.occurredAt,
          deviceTime: input.deviceTime,
        },
        signature,
      );
      if (!verified) {
        throw new ApiError('unauthenticated', '端末を認証できません');
      }

      const workspaceId = found.workspaceId;
      const now = deps.now();
      const occurredAt = new Date(input.occurredAt);
      const deviceTime = new Date(input.deviceTime);
      if (Number.isNaN(occurredAt.getTime()) || Number.isNaN(deviceTime.getTime())) {
        throw invalidRequest([{ field: 'occurredAt', message: '日時として解釈できません' }]);
      }

      const skew = clockSkewSeconds(deviceTime, now);
      const problems = validateOccurredAt(occurredAt, now);
      if (problems.length > 0) {
        throw invalidRequest([
          {
            field: 'occurredAt',
            message: '打刻時刻が受け入れ範囲を超えています。端末の時計を確認してください',
          },
        ]);
      }

      // 断ったイベントも受信記録として残すため、トランザクションの中では例外を投げず、
      // 結果を返してからコミット後に例外へ変換する。
      const outcome = await deps.transaction(async (repositories) => {
        const { devices, attendance } = repositories;
        if (!(await devices.lock(workspaceId, deviceId))) throw notFound('端末');

        // 同じ冪等キーの再送は、最初に受け取った結果をそのまま返す。
        const existingReceipt = await devices.findReceiptByRequestId(
          workspaceId,
          deviceId,
          input.requestId,
        );
        if (existingReceipt) {
          return {
            kind: 'ok' as const,
            result: {
              outcome: 'duplicate' as const,
              attendanceEventId: existingReceipt.attendanceEventId,
              businessDate: existingReceipt.businessDate ?? '',
              sequenceStep: existingReceipt.sequenceStep,
              clockSkewSeconds: existingReceipt.clockSkewSeconds,
            },
            created: false,
          };
        }

        const device = await devices.findById(workspaceId, deviceId);
        if (!device) throw notFound('端末');

        const sequenceStep = input.sequence - device.lastSequence;

        async function reject(error: ApiError, reason: string) {
          await devices.insertReceipt(workspaceId, {
            deviceId,
            sequence: input.sequence,
            requestId: input.requestId,
            deviceTime,
            clockSkewSeconds: skew,
            sequenceStep,
            attendanceEventId: null,
            businessDate: null,
            outcome: 'rejected' as const,
            detail: { reason, lastSequence: device?.lastSequence ?? 0 },
          });
          return { kind: 'rejected' as const, error };
        }

        const verdict = evaluateSequence(device.lastSequence, input.sequence);
        if (verdict === 'replay') {
          // 冪等キーが違うのに連番が戻っている。記録として残したうえで断る。
          return reject(
            new ApiError('conflict', '連番がすでに受け取った値以下です'),
            'sequence_replay',
          );
        }

        const employee = await attendance.findEmployeeByNumber(workspaceId, input.employeeNumber);
        if (!employee) {
          return reject(notFound('従業員'), 'unknown_employee');
        }

        const timeZone = await resolveTimeZoneForEmployee(attendance, workspaceId, employee.id);

        let recorded: Awaited<ReturnType<typeof recordAttendanceEvent>>;
        try {
          recorded = await recordAttendanceEvent(
            repositories,
            {
              workspaceId,
              employeeId: employee.id,
              employeeDisplayName: employee.displayName,
              actorKind: 'device',
              userId: null,
              deviceId,
            },
            {
              eventType: input.eventType,
              occurredAt: input.occurredAt,
              requestId: attendanceRequestId(deviceId, input.requestId),
            },
            'device',
            occurredAt,
            timeZone,
          );
        } catch (error) {
          if (error instanceof ApiError && error.code === 'conflict') {
            return reject(error, 'punch_rejected');
          }
          throw error;
        }

        const { result, created } = recorded;
        await devices.insertReceipt(workspaceId, {
          deviceId,
          sequence: input.sequence,
          requestId: input.requestId,
          deviceTime,
          clockSkewSeconds: skew,
          sequenceStep,
          attendanceEventId: result.event.id,
          businessDate: result.event.businessDate,
          outcome: created ? 'accepted' : 'duplicate',
          detail: {
            employeeNumber: input.employeeNumber,
            ...(verdict === 'gap' ? { sequenceGap: sequenceStep - 1 } : {}),
            ...(isNotableClockSkew(skew) ? { notableClockSkew: true } : {}),
          },
        });

        await devices.updateSequence(workspaceId, deviceId, {
          lastSequence: input.sequence,
          lastSeenAt: now,
        });

        return {
          kind: 'ok' as const,
          result: {
            outcome: created ? ('accepted' as const) : ('duplicate' as const),
            attendanceEventId: result.event.id,
            businessDate: result.event.businessDate,
            sequenceStep,
            clockSkewSeconds: skew,
          },
          created,
        };
      });

      if (outcome.kind === 'rejected') throw outcome.error;
      return { result: outcome.result, created: outcome.created };
    },
  };
}
