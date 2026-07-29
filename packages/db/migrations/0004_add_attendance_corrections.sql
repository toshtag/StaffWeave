-- 休憩と打刻の修正。
--
-- 打刻イベントは引き続き追記のみ。修正は元の行を書き換えず、
-- 「どのイベントをどう直すか」を持つ新しい行として追加する。

-- 休憩の打刻種別を受け入れる。
ALTER TABLE attendance_events DROP CONSTRAINT attendance_events_type_values;
ALTER TABLE attendance_events ADD CONSTRAINT attendance_events_type_values
  CHECK (event_type IN ('clock_in', 'clock_out', 'break_start', 'break_end'));

-- 修正イベントが元イベントを参照できるようにする。
ALTER TABLE attendance_events
  ADD CONSTRAINT attendance_events_id_workspace_key UNIQUE (id, workspace_id);

ALTER TABLE attendance_events
  ADD COLUMN corrects_event_id  uuid,
  ADD COLUMN correction_action  text,
  ADD COLUMN correction_reason  text;

ALTER TABLE attendance_events
  ADD CONSTRAINT attendance_events_correction_target_fkey
    FOREIGN KEY (corrects_event_id, workspace_id)
    REFERENCES attendance_events (id, workspace_id) ON DELETE RESTRICT;

ALTER TABLE attendance_events
  ADD CONSTRAINT attendance_events_correction_action_values
    CHECK (correction_action IS NULL OR correction_action IN ('adjust', 'void', 'add'));

-- 修正イベントと通常の打刻を取り違えないよう、整合する組み合わせだけを許す。
ALTER TABLE attendance_events
  ADD CONSTRAINT attendance_events_correction_shape CHECK (
    (correction_action IS NULL AND corrects_event_id IS NULL AND correction_reason IS NULL
      AND source <> 'correction')
    OR (correction_action IN ('adjust', 'void') AND corrects_event_id IS NOT NULL
      AND correction_reason IS NOT NULL AND source = 'correction')
    OR (correction_action = 'add' AND corrects_event_id IS NULL
      AND correction_reason IS NOT NULL AND source = 'correction')
  );

ALTER TABLE attendance_events
  ADD CONSTRAINT attendance_events_correction_reason_length
    CHECK (correction_reason IS NULL OR char_length(btrim(correction_reason)) BETWEEN 2 AND 500);

-- 自分自身を対象にした修正は作れない。
ALTER TABLE attendance_events
  ADD CONSTRAINT attendance_events_correction_not_self
    CHECK (corrects_event_id IS DISTINCT FROM id);

CREATE INDEX attendance_events_correction_target_idx
  ON attendance_events (workspace_id, corrects_event_id)
  WHERE corrects_event_id IS NOT NULL;
