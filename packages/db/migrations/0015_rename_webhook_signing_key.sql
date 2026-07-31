-- Webhook の保存値は照合用のハッシュではなく、実際に署名を生成できる鍵である。
-- 0013 では secret_hash と名付け「以後はハッシュで照合する」と説明したが、
-- 対称鍵の HMAC である以上、送信側は署名を作れる値を持たざるを得ない。
-- 既存の値は変えず、役割に一致する名称へ改める。既存の送信先の署名は変わらない。

ALTER TABLE webhook_endpoints
  RENAME COLUMN secret_hash TO signing_key;

ALTER TABLE webhook_endpoints
  ADD CONSTRAINT webhook_endpoints_signing_key_format
  CHECK (signing_key ~ '^[0-9a-f]{64}$');

COMMENT ON COLUMN webhook_endpoints.signing_key IS
  'Webhook の HMAC 署名を生成できる機密鍵。DB 読取権限を持つ者は署名を生成できる';
