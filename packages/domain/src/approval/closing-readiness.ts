/**
 * 締める前の確認。
 *
 * 締めは元に戻せる操作ではあるが、戻すたびに監査へ跡が残り、
 * 給与へ渡した値との食い違いを人が説明することになる。
 * 締める前に「何が残っているか」を並べ、押す前に気付けるようにする。
 *
 * ここは締めを止めない。止めるかどうかは運用が決める。
 * 製品が勝手に止めると、月末の締切に間に合わせるための例外を、
 * 製品の外（直接の SQL）でやることになる。
 */

export const CLOSING_FINDING_KINDS = [
  /** 出勤したのに退勤していない日。 */
  'open_work_day',
  /** 打刻はあるが申請していない日。 */
  'not_requested',
  /** 申請したが承認されていない日。 */
  'not_approved',
  /** 差し戻されたまま出し直していない日。 */
  'returned',
  /** 確認が必要と印の付いた日。 */
  'flagged',
] as const;

export type ClosingFindingKind = (typeof CLOSING_FINDING_KINDS)[number];

export type ClosingSeverity = 'blocking' | 'advisory';

export interface ClosingFinding {
  kind: ClosingFindingKind;
  severity: ClosingSeverity;
  businessDate: string;
}

/** 締める前に見る、1 日ぶんの状態。 */
export interface ClosingDayState {
  businessDate: string;
  /** 出勤したまま退勤していないか。 */
  open: boolean;
  /** 打刻が 1 つでもあるか。 */
  hasPunch: boolean;
  requestState: 'draft' | 'submitted' | 'approved' | 'returned' | 'cancelled' | null;
  /** 確認が必要と印の付いた記録があるか。 */
  flagged: boolean;
}

/**
 * 締める前に残っているものを並べる。
 *
 * 実務が止まるもの（退勤していない日、承認が済んでいない日）は blocking、
 * 判断の材料にすぎないものは advisory として分ける。
 * 全部を同じ重さで出すと、毎月出るものに紛れて、本当に困るものを見落とす。
 */
export function findClosingBlockers(days: readonly ClosingDayState[]): ClosingFinding[] {
  const findings: ClosingFinding[] = [];

  for (const day of days) {
    if (day.open) {
      findings.push({
        kind: 'open_work_day',
        severity: 'blocking',
        businessDate: day.businessDate,
      });
    }

    if (day.hasPunch) {
      if (day.requestState === null || day.requestState === 'draft') {
        findings.push({
          kind: 'not_requested',
          severity: 'advisory',
          businessDate: day.businessDate,
        });
      } else if (day.requestState === 'submitted') {
        findings.push({
          kind: 'not_approved',
          severity: 'blocking',
          businessDate: day.businessDate,
        });
      } else if (day.requestState === 'returned') {
        findings.push({ kind: 'returned', severity: 'blocking', businessDate: day.businessDate });
      }
    }

    if (day.flagged) {
      findings.push({ kind: 'flagged', severity: 'advisory', businessDate: day.businessDate });
    }
  }

  return findings.sort((left, right) =>
    left.businessDate === right.businessDate
      ? left.kind.localeCompare(right.kind)
      : left.businessDate.localeCompare(right.businessDate),
  );
}

/** 実務が止まるものが残っているか。 */
export function hasBlockingFindings(findings: readonly ClosingFinding[]): boolean {
  return findings.some((finding) => finding.severity === 'blocking');
}
