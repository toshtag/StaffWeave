-- ワークスペース: すべての業務データが所属するテナント境界。
-- セルフホストでは通常 1 件だが、同一コードベースで SaaS 運用できるよう最初から分離しておく。

CREATE TABLE workspaces (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text        NOT NULL,
  name        text        NOT NULL,
  -- 業務日の判定に使うタイムゾーン（IANA 名）。
  time_zone   text        NOT NULL DEFAULT 'Asia/Tokyo',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspaces_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$')
);

CREATE UNIQUE INDEX workspaces_slug_key ON workspaces (slug);
