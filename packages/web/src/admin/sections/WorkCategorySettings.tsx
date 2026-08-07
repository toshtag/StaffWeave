import type { WorkCategoryRecord, WorkCategoryType } from '@staffweave/contracts';
import { WORK_CATEGORY_TYPES } from '@staffweave/contracts';
import { useCallback, useState } from 'react';
import { api } from '../../api/client.ts';
import { useLocale } from '../../i18n/LocaleProvider.tsx';
import type { SectionProps } from '../AdminConsole.tsx';
import { CheckboxField, type Column, SelectField, TextField } from '../resource.tsx';
import { SettingsSection } from '../SettingsSection.tsx';

/**
 * 勤務区分。
 *
 * 同じ code で期間を分けて改定する。期間の重なる版は作れない。
 * 過去の集計は当時の版で計算した結果を持ち、あとからの改定で書き換わらない。
 */

/** 「9:00」のような入力を、現地 0 時からの分数へ直す。空欄は未設定として扱う。 */
function minutesOf(text: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return undefined;
  return Number(match[1]) * 60 + Number(match[2]);
}

function clockOf(minutes: number | null): string {
  if (minutes === null) return '';
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function WorkCategorySettings({ permissions }: SectionProps): React.JSX.Element {
  const { messages } = useLocale();
  const labels = messages.admin;
  const [code, setCode] = useState('');
  const [internalName, setInternalName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [categoryType, setCategoryType] = useState<WorkCategoryType>('working_day');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [breakStart, setBreakStart] = useState('');
  const [breakEnd, setBreakEnd] = useState('');
  const [shift, setShift] = useState(false);

  const columns: Column<WorkCategoryRecord>[] = [
    { key: 'code', header: labels.code, value: (row) => row.code },
    { key: 'displayName', header: labels.displayName, value: (row) => row.displayName },
    {
      key: 'categoryType',
      header: labels.categoryType,
      value: (row) => labels.workCategoryType[row.categoryType],
    },
    { key: 'effectiveFrom', header: labels.effectiveFrom, value: (row) => row.effectiveFrom },
    {
      key: 'effectiveTo',
      header: labels.effectiveTo,
      value: (row) => row.effectiveTo ?? labels.openEnded,
    },
    {
      key: 'schedule',
      header: labels.scheduledHours,
      value: (row) =>
        row.scheduledStartMinutes === null
          ? ''
          : `${clockOf(row.scheduledStartMinutes)}-${clockOf(row.scheduledEndMinutes)}`,
    },
    {
      key: 'fixedBreaks',
      header: labels.fixedBreaks,
      value: (row) =>
        row.fixedBreaks
          .map((period) => `${clockOf(period.startMinutes)}-${clockOf(period.endMinutes)}`)
          .join(' '),
    },
    { key: 'shift', header: labels.shift, value: (row) => (row.shift ? labels.yes : labels.no) },
  ];

  const load = useCallback(async () => (await api.listWorkCategories()).workCategories, []);

  return (
    <SettingsSection
      title={labels.sectionWorkCategories}
      hint={labels.workCategoriesHint}
      csvName="work-categories"
      columns={columns}
      rowKey={(row) => row.id}
      load={load}
      canRead={permissions.includes('organization.read')}
      importCsv={api.importWorkCategoriesCsv}
      canWrite={permissions.includes('organization.manage')}
      emptyMessage={labels.noWorkCategories}
      onCopy={(row) => {
        setCode(row.code);
        setInternalName(row.internalName);
        setDisplayName(row.displayName);
        setCategoryType(row.categoryType);
        // 適用開始日は写さない。同じ日から始まる版は重なって作れない。
        setEffectiveFrom('');
        setStart(clockOf(row.scheduledStartMinutes));
        setEnd(clockOf(row.scheduledEndMinutes));
        setBreakStart(clockOf(row.fixedBreaks[0]?.startMinutes ?? null));
        setBreakEnd(clockOf(row.fixedBreaks[0]?.endMinutes ?? null));
        setShift(row.shift);
      }}
      submit={async () => {
        const scheduledStartMinutes = minutesOf(start);
        const scheduledEndMinutes = minutesOf(end);
        const fixedStart = minutesOf(breakStart);
        const fixedEnd = minutesOf(breakEnd);
        await api.createWorkCategory({
          code,
          internalName,
          displayName,
          categoryType,
          effectiveFrom,
          shift,
          ...(scheduledStartMinutes === undefined ? {} : { scheduledStartMinutes }),
          ...(scheduledEndMinutes === undefined ? {} : { scheduledEndMinutes }),
          ...(fixedStart === undefined || fixedEnd === undefined
            ? {}
            : { fixedBreaks: [{ startMinutes: fixedStart, endMinutes: fixedEnd }] }),
        });
        setCode('');
        setEffectiveFrom('');
      }}
      form={
        <>
          <TextField
            id="category-code"
            label={labels.code}
            value={code}
            onChange={setCode}
            required
            hint={labels.workCategoryCodeHint}
          />
          <TextField
            id="category-internal-name"
            label={labels.internalName}
            value={internalName}
            onChange={setInternalName}
            required
          />
          <TextField
            id="category-display-name"
            label={labels.displayName}
            value={displayName}
            onChange={setDisplayName}
            required
          />
          <SelectField
            id="category-type"
            label={labels.categoryType}
            value={categoryType}
            onChange={setCategoryType}
            options={WORK_CATEGORY_TYPES.map((type) => ({
              value: type,
              label: labels.workCategoryType[type],
            }))}
          />
          <TextField
            id="category-effective-from"
            label={labels.effectiveFrom}
            type="date"
            value={effectiveFrom}
            onChange={setEffectiveFrom}
            required
            hint={labels.effectiveFromHint}
          />
          <TextField
            id="category-start"
            label={labels.scheduledStart}
            value={start}
            onChange={setStart}
            hint={labels.clockHint}
          />
          <TextField
            id="category-end"
            label={labels.scheduledEnd}
            value={end}
            onChange={setEnd}
            hint={labels.scheduledEndHint}
          />
          <TextField
            id="category-break-start"
            label={labels.fixedBreakStart}
            value={breakStart}
            onChange={setBreakStart}
            hint={labels.fixedBreakHint}
          />
          <TextField
            id="category-break-end"
            label={labels.fixedBreakEnd}
            value={breakEnd}
            onChange={setBreakEnd}
          />
          <CheckboxField label={labels.shift} checked={shift} onChange={setShift} />
        </>
      }
    />
  );
}
