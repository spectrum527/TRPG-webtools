import { useState } from 'react';
import type { Room, RoomAction, RoomEvent } from '../../shared/types';
import {
  cocCheckStatus,
  cocCheckEligibility,
  cocLuckOptions,
  type CocCheckFollowupEdit,
} from '../../shared/coc-runtime';
import { cocCurrentLuck, cocRoomRules } from '../../shared/coc-session';
import { effectiveCharacter } from '../../shared/adjustments';
import { CombatCommandStatus, useEncounterCommand } from './CombatActions';

export function CocCheckFollowup({
  room,
  event,
  memberId,
  run,
}: {
  room: Room;
  event: RoomEvent;
  memberId: string;
  run: (action: RoomAction) => Promise<boolean>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState('');
  const [consequence, setConsequence] = useState('');
  const command = useEncounterCommand(room, run);
  const status = cocCheckStatus(room.log, event.id);
  const member = room.members.find((m) => m.id === event.memberId);
  if (!status || !member?.character || member.character.id !== status.record.characterId)
    return null;
  const isHost = memberId === room.hostId,
    owner = memberId === member.id;
  const eligibility = cocCheckEligibility(status, cocRoomRules(room.cocRules));
  const options = cocLuckOptions(
    status.original.check!,
    status.record.difficulty,
    cocCurrentLuck(effectiveCharacter(member.character)),
  );
  const send = (edit: CocCheckFollowupEdit) =>
    command.execute({
      type: 'coc-check-followup',
      eventId: event.id,
      expectedVersion: status.version,
      expectedCharacterRevision: member.characterRevision,
      requestId: crypto.randomUUID(),
      edit,
    });
  const disabled = command.busy || !!command.retry || room.phase !== 'active';
  if (!owner && !isHost) return null;
  return (
    <div className="coc-check-followup">
      {status.luck && (
        <p className="field-help">
          幸运 −{status.luck.points} → {status.luck.result.total} · {status.luck.result.outcome}
        </p>
      )}
      {status.pushed && (
        <p className="field-help">
          孤注一掷 → {status.pushed.result.total} · {status.pushed.result.outcome}
          {!status.pushed.result.success
            ? `；后果：${status.decision?.consequence ?? status.request?.consequence}`
            : ''}
        </p>
      )}
      <div className="coc-actions">
        {eligibility.canSpendLuck &&
          owner &&
          options.map((option) => (
            <button
              type="button"
              className="text-button"
              key={option.points}
              disabled={disabled}
              onClick={() => void send({ kind: 'spend-luck', points: option.points })}
            >
              消耗 {option.points} 幸运 · {option.outcome}
            </button>
          ))}
        {owner && eligibility.canRequestPush && (
          <button
            type="button"
            className="text-button"
            disabled={disabled}
            onClick={() => setExpanded(!expanded)}
          >
            申请孤注一掷
          </button>
        )}
        {owner && eligibility.canPush && (
          <button
            type="button"
            className="button secondary compact"
            disabled={disabled}
            onClick={() => void send({ kind: 'push' })}
          >
            确认后果并重掷
          </button>
        )}
      </div>
      {owner && expanded && eligibility.canRequestPush && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send({ kind: 'request-push', reason, consequence });
          }}
        >
          <label className="field">
            再次尝试的方法
            <input
              value={reason}
              maxLength={300}
              required
              disabled={disabled}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label className="field">
            可能的失败后果
            <input
              value={consequence}
              maxLength={300}
              required
              disabled={disabled}
              onChange={(e) => setConsequence(e.target.value)}
            />
          </label>
          <button type="submit" className="button secondary compact" disabled={disabled}>
            提交主持人
          </button>
        </form>
      )}
      {status.request && !status.pushed && (
        <div className="coc-status-note">
          <p>
            {status.request.reason} · 后果：
            {status.decision?.consequence ?? status.request.consequence}
          </p>
          {status.decision ? (
            <span>{status.decision.allowed ? '主持人已允许' : '主持人未允许'}</span>
          ) : isHost ? (
            <>
              <label className="field">
                调整失败后果（可选）
                <input
                  value={consequence}
                  maxLength={300}
                  disabled={disabled}
                  onChange={(e) => setConsequence(e.target.value)}
                />
              </label>
              <div className="coc-actions">
                <button
                  type="button"
                  className="text-button"
                  disabled={disabled}
                  onClick={() =>
                    void send({
                      kind: 'decide-push',
                      allowed: true,
                      consequence: consequence.trim() || undefined,
                    })
                  }
                >
                  允许再次尝试
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={disabled}
                  onClick={() => void send({ kind: 'decide-push', allowed: false })}
                >
                  不允许
                </button>
              </div>
            </>
          ) : (
            <span>等待主持人确认</span>
          )}
        </div>
      )}
      <CombatCommandStatus command={command} />
    </div>
  );
}
