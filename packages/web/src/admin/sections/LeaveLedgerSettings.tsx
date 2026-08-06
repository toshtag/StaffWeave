import type {
  Employee,
  LeaveBalanceRecord,
  LeaveLedgerEntryRecord,
  LeaveTypeSettingsRecord,
} from '@staffweave/contracts';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { useLocale } from '../../i18n/LocaleProvider.tsx';
import type { SectionProps } from '../AdminConsole.tsx';
import { type Column, SelectField, TextField } from '../resource.tsx';
import { SettingsSection } from '../SettingsSection.tsx';

/**
 * 休暇の台帳。
 *
 * 残数は保存されていない。ここに出るのは、台帳から組み立てた値。
 * 記録は書き換えられないため、間違えた付与は取り消す行を足して打ち消す。
 * 消さずに残すのは、あとから「なぜこの残数なのか」を辿れるようにするため。
 */
export function LeaveLedgerSettings({ permissions }: SectionProps): React.JSX.Element {
  const { locale, messages } = useLocale();
  const labels = messages.admin;
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeSettingsRecord[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [balances, setBalances] = useState<LeaveBalanceRecord[]>([]);
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [minutes, setMinutes] = useState('');
  const [effectiveOn, setEffectiveOn] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    void Promise.all([api.listEmployees(), api.listLeaveTypeSettings()])
      .then(([employeeList, leaveTypeList]) => {
        setEmployees(employeeList.employees);
        setEmployeeId((current) => current || (employeeList.employees[0]?.id ?? ''));
        setLeaveTypes(leaveTypeList.leaveTypes);
        setLeaveTypeId((current) => current || (leaveTypeList.leaveTypes[0]?.id ?? ''));
      })
      .catch(() => undefined);
  }, []);

  const leaveTypeLabel = (id: string): string =>
    leaveTypes.find((leaveType) => leaveType.id === id)?.code ?? id;

  const columns: Column<LeaveLedgerEntryRecord>[] = [
    { key: 'effectiveOn', header: labels.effectiveOn, value: (row) => row.effectiveOn },
    {
      key: 'leaveType',
      header: labels.leaveType,
      value: (row) => leaveTypeLabel(row.leaveTypeId),
    },
    {
      key: 'entryType',
      header: labels.entryType,
      value: (row) => labels.leaveEntryType[row.entryType],
    },
    { key: 'minutes', header: labels.minutes, value: (row) => row.minutes },
    {
      key: 'expiresOn',
      header: labels.expiresOn,
      value: (row) => row.expiresOn ?? '',
    },
    { key: 'reason', header: labels.reason, value: (row) => row.reason ?? '' },
    {
      key: 'createdAt',
      header: labels.createdAt,
      value: (row) => row.createdAt,
      cell: (row) => new Date(row.createdAt).toLocaleDateString(locale),
    },
  ];

  const load = useCallback(async () => {
    if (employeeId === '') return [];
    const [ledger, balanceList] = await Promise.all([
      api.listLeaveLedger({ employeeId }),
      api.listLeaveBalances({ employeeId }),
    ]);
    setBalances(balanceList.balances);
    return ledger.entries;
  }, [employeeId]);

  const canManage = permissions.includes('leave.manage');

  return (
    <SettingsSection
      title={labels.sectionLeaveLedger}
      hint={labels.leaveLedgerHint}
      csvName="leave-ledger"
      columns={columns}
      rowKey={(row) => row.id}
      load={load}
      canRead={canManage}
      canWrite={canManage}
      emptyMessage={labels.noLeaveEntries}
      formTitle={labels.grantLeave}
      toolbar={
        <>
          <SelectField
            id="ledger-employee"
            label={labels.employee}
            value={employeeId}
            onChange={setEmployeeId}
            options={employees.map((employee) => ({
              value: employee.id,
              label: `${employee.employeeNumber} ${employee.displayName}`,
            }))}
          />
          <dl className="details">
            {balances.length === 0 && <dd>{labels.noBalance}</dd>}
            {balances.map((balance) => (
              <div key={balance.leaveTypeId} className="balance-row">
                <dt>{leaveTypeLabel(balance.leaveTypeId)}</dt>
                <dd>
                  {messages.formatDuration(balance.availableMinutes)}
                  {balance.expiredMinutes > 0 && (
                    <span className="badge">
                      {labels.expiredMinutesLabel} {messages.formatDuration(balance.expiredMinutes)}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </>
      }
      rowActions={(row, reload) =>
        // 取消は元の行を消さず、打ち消す行を足す。取消そのものは取り消せない。
        row.entryType === 'reverse' ? null : (
          <button
            type="button"
            onClick={() => {
              void api
                .reverseLeaveEntry(row.id, { reason: labels.reversedFromConsole })
                .then(reload)
                .catch(() => undefined);
            }}
          >
            {labels.reverseEntry}
          </button>
        )
      }
      submit={async () => {
        await api.grantLeave({
          employeeId,
          leaveTypeId,
          minutes: Number(minutes),
          effectiveOn,
          ...(reason.trim() === '' ? {} : { reason }),
        });
        setMinutes('');
        setReason('');
      }}
      form={
        <>
          <SelectField
            id="ledger-leave-type"
            label={labels.leaveType}
            value={leaveTypeId}
            onChange={setLeaveTypeId}
            options={leaveTypes.map((leaveType) => ({
              value: leaveType.id,
              label: `${leaveType.code} ${leaveType.name}`,
            }))}
          />
          <TextField
            id="ledger-minutes"
            label={labels.minutes}
            type="number"
            value={minutes}
            onChange={setMinutes}
            min={1}
            required
            hint={labels.grantMinutesHint}
          />
          <TextField
            id="ledger-effective-on"
            label={labels.effectiveOn}
            type="date"
            value={effectiveOn}
            onChange={setEffectiveOn}
            required
            hint={labels.grantEffectiveOnHint}
          />
          <TextField id="ledger-reason" label={labels.reason} value={reason} onChange={setReason} />
        </>
      }
    />
  );
}
