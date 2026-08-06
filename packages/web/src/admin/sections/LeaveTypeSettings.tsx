import type { LeaveTypeSettingsRecord } from '@staffweave/contracts';
import { useCallback, useState } from 'react';
import { api } from '../../api/client.ts';
import { useLocale } from '../../i18n/LocaleProvider.tsx';
import type { SectionProps } from '../AdminConsole.tsx';
import { CheckboxField, type Column, TextField } from '../resource.tsx';
import { SettingsSection } from '../SettingsSection.tsx';

/**
 * 休暇種別の設定。
 *
 * 取得の単位、1 日ぶんの分数、失効までの月数は、製品が既定値を持たない。
 * 事業者が決める。設定しないかぎり、どれも適用しない。
 *
 * ここは既にある種別を直す画面で、新しく作る画面ではない。
 * 種別そのものは勤務の設定と一緒に増やすため、作成はそちらへ置いている。
 */
function numberOrNull(text: string): number | null {
  const value = Number(text.trim());
  return text.trim() === '' || Number.isNaN(value) ? null : value;
}

export function LeaveTypeSettings({ permissions }: SectionProps): React.JSX.Element {
  const { messages } = useLocale();
  const labels = messages.admin;
  const [editing, setEditing] = useState<string | null>(null);
  const [unitMinutes, setUnitMinutes] = useState('');
  const [dayMinutes, setDayMinutes] = useState('');
  const [expiresAfterMonths, setExpiresAfterMonths] = useState('');
  const [active, setActive] = useState(true);

  const unset = labels.unconfigured;

  const columns: Column<LeaveTypeSettingsRecord>[] = [
    { key: 'code', header: labels.code, value: (row) => row.code },
    { key: 'name', header: labels.name, value: (row) => row.name },
    { key: 'paid', header: labels.paidLeave, value: (row) => (row.paid ? labels.yes : labels.no) },
    { key: 'unit', header: labels.unitMinutes, value: (row) => row.unitMinutes ?? unset },
    { key: 'day', header: labels.dayMinutes, value: (row) => row.dayMinutes ?? unset },
    {
      key: 'expires',
      header: labels.expiresAfterMonths,
      value: (row) => row.expiresAfterMonths ?? labels.neverExpires,
    },
    {
      key: 'active',
      header: labels.activeLabel,
      value: (row) => (row.active ? labels.yes : labels.no),
    },
  ];

  const load = useCallback(async () => (await api.listLeaveTypeSettings()).leaveTypes, []);

  return (
    <SettingsSection
      title={labels.sectionLeaveTypes}
      hint={labels.leaveTypesHint}
      csvName="leave-types"
      columns={columns}
      rowKey={(row) => row.id}
      load={load}
      canRead={permissions.includes('leave.manage')}
      canWrite={permissions.includes('leave.manage')}
      emptyMessage={labels.noLeaveTypes}
      copyLabel={labels.editRow}
      formTitle={labels.editSettings}
      onCopy={(row) => {
        setEditing(row.id);
        setUnitMinutes(row.unitMinutes === null ? '' : String(row.unitMinutes));
        setDayMinutes(row.dayMinutes === null ? '' : String(row.dayMinutes));
        setExpiresAfterMonths(
          row.expiresAfterMonths === null ? '' : String(row.expiresAfterMonths),
        );
        setActive(row.active);
      }}
      submit={
        editing === null
          ? undefined
          : async () => {
              await api.updateLeaveType(editing, {
                unitMinutes: numberOrNull(unitMinutes),
                dayMinutes: numberOrNull(dayMinutes),
                expiresAfterMonths: numberOrNull(expiresAfterMonths),
                active,
              });
              // 直したあとも選んだままにする。ここで選択を外すと、
              // 入力欄ごと消えて「保存しました」も一緒に消えてしまう。
            }
      }
      form={
        editing === null ? (
          <p className="notice">{labels.pickLeaveTypeToEdit}</p>
        ) : (
          <>
            <TextField
              id="leave-unit-minutes"
              label={labels.unitMinutes}
              type="number"
              value={unitMinutes}
              onChange={setUnitMinutes}
              min={1}
              max={1440}
              hint={labels.unitMinutesHint}
            />
            <TextField
              id="leave-day-minutes"
              label={labels.dayMinutes}
              type="number"
              value={dayMinutes}
              onChange={setDayMinutes}
              min={1}
              max={1440}
              hint={labels.dayMinutesHint}
            />
            <TextField
              id="leave-expires-after"
              label={labels.expiresAfterMonths}
              type="number"
              value={expiresAfterMonths}
              onChange={setExpiresAfterMonths}
              min={1}
              max={240}
              hint={labels.expiresAfterMonthsHint}
            />
            <CheckboxField label={labels.activeLabel} checked={active} onChange={setActive} />
          </>
        )
      }
    />
  );
}
