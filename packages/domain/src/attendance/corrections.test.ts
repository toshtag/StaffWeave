import { describe, expect, it } from 'vitest';
import type { CorrectableEvent } from './corrections.js';
import { resolveEffectiveEvents } from './corrections.js';

const at = (time: string) => new Date(`2026-04-01T${time}:00.000Z`);

function original(
  id: string,
  eventType: CorrectableEvent['eventType'],
  time: string,
  recordedAt = time,
): CorrectableEvent {
  return {
    id,
    eventType,
    occurredAt: at(time),
    correctionAction: null,
    correctsEventId: null,
    recordedAt: at(recordedAt),
  };
}

function correction(
  id: string,
  action: 'adjust' | 'void' | 'add',
  target: string | null,
  eventType: CorrectableEvent['eventType'],
  time: string,
  recordedAt: string,
): CorrectableEvent {
  return {
    id,
    eventType,
    occurredAt: at(time),
    correctionAction: action,
    correctsEventId: target,
    recordedAt: at(recordedAt),
  };
}

describe('resolveEffectiveEvents', () => {
  it('修正が無ければ元の打刻がそのまま有効になる', () => {
    const events = resolveEffectiveEvents([
      original('a', 'clock_in', '00:00'),
      original('b', 'clock_out', '09:00'),
    ]);

    expect(events.map((event) => event.id)).toEqual(['a', 'b']);
    expect(events.every((event) => !event.corrected)).toBe(true);
  });

  it('時刻の修正は元を置き換える', () => {
    const events = resolveEffectiveEvents([
      original('a', 'clock_in', '01:00'),
      correction('c1', 'adjust', 'a', 'clock_in', '00:00', '10:00'),
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe('c1');
    expect(events[0]?.originEventId).toBe('a');
    expect(events[0]?.occurredAt).toEqual(at('00:00'));
    expect(events[0]?.corrected).toBe(true);
  });

  it('取消は有効な打刻から取り除く', () => {
    const events = resolveEffectiveEvents([
      original('a', 'clock_in', '00:00'),
      original('b', 'clock_in', '00:05'),
      correction('c1', 'void', 'b', 'clock_in', '00:05', '10:00'),
    ]);

    expect(events.map((event) => event.id)).toEqual(['a']);
  });

  it('記録されていなかった打刻を足せる', () => {
    const events = resolveEffectiveEvents([
      original('a', 'clock_in', '00:00'),
      correction('c1', 'add', null, 'clock_out', '09:00', '10:00'),
    ]);

    expect(events.map((event) => event.eventType)).toEqual(['clock_in', 'clock_out']);
    expect(events[1]?.corrected).toBe(false);
  });

  it('修正をさらに修正できる', () => {
    const events = resolveEffectiveEvents([
      original('a', 'clock_in', '01:00'),
      correction('c1', 'adjust', 'a', 'clock_in', '00:30', '10:00'),
      correction('c2', 'adjust', 'c1', 'clock_in', '00:00', '11:00'),
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe('c2');
    expect(events[0]?.originEventId).toBe('a');
    expect(events[0]?.occurredAt).toEqual(at('00:00'));
  });

  it('同じイベントへの修正が複数あれば後の記録を採用する', () => {
    const events = resolveEffectiveEvents([
      original('a', 'clock_in', '01:00'),
      correction('c1', 'adjust', 'a', 'clock_in', '00:30', '10:00'),
      correction('c2', 'adjust', 'a', 'clock_in', '00:15', '11:00'),
    ]);

    expect(events[0]?.occurredAt).toEqual(at('00:15'));
  });

  it('追加した打刻も取り消せる', () => {
    const events = resolveEffectiveEvents([
      original('a', 'clock_in', '00:00'),
      correction('c1', 'add', null, 'clock_out', '09:00', '10:00'),
      correction('c2', 'void', 'c1', 'clock_out', '09:00', '11:00'),
    ]);

    expect(events.map((event) => event.id)).toEqual(['a']);
  });

  it('存在しないイベントを指した修正は無視する', () => {
    const events = resolveEffectiveEvents([
      correction('c1', 'adjust', 'missing', 'clock_in', '00:00', '10:00'),
    ]);

    expect(events).toEqual([]);
  });

  it('循環した修正があっても停止する', () => {
    const events = resolveEffectiveEvents([
      original('a', 'clock_in', '00:00'),
      correction('c1', 'adjust', 'a', 'clock_in', '00:30', '10:00'),
      correction('c2', 'adjust', 'c1', 'clock_in', '00:45', '11:00'),
      { ...correction('c1', 'adjust', 'c2', 'clock_in', '00:30', '12:00') },
    ]);

    expect(events.length).toBeLessThanOrEqual(1);
  });

  it('発生時刻の順に並べて返す', () => {
    const events = resolveEffectiveEvents([
      original('a', 'clock_out', '09:00'),
      original('b', 'clock_in', '00:00'),
    ]);

    expect(events.map((event) => event.eventType)).toEqual(['clock_in', 'clock_out']);
  });
});
