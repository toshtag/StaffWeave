import type { Organization } from '@staffweave/contracts';
import { useCallback, useState } from 'react';
import { api } from '../../api/client.ts';
import { useLocale } from '../../i18n/LocaleProvider.tsx';
import type { SectionProps } from '../AdminConsole.tsx';
import { type Column, TextField } from '../resource.tsx';
import { SettingsSection } from '../SettingsSection.tsx';

/** 組織。ここが空だと拠点も部門も従業員も置けないため、設定の起点になる。 */
export function OrganizationSettings({ permissions }: SectionProps): React.JSX.Element {
  const { locale, messages } = useLocale();
  const labels = messages.admin;
  const [code, setCode] = useState('');
  const [name, setName] = useState('');

  const columns: Column<Organization>[] = [
    { key: 'code', header: labels.code, value: (row) => row.code },
    { key: 'name', header: labels.name, value: (row) => row.name },
    {
      key: 'locationCapture',
      header: labels.locationCapture,
      value: (row) => (row.locationCapture ? labels.yes : labels.no),
    },
    {
      key: 'createdAt',
      header: labels.createdAt,
      value: (row) => row.createdAt,
      cell: (row) => new Date(row.createdAt).toLocaleString(locale),
    },
  ];

  const load = useCallback(async () => (await api.listOrganizations()).organizations, []);

  return (
    <SettingsSection
      title={labels.sectionOrganizations}
      hint={labels.organizationsHint}
      csvName="organizations"
      columns={columns}
      rowKey={(row) => row.id}
      load={load}
      canRead={permissions.includes('organization.read')}
      canWrite={permissions.includes('organization.manage')}
      onCopy={(row) => {
        setCode('');
        setName(row.name);
      }}
      rowActions={(row, reload) =>
        permissions.includes('organization.manage') ? (
          <button
            type="button"
            onClick={() => {
              void api
                .updateOrganization(row.id, { locationCapture: !row.locationCapture })
                .then(() => reload());
            }}
          >
            {row.locationCapture ? labels.stopLocationCapture : labels.startLocationCapture}
          </button>
        ) : null
      }
      submit={async () => {
        await api.createOrganization({ code, name });
        setCode('');
        setName('');
      }}
      form={
        <>
          <TextField
            id="organization-code"
            label={labels.code}
            value={code}
            onChange={setCode}
            required
            hint={labels.codeHint}
          />
          <TextField
            id="organization-name"
            label={labels.name}
            value={name}
            onChange={setName}
            required
          />
        </>
      }
    />
  );
}
