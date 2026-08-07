import type { Employee, Organization, UserScopeRecord } from '@staffweave/contracts';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { useLocale } from '../../i18n/LocaleProvider.tsx';
import type { SectionProps } from '../AdminConsole.tsx';
import { type Column, SelectField } from '../resource.tsx';
import { SettingsSection } from '../SettingsSection.tsx';

/**
 * 利用者ごとの閲覧範囲。
 *
 * 誰の勤怠を見られるかは、ロールだけでは決まらない。
 * 組織管理者や、受入側の承認者は、ここで組織を与えられた範囲だけを見る。
 * ワークスペース全体を見られるかどうかは、この設定ではなくロールが決める。
 */
export function UserScopeSettings({ permissions }: SectionProps): React.JSX.Element {
  const { locale, messages } = useLocale();
  const labels = messages.admin;
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [userId, setUserId] = useState('');
  const [organizationId, setOrganizationId] = useState('');

  useEffect(() => {
    void api
      .listOrganizations()
      .then((body) => {
        setOrganizations(body.organizations);
        setOrganizationId((current) => current || (body.organizations[0]?.id ?? ''));
      })
      .catch(() => setOrganizations([]));
  }, []);

  // 相手を識別子で書かせると、設定する人は画面の外で identifier を調べることになる。
  // ログインを持つ従業員から選べるようにして、その往復を無くす。
  useEffect(() => {
    void api
      .listEmployees()
      .then((body) => {
        const withLogin = body.employees.filter((employee) => employee.userId !== null);
        setEmployees(withLogin);
        setUserId((current) => current || (withLogin[0]?.userId ?? ''));
      })
      .catch(() => setEmployees([]));
  }, []);

  const userLabel = (id: string): string => {
    const employee = employees.find((candidate) => candidate.userId === id);
    return employee === undefined ? id : `${employee.employeeNumber} ${employee.displayName}`;
  };

  const columns: Column<UserScopeRecord>[] = [
    { key: 'userId', header: labels.userId, value: (row) => userLabel(row.userId) },
    {
      key: 'organization',
      header: labels.organization,
      value: (row) =>
        organizations.find((organization) => organization.id === row.organizationId)?.code ??
        row.organizationId,
    },
    {
      key: 'grantedAt',
      header: labels.grantedAt,
      value: (row) => row.grantedAt,
      cell: (row) => new Date(row.grantedAt).toLocaleString(locale),
    },
  ];

  const load = useCallback(async () => (await api.listUserScopes()).scopes, []);

  return (
    <SettingsSection
      title={labels.sectionUserScopes}
      hint={labels.userScopesHint}
      csvName="user-scopes"
      columns={columns}
      rowKey={(row) => `${row.userId}:${row.organizationId}`}
      load={load}
      canRead={permissions.includes('user.manage')}
      canWrite={permissions.includes('user.manage')}
      emptyMessage={labels.noUserScopes}
      onCopy={(row) => {
        setUserId(row.userId);
        setOrganizationId(row.organizationId);
      }}
      submit={async () => {
        await api.grantUserScope({ userId, organizationId });
        setUserId('');
      }}
      form={
        <>
          <SelectField
            id="scope-user"
            label={labels.userId}
            value={userId}
            onChange={setUserId}
            options={employees.map((employee) => ({
              value: employee.userId ?? '',
              label: `${employee.employeeNumber} ${employee.displayName}`,
            }))}
            hint={labels.userIdHint}
          />
          <SelectField
            id="scope-organization"
            label={labels.organization}
            value={organizationId}
            onChange={setOrganizationId}
            options={organizations.map((organization) => ({
              value: organization.id,
              label: `${organization.code} ${organization.name}`,
            }))}
          />
        </>
      }
    />
  );
}
