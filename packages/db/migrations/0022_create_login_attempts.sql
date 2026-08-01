-- ログインの失敗を数え、続いたら受け付けを断る。
--
-- 変更前は、失敗の回数も送信元も記録していなかった。照合は scrypt で行うため、
-- 誤ったパスワードを送るだけで確実に計算資源を使わせられ、推測も妨げられない。
--
-- 識別子（メールアドレス・送信元アドレス）はそのまま保存せず、ハッシュで持つ。
-- 数えるために要るのは同一性だけであり、元の値は要らない。
--
-- 数える単位は 2 つ。
--   account: ワークスペースと利用者の組。特定の利用者への総当たりを止める。
--   source:  送信元アドレス。多数の利用者へ少しずつ試す形を止める。

CREATE TABLE login_attempts (
  -- 数える単位。
  scope             text        NOT NULL,
  -- 単位の中で相手を区別する値のハッシュ。
  key_hash          text        NOT NULL,
  -- 現在の窓の中で数えた失敗の回数。
  failures          integer     NOT NULL DEFAULT 0,
  -- 数え始めた時刻。ここから一定時間が過ぎたら数え直す。
  window_started_at timestamptz NOT NULL,
  -- 受け付けを断る期限。null なら断っていない。
  blocked_until     timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key_hash),
  CONSTRAINT login_attempts_scope_values CHECK (scope IN ('account', 'source')),
  CONSTRAINT login_attempts_failures_non_negative CHECK (failures >= 0)
);

-- 使われなくなった行を掃除するために、更新時刻から引けるようにする。
CREATE INDEX login_attempts_updated_idx ON login_attempts (updated_at);
