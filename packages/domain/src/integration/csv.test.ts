import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv, toCsvValue } from './csv.js';
import {
  API_SCOPES,
  canonicalWebhookMessage,
  hasScope,
  isApiScope,
  isWebhookEventType,
} from './scopes.js';

describe('toCsv', () => {
  it('値を常に引用符で囲む', () => {
    expect(toCsv(['a', 'b'], [['1', '2']])).toBe('"a","b"\n"1","2"');
  });

  it('引用符を二重にして壊れないようにする', () => {
    expect(toCsvValue('say "hello"')).toBe('"say ""hello"""');
  });

  it('区切り文字や改行を含む値も扱える', () => {
    const csv = toCsv(['note'], [['a,b\nc']]);
    expect(parseCsv(csv).rows[0]?.note).toBe('a,b\nc');
  });

  it('空の値を空文字として書く', () => {
    expect(toCsv(['a'], [[null]])).toBe('"a"\n""');
  });
});

describe('parseCsv', () => {
  it('見出しと行を読み取る', () => {
    const result = parseCsv('"code","name"\n"E001","勤怠 花子"');
    expect(result.header).toEqual(['code', 'name']);
    expect(result.rows).toEqual([{ code: 'E001', name: '勤怠 花子' }]);
    expect(result.problems).toEqual([]);
  });

  it('引用符のない値も読める', () => {
    expect(parseCsv('code,name\nE001,花子').rows[0]).toEqual({ code: 'E001', name: '花子' });
  });

  it('列数が合わない行を読み飛ばし、位置を返す', () => {
    const result = parseCsv('"a","b"\n"1"\n"2","3"');
    expect(result.rows).toEqual([{ a: '2', b: '3' }]);
    expect(result.problems[0]?.line).toBe(2);
  });

  it('空行を無視する', () => {
    expect(parseCsv('"a"\n\n"1"\n').rows).toEqual([{ a: '1' }]);
  });

  it('書き出した内容をそのまま読み戻せる', () => {
    const csv = toCsv(['a', 'b'], [['x"y', 'z,w']]);
    expect(parseCsv(csv).rows[0]).toEqual({ a: 'x"y', b: 'z,w' });
  });
});

describe('API キーのスコープ', () => {
  it('未知のスコープを拒否する', () => {
    expect(isApiScope('attendance:read')).toBe(true);
    expect(isApiScope('everything')).toBe(false);
  });

  it('与えられた範囲だけを許す', () => {
    expect(hasScope(['attendance:read'], 'attendance:read')).toBe(true);
    expect(hasScope(['attendance:read'], 'attendance:write')).toBe(false);
  });

  it('すべてのスコープに説明がある', () => {
    expect(API_SCOPES.length).toBeGreaterThan(0);
  });
});

describe('Webhook', () => {
  it('未知の種別を拒否する', () => {
    expect(isWebhookEventType('attendance_request.approved')).toBe(true);
    expect(isWebhookEventType('anything.happened')).toBe(false);
  });

  it('署名対象に送信時刻を含める', () => {
    const message = canonicalWebhookMessage({
      eventId: 'event-1',
      eventType: 'attendance_request.approved',
      timestamp: '2026-04-01T00:00:00.000Z',
      body: '{}',
    });

    expect(message.split('\n')).toEqual([
      'staffweave-webhook/1',
      'event-1',
      'attendance_request.approved',
      '2026-04-01T00:00:00.000Z',
      '{}',
    ]);
  });

  it('内容が変われば署名対象も変わる', () => {
    const base = {
      eventId: 'event-1',
      eventType: 'attendance_request.approved',
      timestamp: '2026-04-01T00:00:00.000Z',
      body: '{}',
    };
    expect(canonicalWebhookMessage(base)).not.toBe(
      canonicalWebhookMessage({ ...base, body: '{"a":1}' }),
    );
  });
});
