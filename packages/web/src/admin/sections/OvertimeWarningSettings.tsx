import type { OvertimeWarningRecord } from '@staffweave/contracts';
import { useCallback, useState } from 'react';
import { api } from '../../api/client.ts';
import { useLocale } from '../../i18n/LocaleProvider.tsx';
import type { SectionProps } from '../AdminConsole.tsx';
import { type Column, TextField } from '../resource.tsx';
import { SettingsSection } from '../SettingsSection.tsx';

/**
 * 長時間労働の警告。
 *
 * 上限は計算規則の版が持つ。置かないかぎり警告を出さず、
 * 置いていないことをこの画面で示す。0 件と「見ていない」を混ぜない。
 */
function firstOfThisMonth(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
}

export function OvertimeWarningSettings({ permissions }: SectionProps): React.JSX.Element {
  const { messages } = useLocale();
  const labels = messages.admin;
  const [period, setPeriod] = useState(firstOfThisMonth);
  const [configured, setConfigured] = useState<boolean | null>(null);

  const unset = labels.unconfigured;

  const columns: Column<OvertimeWarningRecord>[] = [
    { key: 'number', header: labels.employeeNumber, value: (row) => row.employeeNumber },
    { key: 'name', header: labels.name, value: (row) => row.displayName },
    {
      key: 'overtime',
      header: labels.legalOvertimeMinutes,
      value: (row) => row.legalOvertimeMinutes ?? unset,
    },
    {
      key: 'monthly',
      header: labels.exceededMonthlyBy,
      value: (row) => row.exceededMonthlyBy ?? unset,
    },
    {
      key: 'average',
      header: labels.averageOvertimeMinutes,
      value: (row) => row.averageMinutes ?? unset,
    },
    {
      key: 'exceededAverage',
      header: labels.exceededAverageBy,
      value: (row) => row.exceededAverageBy ?? unset,
    },
  ];

  const load = useCallback(async () => {
    const body = await api.listOvertimeWarnings({ period });
    setConfigured(body.monthlyLimitMinutes !== null || body.averageLimitMinutes !== null);
    return body.warnings;
  }, [period]);

  return (
    <SettingsSection
      title={labels.sectionOvertimeWarnings}
      hint={labels.overtimeWarningsHint}
      csvName={`overtime-warnings-${period}`}
      columns={columns}
      rowKey={(row) => row.employeeId}
      load={load}
      canRead={permissions.includes('employee.read')}
      canWrite={false}
      emptyMessage={configured === false ? labels.overtimeLimitUnset : labels.noOvertimeWarnings}
      toolbar={
        <TextField
          id="overtime-period"
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
