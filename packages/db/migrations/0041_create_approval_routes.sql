-- 承認の経路を、段数ではなく段ごとの承認者まで固定する。
--
-- いま snapshot しているのは total_steps だけで、各段の承認者も承認の方針も
-- 持っていない。attendance.approve と対象者の閲覧範囲を持つ利用者なら、
-- 1 段目も 4 段目も同じように通せる。段を分けた意味が無い。
--
-- また on_behalf_of_user_id は「本来の承認者」として保存されるが、その人物が
-- 実際にその段の承認者か、代理を任されているかを誰も確かめていない。
-- 監査上の帰属を、決裁する側が好きに書ける。

-- 申請種別の段ごとの承認者。
--
-- 承認者は「この利用者」と「この方針に当てはまる利用者」の 2 通りで表す。
-- 利用者を直に指すと、その人が辞めた時点で経路が止まる。方針だけにすると、
-- 誰が承認したのかを事前に説明できない。両方を持てるようにする。
CREATE TABLE request_type_steps (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid    NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  request_type_id  uuid    NOT NULL,
  step             integer NOT NULL,
  -- この段の承認者。方針で決める場合は空。
  approver_user_id uuid,
  -- 承認者の決め方。利用者を直に指す場合は 'user'。
  approver_policy  text    NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT request_type_steps_step_range CHECK (step BETWEEN 1 AND 4),
  CONSTRAINT request_type_steps_policy_values
    CHECK (approver_policy IN
      ('user', 'organization_manager', 'workspace_admin', 'any_approver')),
  -- 'user' のときだけ利用者を指す。方針と利用者が両方あると、どちらが正本か決まらない。
  CONSTRAINT request_type_steps_user_pair
    CHECK ((approver_policy = 'user') = (approver_user_id IS NOT NULL)),
  CONSTRAINT request_type_steps_once_key UNIQUE (workspace_id, request_type_id, step),
  CONSTRAINT request_type_steps_type_fkey
    FOREIGN KEY (request_type_id, workspace_id)
    REFERENCES request_types (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT request_type_steps_approver_fkey
    FOREIGN KEY (approver_user_id, workspace_id)
    REFERENCES users (id, workspace_id) ON DELETE RESTRICT
);

-- 提出した時点の経路。
--
-- 定義を参照したままだと、承認の途中で経路を変えられたときに、決裁済みの段の
-- 承認者が入れ替わる。提出のたびに写し、その申請の間は動かさない。
--
-- 出し直しでは新しい提出として写し直す。差し戻したあとに経路を直した場合、
-- 直した経路で承認し直せることを期待する運用が自然なため。
CREATE TABLE employee_request_steps (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid    NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  request_id       uuid    NOT NULL,
  submission       integer NOT NULL,
  step             integer NOT NULL,
  approver_user_id uuid,
  approver_policy  text    NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT employee_request_steps_step_range CHECK (step BETWEEN 1 AND 4),
  CONSTRAINT employee_request_steps_policy_values
    CHECK (approver_policy IN
      ('user', 'organization_manager', 'workspace_admin', 'any_approver')),
  CONSTRAINT employee_request_steps_user_pair
    CHECK ((approver_policy = 'user') = (approver_user_id IS NOT NULL)),
  CONSTRAINT employee_request_steps_once_key
    UNIQUE (workspace_id, request_id, submission, step),
  CONSTRAINT employee_request_steps_request_fkey
    FOREIGN KEY (request_id, workspace_id)
    REFERENCES employee_requests (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT employee_request_steps_approver_fkey
    FOREIGN KEY (approver_user_id, workspace_id)
    REFERENCES users (id, workspace_id) ON DELETE SET NULL
);

-- 承認の委任。
--
-- 代理で決裁するには、任せた側の記録が要る。記録が無いまま「本来の承認者」を
-- 書けると、監査は決裁する側の申告をそのまま信じることになる。
CREATE TABLE approval_delegations (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  -- 任せた側（本来の承認者）。
  from_user_id   uuid        NOT NULL,
  -- 任された側（代理で決裁する人）。
  to_user_id     uuid        NOT NULL,
  effective_from date        NOT NULL,
  effective_to   date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid,

  CONSTRAINT approval_delegations_not_self CHECK (from_user_id <> to_user_id),
  CONSTRAINT approval_delegations_period_order
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT approval_delegations_from_fkey
    FOREIGN KEY (from_user_id, workspace_id)
    REFERENCES users (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT approval_delegations_to_fkey
    FOREIGN KEY (to_user_id, workspace_id)
    REFERENCES users (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT approval_delegations_creator_fkey
    FOREIGN KEY (created_by_user_id, workspace_id)
    REFERENCES users (id, workspace_id) ON DELETE SET NULL
);

CREATE INDEX approval_delegations_lookup_idx
  ON approval_delegations (workspace_id, to_user_id, effective_from DESC);

-- すでにある申請種別へ、いまの挙動と同じ経路を置く。
--
-- これまでは attendance.approve と対象者の閲覧範囲を持つ利用者なら、どの段も
-- 通せた。それを 'any_approver' として明示的に置く。移行だけで承認できなく
-- なると、承認待ちの申請が止まる。
--
-- 'any_approver' は「この段は誰でも通せる」という設定であり、設定の画面に
-- そのまま現れる。暗黙のままにせず、置き換えるべきものとして見えるようにする。
INSERT INTO request_type_steps (workspace_id, request_type_id, step, approver_policy)
SELECT request_types.workspace_id,
       request_types.id,
       step.value,
       'any_approver'
  FROM request_types,
       generate_series(1, request_types.approval_steps) AS step (value);

-- すでに出ている申請にも、いまの経路を写す。
-- 写さないと、この移行の前に出した申請が決裁できなくなる。
INSERT INTO employee_request_steps
  (workspace_id, request_id, submission, step, approver_policy)
SELECT employee_requests.workspace_id,
       employee_requests.id,
       submission.value,
       step.value,
       'any_approver'
  FROM employee_requests,
       generate_series(1, employee_requests.total_steps) AS step (value),
       generate_series(
         1,
         greatest(
           1,
           (SELECT coalesce(max(approvals.submission), 1)
              FROM employee_request_approvals AS approvals
             WHERE approvals.request_id = employee_requests.id)
         )
       ) AS submission (value);
