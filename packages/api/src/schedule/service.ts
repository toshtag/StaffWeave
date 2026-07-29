import type {
  CreateWorkPatternRequest,
  UpsertWorkScheduleRequest,
  WorkPattern,
  WorkScheduleRecord,
} from '@staffweave/contracts';
import type { BusinessDate } from '@staffweave/domain';
import { isBusinessDate, normalizeCode, validateCode } from '@staffweave/domain';
import type { DayRepositories } from '../attendance/day.js';
import { recalculateWorkDay } from '../attendance/day.js';
import type { AttendanceRepository } from '../attendance/repository.js';
import type { AuditRepository } from '../audit/repository.js';
import type { AuthenticatedContext } from '../identity/service.js';
import { isForeignKeyViolation, isUniqueViolation } from '../shared/database-errors.js';
import { conflict, invalidRequest, notFound } from '../shared/errors.js';

export interface ScheduleRepositories extends DayRepositories {
  audit: AuditRepository;
}

export interface ScheduleServiceDependencies {
  repositories: DayRepositories;
  transaction<T>(fn: (repositories: ScheduleRepositories) => Promise<T>): Promise<T>;
}

export interface ScheduleService {
  listWorkPatterns(workspaceId: string): Promise<WorkPattern[]>;
  createWorkPattern(workspaceId: string, input: CreateWorkPatternRequest): Promise<WorkPattern>;
  listWorkSchedules(
    workspaceId: string,
    query: { employeeId: string; from: string; to: string },
  ): Promise<WorkScheduleRecord[]>;
  upsertWorkSchedule(
    context: AuthenticatedContext,
    input: UpsertWorkScheduleRequest,
  ): Promise<WorkScheduleRecord>;
}

function requireBusinessDate(value: string, field: string): BusinessDate {
  if (!isBusinessDate(value)) {
    throw invalidRequest([{ field, message: '業務日の形式が正しくありません' }]);
  }
  return value;
}

async function resolveTimeZone(
  repository: AttendanceRepository,
  workspaceId: string,
  employeeId: string,
): Promise<string> {
  const timeZone = await repository.findTimeZoneForEmployee(workspaceId, employeeId);
  if (!timeZone) throw notFound('従業員');
  return timeZone;
}

export function createScheduleService(deps: ScheduleServiceDependencies): ScheduleService {
  const { schedule } = deps.repositories;

  return {
    listWorkPatterns: (workspaceId) => schedule.listWorkPatterns(workspaceId),

    async createWorkPattern(workspaceId, input) {
      if (validateCode(input.code).length > 0) {
        throw invalidRequest([
          { field: 'code', message: 'コードは英数字と - _ のみ、32 文字以内で指定してください' },
        ]);
      }
      if (input.endMinutes <= input.startMinutes) {
        throw invalidRequest([
          { field: 'endMinutes', message: '終業は始業より後の時刻にしてください' },
        ]);
      }

      const code = normalizeCode(input.code);
      try {
        return await schedule.createWorkPattern(workspaceId, {
          code,
          name: input.name,
          startMinutes: input.startMinutes,
          endMinutes: input.endMinutes,
          breakMinutes: input.breakMinutes ?? 0,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict(`コード ${code} の勤務パターンはすでに登録されています`);
        }
        throw error;
      }
    },

    async listWorkSchedules(workspaceId, query) {
      const from = requireBusinessDate(query.from, 'from');
      const to = requireBusinessDate(query.to, 'to');
      if (from > to) {
        throw invalidRequest([{ field: 'to', message: '終了日は開始日以降にしてください' }]);
      }
      return schedule.listWorkSchedules(workspaceId, query.employeeId, from, to);
    },

    async upsertWorkSchedule(context, input) {
      const workspaceId = context.workspace.id;
      const businessDate = requireBusinessDate(input.businessDate, 'businessDate');

      let startMinutes = input.startMinutes ?? null;
      let endMinutes = input.endMinutes ?? null;
      let breakMinutes = input.breakMinutes ?? 0;
      let workPatternId = input.workPatternId ?? null;

      if (workPatternId !== null) {
        const pattern = await schedule.findWorkPattern(workspaceId, workPatternId);
        if (!pattern) throw notFound('勤務パターン');
        // 勤務パターンを指定した場合、明示された値だけを上書きする。
        startMinutes = input.startMinutes ?? pattern.startMinutes;
        endMinutes = input.endMinutes ?? pattern.endMinutes;
        breakMinutes = input.breakMinutes ?? pattern.breakMinutes;
      }

      const dayType = input.dayType ?? (startMinutes === null ? 'non_working_day' : 'working_day');

      if (dayType !== 'working_day') {
        // 休日には予定時刻を持たせない。
        startMinutes = null;
        endMinutes = null;
        breakMinutes = 0;
        workPatternId = null;
      } else if ((startMinutes === null) !== (endMinutes === null)) {
        throw invalidRequest([
          { field: 'endMinutes', message: '始業と終業は両方を指定してください' },
        ]);
      } else if (startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes) {
        throw invalidRequest([
          { field: 'endMinutes', message: '終業は始業より後の時刻にしてください' },
        ]);
      }

      return deps.transaction(async (repositories) => {
        let saved: WorkScheduleRecord;
        try {
          saved = await repositories.schedule.upsertWorkSchedule(workspaceId, {
            employeeId: input.employeeId,
            businessDate,
            workPatternId,
            dayType,
            startMinutes,
            endMinutes,
            breakMinutes,
          });
        } catch (error) {
          if (isForeignKeyViolation(error)) throw notFound('従業員または勤務パターン');
          throw error;
        }

        await repositories.audit.record(workspaceId, {
          actorKind: 'user',
          actorUserId: context.user.id,
          action: 'work_schedule.upserted',
          targetType: 'work_schedule',
          targetId: null,
          summary: `${businessDate} の勤務予定を登録しました`,
          detail: { employeeId: input.employeeId, businessDate, dayType, startMinutes, endMinutes },
        });

        // 予定が変われば計算の入力も変わるため、その日の計算をやり直す。
        const timeZone = await resolveTimeZone(
          repositories.attendance,
          workspaceId,
          input.employeeId,
        );
        await recalculateWorkDay(
          repositories,
          workspaceId,
          input.employeeId,
          businessDate,
          timeZone,
        );

        return saved;
      });
    },
  };
}
