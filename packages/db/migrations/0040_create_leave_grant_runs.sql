-- 休暇の自動付与を、定期実行として成立させる。
--
-- これまでの一括付与は、管理者が日付と基準を指定して押すものだった。
-- 休暇種別に grant_basis を保存できるようにはなっていたが、それを見て
-- 動く処理はどこにも無い。「自動付与」と書いてある機能は、実際には
-- 手で押す一括付与だった。
--
-- 自動にするには 2 つが要る。どの日まで処理したかと、その日を処理したか。
-- 前者が無いと、止まっていた期間を追いつけない。後者が無いと、
-- 追いついた結果として同じ日を二度付与する。

ALTER TABLE leave_types
  -- 自動付与を動かすか。既定は動かさない。
  -- 既存の休暇種別が、この移行だけで勝手に付与を始めることはない。
  ADD COLUMN auto_grant_enabled boolean NOT NULL DEFAULT false,
  -- 自動付与を始める日。有効にするときに決める。
  -- ここが無いと、追いつきの起点が決まらず、入社日まで遡って付与しかねない。
  ADD COLUMN auto_grant_from date,
  -- 一斉付与の基準日（月と日）。grant_basis が fixed_date のときだけ使う。
  ADD COLUMN grant_fixed_month integer,
  ADD COLUMN grant_fixed_day integer;

ALTER TABLE leave_types
  ADD CONSTRAINT leave_types_auto_grant_needs_start
    CHECK (auto_grant_enabled = false OR auto_grant_from IS NOT NULL),
  ADD CONSTRAINT leave_types_grant_fixed_month_range
    CHECK (grant_fixed_month IS NULL OR grant_fixed_month BETWEEN 1 AND 12),
  -- 日は 28 までにする。29 以降にすると、その月が無い年だけ付与されない。
  -- 誰も気付かないまま 1 年ぶん飛ぶより、置けない値として断る。
  ADD CONSTRAINT leave_types_grant_fixed_day_range
    CHECK (grant_fixed_day IS NULL OR grant_fixed_day BETWEEN 1 AND 28),
  -- 月と日は、そろって初めて基準日になる。
  ADD CONSTRAINT leave_types_grant_fixed_pair
    CHECK ((grant_fixed_month IS NULL) = (grant_fixed_day IS NULL));

-- 自動付与を実行した日の記録。
--
-- 「その休暇種別の、その日ぶんを処理した」ことだけを表す。付与が 0 件でも
-- 行を残す。残さないと、対象が誰も居なかった日を毎回やり直すことになり、
-- 追いつきが進まない。
CREATE TABLE leave_grant_runs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  leave_type_id  uuid        NOT NULL,
  -- 付与の効力を持たせた日。実行した時刻とは別に持つ。
  -- 追いつきでは、過去の日を今日実行することになる。
  effective_on   date        NOT NULL,
  ran_at         timestamptz NOT NULL DEFAULT now(),
  granted_count  integer     NOT NULL,
  skipped_count  integer     NOT NULL,

  CONSTRAINT leave_grant_runs_counts_range
    CHECK (granted_count >= 0 AND skipped_count >= 0),
  -- 同じ日を二度処理しない。追いつきと定期実行が重なっても、
  -- 二度目はここで止まる。
  CONSTRAINT leave_grant_runs_day_key UNIQUE (workspace_id, leave_type_id, effective_on),
  CONSTRAINT leave_grant_runs_leave_type_fkey
    FOREIGN KEY (leave_type_id, workspace_id)
    REFERENCES leave_types (id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX leave_grant_runs_lookup_idx
  ON leave_grant_runs (workspace_id, leave_type_id, effective_on DESC);
