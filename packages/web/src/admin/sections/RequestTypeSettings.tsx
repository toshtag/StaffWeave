import type {
  ApprovalStepRecord,
  Employee,
  RequestCategory,
  RequestTypeRecord,
} from '@staffweave/contracts';
import { REQUEST_CATEGORIES } from '@staffweave/contracts';
import type { ApproverPolicy } from '@staffweave/domain';
import { APPROVER_POLICIES } from '@staffweave/domain';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { useLocale } from '../../i18n/LocaleProvider.tsx';
import type { SectionProps } from '../AdminConsole.tsx';
import {
  CheckboxField,
  type Column,
  FormValidationError,
  SelectField,
  TextField,
} from '../resource.tsx';
import { SettingsSection } from '../SettingsSection.tsx';

/**
 * 申請種別と承認経路。
 *
 * 段数だけを決めても、経路を決めたことにはならない。段ごとの承認者が無ければ、
 * 承認の権限を持つ利用者はどの段も同じように通せる。段を分けた意味が無い。
 *
 * 段数を変えても、すでに提出された申請は提出したときの経路のまま進む。
 * 進行中の申請の経路が動くと、承認した段が消えたり、
 * 承認していない段が現れたりする。
 */
export function RequestTypeSettings({ permissions }: SectionProps): React.JSX.Element {
  const { messages } = useLocale();
  const labels = messages.admin;
  const [editing, setEditing] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<RequestCategory>('leave');
  const [approvalSteps, setApprovalSteps] = useState('1');
  const [requiresReason, setRequiresReason] = useState(true);
  const [requiresLeaveType, setRequiresLeaveType] = useState(false);
  const [requiresTimeRange, setRequiresTimeRange] = useState(false);
  const [requiresOvertimeLimit, setRequiresOvertimeLimit] = useState(false);
  const [active, setActive] = useState(true);
  const [route, setRoute] = useState<ApprovalStepRecord[]>([]);
  const [approvers, setApprovers] = useState<{ id: string; label: string }[]>([]);

  const canWrite = permissions.includes('request.manage');

  // 承認者に指名できるのは、この画面を扱える相手と同じ範囲の利用者。
  // 従業員の一覧から、利用者が紐づいているものだけを出す。
  useEffect(() => {
    if (!canWrite) return;
    void api
      .listEmployees()
      .then(({ employees }) =>
        setApprovers(
          employees
            .filter((employee: Employee) => employee.userId !== null)
            .map((employee: Employee) => ({
              id: employee.userId as string,
              label: `${employee.employeeNumber} ${employee.displayName}`,
            })),
        ),
      )
      .catch(() => setApprovers([]));
  }, [canWrite]);

  /**
   * 段数に合わせて経路の行を作る。置いていない段は未設定のまま出す。
   *
   * 既定の承認者で埋めない。埋めると、決めた覚えのない承認者が保存される。
   */
  const routeRows = (count: number): (ApprovalStepRecord | { step: number })[] =>
    Array.from({ length: count }, (_unused, index) => {
      const step = index + 1;
      return route.find((entry) => entry.step === step) ?? { step };
    });

  /** 送れる形になっているか。未設定の段が 1 つでもあれば送らない。 */
  const completeRoute = (count: number): ApprovalStepRecord[] | null => {
    const rows = routeRows(count);
    return rows.every((row): row is ApprovalStepRecord => 'approverPolicy' in row)
      ? (rows as ApprovalStepRecord[])
      : null;
  };

  const updateStep = (step: number, change: Partial<ApprovalStepRecord>): void => {
    const rows = routeRows(Number(approvalSteps) || 1).map((entry) =>
      entry.step === step ? { approverUserId: null, ...entry, ...change } : entry,
    );
    setRoute(rows.filter((row): row is ApprovalStepRecord => 'approverPolicy' in row));
  };

  const columns: Column<RequestTypeRecord>[] = [
    { key: 'code', header: labels.code, value: (row) => row.code },
    { key: 'name', header: labels.name, value: (row) => row.name },
    {
      key: 'category',
      header: labels.requestCategory,
      value: (row) => labels.requestCategoryLabel[row.category],
    },
    { key: 'steps', header: labels.approvalSteps, value: (row) => row.approvalSteps },
    {
      key: 'requires',
      header: labels.requiredInputs,
      value: (row) =>
        [
          row.requiresReason ? labels.reason : null,
          row.requiresLeaveType ? labels.leaveType : null,
          row.requiresTimeRange ? labels.timeRange : null,
          row.requiresOvertimeLimit ? labels.overtimeLimit : null,
        ]
          .filter((label): label is string => label !== null)
          .join(' '),
    },
    {
      key: 'active',
      header: labels.activeLabel,
      value: (row) => (row.active ? labels.yes : labels.no),
    },
  ];

  const load = useCallback(async () => (await api.listRequestTypes()).requestTypes, []);

  // 休暇の区分では、どの休暇種別かが決まらないと台帳へ反映できない。
  const leaveNeedsType = category === 'leave';

  return (
    <SettingsSection
      title={labels.sectionRequestTypes}
      hint={labels.requestTypesHint}
      csvName="request-types"
      columns={columns}
      rowKey={(row) => row.id}
      load={load}
      canRead={permissions.includes('request.manage')}
      importCsv={api.importRequestTypesCsv}
      canWrite={canWrite}
      emptyMessage={labels.noRequestTypes}
      copyLabel={labels.editRow}
      formTitle={editing === null ? labels.addNew : labels.editSettings}
      onCopy={(row) => {
        setEditing(row.id);
        setCode(row.code);
        setName(row.name);
        setCategory(row.category);
        setApprovalSteps(String(row.approvalSteps));
        setRequiresReason(row.requiresReason);
        setRequiresLeaveType(row.requiresLeaveType);
        setRequiresTimeRange(row.requiresTimeRange);
        setRequiresOvertimeLimit(row.requiresOvertimeLimit);
        setActive(row.active);
        void api
          .getApprovalRoute(row.id)
          .then((response) => setRoute(response.steps))
          .catch(() => setRoute([]));
      }}
      submit={async () => {
        const shape = {
          name,
          approvalSteps: Number(approvalSteps),
          requiresReason,
          requiresLeaveType: leaveNeedsType || requiresLeaveType,
          requiresTimeRange,
          requiresOvertimeLimit,
        };
        const steps = completeRoute(Number(approvalSteps) || 1);
        // 未設定の段があるまま送らない。送れてしまうと、設定の画面では正しく
        // 見えるのに、その種別では申請を出せない状態が残る。
        if (steps === null) throw new FormValidationError(labels.approvalRouteIncomplete);

        if (editing === null) {
          const created = await api.createRequestType({ code, category, ...shape });
          // 作った直後に経路を置く。置くまでは提出できないため、別の操作にすると
          // 「作れたのに出せない」状態が残る。
          await api.replaceApprovalRoute(created.id, { steps });
          setRoute([]);
        } else {
          await api.updateRequestType(editing, { ...shape, active });
          // 経路は段数と一緒に置き換える。段数を減らしたときに、
          // 消えた段の承認者が残らないようにする。
          await api.replaceApprovalRoute(editing, { steps });
          setEditing(null);
          setRoute([]);
        }
        setCode('');
        setName('');
      }}
      form={
        <>
          {editing !== null && (
            <p className="notice">
              {labels.editingRequestType}
              <button type="button" onClick={() => setEditing(null)}>
                {labels.stopEditing}
              </button>
            </p>
          )}
          {editing === null && (
            <>
              <TextField
                id="request-type-code"
                label={labels.code}
                value={code}
                onChange={setCode}
                required
                hint={labels.codeHint}
              />
              <SelectField
                id="request-type-category"
                label={labels.requestCategory}
                value={category}
                onChange={setCategory}
                options={REQUEST_CATEGORIES.map((value) => ({
                  value,
                  label: labels.requestCategoryLabel[value],
                }))}
                hint={labels.requestCategoryHint}
              />
            </>
          )}
          <TextField
            id="request-type-name"
            label={labels.name}
            value={name}
            onChange={setName}
            required
          />
          <TextField
            id="request-type-steps"
            label={labels.approvalSteps}
            type="number"
            value={approvalSteps}
            onChange={setApprovalSteps}
            min={1}
            max={4}
            required
            hint={labels.approvalStepsHint}
          />
          <fieldset className="field">
            <legend>{labels.approvalRoute}</legend>
            <p className="hint">{labels.approvalRouteHint}</p>
            {routeRows(Number(approvalSteps) || 1).map((entry) => {
              const policy = 'approverPolicy' in entry ? entry.approverPolicy : '';
              return (
                <div key={entry.step}>
                  <SelectField
                    id={`request-type-step-${entry.step}-policy`}
                    label={`${labels.stepLabel(entry.step)} ${labels.approverUser}`}
                    value={policy}
                    onChange={(value) =>
                      updateStep(entry.step, {
                        approverPolicy: value as ApproverPolicy,
                        approverUserId: value === 'user' ? (approvers[0]?.id ?? null) : null,
                      })
                    }
                    options={[
                      // 未設定を先頭に置く。既定の承認者を選んだ形で出すと、
                      // 決めた覚えのない相手がそのまま保存される。
                      { value: '', label: labels.approverUnset },
                      ...APPROVER_POLICIES
                        // 「誰でも」は新しく選べないようにする。段を分けた意味が
                        // 無くなるため。すでにその値の段だけ、置き換えられるよう出す。
                        .filter((candidate) => candidate !== 'any_approver' || policy === candidate)
                        .map((candidate) => ({
                          value: candidate,
                          label: labels.approverPolicyLabel[candidate],
                        })),
                    ]}
                  />
                  {policy === 'user' && (
                    <SelectField
                      id={`request-type-step-${entry.step}-user`}
                      label={`${labels.stepLabel(entry.step)} ${labels.approverUser}`}
                      value={('approverUserId' in entry ? entry.approverUserId : null) ?? ''}
                      onChange={(value) => updateStep(entry.step, { approverUserId: value })}
                      options={approvers.map((approver) => ({
                        value: approver.id,
                        label: approver.label,
                      }))}
                    />
                  )}
                </div>
              );
            })}
          </fieldset>
          <fieldset className="field">
            <legend>{labels.requiredInputs}</legend>
            <CheckboxField
              label={labels.reason}
              checked={requiresReason}
              onChange={setRequiresReason}
            />
            <CheckboxField
              label={labels.leaveType}
              checked={leaveNeedsType || requiresLeaveType}
              onChange={setRequiresLeaveType}
            />
            <CheckboxField
              label={labels.timeRange}
              checked={requiresTimeRange}
              onChange={setRequiresTimeRange}
            />
            <CheckboxField
              label={labels.overtimeLimit}
              checked={requiresOvertimeLimit}
              onChange={setRequiresOvertimeLimit}
            />
          </fieldset>
          {editing !== null && (
            <CheckboxField label={labels.activeLabel} checked={active} onChange={setActive} />
          )}
        </>
      }
    />
  );
}
