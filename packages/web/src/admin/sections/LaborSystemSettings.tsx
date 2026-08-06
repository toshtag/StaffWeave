import type { Employee, LaborSystemAssignmentRecord, LaborSystemType } from '@staffweave/contracts';
import { LABOR_SYSTEM_TYPES } from '@staffweave/contracts';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { useLocale } from '../../i18n/LocaleProvider.tsx';
import type { SectionProps } from '../AdminConsole.tsx';
import { type Column, SelectField, TextField } from '../resource.tsx';
import { SettingsSection } from '../SettingsSection.tsx';

/**
 * 労働形態の割当。
 *
 * 制度ごとに要る値が違う。フレックスと変形は清算期間、裁量はみなし分数が要る。
 * そろっていない割当は DB の制約が断るため、ここでは入力欄の出し分けだけを行う。
 */
export function LaborSystemSettings({ permissions }: SectionProps): React.JSX.Element {
  const { messages } = useLocale();
  const labels = messages.admin;
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [systemType, setSystemType] = useState<LaborSystemType>('normal');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [settlementMonths, setSettlementMonths] = useState('1');
  const [settlementStartsOn, setSettlementStartsOn] = useState('');
  const [deemedMinutes, setDeemedMinutes] = useState('480');
  const [endingId, setEndingId] = useState<string | null>(null);
  const [endsOn, setEndsOn] = useState('');

  useEffect(() => {
    void api
      .listEmployees()
      .then((body) => {
        setEmployees(body.employees);
        setEmployeeId((current) => current || (body.employees[0]?.id ?? ''));
      })
      .catch(() => setEmployees([]));
  }, []);

  const employeeLabel = (id: string): string => {
    const employee = employees.find((candidate) => candidate.id === id);
    return employee === undefined ? id : `${employee.employeeNumber} ${employee.displayName}`;
  };

  const columns: Column<LaborSystemAssignmentRecord>[] = [
    { key: 'employee', header: labels.employee, value: (row) => employeeLabel(row.employeeId) },
    {
      key: 'systemType',
      header: labels.laborSystem,
      value: (row) => labels.laborSystemType[row.systemType],
    },
    { key: 'effectiveFrom', header: labels.effectiveFrom, value: (row) => row.effectiveFrom },
    {
      key: 'effectiveTo',
      header: labels.effectiveTo,
      value: (row) => row.effectiveTo ?? labels.openEnded,
    },
    {
      key: 'settlement',
      header: labels.settlementPeriod,
      value: (row) =>
        row.settlementMonths === null
          ? ''
          : `${row.settlementMonths}${labels.months} ${row.settlementStartsOn ?? ''}`,
    },
    {
      key: 'deemed',
      header: labels.deemedMinutes,
      value: (row) => row.deemedMinutes ?? '',
    },
  ];

  const load = useCallback(
    async () => (await api.listLaborSystemAssignments()).laborSystemAssignments,
    [],
  );

  const needsSettlement = systemType === 'flex' || systemType === 'variable';
  const needsDeemed = systemType === 'discretionary';

  return (
    <SettingsSection
      title={labels.sectionLaborSystems}
      hint={labels.laborSystemsHint}
      csvName="labor-system-assignments"
      columns={columns}
      rowKey={(row) => row.id}
      load={load}
      canRead={permissions.includes('employee.read')}
      canWrite={permissions.includes('employee.manage')}
      emptyMessage={labels.noLaborSystems}
      onCopy={(row) => {
        setEmployeeId(row.employeeId);
        setSystemType(row.systemType);
        setEffectiveFrom('');
        setSettlementMonths(String(row.settlementMonths ?? 1));
        setSettlementStartsOn(row.settlementStartsOn ?? '');
        setDeemedMinutes(String(row.deemedMinutes ?? 480));
      }}
      rowActions={(row, reload) =>
        row.effectiveTo === null ? (
          endingId === row.id ? (
            <span className="row-inline-form">
              <input
                type="date"
                aria-label={labels.effectiveTo}
                value={endsOn}
                onChange={(event) => setEndsOn(event.target.value)}
              />
              <button
                type="button"
                onClick={() => {
                  void api
                    .endLaborSystemAssignment(row.id, endsOn)
                    .then(() => {
                      setEndingId(null);
                      return reload();
                    })
                    .catch(() => setEndingId(null));
                }}
              >
                {labels.save}
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setEndingId(row.id)}>
              {labels.endAssignment}
            </button>
          )
        ) : null
      }
      submit={async () => {
        await api.assignLaborSystem({
          employeeId,
          systemType,
          effectiveFrom,
          ...(needsSettlement
            ? {
                settlementMonths: Number(settlementMonths),
                settlementStartsOn,
                settlementBasis: 'legal' as const,
              }
            : {}),
          ...(needsDeemed ? { deemedMinutes: Number(deemedMinutes) } : {}),
        });
        setEffectiveFrom('');
      }}
      form={
        <>
          <SelectField
            id="labor-employee"
            label={labels.employee}
            value={employeeId}
            onChange={setEmployeeId}
            options={employees.map((employee) => ({
              value: employee.id,
              label: `${employee.employeeNumber} ${employee.displayName}`,
            }))}
          />
          <SelectField
            id="labor-system-type"
            label={labels.laborSystem}
            value={systemType}
            onChange={setSystemType}
            options={LABOR_SYSTEM_TYPES.map((type) => ({
              value: type,
              label: labels.laborSystemType[type],
            }))}
          />
          <TextField
            id="labor-effective-from"
            label={labels.effectiveFrom}
            type="date"
            value={effectiveFrom}
            onChange={setEffectiveFrom}
            required
          />
          {needsSettlement && (
            <>
              <TextField
                id="labor-settlement-months"
                label={labels.settlementMonths}
                type="number"
                value={settlementMonths}
                onChange={setSettlementMonths}
                min={1}
                max={12}
                hint={labels.settlementHint}
              />
              <TextField
                id="labor-settlement-starts-on"
                label={labels.settlementStartsOn}
                type="date"
                value={settlementStartsOn}
                onChange={setSettlementStartsOn}
              />
            </>
          )}
          {needsDeemed && (
            <TextField
              id="labor-deemed"
              label={labels.deemedMinutes}
              type="number"
              value={deemedMinutes}
              onChange={setDeemedMinutes}
              min={0}
              max={1440}
              hint={labels.deemedHint}
            />
          )}
        </>
      }
    />
  );
}
