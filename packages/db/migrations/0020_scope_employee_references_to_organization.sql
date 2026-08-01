-- 従業員の主拠点・主部門と、部門の親を、同じ組織のものに限る。
--
-- ワークスペース境界は複合外部キーで守っているが、組織のまとまりは守っていなかった。
-- 別の組織の拠点を主拠点にできると、その拠点のタイムゾーンで業務日が決まり、
-- 日跨ぎ勤務の判定がずれる。閲覧範囲も所属組織から導くため、判定が意図とずれる。
--
-- 参照先へ組織を含む一意キーを足し、参照する側の組織と一致することを外部キーで表す。

ALTER TABLE sites
  ADD CONSTRAINT sites_id_workspace_organization_key UNIQUE (id, workspace_id, organization_id);

ALTER TABLE departments
  ADD CONSTRAINT departments_id_workspace_organization_key
  UNIQUE (id, workspace_id, organization_id);

-- 組織をまたぐ参照が残っていると制約を足せない。
-- どの組織が正しいかは業務の判断であり、移行で決めてよいものではないため、
-- 該当する行を示して止める。
DO $$
DECLARE
  mismatched text;
BEGIN
  SELECT string_agg(DISTINCT description, ' / ') INTO mismatched FROM (
    SELECT 'employees.primary_site_id: ' || employees.id::text AS description
      FROM employees
      JOIN sites ON sites.id = employees.primary_site_id
     WHERE sites.organization_id <> employees.organization_id
    UNION ALL
    SELECT 'employees.primary_department_id: ' || employees.id::text
      FROM employees
      JOIN departments ON departments.id = employees.primary_department_id
     WHERE departments.organization_id <> employees.organization_id
    UNION ALL
    SELECT 'departments.parent_department_id: ' || child.id::text
      FROM departments AS child
      JOIN departments AS parent ON parent.id = child.parent_department_id
     WHERE parent.organization_id <> child.organization_id
  ) AS mismatches;

  IF mismatched IS NOT NULL THEN
    RAISE EXCEPTION
      '組織をまたぐ参照が残っています（% ）。'
      '正しい組織を決め、参照先を直すか参照を外してから、もう一度実行してください。',
      mismatched
      USING ERRCODE = 'data_exception';
  END IF;
END $$;

-- 参照先が消えたときに空にするのは参照そのものだけにする。
-- 組織とワークスペースは従業員自身の属性であり、参照先の都合で消さない。
ALTER TABLE employees DROP CONSTRAINT employees_site_fkey;
ALTER TABLE employees
  ADD CONSTRAINT employees_site_fkey
  FOREIGN KEY (primary_site_id, workspace_id, organization_id)
  REFERENCES sites (id, workspace_id, organization_id)
  ON DELETE SET NULL (primary_site_id);

ALTER TABLE employees DROP CONSTRAINT employees_department_fkey;
ALTER TABLE employees
  ADD CONSTRAINT employees_department_fkey
  FOREIGN KEY (primary_department_id, workspace_id, organization_id)
  REFERENCES departments (id, workspace_id, organization_id)
  ON DELETE SET NULL (primary_department_id);

ALTER TABLE departments DROP CONSTRAINT departments_parent_fkey;
ALTER TABLE departments
  ADD CONSTRAINT departments_parent_fkey
  FOREIGN KEY (parent_department_id, workspace_id, organization_id)
  REFERENCES departments (id, workspace_id, organization_id)
  ON DELETE SET NULL (parent_department_id);
