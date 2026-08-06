import type { Department, Organization } from '@staffweave/contracts';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { useLocale } from '../../i18n/LocaleProvider.tsx';
import type { SectionProps } from '../AdminConsole.tsx';
import { type Column, SelectField, TextField } from '../resource.tsx';
import { SettingsSection } from '../SettingsSection.tsx';

/** 部門。上位の部門を指して階層にできる。 */
export function DepartmentSettings({ permissions }: SectionProps): React.JSX.Element {
  const { messages } = useLocale();
  const labels = messages.admin;
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [organizationId, setOrganizationId] = useState('');
  const [parentDepartmentId, setParentDepartmentId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');

  useEffect(() => {
    void api
      .listOrganizations()
      .then((body) => {
        setOrganizations(body.organizations);
        setOrganizationId((current) => current || (body.organizations[0]?.id ?? ''));
      })
      .catch(() => setOrganizations([]));
  }, []);

  const nameOf = (id: string | null): string =>
    id === null ? '' : (departments.find((department) => department.id === id)?.code ?? id);

  const columns: Column<Department>[] = [
    { key: 'code', header: labels.code, value: (row) => row.code },
    { key: 'name', header: labels.name, value: (row) => row.name },
    {
      key: 'organization',
      header: labels.organization,
      value: (row) =>
        organizations.find((organization) => organization.id === row.organizationId)?.code ??
        row.organizationId,
    },
    {
      key: 'parent',
      header: labels.parentDepartment,
      value: (row) => nameOf(row.parentDepartmentId),
    },
  ];

  const load = useCallback(async () => {
    const body = await api.listDepartments();
    setDepartments(body.departments);
    return body.departments;
  }, []);

  return (
    <SettingsSection
      title={labels.sectionDepartments}
      hint={labels.departmentsHint}
      csvName="departments"
      columns={columns}
      rowKey={(row) => row.id}
      load={load}
      canRead={permissions.includes('organization.read')}
      canWrite={permissions.includes('organization.manage')}
      emptyMessage={labels.noDepartments}
      onCopy={(row) => {
        setCode('');
        setName(row.name);
        setOrganizationId(row.organizationId);
        setParentDepartmentId(row.parentDepartmentId ?? '');
      }}
      submit={async () => {
        await api.createDepartment({
          organizationId,
          code,
          name,
          ...(parentDepartmentId === '' ? {} : { parentDepartmentId }),
        });
        setCode('');
        setName('');
      }}
      form={
        <>
          <SelectField
            id="department-organization"
            label={labels.organization}
            value={organizationId}
            onChange={setOrganizationId}
            options={organizations.map((organization) => ({
              value: organization.id,
              label: `${organization.code} ${organization.name}`,
            }))}
          />
          <TextField
            id="department-code"
            label={labels.code}
            value={code}
            onChange={setCode}
            required
            hint={labels.codeHint}
          />
          <TextField
            id="department-name"
            label={labels.name}
            value={name}
            onChange={setName}
            required
          />
          <SelectField
            id="department-parent"
            label={labels.parentDepartment}
            value={parentDepartmentId}
            onChange={setParentDepartmentId}
            options={[
              { value: '', label: labels.noParentDepartment },
              ...departments
                .filter((department) => department.organizationId === organizationId)
                .map((department) => ({
                  value: department.id,
                  label: `${department.code} ${department.name}`,
                })),
            ]}
          />
        </>
      }
    />
  );
}
