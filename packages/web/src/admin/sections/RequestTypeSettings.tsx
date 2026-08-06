import type { RequestCategory, RequestTypeRecord } from '@staffweave/contracts';
import { REQUEST_CATEGORIES } from '@staffweave/contracts';
import { useCallback, useState } from 'react';
import { api } from '../../api/client.ts';
import { useLocale } from '../../i18n/LocaleProvider.tsx';
import type { SectionProps } from '../AdminConsole.tsx';
import { CheckboxField, type Column, SelectField, TextField } from '../resource.tsx';
import { SettingsSection } from '../SettingsSection.tsx';

/**
 * 申請種別と承認経路。
 *
 * 承認の段数がそのまま経路になる。段数を変えても、すでに提出された申請は
 * 提出したときの段数のまま進む。進行中の申請の経路が動くと、
 * 承認した段が消えたり、承認していない段が現れたりする。
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
      canWrite={permissions.includes('request.manage')}
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
        if (editing === null) {
          await api.createRequestType({ code, category, ...shape });
        } else {
          await api.updateRequestType(editing, { ...shape, active });
          setEditing(null);
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
