import type { CreateWorkPatternRequest, WorkPattern } from '@staffweave/contracts';
import { useCallback, useState } from 'react';
import { api } from '../../api/client.ts';
import { useLocale } from '../../i18n/LocaleProvider.tsx';
import type { SectionProps } from '../AdminConsole.tsx';
import { type Column, TextField } from '../resource.tsx';
import { SettingsSection } from '../SettingsSection.tsx';

/**
 * 勤務パターン。
 *
 * 所定時刻のひな形だけを持ちます。休憩の時間帯・みなし・深夜帯の上書き・
 * 中抜けの扱いは勤務区分にあり、パターンでは代用できません。
 * 周期から予定を作るときに、この時刻を写します。
 */
export function WorkPatternSettings({ permissions }: SectionProps): React.JSX.Element {
  const { messages } = useLocale();
  const labels = messages.admin;
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [startMinutes, setStartMinutes] = useState('540');
  const [endMinutes, setEndMinutes] = useState('1080');
  const [breakMinutes, setBreakMinutes] = useState('60');

  const columns: Column<WorkPattern>[] = [
    { key: 'code', header: labels.code, value: (row) => row.code },
    { key: 'name', header: labels.name, value: (row) => row.name },
    { key: 'start', header: labels.scheduledStart, value: (row) => row.startMinutes },
    { key: 'end', header: labels.scheduledEnd, value: (row) => row.endMinutes },
    { key: 'break', header: labels.breakMinutes, value: (row) => row.breakMinutes },
  ];

  const load = useCallback(async () => (await api.listWorkPatterns()).workPatterns, []);

  return (
    <SettingsSection
      title={labels.sectionWorkPatterns}
      hint={labels.workPatternsHint}
      csvName="work-patterns"
      columns={columns}
      rowKey={(row) => row.id}
      load={load}
      canRead={permissions.includes('organization.read')}
      canWrite={permissions.includes('organization.manage')}
      emptyMessage={labels.noWorkPatterns}
      onCopy={(row) => {
        setCode(row.code);
        setName(row.name);
        setStartMinutes(String(row.startMinutes));
        setEndMinutes(String(row.endMinutes));
        setBreakMinutes(String(row.breakMinutes));
      }}
      submit={async () => {
        const input: CreateWorkPatternRequest = {
          code,
          name,
          startMinutes: Number(startMinutes),
          endMinutes: Number(endMinutes),
          breakMinutes: Number(breakMinutes),
        };
        await api.createWorkPattern(input);
        setCode('');
      }}
      form={
        <>
          <TextField
            id="pattern-code"
            label={labels.code}
            value={code}
            onChange={setCode}
            required
            hint={labels.codeHint}
          />
          <TextField
            id="pattern-name"
            label={labels.name}
            value={name}
            onChange={setName}
            required
          />
          <TextField
            id="pattern-start"
            label={labels.scheduledStart}
            type="number"
            value={startMinutes}
            onChange={setStartMinutes}
            min={0}
            max={1439}
            required
            hint={labels.minutesFromMidnightHint}
          />
          <TextField
            id="pattern-end"
            label={labels.scheduledEnd}
            type="number"
            value={endMinutes}
            onChange={setEndMinutes}
            min={1}
            max={2879}
            required
          />
          <TextField
            id="pattern-break"
            label={labels.breakMinutes}
            type="number"
            value={breakMinutes}
            onChange={setBreakMinutes}
            min={0}
            max={1440}
          />
        </>
      }
    />
  );
}
