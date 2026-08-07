import type { GapTreatment, WorkCategoryRecord, WorkCategoryType } from '@staffweave/contracts';
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

/** 空欄は「決めていない」として扱う。0 と空欄を混ぜない。 */
function numberOrUndefined(text: string): number | undefined {
  const value = Number(text.trim());
  return text.trim() === '' || Number.isNaN(value) ? undefined : value;
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
  const [effectiveTo, setEffectiveTo] = useState('');
  const [prescribed, setPrescribed] = useState('');
  const [deemed, setDeemed] = useState('');
  const [nightStart, setNightStart] = useState('');
  const [nightEnd, setNightEnd] = useState('');
  const [gapTreatment, setGapTreatment] = useState<GapTreatment>('non_working');
  const [countsAsWorkingDay, setCountsAsWorkingDay] = useState(true);
  const [color, setColor] = useState('');
  const [breakStart2, setBreakStart2] = useState('');
  const [breakEnd2, setBreakEnd2] = useState('');
  const [autoThreshold, setAutoThreshold] = useState('');
  const [autoAdditional, setAutoAdditional] = useState('');

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
      importColumns={[
        { key: 'code', value: (row) => row.code },
        { key: 'internal_name', value: (row) => row.internalName },
        { key: 'display_name', value: (row) => row.displayName },
        // 値の集合は機械の値で出す。表示の名前で出すと、そのまま戻せない。
        { key: 'category_type', value: (row) => row.categoryType },
        { key: 'effective_from', value: (row) => row.effectiveFrom },
        { key: 'effective_to', value: (row) => row.effectiveTo ?? '' },
        { key: 'scheduled_start', value: (row) => row.scheduledStartMinutes ?? '' },
        { key: 'scheduled_end', value: (row) => row.scheduledEndMinutes ?? '' },
        { key: 'shift', value: (row) => String(row.shift) },
        { key: 'counts_as_working_day', value: (row) => String(row.countsAsWorkingDay) },
      ]}
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
        setEffectiveTo(row.effectiveTo ?? '');
        setPrescribed(row.prescribedMinutes === null ? '' : String(row.prescribedMinutes));
        setDeemed(row.deemedMinutes === null ? '' : String(row.deemedMinutes));
        setNightStart(row.nightStartMinutes === null ? '' : String(row.nightStartMinutes));
        setNightEnd(row.nightEndMinutes === null ? '' : String(row.nightEndMinutes));
        setGapTreatment(row.gapTreatment);
        setCountsAsWorkingDay(row.countsAsWorkingDay);
        setColor(row.color ?? '');
        setBreakStart2(clockOf(row.fixedBreaks[1]?.startMinutes ?? null));
        setBreakEnd2(clockOf(row.fixedBreaks[1]?.endMinutes ?? null));
        setAutoThreshold(
          row.autoBreaks[0] === undefined ? '' : String(row.autoBreaks[0].thresholdMinutes),
        );
        setAutoAdditional(
          row.autoBreaks[0] === undefined ? '' : String(row.autoBreaks[0].additionalMinutes),
        );
      }}
      submit={async () => {
        const scheduledStartMinutes = minutesOf(start);
        const scheduledEndMinutes = minutesOf(end);
        // 固定休憩は複数置ける。空の組は送らない。
        const fixedBreaks = [
          [minutesOf(breakStart), minutesOf(breakEnd)],
          [minutesOf(breakStart2), minutesOf(breakEnd2)],
        ]
          .filter(
            (pair): pair is [number, number] => pair[0] !== undefined && pair[1] !== undefined,
          )
          .map(([startMinutes, endMinutes]) => ({ startMinutes, endMinutes }));

        const threshold = numberOrUndefined(autoThreshold);
        const additional = numberOrUndefined(autoAdditional);
        // 深夜帯は両方そろって初めて上書きになる。片方だけでは意味が決まらない。
        const nightStartMinutes = numberOrUndefined(nightStart);
        const nightEndMinutes = numberOrUndefined(nightEnd);

        await api.createWorkCategory({
          code,
          internalName,
          displayName,
          categoryType,
          effectiveFrom,
          shift,
          gapTreatment,
          countsAsWorkingDay,
          ...(effectiveTo === '' ? {} : { effectiveTo }),
          ...(color === '' ? {} : { color }),
          ...(scheduledStartMinutes === undefined ? {} : { scheduledStartMinutes }),
          ...(scheduledEndMinutes === undefined ? {} : { scheduledEndMinutes }),
          ...(numberOrUndefined(prescribed) === undefined
            ? {}
            : { prescribedMinutes: numberOrUndefined(prescribed) }),
          ...(numberOrUndefined(deemed) === undefined
            ? {}
            : { deemedMinutes: numberOrUndefined(deemed) }),
          ...(nightStartMinutes === undefined || nightEndMinutes === undefined
            ? {}
            : { nightStartMinutes, nightEndMinutes }),
          ...(fixedBreaks.length === 0 ? {} : { fixedBreaks }),
          ...(threshold === undefined || additional === undefined
            ? {}
            : { autoBreaks: [{ thresholdMinutes: threshold, additionalMinutes: additional }] }),
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
          <TextField
            id="category-break-start-2"
            label={`${labels.fixedBreakStart} 2`}
            value={breakStart2}
            onChange={setBreakStart2}
          />
          <TextField
            id="category-break-end-2"
            label={`${labels.fixedBreakEnd} 2`}
            value={breakEnd2}
            onChange={setBreakEnd2}
          />
          <TextField
            id="category-auto-threshold"
            label={labels.autoBreakThreshold}
            type="number"
            value={autoThreshold}
            onChange={setAutoThreshold}
            min={1}
            max={1440}
          />
          <TextField
            id="category-auto-additional"
            label={labels.autoBreakAdditional}
            type="number"
            value={autoAdditional}
            onChange={setAutoAdditional}
            min={1}
            max={1440}
          />
          <TextField
            id="category-effective-to"
            label={labels.effectiveTo}
            type="date"
            value={effectiveTo}
            onChange={setEffectiveTo}
          />
          <TextField
            id="category-prescribed"
            label={labels.prescribedMinutesLabel}
            type="number"
            value={prescribed}
            onChange={setPrescribed}
            min={0}
            max={1440}
            hint={labels.workCategoryFieldsHint}
          />
          <TextField
            id="category-deemed"
            label={labels.categoryDeemedMinutes}
            type="number"
            value={deemed}
            onChange={setDeemed}
            min={0}
            max={1440}
          />
          <TextField
            id="category-night-start"
            label={labels.nightStart}
            type="number"
            value={nightStart}
            onChange={setNightStart}
            min={0}
            max={1439}
          />
          <TextField
            id="category-night-end"
            label={labels.nightEnd}
            type="number"
            value={nightEnd}
            onChange={setNightEnd}
            min={0}
            max={1439}
          />
          <SelectField
            id="category-gap-treatment"
            label={labels.gapTreatmentLabel}
            value={gapTreatment}
            onChange={(value) => setGapTreatment(value as GapTreatment)}
            options={(['non_working', 'break'] as const).map((value) => ({
              value,
              label: labels.gapTreatmentType[value],
            }))}
          />
          <TextField
            id="category-color"
            label={labels.colorLabel}
            value={color}
            onChange={setColor}
          />
          <CheckboxField
            label={labels.countsAsWorkingDay}
            checked={countsAsWorkingDay}
            onChange={setCountsAsWorkingDay}
          />
          <CheckboxField label={labels.shift} checked={shift} onChange={setShift} />
        </>
      }
    />
  );
}
