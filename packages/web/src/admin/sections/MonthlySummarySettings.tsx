import type { MonthlySummaryRecord } from '@staffweave/contracts';
import { useCallback, useState } from 'react';
import { api } from '../../api/client.ts';
import { useLocale } from '../../i18n/LocaleProvider.tsx';
import type { SectionProps } from '../AdminConsole.tsx';
import { type Column, TextField } from '../resource.tsx';
import { SettingsSection } from '../SettingsSection.tsx';

/**
 * 月次の集計。
 *
 * 出るのは、日次を足し合わせた「いまの値」。
 * 締めた月は、締めた時点で固めた値も並べる。締めたあとの訂正で日次は動くが、
 * 給与へ渡した値は動かない。どちらが締めた値なのかを、画面で見て分かるようにする。
 */
function firstOfThisMonth(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
}

export function MonthlySummarySettings({ permissions }: SectionProps): React.JSX.Element {
  const { messages } = useLocale();
  const labels = messages.admin;
  const [period, setPeriod] = useState(firstOfThisMonth);

  const unset = labels.unconfigured;

  const columns: Column<MonthlySummaryRecord>[] = [
    { key: 'number', header: labels.employeeNumber, value: (row) => row.employeeNumber },
    { key: 'name', header: labels.name, value: (row) => row.displayName },
    { key: 'workedDays', header: labels.workedDays, value: (row) => row.workedDays },
    { key: 'worked', header: labels.workedMinutes, value: (row) => row.workedMinutes },
    { key: 'outside', header: labels.outsideMinutes, value: (row) => row.outsideScheduleMinutes },
    { key: 'night', header: labels.nightMinutes, value: (row) => row.nightMinutes },
    {
      key: 'legalOvertime',
      header: labels.legalOvertimeMinutes,
      value: (row) => row.legalOvertimeMinutes ?? unset,
    },
    {
      key: 'recognizedOvertime',
      header: labels.recognizedOvertimeMinutes,
      value: (row) => row.recognizedOvertimeMinutes ?? unset,
    },
    {
      key: 'unapprovedOvertime',
      header: labels.unapprovedOvertimeMinutes,
      value: (row) => row.unapprovedOvertimeMinutes ?? unset,
    },
    { key: 'leave', header: labels.leaveMinutes, value: (row) => row.leaveMinutes },
    {
      key: 'closing',
      header: labels.closingState,
      value: (row) =>
        row.closingState === null ? labels.closingOpen : labels.closingStateLabel[row.closingState],
    },
    {
      key: 'snapshot',
      header: labels.closedTotal,
      value: (row) => row.snapshot?.workedMinutes ?? '',
      cell: (row) =>
        row.snapshot === null ? (
          ''
        ) : (
          <>
            {row.snapshot.workedMinutes}
            {/* 締めた値といまの値が食い違っているなら、印を付ける。 */}
            {row.driftedFromSnapshot && <span className="badge">{labels.driftedFromSnapshot}</span>}
          </>
        ),
    },
  ];

  const load = useCallback(
    async () => (await api.listMonthlySummaries({ period })).summaries,
    [period],
  );

  return (
    <SettingsSection
      title={labels.sectionMonthlySummaries}
      hint={labels.monthlySummariesHint}
      csvName={`monthly-summaries-${period}`}
      columns={columns}
      rowKey={(row) => row.employeeId}
      load={load}
      canRead={permissions.includes('employee.read')}
      canWrite={false}
      emptyMessage={labels.noMonthlySummaries}
      toolbar={
        <TextField
          id="monthly-period"
          label={labels.period}
          type="date"
          value={period}
          onChange={setPeriod}
          hint={labels.periodHint}
        />
      }
    />
  );
}
