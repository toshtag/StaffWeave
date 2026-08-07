import type { LeaveGrantRuleRecord, LeaveTypeSettingsRecord } from '@staffweave/contracts';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { useLocale } from '../../i18n/LocaleProvider.tsx';
import type { SectionProps } from '../AdminConsole.tsx';
import { type Column, SelectField, TextField } from '../resource.tsx';
import { SettingsSection } from '../SettingsSection.tsx';

/**
 * 休暇の付与規則と、規則に従った一括付与。
 *
 * 付与する分数は段から決まる。段を置かないかぎり 1 分も付与しない。
 * 一括の実行は、積んだ件数と積まなかった件数の両方を出す。
 * 積まなかった相手を黙って飛ばすと、付与漏れに誰も気付けない。
 */
export function LeaveGrantSettings({ permissions }: SectionProps): React.JSX.Element {
  const { messages } = useLocale();
  const labels = messages.admin;

  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeSettingsRecord[]>([]);
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [serviceMonths, setServiceMonths] = useState('6');
  const [minutes, setMinutes] = useState('4800');
  const [basis, setBasis] = useState<'fixed_date' | 'hire_anniversary'>('fixed_date');
  const [effectiveOn, setEffectiveOn] = useState('');
  const [outcome, setOutcome] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const canWrite = permissions.includes('leave.manage');

  useEffect(() => {
    if (!canWrite) return;
    void api.listLeaveTypeSettings().then(({ leaveTypes: types }) => {
      setLeaveTypes(types);
      setLeaveTypeId((current) => (current === '' ? (types[0]?.id ?? '') : current));
    });
  }, [canWrite]);

  const columns: Column<LeaveGrantRuleRecord>[] = [
    {
      key: 'leaveType',
      header: labels.leaveType,
      value: (row) =>
        leaveTypes.find((type) => type.id === row.leaveTypeId)?.code ?? row.leaveTypeId,
    },
    { key: 'service', header: labels.grantServiceMonths, value: (row) => row.serviceMonths },
    { key: 'minutes', header: labels.grantMinutes, value: (row) => row.minutes },
  ];

  const load = useCallback(async () => (await api.listLeaveGrantRules({})).leaveGrantRules, []);

  const submit = useCallback(async () => {
    await api.createLeaveGrantRule({
      leaveTypeId,
      serviceMonths: Number(serviceMonths),
      minutes: Number(minutes),
    });
  }, [leaveTypeId, minutes, serviceMonths]);

  const runBulkGrant = useCallback(async () => {
    setOutcome(null);
    const result = await api.grantLeaveInBulk({ leaveTypeId, basis, effectiveOn });
    setOutcome(labels.bulkGrantOutcome(result.granted.length, result.skipped.length));
  }, [basis, effectiveOn, labels, leaveTypeId]);

  /**
   * 動かす前に、次の対象を見せる。
   *
   * 付与は台帳へ積むだけで、取り消しは打ち消しの記録として残る。
   * 間違えた設定で動かしてから気付くと、人数ぶんの打ち消しが要る。
   */
  const showPreview = useCallback(async () => {
    setPreview(null);
    const result = await api.previewLeaveGrants({ leaveTypeId });
    setPreview(
      result.effectiveOn === null
        ? labels.autoGrantNoTarget
        : labels.autoGrantNext(result.effectiveOn, result.grantedCount),
    );
  }, [labels, leaveTypeId]);

  const runAutoGrant = useCallback(async () => {
    setOutcome(null);
    const { runs } = await api.runLeaveGrants();
    const granted = runs.reduce((total, run) => total + run.grantedCount, 0);
    setOutcome(labels.autoGrantOutcome(runs.length, granted));
  }, [labels]);

  return (
    <SettingsSection
      title={labels.sectionLeaveGrantRules}
      hint={labels.leaveGrantRulesHint}
      csvName="leave-grant-rules"
      columns={columns}
      rowKey={(row) => row.id}
      load={load}
      canRead={canWrite}
      canWrite={canWrite}
      emptyMessage={labels.noLeaveGrantRules}
      submit={submit}
      form={
        <>
          <SelectField
            id="grant-rule-type"
            label={labels.leaveType}
            value={leaveTypeId}
            onChange={setLeaveTypeId}
            options={leaveTypes.map((type) => ({ value: type.id, label: type.code }))}
          />
          <TextField
            id="grant-rule-months"
            label={labels.grantServiceMonths}
            value={serviceMonths}
            onChange={setServiceMonths}
            required
          />
          <TextField
            id="grant-rule-minutes"
            label={labels.grantMinutes}
            value={minutes}
            onChange={setMinutes}
            required
          />
        </>
      }
      toolbar={
        canWrite ? (
          <>
            <SelectField
              id="bulk-grant-basis"
              label={labels.grantBasis}
              value={basis}
              onChange={setBasis}
              options={[
                { value: 'fixed_date', label: labels.grantBasisLabel.fixed_date },
                { value: 'hire_anniversary', label: labels.grantBasisLabel.hire_anniversary },
              ]}
            />
            <TextField
              id="bulk-grant-date"
              label={labels.grantEffectiveOn}
              type="date"
              value={effectiveOn}
              onChange={setEffectiveOn}
            />
            <button type="button" onClick={() => void runBulkGrant()} disabled={effectiveOn === ''}>
              {labels.runBulkGrant}
            </button>
            <button type="button" onClick={() => void showPreview()} disabled={leaveTypeId === ''}>
              {labels.previewAutoGrant}
            </button>
            <button type="button" onClick={() => void runAutoGrant()}>
              {labels.runAutoGrant}
            </button>
            {preview !== null && <p className="notice">{preview}</p>}
            {outcome !== null && <p className="notice">{outcome}</p>}
          </>
        ) : undefined
      }
    />
  );
}
