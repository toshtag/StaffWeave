import type { ClosingReadiness, Employee } from '@staffweave/contracts';
import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api } from '../../api/client.ts';
import { useLocale } from '../../i18n/LocaleProvider.tsx';
import type { SectionProps } from '../AdminConsole.tsx';
import { type Column, downloadCsv, TextField } from '../resource.tsx';
import { SettingsSection } from '../SettingsSection.tsx';

/**
 * 締める前の確認。
 *
 * 締めは元に戻せるが、戻すたびに監査へ跡が残り、
 * 給与へ渡した値との食い違いを人が説明することになる。
 * 押す前に「何が残っているか」を見られるようにする。
 *
 * ここは締めを止めない。止めるかどうかは運用が決める。
 *
 * 締めと締め解除も、この画面から行います。残っているものを見てから押せる
 * ようにするためで、別の画面へ分けると「見ずに押す」経路ができます。
 * 締め解除は理由を求めます。理由の無い解除は、監査から意図を読み取れません。
 */
function firstOfThisMonth(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
}

export function ClosingReadinessSettings({ permissions }: SectionProps): React.JSX.Element {
  const { messages } = useLocale();
  const labels = messages.admin;
  const [period, setPeriod] = useState(firstOfThisMonth);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [reopening, setReopening] = useState<{ employeeId: string; reason: string } | null>(null);

  const canClose = permissions.includes('attendance.close');

  // 行の見出しに UUID が出ていると、誰の月を締めるのか押す前に分からない。
  // 締めは監査へ残るため、押す相手を人が読める形にしておく。
  const [employees, setEmployees] = useState<Employee[]>([]);
  useEffect(() => {
    void api
      .listEmployees()
      .then((body) => setEmployees(body.employees))
      .catch(() => setEmployees([]));
  }, []);

  const employeeLabel = (id: string): string => {
    const employee = employees.find((candidate) => candidate.id === id);
    return employee === undefined ? id : `${employee.employeeNumber} ${employee.displayName}`;
  };

  function run(action: () => Promise<unknown>, done: string, reload: () => Promise<void>): void {
    setOutcome(null);
    action()
      .then(() => {
        setOutcome(done);
        setReopening(null);
        return reload();
      })
      .catch((cause: unknown) => {
        setOutcome(cause instanceof ApiRequestError ? cause.message : labels.saveFailed);
      });
  }

  const columns: Column<ClosingReadiness>[] = [
    { key: 'employee', header: labels.employee, value: (row) => employeeLabel(row.employeeId) },
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
      canRead={canClose}
      canWrite={false}
      emptyMessage={labels.noClosingReadiness}
      rowActions={(row, reload) =>
        canClose ? (
          <span className="row-inline-form">
            <button
              type="button"
              onClick={() =>
                run(
                  () => api.closeMonth({ employeeId: row.employeeId, period }),
                  labels.closed,
                  reload,
                )
              }
            >
              {labels.closeMonth}
            </button>
            {reopening?.employeeId === row.employeeId ? (
              <>
                <input
                  type="text"
                  aria-label={labels.reopenReason}
                  value={reopening.reason}
                  onChange={(event) =>
                    setReopening({ employeeId: row.employeeId, reason: event.target.value })
                  }
                />
                <button
                  type="button"
                  disabled={reopening.reason.trim() === ''}
                  onClick={() =>
                    run(
                      () =>
                        api.reopenMonth({
                          employeeId: row.employeeId,
                          period,
                          reason: reopening.reason,
                        }),
                      labels.reopened,
                      reload,
                    )
                  }
                >
                  {labels.save}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setReopening({ employeeId: row.employeeId, reason: '' })}
              >
                {labels.reopenMonth}
              </button>
            )}
          </span>
        ) : null
      }
      toolbar={
        <>
          <TextField
            id="readiness-period"
            label={labels.period}
            type="date"
            value={period}
            onChange={setPeriod}
            hint={labels.periodHint}
          />
          {/* セッションでの取り出しは、従業員を読める範囲と同じ範囲で返る。 */}
          {permissions.includes('employee.read') && (
            <button
              type="button"
              onClick={() => {
                setOutcome(null);
                void api
                  .payrollCsv(period)
                  .then((csv) => downloadCsv(`payroll-${period}.csv`, csv))
                  .catch((cause: unknown) =>
                    setOutcome(
                      cause instanceof ApiRequestError ? cause.message : labels.saveFailed,
                    ),
                  );
              }}
            >
              {labels.downloadPayrollCsv}
            </button>
          )}
          {outcome !== null && <p className="notice">{outcome}</p>}
        </>
      }
    />
  );
}
