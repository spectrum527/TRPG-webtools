import { useState } from 'react';
import { Check, Dices, Heart, Shield, Swords } from 'lucide-react';
import type { Combatant, DamageAdjustment } from '../../shared/encounter';
import type { Edge, Room, RoomAction, Visibility } from '../../shared/types';
import { getDndEdition } from '../../shared/dnd-edition';
import { effectiveCharacter } from '../../shared/adjustments';
import { getDndWeaponAttack, isDndAmmunition } from '../../shared/dnd-equipment';
import { dndAmmoCompatibility } from '../../shared/character-runtime';
import { Spinner } from './ui';

type Run = (action: RoomAction) => Promise<boolean>;
export function useEncounterCommand(room: Room, run: Run) {
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState<RoomAction | null>(null);
  const [lastId, setLastId] = useState('');
  const execute = async (action: RoomAction) => {
    if (busy) return false;
    const requestId =
      action.type === 'coc-melee'
        ? action.damage?.requestId
        : 'requestId' in action
          ? action.requestId
          : undefined;
    setLastId(requestId ?? '');
    setBusy(true);
    try {
      const ok = await run(action);
      setRetry(ok ? null : action);
      return ok;
    } finally {
      setBusy(false);
    }
  };
  const event = lastId ? room.log.find((entry) => entry.requestId === lastId) : undefined;
  return { busy, retry, execute, event, clearRetry: () => setRetry(null) };
}
export function CombatCommandStatus({
  command,
}: {
  command: ReturnType<typeof useEncounterCommand>;
}) {
  return (
    <>
      {command.retry && (
        <div className="combat-command-retry" role="status">
          <p>本次操作未确认完成。可重试同一请求；修改参数前请先核对战斗记录。</p>
          <button
            className="button secondary compact"
            disabled={command.busy}
            onClick={() => void command.execute(command.retry!)}
          >
            重试本次操作
          </button>
          <button className="text-button" disabled={command.busy} onClick={command.clearRetry}>
            返回修改
          </button>
        </div>
      )}
      {command.event && (
        <div className="combat-command-result" aria-live="polite">
          <Check size={17} />
          <p>{command.event.content}</p>
        </div>
      )}
    </>
  );
}
export function InitiativeCheck({
  room,
  combatant,
  isHost,
  run,
}: {
  room: Room;
  combatant?: Combatant;
  isHost: boolean;
  run: Run;
}) {
  const [bonus, setBonus] = useState(0);
  const [edge, setEdge] = useState<Edge>('normal');
  const [marking, setMarking] = useState(false);
  const command = useEncounterCommand(room, run);
  if (!combatant || room.rule !== 'dnd') return null;
  const roll = combatant.initiativeRoll;
  const recorded = !!roll || combatant.initiative !== null || combatant.initiativeOverride !== null;
  const mayRoll = !isHost || combatant.memberId === null;
  const value = roll ? roll.selected + roll.dexModifier + roll.bonus : combatant.initiative;
  const edition = getDndEdition(room.dndEdition);
  return (
    <section className="initiative-check" aria-label="先攻判定">
      <div className="initiative-heading">
        <div>
          <h4>
            <Dices size={17} />
            先攻判定
          </h4>
          <p>{isHost ? combatant.name : combatant.publicName} · D20 + 敏捷调整值 + 额外加值</p>
        </div>
        <output aria-label="先攻结果">{value ?? '—'}</output>
      </div>
      <div className="initiative-options">
        <label className="field">
          投掷方式
          <select
            aria-label="先攻投掷方式"
            value={edge}
            onChange={(event) => setEdge(event.target.value as Edge)}
          >
            <option value="normal">普通骰</option>
            <option value="advantage">优势</option>
            <option value="disadvantage">劣势</option>
          </select>
        </label>
        <label className="field">
          额外先攻加值
          <input
            aria-label="额外先攻加值"
            type="number"
            value={bonus}
            min={-100}
            max={100}
            onChange={(event) => setBonus(Number(event.target.value))}
          />
        </label>
        <button
          className="button secondary compact"
          disabled={
            recorded ||
            !mayRoll ||
            command.busy ||
            !!command.retry ||
            marking ||
            room.phase !== 'active' ||
            combatant.dex === null ||
            !Number.isInteger(bonus) ||
            bonus < -100 ||
            bonus > 100
          }
          onClick={() =>
            void command.execute({
              type: 'encounter-initiative-roll',
              combatantId: combatant.id,
              bonus,
              edge,
              expectedRevision: room.encounter.revision,
              requestId: crypto.randomUUID(),
            })
          }
        >
          {command.busy ? <Spinner /> : <Dices size={16} />}
          {recorded ? '已记录先攻' : '掷先攻'}
        </button>
      </div>
      {isHost && (
        <label className="combatant-checkbox initiative-surprise">
          <input
            type="checkbox"
            checked={!!combatant.surprised}
            disabled={marking || command.busy || room.phase !== 'active'}
            onChange={async (event) => {
              setMarking(true);
              try {
                await run({
                  type: 'encounter-update',
                  combatantId: combatant.id,
                  patch: { surprised: event.target.checked },
                  expectedRevision: room.encounter.revision,
                });
              } finally {
                setMarking(false);
              }
            }}
          />
          受突袭
          <span>
            {edition === '2024'
              ? '2024：先攻具有劣势'
              : '2014：首回合不能移动或行动，回合结束后才能反应'}
          </span>
        </label>
      )}
      {!isHost && combatant.surprised && (
        <p className="subtle-note">
          主持人标记受突袭。
          {edition === '2024'
            ? '本次先攻加入劣势；已有优势时相互抵消。'
            : '首回合行动受限，先攻骰不受影响。'}
        </p>
      )}
      {!mayRoll && !recorded && (
        <p className="subtle-note">
          玩家可在自己的「本场战斗」中掷先攻；主持人生成顺序时会补掷尚未记录的角色。
        </p>
      )}
      {roll && (
        <p className="initiative-breakdown">
          D20 [{roll.rolls.join('，')}] 取 {roll.selected}，敏捷 {roll.dexModifier >= 0 ? '+' : ''}
          {roll.dexModifier}，额外 {roll.bonus >= 0 ? '+' : ''}
          {roll.bonus}。由主持人排定后更新行动顺序。
        </p>
      )}
      {combatant.initiativeOverride !== null && (
        <p className="subtle-note">
          当前手填行动值 {combatant.initiativeOverride} 优先；使用骰点排序前，请清空下方手填行动值。
        </p>
      )}
      <CombatCommandStatus command={command} />
    </section>
  );
}

export function AutoDamageSetting({ room, run }: { room: Room; run: Run }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className={`auto-damage-setting ${room.encounter.autoDamage ? 'enabled' : ''}`}>
      <label>
        <Heart size={19} />
        <span>
          <b>自动扣减生命值</b>
          <small>有明确目标的攻击与伤害同步到角色和本场记录</small>
        </span>
        <input
          type="checkbox"
          aria-label="自动扣减生命值"
          checked={room.encounter.autoDamage ?? false}
          disabled={busy || room.phase !== 'active'}
          onChange={async (event) => {
            setBusy(true);
            try {
              await run({
                type: 'encounter-settings',
                autoDamage: event.target.checked,
                expectedRevision: room.encounter.revision,
              });
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      <p>
        {room.encounter.autoDamage
          ? '已开启。普通骰子仍只记骰点；下方定向攻击命中后，自动处理伤害与 HP。'
          : '关闭时只掷骰、记录结果。开启后，主持人可让定向攻击与伤害直接扣除 HP。'}
      </p>
    </div>
  );
}
const adjustments: [DamageAdjustment, string][] = [
  ['normal', '正常伤害'],
  ['resistant', '抗性 · 减半取整'],
  ['vulnerable', '易伤 · 翻倍'],
  ['immune', '免疫 · 无伤害'],
  ['resistant-vulnerable', '抗性与易伤 · 依次处理'],
];
export function TargetedDamage({ room, actor, run }: { room: Room; actor: Combatant; run: Run }) {
  const [mode, setMode] = useState<'attack' | 'damage'>(room.rule === 'dnd' ? 'attack' : 'damage');
  const [targetId, setTargetId] = useState(
    room.encounter.participants.find((entry) => entry.id !== actor.id)?.id ?? actor.id,
  );
  const [expression, setExpression] = useState('1d6');
  const [modifier, setModifier] = useState<number | null>(
    actor.source?.rule === 'dnd'
      ? (actor.source.actions.find((entry) => entry.attackBonus !== null)?.attackBonus ?? null)
      : null,
  );
  const [edge, setEdge] = useState<Edge>('normal');
  const [adjustment, setAdjustment] = useState<DamageAdjustment>('normal');
  const [armor, setArmor] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('host');
  const [presetNotice, setPresetNotice] = useState('');
  const [weaponId, setWeaponId] = useState('');
  const [weaponMode, setWeaponMode] = useState<'normal' | 'light-extra'>('normal');
  const [ammoItemId, setAmmoItemId] = useState('');
  const [ammoConfirmed, setAmmoConfirmed] = useState(false);
  const [lightExtraConfirmed, setLightExtraConfirmed] = useState(false);
  const owner = room.members.find((member) => member.id === actor.memberId);
  const character = owner?.character;
  const weapons = character?.dndEquipment
    ? character.items.filter(
        (item) => item.equipment?.equipped && item.equipment.weapon && item.quantity > 0,
      )
    : [];
  const weapon = weapons.find((item) => item.id === weaponId);
  let weaponResult: ReturnType<typeof getDndWeaponAttack> | null = null;
  let weaponError = '';
  if (weaponId && character) {
    try {
      weaponResult = getDndWeaponAttack(effectiveCharacter(character), weaponId, weaponMode);
    } catch (error) {
      weaponError = (error as Error).message;
    }
  }
  const ammunition = character?.items.filter(isDndAmmunition) ?? [];
  const selectedAmmo = ammunition.find((item) => item.id === ammoItemId);
  const ammoMatch = weapon && selectedAmmo ? dndAmmoCompatibility(weapon, selectedAmmo) : null;
  const attackModifier = weaponId ? (weaponResult?.modifier ?? null) : modifier;
  const attackExpression = weaponId ? (weaponResult?.damage ?? '') : expression;
  const command = useEncounterCommand(room, run);
  const target = room.encounter.participants.find((entry) => entry.id === targetId);
  const autoDamage = room.encounter.autoDamage ?? false;
  const isAttack = room.rule === 'dnd' && mode === 'attack';
  const presets =
    actor.source?.rule === 'dnd'
      ? actor.source.actions.filter((entry) => entry.attackBonus !== null)
      : [];
  const submit = () => {
    if (!target) return;
    const base = {
      visibility,
      expectedRevision: room.encounter.revision,
      requestId: crypto.randomUUID(),
    };
    if (isAttack && attackModifier !== null)
      return command.execute({
        type: 'encounter-dnd-attack',
        attackerId: actor.id,
        targetId: target.id,
        ...(weaponId && owner
          ? {
              weaponId,
              weaponMode,
              expectedCharacterRevision: owner.characterRevision,
              ...(weaponResult?.ammunition
                ? { ammoItemId, ...(ammoConfirmed ? { ammoConfirmed: true as const } : {}) }
                : {}),
              ...(weaponMode === 'light-extra' && lightExtraConfirmed
                ? { lightExtraConfirmed: true as const }
                : {}),
            }
          : { modifier: attackModifier }),
        edge,
        ...(autoDamage ? { damage: { ...(weaponId ? {} : { expression }), adjustment } } : {}),
        ...base,
      });
    if (autoDamage)
      return command.execute({
        type: 'encounter-damage',
        targetId: target.id,
        expression,
        ...(room.rule === 'dnd'
          ? { adjustment }
          : armor !== ''
            ? { armorOverride: Number(armor) }
            : {}),
        ...base,
      });
    return command.execute({ type: 'roll', expression, visibility, requestId: base.requestId });
  };
  const invalid =
    !target ||
    ((!isAttack || autoDamage) && !(isAttack ? attackExpression : expression).trim()) ||
    (isAttack &&
      weaponId &&
      (!!weaponError ||
        (weaponResult?.ammunition &&
          (!selectedAmmo ||
            ammoMatch === 'mismatch' ||
            (ammoMatch === 'unknown' && !ammoConfirmed))) ||
        (weaponMode === 'light-extra' && !lightExtraConfirmed))) ||
    (isAttack &&
      (target.id === actor.id ||
        target.ac === null ||
        attackModifier === null ||
        !Number.isInteger(attackModifier) ||
        Math.abs(attackModifier) > 100)) ||
    (room.rule === 'coc' &&
      armor !== '' &&
      (!Number.isInteger(Number(armor)) || Number(armor) < 0 || Number(armor) > 100000));
  return (
    <section className="targeted-damage" aria-label="定向攻击与伤害">
      <div className="targeted-heading">
        <h4>
          <Swords size={17} />
          {room.rule === 'dnd' ? '攻击与伤害' : '伤害结算'}
        </h4>
        <select
          aria-label="定向伤害可见范围"
          value={visibility}
          onChange={(event) => setVisibility(event.target.value as Visibility)}
        >
          <option value="host">主持人暗骰</option>
          <option value="public">公开掷骰</option>
        </select>
      </div>
      {room.rule === 'dnd' && (
        <div className="tabs targeted-tabs">
          <button className={mode === 'attack' ? 'active' : ''} onClick={() => setMode('attack')}>
            攻击命中后结算
          </button>
          <button className={mode === 'damage' ? 'active' : ''} onClick={() => setMode('damage')}>
            直接结算伤害
          </button>
        </div>
      )}
      <div className="combat-action-grid">
        {isAttack && weapons.length > 0 && (
          <label className="field">
            角色武器
            <select
              aria-label="角色武器"
              value={weaponId}
              onChange={(event) => {
                setWeaponId(event.target.value);
                setAmmoItemId('');
                setAmmoConfirmed(false);
                setWeaponMode('normal');
                setLightExtraConfirmed(false);
              }}
            >
              <option value="">手动填写攻击</option>
              {weapons.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {isAttack && weapon?.equipment?.weapon?.light && (
          <label className="field">
            攻击用途
            <select
              aria-label="武器攻击用途"
              value={weaponMode}
              onChange={(event) => {
                setWeaponMode(event.target.value as typeof weaponMode);
                setLightExtraConfirmed(false);
              }}
            >
              <option value="normal">正常攻击</option>
              <option value="light-extra">额外轻型武器攻击</option>
            </select>
          </label>
        )}
        {isAttack && weaponResult?.ammunition && (
          <label className="field">
            消耗弹药
            <select
              aria-label="攻击弹药"
              value={ammoItemId}
              onChange={(event) => {
                setAmmoItemId(event.target.value);
                setAmmoConfirmed(false);
              }}
            >
              <option value="">选择弹药</option>
              {ammunition.map((item) => (
                <option
                  key={item.id}
                  value={item.id}
                  disabled={!!weapon && dndAmmoCompatibility(weapon, item) === 'mismatch'}
                >
                  {item.name} · 剩余 {item.quantity}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          {isAttack ? '攻击目标' : '受伤目标'}
          <select
            aria-label="伤害目标"
            value={targetId}
            onChange={(event) => {
              setTargetId(event.target.value);
              setArmor('');
            }}
          >
            {room.encounter.participants.map((entry) => (
              <option key={entry.id} value={entry.id} disabled={isAttack && entry.id === actor.id}>
                {entry.name}
                {entry.id === actor.id ? '（当前角色）' : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="target-resource">
          <Shield size={16} />
          <span>
            {target?.name || '请选择目标'}
            <small>
              {room.rule === 'dnd'
                ? `AC ${target?.ac ?? '未知'}`
                : `护甲 ${target?.source?.rule === 'coc' ? (target.source.armor ?? '待核对') : 0}`}{' '}
              · HP {target?.hp ?? '未知'} / {target?.maxHp ?? '未知'}
              {target?.tempHp ? ` · 临时 HP ${target.tempHp}` : ''}
            </small>
          </span>
        </div>
        {isAttack && (
          <>
            <label className="field">
              攻击总加值
              <input
                aria-label="定向攻击总加值"
                type="number"
                min={-100}
                max={100}
                value={attackModifier ?? ''}
                readOnly={!!weaponId}
                placeholder="按角色与武器填写"
                onChange={(event) =>
                  setModifier(event.target.value === '' ? null : Number(event.target.value))
                }
              />
            </label>
            <label className="field">
              攻击投掷
              <select
                aria-label="定向攻击投掷方式"
                value={edge}
                onChange={(event) => setEdge(event.target.value as Edge)}
              >
                <option value="normal">普通骰</option>
                <option value="advantage">优势</option>
                <option value="disadvantage">劣势</option>
              </select>
            </label>
          </>
        )}
        <label className="field">
          {isAttack ? '命中伤害骰式' : '伤害骰式或固定值'}
          <input
            aria-label="自动结算伤害骰式"
            value={isAttack ? attackExpression : expression}
            readOnly={isAttack && !!weaponId}
            maxLength={120}
            placeholder="例如 2d6+3，或 8"
            onChange={(event) => setExpression(event.target.value)}
          />
        </label>
        {room.rule === 'dnd' ? (
          <label className="field">
            目标对本次伤害
            <select
              aria-label="目标伤害修正"
              value={adjustment}
              onChange={(event) => setAdjustment(event.target.value as DamageAdjustment)}
            >
              {adjustments.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="field">
            本次护甲覆盖（可选）
            <input
              aria-label="本次护甲覆盖"
              type="number"
              min={0}
              max={100000}
              value={armor}
              placeholder="留空采用目标记录"
              onChange={(event) => setArmor(event.target.value)}
            />
          </label>
        )}
      </div>
      {isAttack && weaponId && (
        <div className="prep-stack compact-stack">
          <p className="subtle-note">
            采用已穿戴武器的属性、熟练与魔法加值。
            {weaponResult?.disadvantage ? `本次加入劣势：${weaponResult.reason}。` : ''}
            {weaponResult?.loading ? '该武器具有装填属性；请确认本次射击符合其行动次数限制。' : ''}
            {weaponResult?.ammunition ? '命中或失手都会消耗 1 件选定弹药。' : ''}
          </p>
          {weaponError && <p className="inline-error">{weaponError}</p>}
          {weaponMode === 'light-extra' && (
            <label className="prep-checkbox">
              <input
                type="checkbox"
                checked={lightExtraConfirmed}
                onChange={(event) => setLightExtraConfirmed(event.target.checked)}
              />
              已确认另一把轻型武器的前置攻击与本次动作条件；本次不加入正属性伤害加值
            </label>
          )}
          {weaponResult?.ammunition && ammoMatch === 'unknown' && (
            <label className="prep-checkbox">
              <input
                type="checkbox"
                checked={ammoConfirmed}
                onChange={(event) => setAmmoConfirmed(event.target.checked)}
              />
              目录未完整编码类型，主持人已确认这份弹药适用
            </label>
          )}
        </div>
      )}
      {isAttack && presets.length > 0 && (
        <div className="encounter-attack-shortcuts">
          {presets.map((action) => (
            <button
              key={action.id}
              className="text-button"
              onClick={() => {
                setModifier(action.attackBonus);
                const pure = action.damage.trim();
                if (/^(?:\d*d\d+|\d+)(?:\s*[+-]\s*(?:\d*d\d+|\d+))*$/i.test(pure)) {
                  setExpression(pure);
                  setPresetNotice('');
                } else {
                  setExpression('');
                  setPresetNotice('资料含伤害类型或效果说明，请核对后填写纯骰式。');
                }
              }}
            >
              采用 {action.name}（{action.attackBonus! >= 0 ? '+' : ''}
              {action.attackBonus}）
            </button>
          ))}
        </div>
      )}
      {presetNotice && <p className="subtle-note">{presetNotice}</p>}
      <p className="subtle-note">
        {room.rule === 'dnd'
          ? '本次仅结算一种伤害。按目标的抗性、易伤或免疫选择修正；先抵扣临时 HP。重击自动加倍伤害骰，固定加值不翻倍。混合伤害请分别结算。'
          : '按本次护甲扣减后修改 HP，并记录重伤或濒死提示；体质检定和特殊后果由 KP 继续处理。'}
      </p>
      <button
        className="button primary compact"
        disabled={command.busy || !!command.retry || !!invalid || room.phase !== 'active'}
        onClick={() => void submit()}
      >
        {command.busy ? <Spinner /> : <Dices size={16} />}
        {isAttack
          ? autoDamage
            ? '攻击并自动结算'
            : '攻击检定（不扣血）'
          : autoDamage
            ? '掷伤害并扣血'
            : '仅掷伤害'}
      </button>
      <CombatCommandStatus command={command} />
    </section>
  );
}
