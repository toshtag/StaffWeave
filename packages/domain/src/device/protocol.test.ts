import { describe, expect, it } from 'vitest';
import { acceptsSignedEvents, applyDeviceEvent, INITIAL_DEVICE } from './enrollment.js';
import {
  canonicalPayload,
  clockSkewSeconds,
  evaluateSequence,
  isNotableClockSkew,
} from './protocol.js';

const payload = {
  deviceId: '00000000-0000-4000-8000-000000000001',
  sequence: 7,
  requestId: 'request-0000007',
  employeeNumber: 'E001',
  eventType: 'clock_in' as const,
  occurredAt: '2026-04-01T00:00:00.000Z',
  deviceTime: '2026-04-01T00:00:01.000Z',
};

describe('canonicalPayload', () => {
  it('決まった順に並べる', () => {
    expect(canonicalPayload(payload).split('\n')).toEqual([
      'staffweave-device-event/1',
      '00000000-0000-4000-8000-000000000001',
      '7',
      'request-0000007',
      'E001',
      'clock_in',
      '2026-04-01T00:00:00.000Z',
      '2026-04-01T00:00:01.000Z',
    ]);
  });

  it('項目が 1 つでも変われば別の文字列になる', () => {
    expect(canonicalPayload(payload)).not.toBe(canonicalPayload({ ...payload, sequence: 8 }));
    expect(canonicalPayload(payload)).not.toBe(
      canonicalPayload({ ...payload, employeeNumber: 'E002' }),
    );
  });
});

describe('evaluateSequence', () => {
  it.each([
    [0, 1, 'expected'],
    [7, 8, 'expected'],
    [7, 10, 'gap'],
    [7, 7, 'replay'],
    [7, 3, 'replay'],
  ])('直前が %s のとき %s は %s', (last, incoming, expected) => {
    expect(evaluateSequence(last, incoming)).toBe(expected);
  });
});

describe('clockSkewSeconds', () => {
  it('端末が進んでいれば正の値になる', () => {
    expect(
      clockSkewSeconds(new Date('2026-04-01T00:01:00Z'), new Date('2026-04-01T00:00:00Z')),
    ).toBe(60);
  });

  it('端末が遅れていれば負の値になる', () => {
    expect(
      clockSkewSeconds(new Date('2026-04-01T00:00:00Z'), new Date('2026-04-01T00:01:00Z')),
    ).toBe(-60);
  });

  it('目立つずれかどうかを判定する', () => {
    expect(isNotableClockSkew(60)).toBe(false);
    expect(isNotableClockSkew(-60)).toBe(false);
    expect(isNotableClockSkew(300)).toBe(true);
    expect(isNotableClockSkew(-300)).toBe(true);
  });
});

describe('端末の登録状態', () => {
  it('登録すると有効になる', () => {
    const next = applyDeviceEvent(INITIAL_DEVICE, 'ENROLL');
    expect(next?.state).toBe('active');
    expect(next?.context.enrollments).toBe(1);
  });

  it('登録待ちのまま失効させられる', () => {
    expect(applyDeviceEvent(INITIAL_DEVICE, 'REVOKE')?.state).toBe('revoked');
  });

  it('失効した端末は復帰させられない', () => {
    const revoked = { state: 'revoked' as const, context: { enrollments: 1 } };
    expect(applyDeviceEvent(revoked, 'ENROLL')).toBeNull();
    expect(applyDeviceEvent(revoked, 'REVOKE')).toBeNull();
  });

  it('有効な端末を二重に登録できない', () => {
    const active = { state: 'active' as const, context: { enrollments: 1 } };
    expect(applyDeviceEvent(active, 'ENROLL')).toBeNull();
  });

  it('署名イベントを受け付けるのは有効な端末だけ', () => {
    expect(acceptsSignedEvents('active')).toBe(true);
    expect(acceptsSignedEvents('pending')).toBe(false);
    expect(acceptsSignedEvents('revoked')).toBe(false);
  });
});
