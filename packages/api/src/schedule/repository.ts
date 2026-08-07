import type { WorkPattern, WorkScheduleRecord } from '@staffweave/contracts';
import type { Queryable } from '@staffweave/db';
import type { BusinessDate, CalculationRules, DayType, RoundingMode } from '@staffweave/domain';
import { DEFAULT_CALCULATION_RULES } from '@staffweave/domain';

export interface UpsertWorkScheduleInput {
  employeeId: string;
  businessDate: BusinessDate;
  workPatternId: string | null;
  workCategoryId: string | null;
  dayType: DayType;
  startMinutes: number | null;
  endMinutes: number | null;
  breakMinutes: number;
  leaveTypeId: string | null;
}

/** 適用開始日つきの計算規則。 */
export interface CalculationRuleVersion {
  effectiveFrom: string;
  rules: CalculationRules;
}

/**
 * その業務日に効いている版を選ぶ。
 *
 * 版は新しい順に並んでいる。適用開始日がその日以前で、いちばん新しいものを採る。
 * 無ければ、何も設定されていない状態として返す。
 */
export function rulesFor(
  versions: readonly CalculationRuleVersion[],
  businessDate: string,
): CalculationRules {
  return (
    versions.find((version) => version.effectiveFrom <= businessDate)?.rules ??
    DEFAULT_CALCULATION_RULES
  );
}

export interface ScheduleRepository {
  listWorkPatterns(workspaceId: string): Promise<WorkPattern[]>;
  findWorkPattern(workspaceId: string, workPatternId: string): Promise<WorkPattern | null>;
  createWorkPattern(
    workspaceId: string,
    input: {
      code: string;
      name: string;
      startMinutes: number;
      endMinutes: number;
      breakMinutes: number;
    },
  ): Promise<WorkPattern>;

  listWorkSchedules(
    workspaceId: string,
    employeeId: string,
    from: BusinessDate,
    to: BusinessDate,
  ): Promise<WorkScheduleRecord[]>;
  findWorkSchedule(
    workspaceId: string,
    employeeId: string,
    businessDate: BusinessDate,
  ): Promise<WorkScheduleRecord | null>;
  upsertWorkSchedule(
    workspaceId: string,
    input: UpsertWorkScheduleInput,
  ): Promise<WorkScheduleRecord>;

  /** ワークスペースの計算ルール。未設定なら既定値を返す。 */
  /**
   * 計算規則の版を、新しい順に返す。
   *
   * 期間をまとめて計算するときは、日ごとに読み直さずこれを 1 回だけ読み、
   * `rulesFor` で日ごとに選ぶ。
   */
  findCalculationRuleVersions(workspaceId: string): Promise<CalculationRuleVersion[]>;

  /**
   * その業務日に適用する計算規則。
   *
   * 版は適用開始日で選ぶ。過去の日を再計算しても、当時の版で計算する。
   * 版が無ければ、何も設定されていない状態として返す。
   */
  findCalculationRules(workspaceId: string, businessDate?: string): Promise<CalculationRules>;
}

interface WorkPatternRow {
  id: string;
  code: string;
  name: string;
  start_minutes: number;
  end_minutes: number;
  break_minutes: number;
  created_at: Date;
}

interface WorkScheduleRow {
  employee_id: string;
  business_date: string;
  work_pattern_id: string | null;
  work_category_id: string | null;
  day_type: DayType;
  start_minutes: number | null;
  end_minutes: number | null;
  break_minutes: number;
  leave_type_id: string | null;
}

function toWorkPattern(row: WorkPatternRow): WorkPattern {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    startMinutes: row.start_minutes,
    endMinutes: row.end_minutes,
    breakMinutes: row.break_minutes,
    createdAt: row.created_at.toISOString(),
  };
}

function toWorkSchedule(row: WorkScheduleRow): WorkScheduleRecord {
  return {
    employeeId: row.employee_id,
    businessDate: row.business_date,
    workPatternId: row.work_pattern_id,
    workCategoryId: row.work_category_id,
    dayType: row.day_type,
    startMinutes: row.start_minutes,
    endMinutes: row.end_minutes,
    breakMinutes: row.break_minutes,
    leaveTypeId: row.leave_type_id,
  };
}

const PATTERN_COLUMNS = 'id, code, name, start_minutes, end_minutes, break_minutes, created_at';
const SCHEDULE_COLUMNS = `employee_id, business_date, work_pattern_id, work_category_id, day_type,
  start_minutes, end_minutes, break_minutes, leave_type_id`;

export function createScheduleRepository(db: Queryable): ScheduleRepository {
  return {
    async listWorkPatterns(workspaceId) {
      const rows = await db.query<WorkPatternRow>(
        `SELECT ${PATTERN_COLUMNS} FROM work_patterns WHERE workspace_id = $1 ORDER BY code`,
        [workspaceId],
      );
      return rows.map(toWorkPattern);
    },

    async findWorkPattern(workspaceId, workPatternId) {
      const rows = await db.query<WorkPatternRow>(
        `SELECT ${PATTERN_COLUMNS} FROM work_patterns WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, workPatternId],
      );
      return rows[0] ? toWorkPattern(rows[0]) : null;
    },

    async createWorkPattern(workspaceId, input) {
      const rows = await db.query<WorkPatternRow>(
        `INSERT INTO work_patterns (workspace_id, code, name, start_minutes, end_minutes, break_minutes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${PATTERN_COLUMNS}`,
        [
          workspaceId,
          input.code,
          input.name,
          input.startMinutes,
          input.endMinutes,
          input.breakMinutes,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('勤務パターンを登録できませんでした');
      return toWorkPattern(row);
    },

    async listWorkSchedules(workspaceId, employeeId, from, to) {
      const rows = await db.query<WorkScheduleRow>(
        `SELECT ${SCHEDULE_COLUMNS} FROM work_schedules
          WHERE workspace_id = $1 AND employee_id = $2 AND business_date BETWEEN $3 AND $4
          ORDER BY business_date`,
        [workspaceId, employeeId, from, to],
      );
      return rows.map(toWorkSchedule);
    },

    async findWorkSchedule(workspaceId, employeeId, businessDate) {
      const rows = await db.query<WorkScheduleRow>(
        `SELECT ${SCHEDULE_COLUMNS} FROM work_schedules
          WHERE workspace_id = $1 AND employee_id = $2 AND business_date = $3`,
        [workspaceId, employeeId, businessDate],
      );
      return rows[0] ? toWorkSchedule(rows[0]) : null;
    },

    async upsertWorkSchedule(workspaceId, input) {
      const rows = await db.query<WorkScheduleRow>(
        `INSERT INTO work_schedules
           (workspace_id, employee_id, business_date, work_pattern_id, work_category_id, day_type,
            start_minutes, end_minutes, break_minutes, leave_type_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (workspace_id, employee_id, business_date) DO UPDATE
           SET work_pattern_id  = EXCLUDED.work_pattern_id,
               work_category_id = EXCLUDED.work_category_id,
               day_type         = EXCLUDED.day_type,
               start_minutes    = EXCLUDED.start_minutes,
               end_minutes      = EXCLUDED.end_minutes,
               break_minutes    = EXCLUDED.break_minutes,
               leave_type_id    = EXCLUDED.leave_type_id,
               updated_at       = now()
         RETURNING ${SCHEDULE_COLUMNS}`,
        [
          workspaceId,
          input.employeeId,
          input.businessDate,
          input.workPatternId,
          input.workCategoryId,
          input.dayType,
          input.startMinutes,
          input.endMinutes,
          input.breakMinutes,
          input.leaveTypeId,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('勤務予定を登録できませんでした');
      return toWorkSchedule(row);
    },

    async findCalculationRuleVersions(workspaceId) {
      const rows = await db.query<{
        id: string;
        effective_from: string;
        night_start_minutes: number;
        night_end_minutes: number;
        rounding_minutes: number;
        rounding_mode: RoundingMode;
        daily_legal_minutes: number | null;
      }>(
        `SELECT id, effective_from, night_start_minutes, night_end_minutes,
                rounding_minutes, rounding_mode, daily_legal_minutes
           FROM calculation_rule_versions
          WHERE workspace_id = $1
          ORDER BY effective_from DESC`,
        [workspaceId],
      );
      return rows.map((row) => ({
        effectiveFrom: row.effective_from,
        rules: {
          // 版そのものを結果へ残す。あとから「どの設定で計算したか」を辿れる。
          version: `${row.effective_from}/${row.id.slice(0, 8)}`,
          nightStartMinutes: row.night_start_minutes,
          nightEndMinutes: row.night_end_minutes,
          roundingMinutes: row.rounding_minutes,
          roundingMode: row.rounding_mode,
          dailyLegalMinutes: row.daily_legal_minutes,
        },
      }));
    },

    async findCalculationRules(workspaceId, businessDate) {
      const versions = await this.findCalculationRuleVersions(workspaceId);
      return rulesFor(versions, businessDate ?? new Date().toISOString().slice(0, 10));
    },
  };
}
