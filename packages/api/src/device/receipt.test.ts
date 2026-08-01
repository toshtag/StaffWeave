import { describe, expect, it } from 'vitest';
import { rejectionOf } from './receipt.js';
import type { DeviceEventReceipt } from './repository.js';

/**
 * 再送へ返す内容が、そのときの状態ではなく受領記録だけで決まることを固定する。
 *
 * 断った要求の再送は、受理へ変わらない。受理した要求の再送は、断りへ変わらない。
 */

const base: DeviceEventReceipt = {
  deviceId: 'device-1',
  sequence: 1,
  requestId: 'request-1',
  receivedAt: '2026-04-01T00:00:00.000Z',
  deviceTime: '2026-04-01T00:00:00.000Z',
  clockSkewSeconds: 0,
  sequenceStep: 1,
  attendanceEventId: 'event-1',
  businessDate: '2026-04-01',
  outcome: 'accepted',
  eventType: 'clock_in',
  rejection: null,
};

describe('rejectionOf', () => {
  it('受理した記録では失敗を作らない', () => {
    expect(rejectionOf(base)).toBeNull();
  });

  it('断った記録は保存した応答をそのまま返す', () => {
    const error = rejectionOf({
      ...base,
      attendanceEventId: null,
      businessDate: null,
      outcome: 'rejected',
      eventType: null,
      rejection: { code: 'conflict', message: 'すでに退勤済みです' },
    });

    expect(error?.code).toBe('conflict');
    expect(error?.message).toBe('すでに退勤済みです');
    expect(error?.status).toBe(409);
  });
});
