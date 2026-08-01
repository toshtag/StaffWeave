import type { SessionResponse } from '@staffweave/contracts';
import { describe, expect, it } from 'vitest';
import { businessToday, recentBusinessDateRange } from './business-date.js';

/**
 * 画面が使う業務日が、閲覧者の時刻設定にも UTC にも左右されないことを固定する。
 *
 * UTC の日付を切り出していた頃は、日本時間の 0 時から 9 時のあいだ、
 * 前日を「今日」として扱っていた。夜勤と早朝勤務がそのまま影響を受ける。
 */

function sessionWith(timeZone: string): SessionResponse {
  return {
    workspace: { id: 'workspace-1', slug: 'default', name: '既定', timeZone },
    user: {
      id: 'user-1',
      email: 'user@example.com',
      displayName: '利用者',
      locale: 'ja-JP',
      roles: [],
      permissions: [],
      organizationScopes: [],
    },
    employee: null,
    expiresAt: '2026-04-02T00:00:00.000Z',
  };
}

describe('businessToday', () => {
  it('日本時間の早朝でも当日を返す', () => {
    // UTC では 2026-04-01 21:00。日本時間では 2026-04-02 の 6 時。
    const now = new Date('2026-04-01T21:00:00.000Z');

    expect(businessToday(sessionWith('Asia/Tokyo'), now)).toBe('2026-04-02');
  });

  it('時間帯が違えば同じ瞬間でも業務日が違う', () => {
    const now = new Date('2026-04-01T21:00:00.000Z');

    expect(businessToday(sessionWith('UTC'), now)).toBe('2026-04-01');
    expect(businessToday(sessionWith('America/Los_Angeles'), now)).toBe('2026-04-01');
  });
});

describe('recentBusinessDateRange', () => {
  it('今日の業務日から遡る', () => {
    const now = new Date('2026-04-01T21:00:00.000Z');

    expect(recentBusinessDateRange(sessionWith('Asia/Tokyo'), 30, now)).toEqual({
      from: '2026-03-03',
      to: '2026-04-02',
    });
  });

  it('月をまたいでも日付として正しく遡る', () => {
    const now = new Date('2026-03-01T00:00:00.000Z');

    expect(recentBusinessDateRange(sessionWith('UTC'), 1, now)).toEqual({
      from: '2026-02-28',
      to: '2026-03-01',
    });
  });
});
