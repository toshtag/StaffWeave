-- 打刻時の位置情報。
--
-- 既定では取得しない。組織ごとに opt-in したときだけ受け取る。
-- 位置情報は、そこに居たことを示す記録であり、勤怠の記録とは重みが違う。
-- 全員から常に集める形にはしない。
--
-- 打刻そのものとは別の表に持つ。同じ行に持つと、位置情報を消すために
-- 打刻の行へ触れることになり、追記のみという取り決めと衝突する。
-- 位置情報が取れなくても、打刻は必ず残る。

-- 組織ごとの opt-in。既定は取得しない。
ALTER TABLE organizations
  ADD COLUMN location_capture boolean NOT NULL DEFAULT false;

CREATE TABLE attendance_event_locations (
  event_id        uuid        PRIMARY KEY,
  workspace_id    uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  -- 緯度・経度は、丸めずに受け取った値をそのまま持つ。
  -- 丸めると、どれだけ丸めたのかを覚えていないかぎり精度を説明できない。
  latitude        numeric(9, 6)  NOT NULL,
  longitude       numeric(9, 6)  NOT NULL,
  -- 端末が申告した精度（メートル）。粗い測位と正確な測位を混ぜないために持つ。
  accuracy_meters integer     NOT NULL,
  captured_at     timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT attendance_event_locations_latitude_range
    CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT attendance_event_locations_longitude_range
    CHECK (longitude BETWEEN -180 AND 180),
  -- 精度が分からない測位は受け取らない。分からないまま持つと、
  -- 「その場に居た」の強さを誰も言えない。
  CONSTRAINT attendance_event_locations_accuracy_range
    CHECK (accuracy_meters BETWEEN 0 AND 100000),
  CONSTRAINT attendance_event_locations_event_fkey
    FOREIGN KEY (event_id, workspace_id)
    REFERENCES attendance_events (id, workspace_id) ON DELETE CASCADE
);

-- 打刻の位置情報は書き換えない。消すのは保持期間を過ぎたときだけで、
-- そのときは行ごと消す（docs/operations/retention.md）。
CREATE TRIGGER attendance_event_locations_no_update
  BEFORE UPDATE ON attendance_event_locations
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

CREATE INDEX attendance_event_locations_workspace_idx
  ON attendance_event_locations (workspace_id, captured_at);
