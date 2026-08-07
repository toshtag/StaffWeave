/**
 * 休暇の自動付与。
 *
 * 管理者が押す一括付与とは別の機能として置く。押す側は「いまこの日で付与する」
 * という操作で、こちらは「決めた基準に従って毎日確かめる」処理。
 * 片方へ寄せると、押し忘れた日は誰も付与されないまま過ぎる。
 *
 * 止まることを前提にする。止まっていた期間は、次に動いたときに日ごとに
 * 追いつく。追いつきで同じ日を二度処理しないことは、実行の記録が担保する。
 *
 * 日の境界はワークスペースの時間帯で決める。動かす機械の時計で決めると、
 * 同じ設定でも置いた場所によって付与される日がずれる。
 */

import type { LeaveTypeSettingsRecord } from '@staffweave/contracts';
import type { BusinessDate } from '@staffweave/domain';
import { businessDateOf, leaveGrantDatesBetween, planLeaveGrants } from '@staffweave/domain';
import type { AuditRepository } from '../audit/repository.js';
import type { StructuredLogger } from '../shared/logger.js';
import type { LeaveRepository } from './repository.js';
import { expiryOf } from './service.js';

export interface LeaveGrantSchedulerRepositories {
  leave: LeaveRepository;
  audit: AuditRepository;
}

/** 1 つのワークスペースを処理するために要る情報。 */
export interface ScheduledWorkspace {
  id: string;
  slug: string;
  timeZone: string;
}

export interface LeaveGrantSchedulerDependencies {
  /** 対象のワークスペース。自分で建てた環境では 1 つのことが多い。 */
  listWorkspaces(): Promise<ScheduledWorkspace[]>;
  now(): Date;
  transaction<T>(fn: (repositories: LeaveGrantSchedulerRepositories) => Promise<T>): Promise<T>;
  logger?: StructuredLogger;
  /**
   * 一度に追いつく日数の上限。
   *
   * 長く止まっていた環境で、1 回の実行が何年ぶんも回り続けるのを防ぐ。
   * 上限に当たった場合は、その日までを処理して次の実行へ残す。
   */
  maximumCatchUpDays?: number;
}

export interface LeaveGrantRunSummary {
  workspaceId: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  effectiveOn: string;
  grantedCount: number;
  skippedCount: number;
}

export interface LeaveGrantScheduler {
  /**
   * 1 つのワークスペースの、今日までの未処理の日を古い順に処理する。
   *
   * 対象を必ず受け取る。全てを回す入口と同じ関数にすると、要求から呼んだ
   * ときに、要求とは関係のないワークスペースの台帳まで動く。
   */
  runFor(workspaceId: string): Promise<LeaveGrantRunSummary[]>;
  /**
   * 全てのワークスペースを処理する。
   *
   * 使うのは定期実行の command だけ。自分で建てた環境では 1 つのことが
   * 多いが、複数ある環境で 1 つの要求が全部を動かしてよい理由は無い。
   */
  runAll(): Promise<LeaveGrantRunSummary[]>;
  /**
   * 処理せずに、次に対象となる日と人数だけを出す。
   *
   * 管理の画面が「次は誰に何分」を見せるために使う。
   * 見せずに動かすと、設定を間違えたことに付与された後で気付く。
   */
  preview(workspaceId: string, leaveTypeId: string): Promise<LeaveGrantRunSummary | null>;
}

/** 既定の追いつき上限。1 年ぶんを 1 回で処理できれば足りる。 */
export const DEFAULT_MAXIMUM_CATCH_UP_DAYS = 400;

function addDays(date: BusinessDate, days: number): BusinessDate {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10) as BusinessDate;
}

export function createLeaveGrantScheduler(
  deps: LeaveGrantSchedulerDependencies,
): LeaveGrantScheduler {
  const maximumCatchUpDays = deps.maximumCatchUpDays ?? DEFAULT_MAXIMUM_CATCH_UP_DAYS;

  /**
   * その休暇種別で、これから処理すべき日を古い順に返す。
   *
   * 起点は「最後に処理した日の翌日」。一度も処理していなければ、
   * 有効にしたときに決めた開始日。入社日まで遡ることはしない。
   */
  const pendingDatesOf = async (
    repositories: LeaveGrantSchedulerRepositories,
    workspaceId: string,
    leaveType: LeaveTypeSettingsRecord,
    today: BusinessDate,
  ): Promise<BusinessDate[]> => {
    if (leaveType.grantBasis === null || leaveType.autoGrantFrom === null) return [];

    const last = await repositories.leave.findLastGrantRun(workspaceId, leaveType.id);
    const from = last === null ? leaveType.autoGrantFrom : addDays(last as BusinessDate, 1);
    if (from > today) return [];

    const through = addDays(from as BusinessDate, maximumCatchUpDays - 1);
    return leaveGrantDatesBetween({
      basis: leaveType.grantBasis,
      from: from as BusinessDate,
      through: through < today ? through : today,
      fixedMonth: leaveType.grantFixedMonth,
      fixedDay: leaveType.grantFixedDay,
    });
  };

  /**
   * 1 日ぶんを処理する。
   *
   * 付与と実行の記録を同じトランザクションへ入れる。分けると、付与だけが
   * 残って記録が無い状態を作り、次の実行が同じ日をもう一度付与する。
   */
  const runDay = async (
    repositories: LeaveGrantSchedulerRepositories,
    workspace: ScheduledWorkspace,
    leaveType: LeaveTypeSettingsRecord,
    effectiveOn: BusinessDate,
  ): Promise<LeaveGrantRunSummary | null> => {
    const { leave, audit } = repositories;

    // 先にその日を取る。取れなければ、他の実行がすでに取っている。
    // 付与してから記録する順にすると、二度目は制約で落ちるまで付与を積む
    // ことになり、落ちる位置に結果が左右される。
    if (!(await leave.claimGrantRun(workspace.id, leaveType.id, effectiveOn))) return null;

    const rules = await leave.listGrantRules(workspace.id, leaveType.id);
    const candidates = await leave.listGrantCandidates(workspace.id, {});
    const plan = planLeaveGrants({
      basis: leaveType.grantBasis ?? 'fixed_date',
      effectiveOn,
      rules,
      candidates: candidates.map((employee) => ({
        employeeId: employee.id,
        hiredOn: employee.hiredOn,
      })),
    });

    const already = await leave.listBulkGrantedEmployees(workspace.id, leaveType.id, effectiveOn);
    const expiresOn = expiryOf(effectiveOn, leaveType.expiresAfterMonths);

    let grantedCount = 0;
    let skippedCount = plan.skipped.length;

    for (const target of plan.grants) {
      if (already.has(target.employeeId)) {
        skippedCount += 1;
        continue;
      }
      await leave.addEntry(workspace.id, {
        employeeId: target.employeeId,
        leaveTypeId: leaveType.id,
        entryType: 'grant',
        minutes: target.minutes,
        effectiveOn,
        expiresOn,
        reason: `勤続 ${target.serviceMonths} か月による自動付与`,
        createdByUserId: null,
        source: 'rule',
      });
      grantedCount += 1;
    }

    await leave.recordGrantRunCounts(workspace.id, {
      leaveTypeId: leaveType.id,
      effectiveOn,
      grantedCount,
      skippedCount,
    });

    await audit.record(workspace.id, {
      actorKind: 'system',
      actorUserId: null,
      action: 'leave_ledger.auto_granted',
      targetType: 'leave_type',
      targetId: leaveType.id,
      summary: `${effectiveOn} に ${leaveType.code} を ${grantedCount} 名へ自動付与しました`,
      detail: {
        basis: leaveType.grantBasis,
        effectiveOn,
        grantedCount,
        skippedCount,
        // 積まなかった理由は件数で残す。誰を飛ばしたかは台帳の側から辿れる。
        skippedReasons: plan.skipped.reduce<Record<string, number>>((counts, entry) => {
          counts[entry.reason] = (counts[entry.reason] ?? 0) + 1;
          return counts;
        }, {}),
      },
    });

    return {
      workspaceId: workspace.id,
      leaveTypeId: leaveType.id,
      leaveTypeCode: leaveType.code,
      effectiveOn,
      grantedCount,
      skippedCount,
    };
  };

  /** 1 つのワークスペースの未処理の日を、古い順に処理する。 */
  const runWorkspace = async (workspace: ScheduledWorkspace): Promise<LeaveGrantRunSummary[]> => {
    const summaries: LeaveGrantRunSummary[] = [];
    const today = businessDateOf(deps.now(), workspace.timeZone);
    const leaveTypes = await deps.transaction(({ leave }) =>
      leave.listAutoGrantLeaveTypes(workspace.id),
    );

    for (const leaveType of leaveTypes) {
      const dates = await deps.transaction((repositories) =>
        pendingDatesOf(repositories, workspace.id, leaveType, today),
      );

      for (const effectiveOn of dates) {
        // 日ごとにトランザクションを分ける。1 日が失敗しても、それより前の日の
        // 付与は残す。次の実行は失敗した日から続く。
        const summary = await deps.transaction((repositories) =>
          runDay(repositories, workspace, leaveType, effectiveOn),
        );
        if (summary === null) continue;
        summaries.push(summary);
        deps.logger?.info('leave.auto_granted', {
          workspace: workspace.slug,
          leaveType: leaveType.code,
          effectiveOn,
          granted: summary.grantedCount,
          skipped: summary.skippedCount,
        });
      }
    }
    return summaries;
  };

  return {
    async runFor(workspaceId) {
      const workspaces = await deps.listWorkspaces();
      const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
      if (workspace === undefined) return [];
      return runWorkspace(workspace);
    },

    async runAll() {
      const summaries: LeaveGrantRunSummary[] = [];
      for (const workspace of await deps.listWorkspaces()) {
        summaries.push(...(await runWorkspace(workspace)));
      }
      return summaries;
    },

    async preview(workspaceId, leaveTypeId) {
      return deps.transaction(async (repositories) => {
        const leaveType = await repositories.leave.findLeaveType(workspaceId, leaveTypeId);
        if (leaveType === null) return null;

        const workspaces = await deps.listWorkspaces();
        const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
        if (workspace === undefined) return null;

        const today = businessDateOf(deps.now(), workspace.timeZone);
        const dates = await pendingDatesOf(repositories, workspaceId, leaveType, today);
        const effectiveOn = dates[0];
        if (effectiveOn === undefined) return null;

        const rules = await repositories.leave.listGrantRules(workspaceId, leaveTypeId);
        const candidates = await repositories.leave.listGrantCandidates(workspaceId, {});
        const plan = planLeaveGrants({
          basis: leaveType.grantBasis ?? 'fixed_date',
          effectiveOn,
          rules,
          candidates: candidates.map((employee) => ({
            employeeId: employee.id,
            hiredOn: employee.hiredOn,
          })),
        });
        const already = await repositories.leave.listBulkGrantedEmployees(
          workspaceId,
          leaveTypeId,
          effectiveOn,
        );
        const grants = plan.grants.filter((target) => !already.has(target.employeeId));

        return {
          workspaceId,
          leaveTypeId,
          leaveTypeCode: leaveType.code,
          effectiveOn,
          grantedCount: grants.length,
          skippedCount: plan.skipped.length + (plan.grants.length - grants.length),
        };
      });
    },
  };
}
