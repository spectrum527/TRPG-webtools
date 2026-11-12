import { useEffect, useId, useState } from 'react';
import { Check, LockKeyhole, LockKeyholeOpen, X } from 'lucide-react';
import {
  automaticControl,
  controlledValue,
  type ValueControl,
  type ValueControlEdit,
} from '../../shared/value-control';

export function AutoValueField<T extends number | string>({
  label,
  control,
  automatic,
  onEdit,
  source,
  disabled = false,
  min,
  max,
  step = 1,
}: {
  label: string;
  control?: ValueControl<T>;
  automatic: T;
  onEdit: (edit: ValueControlEdit<T>) => void | Promise<boolean | void>;
  source?: string;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
}) {
  const id = useId();
  const state = control ?? automaticControl<T>();
  const value = controlledValue(state, automatic);
  const [draft, setDraft] = useState(String(value));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setDraft(String(value));
    setError('');
  }, [value, state.mode, state.locked]);
  const dirty = draft !== String(value);
  const send = async (edit: ValueControlEdit<T>) => {
    if (busy || disabled) return;
    setBusy(true);
    setError('');
    try {
      await onEdit(edit);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = () => {
    const numeric = typeof automatic === 'number';
    const next = numeric ? Number(draft) : draft.trim();
    if (
      !draft.trim() ||
      (numeric &&
        (!Number.isFinite(next) ||
          (min !== undefined && Number(next) < min) ||
          (max !== undefined && Number(next) > max) ||
          (step === 1 && !Number.isInteger(next))))
    ) {
      setError('请填写范围内的有效数值');
      return;
    }
    void send({ kind: 'value', value: next as T });
  };
  return (
    <div className={`auto-value-field${state.locked ? ' is-locked' : ''}`}>
      <div className="auto-value-label">
        <label htmlFor={id}>{label}</label>
        <button
          type="button"
          className="value-lock"
          aria-label={`${state.locked ? '解锁' : '锁定'}${label}`}
          aria-pressed={state.locked}
          title={dirty ? '先保存或取消修改' : `${state.locked ? '解锁' : '锁定'}${label}`}
          disabled={disabled || busy || dirty}
          onClick={() => void send({ kind: 'lock', locked: !state.locked })}
        >
          {state.locked ? <LockKeyhole size={16} /> : <LockKeyholeOpen size={16} />}
        </button>
      </div>
      <div className="auto-value-input">
        <input
          id={id}
          aria-label={label}
          type={typeof automatic === 'number' ? 'number' : 'text'}
          value={draft}
          min={min}
          max={max}
          step={step}
          maxLength={typeof automatic === 'string' ? 120 : undefined}
          disabled={disabled || busy || state.locked || state.mode === 'auto'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && dirty) {
              e.preventDefault();
              save();
            }
            if (e.key === 'Escape') setDraft(String(value));
          }}
        />
        <select
          aria-label={`${label}计算方式`}
          value={state.mode}
          disabled={disabled || busy || state.locked || dirty}
          onChange={(e) => void send({ kind: 'mode', mode: e.target.value as 'auto' | 'manual' })}
        >
          <option value="auto">自动</option>
          <option value="manual">手动</option>
        </select>
      </div>
      {source && <small className="auto-value-source">{source}</small>}
      {dirty && (
        <div className="auto-value-actions">
          <button type="button" className="text-button" disabled={busy || disabled} onClick={save}>
            <Check size={14} />
            保存
          </button>
          <button
            type="button"
            className="icon-button small"
            aria-label={`取消${label}修改`}
            disabled={busy}
            onClick={() => {
              setDraft(String(value));
              setError('');
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
