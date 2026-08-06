/**
 * 残数を台帳から組み立て直せることを確かめる。
 *
 * 残数を数として持つと、取消や差し戻しのたびに足し引きすることになり、
 * 足し忘れても気付けない。台帳から組み立てれば、合わないときに原因を辿れる。
 */
import { describe, expect, it } from 'vitest';
import { buildLeaveBalance, type LeaveLedgerEntry, validateLeaveConsumption } from './ledger.js';

const HOUR = 60;
const DAY = 8 * HOUR;

function entry(overrides: Partial<LeaveLedgerEntry> & { id: string }): LeaveLedgerEntry {
  return {
    entryType: 'grant',
    minutes: DAY,
    effectiveOn: '2026-04-01',
    expiresOn: null,
    reversesEntryId: null,
    ...overrides,
  };
}

describe('残数の組み立て', () => {
  it('記録が無ければ 0', () => {
    expect(buildLeaveBalance([], '2026-04-01').availableMinutes).toBe(0);
  });

  it('付与から消化を引く', () => {
    const balance = buildLeaveBalance(
      [
        entry({ id: 'a', minutes: 10 * DAY }),
        entry({ id: 'b', entryType: 'consume', minutes: -DAY, effectiveOn: '2026-04-10' }),
      ],
      '2026-04-30',
    );

    expect(balance.availableMinutes).toBe(9 * DAY);
  });

  it('未来の付与は、その日の残数へ入れない', () => {
    const balance = buildLeaveBalance(
      [entry({ id: 'a', minutes: 10 * DAY, effectiveOn: '2026-10-01' })],
      '2026-04-30',
    );

    expect(balance.availableMinutes).toBe(0);
  });

  it('期限の近い付与から先に消化する', () => {
    const balance = buildLeaveBalance(
      [
        entry({ id: 'old', minutes: 2 * DAY, expiresOn: '2026-09-30' }),
        entry({ id: 'new', minutes: 5 * DAY, expiresOn: '2027-03-31' }),
        entry({ id: 'used', entryType: 'consume', minutes: -DAY, effectiveOn: '2026-04-10' }),
      ],
      '2026-04-30',
    );

    // 期限の近い old から減る。
    expect(balance.remaining).toEqual([
      { entryId: 'old', minutes: DAY, expiresOn: '2026-09-30' },
      { entryId: 'new', minutes: 5 * DAY, expiresOn: '2027-03-31' },
    ]);
  });

  it('期限の無い付与は最後に使う', () => {
    const balance = buildLeaveBalance(
      [
        entry({ id: 'forever', minutes: 2 * DAY, expiresOn: null }),
        entry({ id: 'limited', minutes: 2 * DAY, expiresOn: '2026-09-30' }),
        entry({ id: 'used', entryType: 'consume', minutes: -2 * DAY, effectiveOn: '2026-04-10' }),
      ],
      '2026-04-30',
    );

    expect(balance.remaining).toEqual([{ entryId: 'forever', minutes: 2 * DAY, expiresOn: null }]);
  });

  it('期限を過ぎた付与は残数から外れる', () => {
    const balance = buildLeaveBalance(
      [entry({ id: 'a', minutes: 2 * DAY, expiresOn: '2026-09-30' })],
      '2026-10-01',
    );

    expect(balance.availableMinutes).toBe(0);
    expect(balance.expiredMinutes).toBe(2 * DAY);
  });

  it('期限の切れた付与からは消化しない', () => {
    const balance = buildLeaveBalance(
      [
        entry({ id: 'lapsed', minutes: 2 * DAY, expiresOn: '2026-09-30' }),
        entry({ id: 'live', minutes: 2 * DAY, expiresOn: '2027-03-31' }),
        // 期限の切れたあとの消化。切れた付与から引いてはいけない。
        entry({ id: 'used', entryType: 'consume', minutes: -DAY, effectiveOn: '2026-12-01' }),
      ],
      '2026-12-31',
    );

    expect(balance.remaining).toEqual([{ entryId: 'live', minutes: DAY, expiresOn: '2027-03-31' }]);
    expect(balance.expiredMinutes).toBe(2 * DAY);
  });

  it('付与の日より前の消化は、その付与から引かない', () => {
    const balance = buildLeaveBalance(
      [
        entry({ id: 'later', minutes: 5 * DAY, effectiveOn: '2026-10-01' }),
        entry({ id: 'used', entryType: 'consume', minutes: -DAY, effectiveOn: '2026-05-01' }),
      ],
      '2026-12-31',
    );

    // 5 日ぶんは残ったまま、引き当てられなかった 1 日ぶんが残数を押し下げる。
    expect(balance.availableMinutes).toBe(4 * DAY);
    expect(balance.remaining).toEqual([
      { entryId: 'later', minutes: 5 * DAY, expiresOn: null },
      { entryId: 'unallocated', minutes: -DAY, expiresOn: null },
    ]);
  });

  it('期限の日そのものは、まだ使える', () => {
    const balance = buildLeaveBalance(
      [entry({ id: 'a', minutes: 2 * DAY, expiresOn: '2026-09-30' })],
      '2026-09-30',
    );

    expect(balance.availableMinutes).toBe(2 * DAY);
  });

  it('取消された記録は、取消も相手も数えない', () => {
    const balance = buildLeaveBalance(
      [
        entry({ id: 'a', minutes: 10 * DAY }),
        entry({ id: 'used', entryType: 'consume', minutes: -2 * DAY, effectiveOn: '2026-04-10' }),
        entry({
          id: 'undo',
          entryType: 'reverse',
          minutes: 2 * DAY,
          effectiveOn: '2026-04-11',
          reversesEntryId: 'used',
        }),
      ],
      '2026-04-30',
    );

    // 消化が無かったことになるので、付与のまま残る。
    expect(balance.availableMinutes).toBe(10 * DAY);
  });

  it('同じ記録を二度打ち消しても、戻りすぎない', () => {
    const balance = buildLeaveBalance(
      [
        entry({ id: 'a', minutes: 10 * DAY }),
        entry({ id: 'used', entryType: 'consume', minutes: -2 * DAY, effectiveOn: '2026-04-10' }),
        entry({
          id: 'undo1',
          entryType: 'reverse',
          minutes: 2 * DAY,
          effectiveOn: '2026-04-11',
          reversesEntryId: 'used',
        }),
        entry({
          id: 'undo2',
          entryType: 'reverse',
          minutes: 2 * DAY,
          effectiveOn: '2026-04-12',
          reversesEntryId: 'used',
        }),
      ],
      '2026-04-30',
    );

    expect(balance.availableMinutes).toBe(10 * DAY);
  });

  it('手当ての調整を足し引きできる', () => {
    const balance = buildLeaveBalance(
      [
        entry({ id: 'a', minutes: 5 * DAY }),
        entry({ id: 'plus', entryType: 'adjust', minutes: DAY, effectiveOn: '2026-04-05' }),
        entry({ id: 'minus', entryType: 'adjust', minutes: -DAY, effectiveOn: '2026-04-06' }),
      ],
      '2026-04-30',
    );

    expect(balance.availableMinutes).toBe(5 * DAY);
  });

  it('同じ台帳からは、何度組み立てても同じ残数になる', () => {
    const entries = [
      entry({ id: 'a', minutes: 10 * DAY, expiresOn: '2027-03-31' }),
      entry({ id: 'b', entryType: 'consume', minutes: -3 * DAY, effectiveOn: '2026-05-01' }),
    ];

    expect(buildLeaveBalance(entries, '2026-06-01')).toEqual(
      buildLeaveBalance([...entries].reverse(), '2026-06-01'),
    );
  });
});

describe('消化の検査', () => {
  const granted = [entry({ id: 'a', minutes: 2 * DAY })];
  const check = (input: {
    entries?: LeaveLedgerEntry[];
    minutes: number;
    effectiveOn?: string;
    unitMinutes?: number | null;
  }) =>
    validateLeaveConsumption({
      entries: input.entries ?? granted,
      minutes: input.minutes,
      effectiveOn: input.effectiveOn ?? '2026-04-10',
      unitMinutes: input.unitMinutes ?? null,
    });

  it('残数を超える消化は断る', () => {
    expect(check({ minutes: 3 * DAY })).toEqual(['insufficient']);
  });

  it('残数ちょうどは受け付ける', () => {
    expect(check({ minutes: 2 * DAY })).toEqual([]);
  });

  // 日付をさかのぼって消化を積むと、その日には足りていても、
  // あとの日の消化と合わせて足りなくなる。
  it('その日には足りていても、あとの消化と合わせて足りなければ断る', () => {
    const entries = [
      ...granted,
      entry({ id: 'later', entryType: 'consume', minutes: -2 * DAY, effectiveOn: '2026-04-20' }),
    ];

    expect(check({ entries, minutes: DAY, effectiveOn: '2026-04-10' })).toEqual(['insufficient']);
  });

  it('まだ効いていない付与を当てにしない', () => {
    const entries = [entry({ id: 'later', minutes: 5 * DAY, effectiveOn: '2026-10-01' })];

    expect(check({ entries, minutes: DAY, effectiveOn: '2026-04-10' })).toEqual(['insufficient']);
  });

  it('取得の単位が決まっていれば、その倍数だけを受け付ける', () => {
    expect(check({ minutes: 4 * HOUR, unitMinutes: 4 * HOUR })).toEqual([]);
    expect(check({ minutes: 3 * HOUR, unitMinutes: 4 * HOUR })).toEqual(['not_a_multiple']);
  });

  it('単位が決まっていなければ、倍数は見ない', () => {
    expect(check({ minutes: 3 * HOUR })).toEqual([]);
  });
});
