-- 同じ従業員に、有効期間が重なる勤務周期の割当を作れないようにする。
--
-- 重なった割当があると、その日にどちらを適用するかが取得順に依存する。
-- 勤務周期は所定労働日と所定労働時間を決め、そこから残業や不足が計算されるため、
-- 同じ入力から違う結果が出る余地を残さない。
--
-- 制度を切り替えるときは、前の割当へ終了日を設定してから次を登録する。

-- 期間の重なりと、ワークスペース・従業員の一致を一つの制約で見るために必要。
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 重複したまま制約を足すことはできない。
-- どの割当を残すかは業務の判断であり、移行で選んでよいものではないため、
-- 重複が残っている場合はここで止め、該当する従業員を示す。
DO $$
DECLARE
  overlapping integer;
  employees text;
BEGIN
  SELECT count(*), string_agg(DISTINCT employee_id::text, ', ')
    INTO overlapping, employees
    FROM (
      SELECT a.employee_id
        FROM employee_work_cycles AS a
        JOIN employee_work_cycles AS b
          ON b.workspace_id = a.workspace_id
         AND b.employee_id = a.employee_id
         AND b.id <> a.id
       WHERE daterange(a.effective_from, a.effective_to, '[]')
          && daterange(b.effective_from, b.effective_to, '[]')
    ) AS conflicts;

  IF overlapping > 0 THEN
    RAISE EXCEPTION
      '有効期間が重複する勤務周期の割当が残っています（従業員: %）。'
      'どちらを残すかを決め、片方に終了日を設定するか削除してから、もう一度実行してください。',
      employees
      USING ERRCODE = 'data_exception';
  END IF;
END $$;

-- 終了日が無い割当は、その日以降ずっと続くものとして重なりを見る。
ALTER TABLE employee_work_cycles
  ADD CONSTRAINT employee_work_cycles_no_overlap
  EXCLUDE USING gist (
    workspace_id WITH =,
    employee_id WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  );
