import { useRef, useState } from 'react';
import { Check, LockKeyhole, LockKeyholeOpen, RotateCcw } from 'lucide-react';
import type { Character } from '../../shared/types';
import { COC_ATTRIBUTES } from '../../shared/catalog';
import {
  COC_AGE_ATTRIBUTES,
  cocAgeBase,
  cocAgeRule,
  cocAgeDefaultDeductions,
  cocDerivedValues,
  type CocAgeDeductions,
  type CocAgeDeltas,
  type CocInvestigatorEdit,
} from '../../shared/coc-investigator';
import { automaticControl } from '../../shared/value-control';
import { AutoValueField } from './AutoValueField';

export type CocInvestigatorProps = {
  card: Character;
  onEdit: (edit: CocInvestigatorEdit) => void | Promise<boolean | void>;
  disabled?: boolean;
  active?: boolean;
  isHost?: boolean;
};

export function useCocInvestigatorEdit(onEdit: CocInvestigatorProps['onEdit'], disabled?: boolean) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async (edit: CocInvestigatorEdit) => {
    if (disabled || pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      return (await onEdit(edit)) !== false;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return { send, error, blocked: disabled || busy };
}

export function CocSectionHeading({ title, eyebrow }: { title: string; eyebrow: string }) {
  return (
    <div className="prep-section-heading editor-tab-heading">
      <div>
        <span className="mini-label">{eyebrow} · COC 7</span>
        <h3>{title}</h3>
      </div>
    </div>
  );
}

export function CocDerivedFields({ card, onEdit, disabled }: CocInvestigatorProps) {
  const { automatic } = cocDerivedValues(card);
  const fields = [
    { key: 'build', label: '体格', source: '由力量与体型合计计算', min: -10, max: 20 },
    { key: 'mov', label: '移动力', source: '计入年龄与已穿戴防具', min: 0, max: 99 },
    { key: 'maxHp', label: 'HP 上限', source: '⌊（体质＋体型）÷10⌋', min: 1, max: 9999 },
    { key: 'maxMp', label: 'MP 上限', source: '⌊意志÷5⌋', min: 0, max: 9999 },
    { key: 'maxSan', label: 'SAN 上限', source: '99－长期克苏鲁神话技能', min: 0, max: 99 },
  ] as const;
  return (
    <section className="coc-subsection">
      <h4>衍生数值</h4>
      <div className="auto-value-grid">
        <AutoValueField
          label="伤害加值 DB"
          automatic={automatic.db}
          control={card.cocInvestigator?.derived?.db}
          disabled={disabled}
          source="由力量与体型合计计算"
          onEdit={(change) => onEdit({ kind: 'derived-control', field: 'db', change })}
        />
        {fields.map(({ key, label, source, min, max }) => (
          <AutoValueField
            key={key}
            label={label}
            automatic={automatic[key]}
            control={card.cocInvestigator?.derived?.[key]}
            disabled={disabled}
            source={source}
            min={min}
            max={max}
            onEdit={(change) => onEdit({ kind: 'derived-control', field: key, change })}
          />
        ))}
      </div>
      <p className="field-help">
        解锁后可切换为手动数值；重新锁定保留修正。上限提高不会补满当前资源，临时属性效果不改变资源上限。
      </p>
    </section>
  );
}

export function CocAgeCorrection({ card, onEdit, disabled }: CocInvestigatorProps) {
  const state = card.cocInvestigator?.age;
  const control = state?.control ?? automaticControl<CocAgeDeltas>();
  const rule = cocAgeRule(card.age);
  const { send, error, blocked } = useCocInvestigatorEdit(onEdit, disabled);
  const [deductionDraft, setDeductionDraft] = useState<{ key: string; value: CocAgeDeductions }>();
  const [manualDraft, setManualDraft] = useState<{ key: string; value: CocAgeDeltas }>();
  const [reason, setReason] = useState(
    state?.applied?.mode === 'manual' ? (state.applied.reason ?? '') : '',
  );
  let suggested: CocAgeDeductions = {};
  let base: ReturnType<typeof cocAgeBase> | undefined;
  let baseError = '';
  try {
    base = cocAgeBase(card);
    if (control.mode === 'auto' && rule?.deductionPoints) suggested = cocAgeDefaultDeductions(card);
  } catch (e) {
    baseError = (e as Error).message;
  }
  const deductionKey = `${card.id}|${card.age}|${JSON.stringify(base)}|${JSON.stringify(suggested)}`;
  const deductions = deductionDraft?.key === deductionKey ? deductionDraft.value : suggested;
  const allocated = (rule?.deductionKeys ?? []).reduce(
    (total, key) => total + (deductions[key] ?? 0),
    0,
  );
  const deductionsValid =
    !rule?.deductionPoints ||
    (allocated === rule.deductionPoints &&
      rule.deductionKeys.every((key) => {
        const amount = deductions[key] ?? 0;
        return Number.isInteger(amount) && amount >= 0 && !!base && amount < base[key];
      }));
  const savedManual = control.manual ?? {};
  const manualKey = `${card.id}|${card.age}|${control.mode}|${JSON.stringify(savedManual)}`;
  const manual = manualDraft?.key === manualKey ? manualDraft.value : savedManual;
  const manualDirty = COC_AGE_ATTRIBUTES.some(
    (key) => (savedManual[key] ?? 0) !== (manual[key] ?? 0),
  );
  const manualValid = COC_AGE_ATTRIBUTES.every((key) => {
    const change = manual[key] ?? 0;
    const result = (base?.[key] ?? 0) + change;
    return Number.isInteger(change) && result >= 1 && result <= 100;
  });
  const applied = state?.applied;
  const attributeLabel = (key: string) =>
    COC_ATTRIBUTES.find((attribute) => attribute.key === key)?.label ?? key;
  return (
    <section className="coc-subsection">
      <div className="coc-record-title">
        <h4>年龄修正</h4>
        <button
          type="button"
          className="value-lock"
          aria-label={`${control.locked ? '解锁' : '锁定'}年龄修正`}
          aria-pressed={control.locked}
          disabled={blocked || manualDirty}
          onClick={() =>
            void send({ kind: 'age-control', change: { kind: 'lock', locked: !control.locked } })
          }
        >
          {control.locked ? <LockKeyhole size={16} /> : <LockKeyholeOpen size={16} />}
        </button>
      </div>
      <div className="coc-inline-fields">
        <label className="field">
          计算方式
          <select
            aria-label="年龄修正计算方式"
            value={control.mode}
            disabled={blocked || control.locked || manualDirty}
            onChange={(e) =>
              void send({
                kind: 'age-control',
                change: { kind: 'mode', mode: e.target.value as 'auto' | 'manual' },
              })
            }
          >
            <option value="auto">自动</option>
            <option value="manual">手动</option>
          </select>
        </label>
        <p className="field-help">
          {control.mode === 'manual'
            ? '先保存手动数值，再填写原因并应用。'
            : rule
              ? [
                  rule.educationChecks ? `教育成长 ${rule.educationChecks} 次` : '',
                  rule.appearanceLoss ? `外貌减 ${rule.appearanceLoss}` : '',
                  rule.educationLoss ? `教育减 ${rule.educationLoss}` : '',
                  rule.luckRolls ? '幸运掷两次，取高者' : '',
                  rule.movementPenalty ? `移动力减 ${rule.movementPenalty}` : '',
                ]
                  .filter(Boolean)
                  .join('；') + '。'
              : '15–89 岁支持自动年龄修正；其他年龄可填写手动修正。'}
        </p>
      </div>
      {control.mode === 'auto' && rule && rule.deductionPoints > 0 && (
        <>
          <div className="coc-inline-fields">
            {rule.deductionKeys.map((key) => (
              <label className="field" key={key}>
                {attributeLabel(key)}扣减
                <input
                  type="number"
                  min={0}
                  max={Math.max(0, (base?.[key] ?? 1) - 1)}
                  step={1}
                  value={deductions[key] ?? 0}
                  disabled={blocked || !base}
                  onChange={(e) =>
                    setDeductionDraft({
                      key: deductionKey,
                      value: { ...deductions, [key]: Number(e.target.value) },
                    })
                  }
                />
              </label>
            ))}
          </div>
          <p className="field-help">
            已分配 {allocated} / {rule.deductionPoints} 点扣减。
          </p>
        </>
      )}
      {control.mode === 'manual' && (
        <>
          <div className="coc-inline-fields">
            {COC_AGE_ATTRIBUTES.map((key) => (
              <label className="field" key={key}>
                {attributeLabel(key)}修正
                <input
                  type="number"
                  min={base ? 1 - base[key] : -99}
                  max={base ? 100 - base[key] : 99}
                  step={1}
                  value={manual[key] ?? 0}
                  disabled={blocked || control.locked || !base}
                  onChange={(e) =>
                    setManualDraft({
                      key: manualKey,
                      value: { ...manual, [key]: Number(e.target.value) },
                    })
                  }
                />
              </label>
            ))}
          </div>
          {manualDirty && (
            <div className="coc-actions">
              <button
                type="button"
                className="text-button"
                disabled={blocked || control.locked || !manualValid}
                onClick={() =>
                  void send({ kind: 'age-control', change: { kind: 'value', value: manual } })
                }
              >
                <Check size={14} />
                保存手动修正
              </button>
              <button
                type="button"
                className="text-button"
                disabled={blocked}
                onClick={() => setManualDraft(undefined)}
              >
                取消修改
              </button>
            </div>
          )}
          <label className="field">
            修正原因
            <input
              maxLength={200}
              value={reason}
              disabled={blocked}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </>
      )}
      {applied && (
        <div className="coc-status-note">
          <p>
            已应用 {applied.age} 岁修正：
            {Object.entries(applied.changes)
              .filter(([, value]) => value)
              .map(([key, value]) => `${attributeLabel(key)} ${value > 0 ? '+' : ''}${value}`)
              .join('、') || '属性无变化'}
            。{applied.age !== card.age && `当前年龄为 ${card.age} 岁，请核对后重新应用。`}
          </p>
          <details>
            <summary>查看基础属性与骰点</summary>
            <p>
              基础：
              {COC_AGE_ATTRIBUTES.map((key) => `${attributeLabel(key)} ${applied.base[key]}`).join(
                ' · ',
              )}
            </p>
            {applied.eduChecks.map((check, index) => (
              <p key={index}>
                教育成长 {index + 1}：EDU {check.before}，D100 = {check.percentile}
                {check.d10 === undefined
                  ? '，未成长'
                  : `，D10 = ${check.d10}，实际增加 ${check.gain}`}
              </p>
            ))}
            {applied.luckRolls.map((roll, index) => (
              <p key={index}>
                幸运第 {index + 1} 次：（{roll.join(' + ')}）× 5 ={' '}
                {roll.reduce((sum, die) => sum + die, 0) * 5}
              </p>
            ))}
            {applied.reason && <p>原因：{applied.reason}</p>}
          </details>
        </div>
      )}
      <div className="coc-actions">
        <button
          type="button"
          className="button secondary"
          disabled={
            blocked ||
            !base ||
            !!baseError ||
            (control.mode === 'manual'
              ? manualDirty || !manualValid || !reason.trim()
              : !rule || !deductionsValid)
          }
          onClick={() =>
            void send({
              kind: 'age-apply',
              ...(control.mode === 'auto' ? { deductions } : { reason }),
            })
          }
        >
          应用年龄修正
        </button>
        {applied && (
          <button
            type="button"
            className="text-button"
            disabled={blocked || !base || (applied.mode === 'manual' && control.locked)}
            onClick={() => void send({ kind: 'age-clear' })}
          >
            <RotateCcw size={14} />
            撤销年龄修正
          </button>
        )}
      </div>
      <p className="field-help">应用时结算属性；已有记录的骰点会沿用。移动力随当前年龄实时计算。</p>
      {baseError && (
        <p className="inline-error" role="alert">
          {baseError}
        </p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
