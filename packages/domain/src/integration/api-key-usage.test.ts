import { describe, expect, it } from 'vitest';
import { DEFAULT_API_KEY_USAGE_INTERVAL_MS, shouldRecordApiKeyUse } from './api-key-usage.js';

const NOW = new Date('2026-04-01T00:00:00.000Z');

function minutesBefore(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000);
}

describe('shouldRecordApiKeyUse', () => {
  it('一度も使われていなければ書く', () => {
    expect(shouldRecordApiKeyUse(null, NOW)).toBe(true);
  });

  it('間隔の中で使われていれば書かない', () => {
    expect(shouldRecordApiKeyUse(new Date(NOW.getTime() - 30_000), NOW)).toBe(false);
  });

  it('間隔を過ぎていれば書く', () => {
    expect(shouldRecordApiKeyUse(minutesBefore(5), NOW)).toBe(true);
  });

  it('間隔ちょうどでは書く', () => {
    const lastUsedAt = new Date(NOW.getTime() - DEFAULT_API_KEY_USAGE_INTERVAL_MS);
    expect(shouldRecordApiKeyUse(lastUsedAt, NOW)).toBe(true);
  });

  it('間隔を指定できる', () => {
    const lastUsedAt = minutesBefore(5);
    expect(shouldRecordApiKeyUse(lastUsedAt, NOW, 10 * 60_000)).toBe(false);
    expect(shouldRecordApiKeyUse(lastUsedAt, NOW, 60_000)).toBe(true);
  });

  it('未来の記録が残っていれば書き直す', () => {
    // 時計が戻った場合。放っておくと、以後いつまでも書き直されない。
    expect(shouldRecordApiKeyUse(new Date(NOW.getTime() + 60_000), NOW)).toBe(true);
  });
});
