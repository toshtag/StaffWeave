import type {
  Employee,
  LaborSystemAssignmentRecord,
  LaborSystemType,
  SettlementBasis,
} from '@staffweave/contracts';
import { LABOR_SYSTEM_TYPES, SETTLEMENT_BASES } from '@staffweave/contracts';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { useLocale } from '../../i18n/LocaleProvider.tsx';
import type { SectionProps } from '../AdminConsole.tsx';
import { type Column, SelectField, TextField } from '../resource.tsx';
import { SettingsSection } from '../SettingsSection.tsx';

/**
 * 労働形態の割当。
 *
 * 制度ごとに要る値が違う。フレックスと変形は清算期間（月数・起算日・総枠）、
 * 裁量はみなし分数が要る。そろっていない割当は DB の制約が断る。
 *
 * 総枠と総枠の決め方を画面から入れられないと、フレックスと変形の割当は
 * 通常の操作では作れない。DB が必須にしている値を画面が送らないためで、
 * 画面からは「制度を選べるのに登録できない」ようにしか見えない。
 */
/**
 * 帯は開始と終了がそろって初めて意味を持つ。片方だけなら送らない。
 *
 * DB も「両方 NULL か、両方あるか」を制約にしている。片方だけ送ると
 * 制約違反として断られ、画面には理由の分からない失敗だけが出る。
 */
function optionalBand(
  start: string,
  end: string,
  prefix: 'core' | 'flexible',
): Record<string, number> {
  if (start.trim() === '' || end.trim() === '') return {};
  return {
    [`${prefix}StartMinutes`]: Number(start),
    [`${prefix}EndMinutes`]: Number(end),
  };
}

export function LaborSystemSettings({ permissions }: SectionProps): React.JSX.Element {
  const { messages } = useLocale();
  const labels = messages.admin;
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [systemType, setSystemType] = useState<LaborSystemType>('normal');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [settlementMonths, setSettlementMonths] = useState('1');
  const [settlementStartsOn, setSettlementStartsOn] = useState('');
  const [settlementTotalMinutes, setSettlementTotalMinutes] = useState('');
  const [settlementBasis, setSettlementBasis] = useState<SettlementBasis>('legal');
  const [coreStartMinutes, setCoreStartMinutes] = useState('');
  const [coreEndMinutes, setCoreEndMinutes] = useState('');
  const [flexibleStartMinutes, setFlexibleStartMinutes] = useState('');
  const [flexibleEndMinutes, setFlexibleEndMinutes] = useState('');
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
      key: 'settlementTotal',
      header: labels.settlementTotalMinutes,
      value: (row) =>
        row.settlementTotalMinutes === null
          ? ''
          : `${row.settlementTotalMinutes} (${
              row.settlementBasis === null ? '' : labels.settlementBasisType[row.settlementBasis]
            })`,
    },
    {
      key: 'deemed',
      header: labels.deemedMinutes,
      value: (row) => row.deemedMinutes ?? '',
    },
  ];

  // 一覧は従業員を指定して読む。API は対象者を必須にしており、
  // 指定しないと要求そのものが通らない。従業員を切り替えたら読み直す。
  const load = useCallback(async () => {
    if (employeeId === '') return [];
    return (await api.listLaborSystemAssignments({ employeeId })).laborSystemAssignments;
  }, [employeeId]);

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
        setSettlementTotalMinutes(
          row.settlementTotalMinutes === null ? '' : String(row.settlementTotalMinutes),
        );
        setSettlementBasis(row.settlementBasis ?? 'legal');
        setCoreStartMinutes(row.coreStartMinutes === null ? '' : String(row.coreStartMinutes));
        setCoreEndMinutes(row.coreEndMinutes === null ? '' : String(row.coreEndMinutes));
        setFlexibleStartMinutes(
          row.flexibleStartMinutes === null ? '' : String(row.flexibleStartMinutes),
        );
        setFlexibleEndMinutes(
          row.flexibleEndMinutes === null ? '' : String(row.flexibleEndMinutes),
        );
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
                // 総枠の決め方は変形では要らないが、送っても害は無い。
                // 送る値は画面で選んだものにする。固定にすると、
                // 所定で決めた事業所の割当が黙って法定として保存される。
                settlementBasis,
                settlementTotalMinutes: Number(settlementTotalMinutes),
              }
            : {}),
          // コアタイムとフレキシブルタイムは任意。空なら帯を設けない。
          ...(needsSettlement ? optionalBand(coreStartMinutes, coreEndMinutes, 'core') : {}),
          ...(needsSettlement
            ? optionalBand(flexibleStartMinutes, flexibleEndMinutes, 'flexible')
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
                required
              />
              <TextField
                id="labor-settlement-total-minutes"
                label={labels.settlementTotalMinutes}
                type="number"
                value={settlementTotalMinutes}
                onChange={setSettlementTotalMinutes}
                min={1}
                required
              />
              <SelectField
                id="labor-settlement-basis"
                label={labels.settlementBasis}
                value={settlementBasis}
                onChange={(value) => setSettlementBasis(value as SettlementBasis)}
                options={SETTLEMENT_BASES.map((basis) => ({
                  value: basis,
                  label: labels.settlementBasisType[basis],
                }))}
              />
              <TextField
                id="labor-core-start-minutes"
                label={labels.coreStartMinutes}
                type="number"
                value={coreStartMinutes}
                onChange={setCoreStartMinutes}
                min={0}
                max={1439}
                hint={labels.coreTimeHint}
              />
              <TextField
                id="labor-core-end-minutes"
                label={labels.coreEndMinutes}
                type="number"
                value={coreEndMinutes}
                onChange={setCoreEndMinutes}
                min={1}
                max={1440}
              />
              <TextField
                id="labor-flexible-start-minutes"
                label={labels.flexibleStartMinutes}
                type="number"
                value={flexibleStartMinutes}
                onChange={setFlexibleStartMinutes}
                min={0}
                max={1439}
              />
              <TextField
                id="labor-flexible-end-minutes"
                label={labels.flexibleEndMinutes}
                type="number"
                value={flexibleEndMinutes}
                onChange={setFlexibleEndMinutes}
                min={1}
                max={1440}
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
