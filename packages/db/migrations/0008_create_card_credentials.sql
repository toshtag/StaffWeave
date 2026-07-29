-- IC カードの資格情報。
--
-- カードの生の識別子はサーバーへ送らず、保存もしない。
-- Agent が端末の中で一方向の指紋へ変換し、その指紋だけをやり取りする。
-- 指紋の計算にはサーバー側の環境変数に置いた鍵を使うため、
-- データベースの内容だけでは物理カードと結び付けられない。

CREATE TABLE card_credentials (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  employee_id            uuid        NOT NULL,
  -- 一方向の指紋（16 進 64 文字）。生の識別子は復元できない。
  fingerprint            text        NOT NULL,
  -- 利用者が見分けるための名前。「社員証」「予備カード」など。
  label                  text,
  state                  text        NOT NULL DEFAULT 'active',
  registered_at          timestamptz NOT NULL DEFAULT now(),
  registered_by_device_id uuid,
  revoked_at             timestamptz,
  revoked_by_user_id     uuid,
  CONSTRAINT card_credentials_state_values CHECK (state IN ('active', 'revoked')),
  CONSTRAINT card_credentials_fingerprint_format CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT card_credentials_id_workspace_key UNIQUE (id, workspace_id),
  CONSTRAINT card_credentials_employee_fkey
    FOREIGN KEY (employee_id, workspace_id)
    REFERENCES employees (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT card_credentials_device_fkey
    FOREIGN KEY (registered_by_device_id, workspace_id)
    REFERENCES devices (id, workspace_id) ON DELETE SET NULL,
  CONSTRAINT card_credentials_revoker_fkey
    FOREIGN KEY (revoked_by_user_id, workspace_id)
    REFERENCES users (id, workspace_id) ON DELETE SET NULL
);

-- 同じカードを二人に割り当てられないようにする。失効済みは対象外。
CREATE UNIQUE INDEX card_credentials_active_fingerprint_key
  ON card_credentials (workspace_id, fingerprint)
  WHERE state = 'active';

CREATE INDEX card_credentials_employee_idx
  ON card_credentials (workspace_id, employee_id, state);

-- カード登録は「管理者が発行した一度きりのトークン」と
-- 「端末で読み取った指紋」を突き合わせて行う。
CREATE TABLE card_registration_tokens (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  employee_id        uuid        NOT NULL,
  token_hash         text        NOT NULL,
  label              text,
  expires_at         timestamptz NOT NULL,
  used_at            timestamptz,
  created_by_user_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT card_registration_tokens_employee_fkey
    FOREIGN KEY (employee_id, workspace_id)
    REFERENCES employees (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT card_registration_tokens_creator_fkey
    FOREIGN KEY (created_by_user_id, workspace_id)
    REFERENCES users (id, workspace_id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX card_registration_tokens_hash_key
  ON card_registration_tokens (token_hash);
