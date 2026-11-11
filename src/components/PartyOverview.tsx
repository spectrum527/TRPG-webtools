import { useState } from 'react';
import { Eye, Heart, Moon, Shield, Sparkles } from 'lucide-react';
import type { Room, RoomAction } from '../../shared/types';
import { effectiveCharacter } from '../../shared/adjustments';
import { getDndMagicProfile } from '../../shared/dnd-magic';
import { passivePerception } from '../../shared/rules';
import { injuryLabels } from '../../shared/injury';
import { CombatCommandStatus, useEncounterCommand } from './CombatActions';
import { Modal } from './ui';
export function PartyOverview({
  room,
  run,
  onClose,
  onPrepare,
}: {
  room: Room;
  run: (a: RoomAction) => Promise<boolean>;
  onClose: () => void;
  onPrepare: (id: string) => void;
}) {
  const members = room.members.filter((m) => m.role === 'player' && m.character),
    dnd = room.rule === 'dnd';
  const [rest, setRest] = useState<'short' | 'long'>('short'),
    [selected, setSelected] = useState<string[]>(
      members.filter((m) => m.character?.dndMagic).map((m) => m.id),
    ),
    [dice, setDice] = useState<Record<string, number>>({}),
    [confirmed, setConfirmed] = useState(false);
  const command = useEncounterCommand(room, run);
  return (
    <Modal title="队伍总览" subtitle="仅主持人可见" onClose={onClose} className="preparation-modal">
      <div className="prep-stack">
        <div className="party-overview-grid">
          {members.map((m) => {
            const c = effectiveCharacter(m.character!),
              p = getDndMagicProfile(c),
              state = c.dndMagic,
              combatant = room.encounter.participants.find((v) => v.memberId === m.id);
            const total = p?.slots.reduce((a, b) => a + b, 0) ?? 0,
              used = state?.slotsUsed.reduce((a, b) => a + b, 0) ?? 0;
            return (
              <article className="party-overview-card" key={m.id}>
                <div className="prep-section-heading">
                  <div>
                    <h3>{c.name}</h3>
                    <p>
                      {m.name} · {c.occupation}
                      {dnd ? ` ${c.level} 级` : ''}
                    </p>
                  </div>
                  <span className={`status-dot ${m.online ? 'online' : ''}`} />
                </div>
                <div className="party-overview-stats">
                  <span>
                    <Heart size={15} />
                    生命{' '}
                    <b>
                      {c.hp}/{c.maxHp}
                    </b>
                  </span>
                  {dnd ? (
                    <>
                      <span>
                        <Shield size={15} />
                        AC <b>{c.ac}</b>
                      </span>
                      <span>
                        <Eye size={15} />
                        被动察觉{' '}
                        <b>
                          {c.passivePerceptionEnabled ? passivePerception(m.character!) : '未启用'}
                        </b>
                      </span>
                    </>
                  ) : (
                    <>
                      <span>
                        理智{' '}
                        <b>
                          {c.san}/{c.maxSan}
                        </b>
                      </span>
                      <span>
                        魔法{' '}
                        <b>
                          {c.mp}/{c.maxMp}
                        </b>
                      </span>
                    </>
                  )}
                  {dnd && (
                    <span>
                      <Sparkles size={15} />
                      法术位{' '}
                      <b>
                        {state ? `${total - used}/${total}` : '未管理'}
                        {p?.pact && state
                          ? ` · 契约 ${p.pact.max - state.pactUsed}/${p.pact.max}`
                          : ''}
                      </b>
                    </span>
                  )}
                </div>
                {state?.concentration && (
                  <p className="party-state-note">专注 · {state.concentration}</p>
                )}
                {combatant?.conditions.length ? (
                  <p className="party-state-note">状态 · {combatant.conditions.join('、')}</p>
                ) : null}
                {combatant && injuryLabels(combatant).length > 0 && (
                  <p className="party-state-note">伤势 · {injuryLabels(combatant).join('、')}</p>
                )}
                {dnd && (
                  <button className="text-button" onClick={() => onPrepare(m.id)}>
                    打开法术与装备 →
                  </button>
                )}
              </article>
            );
          })}
          {!members.length && (
            <p className="prep-list-empty">玩家提交角色卡后，队伍状态会显示在这里。</p>
          )}
        </div>
        {dnd && (
          <section className="prep-rest-panel">
            <div className="prep-section-heading">
              <div>
                <h3>
                  <Moon size={18} /> 全队休息
                </h3>
                <p>只更新选中的角色；可分别指定短休消耗的生命骰。</p>
              </div>
            </div>
            <div className="segmented">
              <button
                className={rest === 'short' ? 'selected' : ''}
                onClick={() => {
                  setRest('short');
                  setConfirmed(false);
                }}
              >
                短休
              </button>
              <button
                className={rest === 'long' ? 'selected' : ''}
                onClick={() => {
                  setRest('long');
                  setConfirmed(false);
                }}
              >
                长休
              </button>
            </div>
            <div className="party-rest-members">
              {members.map((m) => (
                <div className="prep-inline-row" key={m.id}>
                  <label className="prep-checkbox">
                    <input
                      type="checkbox"
                      disabled={!m.character?.dndMagic || command.busy}
                      checked={selected.includes(m.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, m.id]
                            : selected.filter((id) => id !== m.id),
                        )
                      }
                    />
                    {m.character?.name}
                    {!m.character?.dndMagic && <small>未启用资源管理</small>}
                  </label>
                  {rest === 'short' && m.character?.dndMagic && (
                    <label className="party-rest-dice">
                      生命骰
                      <input
                        aria-label={`${m.character.name}休息生命骰`}
                        type="number"
                        min={0}
                        max={m.character.level - m.character.dndMagic.hitDiceUsed}
                        value={dice[m.id] ?? 0}
                        onChange={(e) => setDice({ ...dice, [m.id]: Number(e.target.value) })}
                      />
                    </label>
                  )}
                </div>
              ))}
            </div>
            <label className="prep-checkbox">
              <input
                type="checkbox"
                checked={confirmed}
                aria-label="确认全队休息"
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              已确认所选角色满足本次休息的条件与时长
            </label>
            <button
              className="button primary compact"
              disabled={
                !confirmed ||
                !selected.length ||
                command.busy ||
                !!command.retry ||
                room.phase !== 'active'
              }
              onClick={async () => {
                if (
                  await command.execute({
                    type: 'party-rest',
                    rest,
                    confirmed: true,
                    requestId: crypto.randomUUID(),
                    members: members
                      .filter((m) => selected.includes(m.id))
                      .map((m) => ({
                        memberId: m.id,
                        characterId: m.character!.id,
                        expectedCharacterRevision: m.characterRevision,
                        ...(rest === 'short' ? { hitDice: dice[m.id] ?? 0 } : {}),
                      })),
                  })
                ) {
                  setConfirmed(false);
                  setDice({});
                }
              }}
            >
              完成{rest === 'short' ? '短休' : '长休'}并恢复
            </button>
            <CombatCommandStatus command={command} />
          </section>
        )}
      </div>
    </Modal>
  );
}
