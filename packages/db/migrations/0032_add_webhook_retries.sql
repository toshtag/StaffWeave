-- 送信の再試行と、諦めた行の置き場。
--
-- これまでは、送れなかった通知をその場で完了扱いにしていた。
-- 受け取り側が数分止まっただけで通知が落ち、落ちたことは履歴を見ないと分からない。
--
-- 失敗したら間を空けて送り直す。間隔は試行のたびに広げる。
-- 広げないと、止まっている相手へ送り続けて、相手の復旧を妨げる。
--
-- 決めた回数を超えたら諦め、行を残したまま「諦めた」印を付ける。
-- 消すと、届かなかったこと自体が分からなくなる。
-- 諦めた行は、人が中身を確かめてから手で送り直せる。

ALTER TABLE webhook_outbox
  -- 送信を試みた回数。次にいつ送るかを決めるのに使う。
  ADD COLUMN attempts integer NOT NULL DEFAULT 0,
  -- 諦めた時刻。入っている行は自動では送らない。
  ADD COLUMN abandoned_at timestamptz,
  -- 最後の失敗の理由。人が手で送り直すかを判断するために残す。
  ADD COLUMN last_error text;

ALTER TABLE webhook_outbox
  ADD CONSTRAINT webhook_outbox_attempts_not_negative CHECK (attempts >= 0),
  -- 完了した行と諦めた行は両立しない。
  -- 両方に印が付くと、送れたのか諦めたのかが読めなくなる。
  ADD CONSTRAINT webhook_outbox_terminal_state
    CHECK (completed_at IS NULL OR abandoned_at IS NULL);

-- ワーカーが走査するのは、まだ終わっていない行だけ。
-- 諦めた行を毎回読み飛ばすと、溜まるほど走査が重くなる。
DROP INDEX webhook_outbox_pending_idx;
CREATE INDEX webhook_outbox_pending_idx
  ON webhook_outbox (available_at, created_at)
  WHERE completed_at IS NULL AND abandoned_at IS NULL;

-- 諦めた行は人が探す。件数は多くないが、探す経路は用意しておく。
CREATE INDEX webhook_outbox_abandoned_idx
  ON webhook_outbox (workspace_id, abandoned_at DESC)
  WHERE abandoned_at IS NOT NULL;

-- 送信の履歴へ、何回目の試行だったかを残す。
-- 履歴だけを見て「1 回で通ったのか、5 回目で通ったのか」が分かるようにする。
ALTER TABLE webhook_deliveries
  ADD COLUMN attempt integer NOT NULL DEFAULT 1;

ALTER TABLE webhook_deliveries
  ADD CONSTRAINT webhook_deliveries_attempt_positive CHECK (attempt >= 1);
