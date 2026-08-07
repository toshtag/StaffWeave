import type { LeaveExpirationRecord, LeaveRegisterRecord } from '@staffweave/contracts';
import { useCallback, useState } from 'react';
import { api } from '../../api/client.ts';
import { useLocale } from '../../i18n/LocaleProvider.tsx';
import type { SectionProps } from '../AdminConsole.tsx';
import { type Column, TextField } from '../resource.tsx';
import { SettingsSection } from '../SettingsSection.tsx';

/**
 * 休暇管理簿と、失効の予定。
 *
 * どちらも台帳から組み立てた値。合計を別に保存しない。
 * 保存すると、台帳と合計が食い違ったときにどちらが正しいのかを決められない。
 */
function firstOfThisYear(): string {
  return `${new Date().getFullYear()}-01-01`;
}

function lastOfThisYear(): string {
  return `${new Date().getFullYear()}-12-31`;
}

export function LeaveRegisterSettings({ permissions }: SectionProps): React.JSX.Element {
  const { messages } = useLocale();
  const labels = messages.admin;
  const [from, setFrom] = useState(firstOfThisYear);
  const [to, setTo] = useState(lastOfThisYear);

  const columns: Column<LeaveRegisterRecord>[] = [
    { key: 'number', header: labels.employeeNumber, value: (row) => row.employeeNumber },
    { key: 'opening', header: labels.registerOpening, value: (row) => row.openingMinutes },
    { key: 'granted', header: labels.registerGranted, value: (row) => row.grantedMinutes },
    { key: 'consumed', header: labels.registerConsumed, value: (row) => row.consumedMinutes },
    { key: 'expired', header: labels.registerExpired, value: (row) => row.expiredMinutes },
    { key: 'adjusted', header: labels.registerAdjusted, value: (row) => row.adjustedMinutes },
    { key: 'closing', header: labels.registerClosing, value: (row) => row.closingMinutes },
  ];

  const load = useCallback(
    async () => (await api.listLeaveRegister({ from, to })).register,
    [from, to],
  );

  return (
    <SettingsSection
      title={labels.sectionLeaveRegister}
      hint={labels.leaveRegisterHint}
      csvName={`leave-register-${from}-${to}`}
      columns={columns}
      rowKey={(row) => `${row.employeeId}:${row.leaveTypeId}`}
      load={load}
      canRead={permissions.includes('employee.read')}
      canWrite={false}
      emptyMessage={labels.noLeaveRegister}
      toolbar={
        <>
          <TextField
            id="register-from"
            label={labels.periodFrom}
            type="date"
            value={from}
            onChange={setFrom}
          />
          <TextField
            id="register-to"
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

export function LeaveExpirationSettings({ permissions }: SectionProps): React.JSX.Element {
  const { messages } = useLocale();
  const labels = messages.admin;
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [through, setThrough] = useState(lastOfThisYear);

  const columns: Column<LeaveExpirationRecord>[] = [
    { key: 'number', header: labels.employeeNumber, value: (row) => row.employeeNumber },
    { key: 'expiresOn', header: labels.expiresOn, value: (row) => row.expiresOn },
    { key: 'remaining', header: labels.remainingMinutes, value: (row) => row.remainingMinutes },
  ];

  const load = useCallback(
    async () => (await api.listLeaveExpirations({ asOf, through })).expirations,
    [asOf, through],
  );

  return (
    <SettingsSection
      title={labels.sectionLeaveExpirations}
      hint={labels.leaveExpirationsHint}
      csvName={`leave-expirations-${asOf}-${through}`}
      columns={columns}
      rowKey={(row) => row.entryId}
      load={load}
      canRead={permissions.includes('employee.read')}
      canWrite={false}
      emptyMessage={labels.noLeaveExpirations}
      toolbar={
        <>
          <TextField
            id="expiration-as-of"
            label={labels.asOf}
            type="date"
            value={asOf}
            onChange={setAsOf}
          />
          <TextField
            id="expiration-through"
            label={labels.through}
            type="date"
            value={through}
            onChange={setThrough}
          />
        </>
      }
    />
  );
}
