import { describe, expect, it } from 'vitest';
import {
  ANOMALY_SEVERITY,
  findDuplicateEvents,
  isExcessiveCorrections,
  isNotableSkew,
} from './anomaly.js';

const at = (time: string) => new Date(`2026-04-01T${time}:00.000Z`);

describe('findDuplicateEvents', () => {
  it('短い間隔で並んだ同じ種別を見つける', () => {
    const pairs = findDuplicateEvents([
      { id: 'a', eventType: 'clock_in', occurredAt: at('09:00') },
      { id: 'b', eventType: 'clock_in', occurredAt: at('09:01') },
    ]);

    expect(pairs).toEqual([
      { firstEventId: 'a', secondEventId: 'b', eventType: 'clock_in', minutesApart: 1 },
    ]);
  });

  it('間隔が十分あれば知らせない', () => {
    expect(
      findDuplicateEvents([
        { id: 'a', eventType: 'clock_in', occurredAt: at('09:00') },
        { id: 'b', eventType: 'clock_in', occurredAt: at('09:30') },
      ]),
    ).toEqual([]);
  });

  it('種別が違えば知らせない', () => {
    expect(
      findDuplicateEvents([
        { id: 'a', eventType: 'clock_in', occurredAt: at('09:00') },
        { id: 'b', eventType: 'break_start', occurredAt: at('09:01') },
      ]),
    ).toEqual([]);
  });

  it('順序が入れ替わっていても時刻で並べ直す', () => {
    const pairs = findDuplicateEvents([
      { id: 'b', eventType: 'clock_out', occurredAt: at('18:01') },
      { id: 'a', eventType: 'clock_out', occurredAt: at('18:00') },
    ]);

    expect(pairs[0]?.firstEventId).toBe('a');
  });

  it('許容間隔は設定で変えられる', () => {
    const events = [
      { id: 'a' as const, eventType: 'clock_in' as const, occurredAt: at('09:00') },
      { id: 'b' as const, eventType: 'clock_in' as const, occurredAt: at('09:05') },
    ];

    expect(findDuplicateEvents(events)).toEqual([]);
    expect(
      findDuplicateEvents(events, {
        correctionThreshold: 3,
        clockSkewSeconds: 120,
        duplicateWindowMinutes: 10,
      }),
    ).toHaveLength(1);
  });
});

describe('isExcessiveCorrections', () => {
  it('しきい値を超えたら知らせる', () => {
    expect(isExcessiveCorrections(3)).toBe(false);
    expect(isExcessiveCorrections(4)).toBe(true);
  });
});

describe('isNotableSkew', () => {
  it('前後どちらのずれも見る', () => {
    expect(isNotableSkew(60)).toBe(false);
    expect(isNotableSkew(300)).toBe(true);
    expect(isNotableSkew(-300)).toBe(true);
  });
});

describe('ANOMALY_SEVERITY', () => {
  it('確定後の変更と大量修正は警告として扱う', () => {
    expect(ANOMALY_SEVERITY.post_finalization_change).toBe('warning');
    expect(ANOMALY_SEVERITY.excessive_corrections).toBe('warning');
    expect(ANOMALY_SEVERITY.sequence_gap).toBe('info');
  });
});
