import type {
  CreateRequestTypeRequest,
  CreateWorkCategoryRequest,
  ImportResult,
  RequestCategory,
  WorkCategoryType,
} from '@staffweave/contracts';
import { hasPermission, isBusinessDate, parseCsv } from '@staffweave/domain';
import type { AuditRepository } from '../audit/repository.js';
import type { AuthenticatedContext } from '../identity/service.js';
import type { RequestRepository } from '../request/repository.js';
import { isUniqueViolation } from '../shared/database-errors.js';
import { ApiError, forbidden, invalidRequest } from '../shared/errors.js';
import type { WorkCategoryRepository } from './work-category-repository.js';

/**
 * 勤務区分と申請種別の一括投入。
 *
 * 導入時にいちばん数が多いのがこの 2 つ。1 件ずつでは、初期設定だけで
 * 数時間かかり、途中で間違えても差分が分からない。
 *
 * 1 行でも読めなければ 1 行も取り込まない。途中まで入った状態を残すと、
 * 何が入って何が入らなかったのかを人が数え直すことになる。
 *
 * 列は画面の表と同じ名前にする。画面から出した CSV を、そのまま戻せる形に保つ。
 */

/** 一度に取り込める行数。設定の数は多くても数百で、それを超えるのは入力の誤り。 */
export const MAXIMUM_SETTING_ROWS = 500;

export interface SettingsImportRepositories {
  categories: WorkCategoryRepository;
  requests: RequestRepository;
  audit: AuditRepository;
}

export interface SettingsImportDependencies {
  transaction<T>(fn: (repositories: SettingsImportRepositories) => Promise<T>): Promise<T>;
}

export interface SettingsImportService {
  importWorkCategories(context: AuthenticatedContext, text: string): Promise<ImportResult>;
  importRequestTypes(context: AuthenticatedContext, text: string): Promise<ImportResult>;
}

interface Problem {
  line: number;
  message: string;
}

const WORK_CATEGORY_COLUMNS = [
  'code',
  'internal_name',
  'display_name',
  'category_type',
  'effective_from',
] as const;

const REQUEST_TYPE_COLUMNS = ['code', 'name', 'category', 'approval_steps'] as const;

const WORK_CATEGORY_TYPE_VALUES: readonly WorkCategoryType[] = [
  'working_day',
  'non_working_day',
  'legal_holiday',
  'leave',
  'absence',
];

const REQUEST_CATEGORY_VALUES: readonly RequestCategory[] = [
  'leave',
  'overtime',
  'holiday_work',
  'attendance_correction',
  'other',
];

/** 「9:00」または分数そのもの。空欄は未設定。 */
function minutesOf(value: string | undefined): number | null | 'invalid' {
  if (value === undefined || value.trim().length === 0) return null;
  const clock = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 0 ? minutes : 'invalid';
}

function booleanOf(value: string | undefined, fallback: boolean): boolean | 'invalid' {
  if (value === undefined || value.trim().length === 0) return fallback;
  const text = value.trim().toLowerCase();
  if (text === 'true' || text === '1') return true;
  if (text === 'false' || text === '0') return false;
  return 'invalid';
}

function requireHeader(header: readonly string[], required: readonly string[]): void {
  const missing = required.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    throw invalidRequest([
      { field: 'header', message: `見出しに ${missing.join(', ')} が必要です` },
    ]);
  }
}

function rejectIfProblems(problems: readonly Problem[]): void {
  if (problems.length === 0) return;
  throw new ApiError(
    'invalid_request',
    '取り込めない行があるため、1 行も取り込みませんでした',
    problems.map((problem) => ({ field: `line:${problem.line}`, message: problem.message })),
  );
}

export function createSettingsImportService(
  deps: SettingsImportDependencies,
): SettingsImportService {
  const requireManager = (
    context: AuthenticatedContext,
    permission: 'employee.manage' | 'request.manage',
  ): void => {
    if (!hasPermission(context.roles, permission)) throw forbidden();
  };

  return {
    async importWorkCategories(context, text) {
      requireManager(context, 'employee.manage');
      const parsed = parseCsv(text);
      requireHeader(parsed.header, WORK_CATEGORY_COLUMNS);
      if (parsed.rows.length > MAXIMUM_SETTING_ROWS) {
        throw invalidRequest([
          { field: 'rows', message: `一度に取り込めるのは ${MAXIMUM_SETTING_ROWS} 行までです` },
        ]);
      }

      const problems: Problem[] = parsed.problems.map((problem) => ({
        line: problem.line,
        message: problem.message,
      }));
      const planned: CreateWorkCategoryRequest[] = [];

      for (const [index, row] of parsed.rows.entries()) {
        const line = index + 2;
        const categoryType = row.category_type ?? '';
        const start = minutesOf(row.scheduled_start);
        const end = minutesOf(row.scheduled_end);

        if (!WORK_CATEGORY_TYPE_VALUES.includes(categoryType as WorkCategoryType)) {
          problems.push({ line, message: `種別 ${categoryType} は使えません` });
          continue;
        }
        if (!isBusinessDate(row.effective_from ?? '')) {
          problems.push({ line, message: '適用開始日の形式が正しくありません' });
          continue;
        }
        if (start === 'invalid' || end === 'invalid') {
          problems.push({ line, message: '所定の時刻は 9:00 の形か、分数で書いてください' });
          continue;
        }
        const shift = booleanOf(row.shift, false);
        const countsAsWorkingDay = booleanOf(row.counts_as_working_day, true);
        if (shift === 'invalid' || countsAsWorkingDay === 'invalid') {
          problems.push({ line, message: '真偽の欄は true か false で書いてください' });
          continue;
        }

        planned.push({
          code: row.code ?? '',
          internalName: row.internal_name ?? '',
          displayName: row.display_name ?? '',
          categoryType: categoryType as WorkCategoryType,
          effectiveFrom: row.effective_from ?? '',
          ...(row.effective_to && row.effective_to.length > 0
            ? { effectiveTo: row.effective_to }
            : {}),
          ...(start === null ? {} : { scheduledStartMinutes: start }),
          ...(end === null ? {} : { scheduledEndMinutes: end }),
          shift,
          countsAsWorkingDay,
        });
      }

      rejectIfProblems(problems);

      return deps.transaction(async ({ categories, audit }) => {
        for (const [index, input] of planned.entries()) {
          try {
            await categories.createWorkCategory(context.workspace.id, input);
          } catch (error) {
            // 制約の違反はトランザクション全体を中断させる。捕まえて続けられない。
            throw translate(error, index + 2, input.code);
          }
        }

        await audit.record(context.workspace.id, {
          actorKind: 'user',
          actorUserId: context.user.id,
          action: 'work_category.imported',
          targetType: 'workspace',
          targetId: context.workspace.id,
          summary: `勤務区分を ${planned.length} 件取り込みました`,
          detail: { rows: planned.length },
        });
        return { created: planned.length, problems: [] };
      });
    },

    async importRequestTypes(context, text) {
      requireManager(context, 'request.manage');
      const parsed = parseCsv(text);
      requireHeader(parsed.header, REQUEST_TYPE_COLUMNS);
      if (parsed.rows.length > MAXIMUM_SETTING_ROWS) {
        throw invalidRequest([
          { field: 'rows', message: `一度に取り込めるのは ${MAXIMUM_SETTING_ROWS} 行までです` },
        ]);
      }

      const problems: Problem[] = parsed.problems.map((problem) => ({
        line: problem.line,
        message: problem.message,
      }));
      const planned: CreateRequestTypeRequest[] = [];

      for (const [index, row] of parsed.rows.entries()) {
        const line = index + 2;
        const category = row.category ?? '';
        const steps = Number(row.approval_steps);

        if (!REQUEST_CATEGORY_VALUES.includes(category as RequestCategory)) {
          problems.push({ line, message: `区分 ${category} は使えません` });
          continue;
        }
        if (!Number.isInteger(steps) || steps < 1 || steps > 4) {
          problems.push({ line, message: '承認の段数は 1〜4 で書いてください' });
          continue;
        }
        const flags = {
          requiresReason: booleanOf(row.requires_reason, true),
          requiresLeaveType: booleanOf(row.requires_leave_type, category === 'leave'),
          requiresTimeRange: booleanOf(row.requires_time_range, false),
          requiresOvertimeLimit: booleanOf(row.requires_overtime_limit, false),
        };
        if (Object.values(flags).includes('invalid')) {
          problems.push({ line, message: '真偽の欄は true か false で書いてください' });
          continue;
        }
        if (category === 'leave' && flags.requiresLeaveType !== true) {
          problems.push({
            line,
            message: '休暇の申請は、休暇種別を必須にしないと台帳へ反映できません',
          });
          continue;
        }

        planned.push({
          code: row.code ?? '',
          name: row.name ?? '',
          category: category as RequestCategory,
          approvalSteps: steps,
          ...(flags as Record<string, boolean>),
        } as CreateRequestTypeRequest);
      }

      rejectIfProblems(problems);

      return deps.transaction(async ({ requests, audit }) => {
        for (const [index, input] of planned.entries()) {
          try {
            await requests.createRequestType(context.workspace.id, input);
          } catch (error) {
            throw translate(error, index + 2, input.code);
          }
        }

        await audit.record(context.workspace.id, {
          actorKind: 'user',
          actorUserId: context.user.id,
          action: 'request_type.imported',
          targetType: 'workspace',
          targetId: context.workspace.id,
          summary: `申請種別を ${planned.length} 件取り込みました`,
          detail: { rows: planned.length },
        });
        return { created: planned.length, problems: [] };
      });
    },
  };
}

/** DB が断った理由を、行の位置つきで返せる失敗へ言い換える。 */
function translate(error: unknown, line: number, code: string): ApiError {
  if (isUniqueViolation(error)) {
    return new ApiError('conflict', `${line} 行目: ${code} はすでにあります`);
  }
  return new ApiError(
    'invalid_request',
    `${line} 行目: ${error instanceof Error ? error.message : '取り込めませんでした'}`,
  );
}
