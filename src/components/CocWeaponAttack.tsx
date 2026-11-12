import { useState } from 'react';
import { Dices } from 'lucide-react';
import type { Edge, Member, Room, RoomAction, Visibility } from '../../shared/types';
import { cocWeaponValues } from '../../shared/coc-equipment';

export function CocWeaponAttack({
  room,
  member,
  isHost,
  execute,
  disabled,
}: {
  room: Room;
  member: Member;
  isHost: boolean;
  execute: (action: RoomAction) => Promise<boolean>;
  disabled?: boolean;
}) {
  const card = member.character;
  const weapons =
    card?.cocInvestigator?.equipment?.weapons.filter(
      (weapon) => weapon.profile.category !== 'melee',
    ) ?? [];
  const [id, setId] = useState('');
  const [target, setTarget] = useState('');
  const [distance, setDistance] = useState('');
  const [difficulty, setDifficulty] = useState<'regular' | 'hard' | 'extreme'>('regular');
  const [edge, setEdge] = useState<Edge>('normal');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [armor, setArmor] = useState('');
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  if (!card || !weapons.length) return null;
  const weapon = weapons.find((item) => item.id === id);
  const attacker = room.encounter.participants.find((item) => item.memberId === member.id);
  const targets = room.encounter.participants.filter(
    (item) => item.id !== attacker?.id && (isHost || item.revealed),
  );
  const defender = targets.find((item) => item.id === target);
  const canDamage = !!defender && !!room.encounter.autoDamage;
  const distanceYards = distance.trim() ? Number(distance) : undefined;
  const armorOverride = isHost && canDamage && armor.trim() ? Number(armor) : undefined;
  const rollVisibility = isHost ? visibility : 'public';
  const confirmKey = JSON.stringify([
    room.encounter.revision,
    member.characterRevision,
    member.id,
    id,
    target,
    distanceYards,
    difficulty,
    edge,
    rollVisibility,
    armorOverride,
  ]);
  const confirmed = canDamage && confirmKey === confirmedFor;
  const change = (setter: (value: string) => void, value: string) => {
    setter(value);
    setConfirmedFor(null);
    setActionError('');
  };

  let values: ReturnType<typeof cocWeaponValues> | undefined;
  let error = '';
  if (!attacker || attacker.dead || attacker.unconscious || card.hp <= 0)
    error = '该角色目前不能攻击。';
  else if (target && !defender) error = '原目标已不在本场，请重新选择。';
  else if (
    distanceYards !== undefined &&
    (!Number.isFinite(distanceYards) || distanceYards < 0 || distanceYards > 100000)
  )
    error = '距离须在 0–100000 码之间。';
  else if (
    armorOverride !== undefined &&
    (!Number.isInteger(armorOverride) || armorOverride < 0 || armorOverride > 100000)
  )
    error = '护甲值须为 0–100000 的整数。';
  else if (weapon) {
    try {
      values = cocWeaponValues(card, weapon, { distanceYards });
    } catch (e) {
      error = (e as Error).message;
    }
  }

  return (
    <section className="coc-subsection">
      <h4>射击与投掷</h4>
      <div className="coc-inline-fields">
        <label className="field">
          武器
          <select value={id} disabled={disabled} onChange={(e) => change(setId, e.target.value)}>
            <option value="">选择武器</option>
            {id && !weapon && (
              <option value={id} disabled>
                原武器已移除
              </option>
            )}
            {weapons.map((item) => (
              <option value={item.id} key={item.id}>
                {item.profile.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          目标
          <select
            value={target}
            disabled={disabled}
            onChange={(e) => change(setTarget, e.target.value)}
          >
            <option value="">只掷攻击和伤害骰</option>
            {target && !defender && (
              <option value={target} disabled>
                原目标已移除
              </option>
            )}
            {targets.map((item) => (
              <option value={item.id} key={item.id}>
                {isHost ? item.name : item.publicName}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          距离（码）
          <input
            type="number"
            min={0}
            max={100000}
            step="any"
            value={distance}
            placeholder="可留空"
            disabled={disabled}
            onChange={(e) => change(setDistance, e.target.value)}
          />
        </label>
        <label className="field">
          要求等级
          <select
            value={difficulty}
            disabled={disabled}
            onChange={(e) =>
              change((value) => setDifficulty(value as typeof difficulty), e.target.value)
            }
          >
            <option value="regular">普通</option>
            <option value="hard">困难</option>
            <option value="extreme">极难</option>
          </select>
        </label>
        <label className="field">
          奖励与惩罚
          <select
            value={edge}
            disabled={disabled}
            onChange={(e) => change((value) => setEdge(value as Edge), e.target.value)}
          >
            <option value="normal">正常</option>
            <option value="advantage">奖励骰</option>
            <option value="disadvantage">惩罚骰</option>
          </select>
        </label>
        {isHost && (
          <label className="field">
            可见范围
            <select
              value={visibility}
              disabled={disabled}
              onChange={(e) =>
                change((value) => setVisibility(value as Visibility), e.target.value)
              }
            >
              <option value="public">公开</option>
              <option value="host">暗骰</option>
            </select>
          </label>
        )}
        {isHost && canDamage && (
          <label className="field">
            本次护甲
            <input
              type="number"
              min={0}
              max={100000}
              step={1}
              value={armor}
              placeholder="留空使用目标护甲"
              disabled={disabled}
              onChange={(e) => change(setArmor, e.target.value)}
            />
          </label>
        )}
      </div>
      {values && (
        <p className="coc-data-line">
          技能 {values.skill}% · 伤害 {values.damageExpression} · 基础射程 {values.range} 码
          {values.capacity ? ` · 弹药 ${values.ammo.loaded}/${values.capacity}` : ''}
          {values.ammo.jammed ? ' · 武器故障' : ''}
        </p>
      )}
      {canDamage && (
        <label className="coc-toggle">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={disabled || !values}
            onChange={(e) => setConfirmedFor(e.target.checked ? confirmKey : null)}
          />
          本次命中后按护甲扣减目标 HP
        </label>
      )}
      <button
        type="button"
        className="button primary"
        disabled={
          disabled ||
          !values ||
          room.phase !== 'active' ||
          values.ammo.jammed ||
          (!!values.capacity && !values.ammo.loaded)
        }
        onClick={() => {
          if (!values || !attacker) return;
          setConfirmedFor(null);
          setActionError('');
          void execute({
            type: 'encounter-coc-weapon',
            attackerId: attacker.id,
            targetId: defender?.id,
            weaponId: id,
            expectedCharacterRevision: member.characterRevision,
            expectedRevision: room.encounter.revision,
            requestId: crypto.randomUUID(),
            edge,
            difficulty,
            distanceYards,
            visibility: rollVisibility,
            ...(confirmed ? { confirmedDamage: true as const, armorOverride } : {}),
          }).catch((e: Error) => setActionError(e.message));
        }}
      >
        <Dices size={16} />
        单次射击 / 投掷
      </button>
      {(error || actionError) && (
        <p className="inline-error" role="alert">
          {error || actionError}
        </p>
      )}
      <p className="field-help">
        结算弹药、故障、DB 和伤害。距离、速射惩罚和其他场景条件由主持人裁定；近战请用对抗面板。
      </p>
    </section>
  );
}
