import type {
  Employee,
  WorkCategoryRecord,
  WorkCycleRecord,
  WorkPattern,
} from '@staffweave/contracts';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { useLocale } from '../../i18n/LocaleProvider.tsx';
import type { SectionProps } from '../AdminConsole.tsx';
import { type Column, FormValidationError, SelectField, TextField } from '../resource.tsx';
import { SettingsSection } from '../SettingsSection.tsx';

/**
 * 勤務周期と、従業員への割当・予定の生成。
 *
 * 曜日を前提にしません。長さの決まった並びを繰り返すため、週休 3 日も
 * 2 勤 2 休も同じ仕組みで表せます。
 *
 * 周期の 1 日は勤務パターン（所定時刻）と勤務区分（休憩・みなし・深夜帯・
 * 中抜けの扱い）の両方を持てます。片方で他方を代用できません。
 */
export function WorkCycleSettings({ permissions }: SectionProps): React.JSX.Element {
  const { messages } = useLocale();
  const labels = messages.admin;

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [cycleLength, setCycleLength] = useState('7');
  const [workingDays, setWorkingDays] = useState('5');
  const [patternId, setPatternId] = useState('');
  const [categoryId, setCategoryId] = useState('');

  const [patterns, setPatterns] = useState<WorkPattern[]>([]);
  const [categories, setCategories] = useState<WorkCategoryRecord[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [cycles, setCycles] = useState<WorkCycleRecord[]>([]);

  const [employeeId, setEmployeeId] = useState('');
  const [cycleId, setCycleId] = useState('');
  const [anchorDate, setAnchorDate] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [outcome, setOutcome] = useState<string | null>(null);

  const canWrite = permissions.includes('organization.manage');
  const canRead = permissions.includes('organization.read');

  useEffect(() => {
    if (!canRead) return;
    void api.listWorkPatterns().then(({ workPatterns }) => {
      setPatterns(workPatterns);
      setPatternId((current) => current || (workPatterns[0]?.id ?? ''));
    });
    void api.listWorkCategories().then(({ workCategories }) => {
      setCategories(workCategories);
      setCategoryId((current) => current || (workCategories[0]?.id ?? ''));
    });
    void api.listEmployees().then(({ employees: list }) => {
      setEmployees(list);
      setEmployeeId((current) => current || (list[0]?.id ?? ''));
    });
  }, [canRead]);

  const columns: Column<WorkCycleRecord>[] = [
    { key: 'code', header: labels.code, value: (row) => row.code },
    { key: 'name', header: labels.name, value: (row) => row.name },
    { key: 'length', header: labels.cycleLength, value: (row) => row.cycleLength },
    {
      key: 'working',
      header: labels.cycleWorkingDays,
      value: (row) => row.days.filter((day) => day.dayType === 'working_day').length,
    },
  ];

  const load = useCallback(async () => {
    const { workCycles } = await api.listWorkCycles();
    setCycles(workCycles);
    setCycleId((current) => current || (workCycles[0]?.id ?? ''));
    return workCycles;
  }, []);

  return (
    <SettingsSection
      title={labels.sectionWorkCycles}
      hint={labels.workCyclesHint}
      csvName="work-cycles"
      columns={columns}
      rowKey={(row) => row.id}
      load={load}
      canRead={canRead}
      canWrite={canWrite}
      emptyMessage={labels.noWorkCycles}
      submit={async () => {
        const length = Number(cycleLength);
        const working = Number(workingDays);
        if (working > length) throw new FormValidationError(labels.cycleWorkingDaysTooMany);
        if (patternId === '') throw new FormValidationError(labels.cycleNeedsPattern);

        // 前半を勤務日、後半を休日として並べる。順番を細かく決めたい場合は
        // 作ったあとに周期を作り直す。
        const days = Array.from({ length }, (_unused, index) => ({
          position: index,
          dayType: (index < working ? 'working_day' : 'non_working_day') as
            | 'working_day'
            | 'non_working_day',
          ...(index < working ? { workPatternId: patternId } : {}),
          ...(index < working && categoryId !== '' ? { workCategoryId: categoryId } : {}),
        }));
        await api.createWorkCycle({ code, name, cycleLength: length, days });
        setCode('');
      }}
      form={
        <>
          <TextField
            id="cycle-code"
            label={labels.code}
            value={code}
            onChange={setCode}
            required
            hint={labels.codeHint}
          />
          <TextField id="cycle-name" label={labels.name} value={name} onChange={setName} required />
          <TextField
            id="cycle-length"
            label={labels.cycleLength}
            type="number"
            value={cycleLength}
            onChange={setCycleLength}
            min={1}
            max={366}
            required
            hint={labels.cycleLengthHint}
          />
          <TextField
            id="cycle-working-days"
            label={labels.cycleWorkingDays}
            type="number"
            value={workingDays}
            onChange={setWorkingDays}
            min={0}
            max={366}
            required
          />
          <SelectField
            id="cycle-pattern"
            label={labels.workPattern}
            value={patternId}
            onChange={setPatternId}
            options={patterns.map((pattern) => ({
              value: pattern.id,
              label: `${pattern.code} ${pattern.name}`,
            }))}
          />
          <SelectField
            id="cycle-category"
            label={labels.workCategory}
            value={categoryId}
            onChange={setCategoryId}
            options={categories.map((category) => ({
              value: category.id,
              label: `${category.code} ${category.displayName}`,
            }))}
            hint={labels.cycleCategoryHint}
          />
        </>
      }
      toolbar={
        canWrite ? (
          <>
            <SelectField
              id="cycle-assign-employee"
              label={labels.employee}
              value={employeeId}
              onChange={setEmployeeId}
              options={employees.map((employee) => ({
                value: employee.id,
                label: `${employee.employeeNumber} ${employee.displayName}`,
              }))}
            />
            <SelectField
              id="cycle-assign-cycle"
              label={labels.workCycle}
              value={cycleId}
              onChange={setCycleId}
              options={cycles.map((cycle) => ({
                value: cycle.id,
                label: `${cycle.code} ${cycle.name}`,
              }))}
            />
            <TextField
              id="cycle-anchor-date"
              label={labels.anchorDate}
              type="date"
              value={anchorDate}
              onChange={setAnchorDate}
              hint={labels.anchorDateHint}
            />
            <TextField
              id="cycle-effective-from"
              label={labels.effectiveFrom}
              type="date"
              value={effectiveFrom}
              onChange={setEffectiveFrom}
            />
            <button
              type="button"
              disabled={anchorDate === '' || effectiveFrom === ''}
              onClick={() => {
                setOutcome(null);
                void api
                  .assignWorkCycle({ employeeId, workCycleId: cycleId, anchorDate, effectiveFrom })
                  .then(() => setOutcome(labels.assigned))
                  .catch((error: unknown) =>
                    setOutcome(error instanceof Error ? error.message : labels.saveFailed),
                  );
              }}
            >
              {labels.assignWorkCycle}
            </button>
            <TextField
              id="cycle-generate-from"
              label={labels.generateFrom}
              type="date"
              value={from}
              onChange={setFrom}
            />
            <TextField
              id="cycle-generate-to"
              label={labels.generateTo}
              type="date"
              value={to}
              onChange={setTo}
            />
            <button
              type="button"
              disabled={from === '' || to === ''}
              onClick={() => {
                setOutcome(null);
                void api
                  .generateWorkSchedules({ employeeId, from, to })
                  .then((result) =>
                    setOutcome(
                      labels.generatedOutcome(result.created, result.skipped, result.uncovered),
                    ),
                  )
                  .catch((error: unknown) =>
                    setOutcome(error instanceof Error ? error.message : labels.saveFailed),
                  );
              }}
            >
              {labels.generateSchedules}
            </button>
            {outcome !== null && <p className="notice">{outcome}</p>}
          </>
        ) : undefined
      }
    />
  );
}
