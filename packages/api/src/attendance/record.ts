import type {
  AttendanceEventRecord,
  RecordAttendanceEventRequest,
  RecordAttendanceEventResponse,
  WorkDay,
} from '@staffweave/contracts';
import type { AttendanceEventType, AttendanceSource, BusinessDate } from '@staffweave/domain';
import {
  addDaysToBusinessDate,
  businessDateOf,
  decidePunch,
  isOpenWorkDay,
} from '@staffweave/domain';
import type { AuditRepository } from '../audit/repository.js';
import { isUniqueViolation } from '../shared/database-errors.js';
import { ApiError, notFound } from '../shared/errors.js';
import type { DayRepositories } from './day.js';
import { loadWorkDay, recalculateWorkDay } from './day.js';

export interface AttendanceRepositories extends DayRepositories {
  audit: AuditRepository;
}

/**
 * 打刻を記録する主体。
 * 画面からの操作でも端末からの署名イベントでも、同じ経路で記録できるようにする。
 */
export interface AttendanceActor {
  workspaceId: string;
  employeeId: string;
  employeeDisplayName: string;
  actorKind: 'user' | 'device';
  /** 画面から操作した利用者。端末の場合は null。 */
  userId: string | null;
  /** 端末から届いた場合の端末識別子。 */
  deviceId?: string;
}

export const PUNCH_REJECTION_MESSAGES = {
  already_working: 'すでに出勤済みです',
  not_working: '勤務中ではないため、この打刻はできません',
  already_on_break: 'すでに休憩中です',
  not_on_break: '休憩中ではないため、休憩終了は記録できません',
  still_on_break: '休憩中です。先に休憩終了を記録してください',
} as const;

export const EVENT_LABELS: Record<AttendanceEventType, string> = {
  clock_in: '出勤',
  clock_out: '退勤',
  break_start: '休憩開始',
  break_end: '休憩終了',
};

/**
 * 申請中・承認済み・締め済みの日は打刻や修正を受け付けない。
 * 確定した記録が黙って変わらないようにするため。
 */
export function requireEditableDay(day: WorkDay): void {
  if (day.editable) return;
  if (day.closing?.state === 'closed') {
    throw new ApiError('conflict', 'この月は締められているため、打刻や修正はできません');
  }
  throw new ApiError(
    'conflict',
    day.request?.state === 'approved'
      ? '承認済みのため、打刻や修正はできません。差し戻しまたは締め解除が必要です'
      : '申請中のため、打刻や修正はできません。先に申請を取り消してください',
  );
}

/**
 * 打刻が属する業務日を決める。
 *
 * 出勤は打刻時刻から素直に決める。
 * 出勤以外は、前日の勤務がまだ続いていればその業務日へ付ける。
 * これにより、日付をまたぐ勤務でも退勤や休憩が別の日に分かれない。
 */
export async function resolveBusinessDate(
  repositories: DayRepositories,
  workspaceId: string,
  employeeId: string,
  eventType: AttendanceEventType,
  occurredAt: Date,
  timeZone: string,
): Promise<BusinessDate> {
  const computed = businessDateOf(occurredAt, timeZone);
  if (eventType === 'clock_in') return computed;

  for (const candidate of [computed, addDaysToBusinessDate(computed, -1)]) {
    const day = await loadWorkDay(repositories, workspaceId, employeeId, candidate, timeZone);
    if (isOpenWorkDay(day.state)) return candidate;
  }
  return computed;
}

/**
 * 打刻の記録本体。トランザクションの内側で呼ぶ。
 * 同一従業員の打刻は行ロックで直列化し、同時要求による二重登録を防ぐ。
 */
export async function recordAttendanceEvent(
  repositories: AttendanceRepositories,
  actor: AttendanceActor,
  input: RecordAttendanceEventRequest & { requestId: string },
  source: AttendanceSource,
  occurredAt: Date,
  timeZone: string,
): Promise<{ result: RecordAttendanceEventResponse; created: boolean }> {
  const { attendance, audit } = repositories;
  const { workspaceId, employeeId } = actor;

  if (!(await attendance.lockEmployee(workspaceId, employeeId))) {
    throw notFound('従業員');
  }

  const existing = await attendance.findEventByRequestId(workspaceId, employeeId, input.requestId);
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

  const businessDate = await resolveBusinessDate(
    repositories,
    workspaceId,
    employeeId,
    input.eventType,
    occurredAt,
    timeZone,
  );

  const day = await loadWorkDay(repositories, workspaceId, employeeId, businessDate, timeZone);
  requireEditableDay(day);

  const decision = decidePunch(day.state, input.eventType);
  if (!decision.accepted) {
    throw new ApiError('conflict', PUNCH_REJECTION_MESSAGES[decision.rejection ?? 'not_working']);
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
      recordedByUserId: actor.userId,
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
            day: await loadWorkDay(
              repositories,
              workspaceId,
              employeeId,
              duplicate.businessDate,
              timeZone,
            ),
            duplicate: true,
          },
          created: false,
        };
      }
    }
    throw error;
  }

  // 位置情報は、組織が取ると決めているときだけ残す。
  // 決めていない組織へ送られてきた値は、受け取っても保存しない。
  //
  // 位置情報を残せなくても打刻は残る。ここで失敗させると、
  // 測位できない場所に居る人が打刻できなくなる。
  if (
    input.location !== undefined &&
    (await attendance.capturesLocation(workspaceId, employeeId))
  ) {
    await attendance.attachLocation(workspaceId, {
      eventId: event.id,
      latitude: input.location.latitude,
      longitude: input.location.longitude,
      accuracyMeters: input.location.accuracyMeters,
      capturedAt: occurredAt,
    });
  }

  await audit.record(workspaceId, {
    actorKind: actor.actorKind,
    actorUserId: actor.userId,
    action: 'attendance_event.recorded',
    targetType: 'attendance_event',
    targetId: event.id,
    summary: `${actor.employeeDisplayName} が${EVENT_LABELS[input.eventType]}を打刻しました`,
    detail: {
      employeeId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      businessDate: event.businessDate,
      source,
      requestId: input.requestId,
      ...(actor.deviceId === undefined ? {} : { deviceId: actor.deviceId }),
    },
  });

  return {
    result: {
      event,
      day: await recalculateWorkDay(repositories, workspaceId, employeeId, businessDate, timeZone),
      duplicate: false,
    },
    created: true,
  };
}
