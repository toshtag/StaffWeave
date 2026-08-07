import type { CalculationRuleVersionRecord } from '@staffweave/contracts';
import { useCallback, useState } from 'react';
import { api } from '../../api/client.ts';
import { useLocale } from '../../i18n/LocaleProvider.tsx';
import type { SectionProps } from '../AdminConsole.tsx';
import { type Column, SelectField, TextField } from '../resource.tsx';
import { SettingsSection } from '../SettingsSection.tsx';

/**
 * 計算規則の版。
 *
 * 法定内と法定外を分ける閾値は、製品が既定値を持たない。事業者が決める。
 * 設定しないまま計算が進むと、誰も決めていない値が結果として残る。
 * 未設定は 0 ではなく「未設定」として示す。
 *
 * 版は適用開始日で重ねる。過去の集計は当時の版のまま残り、
 * あとからここを直しても書き換わらない。
 */
function numberOr(text: string): number | undefined {
  const value = Number(text.trim());
  return text.trim() === '' || Number.isNaN(value) ? undefined : value;
}

export function CalculationRuleSettings({ permissions }: SectionProps): React.JSX.Element {
  const { messages } = useLocale();
  const labels = messages.admin;
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [dayStart, setDayStart] = useState('0');
  const [nightStart, setNightStart] = useState('1320');
  const [nightEnd, setNightEnd] = useState('300');
  const [rounding, setRounding] = useState('1');
  const [roundingMode, setRoundingMode] = useState<'none' | 'down' | 'nearest'>('down');
  const [dailyLegal, setDailyLegal] = useState('');
  const [weeklyLegal, setWeeklyLegal] = useState('');
  const [weekStartsOn, setWeekStartsOn] = useState('0');
  const [monthlyOvertimeLimit, setMonthlyOvertimeLimit] = useState('');
  const [averageOvertimeLimit, setAverageOvertimeLimit] = useState('');
  const [averageOvertimeMonths, setAverageOvertimeMonths] = useState('');
  const [monthStartsOn, setMonthStartsOn] = useState('1');

  const unset = labels.unconfigured;

  const columns: Column<CalculationRuleVersionRecord>[] = [
    { key: 'effectiveFrom', header: labels.effectiveFrom, value: (row) => row.effectiveFrom },
    { key: 'dayStart', header: labels.dayStartMinutes, value: (row) => row.dayStartMinutes },
    {
      key: 'night',
      header: labels.nightBand,
      value: (row) => `${row.nightStartMinutes}-${row.nightEndMinutes}`,
    },
    {
      key: 'rounding',
      header: labels.rounding,
      value: (row) => `${row.roundingMinutes} / ${labels.roundingMode[row.roundingMode]}`,
    },
    {
      key: 'dailyLegal',
      header: labels.dailyLegalMinutes,
      value: (row) => row.dailyLegalMinutes ?? unset,
    },
    {
      key: 'weeklyLegal',
      header: labels.weeklyLegalMinutes,
      value: (row) => row.weeklyLegalMinutes ?? unset,
    },
    { key: 'weekStartsOn', header: labels.weekStartsOn, value: (row) => row.weekStartsOn },
    { key: 'monthStartsOn', header: labels.monthStartsOn, value: (row) => row.monthStartsOn },
  ];

  const load = useCallback(
    async () => (await api.listCalculationRuleVersions()).calculationRuleVersions,
    [],
  );

  return (
    <SettingsSection
      title={labels.sectionCalculationRules}
      hint={labels.calculationRulesHint}
      csvName="calculation-rule-versions"
      columns={columns}
      rowKey={(row) => row.id}
      load={load}
      canRead={permissions.includes('organization.read')}
      canWrite={permissions.includes('organization.manage')}
      emptyMessage={labels.noCalculationRules}
      onCopy={(row) => {
        // 適用開始日は写さない。同じ日の版は 1 つしか置けない。
        setEffectiveFrom('');
        setDayStart(String(row.dayStartMinutes));
        setNightStart(String(row.nightStartMinutes));
        setNightEnd(String(row.nightEndMinutes));
        setRounding(String(row.roundingMinutes));
        setRoundingMode(row.roundingMode);
        setDailyLegal(row.dailyLegalMinutes === null ? '' : String(row.dailyLegalMinutes));
        setWeeklyLegal(row.weeklyLegalMinutes === null ? '' : String(row.weeklyLegalMinutes));
        setWeekStartsOn(String(row.weekStartsOn));
        setMonthStartsOn(String(row.monthStartsOn));
      }}
      submit={async () => {
        const daily = numberOr(dailyLegal);
        const weekly = numberOr(weeklyLegal);
        const monthlyLimit = numberOr(monthlyOvertimeLimit);
        const averageLimit = numberOr(averageOvertimeLimit);
        const averageMonths = numberOr(averageOvertimeMonths);
        await api.createCalculationRuleVersion({
          effectiveFrom,
          dayStartMinutes: Number(dayStart),
          nightStartMinutes: Number(nightStart),
          nightEndMinutes: Number(nightEnd),
          roundingMinutes: Number(rounding),
          roundingMode,
          weekStartsOn: Number(weekStartsOn),
          monthStartsOn: Number(monthStartsOn),
          // 空欄は「未設定」として送らない。0 として送ると、決めていない値が決まってしまう。
          ...(daily === undefined ? {} : { dailyLegalMinutes: daily }),
          ...(weekly === undefined ? {} : { weeklyLegalMinutes: weekly }),
          ...(monthlyLimit === undefined ? {} : { monthlyOvertimeLimitMinutes: monthlyLimit }),
          // 平均の上限は月数とそろって初めて意味が決まる。片方だけは送らない。
          ...(averageLimit === undefined || averageMonths === undefined
            ? {}
            : {
                averageOvertimeLimitMinutes: averageLimit,
                averageOvertimeMonths: averageMonths,
              }),
        });
        setEffectiveFrom('');
      }}
      form={
        <>
          <TextField
            id="rule-effective-from"
            label={labels.effectiveFrom}
            type="date"
            value={effectiveFrom}
            onChange={setEffectiveFrom}
            required
            hint={labels.ruleEffectiveFromHint}
          />
          <TextField
            id="rule-day-start"
            label={labels.dayStartMinutes}
            type="number"
            value={dayStart}
            onChange={setDayStart}
            min={0}
            max={1439}
            hint={labels.dayStartHint}
          />
          <TextField
            id="rule-night-start"
            label={labels.nightStartMinutes}
            type="number"
            value={nightStart}
            onChange={setNightStart}
            min={0}
            max={1439}
          />
          <TextField
            id="rule-night-end"
            label={labels.nightEndMinutes}
            type="number"
            value={nightEnd}
            onChange={setNightEnd}
            min={0}
            max={1439}
          />
          <TextField
            id="rule-rounding"
            label={labels.roundingMinutes}
            type="number"
            value={rounding}
            onChange={setRounding}
            min={0}
            max={60}
          />
          <SelectField
            id="rule-rounding-mode"
            label={labels.roundingModeLabel}
            value={roundingMode}
            onChange={setRoundingMode}
            options={(['none', 'down', 'nearest'] as const).map((mode) => ({
              value: mode,
              label: labels.roundingMode[mode],
            }))}
          />
          <TextField
            id="rule-daily-legal"
            label={labels.dailyLegalMinutes}
            type="number"
            value={dailyLegal}
            onChange={setDailyLegal}
            min={1}
            max={1440}
            hint={labels.legalThresholdHint}
          />
          <TextField
            id="rule-weekly-legal"
            label={labels.weeklyLegalMinutes}
            type="number"
            value={weeklyLegal}
            onChange={setWeeklyLegal}
            min={1}
            max={10080}
          />
          <TextField
            id="rule-monthly-overtime-limit"
            label={labels.monthlyOvertimeLimitMinutes}
            type="number"
            value={monthlyOvertimeLimit}
            onChange={setMonthlyOvertimeLimit}
            min={1}
            max={100000}
            hint={labels.legalThresholdHint}
          />
          <TextField
            id="rule-average-overtime-limit"
            label={labels.averageOvertimeLimitMinutes}
            type="number"
            value={averageOvertimeLimit}
            onChange={setAverageOvertimeLimit}
            min={1}
            max={100000}
          />
          <TextField
            id="rule-average-overtime-months"
            label={labels.averageOvertimeMonths}
            type="number"
            value={averageOvertimeMonths}
            onChange={setAverageOvertimeMonths}
            min={2}
            max={12}
          />
          <TextField
            id="rule-week-starts-on"
            label={labels.weekStartsOn}
            type="number"
            value={weekStartsOn}
            onChange={setWeekStartsOn}
            min={0}
            max={6}
            hint={labels.weekStartsOnHint}
          />
          <TextField
            id="rule-month-starts-on"
            label={labels.monthStartsOn}
            type="number"
            value={monthStartsOn}
            onChange={setMonthStartsOn}
            min={1}
            max={28}
          />
        </>
      }
    />
  );
}
