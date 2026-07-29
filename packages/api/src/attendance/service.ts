import type {
  AttendanceEventRecord,
  CorrectAttendanceRequest,
  CorrectAttendanceResponse,
  RecordAttendanceEventRequest,
  RecordAttendanceEventResponse,
  WorkDay,
} from '@staffweave/contracts';
import type {
  AttendanceEventType,
  AttendanceSource,
  BusinessDate,
  CorrectableEvent,
} from '@staffweave/domain';
import {
  addDaysToBusinessDate,
  businessDateOf,
  decidePunch,
  isBusinessDate,
  isOpenWorkDay,
  resolveEffectiveEvents,
  summarizeWorkDay,
  validateOccurredAt,
} from '@staffweave/domain';
import type { AuditRepository } from '../audit/repository.js';
import type { AuthenticatedContext } from '../identity/service.js';
import { isUniqueViolation } from '../shared/database-errors.js';
import { ApiError, invalidRequest, notFound } from '../shared/errors.js';
import type { AttendanceRepository } from './repository.js';

export interface AttendanceRepositories {
  attendance: AttendanceRepository;
  audit: AuditRepository;
}

export interface AttendanceServiceDependencies {
  repository: AttendanceRepository;
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
}

const REJECTION_MESSAGES = {
  already_working: 'すでに出勤済みです',
  not_working: '勤務中ではないため、この打刻はできません',
  already_finished: 'すでに退勤済みです。同じ業務日の再出勤はできません',
  already_on_break: 'すでに休憩中です',
  not_on_break: '休憩中ではないため、休憩終了は記録できません',
  still_on_break: '休憩中です。先に休憩終了を記録してください',
} as const;

const EVENT_LABELS: Record<AttendanceEventType, string> = {
  clock_in: '出勤',
  clock_out: '退勤',
  break_start: '休憩開始',
  break_end: '休憩終了',
};

function toCorrectable(record: AttendanceEventRecord): CorrectableEvent {
  return {
    id: record.id,
    eventType: record.eventType,
    occurredAt: new Date(record.occurredAt),
    correctionAction: record.correctionAction,
    correctsEventId: record.correctsEventId,
    recordedAt: new Date(record.recordedAt),
  };
}

/**
 * 記録されたすべてのイベントから、修正を適用した一日の姿を組み立てる。
 * 元の打刻は残したまま、有効な打刻と履歴の両方を返す。
 */
function buildWorkDay(
  employeeId: string,
  businessDate: BusinessDate,
  history: readonly AttendanceEventRecord[],
): WorkDay {
  const byId = new Map(history.map((record) => [record.id, record]));
  const effective = resolveEffectiveEvents(history.map(toCorrectable));
  const summary = summarizeWorkDay(
    businessDate,
    effective.map((event) => ({ eventType: event.eventType, occurredAt: event.occurredAt })),
  );

  const events = effective
    .map((event) => byId.get(event.id))
    .filter((record): record is AttendanceEventRecord => record !== undefined);

  return {
    businessDate,
    employeeId,
    state: summary.state,
    firstClockInAt: summary.firstClockInAt?.toISOString() ?? null,
    lastClockOutAt: summary.lastClockOutAt?.toISOString() ?? null,
    breaks: summary.breaks.map((period) => ({
      startedAt: period.startedAt.toISOString(),
      endedAt: period.endedAt?.toISOString() ?? null,
    })),
    events,
    history: [...history],
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

  async function loadDay(
    repository: AttendanceRepository,
    workspaceId: string,
    employeeId: string,
    businessDate: BusinessDate,
  ): Promise<WorkDay> {
    const history = await repository.listEventsForDay(workspaceId, employeeId, businessDate);
    return buildWorkDay(employeeId, businessDate, history);
  }

  /**
   * 打刻が属する業務日を決める。
   *
   * 出勤は打刻時刻から素直に決める。
   * 出勤以外は、前日の勤務がまだ続いていればその業務日へ付ける。
   * これにより、日付をまたぐ勤務でも退勤や休憩が別の日に分かれない。
   */
  async function resolveBusinessDate(
    repository: AttendanceRepository,
    workspaceId: string,
    employeeId: string,
    eventType: AttendanceEventType,
    occurredAt: Date,
    timeZone: string,
  ): Promise<BusinessDate> {
    const computed = businessDateOf(occurredAt, timeZone);
    if (eventType === 'clock_in') return computed;

    for (const candidate of [computed, addDaysToBusinessDate(computed, -1)]) {
      const day = await loadDay(repository, workspaceId, employeeId, candidate);
      if (isOpenWorkDay(day.state)) return candidate;
    }
    return computed;
  }

  function requireValidOccurredAt(value: string | undefined, now: Date, field: string): Date {
    if (value === undefined) return now;
    const occurredAt = new Date(value);
    if (Number.isNaN(occurredAt.getTime())) {
      throw invalidRequest([{ field, message: '日時として解釈できません' }]);
    }
    const problems = validateOccurredAt(occurredAt, now);
    if (problems.includes('too_far_future')) {
      throw invalidRequest([{ field, message: '未来の時刻は指定できません' }]);
    }
    if (problems.includes('too_far_past')) {
      throw invalidRequest([{ field, message: '24 時間より前の時刻は指定できません' }]);
    }
    return occurredAt;
  }

  return {
    async recordEvent(context, input, source) {
      const employeeId = requireEmployee(context);
      const workspaceId = context.workspace.id;
      const now = deps.now();
      const occurredAt = requireValidOccurredAt(input.occurredAt, now, 'occurredAt');
      const timeZone = await resolveTimeZone(deps.repository, workspaceId, employeeId);

      return deps.transaction(async ({ attendance, audit }) => {
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
              day: await loadDay(attendance, workspaceId, employeeId, existing.businessDate),
              duplicate: true,
            },
            created: false,
          };
        }

        const businessDate = await resolveBusinessDate(
          attendance,
          workspaceId,
          employeeId,
          input.eventType,
          occurredAt,
          timeZone,
        );

        const day = await loadDay(attendance, workspaceId, employeeId, businessDate);
        const decision = decidePunch(day.state, input.eventType);
        if (!decision.accepted) {
          throw new ApiError('conflict', REJECTION_MESSAGES[decision.rejection ?? 'not_working']);
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
            const duplicate = await attendance.findEventByRequestId(
              workspaceId,
              employeeId,
              input.requestId,
            );
            if (duplicate) {
              return {
                result: {
                  event: duplicate,
                  day: await loadDay(attendance, workspaceId, employeeId, duplicate.businessDate),
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
          summary: `${context.employee?.displayName ?? ''} が${EVENT_LABELS[input.eventType]}を打刻しました`,
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
            day: await loadDay(attendance, workspaceId, employeeId, businessDate),
            duplicate: false,
          },
          created: true,
        };
      });
    },

    async correct(context, input) {
      const employeeId = requireEmployee(context);
      const workspaceId = context.workspace.id;
      const now = deps.now();
      const timeZone = await resolveTimeZone(deps.repository, workspaceId, employeeId);

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

      return deps.transaction(async ({ attendance, audit }) => {
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
              day: await loadDay(attendance, workspaceId, employeeId, existing.businessDate),
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
            : requireValidOccurredAt(input.occurredAt, now, 'occurredAt');

        // 修正は対象と同じ業務日に属させる。追加のみ、指定または打刻時刻から決める。
        const businessDate =
          target?.businessDate ?? input.businessDate ?? businessDateOf(occurredAt, timeZone);

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
            day: await loadDay(attendance, workspaceId, employeeId, businessDate),
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
      const today = businessDateOf(deps.now(), timeZone);

      // 前日からの勤務が続いていれば、そちらを「今の勤務日」として見せる。
      const previous = addDaysToBusinessDate(today, -1);
      const previousDay = await loadDay(deps.repository, workspaceId, employeeId, previous);
      if (isOpenWorkDay(previousDay.state)) return previousDay;

      return loadDay(deps.repository, workspaceId, employeeId, today);
    },

    async getDay(context, businessDate) {
      const employeeId = requireEmployee(context);
      if (!isBusinessDate(businessDate)) {
        throw invalidRequest([
          { field: 'businessDate', message: '業務日の形式が正しくありません' },
        ]);
      }
      return loadDay(deps.repository, context.workspace.id, employeeId, businessDate);
    },
  };
}
