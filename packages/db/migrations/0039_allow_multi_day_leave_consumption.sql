-- 複数日の休暇の申請を、日ごとの記録として台帳へ残せるようにする。
--
-- 申請は ends_on を持ち、複数日を表せる。しかし台帳の一意制約が
-- 「1 つの申請につき消化 1 件」だったため、3 日申請しても 1 日ぶんしか
-- 引けなかった。残数だけが合わず、どの日を消化したのかも残らない。
--
-- 一意の単位を「申請 × 日」に変える。日ごとに 1 件を積み、同じ申請が
-- 二度届いても同じ日を二度引かない。どの日を消化したかは effective_on に残る。
DROP INDEX leave_ledger_entries_request_once_key;

CREATE UNIQUE INDEX leave_ledger_entries_request_day_key
  ON leave_ledger_entries (workspace_id, request_id, effective_on)
  WHERE request_id IS NOT NULL AND entry_type = 'consume';
