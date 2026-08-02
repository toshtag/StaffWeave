import { describe, expect, it } from 'vitest';
import { testDatabase } from '../../../../test/integration-setup.js';

/**
 * ワークスペース全体を対象にした期間の検索が、索引で絞れる状態にあることを確かめる。
 *
 * 索引は消しても動く。消したことに気付けるのは、実行計画を見たときだけであり、
 * 応答も結果も変わらない。運用の量が増えてから遅くなる形は、
 * 手元のデータ量では再現しないため、ここでは索引そのものの有無を固定する。
 *
 * 先頭 2 列（ワークスペースと日付）が要件で、3 列目は覆う範囲を広げるためのもの。
 */

interface ExpectedIndex {
  table: string;
  name: string;
  columns: string[];
  usedBy: string;
}

const EXPECTED: ExpectedIndex[] = [
  {
    table: 'attendance_events',
    name: 'attendance_events_workspace_day_idx',
    columns: ['workspace_id', 'business_date', 'employee_id'],
    usedBy: '異常検出（締め後の変更・修正の多発・重複打刻）',
  },
  {
    table: 'attendance_calculations',
    name: 'attendance_calculations_workspace_day_idx',
    columns: ['workspace_id', 'business_date', 'employee_id'],
    usedBy: '勤怠 CSV の出力',
  },
  {
    table: 'workstation_session_observations',
    name: 'workstation_session_observations_workspace_day_idx',
    columns: ['workspace_id', 'business_date', 'employee_id'],
    usedBy: 'PC セッション観測の一覧',
  },
  {
    table: 'daily_attendance_requests',
    name: 'daily_attendance_requests_workspace_day_idx',
    columns: ['workspace_id', 'business_date', 'employee_id'],
    usedBy: '申請の一覧（状態を指定しない場合）',
  },
  {
    table: 'monthly_closings',
    name: 'monthly_closings_workspace_period_idx',
    columns: ['workspace_id', 'period', 'employee_id'],
    usedBy: '締めの一覧',
  },
  {
    table: 'device_event_receipts',
    name: 'device_event_receipts_workspace_received_idx',
    columns: ['workspace_id', 'received_at'],
    usedBy: '異常検出（端末の時計差・連番欠落・拒否）',
  },
];

/** 索引の定義を、列の並び順のまま取り出す。 */
async function indexColumns(indexName: string): Promise<string[]> {
  const rows = await testDatabase().query<{ column_name: string }>(
    `SELECT attribute.attname AS column_name
       FROM pg_index AS index
       JOIN pg_class AS index_class ON index_class.oid = index.indexrelid
       JOIN pg_attribute AS attribute
         ON attribute.attrelid = index.indrelid
        AND attribute.attnum = ANY(index.indkey)
      WHERE index_class.relname = $1
      ORDER BY array_position(index.indkey, attribute.attnum)`,
    [indexName],
  );
  return rows.map((row) => row.column_name);
}

describe('ワークスペース全体を対象にした期間の索引', () => {
  for (const expected of EXPECTED) {
    it(`${expected.table} が ${expected.usedBy} のための索引を持つ`, async () => {
      expect(await indexColumns(expected.name)).toEqual(expected.columns);
    });
  }

  it('従業員を先頭に置いた既存の索引を残す', async () => {
    // 従業員を指定する経路は、引き続きこちらを使う。片方へ寄せない。
    expect(await indexColumns('attendance_events_day_idx')).toEqual([
      'workspace_id',
      'employee_id',
      'business_date',
      'occurred_at',
    ]);
    expect(await indexColumns('attendance_calculations_day_idx')).toEqual([
      'workspace_id',
      'employee_id',
      'business_date',
      'version',
    ]);
  });
});
