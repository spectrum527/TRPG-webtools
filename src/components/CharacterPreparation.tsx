import { useState } from 'react';
import { BookOpen, Shield } from 'lucide-react';
import type { Room, RoomAction } from '../../shared/types';
import { CharacterMagic } from './CharacterMagic';
import { CharacterEquipment } from './CharacterEquipment';
import { CombatCommandStatus, useEncounterCommand } from './CombatActions';
import { Modal, ruleEdition } from './ui';
export function CharacterPreparation({
  room,
  memberId,
  isHost,
  run,
  onClose,
}: {
  room: Room;
  memberId: string;
  isHost: boolean;
  run: (a: RoomAction) => Promise<boolean>;
  onClose: () => void;
}) {
  const candidates = room.members.filter(
    (m) => m.role === 'player' && m.character && (isHost || m.id === memberId),
  );
  const [chosen, setChosen] = useState(
    candidates.find((m) => m.id === memberId)?.id ?? candidates[0]?.id ?? '',
  );
  const [section, setSection] = useState<'magic' | 'equipment'>('magic');
  const member = candidates.find((m) => m.id === chosen) ?? candidates[0];
  const command = useEncounterCommand(room, run),
    card = member?.character;
  return (
    <Modal
      title="角色准备"
      subtitle={`${ruleEdition(room.rule, room.dndEdition)} · 法术、资源与装备`}
      onClose={onClose}
      className="preparation-modal"
    >
      <div className="prep-stack">
        {isHost && (
          <label className="field">
            选择角色
            <select
              aria-label="准备角色"
              value={member?.id ?? ''}
              onChange={(e) => setChosen(e.target.value)}
            >
              {candidates.map((m) => (
                <option value={m.id} key={m.id}>
                  {m.character?.name} · {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {card && member ? (
          <>
            <div className="tabs prep-main-tabs">
              <button
                className={section === 'magic' ? 'active' : ''}
                onClick={() => setSection('magic')}
              >
                <BookOpen size={16} />
                法术与资源
              </button>
              <button
                className={section === 'equipment' ? 'active' : ''}
                onClick={() => setSection('equipment')}
              >
                <Shield size={16} />
                装备与负重
              </button>
            </div>
            {room.phase !== 'active' && (
              <p className="prep-notice">
                当前处于准备阶段。请在角色卡编辑器配置法术与装备；审核并开始后，即可在这里施法、消耗和休息。
              </p>
            )}
            {section === 'magic' ? (
              <CharacterMagic
                key={card.id}
                card={card}
                isHost={isHost}
                busy={command.busy || !!command.retry}
                active={room.phase === 'active'}
                onEdit={(edit) =>
                  command.execute({
                    type: 'character-magic',
                    memberId: member.id,
                    characterId: card.id,
                    expectedCharacterRevision: member.characterRevision,
                    requestId: crypto.randomUUID(),
                    edit,
                  })
                }
              />
            ) : (
              <CharacterEquipment
                key={card.id}
                card={card}
                allowAdd={isHost}
                busy={command.busy || !!command.retry}
                active={room.phase === 'active'}
                onEdit={(edit) =>
                  command.execute({
                    type: 'character-equipment',
                    memberId: member.id,
                    characterId: card.id,
                    expectedCharacterRevision: member.characterRevision,
                    requestId: crypto.randomUUID(),
                    edit,
                  })
                }
              />
            )}
            <CombatCommandStatus command={command} />
          </>
        ) : (
          <div className="prep-empty">
            <p>还没有可以管理的角色。玩家完成制卡后，会出现在这里。</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
