-- 休暇の台帳。
--
-- 残数を 1 つの数として持たない。付与・取得・失効・取消を追記で積み、
-- 任意の時点の残数はそこから組み立て直す。
--
-- 数として持つと、付与の取消や申請の差し戻しのたびに足し引きすることになり、
-- どこかで足し忘れれば、残数だけが正しくない状態になる。しかも気付けない。
-- 台帳なら、残数が合わないときに「どの記録が原因か」を辿れる。
--
-- 付与できる単位（日・半日・時間）は事業者が決める。製品は既定値を持たない。

-- 休暇種別へ、取得の単位と有効期間を足す。
ALTER TABLE leave_types
  -- 取得できる最小の単位（分）。480 なら 1 日単位、240 なら半日単位、60 なら時間単位。
  ADD COLUMN unit_minutes    integer,
  -- 1 日ぶんの分数。日数へ言い換えるときに使う。
  ADD COLUMN day_minutes     integer,
  -- 付与から失効までの月数。空なら失効しない。
  ADD COLUMN expires_after_months integer,
  ADD COLUMN active          boolean NOT NULL DEFAULT true;

ALTER TABLE leave_types
  ADD CONSTRAINT leave_types_unit_minutes_range
    CHECK (unit_minutes IS NULL OR unit_minutes BETWEEN 1 AND 1440),
  ADD CONSTRAINT leave_types_day_minutes_range
    CHECK (day_minutes IS NULL OR day_minutes BETWEEN 1 AND 1440),
  ADD CONSTRAINT leave_types_expires_after_months_range
    CHECK (expires_after_months IS NULL OR expires_after_months BETWEEN 1 AND 240);

-- 台帳。追記のみ。
--
-- 取消は元の行を消さず、打ち消す行を足す。
-- 消してしまうと「あったことが無かったこと」になり、監査で辿れない。
CREATE TABLE leave_ledger_entries (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  employee_id    uuid        NOT NULL,
  leave_type_id  uuid        NOT NULL,
  entry_type     text        NOT NULL,
  -- 増える記録は正、減る記録は負。合計がその時点の残数になる。
  minutes        integer     NOT NULL,
  -- いつから使えるか。付与では付与日、取得では取得日。
  effective_on   date        NOT NULL,
  -- いつ失効するか。付与にだけ入る。
  expires_on     date,
  -- 取消のとき、打ち消す相手。
  reverses_entry_id uuid,
  -- 取得のとき、どの申請から来たか。
  request_id     uuid,
  reason         text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid,

  CONSTRAINT leave_ledger_entries_type_values
    CHECK (entry_type IN ('grant', 'consume', 'expire', 'adjust', 'reverse')),
  -- 種別と符号の関係を固定する。付与が負、取得が正では、合計が意味を失う。
  CONSTRAINT leave_ledger_entries_sign
    CHECK (
      (entry_type = 'grant' AND minutes > 0)
      OR (entry_type = 'consume' AND minutes < 0)
      OR (entry_type = 'expire' AND minutes < 0)
      OR (entry_type = 'adjust' AND minutes <> 0)
      OR (entry_type = 'reverse' AND minutes <> 0)
    ),
  -- 取消は必ず相手を指す。指さない取消は、あとから何を打ち消したのか分からない。
  CONSTRAINT leave_ledger_entries_reverse_target
    CHECK ((entry_type = 'reverse') = (reverses_entry_id IS NOT NULL)),
  -- 失効日は付与にだけ入る。
  CONSTRAINT leave_ledger_entries_expires_only_for_grant
    CHECK (expires_on IS NULL OR entry_type = 'grant'),
  CONSTRAINT leave_ledger_entries_expires_order
    CHECK (expires_on IS NULL OR expires_on >= effective_on),

  CONSTRAINT leave_ledger_entries_id_workspace_key UNIQUE (id, workspace_id),
  CONSTRAINT leave_ledger_entries_employee_fkey
    FOREIGN KEY (employee_id, workspace_id)
    REFERENCES employees (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT leave_ledger_entries_leave_type_fkey
    FOREIGN KEY (leave_type_id, workspace_id)
    REFERENCES leave_types (id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT leave_ledger_entries_reverses_fkey
    FOREIGN KEY (reverses_entry_id, workspace_id)
    REFERENCES leave_ledger_entries (id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT leave_ledger_entries_creator_fkey
    FOREIGN KEY (created_by_user_id, workspace_id)
    REFERENCES users (id, workspace_id) ON DELETE SET NULL
);

-- 同じ記録を二度打ち消せないようにする。
-- 二度打ち消すと、消えていない分まで戻ってしまう。
CREATE UNIQUE INDEX leave_ledger_entries_reverse_once_key
  ON leave_ledger_entries (workspace_id, reverses_entry_id)
  WHERE reverses_entry_id IS NOT NULL;

-- 同じ申請から二度消化しないようにする。再送や再承認で二重に引かれるのを防ぐ。
CREATE UNIQUE INDEX leave_ledger_entries_request_once_key
  ON leave_ledger_entries (workspace_id, request_id)
  WHERE request_id IS NOT NULL AND entry_type = 'consume';

CREATE INDEX leave_ledger_entries_balance_idx
  ON leave_ledger_entries (workspace_id, employee_id, leave_type_id, effective_on);

-- 台帳は追記のみ。書き換えと削除を DB で止める。
CREATE TRIGGER leave_ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON leave_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
