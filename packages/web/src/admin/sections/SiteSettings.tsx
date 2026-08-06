import type { Organization, Site } from '@staffweave/contracts';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { useLocale } from '../../i18n/LocaleProvider.tsx';
import type { SectionProps } from '../AdminConsole.tsx';
import { type Column, SelectField, TextField } from '../resource.tsx';
import { SettingsSection } from '../SettingsSection.tsx';

/**
 * 拠点。
 *
 * 時間帯は拠点が持つ。業務日の切り替わりは拠点の時計で決まるため、
 * ここを間違えると、その拠点の勤怠が丸ごと 1 日ずれる。
 */
export function SiteSettings({ permissions }: SectionProps): React.JSX.Element {
  const { messages } = useLocale();
  const labels = messages.admin;
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [timeZone, setTimeZone] = useState('');

  useEffect(() => {
    void api
      .listOrganizations()
      .then((body) => {
        setOrganizations(body.organizations);
        setOrganizationId((current) => current || (body.organizations[0]?.id ?? ''));
      })
      .catch(() => setOrganizations([]));
  }, []);

  const nameOfOrganization = (id: string): string =>
    organizations.find((organization) => organization.id === id)?.code ?? id;

  const columns: Column<Site>[] = [
    { key: 'code', header: labels.code, value: (row) => row.code },
    { key: 'name', header: labels.name, value: (row) => row.name },
    {
      key: 'organization',
      header: labels.organization,
      value: (row) => nameOfOrganization(row.organizationId),
    },
    { key: 'timeZone', header: labels.timeZone, value: (row) => row.timeZone },
  ];

  const load = useCallback(async () => (await api.listSites()).sites, []);

  return (
    <SettingsSection
      title={labels.sectionSites}
      hint={labels.sitesHint}
      csvName="sites"
      columns={columns}
      rowKey={(row) => row.id}
      load={load}
      canRead={permissions.includes('organization.read')}
      canWrite={permissions.includes('organization.manage')}
      emptyMessage={labels.noSites}
      onCopy={(row) => {
        setCode('');
        setName(row.name);
        setOrganizationId(row.organizationId);
        setTimeZone(row.timeZone);
      }}
      submit={async () => {
        await api.createSite({
          organizationId,
          code,
          name,
          ...(timeZone.trim() === '' ? {} : { timeZone }),
        });
        setCode('');
        setName('');
      }}
      form={
        <>
          <SelectField
            id="site-organization"
            label={labels.organization}
            value={organizationId}
            onChange={setOrganizationId}
            options={organizations.map((organization) => ({
              value: organization.id,
              label: `${organization.code} ${organization.name}`,
            }))}
          />
          <TextField
            id="site-code"
            label={labels.code}
            value={code}
            onChange={setCode}
            required
            hint={labels.codeHint}
          />
          <TextField id="site-name" label={labels.name} value={name} onChange={setName} required />
          <TextField
            id="site-time-zone"
            label={labels.timeZone}
            value={timeZone}
            onChange={setTimeZone}
            hint={labels.timeZoneHint}
          />
        </>
      }
    />
  );
}
