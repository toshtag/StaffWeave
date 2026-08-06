import type {
  CalculationRuleVersionRecord,
  CreateCalculationRuleVersionRequest,
  CreateWorkCategoryRequest,
  WorkCategoryRecord,
} from '@staffweave/contracts';
import type { Queryable } from '@staffweave/db';

/**
 * 勤務区分と計算規則の版。
 *
 * どちらも適用開始日で版を重ねる。過去の集計は当時の版で計算した結果を持ち、
 * あとからの設定変更で書き換わらない。
 */
export interface WorkCategoryRepository {
  listWorkCategories(workspaceId: string): Promise<WorkCategoryRecord[]>;
  createWorkCategory(
    workspaceId: string,
    input: CreateWorkCategoryRequest,
  ): Promise<WorkCategoryRecord>;
  /** その業務日に効いている勤務区分。無ければ null。 */
  findWorkCategoryForDate(
    workspaceId: string,
    workCategoryId: string,
  ): Promise<WorkCategoryRecord | null>;

  listCalculationRuleVersions(workspaceId: string): Promise<CalculationRuleVersionRecord[]>;
  createCalculationRuleVersion(
    workspaceId: string,
    input: CreateCalculationRuleVersionRequest,
  ): Promise<CalculationRuleVersionRecord>;
}

interface CategoryRow {
  id: string;
  code: string;
  internal_name: string;
  display_name: string;
  category_type: WorkCategoryRecord['categoryType'];
  effective_from: string;
  effective_to: string | null;
  scheduled_start_minutes: number | null;
  scheduled_end_minutes: number | null;
  prescribed_minutes: number | null;
  deemed_minutes: number | null;
  night_start_minutes: number | null;
  night_end_minutes: number | null;
  gap_treatment: WorkCategoryRecord['gapTreatment'];
  shift: boolean;
  color: string | null;
  counts_as_working_day: boolean;
  created_at: Date;
}

const CATEGORY_COLUMNS = `id, code, internal_name, display_name, category_type,
  effective_from, effective_to, scheduled_start_minutes, scheduled_end_minutes,
  prescribed_minutes, deemed_minutes, night_start_minutes, night_end_minutes,
  gap_treatment, shift, color, counts_as_working_day, created_at`;

function toCategory(
  row: CategoryRow,
  fixedBreaks: WorkCategoryRecord['fixedBreaks'],
  autoBreaks: WorkCategoryRecord['autoBreaks'],
): WorkCategoryRecord {
  return {
    id: row.id,
    code: row.code,
    internalName: row.internal_name,
    displayName: row.display_name,
    categoryType: row.category_type,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    scheduledStartMinutes: row.scheduled_start_minutes,
    scheduledEndMinutes: row.scheduled_end_minutes,
    prescribedMinutes: row.prescribed_minutes,
    deemedMinutes: row.deemed_minutes,
    nightStartMinutes: row.night_start_minutes,
    nightEndMinutes: row.night_end_minutes,
    gapTreatment: row.gap_treatment,
    shift: row.shift,
    color: row.color,
    countsAsWorkingDay: row.counts_as_working_day,
    fixedBreaks,
    autoBreaks,
    createdAt: row.created_at.toISOString(),
  };
}

interface RuleRow {
  id: string;
  effective_from: string;
  day_start_minutes: number;
  night_start_minutes: number;
  night_end_minutes: number;
  rounding_minutes: number;
  rounding_mode: CalculationRuleVersionRecord['roundingMode'];
  daily_legal_minutes: number | null;
  weekly_legal_minutes: number | null;
  week_starts_on: number;
  month_starts_on: number;
  created_at: Date;
}

function toRuleVersion(row: RuleRow): CalculationRuleVersionRecord {
  return {
    id: row.id,
    effectiveFrom: row.effective_from,
    dayStartMinutes: row.day_start_minutes,
    nightStartMinutes: row.night_start_minutes,
    nightEndMinutes: row.night_end_minutes,
    roundingMinutes: row.rounding_minutes,
    roundingMode: row.rounding_mode,
    dailyLegalMinutes: row.daily_legal_minutes,
    weeklyLegalMinutes: row.weekly_legal_minutes,
    weekStartsOn: row.week_starts_on,
    monthStartsOn: row.month_starts_on,
    createdAt: row.created_at.toISOString(),
  };
}

export function createWorkCategoryRepository(db: Queryable): WorkCategoryRepository {
  async function breaksOf(
    workspaceId: string,
    categoryIds: readonly string[],
  ): Promise<{
    fixed: Map<string, WorkCategoryRecord['fixedBreaks']>;
    auto: Map<string, WorkCategoryRecord['autoBreaks']>;
  }> {
    const fixed = new Map<string, { startMinutes: number; endMinutes: number }[]>();
    const auto = new Map<string, { thresholdMinutes: number; additionalMinutes: number }[]>();
    if (categoryIds.length === 0) return { fixed, auto };

    const fixedRows = await db.query<{
      work_category_id: string;
      start_minutes: number;
      end_minutes: number;
    }>(
      `SELECT work_category_id, start_minutes, end_minutes
         FROM work_category_fixed_breaks
        WHERE workspace_id = $1 AND work_category_id = ANY($2::uuid[])
        ORDER BY start_minutes`,
      [workspaceId, categoryIds as string[]],
    );
    for (const row of fixedRows) {
      const list = fixed.get(row.work_category_id) ?? [];
      list.push({ startMinutes: row.start_minutes, endMinutes: row.end_minutes });
      fixed.set(row.work_category_id, list);
    }

    const autoRows = await db.query<{
      work_category_id: string;
      threshold_minutes: number;
      additional_minutes: number;
    }>(
      `SELECT work_category_id, threshold_minutes, additional_minutes
         FROM work_category_auto_breaks
        WHERE workspace_id = $1 AND work_category_id = ANY($2::uuid[])
        ORDER BY threshold_minutes`,
      [workspaceId, categoryIds as string[]],
    );
    for (const row of autoRows) {
      const list = auto.get(row.work_category_id) ?? [];
      list.push({
        thresholdMinutes: row.threshold_minutes,
        additionalMinutes: row.additional_minutes,
      });
      auto.set(row.work_category_id, list);
    }

    return { fixed, auto };
  }

  return {
    async listWorkCategories(workspaceId) {
      const rows = await db.query<CategoryRow>(
        `SELECT ${CATEGORY_COLUMNS} FROM work_categories
          WHERE workspace_id = $1
          ORDER BY code, effective_from DESC`,
        [workspaceId],
      );
      const { fixed, auto } = await breaksOf(
        workspaceId,
        rows.map((row) => row.id),
      );
      return rows.map((row) => toCategory(row, fixed.get(row.id) ?? [], auto.get(row.id) ?? []));
    },

    async findWorkCategoryForDate(workspaceId, workCategoryId) {
      const rows = await db.query<CategoryRow>(
        `SELECT ${CATEGORY_COLUMNS} FROM work_categories
          WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, workCategoryId],
      );
      const row = rows[0];
      if (!row) return null;
      const { fixed, auto } = await breaksOf(workspaceId, [row.id]);
      return toCategory(row, fixed.get(row.id) ?? [], auto.get(row.id) ?? []);
    },

    async createWorkCategory(workspaceId, input) {
      const rows = await db.query<CategoryRow>(
        `INSERT INTO work_categories
           (workspace_id, code, internal_name, display_name, category_type,
            effective_from, effective_to, scheduled_start_minutes, scheduled_end_minutes,
            prescribed_minutes, deemed_minutes, night_start_minutes, night_end_minutes,
            gap_treatment, shift, color, counts_as_working_day)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING ${CATEGORY_COLUMNS}`,
        [
          workspaceId,
          input.code,
          input.internalName,
          input.displayName,
          input.categoryType,
          input.effectiveFrom,
          input.effectiveTo ?? null,
          input.scheduledStartMinutes ?? null,
          input.scheduledEndMinutes ?? null,
          input.prescribedMinutes ?? null,
          input.deemedMinutes ?? null,
          input.nightStartMinutes ?? null,
          input.nightEndMinutes ?? null,
          input.gapTreatment ?? 'non_working',
          input.shift ?? false,
          input.color ?? null,
          input.countsAsWorkingDay ?? true,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('勤務区分を作成できませんでした');

      for (const entry of input.fixedBreaks ?? []) {
        await db.query(
          `INSERT INTO work_category_fixed_breaks
             (workspace_id, work_category_id, start_minutes, end_minutes)
           VALUES ($1, $2, $3, $4)`,
          [workspaceId, row.id, entry.startMinutes, entry.endMinutes],
        );
      }
      for (const entry of input.autoBreaks ?? []) {
        await db.query(
          `INSERT INTO work_category_auto_breaks
             (workspace_id, work_category_id, threshold_minutes, additional_minutes)
           VALUES ($1, $2, $3, $4)`,
          [workspaceId, row.id, entry.thresholdMinutes, entry.additionalMinutes],
        );
      }

      const { fixed, auto } = await breaksOf(workspaceId, [row.id]);
      return toCategory(row, fixed.get(row.id) ?? [], auto.get(row.id) ?? []);
    },

    async listCalculationRuleVersions(workspaceId) {
      const rows = await db.query<RuleRow>(
        `SELECT id, effective_from, day_start_minutes, night_start_minutes, night_end_minutes,
                rounding_minutes, rounding_mode, daily_legal_minutes, weekly_legal_minutes,
                week_starts_on, month_starts_on, created_at
           FROM calculation_rule_versions
          WHERE workspace_id = $1
          ORDER BY effective_from DESC`,
        [workspaceId],
      );
      return rows.map(toRuleVersion);
    },

    async createCalculationRuleVersion(workspaceId, input) {
      const rows = await db.query<RuleRow>(
        `INSERT INTO calculation_rule_versions
           (workspace_id, effective_from, day_start_minutes, night_start_minutes, night_end_minutes,
            rounding_minutes, rounding_mode, daily_legal_minutes, weekly_legal_minutes,
            week_starts_on, month_starts_on)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, effective_from, day_start_minutes, night_start_minutes, night_end_minutes,
                   rounding_minutes, rounding_mode, daily_legal_minutes, weekly_legal_minutes,
                   week_starts_on, month_starts_on, created_at`,
        [
          workspaceId,
          input.effectiveFrom,
          input.dayStartMinutes,
          input.nightStartMinutes,
          input.nightEndMinutes,
          input.roundingMinutes,
          input.roundingMode,
          input.dailyLegalMinutes ?? null,
          input.weeklyLegalMinutes ?? null,
          input.weekStartsOn,
          input.monthStartsOn,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('計算規則の版を作成できませんでした');
      return toRuleVersion(row);
    },
  };
}
