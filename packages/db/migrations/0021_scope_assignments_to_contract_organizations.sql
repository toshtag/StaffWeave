-- 配属を、契約が定める組織の中へ閉じる。あわせて同じ従業員の配属期間が重ならないようにする。
--
-- 契約は「雇用元」と「受入組織」を持つ。配属はその契約に基づくため、
-- 配属される従業員は雇用元に所属し、勤務拠点は受入組織のものでなければならない。
-- 変更前はどちらもワークスペースが同じであることしか要求しておらず、
-- 無関係な組織の従業員や拠点を結び付けられた。
--
-- 閲覧範囲は雇用元と受入組織から導くため、ここが壊れていると誰が見えるかが変わる。
--
-- 契約の組織は配属の属性ではないが、外部キーで一致を表すために持たせる。
-- 値は契約から複製し、契約への外部キーで契約と食い違わないようにする。

ALTER TABLE employees
  ADD CONSTRAINT employees_id_workspace_organization_key
  UNIQUE (id, workspace_id, organization_id);

ALTER TABLE assignment_contracts
  ADD CONSTRAINT assignment_contracts_id_workspace_employer_key
  UNIQUE (id, workspace_id, employer_organization_id);

ALTER TABLE assignment_contracts
  ADD CONSTRAINT assignment_contracts_id_workspace_host_key
  UNIQUE (id, workspace_id, host_organization_id);

ALTER TABLE employee_assignments
  -- 契約の雇用元。従業員の所属組織と一致することを外部キーで表すために持つ。
  ADD COLUMN employer_organization_id uuid,
  -- 契約の受入組織。勤務拠点がこの組織にあることを外部キーで表すために持つ。
  ADD COLUMN host_organization_id     uuid;

UPDATE employee_assignments AS assignments
   SET employer_organization_id = contracts.employer_organization_id,
       host_organization_id = contracts.host_organization_id
  FROM assignment_contracts AS contracts
 WHERE contracts.id = assignments.assignment_contract_id;

-- 組織の食い違いや期間の重なりが残っていると制約を足せない。
-- どちらが正しいかは業務の判断であり、移行で決めてよいものではないため、
-- 該当する配属を示して止める。
DO $$
DECLARE
  problems text;
BEGIN
  SELECT string_agg(DISTINCT description, ' / ') INTO problems FROM (
    SELECT '雇用元と所属組織の不一致: ' || assignments.id::text AS description
      FROM employee_assignments AS assignments
      JOIN employees ON employees.id = assignments.employee_id
     WHERE employees.organization_id <> assignments.employer_organization_id
    UNION ALL
    SELECT '受入組織にない勤務拠点: ' || assignments.id::text
      FROM employee_assignments AS assignments
      JOIN sites ON sites.id = assignments.workplace_site_id
     WHERE sites.organization_id <> assignments.host_organization_id
    UNION ALL
    SELECT '期間の重なり: ' || a.id::text
      FROM employee_assignments AS a
      JOIN employee_assignments AS b
        ON b.workspace_id = a.workspace_id
       AND b.employee_id = a.employee_id
       AND b.id <> a.id
     WHERE daterange(a.starts_on, a.ends_on, '[]') && daterange(b.starts_on, b.ends_on, '[]')
  ) AS mismatches;

  IF problems IS NOT NULL THEN
    RAISE EXCEPTION
      '配属に整合しない組み合わせが残っています（% ）。'
      '正しい内容を決めて直してから、もう一度実行してください。',
      problems
      USING ERRCODE = 'data_exception';
  END IF;
END $$;

ALTER TABLE employee_assignments
  ALTER COLUMN employer_organization_id SET NOT NULL,
  ALTER COLUMN host_organization_id SET NOT NULL;

-- 従業員は契約の雇用元に所属している。
ALTER TABLE employee_assignments DROP CONSTRAINT employee_assignments_employee_fkey;
ALTER TABLE employee_assignments
  ADD CONSTRAINT employee_assignments_employee_fkey
  FOREIGN KEY (employee_id, workspace_id, employer_organization_id)
  REFERENCES employees (id, workspace_id, organization_id) ON DELETE CASCADE;

-- 複製した組織は契約のものと同じでなければならない。雇用元と受入組織の両方を見る。
ALTER TABLE employee_assignments DROP CONSTRAINT employee_assignments_contract_fkey;
ALTER TABLE employee_assignments
  ADD CONSTRAINT employee_assignments_contract_employer_fkey
  FOREIGN KEY (assignment_contract_id, workspace_id, employer_organization_id)
  REFERENCES assignment_contracts (id, workspace_id, employer_organization_id) ON DELETE CASCADE;
ALTER TABLE employee_assignments
  ADD CONSTRAINT employee_assignments_contract_host_fkey
  FOREIGN KEY (assignment_contract_id, workspace_id, host_organization_id)
  REFERENCES assignment_contracts (id, workspace_id, host_organization_id) ON DELETE CASCADE;

-- 勤務拠点は受入組織のもの。拠点が消えたときに空にするのは勤務拠点だけにする。
ALTER TABLE employee_assignments DROP CONSTRAINT employee_assignments_site_fkey;
ALTER TABLE employee_assignments
  ADD CONSTRAINT employee_assignments_site_fkey
  FOREIGN KEY (workplace_site_id, workspace_id, host_organization_id)
  REFERENCES sites (id, workspace_id, organization_id)
  ON DELETE SET NULL (workplace_site_id);

-- 同じ従業員の配属期間は重ならない。終了日の無い配属は、その日以降ずっと続くものとして見る。
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE employee_assignments
  ADD CONSTRAINT employee_assignments_no_overlap
  EXCLUDE USING gist (
    workspace_id WITH =,
    employee_id WITH =,
    daterange(starts_on, ends_on, '[]') WITH &&
  );
