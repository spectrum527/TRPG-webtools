import { useState } from 'react';
import { HeartPulse } from 'lucide-react';
import type { Combatant } from '../../shared/encounter';
import type { Room, RoomAction } from '../../shared/types';
import { useEncounterCommand, CombatCommandStatus } from './CombatActions';
import { injuryLabels } from '../../shared/injury';

export function InjuryCare({
  room,
  combatant: c,
  run,
  disabled,
}: {
  room: Room;
  combatant: Combatant;
  run: (action: RoomAction) => Promise<boolean>;
  disabled: boolean;
}) {
  const command = useEncounterCommand(room, run);
  const [kind, setKind] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const choices = c.dead
    ? [['revive', '确认复活']]
    : c.rule === 'dnd'
      ? c.hp === 0 && !c.stable
        ? [['stabilize', '确认医药检定成功并稳定伤势']]
        : []
      : [
          ...(!c.injuryChecks?.firstAidUsed ? [['first-aid', '确认急救成功']] : []),
          ...(!c.dying && !c.injuryChecks?.medicineUsed ? [['medicine', '确认医学治疗成功']] : []),
        ];
  const selected = choices.find(([value]) => value === kind) ?? choices[0];
  const visible =
    c.dead ||
    c.dying ||
    c.majorWound ||
    c.unconscious ||
    (c.hp !== null && c.maxHp !== null && c.hp < c.maxHp);
  if (!visible) return null;
  return (
    <details className="injury-care">
      <summary>
        <HeartPulse size={17} />
        治疗与恢复<span>{injuryLabels(c).join(' · ') || 'HP 未满'}</span>
      </summary>
      {selected ? (
        <>
          <label className="field">
            处理方式
            <select
              aria-label="伤势处理方式"
              value={selected[0]}
              onChange={(e) => {
                setKind(e.target.value);
                setConfirmed(false);
              }}
            >
              {choices.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p className="subtle-note">
            {selected[0] === 'revive'
              ? '仅用于已满足复活条件或主持人明确裁定的情况，恢复为 1 HP。普通治疗不能复活。'
              : c.rule === 'coc'
                ? '先完成技能检定，并核对时间、器材与治疗次数。濒死者须先急救稳定；医学成功后恢复 1D3 HP。自然恢复仍由主持人按游戏时间处理。'
                : '完成 DC 10 感知（医药）检定或确认稳定效果后应用。稳定后仍为 0 HP 并保持昏迷。'}
          </p>
          <label className="combatant-checkbox">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={disabled || command.busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {selected[0] === 'revive' ? '已确认复活条件或主持人裁定' : '已确认检定成功与治疗条件'}
          </label>
          <button
            className="button secondary compact"
            disabled={disabled || command.busy || !confirmed}
            onClick={async () => {
              setConfirmed(false);
              await command.execute({
                type: 'encounter-life-care',
                combatantId: c.id,
                kind: selected[0] as 'stabilize' | 'first-aid' | 'medicine' | 'revive',
                conditionsConfirmed: true,
                expectedRevision: room.encounter.revision,
                requestId: crypto.randomUUID(),
              });
            }}
          >
            {selected[1]}
          </button>
        </>
      ) : (
        <p className="subtle-note">
          当前没有可重复应用的治疗。其他治疗与自然恢复由主持人核对后调整 HP。
        </p>
      )}
      <CombatCommandStatus command={command} />
    </details>
  );
}
