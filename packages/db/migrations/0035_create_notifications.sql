-- 利用者への通知。
--
-- Webhook は外部システム向けで、利用者が「自分の申請が差し戻された」ことを
-- 知る手段にはならない。承認待ちの一覧を自分から見に行くまで、誰も気付かない。
-- 差し戻しは、気付かれなければ出し直されず、締めの直前まで残る。
--
-- 正本はこの表に置く。外部への配送を足す場合も、正本はここのままにする。
-- 外部だけに置くと、送信に失敗した通知が誰にも見えなくなる。

CREATE TABLE notifications (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  -- 宛先。読めるのは本人だけ。
  user_id       uuid        NOT NULL,
  kind          text        NOT NULL,
  -- 何についての通知か。いまは申請だけだが、種別を持たせておく。
  subject_type  text        NOT NULL,
  subject_id    uuid,
  -- 画面へそのまま出せる要約。
  summary       text        NOT NULL,
  detail        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  -- 読んだ時刻。未読なら空。
  read_at       timestamptz,

  -- 同じ出来事から二度積まないための鍵。送信側が組み立てる。
  -- 決裁の再送や画面からの二度押しで、同じ通知が並ばないようにする。
  dedupe_key    text        NOT NULL,

  CONSTRAINT notifications_kind_values
    CHECK (kind IN (
      'request_submitted',
      'request_approved',
      'request_returned',
      'request_cancelled',
      'request_decided_on_behalf'
    )),
  CONSTRAINT notifications_subject_type_values
    CHECK (subject_type IN ('employee_request')),
  CONSTRAINT notifications_summary_present CHECK (length(btrim(summary)) > 0),
  CONSTRAINT notifications_dedupe_key_length CHECK (char_length(dedupe_key) BETWEEN 1 AND 200),
  CONSTRAINT notifications_user_fkey
    FOREIGN KEY (user_id, workspace_id)
    REFERENCES users (id, workspace_id) ON DELETE CASCADE
);

-- 同じ宛先へ、同じ出来事の通知を二度積まない。
CREATE UNIQUE INDEX notifications_dedupe_key
  ON notifications (workspace_id, user_id, dedupe_key);

-- 自分あての新しい順。未読だけを引くときも同じ索引で足りる。
CREATE INDEX notifications_inbox_idx
  ON notifications (workspace_id, user_id, occurred_at DESC);
