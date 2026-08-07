import type {
  AdjustLeaveRequest,
  GrantLeaveRequest,
  LeaveBalanceRecord,
  LeaveLedgerEntryRecord,
  LeaveTypeSettingsRecord,
  ReverseLeaveEntryRequest,
  UpdateLeaveTypeRequest,
} from '@staffweave/contracts';
import {
  addMonthsToBusinessDate,
  buildLeaveBalance,
  businessDateOf,
  hasPermission,
  validateLeaveConsumption,
} from '@staffweave/domain';
import type { AuditRepository } from '../audit/repository.js';
import type { AuthenticatedContext } from '../identity/service.js';
import { isForeignKeyViolation, isUniqueViolation } from '../shared/database-errors.js';
import type { EmployeeVisibilityGuard } from '../shared/employee-visibility.js';
import { ApiError, forbidden, invalidRequest, notFound } from '../shared/errors.js';
import type { LeaveRepository } from './repository.js';

export interface LeaveRepositories {
  leave: LeaveRepository;
  audit: AuditRepository;
}

export interface LeaveServiceDependencies {
  repository: LeaveRepository;
  visibility: EmployeeVisibilityGuard;
  now: () => Date;
  transaction<T>(fn: (repositories: LeaveRepositories) => Promise<T>): Promise<T>;
}

export interface LeaveService {
  listLeaveTypes(context: AuthenticatedContext): Promise<LeaveTypeSettingsRecord[]>;
  updateLeaveType(
    context: AuthenticatedContext,
    leaveTypeId: string,
    input: UpdateLeaveTypeRequest,
  ): Promise<LeaveTypeSettingsRecord>;
  listLedger(
    context: AuthenticatedContext,
    query: { employeeId: string; leaveTypeId?: string },
  ): Promise<LeaveLedgerEntryRecord[]>;
  listBalances(
    context: AuthenticatedContext,
    query: { employeeId: string; asOf?: string },
  ): Promise<LeaveBalanceRecord[]>;
  grant(context: AuthenticatedContext, input: GrantLeaveRequest): Promise<LeaveLedgerEntryRecord>;
  adjust(context: AuthenticatedContext, input: AdjustLeaveRequest): Promise<LeaveLedgerEntryRecord>;
  reverse(
    context: AuthenticatedContext,
    entryId: string,
    input: ReverseLeaveEntryRequest,
  ): Promise<LeaveLedgerEntryRecord>;
}

/**
 * 付与日から、休暇種別が決めた月数だけ進めた失効日。
 *
 * 月をまたぐ繰り上がりの丸めは業務日の側が持つ。清算期間の区切りと同じ規則で、
 * 月末の付与が翌月へずれないようにする。
 */
export function expiryOf(effectiveOn: string, months: number | null): string | null {
  if (months === null) return null;
  return addMonthsToBusinessDate(effectiveOn, months);
}

export function createLeaveService(deps: LeaveServiceDependencies): LeaveService {
  const requireLeaveManager = (context: AuthenticatedContext): void => {
    if (!hasPermission(context.roles, 'leave.manage')) throw forbidden();
  };

  /** 相手の台帳を見てよいか。本人か、閲覧範囲に入っている相手だけ。 */
  const requireVisible = async (
    context: AuthenticatedContext,
    employeeId: string,
  ): Promise<void> => {
    if (employeeId === context.employee?.id) return;
    await deps.visibility.requireVisibleEmployee(context, employeeId);
  };

  const balancesOf = async (
    workspaceId: string,
    employeeId: string,
    asOf: string,
  ): Promise<LeaveBalanceRecord[]> => {
    const entries = await deps.repository.listEntries(workspaceId, { employeeId });
    const byType = new Map<string, typeof entries>();
    for (const entry of entries) {
      byType.set(entry.leaveTypeId, [...(byType.get(entry.leaveTypeId) ?? []), entry]);
    }

    return [...byType.entries()].map(([leaveTypeId, typeEntries]) => {
      const balance = buildLeaveBalance(typeEntries, asOf);
      return {
        employeeId,
        leaveTypeId,
        asOf,
        availableMinutes: balance.availableMinutes,
        expiredMinutes: balance.expiredMinutes,
        remaining: balance.remaining,
      };
    });
  };

  return {
    async listLeaveTypes(context) {
      return deps.repository.listLeaveTypes(context.workspace.id);
    },

    async updateLeaveType(context, leaveTypeId, input) {
      requireLeaveManager(context);
      return deps.transaction(async ({ leave, audit }) => {
        const updated = await leave.updateLeaveType(context.workspace.id, leaveTypeId, input);
        if (!updated) throw notFound('休暇種別');

        await audit.record(context.workspace.id, {
          actorKind: 'user',
          actorUserId: context.user.id,
          action: 'leave_type.updated',
          targetType: 'leave_type',
          targetId: updated.id,
          summary: `休暇種別 ${updated.code} の設定を変えました`,
          detail: { ...input },
        });
        return updated;
      });
    },

    async listLedger(context, query) {
      await requireVisible(context, query.employeeId);
      return deps.repository.listEntries(context.workspace.id, query);
    },

    async listBalances(context, query) {
      await requireVisible(context, query.employeeId);
      // 「今日」は、ワークスペースの時間帯で決める。実行環境の時計の場所では決めない。
      const asOf = query.asOf ?? businessDateOf(deps.now(), context.workspace.timeZone);
      return balancesOf(context.workspace.id, query.employeeId, asOf);
    },

    async grant(context, input) {
      requireLeaveManager(context);

      return deps.transaction(async ({ leave, audit }) => {
        const leaveType = await leave.findLeaveType(context.workspace.id, input.leaveTypeId);
        if (!leaveType) throw notFound('休暇種別');

        // 失効日は、要求が明示していれば従い、なければ休暇種別の設定から決める。
        // 設定が無ければ失効させない。製品の既定値では決めない。
        const expiresOn =
          input.expiresOn ?? expiryOf(input.effectiveOn, leaveType.expiresAfterMonths);
        if (expiresOn !== null && expiresOn < input.effectiveOn) {
          throw invalidRequest([
            { field: 'expiresOn', message: '失効日は付与日より前にできません' },
          ]);
        }

        const entry = await insertOrTranslate(() =>
          leave.addEntry(context.workspace.id, {
            employeeId: input.employeeId,
            leaveTypeId: input.leaveTypeId,
            entryType: 'grant',
            minutes: input.minutes,
            effectiveOn: input.effectiveOn,
            expiresOn,
            reason: input.reason ?? null,
            createdByUserId: context.user.id,
          }),
        );

        await audit.record(context.workspace.id, {
          actorKind: 'user',
          actorUserId: context.user.id,
          action: 'leave_ledger.granted',
          targetType: 'leave_ledger_entry',
          targetId: entry.id,
          summary: `${input.effectiveOn} に ${input.minutes} 分の休暇を付与しました`,
          detail: {
            employeeId: input.employeeId,
            leaveTypeId: input.leaveTypeId,
            minutes: input.minutes,
            expiresOn,
          },
        });
        return entry;
      });
    },

    async adjust(context, input) {
      requireLeaveManager(context);

      return deps.transaction(async ({ leave, audit }) => {
        if (input.minutes === 0) {
          throw invalidRequest([{ field: 'minutes', message: '0 分の手当ては記録できません' }]);
        }
        const leaveType = await leave.findLeaveType(context.workspace.id, input.leaveTypeId);
        if (!leaveType) throw notFound('休暇種別');

        // 減らす手当ては、残数の範囲でしか受け付けない。
        // 負の残数を作れると、あとから帳尻を合わせる作業が要る。
        if (input.minutes < 0) {
          await leave.lockLedgerOf(context.workspace.id, input.employeeId);
          const entries = await leave.listEntries(context.workspace.id, {
            employeeId: input.employeeId,
            leaveTypeId: input.leaveTypeId,
          });
          const problems = validateLeaveConsumption({
            entries,
            minutes: -input.minutes,
            effectiveOn: input.effectiveOn,
            unitMinutes: null,
          });
          if (problems.includes('insufficient')) {
            const balance = buildLeaveBalance(entries, input.effectiveOn);
            throw new ApiError(
              'conflict',
              `残数が足りません（残り ${balance.availableMinutes} 分）`,
            );
          }
        }

        const entry = await insertOrTranslate(() =>
          leave.addEntry(context.workspace.id, {
            employeeId: input.employeeId,
            leaveTypeId: input.leaveTypeId,
            entryType: 'adjust',
            minutes: input.minutes,
            effectiveOn: input.effectiveOn,
            reason: input.reason,
            createdByUserId: context.user.id,
          }),
        );

        await audit.record(context.workspace.id, {
          actorKind: 'user',
          actorUserId: context.user.id,
          action: 'leave_ledger.adjusted',
          targetType: 'leave_ledger_entry',
          targetId: entry.id,
          summary: `${input.effectiveOn} の残数を ${input.minutes} 分だけ手当てしました`,
          detail: {
            employeeId: input.employeeId,
            leaveTypeId: input.leaveTypeId,
            minutes: input.minutes,
            reason: input.reason,
          },
        });
        return entry;
      });
    },

    async reverse(context, entryId, input) {
      requireLeaveManager(context);

      return deps.transaction(async ({ leave, audit }) => {
        const target = await leave.findEntry(context.workspace.id, entryId);
        if (!target) throw notFound('台帳の記録');
        if (target.entryType === 'reverse') {
          throw new ApiError('conflict', '取消の記録は取り消せません');
        }

        // 二度目の取消は DB の一意制約で止まる。
        // ここで先に読んで判断しても、同時に届いた要求は擦り抜ける。
        const entry = await insertOrTranslate(
          () =>
            leave.addEntry(context.workspace.id, {
              employeeId: target.employeeId,
              leaveTypeId: target.leaveTypeId,
              entryType: 'reverse',
              minutes: -target.minutes,
              effectiveOn: target.effectiveOn,
              reversesEntryId: target.id,
              reason: input.reason,
              createdByUserId: context.user.id,
            }),
          'この記録はすでに取り消されています',
        );

        await audit.record(context.workspace.id, {
          actorKind: 'user',
          actorUserId: context.user.id,
          action: 'leave_ledger.reversed',
          targetType: 'leave_ledger_entry',
          targetId: entry.id,
          summary: `${target.effectiveOn} の台帳の記録を取り消しました`,
          detail: {
            employeeId: target.employeeId,
            leaveTypeId: target.leaveTypeId,
            reversesEntryId: target.id,
            reason: input.reason,
          },
        });
        return entry;
      });
    },
  };
}

/**
 * DB の制約違反を、利用者へ返せる失敗へ言い換える。
 *
 * 制約は同時に届いた要求も止める。先に読んで判断するだけでは擦り抜ける。
 */
async function insertOrTranslate<T>(fn: () => Promise<T>, conflictMessage?: string): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError('conflict', conflictMessage ?? '同じ記録がすでにあります');
    }
    if (isForeignKeyViolation(error)) throw notFound('従業員か休暇種別');
    throw error;
  }
}
