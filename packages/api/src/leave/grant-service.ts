import type {
  CreateLeaveGrantRuleRequest,
  GrantLeaveInBulkRequest,
  GrantLeaveInBulkResponse,
  ImportResult,
  LeaveExpirationRecord,
  LeaveGrantPreview,
  LeaveGrantRuleRecord,
  LeaveGrantRunRecord,
  LeaveRegisterRecord,
} from '@staffweave/contracts';
import {
  buildLeaveBalance,
  hasPermission,
  isBusinessDate,
  parseCsv,
  planLeaveGrants,
  summarizeLeaveRegister,
} from '@staffweave/domain';
import type { AuditRepository } from '../audit/repository.js';
import type { AuthenticatedContext } from '../identity/service.js';
import { isUniqueViolation } from '../shared/database-errors.js';
import type { EmployeeVisibilityGuard } from '../shared/employee-visibility.js';
import { ApiError, forbidden, invalidRequest, notFound } from '../shared/errors.js';
import type { LeaveGrantScheduler } from './grant-scheduler.js';
import type { LeaveRepository } from './repository.js';
import { expiryOf } from './service.js';

/**
 * 休暇の一括付与、CSV での取込、失効予定、休暇管理簿。
 *
 * 付与する分数は事業者が決める。規則を置かないかぎり 1 分も付与しない。
 *
 * 一括の処理は「何を積み、何を積まなかったか」を必ず返す。
 * 積まなかった相手を黙って飛ばすと、付与漏れに誰も気付けない。
 */

/** 一度に取り込める行数。1 回の要求で数万行を受けると、応答が返らなくなる。 */
export const MAXIMUM_IMPORT_ROWS = 2_000;

/** 画面へ返す実行の記録の件数。追いつきで日が並ぶため、直近だけを返す。 */
const RUN_HISTORY_LIMIT = 50;

export interface LeaveGrantRepositories {
  leave: LeaveRepository;
  audit: AuditRepository;
}

export interface LeaveGrantServiceDependencies {
  repository: LeaveRepository;
  visibility: EmployeeVisibilityGuard;
  now: () => Date;
  transaction<T>(fn: (repositories: LeaveGrantRepositories) => Promise<T>): Promise<T>;
  /**
   * 自動付与の実行。定期実行と同じ実装を、画面からも呼べるようにする。
   * 別々に持つと、画面から動かしたときだけ違う結果になる。
   */
  scheduler: LeaveGrantScheduler;
}

export interface LeaveGrantService {
  listRules(context: AuthenticatedContext, leaveTypeId?: string): Promise<LeaveGrantRuleRecord[]>;
  /** 自動付与を処理した日。管理の画面が「いつ、何件」を出すために読む。 */
  listRuns(context: AuthenticatedContext, leaveTypeId: string): Promise<LeaveGrantRunRecord[]>;
  /** 次に対象となる日と人数。処理はしない。 */
  previewRuns(context: AuthenticatedContext, leaveTypeId: string): Promise<LeaveGrantPreview>;
  /** 自動付与を、いまの時点で動かす。定期実行と同じ処理を手で呼ぶ。 */
  runNow(context: AuthenticatedContext): Promise<LeaveGrantRunRecord[]>;
  createRule(
    context: AuthenticatedContext,
    input: CreateLeaveGrantRuleRequest,
  ): Promise<LeaveGrantRuleRecord>;
  grantInBulk(
    context: AuthenticatedContext,
    input: GrantLeaveInBulkRequest,
  ): Promise<GrantLeaveInBulkResponse>;
  importCsv(context: AuthenticatedContext, text: string): Promise<ImportResult>;
  listExpirations(
    context: AuthenticatedContext,
    query: { asOf: string; through: string; employeeId?: string },
  ): Promise<LeaveExpirationRecord[]>;
  listRegister(
    context: AuthenticatedContext,
    query: { from: string; to: string; employeeId?: string },
  ): Promise<LeaveRegisterRecord[]>;
}

const IMPORT_COLUMNS = ['employee_number', 'leave_type_code', 'minutes', 'effective_on'] as const;

function requireDate(value: string, field: string): string {
  if (!isBusinessDate(value)) {
    throw invalidRequest([{ field, message: '日付の形式が正しくありません' }]);
  }
  return value;
}

export function createLeaveGrantService(deps: LeaveGrantServiceDependencies): LeaveGrantService {
  const requireLeaveManager = (context: AuthenticatedContext): void => {
    if (!hasPermission(context.roles, 'leave.manage')) throw forbidden();
  };

  return {
    async listRules(context, leaveTypeId) {
      requireLeaveManager(context);
      return deps.repository.listGrantRules(context.workspace.id, leaveTypeId);
    },

    async listRuns(context, leaveTypeId) {
      requireLeaveManager(context);
      return deps.repository.listGrantRuns(context.workspace.id, leaveTypeId, RUN_HISTORY_LIMIT);
    },

    async previewRuns(context, leaveTypeId) {
      requireLeaveManager(context);
      const leaveType = await deps.repository.findLeaveType(context.workspace.id, leaveTypeId);
      if (!leaveType) throw notFound('休暇種別');

      const preview = await deps.scheduler.preview(context.workspace.id, leaveTypeId);
      // 対象の日が無いことは失敗ではない。まだ来ていないだけ。
      return preview === null
        ? { leaveTypeId, effectiveOn: null, grantedCount: 0, skippedCount: 0 }
        : {
            leaveTypeId,
            effectiveOn: preview.effectiveOn,
            grantedCount: preview.grantedCount,
            skippedCount: preview.skippedCount,
          };
    },

    async runNow(context) {
      requireLeaveManager(context);
      const summaries = await deps.scheduler.run();
      return summaries
        .filter((summary) => summary.workspaceId === context.workspace.id)
        .map((summary) => ({
          leaveTypeId: summary.leaveTypeId,
          effectiveOn: summary.effectiveOn,
          ranAt: deps.now().toISOString(),
          grantedCount: summary.grantedCount,
          skippedCount: summary.skippedCount,
        }));
    },

    async createRule(context, input) {
      requireLeaveManager(context);
      return deps.transaction(async ({ leave, audit }) => {
        const leaveType = await leave.findLeaveType(context.workspace.id, input.leaveTypeId);
        if (!leaveType) throw notFound('休暇種別');

        let created: LeaveGrantRuleRecord;
        try {
          created = await leave.createGrantRule(context.workspace.id, input);
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new ApiError('conflict', `勤続 ${input.serviceMonths} か月の段はすでにあります`);
          }
          throw error;
        }

        await audit.record(context.workspace.id, {
          actorKind: 'user',
          actorUserId: context.user.id,
          action: 'leave_grant_rule.created',
          targetType: 'leave_grant_rule',
          targetId: created.id,
          summary: `${leaveType.code} に勤続 ${input.serviceMonths} か月で ${input.minutes} 分の段を置きました`,
          detail: { ...input },
        });
        return created;
      });
    },

    async grantInBulk(context, input) {
      requireLeaveManager(context);
      const effectiveOn = requireDate(input.effectiveOn, 'effectiveOn');

      return deps.transaction(async ({ leave, audit }) => {
        const leaveType = await leave.findLeaveType(context.workspace.id, input.leaveTypeId);
        if (!leaveType) throw notFound('休暇種別');
        if (!leaveType.active) {
          throw new ApiError('conflict', `休暇種別 ${leaveType.code} はいま使えません`);
        }

        const rules = await leave.listGrantRules(context.workspace.id, input.leaveTypeId);
        const candidates = await leave.listGrantCandidates(context.workspace.id, {
          ...(input.organizationId === undefined ? {} : { organizationId: input.organizationId }),
        });
        // 付与できるのは休暇を扱える利用者だけで、その範囲はワークスペース全体。
        // 1 件ずつの付与（grantLeave）と同じ境界にする。片方だけ狭めると、
        // 同じことが経路によってできたりできなかったりする。
        const plan = planLeaveGrants({
          basis: input.basis,
          effectiveOn,
          rules,
          candidates: candidates.map((employee) => ({
            employeeId: employee.id,
            hiredOn: employee.hiredOn,
          })),
        });

        const skipped: GrantLeaveInBulkResponse['skipped'] = [...plan.skipped];
        const granted: GrantLeaveInBulkResponse['granted'] = [];

        const expiresOn = expiryOf(effectiveOn, leaveType.expiresAfterMonths);

        // すでに付与されている相手を先に読む。制約の違反を捕まえて続けることはできない。
        // PostgreSQL では、違反した時点でトランザクション全体が中断する。
        // 同時に届いた二度目の要求は、この読み取りを擦り抜けても制約が止める。
        const already = await leave.listBulkGrantedEmployees(
          context.workspace.id,
          input.leaveTypeId,
          effectiveOn,
        );

        for (const target of plan.grants) {
          if (already.has(target.employeeId)) {
            skipped.push({ employeeId: target.employeeId, reason: 'already_granted' });
            continue;
          }
          await leave.addEntry(context.workspace.id, {
            employeeId: target.employeeId,
            leaveTypeId: input.leaveTypeId,
            entryType: 'grant',
            minutes: target.minutes,
            effectiveOn,
            expiresOn,
            reason: `勤続 ${target.serviceMonths} か月による付与`,
            createdByUserId: context.user.id,
            source: 'rule',
          });
          granted.push(target);
        }

        await audit.record(context.workspace.id, {
          actorKind: 'user',
          actorUserId: context.user.id,
          action: 'leave_ledger.bulk_granted',
          targetType: 'leave_type',
          targetId: input.leaveTypeId,
          summary: `${effectiveOn} に ${leaveType.code} を ${granted.length} 名へ付与しました`,
          detail: {
            basis: input.basis,
            effectiveOn,
            grantedCount: granted.length,
            skippedCount: skipped.length,
          },
        });

        return { granted, skipped };
      });
    },

    async importCsv(context, text) {
      requireLeaveManager(context);
      const parsed = parseCsv(text);

      const missing = IMPORT_COLUMNS.filter((column) => !parsed.header.includes(column));
      if (missing.length > 0) {
        throw invalidRequest([
          { field: 'header', message: `見出しに ${missing.join(', ')} が必要です` },
        ]);
      }
      if (parsed.rows.length > MAXIMUM_IMPORT_ROWS) {
        throw invalidRequest([
          { field: 'rows', message: `一度に取り込めるのは ${MAXIMUM_IMPORT_ROWS} 行までです` },
        ]);
      }

      // 形の壊れた行が 1 つでもあれば、何も取り込まない。
      // 途中まで入った状態を残すと、何が入って何が入らなかったのかを人が数え直すことになる。
      const problems = parsed.problems.map((problem) => ({
        line: problem.line,
        message: problem.message,
      }));

      return deps.transaction(async ({ leave, audit }) => {
        const leaveTypes = await leave.listLeaveTypes(context.workspace.id);
        const typeByCode = new Map(leaveTypes.map((type) => [type.code, type]));
        const numbers = parsed.rows.map((row) => row.employee_number ?? '');
        const employeeIds = await leave.findEmployeeIdsByNumber(context.workspace.id, numbers);

        interface Planned {
          line: number;
          employeeId: string;
          leaveTypeId: string;
          minutes: number;
          effectiveOn: string;
          expiresOn: string | null;
          reason: string | null;
        }
        const planned: Planned[] = [];

        for (const [index, row] of parsed.rows.entries()) {
          const line = index + 2;
          const employeeId = employeeIds.get(row.employee_number ?? '');
          const leaveType = typeByCode.get(row.leave_type_code ?? '');
          const minutes = Number(row.minutes);
          const effectiveOn = row.effective_on ?? '';

          if (employeeId === undefined) {
            problems.push({
              line,
              message: `従業員番号 ${row.employee_number ?? ''} が見つかりません`,
            });
            continue;
          }
          if (leaveType === undefined) {
            problems.push({
              line,
              message: `休暇種別 ${row.leave_type_code ?? ''} が見つかりません`,
            });
            continue;
          }
          if (!Number.isInteger(minutes) || minutes < 1) {
            problems.push({ line, message: '分数は 1 以上の整数で書いてください' });
            continue;
          }
          if (!isBusinessDate(effectiveOn)) {
            problems.push({ line, message: '付与日の形式が正しくありません' });
            continue;
          }
          const expiresOn =
            row.expires_on !== undefined && row.expires_on.length > 0
              ? row.expires_on
              : expiryOf(effectiveOn, leaveType.expiresAfterMonths);
          if (expiresOn !== null && (!isBusinessDate(expiresOn) || expiresOn < effectiveOn)) {
            problems.push({ line, message: '失効日は付与日以降の日付で書いてください' });
            continue;
          }

          planned.push({
            line,
            employeeId,
            leaveTypeId: leaveType.id,
            minutes,
            effectiveOn,
            expiresOn,
            reason: row.reason && row.reason.length > 0 ? row.reason : null,
          });
        }

        if (problems.length > 0) {
          // 何も入れずに返す。ここで例外を投げるとトランザクションが巻き戻り、
          // それまでに積んだ行も残らない。
          throw new ApiError(
            'invalid_request',
            '取り込めない行があるため、1 行も取り込みませんでした',
            problems.map((problem) => ({
              field: `line:${problem.line}`,
              message: problem.message,
            })),
          );
        }

        for (const row of planned) {
          try {
            await leave.addEntry(context.workspace.id, {
              employeeId: row.employeeId,
              leaveTypeId: row.leaveTypeId,
              entryType: 'grant',
              minutes: row.minutes,
              effectiveOn: row.effectiveOn,
              expiresOn: row.expiresOn,
              reason: row.reason,
              createdByUserId: context.user.id,
              source: 'import',
            });
          } catch (error) {
            if (isUniqueViolation(error)) {
              throw new ApiError(
                'conflict',
                `${row.line} 行目は、同じ従業員・同じ休暇種別・同じ日にすでに付与があります`,
              );
            }
            throw error;
          }
        }

        await audit.record(context.workspace.id, {
          actorKind: 'user',
          actorUserId: context.user.id,
          action: 'leave_ledger.imported',
          targetType: 'workspace',
          targetId: context.workspace.id,
          summary: `休暇の付与を ${planned.length} 行取り込みました`,
          detail: { rows: planned.length },
        });

        return { created: planned.length, problems: [] };
      });
    },

    async listExpirations(context, query) {
      const asOf = requireDate(query.asOf, 'asOf');
      const through = requireDate(query.through, 'through');
      if (through < asOf) {
        throw invalidRequest([{ field: 'through', message: '終了日は開始日以降にしてください' }]);
      }

      const employees = await targets(context, query.employeeId);
      const entries = await deps.repository.listEntriesForEmployees(
        context.workspace.id,
        employees.map((employee) => employee.id),
      );

      const expirations: LeaveExpirationRecord[] = [];
      for (const employee of employees) {
        const byType = groupByLeaveType(entries.get(employee.id) ?? []);
        for (const [leaveTypeId, typeEntries] of byType) {
          const balance = buildLeaveBalance(typeEntries, asOf);
          for (const bucket of balance.remaining) {
            if (bucket.expiresOn === null || bucket.minutes <= 0) continue;
            if (bucket.expiresOn < asOf || bucket.expiresOn > through) continue;
            expirations.push({
              employeeId: employee.id,
              employeeNumber: employee.employeeNumber,
              leaveTypeId,
              entryId: bucket.entryId,
              expiresOn: bucket.expiresOn,
              remainingMinutes: bucket.minutes,
            });
          }
        }
      }
      return expirations.sort((left, right) => left.expiresOn.localeCompare(right.expiresOn));
    },

    async listRegister(context, query) {
      const from = requireDate(query.from, 'from');
      const to = requireDate(query.to, 'to');
      if (to < from) {
        throw invalidRequest([{ field: 'to', message: '終了日は開始日以降にしてください' }]);
      }

      const employees = await targets(context, query.employeeId);
      const entries = await deps.repository.listEntriesForEmployees(
        context.workspace.id,
        employees.map((employee) => employee.id),
      );

      const register: LeaveRegisterRecord[] = [];
      for (const employee of employees) {
        const byType = groupByLeaveType(entries.get(employee.id) ?? []);
        for (const [leaveTypeId, typeEntries] of byType) {
          register.push({
            employeeId: employee.id,
            employeeNumber: employee.employeeNumber,
            leaveTypeId,
            from,
            to,
            ...summarizeLeaveRegister(typeEntries, from, to),
          });
        }
      }
      return register;
    },
  };

  /**
   * 読み出しの対象になる従業員。指定が無ければ、閲覧できる在籍者すべて。
   *
   * 名指しの相手が範囲の外なら、空の結果ではなく 403 を返す。
   * 空を返すと「その人には休暇が無い」と読めてしまう。
   */
  async function targets(
    context: AuthenticatedContext,
    employeeId?: string,
  ): Promise<{ id: string; employeeNumber: string; hiredOn: string | null }[]> {
    const candidates = await deps.repository.listGrantCandidates(context.workspace.id, {});
    if (employeeId !== undefined) {
      const selected = candidates.filter((employee) => employee.id === employeeId);
      if (selected.length === 0) throw notFound('従業員');
      await deps.visibility.requireVisibleEmployee(context, employeeId);
      return selected;
    }
    return deps.visibility.filterVisible(context, candidates, (employee) => employee.id);
  }
}

function groupByLeaveType<T extends { leaveTypeId: string }>(
  entries: readonly T[],
): Map<string, T[]> {
  const byType = new Map<string, T[]>();
  for (const entry of entries) {
    const list = byType.get(entry.leaveTypeId) ?? [];
    list.push(entry);
    byType.set(entry.leaveTypeId, list);
  }
  return byType;
}
