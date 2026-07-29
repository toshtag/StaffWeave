import type {
  AttendanceEventRecord,
  RecordAttendanceEventRequest,
  RecordAttendanceEventResponse,
  WorkDay,
} from '@staffweave/contracts';
import type { AttendanceSource, BusinessDate } from '@staffweave/domain';
import {
  businessDateOf,
  decidePunch,
  summarizeWorkDay,
  validateOccurredAt,
} from '@staffweave/domain';
import type { AuditRepository } from '../audit/repository.js';
import type { AuthenticatedContext } from '../identity/service.js';
import { isUniqueViolation } from '../shared/database-errors.js';
import { ApiError, invalidRequest, notFound } from '../shared/errors.js';
import type { AttendanceRepository } from './repository.js';

export interface AttendanceServiceDependencies {
  repository: AttendanceRepository;
  audit: AuditRepository;
  now: () => Date;
  /**
   * 打刻の登録は同一従業員内で直列化する必要があるため、必ずトランザクション内で行う。
   */
  transaction<T>(
    fn: (repositories: { attendance: AttendanceRepository; audit: AuditRepository }) => Promise<T>,
  ): Promise<T>;
}

export interface AttendanceService {
  recordEvent(
    context: AuthenticatedContext,
    input: RecordAttendanceEventRequest,
    source: AttendanceSource,
  ): Promise<{ result: RecordAttendanceEventResponse; created: boolean }>;
  getToday(context: AuthenticatedContext): Promise<WorkDay>;
}

const REJECTION_MESSAGES = {
  already_working: 'すでに出勤済みです',
  not_working: '出勤の記録がないため退勤できません',
  already_finished: 'すでに退勤済みです。同じ業務日の再出勤はできません',
} as const;

function buildWorkDay(
  employeeId: string,
  businessDate: BusinessDate,
  events: readonly AttendanceEventRecord[],
): WorkDay {
  const summary = summarizeWorkDay(
    businessDate,
    events.map((event) => ({
      eventType: event.eventType,
      occurredAt: new Date(event.occurredAt),
    })),
  );

  return {
    businessDate,
    employeeId,
    state: summary.state,
    firstClockInAt: summary.firstClockInAt?.toISOString() ?? null,
    lastClockOutAt: summary.lastClockOutAt?.toISOString() ?? null,
    events: [...events],
  };
}

/** 打刻は本人の従業員レコードに対してのみ行える。 */
function requireEmployee(context: AuthenticatedContext): string {
  if (!context.employee) {
    throw new ApiError('forbidden', 'この利用者には従業員が紐づいていないため、打刻できません');
  }
  return context.employee.id;
}

export function createAttendanceService(deps: AttendanceServiceDependencies): AttendanceService {
  async function resolveTimeZone(
    repository: AttendanceRepository,
    workspaceId: string,
    employeeId: string,
  ): Promise<string> {
    const timeZone = await repository.findTimeZoneForEmployee(workspaceId, employeeId);
    if (!timeZone) throw notFound('従業員');
    return timeZone;
  }

  return {
    async recordEvent(context, input, source) {
      const employeeId = requireEmployee(context);
      const workspaceId = context.workspace.id;
      const now = deps.now();
      const occurredAt = input.occurredAt === undefined ? now : new Date(input.occurredAt);

      if (Number.isNaN(occurredAt.getTime())) {
        throw invalidRequest([{ field: 'occurredAt', message: '日時として解釈できません' }]);
      }

      const problems = validateOccurredAt(occurredAt, now);
      if (problems.includes('too_far_future')) {
        throw invalidRequest([{ field: 'occurredAt', message: '未来の時刻は打刻できません' }]);
      }
      if (problems.includes('too_far_past')) {
        throw invalidRequest([
          { field: 'occurredAt', message: '24 時間より前の打刻は受け付けられません' },
        ]);
      }

      const timeZone = await resolveTimeZone(deps.repository, workspaceId, employeeId);
      const businessDate = businessDateOf(occurredAt, timeZone);

      return deps.transaction(async ({ attendance, audit }) => {
        // 同一従業員の同時打刻を直列化する。
        if (!(await attendance.lockEmployee(workspaceId, employeeId))) {
          throw notFound('従業員');
        }

        const existing = await attendance.findEventByRequestId(
          workspaceId,
          employeeId,
          input.requestId,
        );
        if (existing) {
          const events = await attendance.listEventsForDay(
            workspaceId,
            employeeId,
            existing.businessDate,
          );
          return {
            result: {
              event: existing,
              day: buildWorkDay(employeeId, existing.businessDate, events),
              duplicate: true,
            },
            created: false,
          };
        }

        const events = await attendance.listEventsForDay(workspaceId, employeeId, businessDate);
        const day = buildWorkDay(employeeId, businessDate, events);
        const decision = decidePunch(day.state, input.eventType);
        if (!decision.accepted) {
          const rejection = decision.rejection ?? 'not_working';
          throw new ApiError('conflict', REJECTION_MESSAGES[rejection]);
        }

        let event: AttendanceEventRecord;
        try {
          event = await attendance.insertEvent(workspaceId, {
            employeeId,
            eventType: input.eventType,
            occurredAt,
            businessDate,
            source,
            requestId: input.requestId,
            recordedByUserId: context.user.id,
          });
        } catch (error) {
          if (isUniqueViolation(error, 'attendance_events_request_key')) {
            // ロックの外側で同じ冪等キーが先に登録された場合。
            const duplicate = await attendance.findEventByRequestId(
              workspaceId,
              employeeId,
              input.requestId,
            );
            if (duplicate) {
              const dayEvents = await attendance.listEventsForDay(
                workspaceId,
                employeeId,
                duplicate.businessDate,
              );
              return {
                result: {
                  event: duplicate,
                  day: buildWorkDay(employeeId, duplicate.businessDate, dayEvents),
                  duplicate: true,
                },
                created: false,
              };
            }
          }
          throw error;
        }

        await audit.record(workspaceId, {
          actorKind: 'user',
          actorUserId: context.user.id,
          action: 'attendance_event.recorded',
          targetType: 'attendance_event',
          targetId: event.id,
          summary:
            input.eventType === 'clock_in'
              ? `${context.employee?.displayName ?? ''} が出勤を打刻しました`
              : `${context.employee?.displayName ?? ''} が退勤を打刻しました`,
          detail: {
            employeeId,
            eventType: event.eventType,
            occurredAt: event.occurredAt,
            businessDate: event.businessDate,
            source,
            requestId: input.requestId,
          },
        });

        return {
          result: {
            event,
            day: buildWorkDay(employeeId, businessDate, [...events, event]),
            duplicate: false,
          },
          created: true,
        };
      });
    },

    async getToday(context) {
      const employeeId = requireEmployee(context);
      const workspaceId = context.workspace.id;
      const timeZone = await resolveTimeZone(deps.repository, workspaceId, employeeId);
      const businessDate = businessDateOf(deps.now(), timeZone);
      const events = await deps.repository.listEventsForDay(workspaceId, employeeId, businessDate);
      return buildWorkDay(employeeId, businessDate, events);
    },
  };
}
