import type {
  AssignWorkCycleRequest,
  CalculationRuleVersionRecord,
  CreateCalculationRuleVersionRequest,
  CreateLaborSystemAssignmentRequest,
  CreateLeaveTypeRequest,
  CreateWorkCategoryRequest,
  CreateWorkCycleRequest,
  CreateWorkPatternRequest,
  EmployeeWorkCycleRecord,
  EndWorkCycleAssignmentRequest,
  GenerateWorkSchedulesRequest,
  GenerateWorkSchedulesResponse,
  LaborSystemAssignmentRecord,
  LeaveTypeRecord,
  UpsertWorkScheduleRequest,
  WorkCategoryRecord,
  WorkCycleRecord,
  WorkPattern,
  WorkScheduleRecord,
} from '@staffweave/contracts';
import type { BusinessDate } from '@staffweave/domain';
import {
  addDaysToBusinessDate,
  isBusinessDate,
  normalizeCode,
  resolveCycleDay,
  selectAssignment,
  validateCode,
  validateWorkCycle,
} from '@staffweave/domain';
import type { DayRepositories } from '../attendance/day.js';
import { recalculateWorkDay } from '../attendance/day.js';
import type { AttendanceRepository } from '../attendance/repository.js';
import type { AuditRepository } from '../audit/repository.js';
import type { AuthenticatedContext } from '../identity/service.js';
import {
  isCheckViolation,
  isExclusionViolation,
  isForeignKeyViolation,
  isUniqueViolation,
} from '../shared/database-errors.js';
import type { EmployeeVisibilityGuard } from '../shared/employee-visibility.js';
import { conflict, invalidRequest, notFound } from '../shared/errors.js';
import type { WorkCycleRepository } from './cycle-repository.js';
import type { LaborSystemRepository } from './labor-system-repository.js';
import { rulesFor } from './repository.js';
import type { WorkCategoryRepository } from './work-category-repository.js';

export interface ScheduleRepositories extends DayRepositories {
  audit: AuditRepository;
}

export interface ScheduleServiceDependencies {
  repositories: DayRepositories;
  cycles: WorkCycleRepository;
  categories: WorkCategoryRepository;
  laborSystems: LaborSystemRepository;
  visibility: EmployeeVisibilityGuard;
  transaction<T>(fn: (repositories: ScheduleRepositories) => Promise<T>): Promise<T>;
}

export interface ScheduleService {
  listWorkCategories(workspaceId: string): Promise<WorkCategoryRecord[]>;
  createWorkCategory(
    workspaceId: string,
    input: CreateWorkCategoryRequest,
  ): Promise<WorkCategoryRecord>;
  listCalculationRuleVersions(workspaceId: string): Promise<CalculationRuleVersionRecord[]>;
  createCalculationRuleVersion(
    workspaceId: string,
    input: CreateCalculationRuleVersionRequest,
  ): Promise<CalculationRuleVersionRecord>;

  listLaborSystemAssignments(
    context: AuthenticatedContext,
    employeeId: string,
  ): Promise<LaborSystemAssignmentRecord[]>;
  assignLaborSystem(
    context: AuthenticatedContext,
    input: CreateLaborSystemAssignmentRequest,
  ): Promise<LaborSystemAssignmentRecord>;
  endLaborSystemAssignment(
    context: AuthenticatedContext,
    assignmentId: string,
    effectiveTo: string,
  ): Promise<LaborSystemAssignmentRecord>;

  listWorkPatterns(workspaceId: string): Promise<WorkPattern[]>;
  createWorkPattern(workspaceId: string, input: CreateWorkPatternRequest): Promise<WorkPattern>;
  listWorkSchedules(
    context: AuthenticatedContext,
    query: { employeeId: string; from: string; to: string },
  ): Promise<WorkScheduleRecord[]>;
  upsertWorkSchedule(
    context: AuthenticatedContext,
    input: UpsertWorkScheduleRequest,
  ): Promise<WorkScheduleRecord>;

  listLeaveTypes(workspaceId: string): Promise<LeaveTypeRecord[]>;
  createLeaveType(workspaceId: string, input: CreateLeaveTypeRequest): Promise<LeaveTypeRecord>;
  listWorkCycles(workspaceId: string): Promise<WorkCycleRecord[]>;
  createWorkCycle(workspaceId: string, input: CreateWorkCycleRequest): Promise<WorkCycleRecord>;
  listAssignments(
    context: AuthenticatedContext,
    employeeId: string,
  ): Promise<EmployeeWorkCycleRecord[]>;
  assignWorkCycle(
    workspaceId: string,
    input: AssignWorkCycleRequest,
  ): Promise<EmployeeWorkCycleRecord>;
  endWorkCycleAssignment(
    workspaceId: string,
    employeeWorkCycleId: string,
    input: EndWorkCycleAssignmentRequest,
  ): Promise<EmployeeWorkCycleRecord>;
  generateWorkSchedules(
    context: AuthenticatedContext,
    input: GenerateWorkSchedulesRequest,
  ): Promise<GenerateWorkSchedulesResponse>;
}

/** 期間の重なりは DB の排他制約で決まる。どの経路から届いても同じ理由を返す。 */
const OVERLAPPING_ASSIGNMENT_MESSAGE =
  'この従業員には、期間が重なる勤務周期の割当がすでにあります。' +
  '先に前の割当へ終了日を設定してください';

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
    listWorkCategories: (workspaceId) => deps.categories.listWorkCategories(workspaceId),

    async createWorkCategory(workspaceId, input) {
      // 所定の時刻は、片方だけでは意味が決まらない。
      if (
        (input.scheduledStartMinutes === undefined) !==
        (input.scheduledEndMinutes === undefined)
      ) {
        throw invalidRequest([
          { field: 'scheduledEndMinutes', message: '所定の開始と終了は両方を指定してください' },
        ]);
      }
      if ((input.nightStartMinutes === undefined) !== (input.nightEndMinutes === undefined)) {
        throw invalidRequest([
          { field: 'nightEndMinutes', message: '深夜帯の開始と終了は両方を指定してください' },
        ]);
      }
      try {
        return await deps.categories.createWorkCategory(workspaceId, input);
      } catch (error) {
        if (isExclusionViolation(error)) {
          throw conflict(
            '同じコードで期間が重なる勤務区分があります。前の版へ終了日を設定してください',
          );
        }
        if (isCheckViolation(error)) throw conflict('勤務区分の設定に矛盾があります');
        throw error;
      }
    },

    listCalculationRuleVersions: (workspaceId) =>
      deps.categories.listCalculationRuleVersions(workspaceId),

    async createCalculationRuleVersion(workspaceId, input) {
      try {
        return await deps.categories.createCalculationRuleVersion(workspaceId, input);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict('同じ適用開始日の計算規則がすでにあります');
        }
        throw error;
      }
    },

    async listLaborSystemAssignments(context, employeeId) {
      await deps.visibility.requireVisibleEmployee(context, employeeId);
      return deps.laborSystems.list(context.workspace.id, employeeId);
    },

    async assignLaborSystem(context, input) {
      await deps.visibility.requireVisibleEmployee(context, input.employeeId);
      try {
        return await deps.laborSystems.create(context.workspace.id, {
          ...input,
          createdByUserId: context.user.id,
        });
      } catch (error) {
        if (isExclusionViolation(error)) throw conflict(OVERLAPPING_ASSIGNMENT_MESSAGE);
        // 制度ごとに必要な値がそろっていない。製品は既定値を持たないため、ここで断る。
        if (isCheckViolation(error)) {
          throw conflict('この労働形態に必要な設定がそろっていません');
        }
        throw error;
      }
    },

    async endLaborSystemAssignment(context, assignmentId, effectiveTo) {
      const updated = await deps.laborSystems.end(context.workspace.id, assignmentId, effectiveTo);
      if (!updated) throw notFound('労働形態の割当');
      await deps.visibility.requireVisibleEmployee(context, updated.employeeId);
      return updated;
    },

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

    async listWorkSchedules(context, query) {
      const from = requireBusinessDate(query.from, 'from');
      const to = requireBusinessDate(query.to, 'to');
      if (from > to) {
        throw invalidRequest([{ field: 'to', message: '終了日は開始日以降にしてください' }]);
      }
      // 勤務予定は期間を対象にする。その期間に関わりがあった相手だけを返す。
      await deps.visibility.requireVisibleEmployee(context, query.employeeId, { from, to });
      return schedule.listWorkSchedules(context.workspace.id, query.employeeId, from, to);
    },

    async upsertWorkSchedule(context, input) {
      const workspaceId = context.workspace.id;
      const businessDate = requireBusinessDate(input.businessDate, 'businessDate');

      let leaveTypeId = input.leaveTypeId ?? null;
      let startMinutes = input.startMinutes ?? null;
      let endMinutes = input.endMinutes ?? null;
      let breakMinutes = input.breakMinutes ?? 0;
      let workPatternId = input.workPatternId ?? null;
      const workCategoryId = input.workCategoryId ?? null;

      // 勤務区分は、その日に効いている版がある場合だけ受け取る。
      // 効いていない版を割り当てると、計算のときに解決できず、
      // 設定したはずの休憩や深夜帯が黙って外れる。
      if (workCategoryId !== null) {
        const category = await deps.categories.findWorkCategoryForDate(
          workspaceId,
          workCategoryId,
          businessDate,
        );
        if (!category) {
          throw invalidRequest([
            { field: 'workCategoryId', message: 'その業務日に効いている勤務区分ではありません' },
          ]);
        }
        // 所定時刻のひな形として使う。勤務パターンと明示の指定はこの後で上書きする。
        startMinutes = input.startMinutes ?? category.scheduledStartMinutes;
        endMinutes = input.endMinutes ?? category.scheduledEndMinutes;
      }

      if (workPatternId !== null) {
        const pattern = await schedule.findWorkPattern(workspaceId, workPatternId);
        if (!pattern) throw notFound('勤務パターン');
        // 勤務パターンを指定した場合、明示された値だけを上書きする。
        startMinutes = input.startMinutes ?? pattern.startMinutes;
        endMinutes = input.endMinutes ?? pattern.endMinutes;
        breakMinutes = input.breakMinutes ?? pattern.breakMinutes;
      }

      const dayType = input.dayType ?? (startMinutes === null ? 'non_working_day' : 'working_day');

      // 休暇と欠勤は「予定はあるが働かない日」。所定の時刻はそのまま残す。
      const plannedDay = dayType === 'working_day' || dayType === 'leave' || dayType === 'absence';

      if (dayType !== 'leave') leaveTypeId = null;

      if (!plannedDay) {
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
            workCategoryId,
            dayType,
            startMinutes,
            endMinutes,
            breakMinutes,
            leaveTypeId,
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

    listLeaveTypes: (workspaceId) => deps.cycles.listLeaveTypes(workspaceId),

    async createLeaveType(workspaceId, input) {
      if (validateCode(input.code).length > 0) {
        throw invalidRequest([
          { field: 'code', message: 'コードは英数字と - _ のみ、32 文字以内で指定してください' },
        ]);
      }
      try {
        return await deps.cycles.createLeaveType(workspaceId, {
          code: normalizeCode(input.code),
          name: input.name,
          paid: input.paid ?? true,
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw conflict('この休暇種別はすでに登録されています');
        throw error;
      }
    },

    listWorkCycles: (workspaceId) => deps.cycles.listWorkCycles(workspaceId),

    async createWorkCycle(workspaceId, input) {
      if (validateCode(input.code).length > 0) {
        throw invalidRequest([
          { field: 'code', message: 'コードは英数字と - _ のみ、32 文字以内で指定してください' },
        ]);
      }

      const days = input.days.map((day) => ({
        position: day.position,
        dayType: day.dayType,
        workPatternId: day.workPatternId ?? null,
        workCategoryId: day.workCategoryId ?? null,
      }));

      const problems = validateWorkCycle({ cycleLength: input.cycleLength, days });
      if (problems.length > 0) {
        throw invalidRequest([
          {
            field: 'days',
            message: `周期の定義が正しくありません（${problems.join(', ')}）`,
          },
        ]);
      }

      try {
        return await deps.cycles.createWorkCycle(workspaceId, {
          code: normalizeCode(input.code),
          name: input.name,
          cycleLength: input.cycleLength,
          days,
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw conflict('この勤務周期はすでに登録されています');
        if (isForeignKeyViolation(error)) throw notFound('勤務パターン');
        throw error;
      }
    },

    async listAssignments(context, employeeId) {
      await deps.visibility.requireVisibleEmployee(context, employeeId);
      return deps.cycles.listAssignments(context.workspace.id, employeeId);
    },

    async assignWorkCycle(workspaceId, input) {
      const anchorDate = requireBusinessDate(input.anchorDate, 'anchorDate');
      const effectiveFrom = requireBusinessDate(input.effectiveFrom, 'effectiveFrom');
      const effectiveTo =
        input.effectiveTo === undefined
          ? null
          : requireBusinessDate(input.effectiveTo, 'effectiveTo');

      if (effectiveTo !== null && effectiveTo < effectiveFrom) {
        throw invalidRequest([
          { field: 'effectiveTo', message: '終了日は開始日以降にしてください' },
        ]);
      }

      try {
        return await deps.cycles.createAssignment(workspaceId, {
          employeeId: input.employeeId,
          workCycleId: input.workCycleId,
          anchorDate,
          effectiveFrom,
          effectiveTo,
        });
      } catch (error) {
        if (isForeignKeyViolation(error)) throw notFound('従業員または勤務周期');
        if (isExclusionViolation(error)) throw conflict(OVERLAPPING_ASSIGNMENT_MESSAGE);
        throw error;
      }
    },

    async endWorkCycleAssignment(workspaceId, employeeWorkCycleId, input) {
      const effectiveTo = requireBusinessDate(input.effectiveTo, 'effectiveTo');

      const existing = await deps.cycles.findAssignment(workspaceId, employeeWorkCycleId);
      if (!existing) throw notFound('勤務周期の割当');
      if (effectiveTo < existing.effectiveFrom) {
        throw invalidRequest([
          { field: 'effectiveTo', message: '終了日は開始日以降にしてください' },
        ]);
      }

      try {
        return await deps.cycles.endAssignment(workspaceId, employeeWorkCycleId, effectiveTo);
      } catch (error) {
        if (isExclusionViolation(error)) throw conflict(OVERLAPPING_ASSIGNMENT_MESSAGE);
        throw error;
      }
    },

    async generateWorkSchedules(context, input) {
      const workspaceId = context.workspace.id;
      const from = requireBusinessDate(input.from, 'from');
      const to = requireBusinessDate(input.to, 'to');
      if (from > to) {
        throw invalidRequest([{ field: 'to', message: '終了日は開始日以降にしてください' }]);
      }

      const assignments = await deps.cycles.listAssignments(workspaceId, input.employeeId);
      const cycles = new Map<string, WorkCycleRecord>();
      const patterns = new Map<string, WorkPattern>();

      let created = 0;
      let skipped = 0;
      let uncovered = 0;

      return deps.transaction(async (repositories) => {
        const timeZone = await resolveTimeZone(
          repositories.attendance,
          workspaceId,
          input.employeeId,
        );
        // 版の一覧は 1 回だけ読む。日ごとにどの版を使うかは、そのあと選ぶ。
        // 計算規則は適用開始日で切り替わるため、期間の途中で変わることがある。
        const ruleVersions = await repositories.schedule.findCalculationRuleVersions(workspaceId);
        const existingDates = input.overwrite
          ? new Set<string>()
          : new Set(
              (
                await repositories.schedule.listWorkSchedules(
                  workspaceId,
                  input.employeeId,
                  from,
                  to,
                )
              ).map((schedule) => schedule.businessDate),
            );

        for (
          let businessDate = from;
          businessDate <= to;
          businessDate = addDaysToBusinessDate(businessDate, 1)
        ) {
          const assignment = selectAssignment(assignments, businessDate);
          if (assignment === null) {
            uncovered += 1;
            continue;
          }

          // 手で直した予定を黙って上書きしない。
          if (existingDates.has(businessDate)) {
            skipped += 1;
            continue;
          }

          const cached = cycles.get(assignment.workCycleId);
          let cycle: WorkCycleRecord;
          if (cached === undefined) {
            const found = await deps.cycles.findWorkCycle(workspaceId, assignment.workCycleId);
            if (!found) throw notFound('勤務周期');
            cycle = found;
            cycles.set(assignment.workCycleId, found);
          } else {
            cycle = cached;
          }

          const resolved = resolveCycleDay(cycle, assignment, businessDate);
          if (resolved === null) {
            uncovered += 1;
            continue;
          }

          let startMinutes: number | null = null;
          let endMinutes: number | null = null;
          let breakMinutes = 0;

          if (resolved.workPatternId !== null) {
            const cachedPattern = patterns.get(resolved.workPatternId);
            let pattern: WorkPattern;
            if (cachedPattern === undefined) {
              const found = await repositories.schedule.findWorkPattern(
                workspaceId,
                resolved.workPatternId,
              );
              if (!found) throw notFound('勤務パターン');
              pattern = found;
              patterns.set(resolved.workPatternId, found);
            } else {
              pattern = cachedPattern;
            }
            startMinutes = pattern.startMinutes;
            endMinutes = pattern.endMinutes;
            breakMinutes = pattern.breakMinutes;
          }

          // 周期が勤務区分を持つ日は、その日に効いている版を確かめてから引き継ぐ。
          // 効いていない版のまま生成すると、計算は勤務区分を解決できず、
          // 生成した日だけ休憩や深夜帯の設定が外れる。
          let workCategoryId = resolved.workCategoryId ?? null;
          if (workCategoryId !== null) {
            const effective = await deps.categories.findWorkCategoryForDate(
              workspaceId,
              workCategoryId,
              businessDate,
            );
            if (effective === null) {
              uncovered += 1;
              continue;
            }
            workCategoryId = effective.id;
            startMinutes = startMinutes ?? effective.scheduledStartMinutes;
            endMinutes = endMinutes ?? effective.scheduledEndMinutes;
          }

          await repositories.schedule.upsertWorkSchedule(workspaceId, {
            employeeId: input.employeeId,
            businessDate,
            workPatternId: resolved.workPatternId,
            workCategoryId,
            dayType: resolved.dayType,
            startMinutes,
            endMinutes,
            breakMinutes,
            leaveTypeId: null,
          });
          await recalculateWorkDay(
            repositories,
            workspaceId,
            input.employeeId,
            businessDate,
            timeZone,
            rulesFor(ruleVersions, businessDate),
          );
          created += 1;
        }

        await repositories.audit.record(workspaceId, {
          actorKind: 'user',
          actorUserId: context.user.id,
          action: 'work_schedule.generated',
          targetType: 'work_schedule',
          targetId: null,
          summary: `${from} から ${to} の勤務予定を ${created} 日分作成しました`,
          detail: { employeeId: input.employeeId, from, to, created, skipped, uncovered },
        });

        return { created, skipped, uncovered };
      });
    },
  };
}
