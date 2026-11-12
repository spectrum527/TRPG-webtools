import { useEffect, useState } from 'react';
import { LockKeyhole, LockKeyholeOpen } from 'lucide-react';
import {
  cocCurrentLuck,
  cocSessionValueLocked,
  cocSessionValueMaximum,
  type CocSessionValueField,
} from '../../shared/coc-session';
import type { CocSessionPanelProps } from './CocMagic';

function Counter({
  card,
  onEdit,
  disabled,
  field,
  label,
  value,
}: CocSessionPanelProps & { field: CocSessionValueField; label: string; value: number }) {
  const locked = cocSessionValueLocked(card.cocSession, field);
  const [draft, setDraft] = useState(String(value));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setDraft(String(value));
    setError('');
  }, [value, locked]);
  const send: typeof onEdit = async (edit) => {
    if (busy || disabled) return false;
    setBusy(true);
    setError('');
    try {
      return await onEdit(edit);
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="auto-value-field"
      onSubmit={(e) => {
        e.preventDefault();
        void send({
          kind: 'session-value-correct',
          field,
          value: Number(draft),
          reason,
          confirmed: true,
        });
      }}
    >
      <div className="auto-value-label">
        <span>{label}</span>
        <button
          type="button"
          className="value-lock"
          aria-label={`${locked ? '解锁' : '锁定'}${label}记录`}
          aria-pressed={locked}
          disabled={disabled || busy}
          onClick={() => void send({ kind: 'session-value-lock', field, locked: !locked })}
        >
          {locked ? <LockKeyhole size={16} /> : <LockKeyholeOpen size={16} />}
        </button>
      </div>
      <input
        type="number"
        aria-label={`${label}手动修正`}
        min={0}
        max={cocSessionValueMaximum(field)}
        step={1}
        value={draft}
        disabled={disabled || busy || locked}
        required
        onChange={(e) => setDraft(e.target.value)}
      />
      {!locked && (
        <>
          <label className="field">
            修正原因
            <input
              value={reason}
              maxLength={300}
              required
              disabled={disabled || busy}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button
            type="submit"
            className="text-button"
            disabled={disabled || busy || Number(draft) === value}
          >
            保存修正
          </button>
        </>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function CocSessionCounters(props: CocSessionPanelProps) {
  const { card } = props;
  return (
    <details className="coc-subsection">
      <summary>修正幸运与当日记录</summary>
      <div className="auto-value-grid">
        <Counter {...props} field="luck" label="当前幸运" value={cocCurrentLuck(card)} />
        <Counter
          {...props}
          field="dayStartSan"
          label="日初 SAN"
          value={card.cocSession?.sanity.dayStartSan ?? card.san}
          disabled={props.disabled || !!card.cocSession?.sanity.pending}
        />
        <Counter
          {...props}
          field="lostToday"
          label="当日 SAN 损失"
          value={card.cocSession?.sanity.lostToday ?? 0}
          disabled={props.disabled || !!card.cocSession?.sanity.pending}
        />
      </div>
      <p className="field-help">
        锁定防止手动误改，后续消耗与累计仍自动记录。修正记录不发起新的理智检定，精神状态请单独确认。
      </p>
    </details>
  );
}
