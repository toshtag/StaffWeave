-- PC セッション観測のまとめ送りに対する受領記録。
--
-- 1 回の要求には観測が複数入り、それらはすべて同じ request_id で保存される。
-- そのため観測テーブルへ (workspace_id, request_id) の一意制約は置けない。
-- 要求 1 件につき 1 行だけを持つこの表を、要求の冪等性の正本とする。
--
-- 連番そのものは端末ごとの devices.last_sequence が正本であり、打刻イベントと共有する。
-- ここには受領した時点の連番と、直前の受領からの差を残す。

CREATE TABLE workstation_session_receipts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  device_id     uuid        NOT NULL,
  request_id    text        NOT NULL,
  sequence      integer     NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  -- 直前に受理した端末連番との差。1 なら欠落なし。断った要求では 0 以下になりうる。
  sequence_step integer     NOT NULL,
  outcome       text        NOT NULL,
  accepted      integer     NOT NULL,
  skipped       integer     NOT NULL,
  detail        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT workstation_session_receipts_device_fkey
    FOREIGN KEY (device_id, workspace_id)
    REFERENCES devices (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT workstation_session_receipts_request_length
    CHECK (char_length(request_id) BETWEEN 8 AND 128),
  CONSTRAINT workstation_session_receipts_sequence_positive
    CHECK (sequence >= 1),
  CONSTRAINT workstation_session_receipts_outcome_values
    CHECK (outcome IN ('accepted', 'rejected')),
  CONSTRAINT workstation_session_receipts_counts_non_negative
    CHECK (accepted >= 0 AND skipped >= 0),
  -- 同じ要求を二重に受け取らないことを決めるのはこの制約であり、事前の照会ではない。
  CONSTRAINT workstation_session_receipts_request_key UNIQUE (workspace_id, request_id)
);

CREATE INDEX workstation_session_receipts_sequence_idx
  ON workstation_session_receipts (workspace_id, device_id, sequence);

CREATE TRIGGER workstation_session_receipts_append_only
  BEFORE UPDATE OR DELETE ON workstation_session_receipts
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
