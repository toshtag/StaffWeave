import type {
  DiscrepancyReport,
  RecordSessionObservationsRequest,
  RecordSessionObservationsResponse,
  SessionObservationRecord,
} from '@staffweave/contracts';
import {
  acceptsSignedEvents,
  businessDateOf,
  canonicalSessionObservations,
  detectDiscrepancies,
  evaluateSequence,
  hasPermission,
  isBusinessDate,
} from '@staffweave/domain';
import type { DayRepositories } from '../attendance/day.js';
import { loadWorkDay } from '../attendance/day.js';
import { resolveTimeZoneForEmployee } from '../attendance/service.js';
import type { AuditRepository } from '../audit/repository.js';
import type { DeviceRepository } from '../device/repository.js';
import { verifySignature } from '../device/signature.js';
import type { AuthenticatedContext } from '../identity/service.js';
import { isUniqueViolation } from '../shared/database-errors.js';
import type { EmployeeVisibilityGuard } from '../shared/employee-visibility.js';
import { ApiError, forbidden, invalidRequest, notFound } from '../shared/errors.js';
import type { SessionObservationReceipt, SessionObservationRepository } from './repository.js';
import { SESSION_RECEIPT_REQUEST_CONSTRAINT } from './repository.js';

export interface SessionRepositories extends DayRepositories {
  observations: SessionObservationRepository;
  devices: DeviceRepository;
  audit: AuditRepository;
}

export interface SessionServiceDependencies {
  repositories: DayRepositories;
  observations: SessionObservationRepository;
  devices: DeviceRepository;
  visibility: EmployeeVisibilityGuard;
  now: () => Date;
  transaction<T>(fn: (repositories: SessionRepositories) => Promise<T>): Promise<T>;
}

export interface SessionService {
  recordObservations(
    deviceId: string,
    signature: string,
    input: RecordSessionObservationsRequest,
  ): Promise<{ result: RecordSessionObservationsResponse; created: boolean }>;
  listObservations(
    context: AuthenticatedContext,
    query: { employeeId?: string; from: string; to: string },
  ): Promise<SessionObservationRecord[]>;
  getDiscrepancyReport(
    context: AuthenticatedContext,
    businessDate: string,
    employeeId?: string,
  ): Promise<DiscrepancyReport>;
}

const SEQUENCE_REPLAY_MESSAGE = '連番がすでに受け取った値以下です';

/** 受け取り済みの要求への応答。断った要求も記録として残すため、例外は結果として持ち回る。 */
type RequestOutcome =
  | { kind: 'ok'; result: RecordSessionObservationsResponse; created: boolean }
  | { kind: 'rejected'; error: ApiError };

const DUPLICATE: RequestOutcome = {
  kind: 'ok',
  result: { outcome: 'duplicate', accepted: 0, skipped: 0 },
  created: false,
};

/**
 * すでに受領記録のある要求へ返す応答。
 *
 * 受理していれば再送として duplicate を返し、断っていれば同じ理由で断る。
 * 元の件数は返さない。応答の意味は「この要求はすでに扱った」であり、
 * 何件記録できたかを再送のたびに数え直すことではない。
 */
function replayOf(receipt: SessionObservationReceipt): RequestOutcome {
  if (receipt.outcome === 'rejected') {
    return { kind: 'rejected', error: new ApiError('conflict', SEQUENCE_REPLAY_MESSAGE) };
  }
  return DUPLICATE;
}

/**
 * まとめ送り 1 回分を受け取る。
 *
 * 端末の行をロックし、同じ端末から届く署名要求を打刻イベントと合わせて直列化する。
 * 連番は API の経路ごとではなく端末ごとに一つであり、devices.last_sequence が正本になる。
 */
async function runRequest(
  deps: SessionServiceDependencies,
  workspaceId: string,
  deviceId: string,
  input: RecordSessionObservationsRequest,
  now: Date,
): Promise<RequestOutcome> {
  try {
    return await deps.transaction(async (repositories) => {
      const { observations, devices, attendance, audit } = repositories;
      if (!(await devices.lock(workspaceId, deviceId))) throw notFound('端末');

      // 再送の判定は連番より先に行う。最初の受理で連番が進んでいても、
      // 同じ冪等キーで届いた要求は連番の再利用ではない。
      const receipt = await observations.findReceiptByRequestId(workspaceId, input.requestId);
      if (receipt) return replayOf(receipt);
      // 0016 より前に受け取った要求には受領記録がないため、観測そのものを見る。
      if (await observations.existsLegacyRequest(workspaceId, input.requestId)) return DUPLICATE;

      const device = await devices.findById(workspaceId, deviceId);
      if (!device) throw notFound('端末');

      const sequenceStep = input.sequence - device.lastSequence;
      if (evaluateSequence(device.lastSequence, input.sequence) === 'replay') {
        // 冪等キーが違うのに連番が戻っている。記録として残したうえで断る。
        await observations.insertReceipt(workspaceId, {
          deviceId,
          requestId: input.requestId,
          sequence: input.sequence,
          receivedAt: now,
          sequenceStep,
          outcome: 'rejected',
          accepted: 0,
          skipped: 0,
          detail: { reason: 'sequence_replay', lastSequence: device.lastSequence },
        });
        return { kind: 'rejected', error: new ApiError('conflict', SEQUENCE_REPLAY_MESSAGE) };
      }

      let accepted = 0;
      let skipped = 0;

      for (const line of input.observations) {
        const employee = await attendance.findEmployeeByNumber(workspaceId, line.employeeNumber);
        if (!employee) {
          // 従業員が見つからない観測は捨てるが、件数として返して気付けるようにする。
          skipped += 1;
          continue;
        }

        const timeZone = await resolveTimeZoneForEmployee(attendance, workspaceId, employee.id);
        const occurredAt = new Date(line.occurredAt);

        await observations.insert(workspaceId, {
          employeeId: employee.id,
          deviceId,
          observationType: line.observationType,
          occurredAt,
          businessDate: businessDateOf(occurredAt, timeZone),
          requestId: input.requestId,
          workstationName: input.workstationName,
        });
        accepted += 1;
      }

      // 連番の欠落は受理する。届かなかった要求を待っても観測は戻らないため、
      // 欠落した数を受領記録と監査へ残し、後から気付けるようにする。
      const gap = sequenceStep > 1 ? { sequenceGap: sequenceStep - 1 } : {};

      await observations.insertReceipt(workspaceId, {
        deviceId,
        requestId: input.requestId,
        sequence: input.sequence,
        receivedAt: now,
        sequenceStep,
        outcome: 'accepted',
        accepted,
        skipped,
        detail: gap,
      });

      await audit.record(workspaceId, {
        actorKind: 'device',
        actorUserId: null,
        action: 'session_observation.recorded',
        targetType: 'workstation_session_observation',
        targetId: null,
        summary: `${input.workstationName} から PC の利用記録を ${accepted} 件受け取りました`,
        detail: {
          deviceId,
          requestId: input.requestId,
          sequence: input.sequence,
          sequenceStep,
          ...gap,
          accepted,
          skipped,
          receivedAt: now,
        },
      });

      await devices.updateSequence(workspaceId, deviceId, {
        lastSequence: input.sequence,
        lastSeenAt: now,
      });

      return { kind: 'ok', result: { outcome: 'accepted', accepted, skipped }, created: true };
    });
  } catch (error) {
    // 同じ要求を別のトランザクションが先に確定させた。こちらが記録した観測・監査・連番は
    // 受領記録と一緒に巻き戻っているため、先に確定した記録を読み直して同じ応答を返す。
    if (!isUniqueViolation(error, SESSION_RECEIPT_REQUEST_CONSTRAINT)) throw error;
    const receipt = await deps.observations.findReceiptByRequestId(workspaceId, input.requestId);
    if (!receipt) throw error;
    return replayOf(receipt);
  }
}

/** 自分以外の従業員を対象にできるのは、閲覧権限を持つ利用者だけ。 */
function resolveEmployeeId(
  context: AuthenticatedContext,
  requested: string | undefined,
): string | undefined {
  if (requested === undefined) {
    if (hasPermission(context.roles, 'employee.read')) return undefined;
    if (!context.employee) {
      throw new ApiError('forbidden', 'この利用者には従業員が紐づいていません');
    }
    return context.employee.id;
  }
  if (requested === context.employee?.id) return requested;
  if (!hasPermission(context.roles, 'employee.read')) throw forbidden();
  return requested;
}

export function createSessionService(deps: SessionServiceDependencies): SessionService {
  return {
    async recordObservations(deviceId, signature, input) {
      const found = await deps.devices.findForSignature(deviceId);
      if (!found || found.publicKey === null || !acceptsSignedEvents(found.device.state)) {
        throw new ApiError('unauthenticated', '端末を認証できません');
      }

      const verified = verifySignature(
        found.publicKey,
        canonicalSessionObservations({
          deviceId,
          sequence: input.sequence,
          requestId: input.requestId,
          workstationName: input.workstationName,
          observations: input.observations,
        }),
        signature,
      );
      if (!verified) throw new ApiError('unauthenticated', '端末を認証できません');

      const workspaceId = found.workspaceId;
      const now = deps.now();

      for (const observation of input.observations) {
        if (Number.isNaN(new Date(observation.occurredAt).getTime())) {
          throw invalidRequest([{ field: 'observations', message: '日時として解釈できません' }]);
        }
      }

      // 断った要求も受領記録として残すため、トランザクションの中では例外を投げず、
      // 結果を返してからコミット後に例外へ変換する。
      const outcome = await runRequest(deps, workspaceId, deviceId, input, now);

      if (outcome.kind === 'rejected') throw outcome.error;
      return { result: outcome.result, created: outcome.created };
    },

    async listObservations(context, query) {
      const employeeId = resolveEmployeeId(context, query.employeeId);
      if (employeeId !== undefined) {
        await deps.visibility.requireVisibleEmployee(context, employeeId);
      }

      const observations = await deps.observations.listForRange(context.workspace.id, {
        ...(employeeId === undefined ? {} : { employeeId }),
        from: query.from,
        to: query.to,
      });

      return deps.visibility.filterVisible(
        context,
        observations,
        (observation) => observation.employeeId,
      );
    },

    async getDiscrepancyReport(context, businessDate, requestedEmployeeId) {
      if (!isBusinessDate(businessDate)) {
        throw invalidRequest([
          { field: 'businessDate', message: '業務日の形式が正しくありません' },
        ]);
      }

      const employeeId = resolveEmployeeId(context, requestedEmployeeId) ?? context.employee?.id;
      if (employeeId === undefined) {
        throw invalidRequest([{ field: 'employeeId', message: '従業員を指定してください' }]);
      }
      await deps.visibility.requireVisibleEmployee(context, employeeId);

      const workspaceId = context.workspace.id;
      const timeZone = await resolveTimeZoneForEmployee(
        deps.repositories.attendance,
        workspaceId,
        employeeId,
      );
      const day = await loadWorkDay(
        deps.repositories,
        workspaceId,
        employeeId,
        businessDate,
        timeZone,
      );
      const observations = await deps.observations.listForDay(
        workspaceId,
        employeeId,
        businessDate,
      );

      const discrepancies = detectDiscrepancies(
        {
          businessDate,
          firstClockInAt: day.firstClockInAt === null ? null : new Date(day.firstClockInAt),
          lastClockOutAt: day.lastClockOutAt === null ? null : new Date(day.lastClockOutAt),
          breaks: day.breaks.map((period) => ({
            startedAt: new Date(period.startedAt),
            endedAt: period.endedAt === null ? null : new Date(period.endedAt),
          })),
        },
        observations.map((observation) => ({
          observationType: observation.observationType,
          occurredAt: new Date(observation.occurredAt),
        })),
      );

      return { businessDate, employeeId, discrepancies, observations };
    },
  };
}
