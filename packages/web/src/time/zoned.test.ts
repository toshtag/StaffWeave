/**
 * 画面の時刻が、端末ではなく拠点の時計で読み書きされることを確かめる。
 *
 * 以前は `toLocaleTimeString` と `datetime-local` が、どちらも端末の
 * タイムゾーンを使っていた。海外拠点や出張では、表示も入力もずれる。
 * 訂正フォームを開いてそのまま保存すると、絶対時刻が変わることさえあった。
 */
import { describe, expect, it } from 'vitest';
import {
  formatInstantInTimeZone,
  instantToZonedLocalInput,
  zonedLocalInputToInstant,
} from './zoned.js';

const TOKYO = 'Asia/Tokyo';
const NEW_YORK = 'America/New_York';

describe('拠点の時計での表示', () => {
  it('端末ではなく拠点のタイムゾーンで読む', () => {
    // 2026-04-01T00:30Z は東京では 09:30、ニューヨークでは前日 20:30。
    const iso = '2026-04-01T00:30:00.000Z';

    expect(formatInstantInTimeZone(iso, TOKYO, 'ja-JP')).toBe('09:30');
    expect(formatInstantInTimeZone(iso, NEW_YORK, 'ja-JP')).toBe('20:30');
  });
});

describe('入力欄への変換', () => {
  it('拠点の時計での日時を返す', () => {
    const iso = '2026-04-01T00:30:00.000Z';

    expect(instantToZonedLocalInput(iso, TOKYO)).toBe('2026-04-01T09:30');
    expect(instantToZonedLocalInput(iso, NEW_YORK)).toBe('2026-03-31T20:30');
  });

  it('真夜中を 24 時ではなく 00 時で返す', () => {
    // 東京の 2026-04-02 00:00。
    expect(instantToZonedLocalInput('2026-04-01T15:00:00.000Z', TOKYO)).toBe('2026-04-02T00:00');
  });
});

describe('入力欄からの変換', () => {
  it('拠点の時計として読む', () => {
    expect(zonedLocalInputToInstant('2026-04-01T09:30', TOKYO)).toEqual({
      iso: '2026-04-01T00:30:00.000Z',
      problem: null,
    });
    expect(zonedLocalInputToInstant('2026-03-31T20:30', NEW_YORK)).toEqual({
      iso: '2026-04-01T00:30:00.000Z',
      problem: null,
    });
  });

  it('形が違えば読まない', () => {
    expect(zonedLocalInputToInstant('', TOKYO).problem).toBe('malformed');
    expect(zonedLocalInputToInstant('2026-04-01', TOKYO).problem).toBe('malformed');
  });

  /**
   * 進む日には、存在しない現地時刻がある。
   * 黙って近い時刻へ寄せると、入れた時刻と保存される時刻が食い違う。
   */
  it('存在しない現地時刻は保存させない', () => {
    // America/New_York は 2026-03-08 の 2:00 に 3:00 へ進む。
    expect(zonedLocalInputToInstant('2026-03-08T02:30', NEW_YORK)).toEqual({
      iso: null,
      problem: 'nonexistent',
    });
    // 前後の時刻はそのまま読める。
    expect(zonedLocalInputToInstant('2026-03-08T01:30', NEW_YORK).problem).toBeNull();
    expect(zonedLocalInputToInstant('2026-03-08T03:30', NEW_YORK).problem).toBeNull();
  });

  it('戻る日に 2 回訪れる時刻は、先に来るほうを採る', () => {
    // 2026-11-01 の 1:30 は EDT と EST で 2 回ある。EDT 側は 05:30Z。
    expect(zonedLocalInputToInstant('2026-11-01T01:30', NEW_YORK)).toEqual({
      iso: '2026-11-01T05:30:00.000Z',
      problem: null,
    });
  });
});

describe('往復', () => {
  it.each([
    ['2026-04-01T00:30:00.000Z', TOKYO],
    ['2026-04-01T00:30:00.000Z', NEW_YORK],
    // 夏時間の切り替え当日。
    ['2026-03-08T09:00:00.000Z', NEW_YORK],
    ['2026-11-01T10:00:00.000Z', NEW_YORK],
  ])('%s を %s で開いて、そのまま保存しても絶対時刻が変わらない', (iso, timeZone) => {
    const shown = instantToZonedLocalInput(iso, timeZone);

    expect(zonedLocalInputToInstant(shown, timeZone).iso).toBe(iso);
  });
});
