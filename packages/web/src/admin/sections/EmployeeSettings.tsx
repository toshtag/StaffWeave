import type { Employee, Organization } from '@staffweave/contracts';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { useLocale } from '../../i18n/LocaleProvider.tsx';
import type { SectionProps } from '../AdminConsole.tsx';
import { CheckboxField, type Column, SelectField, TextField } from '../resource.tsx';
import { SettingsSection } from '../SettingsSection.tsx';

/**
 * 従業員。
 *
 * ログイン用の利用者を同時に作れる。作らない選択もできるようにしてあるのは、
 * 打刻をカードや端末だけで行い、自分では画面を開かない働き方があるため。
 */
export function EmployeeSettings({ permissions }: SectionProps): React.JSX.Element {
  const { messages } = useLocale();
  const labels = messages.admin;
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState('');
  const [employeeNumber, setEmployeeNumber] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [hiredOn, setHiredOn] = useState('');
  const [withAccount, setWithAccount] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    void api
      .listOrganizations()
      .then((body) => {
        setOrganizations(body.organizations);
        setOrganizationId((current) => current || (body.organizations[0]?.id ?? ''));
      })
      .catch(() => setOrganizations([]));
  }, []);

  const columns: Column<Employee>[] = [
    { key: 'number', header: labels.employeeNumber, value: (row) => row.employeeNumber },
    { key: 'name', header: labels.name, value: (row) => row.displayName },
    {
      key: 'organization',
      header: labels.organization,
      value: (row) =>
        organizations.find((organization) => organization.id === row.organizationId)?.code ??
        row.organizationId,
    },
    { key: 'status', header: labels.status, value: (row) => labels.employeeStatus[row.status] },
    { key: 'hiredOn', header: labels.hiredOn, value: (row) => row.hiredOn ?? '' },
    {
      key: 'account',
      header: labels.account,
      value: (row) => (row.userId === null ? labels.accountNone : labels.accountLinked),
    },
  ];

  const load = useCallback(async () => (await api.listEmployees()).employees, []);

  return (
    <SettingsSection
      title={labels.sectionEmployees}
      hint={labels.employeesHint}
      csvName="employees"
      columns={columns}
      rowKey={(row) => row.id}
      load={load}
      canRead={permissions.includes('employee.read')}
      importCsv={api.importEmployeesCsv}
      canWrite={permissions.includes('employee.manage')}
      emptyMessage={labels.noEmployees}
      onCopy={(row) => {
        setEmployeeNumber('');
        setDisplayName('');
        setOrganizationId(row.organizationId);
        setHiredOn(row.hiredOn ?? '');
      }}
      submit={async () => {
        await api.createEmployee({
          organizationId,
          employeeNumber,
          displayName,
          ...(hiredOn === '' ? {} : { hiredOn }),
          ...(withAccount ? { account: { email, password } } : {}),
        });
        setEmployeeNumber('');
        setDisplayName('');
        setEmail('');
        setPassword('');
      }}
      form={
        <>
          <SelectField
            id="employee-organization"
            label={labels.organization}
            value={organizationId}
            onChange={setOrganizationId}
            options={organizations.map((organization) => ({
              value: organization.id,
              label: `${organization.code} ${organization.name}`,
            }))}
          />
          <TextField
            id="employee-number"
            label={labels.employeeNumber}
            value={employeeNumber}
            onChange={setEmployeeNumber}
            required
          />
          <TextField
            id="employee-name"
            label={labels.name}
            value={displayName}
            onChange={setDisplayName}
            required
          />
          <TextField
            id="employee-hired-on"
            label={labels.hiredOn}
            type="date"
            value={hiredOn}
            onChange={setHiredOn}
          />
          <fieldset className="field">
            <legend>{labels.account}</legend>
            <CheckboxField
              label={labels.createAccount}
              checked={withAccount}
              onChange={setWithAccount}
            />
            {withAccount && (
              <>
                <TextField
                  id="employee-email"
                  label={messages.email}
                  type="email"
                  value={email}
                  onChange={setEmail}
                  required
                />
                <TextField
                  id="employee-password"
                  label={messages.password}
                  type="password"
                  value={password}
                  onChange={setPassword}
                  required
                  hint={labels.initialPasswordHint}
                />
              </>
            )}
          </fieldset>
        </>
      }
    />
  );
}
