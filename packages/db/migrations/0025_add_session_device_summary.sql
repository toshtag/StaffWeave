-- セッションへ、端末を見分けるための要約を持たせる。
--
-- セッションの一覧に手掛かりが何も無いと、利用者は「どれが自分の PC か」を判断できず、
-- 覚えのないセッションだけを狙って失効させられない。一覧が発行時刻の並びにしかならない。
--
-- 残すのは OS・ブラウザ・端末種別の系統だけとし、生の User-Agent は保存しない。
-- 生の名乗りには版番号と端末の型番が入り、セッションが終わった後も
-- 「いつ何を使っていたか」の記録だけが積み上がる。判別に要るのは系統までで足りる。
-- 送信元アドレスも保存しない。回線によって変わるため端末の判別には弱く、
-- その一方で居場所に繋がる。
--
-- 既存のセッションは端末情報なしのままにする。名乗りは保存していないため、
-- ここで埋められる値は推測でしかない。推測を埋めると、
-- 利用者は「自分が使った覚えのある端末」として読んでしまう。

ALTER TABLE sessions
  ADD COLUMN device_os      text,
  ADD COLUMN device_browser text,
  ADD COLUMN device_kind    text;

-- 系統は決めた語だけを取る。表示用の文字列や、判別できなかった旨を表す語を
-- 値として入れられないようにする。判別できないことは NULL で表す。
ALTER TABLE sessions
  ADD CONSTRAINT sessions_device_os_values
  CHECK (device_os IS NULL OR device_os IN
    ('windows', 'macos', 'ios', 'ipados', 'android', 'chromeos', 'linux'));

ALTER TABLE sessions
  ADD CONSTRAINT sessions_device_browser_values
  CHECK (device_browser IS NULL OR device_browser IN
    ('chrome', 'safari', 'firefox', 'edge', 'opera', 'samsung'));

ALTER TABLE sessions
  ADD CONSTRAINT sessions_device_kind_values
  CHECK (device_kind IS NULL OR device_kind IN ('desktop', 'mobile', 'tablet'));

-- 一覧は「その利用者の、まだ失効していないセッション」を新しい順に読む。
-- 既存の索引は (workspace_id, user_id) までのため、セッションが増えるほど
-- 失効済みの行を読んでから捨てることになる。
CREATE INDEX sessions_user_active_idx
  ON sessions (workspace_id, user_id, issued_at DESC)
  WHERE revoked_at IS NULL;
