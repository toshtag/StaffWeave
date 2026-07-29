-- 雇用元と受入組織、契約と配属、勤務先別の閲覧権限。
--
-- 従業員が所属する組織（雇用元）と、実際に働く組織（受入組織）は同じとは限らない。
-- 派遣や出向では別々になり、勤怠を見てよい人も両方に現れる。

CREATE TABLE assignment_contracts (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  code                     text        NOT NULL,
  name                     text        NOT NULL,
  employer_organization_id uuid        NOT NULL,
  host_organization_id     uuid        NOT NULL,
  starts_on                date        NOT NULL,
  ends_on                  date,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assignment_contracts_code_format CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'),
  CONSTRAINT assignment_contracts_period CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT assignment_contracts_id_workspace_key UNIQUE (id, workspace_id),
  CONSTRAINT assignment_contracts_employer_fkey
    FOREIGN KEY (employer_organization_id, workspace_id)
    REFERENCES organizations (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT assignment_contracts_host_fkey
    FOREIGN KEY (host_organization_id, workspace_id)
    REFERENCES organizations (id, workspace_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX assignment_contracts_workspace_code_key
  ON assignment_contracts (workspace_id, code);

CREATE TABLE employee_assignments (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  employee_id            uuid        NOT NULL,
  assignment_contract_id uuid        NOT NULL,
  workplace_site_id      uuid,
  starts_on              date        NOT NULL,
  ends_on                date,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_assignments_period CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT employee_assignments_employee_fkey
    FOREIGN KEY (employee_id, workspace_id)
    REFERENCES employees (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT employee_assignments_contract_fkey
    FOREIGN KEY (assignment_contract_id, workspace_id)
    REFERENCES assignment_contracts (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT employee_assignments_site_fkey
    FOREIGN KEY (workplace_site_id, workspace_id)
    REFERENCES sites (id, workspace_id) ON DELETE SET NULL
);

CREATE INDEX employee_assignments_employee_idx
  ON employee_assignments (workspace_id, employee_id, starts_on);

-- 勤務先別の閲覧権限。
-- 行を持たない利用者はワークスペース全体を見られる（管理者を想定）。
-- 行を持つ利用者は、その組織が雇用元か受入組織である従業員だけを見られる。
-- 受入組織側の承認者（外部承認者）もこの仕組みで表す。
CREATE TABLE user_organization_scopes (
  workspace_id    uuid        NOT NULL,
  user_id         uuid        NOT NULL,
  organization_id uuid        NOT NULL,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id, organization_id),
  CONSTRAINT user_organization_scopes_user_fkey
    FOREIGN KEY (user_id, workspace_id)
    REFERENCES users (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT user_organization_scopes_organization_fkey
    FOREIGN KEY (organization_id, workspace_id)
    REFERENCES organizations (id, workspace_id) ON DELETE CASCADE
);
