import type {
  Employee,
  WorkCategoryRecord,
  WorkPattern,
  WorkScheduleRecord,
} from '@staffweave/contracts';
import type { DayType } from '@staffweave/domain';
import { DAY_TYPES } from '@staffweave/domain';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { useLocale } from '../../i18n/LocaleProvider.tsx';
import type { SectionProps } from '../AdminConsole.tsx';
import { type Column, FormValidationError, SelectField, TextField } from '../resource.tsx';
import { SettingsSection } from '../SettingsSection.tsx';

/**
 * 勤務予定。
 *
 * 従業員と業務日ごとに 1 件です。周期から生成したものも、手で置いたものも
 * 同じ表に入ります。手で置いた予定を生成が黙って上書きすることはありません。
 *
 * 勤務区分を割り当てると、休憩・みなし・深夜帯の上書き・中抜けの扱いが
 * その日の計算へ効きます。日種別も、明示しなければ勤務区分から写します。
 */
export function WorkScheduleSettings({ permissions }: SectionProps): React.JSX.Element {
  const { messages } = useLocale();
  const labels = messages.admin;

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [patterns, setPatterns] = useState<WorkPattern[]>([]);
  const [categories, setCategories] = useState<WorkCategoryRecord[]>([]);

  const [employeeId, setEmployeeId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [businessDate, setBusinessDate] = useState('');
  const [dayType, setDayType] = useState<DayType | ''>('');
  const [categoryId, setCategoryId] = useState('');
  const [patternId, setPatternId] = useState('');
  const [startMinutes, setStartMinutes] = useState('');
  const [endMinutes, setEndMinutes] = useState('');
  const [breakMinutes, setBreakMinutes] = useState('');

  const canWrite = permissions.includes('organization.manage');
  const canRead = permissions.includes('employee.read');

  useEffect(() => {
    if (!canRead) return;
    void api.listEmployees().then(({ employees: list }) => {
      setEmployees(list);
      setEmployeeId((current) => current || (list[0]?.id ?? ''));
    });
    void api.listWorkPatterns().then(({ workPatterns }) => setPatterns(workPatterns));
    void api.listWorkCategories().then(({ workCategories }) => setCategories(workCategories));
  }, [canRead]);

  const nameOf = (list: { id: string; code: string }[], id: string | null): string =>
    id === null ? '' : (list.find((entry) => entry.id === id)?.code ?? id);

  const columns: Column<WorkScheduleRecord>[] = [
    { key: 'date', header: labels.businessDate, value: (row) => row.businessDate },
    { key: 'dayType', header: labels.dayType, value: (row) => labels.dayTypeLabel[row.dayType] },
    {
      key: 'category',
      header: labels.workCategory,
      value: (row) => nameOf(categories, row.workCategoryId),
    },
    {
      key: 'pattern',
      header: labels.workPattern,
      value: (row) => nameOf(patterns, row.workPatternId),
    },
    { key: 'start', header: labels.scheduledStart, value: (row) => row.startMinutes ?? '' },
    { key: 'end', header: labels.scheduledEnd, value: (row) => row.endMinutes ?? '' },
    { key: 'break', header: labels.breakMinutes, value: (row) => row.breakMinutes },
  ];

  const load = useCallback(async () => {
    // 期間を決めるまでは読まない。従業員と期間の両方が要る。
    if (employeeId === '' || from === '' || to === '') return [];
    return (await api.listWorkSchedules({ employeeId, from, to })).workSchedules;
  }, [employeeId, from, to]);

  return (
    <SettingsSection
      title={labels.sectionWorkSchedules}
      hint={labels.workSchedulesHint}
      csvName="work-schedules"
      columns={columns}
      rowKey={(row) => row.businessDate}
      load={load}
      canRead={canRead}
      canWrite={canWrite}
      emptyMessage={labels.noWorkSchedules}
      onCopy={(row) => {
        setBusinessDate(row.businessDate);
        setDayType(row.dayType);
        setCategoryId(row.workCategoryId ?? '');
        setPatternId(row.workPatternId ?? '');
        setStartMinutes(row.startMinutes === null ? '' : String(row.startMinutes));
        setEndMinutes(row.endMinutes === null ? '' : String(row.endMinutes));
        setBreakMinutes(String(row.breakMinutes));
      }}
      submit={async () => {
        if (employeeId === '') throw new FormValidationError(labels.pickEmployeeFirst);
        const number = (text: string): number | undefined =>
          text.trim() === '' ? undefined : Number(text);
        await api.upsertWorkSchedule({
          employeeId,
          businessDate,
          ...(dayType === '' ? {} : { dayType }),
          ...(categoryId === '' ? {} : { workCategoryId: categoryId }),
          ...(patternId === '' ? {} : { workPatternId: patternId }),
          ...(number(startMinutes) === undefined ? {} : { startMinutes: number(startMinutes) }),
          ...(number(endMinutes) === undefined ? {} : { endMinutes: number(endMinutes) }),
          ...(number(breakMinutes) === undefined ? {} : { breakMinutes: number(breakMinutes) }),
        });
      }}
      form={
        <>
          <TextField
            id="schedule-business-date"
            label={labels.businessDate}
            type="date"
            value={businessDate}
            onChange={setBusinessDate}
            required
          />
          <SelectField
            id="schedule-day-type"
            label={labels.dayType}
            value={dayType}
            onChange={(value) => setDayType(value as DayType | '')}
            options={[
              // 空にすると、勤務区分の種別から写す。
              { value: '', label: labels.dayTypeFromCategory },
              ...DAY_TYPES.map((value) => ({ value, label: labels.dayTypeLabel[value] })),
            ]}
          />
          <SelectField
            id="schedule-category"
            label={labels.workCategory}
            value={categoryId}
            onChange={setCategoryId}
            options={[
              { value: '', label: labels.none },
              ...categories.map((category) => ({
                value: category.id,
                label: `${category.code} ${category.displayName}`,
              })),
            ]}
            hint={labels.scheduleCategoryHint}
          />
          <SelectField
            id="schedule-pattern"
            label={labels.workPattern}
            value={patternId}
            onChange={setPatternId}
            options={[
              { value: '', label: labels.none },
              ...patterns.map((pattern) => ({
                value: pattern.id,
                label: `${pattern.code} ${pattern.name}`,
              })),
            ]}
          />
          <TextField
            id="schedule-start"
            label={labels.scheduledStart}
            type="number"
            value={startMinutes}
            onChange={setStartMinutes}
            min={0}
            max={1439}
            hint={labels.minutesFromMidnightHint}
          />
          <TextField
            id="schedule-end"
            label={labels.scheduledEnd}
            type="number"
            value={endMinutes}
            onChange={setEndMinutes}
            min={1}
            max={2879}
          />
          <TextField
            id="schedule-break"
            label={labels.breakMinutes}
            type="number"
            value={breakMinutes}
            onChange={setBreakMinutes}
            min={0}
            max={1440}
          />
        </>
      }
      toolbar={
        <>
          <SelectField
            id="schedule-employee"
            label={labels.employee}
            value={employeeId}
            onChange={setEmployeeId}
            options={employees.map((employee) => ({
              value: employee.id,
              label: `${employee.employeeNumber} ${employee.displayName}`,
            }))}
          />
          <TextField
            id="schedule-from"
            label={labels.generateFrom}
            type="date"
            value={from}
            onChange={setFrom}
          />
          <TextField
            id="schedule-to"
            label={labels.generateTo}
            type="date"
            value={to}
            onChange={setTo}
          />
        </>
      }
    />
  );
}
