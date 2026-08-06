/**
 * CSV が、画面に出ている表とずれないことを確かめる。
 *
 * 列を別々に持つと、画面へ 1 列足したときに CSV だけが古くなる。
 * 気付くのは、取り出した CSV を見た人が「あの列が無い」と言ったときになる。
 */
import { describe, expect, it } from 'vitest';
import { type Column, csvOf } from './resource.tsx';

interface Row {
  code: string;
  minutes: number;
  note: string | null;
}

const columns: Column<Row>[] = [
  { key: 'code', header: 'コード', value: (row) => row.code },
  {
    key: 'minutes',
    header: '分数',
    value: (row) => row.minutes,
    // 画面だけの見せ方。CSV は value のほうを使う。
    cell: (row) => `${row.minutes} 分`,
  },
  { key: 'note', header: '備考', value: (row) => row.note ?? '' },
];

describe('表の CSV', () => {
  it('列の見出しと値を、表と同じ定義から作る', () => {
    const csv = csvOf(columns, [{ code: 'DAY', minutes: 480, note: null }]);

    expect(csv).toBe('"コード","分数","備考"\n"DAY","480",""');
  });

  it('行が無くても見出しは出す', () => {
    expect(csvOf(columns, [])).toBe('"コード","分数","備考"');
  });

  it('数式として読まれる値を、そのまま渡さない', () => {
    const csv = csvOf(columns, [{ code: '=1+1', minutes: 0, note: null }]);

    expect(csv).not.toContain('"=1+1"');
  });
});
