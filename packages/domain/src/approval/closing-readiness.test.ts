/**
 * 締める前の確認が、押す前に気付けるものを並べることを確かめる。
 */
import { describe, expect, it } from 'vitest';
import {
  type ClosingDayState,
  findClosingBlockers,
  hasBlockingFindings,
} from './closing-readiness.js';

function day(overrides: Partial<ClosingDayState> & { businessDate: string }): ClosingDayState {
  return {
    open: false,
    hasPunch: true,
    requestState: 'approved',
    flagged: false,
    ...overrides,
  };
}

describe('締める前の確認', () => {
  it('片付いた月には何も出さない', () => {
    expect(findClosingBlockers([day({ businessDate: '2026-04-01' })])).toEqual([]);
  });

  it('退勤していない日は、実務が止まるものとして出す', () => {
    expect(findClosingBlockers([day({ businessDate: '2026-04-01', open: true })])).toEqual([
      { kind: 'open_work_day', severity: 'blocking', businessDate: '2026-04-01' },
    ]);
  });

  it('承認待ちの日は、実務が止まるものとして出す', () => {
    const findings = findClosingBlockers([
      day({ businessDate: '2026-04-02', requestState: 'submitted' }),
    ]);

    expect(findings).toEqual([
      { kind: 'not_approved', severity: 'blocking', businessDate: '2026-04-02' },
    ]);
    expect(hasBlockingFindings(findings)).toBe(true);
  });

  it('差し戻したまま出し直していない日も止める', () => {
    expect(
      findClosingBlockers([day({ businessDate: '2026-04-03', requestState: 'returned' })]),
    ).toEqual([{ kind: 'returned', severity: 'blocking', businessDate: '2026-04-03' }]);
  });

  it('申請していない日は、判断の材料として出す', () => {
    const findings = findClosingBlockers([day({ businessDate: '2026-04-04', requestState: null })]);

    expect(findings).toEqual([
      { kind: 'not_requested', severity: 'advisory', businessDate: '2026-04-04' },
    ]);
    // 毎月出るものは締めを止めない。止めると、製品の外で締めることになる。
    expect(hasBlockingFindings(findings)).toBe(false);
  });

  it('打刻の無い日は、申請していなくても出さない', () => {
    expect(
      findClosingBlockers([
        day({ businessDate: '2026-04-05', hasPunch: false, requestState: null }),
      ]),
    ).toEqual([]);
  });

  it('確認の印は、打刻の有無にかかわらず出す', () => {
    expect(
      findClosingBlockers([
        day({ businessDate: '2026-04-06', hasPunch: false, requestState: null, flagged: true }),
      ]),
    ).toEqual([{ kind: 'flagged', severity: 'advisory', businessDate: '2026-04-06' }]);
  });

  it('日付の順に並べる', () => {
    const findings = findClosingBlockers([
      day({ businessDate: '2026-04-10', open: true }),
      day({ businessDate: '2026-04-02', open: true }),
    ]);

    expect(findings.map((finding) => finding.businessDate)).toEqual(['2026-04-02', '2026-04-10']);
  });
});
