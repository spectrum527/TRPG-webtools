import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Heart, ShieldAlert } from 'lucide-react';
import type { Room, RoomAction } from '../../shared/types';
import { injuryLabels, manualHpChange, previewManualHp } from '../../shared/injury';
import { Modal, Spinner } from './ui';

type HpAction = Extract<
  RoomAction,
  { type: 'resource' | 'encounter-update' | 'encounter-companion-hp' }
>;
type Pending = {
  action: HpAction;
  change: NonNullable<ReturnType<typeof manualHpChange>>;
  projected: ReturnType<typeof previewManualHp>;
  revision: number;
  resolve: (ok: boolean) => void;
};

export function useHealthActions(
  room: Room,
  memberId: string,
  connected: boolean,
  send: (action: RoomAction) => Promise<boolean>,
  notify: (message: string, type?: 'success' | 'error') => void,
) {
  const [pending, setPending] = useState<Pending | null>(null);
  const ref = useRef<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<'rules' | 'dead'>('rules');
  useEffect(
    () => () => {
      ref.current?.resolve(false);
      ref.current = null;
    },
    [],
  );
  const finish = (ok: boolean) => {
    ref.current?.resolve(ok);
    ref.current = null;
    setPending(null);
  };
  const run = async (action: RoomAction): Promise<boolean> => {
    if (ref.current) {
      notify('请先确认或取消当前 HP 修改。', 'error');
      return false;
    }
    try {
      const change = manualHpChange(room, action);
      if (change && !('hpConfirmation' in action && action.hpConfirmation)) {
        const projected = previewManualHp(room, change);
        if (projected.requiresConfirmation)
          return new Promise<boolean>((resolve) => {
            const next = {
              action: action as HpAction,
              change,
              projected,
              revision: room.encounter.revision,
              resolve,
            };
            ref.current = next;
            setOutcome('rules');
            setPending(next);
          });
      }
      return await send(action);
    } catch (error) {
      notify((error as Error).message, 'error');
      return false;
    }
  };
  const current =
    pending && room.encounter.participants.find((c) => c.id === pending.change.target.id);
  const stale =
    !connected ||
    (!!pending &&
      (!current ||
        room.encounter.revision !== pending.revision ||
        current.hp !== pending.change.target.hp));
  const state =
    pending && (outcome === 'dead' ? '死亡' : injuryLabels(pending.projected.combatant).join('、'));
  const fatal =
    pending &&
    (room.encounter.autoDamage
      ? outcome === 'dead' || pending.projected.combatant.dead
      : pending.change.target.dead);
  const dialog = pending && (
    <Modal
      title="确认 HP 与伤势"
      subtitle={
        room.hostId === memberId ? pending.change.target.name : pending.change.target.publicName
      }
      className={`health-confirmation${fatal ? ' is-fatal' : ''}`}
      onClose={() => {
        if (!busy) finish(false);
      }}
      footer={
        <>
          <button className="button secondary" disabled={busy} onClick={() => finish(false)}>
            取消修改
          </button>
          <button
            className={`button ${fatal ? 'danger' : 'primary'}`}
            disabled={busy || stale}
            onClick={async () => {
              setBusy(true);
              try {
                const ok = await send({
                  ...pending.action,
                  hpConfirmation: {
                    expectedHp: pending.change.target.hp,
                    expectedRevision: pending.revision,
                    outcome,
                  },
                });
                finish(ok);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Spinner /> : <ShieldAlert size={16} />}
            {room.encounter.autoDamage ? '确认 HP 与伤势' : '确认修改 HP'}
          </button>
        </>
      }
    >
      <div className="health-change-values">
        <Heart size={23} />
        <span>{pending.change.target.hp ?? '未填写'}</span>
        <ArrowRight size={20} />
        <strong>{pending.change.value}</strong>
        <small>HP</small>
      </div>
      <p className="health-confirmation-state">
        {room.encounter.autoDamage ? (
          <>
            确认后将进入：<b>{state || '需主持人判定'}</b>。
          </>
        ) : (
          '自动扣血已关闭。本次保存 HP 及手动填写的标记，不自动判定伤势。'
        )}
      </p>
      {room.encounter.autoDamage &&
        room.hostId === memberId &&
        pending.change.value === 0 &&
        !pending.projected.combatant.dead && (
          <label className="combatant-checkbox">
            <input
              type="checkbox"
              checked={outcome === 'dead'}
              onChange={(e) => setOutcome(e.target.checked ? 'dead' : 'rules')}
            />
            主持人裁定为死亡
          </label>
        )}
      {room.rule === 'dnd' && room.encounter.autoDamage && (
        <p className="subtle-note">
          直接设置 HP 不包含溢出伤害；需要巨量伤害判定时，请使用伤害结算。
        </p>
      )}
      {stale && (
        <p className="inline-error" role="alert">
          角色或战斗状态已变化。请取消后重新核对，避免覆盖新结果。
        </p>
      )}
    </Modal>
  );
  return { run, dialog };
}
