import { useEffect, useRef, useState } from 'react';
import type { Member, Room, RoomAction } from '../../shared/types';
import type { CocInvestigatorEdit } from '../../shared/coc-investigator';
import type { CocSessionEdit } from '../../shared/coc-runtime';
import { previewCocSpellHp } from '../../shared/coc-session-rules';
import { injuryLabels } from '../../shared/injury';
import { CocDerivedFields } from './CocInvestigator';
import { CocEquipment } from './CocEquipment';
import { CocWealth } from './CocWealth';
import { CocMagic } from './CocMagic';
import { CocSessionPanel } from './CocSessionPanel';
import { CocWeaponAttack } from './CocWeaponAttack';
import { CombatCommandStatus, useEncounterCommand } from './CombatActions';
import { Modal } from './ui';

type CharacterCocAction = Extract<RoomAction, { type: 'character-coc' }>;
type PendingHpPayment = {
  action: CharacterCocAction;
  preview: NonNullable<ReturnType<typeof previewCocSpellHp>>;
  resolve: (ok: boolean) => void;
};

export function CocRoomPreparation({
  room,
  member,
  isHost,
  run,
}: {
  room: Room;
  member: Member;
  isHost: boolean;
  run: (action: RoomAction) => Promise<boolean>;
}) {
  const [section, setSection] = useState('sanity');
  const encounterCommand = useEncounterCommand(room, run);
  const inFlight = useRef(false);
  const [pending, setPending] = useState<PendingHpPayment | null>(null);
  const pendingRef = useRef<PendingHpPayment | null>(null);
  const [confirmationError, setConfirmationError] = useState('');
  const card = member.character!;
  const active = room.phase === 'active';
  const busy = encounterCommand.busy || !!encounterCommand.retry || !!pending;

  useEffect(
    () => () => {
      pendingRef.current?.resolve(false);
      pendingRef.current = null;
    },
    [],
  );

  const execute = async (action: RoomAction) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    try {
      return await encounterCommand.execute(action);
    } finally {
      inFlight.current = false;
    }
  };

  const onEdit = async (edit: CocSessionEdit | CocInvestigatorEdit) => {
    if (pendingRef.current || inFlight.current) return false;
    const action: CharacterCocAction = {
      type: 'character-coc',
      memberId: member.id,
      characterId: card.id,
      expectedCharacterRevision: member.characterRevision,
      requestId: crypto.randomUUID(),
      edit,
    };
    if (edit.kind === 'spell-cast') {
      const preview = previewCocSpellHp(room, member.id, edit.spellId);
      if (preview?.mpShortfall && !edit.allowHpPayment)
        throw new Error(`MP 不足；若要用 ${preview.mpShortfall} HP 抵付，请勾选允许抵付。`);
      if (preview?.requiresConfirmation)
        return new Promise<boolean>((resolve) => {
          const next = { action, preview, resolve };
          pendingRef.current = next;
          setConfirmationError('');
          setPending(next);
        });
    }
    return execute(action);
  };

  const stale =
    !!pending &&
    (!active ||
      member.id !== pending.action.memberId ||
      card.id !== pending.action.characterId ||
      member.characterRevision !== pending.action.expectedCharacterRevision ||
      room.encounter.revision !== pending.preview.expectedRevision ||
      card.hp !== pending.preview.expectedHp);
  const finish = (ok: boolean) => {
    pendingRef.current?.resolve(ok);
    pendingRef.current = null;
    setPending(null);
    setConfirmationError('');
  };
  const confirmHp = async () => {
    if (!pending || !pendingRef.current || stale || inFlight.current) return;
    setConfirmationError('');
    try {
      const ok = await execute({
        ...pending.action,
        hpConfirmation: {
          expectedHp: pending.preview.expectedHp,
          expectedRevision: pending.preview.expectedRevision,
          outcome: 'rules',
        },
      });
      if (pendingRef.current === pending) finish(ok);
    } catch (e) {
      setConfirmationError((e as Error).message);
    }
  };

  return (
    <>
      <div className="tabs prep-main-tabs">
        {[
          ['sanity', '理智与成长'],
          ['derived', '衍生数值'],
          ['equipment', '武器与防具'],
          ['wealth', '财产与账目'],
          ['magic', '法术与神话'],
        ].map(([key, label]) => (
          <button
            type="button"
            className={section === key ? 'active' : ''}
            key={key}
            onClick={() => setSection(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {!active && (
        <p className="prep-notice">
          准备阶段请在角色卡编辑器填写资料；审核并开始后可在这里结算和调整。
        </p>
      )}
      {section === 'sanity' && (
        <CocSessionPanel
          card={card}
          onEdit={onEdit}
          disabled={busy}
          isHost={isHost}
          active={active}
          rules={room.cocRules}
        />
      )}
      {section === 'derived' && (
        <CocDerivedFields card={card} onEdit={onEdit} disabled={busy || !active || !isHost} />
      )}
      {section === 'equipment' && (
        <>
          <CocEquipment
            isHost={isHost}
            active={active}
            card={card}
            onEdit={onEdit}
            disabled={busy || !active}
          />
          {active && (
            <CocWeaponAttack
              room={room}
              member={member}
              isHost={isHost}
              execute={execute}
              disabled={busy}
            />
          )}
        </>
      )}
      {section === 'wealth' && (
        <CocWealth
          isHost={isHost}
          active={active}
          card={card}
          onEdit={onEdit}
          disabled={busy || !active}
        />
      )}
      {section === 'magic' && (
        <CocMagic
          card={card}
          onEdit={onEdit}
          disabled={busy || !active}
          active={active}
          isHost={isHost}
        />
      )}
      <CombatCommandStatus command={{ ...encounterCommand, execute }} />
      {pending && (
        <Modal
          title="确认施法 HP 消耗"
          subtitle={card.name}
          onClose={() => {
            if (!inFlight.current) finish(false);
          }}
          className="health-confirmation"
          footer={
            <>
              <button
                type="button"
                className="button secondary"
                disabled={encounterCommand.busy}
                onClick={() => finish(false)}
              >
                取消施法
              </button>
              <button
                type="button"
                className="button danger"
                disabled={encounterCommand.busy || stale}
                onClick={() => void confirmHp()}
              >
                确认消耗 HP
              </button>
            </>
          }
        >
          <div className="health-change-values">
            <span>{pending.preview.expectedHp}</span>
            <span>→</span>
            <strong>{pending.preview.value}</strong>
            <small>HP</small>
          </div>
          <p>
            本次消耗 {pending.preview.hpCost} HP，其中 {pending.preview.mpShortfall}{' '}
            点用于抵付不足的 MP。
          </p>
          <p className="health-confirmation-state">
            {room.encounter.autoDamage
              ? `确认后将按规则结算伤势：${injuryLabels(pending.preview.combatant).join('、') || '无新伤势'}。`
              : '确认后支付施法成本；伤势由主持人手动判定。'}
          </p>
          {stale && (
            <p className="inline-error" role="alert">
              角色或房间状态已变化，请取消后重新施法。
            </p>
          )}
          {confirmationError && (
            <p className="inline-error" role="alert">
              {confirmationError}
            </p>
          )}
        </Modal>
      )}
    </>
  );
}
