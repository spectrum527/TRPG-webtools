import { useState } from 'react';
import {
  Check,
  ClipboardCheck,
  FileText,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import type { Character, Item, Member, Room, RoomAction } from '../../shared/types';
import { COC_ATTRIBUTES, DND_ATTRIBUTES, DND_SKILLS } from '../../shared/catalog';
import {
  COC_CAREER_SOURCE_LABELS,
  COC_SKILL_CATALOG,
  COC_SKILL_FAMILIES,
  cocOccupationProfile,
  cocSkillBase,
  cocSkillDefinitions,
  occupationOptions,
} from '../../shared/coc-career';
import { COC_DERIVED_FIELDS, cocDerivedValues } from '../../shared/coc-investigator';
import {
  COC_ARMOR_CATALOG,
  COC_WEAPON_CATALOG,
  cocArmorValues,
  cocWeaponValues,
} from '../../shared/coc-equipment';
import { COC_WEALTH_FIELDS, cocWealthValues } from '../../shared/coc-wealth';
import {
  CreationPolicySchema,
  cocBudget,
  defaultCreationPolicy,
  dndSkillModifier,
  policyFields,
  validateCreation,
  type CreationPolicy,
} from '../../shared/creation';
import { Modal, Spinner } from './ui';
import { ValidationSummary } from './AllocationEditor';
import { AdjustmentSummary } from './AdjustmentSummary';
import { effectiveCharacter } from '../../shared/adjustments';
import { getDndEdition } from '../../shared/dnd-edition';
import { hasDndArmorTraining, type DndEquipmentState } from '../../shared/dnd-equipment';
import {
  getDndMagicProfile,
  type DndMagicState,
  type DndResourceRecovery,
  type DndSpellGrant,
} from '../../shared/dnd-magic';
import { loadEquipmentCatalog, loadMagicCatalog, useRuleCatalog } from '../rule-catalogs';

export function ReviewDesk({
  room,
  isHost,
  run,
  onClose,
}: {
  room: Room;
  isHost: boolean;
  run: (a: RoomAction) => Promise<boolean>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'review' | 'policy'>(isHost ? 'review' : 'policy');
  const [selected, setSelected] = useState(room.members.find((m) => m.role === 'player')?.id ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const players = room.members.filter((m) => m.role === 'player');
  const member = players.find((m) => m.id === selected) ?? players[0];
  const character = member?.character;
  const branch = character && cocOccupationProfile(character)?.name;
  const occupationName =
    branch && branch !== character?.occupation
      ? `${character?.occupation} · ${branch}`
      : character?.occupation;
  const errors = member?.character
    ? validateCreation(member.character, room.creationPolicy)
    : ['尚未提交角色卡'];
  const review = async (decision: 'approved' | 'changes') => {
    if (!member) return;
    setBusy(true);
    await run({
      type: 'review-character',
      memberId: member.id,
      decision,
      note,
      characterRevision: member.characterRevision,
      policyRevision: room.policyRevision,
    });
    setBusy(false);
  };
  return (
    <Modal
      title={isHost ? '开场前，把角色读一遍。' : '本桌制卡要求'}
      subtitle={`剧本限制 · 第 ${room.policyRevision + 1} 版 · ${room.phase === 'lobby' ? '准备阶段' : '故事进行中'}`}
      className="review-desk"
      onClose={onClose}
    >
      {isHost && (
        <div className="desk-tabs">
          <button className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>
            <ClipboardCheck size={16} />
            角色卡审核
            <span>
              {players.filter((m) => isApproved(m, room)).length}/{players.length}
            </span>
          </button>
          <button className={tab === 'policy' ? 'active' : ''} onClick={() => setTab('policy')}>
            <SlidersHorizontal size={16} />
            剧本限制
          </button>
        </div>
      )}
      {tab === 'policy' ? (
        <PolicyEditor room={room} isHost={isHost} run={run} />
      ) : (
        <div className="review-layout">
          <aside className="review-queue">
            {players.map((m) => (
              <button
                key={m.id}
                className={member?.id === m.id ? 'selected' : ''}
                onClick={() => {
                  setSelected(m.id);
                  setNote('');
                }}
              >
                <span className="review-avatar">{(m.character?.name ?? m.name).slice(0, 1)}</span>
                <span>
                  <b>{m.character?.name ?? '未提交角色'}</b>
                  <small>
                    {m.name} · {reviewLabel(m, room)}
                  </small>
                </span>
                {isApproved(m, room) && <ShieldCheck size={16} />}
              </button>
            ))}
            {!players.length && (
              <p className="subtle-note">邀请玩家入席后，提交的卡片会出现在这里。</p>
            )}
          </aside>
          <section className="review-content">
            {member ? (
              <>
                <div className="review-card-heading">
                  <div>
                    <span className="mini-label">
                      CHARACTER REVIEW · V{member.characterRevision}
                    </span>
                    <h3>{member.character?.name ?? member.name}</h3>
                    <p>
                      {occupationName ?? '等待角色卡'} · {reviewLabel(member, room)}
                    </p>
                  </div>
                  <FileText size={28} strokeWidth={1} />
                </div>
                {member.character && <AuditCard card={member.character} />}
                {member.character && <AdjustmentSummary card={member.character} />}
                <ValidationSummary errors={errors} />
                {member.review.note && (
                  <div className="review-note">
                    <b>上次审核意见</b>
                    <p>{member.review.note}</p>
                  </div>
                )}
                <label className="field">
                  审核意见
                  <textarea
                    aria-label="审核意见"
                    rows={3}
                    maxLength={1000}
                    value={note}
                    placeholder="例如：剧本需要普通人背景，请调整武器来源。"
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <div className="review-actions">
                  <button
                    className="button secondary"
                    disabled={busy || !member.character || room.phase !== 'lobby' || !note.trim()}
                    onClick={() => void review('changes')}
                  >
                    要求修改
                  </button>
                  <button
                    className="button primary"
                    disabled={
                      busy ||
                      errors.length > 0 ||
                      room.phase !== 'lobby' ||
                      isApproved(member, room)
                    }
                    onClick={() => void review('approved')}
                  >
                    {busy ? <Spinner /> : <ShieldCheck size={17} />}
                    {isApproved(member, room) ? '已通过审核' : '通过此卡'}
                  </button>
                </div>
                <p className="subtle-note">
                  通过只针对当前卡片与当前限制版本。改卡、改限制或移交主持人后需要重审；主持人不能跳过数值检查。
                </p>
              </>
            ) : (
              <div className="empty-state">
                <ClipboardCheck size={32} />
                <p>还没有等待审核的玩家。</p>
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
export function isApproved(member: Member, room: Room) {
  return (
    member.review.status === 'approved' &&
    (room.phase === 'active' || member.review.characterRevision === member.characterRevision) &&
    member.review.policyRevision === room.policyRevision
  );
}
export function reviewLabel(member: Member, room: Room) {
  return !member.character
    ? '未提交'
    : isApproved(member, room)
      ? '审核通过'
      : member.review.status === 'changes'
        ? '需要修改'
        : '等待审核';
}
function AuditCard({ card }: { card: Character }) {
  const attrs = card.rule === 'coc' ? COC_ATTRIBUTES : DND_ATTRIBUTES;
  const b = card.rule === 'coc' ? cocBudget(card) : null;
  const ac = card.dndEquipment ? effectiveCharacter(card).ac : card.ac;
  const allocation = card.creation?.rule === 'dnd' ? card.creation : null;
  const edition = getDndEdition(card.dndEdition);
  const skills = card.rule === 'coc' ? cocSkillDefinitions(card) : DND_SKILLS;
  return (
    <div className="audit-card">
      <p>
        {card.ancestry || '未填写种族／国籍'} · {card.age} 岁
        {card.rule === 'dnd' && ` · Lv.${card.level}`}
      </p>
      <p>{card.background || '未填写背景'}</p>
      <div className="audit-attributes">
        {attrs.map((a) => (
          <span key={a.key}>
            {a.label}
            <b>{card.attributes[a.key]}</b>
          </span>
        ))}
      </div>
      <p className="audit-resources">
        HP {card.hp}/{card.maxHp} ·{' '}
        {card.rule === 'coc'
          ? `MP ${card.mp}/${card.maxMp} · SAN ${card.san}/${card.maxSan}`
          : `AC ${ac}`}
      </p>
      {b && (
        <p className="subtle-note">
          职业点 {b.spentOccupation}/{b.occupational} · 兴趣点 {b.spentPersonal}/{b.personal}
        </p>
      )}
      {allocation && (allocation.extraSkills.length > 0 || allocation.extraSaves.length > 0) && (
        <p className="subtle-note">
          <b>额外熟练</b>
          {' · '}
          {allocation.extraSkills.length > 0 &&
            `技能 ${allocation.extraSkills.map((key) => DND_SKILLS.find((skill) => skill.key === key)?.label ?? key).join('、')}`}
          {allocation.extraSkills.length > 0 && allocation.extraSaves.length > 0 && ' · '}
          {allocation.extraSaves.length > 0 &&
            `豁免 ${allocation.extraSaves.map(abilityLabel).join('、')}`}
        </p>
      )}
      {card.dndMagic && (
        <MagicAudit key={`${card.id}-${edition}-magic`} card={card} state={card.dndMagic} />
      )}
      {card.dndEquipment && (
        <EquipmentAudit
          key={`${card.id}-${edition}-equipment`}
          card={card}
          state={card.dndEquipment}
          ac={ac}
        />
      )}
      {card.rule === 'coc' && <CocAudit card={card} />}
      <details>
        <summary>技能与分配来源</summary>
        <div className="audit-skills">
          {skills.map((skill) => {
            const base = 'base' in skill ? cocSkillBase(card, skill) : 0;
            const value =
              card.rule === 'coc'
                ? (card.skills[skill.key] ?? base)
                : dndSkillModifier(card, skill.key);
            return (
              <span key={skill.key}>
                <span>
                  {skill.label}
                  {'source' in skill && skill.source === 'custom' && ' · 自定义'}
                  {card.creation?.rule === 'coc' && (
                    <small>
                      基础 {base} + 职业 {card.creation.occupational[skill.key] ?? 0}
                      {' + '}兴趣 {card.creation.personal[skill.key] ?? 0}
                    </small>
                  )}
                </span>
                <b>{value}</b>
              </span>
            );
          })}
        </div>
        {card.creation?.rule === 'dnd' && (
          <p className="subtle-note">
            {(
              [
                'classSkills',
                'backgroundSkills',
                'ancestrySkills',
                'replacementSkills',
                'expertise',
              ] as const
            ).map((key, i) => (
              <span className="audit-source" key={key}>
                {['职业', '背景', '种族', '重复替代', '专精'][i]}：
                {card.creation?.rule === 'dnd'
                  ? card.creation[key]
                      .map((s) => DND_SKILLS.find((k) => k.key === s)?.label)
                      .join('、') || '无'
                  : ''}
              </span>
            ))}
          </p>
        )}
      </details>
      <details>
        <summary>故事、词条与行囊</summary>
        <div className="audit-prose">
          <b>故事词条</b>
          <p>{card.traits.join('\n') || '未填写'}</p>
          <b>人物经历</b>
          <p>{card.backstory || '未填写'}</p>
          <b>笔记</b>
          <p>{card.notes || '未填写'}</p>
          <b>行囊</b>
          {card.items.length ? (
            card.items.map((item) => (
              <p key={item.id}>
                {item.name} × {item.quantity}
                {item.notes && ` · ${item.notes}`}
              </p>
            ))
          ) : (
            <p>无物品</p>
          )}
        </div>
      </details>
    </div>
  );
}

const signed = (value: number) => (value > 0 ? `+${value}` : String(value));

const derivedLabels = {
  db: '伤害加值 DB',
  build: '体格',
  mov: '移动力',
  maxHp: 'HP 上限',
  maxMp: 'MP 上限',
  maxSan: 'SAN 上限',
};
const wealthLabels = { cash: '初始现金', assets: '初始资产', spending: '日常消费水平' };
const armorCoverage = { head: '头部', body: '身体', all: '全身' };
const weaponOverrideLabels: Record<string, string> = {
  skill: '技能值',
  skillKey: '关联技能',
  range: '射程',
  usesPerRound: '每轮次数',
  rapidUsesPerRound: '速射次数',
  capacity: '装弹量',
  malfunction: '故障值',
  damage: '基础伤害',
  damageBonusMode: '伤害加值方式',
};
function CocAudit({ card }: { card: Character }) {
  const profile = cocOccupationProfile(card);
  const career = card.cocCareer;
  const a = card.creation?.rule === 'coc' ? card.creation : undefined;
  const investigator = card.cocInvestigator;
  const derived = cocDerivedValues(card, { includeTemporary: false });
  const age = investigator?.age?.applied;
  const equipment = investigator?.equipment;
  const wealth = investigator?.wealth ? cocWealthValues(card, investigator.wealth) : undefined;
  const session = card.cocSession;
  const skillNames = new Map(
    [...COC_SKILL_CATALOG, ...(career?.customSkills ?? [])].map(({ key, label }) => [key, label]),
  );
  const skillName = (key: string) => skillNames.get(key) ?? key;
  return (
    <details>
      <summary>调查员资料与制卡依据</summary>
      <div className="audit-prose">
        {profile && (
          <>
            <b>职业与专长</b>
            <p>
              {profile.name} · {COC_CAREER_SOURCE_LABELS[profile.source]} · 信用评级{' '}
              {card.skills.creditRating ?? 0}（职业范围 {profile.credit[0]}–{profile.credit[1]}）
              {' · '}
              {career?.specializationsEnabled ? '技能专长已启用' : '基础技能模式'}
            </p>
            {a && (
              <p>
                {profile.bonus.length
                  ? `职业点 EDU × 2 + ${a.occupationAttribute.toUpperCase()} × 2`
                  : '职业点 EDU × 4'}
                <br />
                职业技能 {a.occupationSkills.filter(Boolean).map(skillName).join('、') || '未选择'}
              </p>
            )}
            {profile.source === 'custom' && (
              <details>
                <summary>自定义职业范围</summary>
                <p>
                  自选位置 {profile.free} 项
                  {profile.bonus.length > 1 &&
                    ` · 公式备选 ${profile.bonus.map((key) => key.toUpperCase()).join('、')}`}
                </p>
                {occupationOptions(profile, card)
                  .slice(0, profile.groups.length)
                  .map((group, i) => (
                    <p key={i}>
                      位置 {i + 1} · {group.map(skillName).join('、') || '无可用技能'}
                    </p>
                  ))}
              </details>
            )}
          </>
        )}
        {!!career?.customSkills.length && (
          <details>
            <summary>自定义技能定义</summary>
            {career.customSkills.map((skill) => (
              <p key={skill.key}>
                <b>{skill.label}</b> · 基础 {skill.base}
                {skill.family && ` · ${COC_SKILL_FAMILIES[skill.family]}`}
                {skill.family && !career.specializationsEnabled && '（专长关闭）'}
              </p>
            ))}
          </details>
        )}
        <b>衍生数值</b>
        <p>
          伤害加值 {derived.db} · 体格 {derived.build} · 移动力 {derived.mov}
        </p>
        {COC_DERIVED_FIELDS.map((field) => {
          const control = investigator?.derived?.[field];
          return (
            control?.mode === 'manual' &&
            control.manual !== null && (
              <p key={field}>
                {derivedLabels[field]} {control.manual}（手动{control.locked ? '并锁定' : ''}
                ，自动值 {derived.automatic[field]}）
              </p>
            )
          );
        })}
        {age && (
          <>
            <b>年龄修正</b>
            <p>
              {age.age} 岁 · {age.mode === 'auto' ? '自动规则' : '手动修正'} ·{' '}
              {COC_ATTRIBUTES.flatMap(({ key, label }) => {
                const change = age.changes[key as keyof typeof age.changes];
                return change ? [`${label} ${signed(change)}`] : [];
              }).join('、') || '属性无变化'}
            </p>
            {age.eduChecks.length > 0 && (
              <p>
                教育成长检定{' '}
                {age.eduChecks.map(({ percentile, gain }) => `${percentile} → +${gain}`).join('、')}
              </p>
            )}
            {age.reason && <p>修正原因 {age.reason}</p>}
          </>
        )}
        {equipment && (equipment.weapons.length > 0 || equipment.armor.length > 0) && (
          <details>
            <summary>武器与防具</summary>
            {equipment.weapons.map((weapon) => {
              const v = cocWeaponValues(card, weapon, { includeTemporary: false });
              const source =
                COC_WEAPON_CATALOG.find((entry) => entry.id === weapon.catalogId)?.source ??
                'custom';
              const overrides = Object.entries(weapon.overrides ?? {}).flatMap(([key, control]) =>
                control?.mode === 'manual' && control.manual !== null
                  ? [
                      `${weaponOverrideLabels[key]} ${key === 'skillKey' ? skillName(String(control.manual)) : control.manual}`,
                    ]
                  : [],
              );
              return (
                <p key={weapon.id}>
                  <b>{v.name}</b> · {COC_CAREER_SOURCE_LABELS[source]} · {skillName(v.skillKey)}{' '}
                  {v.skill}%{' · '}伤害 {v.damageExpression}
                  {v.range > 0 && ` · 射程 ${v.range} 码`}
                  {' · '}每轮 {v.usesPerRound} 次
                  {v.rapidUsesPerRound > v.usesPerRound && ` · 速射 ${v.rapidUsesPerRound} 次`}
                  {v.capacity > 0 &&
                    ` · 装填 ${v.ammo.loaded}/${v.capacity}，备用 ${v.ammo.reserve}`}
                  {v.ammo.jammed && ' · 故障'}
                  {overrides.length > 0 && (
                    <>
                      <br />
                      手动设定 {overrides.join('、')}
                    </>
                  )}
                  {weapon.notes && (
                    <>
                      <br />
                      {weapon.notes}
                    </>
                  )}
                </p>
              );
            })}
            {equipment.armor.map((armor) => {
              const v = cocArmorValues(armor);
              const source =
                COC_ARMOR_CATALOG.find((entry) => entry.id === armor.catalogId)?.source ?? 'custom';
              const manual = Object.values(armor.overrides ?? {}).some(
                (control) => control?.mode === 'manual' && control.manual !== null,
              );
              return (
                <p key={armor.id}>
                  <b>{v.name}</b> · {COC_CAREER_SOURCE_LABELS[source]} · {armorCoverage[v.coverage]}{' '}
                  · 护甲 {v.rating}
                  {v.movPenalty > 0 && ` · MOV −${v.movPenalty}`}
                  {armor.equipped ? ' · 已穿戴' : ' · 未穿戴'}
                  {manual && ' · 含手动设定'}
                </p>
              );
            })}
          </details>
        )}
        {wealth && (
          <details>
            <summary>财产与账目</summary>
            <p>
              {wealth.setting.era === 'custom'
                ? `${wealth.setting.label} · 换算倍率 ${wealth.setting.rate}`
                : wealth.setting.era === '1920s'
                  ? '1920 年代'
                  : '现代'}
              {' · '}
              {wealth.tier.label} · {wealth.currency}
            </p>
            <p>
              当前现金 {wealth.current.cash.toLocaleString()} · 当前资产{' '}
              {wealth.current.assets.toLocaleString()}
              {' · '}日常消费水平 {wealth.reference.spending.toLocaleString()}
              {wealth.ledger.length > 0 && ` · ${wealth.ledger.length} 条流水`}
            </p>
            {COC_WEALTH_FIELDS.map((field) => {
              const control = investigator?.wealth?.controls?.[field];
              const reason = investigator?.wealth?.controlReasons?.[field];
              return (
                control?.mode === 'manual' &&
                control.manual !== null && (
                  <p key={field}>
                    {wealthLabels[field]} {control.manual.toLocaleString()}（手动
                    {reason ? `，${reason}` : ''}）
                  </p>
                )
              );
            })}
          </details>
        )}
        {session && (session.spells.length > 0 || session.tomes.length > 0) && (
          <details>
            <summary>法术与神话书</summary>
            {session.spells.map(({ id, name, source, cost, learned, casting }) => (
              <p key={id}>
                <b>{name}</b> · {source || '自定义法术'} · MP {cost.mp} · HP {cost.hp} · SAN{' '}
                {cost.san}
                {' · '}
                {cost.minutes} 分钟 / {cost.rounds} 轮{' · '}
                {casting === 'mastered' ? '已掌握' : learned ? '已学习' : '尚未学习'}
              </p>
            ))}
            {session.tomes.map((tome) => (
              <p key={tome.id}>
                <b>{tome.name}</b> · 初读 {tome.initialMinutes} 分钟（神话 +{tome.initialMythos}）
                {' · '}研读 {tome.fullMinutes} 分钟（神话 +{tome.fullMythos}）· SAN {tome.sanLoss}
                {tome.spellIds.length > 0 &&
                  ` · 法术 ${tome.spellIds.map((id) => session.spells.find((s) => s.id === id)?.name ?? id).join('、')}`}
              </p>
            ))}
          </details>
        )}
      </div>
    </details>
  );
}

const abilityLabel = (key: string) =>
  DND_ATTRIBUTES.find((attribute) => attribute.key === key)?.label ?? key;
const grantSourceLabel: Record<DndSpellGrant['source'], string> = {
  species: '种族',
  feat: '专长',
  item: '物品',
  class: '职业／子职',
  dm: '主持人',
};
const recoveryLabel: Record<DndResourceRecovery, string> = {
  short: '短休或长休回满',
  long: '长休回满',
  'short-one': '短休回一次，长休回满',
  none: '手动恢复',
};

function MagicAudit({ card, state }: { card: Character; state: DndMagicState }) {
  const edition = getDndEdition(card.dndEdition);
  const catalog = useRuleCatalog(edition, loadMagicCatalog);
  const spells = catalog.data?.edition === edition ? catalog.data.spells : [];
  const names = new Map(
    spells.map((spell) => [spell.id, spell.nameZh || spell.nameEn || spell.id]),
  );
  const profile = getDndMagicProfile(card);
  if (!profile) return null;
  const cantrips = new Set([
    ...state.cantrips,
    ...(profile.requiredCantrip ? [profile.requiredCantrip] : []),
  ]);
  const total = new Set([
    ...cantrips,
    ...state.known,
    ...state.prepared,
    ...state.spellbook,
    ...state.secrets,
    ...state.arcanum,
    ...state.grants.map(({ spellId }) => spellId),
    ...profile.automaticSpells.map(({ spellId }) => spellId),
  ]).size;
  const slotBudget = profile.slots.flatMap((max, index) =>
    max ? [`${index + 1} 环 ${max - state.slotsUsed[index]}/${max}`] : [],
  );
  const selected = [
    profile.cantripLimit > 0 && `戏法 ${cantrips.size}/${profile.cantripLimit}`,
    profile.knownLimit > 0 &&
      `已知 ${state.known.length + state.secrets.length}/${profile.knownLimit}`,
    profile.preparedLimit > 0 && `已准备 ${state.prepared.length}/${profile.preparedLimit}`,
    profile.mode === 'spellbook' && `法术书 ${state.spellbook.length} 道`,
    state.arcanum.length > 0 && `玄奥秘法 ${state.arcanum.length} 道`,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <section className="audit-prose" aria-label="法术与资源审核">
      <b>法术与资源</b>
      <p>
        法术 {total} 道 · 额外授予 {state.grants.length} 项 · 自定义资源{' '}
        {state.customResources.length} 项
      </p>
      {selected && <p>{selected}</p>}
      <p>
        普通法术位 {slotBudget.join(' · ') || '无'}
        {profile.pact &&
          ` · 契约 ${profile.pact.level} 环 ${profile.pact.max - state.pactUsed}/${profile.pact.max}`}
        {profile.hitDie &&
          ` · 生命骰 ${card.level - state.hitDiceUsed}/${card.level}d${profile.hitDie}`}
      </p>
      {state.grants.length > 0 && (
        <>
          <b>额外法术授权</b>
          {state.grants.some((grant) => !names.has(grant.spellId)) && (
            <p className="subtle-note">
              {catalog.error || catalog.data
                ? '以下部分法术只能显示编号，当前无法从目录确认其名称与规则。'
                : '正在读取本版法术目录，待名称载入后核对额外授予。'}
            </p>
          )}
          {state.grants.map((grant) => {
            const methods = [
              grant.allowSlots && '可用法术位',
              grant.allowRitual && '可作仪式',
              grant.free &&
                (grant.free.max === null
                  ? '可随意施展'
                  : `不耗位 ${grant.free.max - grant.free.used}/${grant.free.max} 次，${recoveryLabel[grant.free.recovery]}`),
            ].filter(Boolean);
            const stats = [
              (grant.ability ?? profile.ability) &&
                `施法属性 ${abilityLabel((grant.ability ?? profile.ability)!)}`,
              grant.attackBonus !== undefined && `固定法术攻击 ${signed(grant.attackBonus)}`,
              grant.saveDc !== undefined && `固定豁免 DC ${grant.saveDc}`,
            ].filter(Boolean);
            return (
              <p key={grant.id}>
                <b>{names.get(grant.spellId) ?? grant.spellId}</b>
                {' · '}
                {grantSourceLabel[grant.source]} · {grant.label}
                <br />
                {[...methods, ...stats].join(' · ')}
              </p>
            );
          })}
        </>
      )}
      {state.customResources.length > 0 && (
        <>
          <b>自定义资源</b>
          {state.customResources.map((resource) => (
            <p key={resource.id}>
              {resource.name} · 剩余 {resource.max - resource.used}/{resource.max} ·{' '}
              {recoveryLabel[resource.recovery]}
            </p>
          ))}
        </>
      )}
    </section>
  );
}

const trainingLabels: Record<string, string> = {
  'armor:light': '轻甲',
  'armor:medium': '中甲',
  'armor:heavy': '重甲',
  'armor:shield': '盾牌',
  'weapon:simple': '简易武器',
  'weapon:martial': '军用武器',
};

function EquipmentAudit({
  card,
  state,
  ac,
}: {
  card: Character;
  state: DndEquipmentState;
  ac: number;
}) {
  const edition = getDndEdition(card.dndEdition);
  const catalog = useRuleCatalog(edition, loadEquipmentCatalog);
  const items = catalog.data?.edition === edition ? catalog.data.items : [];
  const names = new Map(items.map((item) => [item.id, item.name]));
  const equipmentName = (item: Item) => {
    const catalogId = item.equipment?.catalogId ?? '';
    const base = names.get(catalogId) ?? catalogId;
    return base && item.name !== base ? `${item.name}（${base}）` : item.name;
  };
  const equipped = card.items.filter((item) => item.quantity > 0 && item.equipment?.equipped);
  const armor = equipped.find((item) => item.equipment?.armor);
  const armorRule = armor?.equipment?.armor;
  const shield = equipped.find((item) => item.equipment?.shield);
  const shieldEligible = edition === '2014' || hasDndArmorTraining(card, 'shield');
  let formula = '10 + 敏捷调整值';
  if (armor && armorRule) {
    const dex = armorRule.addsDex
      ? ` + 敏捷调整值${armorRule.dexCap === null ? '' : `（上限 ${armorRule.dexCap}）`}`
      : '';
    formula = `${equipmentName(armor)} ${armorRule.baseAC ?? '基础 AC 待核对'}${dex}`;
  } else if (state.armorMode === 'barbarian') formula += ' + 体质调整值';
  else if (state.armorMode === 'monk' && !shield) formula += ' + 感知调整值';
  if (shield && shieldEligible)
    formula += ` + ${equipmentName(shield)} ${shield.equipment?.shield?.bonusAC ?? '待核对'}`;
  if (state.acBonus) formula += ` · 角色 AC 修正 ${signed(state.acBonus)}`;
  const gearBonus = equipped.reduce((sum, item) => {
    const gear = item.equipment!;
    return (
      sum +
      ((!gear.requiresAttunement || gear.attuned) && (!gear.shield || shieldEligible)
        ? gear.acBonus
        : 0)
    );
  }, 0);
  if (gearBonus) formula += ` · 装备 AC 修正 ${signed(gearBonus)}`;
  if (state.armorMode === 'manual') formula = `使用手填 AC ${card.ac}`;

  const specialGear = card.items.flatMap((item) => {
    const gear = item.equipment;
    return gear &&
      (gear.bonusSource ||
        gear.attackBonus ||
        gear.damageBonus ||
        gear.acBonus ||
        gear.ability !== 'auto' ||
        gear.requiresAttunement)
      ? [{ item, gear }]
      : [];
  });
  const extraTraining = state.extraProficiencies.map((entry) => {
    const catalogId = entry.startsWith('weapon:') ? entry.slice(7) : '';
    const label = Object.hasOwn(trainingLabels, entry)
      ? trainingLabels[entry]
      : names.get(catalogId);
    return { entry, label };
  });
  const defense = state.armorMode === 'manual' ? [] : [armor, shieldEligible ? shield : undefined];
  const unverified =
    [...defense, ...specialGear.map(({ item }) => item)].some(
      (item) => item?.equipment && !names.has(item.equipment.catalogId),
    ) || extraTraining.some(({ label }) => !label);
  const settings = [
    state.acBonus !== 0 && `角色 AC ${signed(state.acBonus)}`,
    state.capacityMultiplier !== 1 && `负重容量倍率 ${state.capacityMultiplier}`,
    state.attunementLimit !== 3 && `同调上限 ${state.attunementLimit} 件`,
  ].filter(Boolean);

  return (
    <section className="audit-prose" aria-label="装备联动审核">
      <b>装备联动</b>
      <p>
        生效 AC {ac} · {formula}
      </p>
      {settings.length > 0 && <p>额外设定 · {settings.join(' · ')}</p>}
      {extraTraining.length > 0 && (
        <p>额外装备熟练 · {extraTraining.map(({ entry, label }) => label ?? entry).join('、')}</p>
      )}
      {state.sourceNotes && <p>设定与熟练来源 · {state.sourceNotes}</p>}
      {unverified && (
        <p className="subtle-note">
          {catalog.error || catalog.data
            ? '以下部分装备只能以编号核对，当前无法从目录确认名称。'
            : '正在读取本版装备目录。'}
        </p>
      )}
      {specialGear.length > 0 && <b>装备特殊加值与同调</b>}
      {specialGear.map(({ item, gear }) => {
        const traits = [
          gear.attackBonus !== 0 && `攻击 ${signed(gear.attackBonus)}`,
          gear.damageBonus !== 0 && `伤害 ${signed(gear.damageBonus)}`,
          gear.acBonus !== 0 && `AC ${signed(gear.acBonus)}`,
          gear.ability !== 'auto' && `使用${abilityLabel(gear.ability)}攻击`,
          gear.requiresAttunement && (gear.attuned ? '已同调' : '需同调，尚未同调'),
        ].filter(Boolean);
        return (
          <p key={item.id}>
            <b>{equipmentName(item)}</b> · {gear.equipped ? '已装备' : '未装备'}
            {traits.length > 0 && (
              <>
                <br />
                {traits.join(' · ')}
              </>
            )}
            {gear.bonusSource && (
              <>
                <br />
                来源 · {gear.bonusSource}
              </>
            )}
          </p>
        );
      })}
    </section>
  );
}

function PolicyEditor({
  room,
  isHost,
  run,
}: {
  room: Room;
  isHost: boolean;
  run: (a: RoomAction) => Promise<boolean>;
}) {
  const [policy, setPolicy] = useState<CreationPolicy>(() => structuredClone(room.creationPolicy));
  const [revision, setRevision] = useState(room.policyRevision);
  const [occupationText, setOccupationText] = useState(
    room.creationPolicy.allowedOccupations.join('、'),
  );
  const [ancestryText, setAncestryText] = useState(
    room.creationPolicy.allowedAncestries.join('、'),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const editable = isHost && room.phase === 'lobby';
  const p = isHost ? policy : room.creationPolicy;
  const fields = policyFields(room.rule);
  if (room.rule === 'coc') {
    const seen = new Set(fields.map(({ key }) => key));
    for (const member of room.members) {
      for (const skill of member.character?.cocCareer?.customSkills ?? []) {
        const key = `skills.${skill.key}`;
        if (seen.has(key)) continue;
        fields.push({ key, label: `${skill.label}（自定义技能）` });
        seen.add(key);
      }
    }
    for (const range of p.ranges) {
      if (!seen.has(range.field))
        fields.push({ key: range.field, label: `${range.field.slice(7)}（自定义技能）` });
    }
  }
  const patch = (values: Partial<CreationPolicy>) => setPolicy((old) => ({ ...old, ...values }));
  const save = async () => {
    const parsed = CreationPolicySchema.safeParse(policy);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('；'));
      return;
    }
    setBusy(true);
    setError('');
    if (await run({ type: 'creation-policy', policy: parsed.data, expectedRevision: revision }))
      setRevision(revision + 1);
    setBusy(false);
  };
  return (
    <div className="policy-editor">
      <div className="helper-callout">
        <ShieldCheck size={21} />
        <p>
          这里的限制叠加在基础分配规则之上。保存新限制会撤销所有玩家的旧审核与准备状态；单项范围优先于通用技能上限。
        </p>
      </div>
      {isHost && revision !== room.policyRevision && (
        <div className="inline-error" role="alert">
          限制已在另一处更新，请先读取最新版本。
          <button
            className="text-button"
            onClick={() => {
              setPolicy(structuredClone(room.creationPolicy));
              setOccupationText(room.creationPolicy.allowedOccupations.join('、'));
              setAncestryText(room.creationPolicy.allowedAncestries.join('、'));
              setRevision(room.policyRevision);
            }}
          >
            读取最新限制
          </button>
        </div>
      )}
      <fieldset disabled={!editable}>
        {room.rule === 'coc' ? (
          <div className="policy-basics">
            <label className="field">
              通用技能上限
              <input
                aria-label="通用技能上限"
                type="number"
                min={1}
                max={99}
                value={p.cocSkillCap}
                onChange={(e) => patch({ cocSkillCap: Number(e.target.value) })}
              />
              <small>99 为默认值，75 等限制属于本桌约定。</small>
            </label>
            <div className="policy-checkboxes">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={p.allowInterestOnOccupation !== false}
                  onChange={(e) => patch({ allowInterestOnOccupation: e.target.checked })}
                />
                允许兴趣点投入职业技能（含信用评级）
              </label>
              <p className="subtle-note">
                关闭后专点专用：职业点用于职业技能，兴趣点只用于其他技能。已有投入需由玩家退回后重分配。
              </p>

              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={p.requireAllPoints}
                  onChange={(e) => patch({ requireAllPoints: e.target.checked })}
                />
                必须用完职业点与兴趣点
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={p.allowMythos}
                  onChange={(e) => patch({ allowMythos: e.target.checked })}
                />
                允许初始克苏鲁神话（仍消耗兴趣点）
              </label>
            </div>
          </div>
        ) : (
          <div className="form-grid">
            <label className="field">
              额外技能熟练名额
              <input
                type="number"
                min={0}
                max={18}
                value={p.dndExtraSkills}
                onChange={(e) => patch({ dndExtraSkills: Number(e.target.value) })}
              />
              <small>用于审核通过的专长、兼职与职业特性。</small>
            </label>
            <label className="field">
              额外豁免熟练名额
              <input
                type="number"
                min={0}
                max={6}
                value={p.dndExtraSaves}
                onChange={(e) => patch({ dndExtraSaves: Number(e.target.value) })}
              />
            </label>
          </div>
        )}
        <div className="policy-section-heading">
          <div>
            <h3>单项数值范围</h3>
            <p>可以限定属性、总和、技能、资源，以及年龄或等级。</p>
          </div>
          {editable && (
            <button
              className="button secondary compact"
              onClick={() => {
                const key = fields.find((f) => !p.ranges.some((r) => r.field === f.key))?.key;
                if (key)
                  patch({
                    ranges: [
                      ...p.ranges,
                      { field: key, min: 1, max: room.rule === 'dnd' ? 20 : 99 },
                    ],
                  });
              }}
            >
              <Plus size={14} />
              新增范围
            </button>
          )}
        </div>
        <div className="policy-ranges">
          {p.ranges.map((range, i) => (
            <div className="policy-range" key={i}>
              <label className="field">
                限制项目
                <select
                  aria-label={`限制项目 ${i + 1}`}
                  value={range.field}
                  onChange={(e) =>
                    patch({
                      ranges: p.ranges.map((r, n) =>
                        n === i ? { ...r, field: e.target.value } : r,
                      ),
                    })
                  }
                >
                  {fields
                    .filter(
                      (f) => f.key === range.field || !p.ranges.some((r) => r.field === f.key),
                    )
                    .map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                下限
                <input
                  aria-label={`下限 ${i + 1}`}
                  type="number"
                  value={range.min}
                  onChange={(e) =>
                    patch({
                      ranges: p.ranges.map((r, n) =>
                        n === i ? { ...r, min: Number(e.target.value) } : r,
                      ),
                    })
                  }
                />
              </label>
              <span>—</span>
              <label className="field">
                上限
                <input
                  aria-label={`上限 ${i + 1}`}
                  type="number"
                  value={range.max}
                  onChange={(e) =>
                    patch({
                      ranges: p.ranges.map((r, n) =>
                        n === i ? { ...r, max: Number(e.target.value) } : r,
                      ),
                    })
                  }
                />
              </label>
              {editable && (
                <button
                  className="icon-button"
                  aria-label={`移除范围 ${i + 1}`}
                  onClick={() => patch({ ranges: p.ranges.filter((_, n) => n !== i) })}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
          {!p.ranges.length && (
            <p className="subtle-note">
              尚无额外范围。仍遵守基础分配、职业信用区间及默认属性范围（D&D 1–20，CoC 1–99）。
            </p>
          )}
        </div>
        <div className="form-grid">
          <label className="field">
            允许的职业
            <textarea
              rows={2}
              aria-label="允许的职业"
              value={isHost ? occupationText : p.allowedOccupations.join('、')}
              placeholder="留空表示不额外限制，用顿号分隔"
              onChange={(e) => {
                setOccupationText(e.target.value);
                patch({
                  allowedOccupations: e.target.value
                    .split(/[、,，\n]/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                });
              }}
            />
          </label>
          <label className="field">
            {room.rule === 'dnd' ? '允许的种族' : '允许的国籍／出生地'}
            <textarea
              rows={2}
              aria-label={room.rule === 'dnd' ? '允许的种族' : '允许的国籍／出生地'}
              value={isHost ? ancestryText : p.allowedAncestries.join('、')}
              placeholder="留空表示不额外限制，用顿号分隔"
              onChange={(e) => {
                setAncestryText(e.target.value);
                patch({
                  allowedAncestries: e.target.value
                    .split(/[、,，\n]/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                });
              }}
            />
          </label>
        </div>
        <label className="field">
          剧本制卡说明
          <textarea
            rows={3}
            maxLength={2000}
            aria-label="剧本制卡说明"
            value={p.notes}
            placeholder="说明时代、人物关系、装备来源等需要人工审核的内容。"
            onChange={(e) => patch({ notes: e.target.value })}
          />
        </label>
      </fieldset>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      {isHost && (
        <div className="review-actions">
          <button
            className="button secondary"
            disabled={!editable || busy}
            onClick={() => {
              setPolicy(defaultCreationPolicy(room.rule));
              setOccupationText('');
              setAncestryText('');
            }}
          >
            恢复默认设置
          </button>
          <button
            className="button primary"
            disabled={!editable || busy || revision !== room.policyRevision}
            onClick={() => void save()}
          >
            {busy ? <Spinner /> : <Check size={17} />}保存限制并重新审核
          </button>
        </div>
      )}
      {!editable && isHost && <p className="subtle-note">请先返回准备阶段，再修改限制。</p>}
    </div>
  );
}
