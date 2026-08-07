import type { PeriodSummaryRecord } from '@staffweave/contracts';
import { useCallback, useState } from 'react';
import { api } from '../../api/client.ts';
import { useLocale } from '../../i18n/LocaleProvider.tsx';
import type { SectionProps } from '../AdminConsole.tsx';
import { type Column, TextField } from '../resource.tsx';
import { SettingsSection } from '../SettingsSection.tsx';

/**
 * 週・清算期間・変形労働の対象期間の集計。
 *
 * 区切りは設定から決まる。週の開始曜日は計算規則の版が、
 * 清算期間と対象期間は労働形態の割当が持つ。
 * 設定が無ければ、その種類の期間は 1 行も出ない。
 *
 * 総枠が未設定なら、差も出さない。0 と出すと「ちょうど総枠だった」と読める。
 */
function firstOfThisMonth(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
}

function lastOfThisMonth(): string {
  const today = new Date();
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
}

export function PeriodSummarySettings({ permissions }: SectionProps): React.JSX.Element {
  const { messages } = useLocale();
  const labels = messages.admin;
  const [employeeId, setEmployeeId] = useState('');
  const [from, setFrom] = useState(firstOfThisMonth);
  const [to, setTo] = useState(lastOfThisMonth);

  const unset = labels.unconfigured;

  const columns: Column<PeriodSummaryRecord>[] = [
    { key: 'kind', header: labels.periodKind, value: (row) => labels.periodKindLabel[row.kind] },
    { key: 'from', header: labels.periodFrom, value: (row) => row.from },
    { key: 'to', header: labels.periodTo, value: (row) => row.to },
    { key: 'worked', header: labels.workedMinutes, value: (row) => row.workedMinutes },
    { key: 'total', header: labels.periodTotalMinutes, value: (row) => row.totalMinutes ?? unset },
    {
      key: 'difference',
      header: labels.periodDifferenceMinutes,
      value: (row) => row.differenceMinutes ?? unset,
    },
    {
      key: 'closed',
      header: labels.periodIncludesClosedMonth,
      value: (row) => (row.includesClosedMonth ? labels.yes : ''),
    },
  ];

  const load = useCallback(async () => {
    // 従業員を選ぶまでは読みに行かない。範囲だけでは対象が決まらない。
    if (employeeId.trim().length === 0) return [];
    return (await api.listPeriodSummaries({ employeeId: employeeId.trim(), from, to })).summaries;
  }, [employeeId, from, to]);

  return (
    <SettingsSection
      title={labels.sectionPeriodSummaries}
      hint={labels.periodSummariesHint}
      csvName={`period-summaries-${from}-${to}`}
      columns={columns}
      rowKey={(row) => `${row.kind}:${row.from}`}
      load={load}
      canRead={permissions.includes('employee.read')}
      canWrite={false}
      emptyMessage={labels.noPeriodSummaries}
      toolbar={
        <>
          <TextField
            id="period-employee"
            label={labels.employeeId}
            value={employeeId}
            onChange={setEmployeeId}
            hint={labels.periodEmployeeHint}
          />
          <TextField
            id="period-from"
            label={labels.periodFrom}
            type="date"
            value={from}
            onChange={setFrom}
          />
          <TextField
            id="period-to"
            label={labels.periodTo}
            type="date"
            value={to}
            onChange={setTo}
          />
        </>
      }
    />
  );
}
