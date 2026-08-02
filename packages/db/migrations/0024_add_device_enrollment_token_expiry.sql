-- 端末の登録トークンへ有効期限を持たせる。
--
-- これまで登録トークンは、端末が登録されるか失効するまで期限なく使えた。
-- 漏えいした未使用トークンを、時間が経ってから使って端末になりすませる。
-- カードの登録トークン（0008）は当初から期限を持っており、端末だけが異なっていた。
--
-- 既存の登録待ち端末は、作成時刻から既定の有効時間を足した値を期限とする。
-- すでにその時間を過ぎているトークンは、この移行の時点で使えなくなる。
-- 期限を延ばして残すこともできるが、それでは漏えい済みのトークンを
-- 使える状態のまま引き継ぐことになる。使えなくなった端末は、
-- 失効させたうえで登録し直す。

ALTER TABLE devices
  ADD COLUMN enrollment_token_expires_at timestamptz;

UPDATE devices
   SET enrollment_token_expires_at = created_at + interval '15 minutes'
 WHERE enrollment_token_hash IS NOT NULL;

-- 登録トークンを持つ行は必ず期限を持ち、持たない行は期限も持たない。
-- 片方だけがある状態を、期限の確認を書き忘れた実装が作れないようにする。
ALTER TABLE devices
  ADD CONSTRAINT devices_enrollment_token_needs_expiry
  CHECK (
    (enrollment_token_hash IS NULL AND enrollment_token_expires_at IS NULL)
    OR (enrollment_token_hash IS NOT NULL AND enrollment_token_expires_at IS NOT NULL)
  );
