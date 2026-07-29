-- 組織構造と認証。
--
-- テナント境界を SQL 層で保証するため、業務データはすべて workspace_id を持ち、
-- 参照は (id, workspace_id) の複合キーで結ぶ。
-- これにより、別ワークスペースのレコードを参照する行はそもそも作れない。

CREATE TABLE organizations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  code            text        NOT NULL,
  name            text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organizations_code_format CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'),
  CONSTRAINT organizations_id_workspace_key UNIQUE (id, workspace_id)
);

CREATE UNIQUE INDEX organizations_workspace_code_key ON organizations (workspace_id, code);

CREATE TABLE sites (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  organization_id uuid        NOT NULL,
  code            text        NOT NULL,
  name            text        NOT NULL,
  -- 拠点ごとに業務日の判定が変わりうるため、拠点にもタイムゾーンを持たせる。
  time_zone       text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sites_code_format CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'),
  CONSTRAINT sites_id_workspace_key UNIQUE (id, workspace_id),
  CONSTRAINT sites_organization_fkey
    FOREIGN KEY (organization_id, workspace_id)
    REFERENCES organizations (id, workspace_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX sites_workspace_organization_code_key
  ON sites (workspace_id, organization_id, code);

CREATE TABLE departments (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  organization_id      uuid        NOT NULL,
  parent_department_id uuid,
  code                 text        NOT NULL,
  name                 text        NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT departments_code_format CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'),
  CONSTRAINT departments_not_own_parent CHECK (parent_department_id IS DISTINCT FROM id),
  CONSTRAINT departments_id_workspace_key UNIQUE (id, workspace_id),
  CONSTRAINT departments_organization_fkey
    FOREIGN KEY (organization_id, workspace_id)
    REFERENCES organizations (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT departments_parent_fkey
    FOREIGN KEY (parent_department_id, workspace_id)
    REFERENCES departments (id, workspace_id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX departments_workspace_organization_code_key
  ON departments (workspace_id, organization_id, code);

CREATE TABLE users (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  -- 正規化済み（小文字・前後空白なし）のメールアドレス。
  email         text        NOT NULL,
  password_hash text        NOT NULL,
  display_name  text        NOT NULL,
  locale        text        NOT NULL DEFAULT 'ja-JP',
  status        text        NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_status_values CHECK (status IN ('active', 'suspended')),
  CONSTRAINT users_locale_values CHECK (locale IN ('ja-JP', 'en')),
  CONSTRAINT users_email_normalized CHECK (email = lower(btrim(email))),
  CONSTRAINT users_id_workspace_key UNIQUE (id, workspace_id)
);

CREATE UNIQUE INDEX users_workspace_email_key ON users (workspace_id, email);

CREATE TABLE user_roles (
  workspace_id uuid        NOT NULL,
  user_id      uuid        NOT NULL,
  role         text        NOT NULL,
  granted_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id, role),
  CONSTRAINT user_roles_values
    CHECK (role IN ('workspace_admin', 'organization_manager', 'employee')),
  CONSTRAINT user_roles_user_fkey
    FOREIGN KEY (user_id, workspace_id)
    REFERENCES users (id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE employees (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  organization_id       uuid        NOT NULL,
  -- ログインしない従業員も登録できるようにするため、利用者は任意。
  user_id               uuid,
  employee_number       text        NOT NULL,
  display_name          text        NOT NULL,
  primary_site_id       uuid,
  primary_department_id uuid,
  hired_on              date,
  status                text        NOT NULL DEFAULT 'active',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employees_number_format CHECK (employee_number ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'),
  CONSTRAINT employees_status_values CHECK (status IN ('active', 'suspended', 'retired')),
  CONSTRAINT employees_id_workspace_key UNIQUE (id, workspace_id),
  CONSTRAINT employees_organization_fkey
    FOREIGN KEY (organization_id, workspace_id)
    REFERENCES organizations (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT employees_user_fkey
    FOREIGN KEY (user_id, workspace_id)
    REFERENCES users (id, workspace_id) ON DELETE SET NULL,
  CONSTRAINT employees_site_fkey
    FOREIGN KEY (primary_site_id, workspace_id)
    REFERENCES sites (id, workspace_id) ON DELETE SET NULL,
  CONSTRAINT employees_department_fkey
    FOREIGN KEY (primary_department_id, workspace_id)
    REFERENCES departments (id, workspace_id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX employees_workspace_organization_number_key
  ON employees (workspace_id, organization_id, employee_number);

-- 一人の利用者が複数の従業員に結び付かないようにする。
CREATE UNIQUE INDEX employees_workspace_user_key
  ON employees (workspace_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE TABLE sessions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL,
  user_id      uuid        NOT NULL,
  -- 生のトークンは保存せず、照合可能なハッシュだけを保持する。
  token_hash   text        NOT NULL,
  issued_at    timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sessions_user_fkey
    FOREIGN KEY (user_id, workspace_id)
    REFERENCES users (id, workspace_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX sessions_token_hash_key ON sessions (token_hash);
CREATE INDEX sessions_user_idx ON sessions (workspace_id, user_id);
