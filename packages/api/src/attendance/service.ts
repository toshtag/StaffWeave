import type {
  AttendanceEventRecord,
  AttendanceLocationRecord,
  CorrectAttendanceRequest,
  CorrectAttendanceResponse,
  RecordAttendanceEventRequest,
  RecordAttendanceEventResponse,
  WorkDay,
} from '@staffweave/contracts';
import type { AttendanceSource } from '@staffweave/domain';
import {
  addDaysToBusinessDate,
  businessDateOf,
  isBusinessDate,
  isOpenWorkDay,
  validateCorrectionOccurredAt,
  validateOccurredAt,
} from '@staffweave/domain';
import type { AuthenticatedContext } from '../identity/service.js';
import type { EmployeeVisibilityGuard } from '../shared/employee-visibility.js';
import { ApiError, invalidRequest, notFound } from '../shared/errors.js';
import type { DayRepositories } from './day.js';
import { loadWorkDay, recalculateWorkDay } from './day.js';
import type { AttendanceActor, AttendanceRepositories } from './record.js';
import { EVENT_LABELS, recordAttendanceEvent, requireEditableDay } from './record.js';
import type { AttendanceRepository } from './repository.js';

export type { AttendanceRepositories } from './record.js';

export interface AttendanceServiceDependencies {
  repositories: DayRepositories;
  /** 他人の打刻した場所を見てよいかの判断。 */
  visibility: EmployeeVisibilityGuard;
  now: () => Date;
  /** 打刻の登録は同一従業員内で直列化する必要があるため、必ずトランザクション内で行う。 */
  transaction<T>(fn: (repositories: AttendanceRepositories) => Promise<T>): Promise<T>;
}

export interface AttendanceService {
  recordEvent(
    context: AuthenticatedContext,
    input: RecordAttendanceEventRequest,
    source: AttendanceSource,
  ): Promise<{ result: RecordAttendanceEventResponse; created: boolean }>;
  correct(
    context: AuthenticatedContext,
    input: CorrectAttendanceRequest,
  ): Promise<{ result: CorrectAttendanceResponse; created: boolean }>;
  getToday(context: AuthenticatedContext): Promise<WorkDay>;
  getDay(context: AuthenticatedContext, businessDate: string): Promise<WorkDay>;
  listLocations(
    context: AuthenticatedContext,
    query: { employeeId: string; from: string; to: string },
  ): Promise<AttendanceLocationRecord[]>;
}

/** 打刻は本人の従業員レコードに対してのみ行える。 */
function requireEmployee(context: AuthenticatedContext): string {
  if (!context.employee) {
    throw new ApiError('forbidden', 'この利用者には従業員が紐づいていないため、打刻できません');
  }
  return context.employee.id;
}

function actorOf(context: AuthenticatedContext): AttendanceActor {
  return {
    workspaceId: context.workspace.id,
    employeeId: requireEmployee(context),
    employeeDisplayName: context.employee?.displayName ?? '',
    actorKind: 'user',
    userId: context.user.id,
  };
}

export async function resolveTimeZoneForEmployee(
  repository: AttendanceRepository,
  workspaceId: string,
  employeeId: string,
): Promise<string> {
  const timeZone = await repository.findTimeZoneForEmployee(workspaceId, employeeId);
  if (!timeZone) throw notFound('従業員');
  return timeZone;
}

export function createAttendanceService(deps: AttendanceServiceDependencies): AttendanceService {
  /**
   * 打刻そのものの時刻。オフラインの再送を見込んで 24 時間だけ遡れる。
   */
  function requireValidOccurredAt(value: string | undefined, now: Date, field: string): Date {
    return requireOccurredAtWithin(value, now, field, {
      validate: validateOccurredAt,
      tooFarPast: '24 時間より前の時刻は指定できません',
    });
  }

  /**
   * 訂正で指定する時刻。人が後から直すため、打刻より広く遡れる。
   *
   * 打刻と同じ 24 時間を当てていたので、前月の打刻漏れも、
   * 月次の確認で見つけた誤りも直せなかった。
   * 遡れる範囲を広げても、締め済みの期間は `requireEditableDay` が断る。
   */
  function requireValidCorrectionOccurredAt(
    value: string | undefined,
    now: Date,
    field: string,
  ): Date {
    return requireOccurredAtWithin(value, now, field, {
      validate: validateCorrectionOccurredAt,
      tooFarPast: '訂正できる範囲より前の時刻です',
    });
  }

  function requireOccurredAtWithin(
    value: string | undefined,
    now: Date,
    field: string,
    rule: {
      validate: (occurredAt: Date, now: Date) => readonly string[];
      tooFarPast: string;
    },
  ): Date {
    if (value === undefined) return now;
    const occurredAt = new Date(value);
    if (Number.isNaN(occurredAt.getTime())) {
      throw invalidRequest([{ field, message: '日時として解釈できません' }]);
    }
    const problems = rule.validate(occurredAt, now);
    if (problems.includes('too_far_future')) {
      throw invalidRequest([{ field, message: '未来の時刻は指定できません' }]);
    }
    if (problems.includes('too_far_past')) {
      throw invalidRequest([{ field, message: rule.tooFarPast }]);
    }
    return occurredAt;
  }

  return {
    async recordEvent(context, input, source) {
      const actor = actorOf(context);
      const now = deps.now();
      const occurredAt = requireValidOccurredAt(input.occurredAt, now, 'occurredAt');
      const timeZone = await resolveTimeZoneForEmployee(
        deps.repositories.attendance,
        actor.workspaceId,
        actor.employeeId,
      );

      return deps.transaction((repositories) =>
        recordAttendanceEvent(repositories, actor, input, source, occurredAt, timeZone),
      );
    },

    async correct(context, input) {
      const employeeId = requireEmployee(context);
      const workspaceId = context.workspace.id;
      const now = deps.now();
      const timeZone = await resolveTimeZoneForEmployee(
        deps.repositories.attendance,
        workspaceId,
        employeeId,
      );

      if (input.reason.trim().length < 2) {
        throw invalidRequest([{ field: 'reason', message: '修正の理由を入力してください' }]);
      }

      if (input.action === 'add') {
        if (input.targetEventId !== undefined) {
          throw invalidRequest([
            { field: 'targetEventId', message: '打刻の追加では対象を指定できません' },
          ]);
        }
        if (input.eventType === undefined || input.occurredAt === undefined) {
          throw invalidRequest([
            { field: 'eventType', message: '追加する打刻の種別と時刻を指定してください' },
          ]);
        }
      } else if (input.targetEventId === undefined) {
        throw invalidRequest([
          { field: 'targetEventId', message: '修正する打刻を指定してください' },
        ]);
      }

      if (
        input.action === 'adjust' &&
        input.occurredAt === undefined &&
        input.eventType === undefined
      ) {
        throw invalidRequest([
          { field: 'occurredAt', message: '変更後の時刻または種別を指定してください' },
        ]);
      }

      if (input.businessDate !== undefined && !isBusinessDate(input.businessDate)) {
        throw invalidRequest([
          { field: 'businessDate', message: '業務日の形式が正しくありません' },
        ]);
      }

      return deps.transaction(async (repositories) => {
        const { attendance, audit } = repositories;
        if (!(await attendance.lockEmployee(workspaceId, employeeId))) {
          throw notFound('従業員');
        }

        const existing = await attendance.findEventByRequestId(
          workspaceId,
          employeeId,
          input.requestId,
        );
        if (existing) {
          return {
            result: {
              event: existing,
              day: await loadWorkDay(
                repositories,
                workspaceId,
                employeeId,
                existing.businessDate,
                timeZone,
              ),
              duplicate: true,
            },
            created: false,
          };
        }

        let target: AttendanceEventRecord | null = null;
        if (input.targetEventId !== undefined) {
          target = await attendance.findEventById(workspaceId, employeeId, input.targetEventId);
          if (!target) throw notFound('修正対象の打刻');
        }

        const eventType = input.eventType ?? target?.eventType;
        if (eventType === undefined) {
          throw invalidRequest([{ field: 'eventType', message: '打刻の種別を特定できません' }]);
        }

        const occurredAt =
          input.occurredAt === undefined
            ? target === null
              ? now
              : new Date(target.occurredAt)
            : requireValidCorrectionOccurredAt(input.occurredAt, now, 'occurredAt');

        // 修正は対象と同じ業務日に属させる。追加のみ、指定または打刻時刻から決める。
        const businessDate =
          target?.businessDate ?? input.businessDate ?? businessDateOf(occurredAt, timeZone);

        requireEditableDay(
          await loadWorkDay(repositories, workspaceId, employeeId, businessDate, timeZone),
        );

        const event = await attendance.insertEvent(workspaceId, {
          employeeId,
          eventType,
          occurredAt,
          businessDate,
          source: 'correction',
          requestId: input.requestId,
          recordedByUserId: context.user.id,
          correctsEventId: target?.id ?? null,
          correctionAction: input.action,
          correctionReason: input.reason.trim(),
        });

        const actorName = context.employee?.displayName ?? '';
        const summary =
          input.action === 'void'
            ? `${actorName} が${EVENT_LABELS[eventType]}の打刻を取り消しました`
            : input.action === 'add'
              ? `${actorName} が${EVENT_LABELS[eventType]}の打刻を追加しました`
              : `${actorName} が${EVENT_LABELS[eventType]}の打刻を修正しました`;

        await audit.record(workspaceId, {
          actorKind: 'user',
          actorUserId: context.user.id,
          action: `attendance_event.${input.action}`,
          targetType: 'attendance_event',
          targetId: event.id,
          summary,
          detail: {
            employeeId,
            businessDate,
            action: input.action,
            reason: input.reason.trim(),
            before:
              target === null
                ? null
                : { eventType: target.eventType, occurredAt: target.occurredAt },
            after: { eventType, occurredAt: occurredAt.toISOString() },
          },
        });

        return {
          result: {
            event,
            day: await recalculateWorkDay(
              repositories,
              workspaceId,
              employeeId,
              businessDate,
              timeZone,
            ),
            duplicate: false,
          },
          created: true,
        };
      });
    },

    async getToday(context) {
      const employeeId = requireEmployee(context);
      const workspaceId = context.workspace.id;
      const timeZone = await resolveTimeZoneForEmployee(
        deps.repositories.attendance,
        workspaceId,
        employeeId,
      );
      const today = businessDateOf(deps.now(), timeZone);

      // 前日からの勤務が続いていれば、そちらを「今の勤務日」として見せる。
      const previous = addDaysToBusinessDate(today, -1);
      const previousDay = await loadWorkDay(
        deps.repositories,
        workspaceId,
        employeeId,
        previous,
        timeZone,
      );
      if (isOpenWorkDay(previousDay.state)) return previousDay;

      return loadWorkDay(deps.repositories, workspaceId, employeeId, today, timeZone);
    },

    async getDay(context, businessDate) {
      const employeeId = requireEmployee(context);
      const workspaceId = context.workspace.id;
      if (!isBusinessDate(businessDate)) {
        throw invalidRequest([
          { field: 'businessDate', message: '業務日の形式が正しくありません' },
        ]);
      }
      const timeZone = await resolveTimeZoneForEmployee(
        deps.repositories.attendance,
        workspaceId,
        employeeId,
      );
      return loadWorkDay(deps.repositories, workspaceId, employeeId, businessDate, timeZone);
    },

    async listLocations(context, query) {
      if (!isBusinessDate(query.from) || !isBusinessDate(query.to)) {
        throw invalidRequest([{ field: 'from', message: '日付の形式が正しくありません' }]);
      }
      if (query.from > query.to) {
        throw invalidRequest([{ field: 'to', message: '終了日は開始日以降にしてください' }]);
      }
      // 本人は自分の位置情報を必ず読める。何を残されたのかを本人が確かめられないと、
      // 取ることそのものを説明できない。
      if (query.employeeId !== context.employee?.id) {
        await deps.visibility.requireVisibleEmployee(context, query.employeeId, {
          from: query.from,
          to: query.to,
        });
      }
      return deps.repositories.attendance.listLocations(context.workspace.id, query.employeeId, {
        from: query.from,
        to: query.to,
      });
    },
  };
}
