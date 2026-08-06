import type { ClosingReadiness } from '@staffweave/contracts';
import { useCallback, useState } from 'react';
import { api } from '../../api/client.ts';
import { useLocale } from '../../i18n/LocaleProvider.tsx';
import type { SectionProps } from '../AdminConsole.tsx';
import { type Column, TextField } from '../resource.tsx';
import { SettingsSection } from '../SettingsSection.tsx';

/**
 * 締める前の確認。
 *
 * 締めは元に戻せるが、戻すたびに監査へ跡が残り、
 * 給与へ渡した値との食い違いを人が説明することになる。
 * 押す前に「何が残っているか」を見られるようにする。
 *
 * ここは締めを止めない。止めるかどうかは運用が決める。
 */
function firstOfThisMonth(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
}

export function ClosingReadinessSettings({ permissions }: SectionProps): React.JSX.Element {
  const { messages } = useLocale();
  const labels = messages.admin;
  const [period, setPeriod] = useState(firstOfThisMonth);

  const columns: Column<ClosingReadiness>[] = [
    { key: 'employee', header: labels.employee, value: (row) => row.employeeId },
    {
      key: 'blocked',
      header: labels.blocked,
      value: (row) => (row.blocked ? labels.yes : labels.no),
    },
    {
      key: 'findings',
      header: labels.remaining,
      value: (row) =>
        row.findings
          .map((finding) => `${finding.businessDate} ${labels.closingFinding[finding.kind]}`)
          .join(' / '),
      cell: (row) =>
        row.findings.length === 0 ? (
          labels.nothingRemaining
        ) : (
          <ul className="finding-list">
            {row.findings.map((finding) => (
              <li key={`${finding.businessDate}:${finding.kind}`}>
                <span className="anomaly-severity" data-severity={finding.severity}>
                  {labels.closingSeverity[finding.severity]}
                </span>{' '}
                {finding.businessDate} {labels.closingFinding[finding.kind]}
              </li>
            ))}
          </ul>
        ),
    },
  ];

  const load = useCallback(
    async () => (await api.listClosingReadiness({ period })).readiness,
    [period],
  );

  return (
    <SettingsSection
      title={labels.sectionClosingReadiness}
      hint={labels.closingReadinessHint}
      csvName={`closing-readiness-${period}`}
      columns={columns}
      rowKey={(row) => row.employeeId}
      load={load}
      canRead={permissions.includes('attendance.close')}
      canWrite={false}
      emptyMessage={labels.noClosingReadiness}
      toolbar={
        <TextField
          id="readiness-period"
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
