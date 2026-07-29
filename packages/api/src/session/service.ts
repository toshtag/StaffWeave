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
import { ApiError, forbidden, invalidRequest } from '../shared/errors.js';
import type { SessionObservationRepository } from './repository.js';

export interface SessionRepositories extends DayRepositories {
  observations: SessionObservationRepository;
  devices: DeviceRepository;
  audit: AuditRepository;
}

export interface SessionServiceDependencies {
  repositories: DayRepositories;
  observations: SessionObservationRepository;
  devices: DeviceRepository;
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

      return deps.transaction(async (repositories) => {
        const { observations, attendance, audit } = repositories;

        if ((await observations.countByRequestId(workspaceId, input.requestId)) > 0) {
          return {
            result: { outcome: 'duplicate' as const, accepted: 0, skipped: 0 },
            created: false,
          };
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

        await audit.record(workspaceId, {
          actorKind: 'device',
          actorUserId: null,
          action: 'session_observation.recorded',
          targetType: 'workstation_session_observation',
          targetId: null,
          summary: `${input.workstationName} から PC の利用記録を ${accepted} 件受け取りました`,
          detail: { deviceId, requestId: input.requestId, accepted, skipped, receivedAt: now },
        });

        return {
          result: { outcome: 'accepted' as const, accepted, skipped },
          created: true,
        };
      });
    },

    async listObservations(context, query) {
      const employeeId = resolveEmployeeId(context, query.employeeId);
      return deps.observations.listForRange(context.workspace.id, {
        ...(employeeId === undefined ? {} : { employeeId }),
        from: query.from,
        to: query.to,
      });
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
