import { z } from 'zod';
import { DndStatBlockSchema, type DndStatBlock } from './dnd';
import { DndEditionSchema, getDndEdition, type DndEdition } from './dnd-edition';
import { KeeperCardSchema, type KeeperCard } from './keeper';
import { rollDice, type DieRandom } from './rules';
import { effectiveCharacter } from './adjustments';
import type { CheckResult, Edge, Member, RuleId } from './types';
import { damageInjury, healInjury, HpConfirmationSchema, InjuryChecksSchema } from './injury';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const score = z.number().int().min(0).max(100000).nullable();
const order = z.number().int().min(-200).max(100100).nullable();
const edge = z.enum(['normal', 'advantage', 'disadvantage']);
const revision = z.number().int().min(0).max(1000000000);
const visibility = z.enum(['public', 'host']);
const initiativeBonus = z.number().int().min(-100).max(100);
const expression = z.string().trim().min(1).max(120);
const armor = z.number().int().min(0).max(100000);
const damageAdjustment = z.enum([
  'normal',
  'resistant',
  'vulnerable',
  'immune',
  'resistant-vulnerable',
]);
const command = { expectedRevision: revision, requestId: id };

function initiativeEdge(requestedEdge: Edge, edition: DndEdition, surprised: boolean): Edge {
  if (edition === '2024' && surprised)
    return requestedEdge === 'advantage' ? 'normal' : 'disadvantage';
  return requestedEdge;
}

function selectInitiativeDie(rolls: number[], edge: Edge): number {
  if (edge === 'advantage') return Math.max(...rolls);
  if (edge === 'disadvantage') return Math.min(...rolls);
  return rolls[0];
}

const initiativeRollSchema = z
  .object({
    rolls: z.array(z.number().int().min(1).max(20)).min(1).max(2),
    selected: z.number().int().min(1).max(20),
    dexModifier: z.number().int().min(-5).max(49995),
    bonus: initiativeBonus,
    edge,
    requestedEdge: edge,
    edition: DndEditionSchema,
    surprised: z.boolean(),
  })
  .strict()
  .refine(
    (roll) =>
      roll.edge === initiativeEdge(roll.requestedEdge, roll.edition, roll.surprised) &&
      roll.rolls.length === (roll.edge === 'normal' ? 1 : 2) &&
      roll.selected === selectInitiativeDie(roll.rolls, roll.edge),
    '先攻骰记录与投掷方式不一致',
  );

type InitiativeRoll = z.infer<typeof initiativeRollSchema>;
export type DamageAdjustment = z.infer<typeof damageAdjustment>;
const resourceSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(120),
    maxUses: z.number().int().min(1).max(100000),
    remaining: z.number().int().min(0).max(100000),
    recharge: z.string().max(200),
  })
  .strict()
  .refine((r) => r.remaining <= r.maxUses, '剩余次数不能超过上限');

export const CombatantSchema = z
  .object({
    id,
    memberId: id.nullable(),
    ownerMemberId: id.optional(),
    sourceCardId: id.nullable(),
    source: z.union([KeeperCardSchema, DndStatBlockSchema]).nullable(),
    rule: z.enum(['dnd', 'coc']),
    kind: z.enum(['player', 'npc', 'monster']),
    name: z.string().trim().min(1).max(120),
    publicName: z.string().trim().min(1).max(60),
    revealed: z.boolean(),
    dex: score,
    initiative: order,
    initiativeOverride: order,
    initiativeRoll: initiativeRollSchema.optional(),
    surprised: z.boolean().optional(),
    hp: score,
    maxHp: score,
    ac: z.number().int().min(0).max(100).nullable(),
    tempHp: z.number().int().min(0).max(100000),
    conditions: z.array(z.string().trim().min(1).max(60)).max(20),
    concentration: z.string().max(200),
    deathSuccesses: z.number().int().min(0).max(3),
    deathFailures: z.number().int().min(0).max(3),
    stable: z.boolean(),
    majorWound: z.boolean(),
    dying: z.boolean(),
    dead: z.boolean().optional(),
    unconscious: z.boolean().optional(),
    deathSaveMode: z.enum(['character', 'instant']).optional(),
    injuryChecks: InjuryChecksSchema.optional(),
    firearmReady: z.boolean(),
    notes: z.string().max(4000),
    abilities: z.array(resourceSchema).max(201),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.hp !== null && c.maxHp !== null && c.hp > c.maxHp)
      ctx.addIssue({ code: 'custom', path: ['hp'], message: 'HP 不能超过已知上限' });
    if (new Set(c.abilities.map((a) => a.id)).size !== c.abilities.length)
      ctx.addIssue({ code: 'custom', path: ['abilities'], message: '能力编号重复' });
    if (new Set(c.conditions).size !== c.conditions.length)
      ctx.addIssue({ code: 'custom', path: ['conditions'], message: '状态重复' });
    if ((c.kind === 'player') !== (c.memberId !== null))
      ctx.addIssue({ code: 'custom', message: '玩家与成员引用不匹配' });
    if (
      c.source &&
      (c.source.rule !== c.rule || c.source.id !== c.sourceCardId || c.source.kind !== c.kind)
    )
      ctx.addIssue({ code: 'custom', message: '资料快照与参战者不匹配' });
    if (c.kind === 'player' && (c.source !== null || c.sourceCardId !== null))
      ctx.addIssue({ code: 'custom', message: '玩家不能使用怪物资料快照' });
    if (c.ownerMemberId !== undefined && (c.kind === 'player' || c.rule !== 'dnd'))
      ctx.addIssue({ code: 'custom', message: '只有 D&D NPC／怪物可以分配伙伴归属' });
    if (c.rule !== 'dnd' && (c.initiativeRoll || c.surprised !== undefined))
      ctx.addIssue({ code: 'custom', message: '先攻骰与突袭标记仅适用于 D&D' });
  });
export type Combatant = z.infer<typeof CombatantSchema>;
export type EncounterResource = Combatant['abilities'][number];

export const EncounterSchema = z
  .object({
    participants: z.array(CombatantSchema).max(60),
    activeId: id.nullable(),
    round: z.number().int().min(0).max(100000),
    revision,
    autoDamage: z.boolean().optional(),
    autoLifeChecks: z.boolean().optional(),
    loadedWaves: z
      .array(z.strictObject({ planId: id, waveId: id }))
      .max(1000)
      .optional(),
    slotSpentMemberIds: z.array(id).max(8).optional(),
  })
  .strict()
  .superRefine((state, ctx) => {
    const ids = new Set(state.participants.map((c) => c.id));
    if (ids.size !== state.participants.length)
      ctx.addIssue({ code: 'custom', message: '参战者编号重复' });
    const members = state.participants.flatMap((c) => (c.memberId ? [c.memberId] : []));
    if (new Set(members).size !== members.length)
      ctx.addIssue({ code: 'custom', message: '玩家重复参战' });
    if (state.activeId !== null && !ids.has(state.activeId))
      ctx.addIssue({ code: 'custom', path: ['activeId'], message: '当前回合引用不存在的参战者' });
    const playerIds = new Set(members);
    if (state.participants.some((c) => c.ownerMemberId && !playerIds.has(c.ownerMemberId)))
      ctx.addIssue({ code: 'custom', message: '伙伴归属引用不存在的玩家' });
    const slots = state.slotSpentMemberIds ?? [];
    if (
      (slots.length && state.activeId === null) ||
      new Set(slots).size !== slots.length ||
      slots.some((memberId) => !playerIds.has(memberId))
    )
      ctx.addIssue({ code: 'custom', message: '当回合法术位记录与参战者不匹配' });
    const waves = state.loadedWaves ?? [];
    if (new Set(waves.map(({ planId, waveId }) => `${planId}/${waveId}`)).size !== waves.length)
      ctx.addIssue({ code: 'custom', message: '重复的已加载波次' });
  });
export type EncounterState = z.infer<typeof EncounterSchema>;
export const CombatantPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    publicName: z.string().trim().min(1).max(60).optional(),
    revealed: z.boolean().optional(),
    dex: score.optional(),
    initiativeOverride: order.optional(),
    surprised: z.boolean().optional(),
    hp: score.optional(),
    maxHp: score.optional(),
    tempHp: z.number().int().min(0).max(100000).optional(),
    conditions: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
    concentration: z.string().max(200).optional(),
    deathSuccesses: z.number().int().min(0).max(3).optional(),
    deathFailures: z.number().int().min(0).max(3).optional(),
    stable: z.boolean().optional(),
    majorWound: z.boolean().optional(),
    dying: z.boolean().optional(),
    dead: z.boolean().optional(),
    unconscious: z.boolean().optional(),
    deathSaveMode: z.enum(['character', 'instant']).optional(),
    firearmReady: z.boolean().optional(),
    notes: z.string().max(4000).optional(),
    abilities: z.array(resourceSchema).max(201).optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, '没有要更新的内容');
export type CombatantPatch = z.infer<typeof CombatantPatchSchema>;

export const EncounterActionSchemas = [
  z
    .object({
      type: z.literal('encounter-add'),
      cardId: id,
      count: z.number().int().min(1).max(20),
    })
    .strict(),
  z
    .object({
      type: z.literal('encounter-update'),
      combatantId: id,
      patch: CombatantPatchSchema,
      expectedRevision: revision,
      hpConfirmation: HpConfirmationSchema.optional(),
    })
    .strict(),
  z.object({ type: z.literal('encounter-remove'), combatantId: id }).strict(),
  z.object({ type: z.literal('encounter-clear') }).strict(),
  z.strictObject({
    type: z.literal('encounter-companion'),
    combatantId: id,
    ownerMemberId: id.nullable(),
    expectedRevision: revision,
  }),
  z.strictObject({
    type: z.literal('encounter-companion-hp'),
    combatantId: id,
    hp: armor,
    hpConfirmation: HpConfirmationSchema.optional(),
    ...command,
  }),
  z
    .object({
      type: z.literal('initiative'),
      expectedRevision: revision.optional(),
      fillMissing: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('encounter-settings'),
      autoDamage: z.boolean(),
      autoLifeChecks: z.boolean().optional(),
      expectedRevision: revision,
    })
    .strict(),
  z.strictObject({
    type: z.literal('encounter-life-check'),
    combatantId: id,
    kind: z.enum(['death', 'constitution']),
    modifier: z.number().int().min(-100).max(100).default(0),
    edge: edge.default('normal'),
    visibility,
    ...command,
  }),
  z.strictObject({
    type: z.literal('encounter-life-care'),
    combatantId: id,
    kind: z.enum(['stabilize', 'first-aid', 'medicine', 'revive']),
    conditionsConfirmed: z.literal(true),
    ...command,
  }),
  z
    .object({
      type: z.literal('encounter-initiative-roll'),
      combatantId: id,
      edge,
      bonus: initiativeBonus,
      ...command,
    })
    .strict(),
  z
    .object({
      type: z.literal('encounter-damage'),
      targetId: id,
      expression,
      adjustment: damageAdjustment.optional(),
      armorOverride: armor.optional(),
      visibility,
      ...command,
    })
    .strict(),
  z
    .object({
      type: z.literal('encounter-dnd-attack'),
      attackerId: id,
      targetId: id,
      modifier: z.number().int().min(-100).max(100).optional(),
      weaponId: id.optional(),
      weaponMode: z.enum(['normal', 'light-extra']).optional(),
      lightExtraConfirmed: z.literal(true).optional(),
      ammoItemId: id.optional(),
      ammoConfirmed: z.literal(true).optional(),
      expectedCharacterRevision: z
        .number()
        .int()
        .min(0)
        .max(Number.MAX_SAFE_INTEGER - 1)
        .optional(),
      edge,
      damage: z
        .strictObject({
          expression: expression.optional(),
          adjustment: damageAdjustment.optional(),
        })
        .optional(),
      visibility,
      ...command,
    })
    .strict()
    .refine(
      (attack) =>
        attack.weaponId !== undefined
          ? attack.expectedCharacterRevision !== undefined
          : attack.modifier !== undefined &&
            (!attack.damage || attack.damage.expression !== undefined) &&
            attack.weaponMode === undefined &&
            attack.ammoItemId === undefined &&
            attack.ammoConfirmed === undefined &&
            attack.lightExtraConfirmed === undefined,
      '武器攻击须提供角色修订号，手填攻击须提供加值和所选伤害式',
    )
    .refine(
      (attack) => attack.weaponMode !== 'light-extra' || attack.lightExtraConfirmed === true,
      '主持人须确认已满足轻型武器额外攻击条件',
    ),
  z
    .object({
      type: z.literal('coc-melee'),
      attacker: z.string().trim().min(1).max(60),
      defender: z.string().trim().min(1).max(60),
      attackSkill: z.number().int().min(0).max(100000),
      defenseSkill: z.number().int().min(0).max(100000),
      defense: z.enum(['dodge', 'fight-back']),
      attackEdge: edge,
      defenseEdge: edge,
      visibility,
      damage: z
        .object({
          attackerId: id,
          defenderId: id,
          attackExpression: expression,
          attackExtremeExpression: expression.optional(),
          fightBackExpression: expression.optional(),
          attackArmorOverride: armor.optional(),
          fightBackArmorOverride: armor.optional(),
          ...command,
        })
        .strict()
        .optional(),
    })
    .strict(),
] as const;
export type EncounterAction = z.infer<(typeof EncounterActionSchemas)[number]>;
export const emptyEncounter = (): EncounterState => ({
  participants: [],
  activeId: null,
  round: 0,
  revision: 0,
});

function updated(
  state: EncounterState,
  participants: Combatant[],
  activeId = state.activeId,
  round = state.round,
): EncounterState {
  return EncounterSchema.parse({
    ...state,
    participants,
    activeId,
    round,
    ...(state.slotSpentMemberIds && (activeId !== state.activeId || round !== state.round)
      ? { slotSpentMemberIds: [] }
      : {}),
    revision: state.revision + 1,
  });
}

function turnRoster(state: EncounterState): Combatant[] {
  if (state.participants.every((p) => p.initiative === null)) return state.participants;
  return state.participants.filter((p) => p.initiative !== null || p.id === state.activeId);
}

function survivingTurn(
  state: EncounterState,
  next: Combatant[],
): { activeId: string | null; round: number } {
  if (!next.length) return { activeId: null, round: 0 };
  if (!state.activeId || next.some((p) => p.id === state.activeId))
    return { activeId: state.activeId, round: state.round };
  const ordered = turnRoster(state);
  const index = ordered.findIndex((p) => p.id === state.activeId);
  for (let offset = 1; offset < ordered.length; offset++) {
    const nextIndex = (index + offset) % ordered.length;
    const candidate = ordered[nextIndex];
    if (next.some((p) => p.id === candidate.id))
      return {
        activeId: candidate.id,
        round: state.round + (state.round > 0 && index + offset >= ordered.length ? 1 : 0),
      };
  }
  return { activeId: null, round: 0 };
}

const base = (rule: RuleId) => ({
  rule,
  initiative: null,
  initiativeOverride: null,
  tempHp: 0,
  conditions: [],
  concentration: '',
  deathSuccesses: 0,
  deathFailures: 0,
  stable: false,
  majorWound: false,
  dying: false,
  firearmReady: false,
  notes: '',
  abilities: [],
});

/** Instances keep their own snapshot, so template edits and deletions never change a running scene. */
export function addEncounterCards(
  state: EncounterState,
  cards: (KeeperCard | DndStatBlock)[],
  count: number,
): EncounterState {
  return addEncounterGroups(
    state,
    cards.map((card) => ({ card, count })),
  );
}

type EncounterCardGroup = { card: KeeperCard | DndStatBlock; count: number };

function addEncounterGroups(state: EncounterState, groups: EncounterCardGroup[]): EncounterState {
  if (
    !groups.length ||
    groups.some(({ count }) => !Number.isInteger(count) || count < 1 || count > 20)
  )
    throw new Error('每次从一份资料生成 1–20 个参战者');
  if (state.participants.length + groups.reduce((size, group) => size + group.count, 0) > 60)
    throw new Error('每场最多 60 个参战者');
  const next = [...state.participants];
  for (const { card: raw, count } of groups) {
    const card = raw.rule === 'coc' ? KeeperCardSchema.parse(raw) : DndStatBlockSchema.parse(raw);
    for (let i = 0; i < count; i++) {
      const sibling = next.filter((p) => p.sourceCardId === card.id).length + 1;
      const instance: Combatant = {
        ...base(card.rule),
        id: crypto.randomUUID(),
        kind: card.kind,
        memberId: null,
        sourceCardId: card.id,
        source: structuredClone(card),
        name: `${card.name} · ${sibling}`.slice(0, 120),
        publicName: `${card.kind === 'npc' ? '人物' : '生物'} ${next.filter((p) => p.kind !== 'player').length + 1}`,
        revealed: false,
        dex: card.attributes.dex,
        hp: card.hp,
        maxHp: card.maxHp,
        ac: card.rule === 'dnd' ? card.ac : null,
      };
      if (card.rule === 'dnd') {
        instance.abilities = [
          ...card.traits,
          ...card.actions,
          ...card.reactions,
          ...card.legendaryActions,
        ]
          .filter((a) => a.uses !== null || a.recharge.trim())
          .map((a) => ({
            id: crypto.randomUUID(),
            name: a.name,
            maxUses: a.uses ?? 1,
            remaining: a.uses ?? 1,
            recharge: a.recharge,
          }))
          .filter((a) => a.maxUses > 0);
        if (card.legendaryActionCount && card.legendaryActionCount > 0)
          instance.abilities.push({
            id: crypto.randomUUID(),
            name: '传奇动作点数',
            maxUses: card.legendaryActionCount,
            remaining: card.legendaryActionCount,
            recharge: '自己回合开始时恢复（主持人确认）',
          });
      }
      next.push(CombatantSchema.parse(instance));
    }
  }
  return updated(state, next);
}

export function loadEncounterWave(
  state: EncounterState,
  planId: string,
  wave: { id: string; entries: EncounterCardGroup[] },
  repeat: boolean,
): EncounterState {
  const loadedWaves = state.loadedWaves ?? [];
  const alreadyLoaded = loadedWaves.some(
    (entry) => entry.planId === planId && entry.waveId === wave.id,
  );
  if (alreadyLoaded && !repeat) throw new Error('这一波已加入本场，如需再加入请明确确认');
  return addEncounterGroups(
    {
      ...state,
      loadedWaves: alreadyLoaded ? loadedWaves : [...loadedWaves, { planId, waveId: wave.id }],
    },
    wave.entries,
  );
}

/** Characters remain the single source of player HP; their encounter-only notes/counters survive refreshes. */
export function syncEncounterPlayers(state: EncounterState, members: Member[]): EncounterState {
  const players = members.filter((m) => m.role === 'player' && m.character);
  const ids = new Set(players.map((m) => m.id));
  const next = state.participants
    .filter((p) => p.memberId === null || ids.has(p.memberId))
    .map((p) => {
      if (!p.ownerMemberId || ids.has(p.ownerMemberId)) return p;
      const { ownerMemberId: _formerOwner, ...unassigned } = p;
      return unassigned;
    });
  for (const member of players) {
    const card = effectiveCharacter(member.character!);
    const index = next.findIndex((p) => p.memberId === member.id);
    const previous = index >= 0 ? next[index] : undefined;
    const player: Combatant = {
      ...(previous ?? base(card.rule)),
      id: member.id,
      kind: 'player',
      rule: card.rule,
      memberId: member.id,
      sourceCardId: null,
      source: null,
      name: (card.name || member.name).slice(0, 120),
      publicName: (card.name || member.name).slice(0, 60),
      revealed: true,
      dex: card.attributes.dex,
      hp: card.hp,
      maxHp: card.maxHp,
      ac: card.rule === 'dnd' ? card.ac : null,
      concentration: card.dndMagic
        ? (card.dndMagic.concentration ?? '')
        : (previous?.concentration ?? ''),
    };
    if (previous?.hp !== null && previous && card.hp > previous.hp)
      Object.assign(player, healInjury({ ...player, hp: previous.hp }, card.hp));
    if (index >= 0) next[index] = player;
    else next.push(player);
  }
  if (JSON.stringify(next) === JSON.stringify(state.participants)) return state;
  const turn = survivingTurn(state, next);
  return updated(
    {
      ...state,
      ...(state.slotSpentMemberIds
        ? { slotSpentMemberIds: state.slotSpentMemberIds.filter((id) => ids.has(id)) }
        : {}),
    },
    next,
    turn.activeId,
    turn.round,
  );
}

export function orderEncounter(
  state: EncounterState,
  rule: RuleId,
  rng?: DieRandom,
  options: { dndEdition?: DndEdition; fillMissing?: boolean } = {},
): EncounterState {
  if (!state.participants.length) throw new Error('先加入玩家角色或 NPC／怪物');
  for (const c of state.participants) {
    if (c.rule !== rule) throw new Error('参战者规则与房间不一致');
    if (
      c.initiativeOverride !== null ||
      (rule === 'dnd' && (c.initiativeRoll || c.initiative !== null))
    )
      continue;
    if (c.dex === null) throw new Error(`${c.name} 缺少敏捷，请先补充或手填行动值`);
    if (rule === 'dnd' && options.fillMissing === false)
      throw new Error(`${c.name} 尚未掷先攻，请先掷骰或手填行动值`);
  }
  const edition = getDndEdition(options.dndEdition);
  const next = state.participants
    .map((c) => {
      if (rule === 'coc')
        return { ...c, initiative: c.initiativeOverride ?? c.dex! + (c.firearmReady ? 50 : 0) };
      const rolled =
        c.initiativeRoll ??
        (c.initiativeOverride === null && c.initiative === null
          ? rollInitiative(c, 'normal', 0, edition, rng)
          : undefined);
      return {
        ...c,
        ...(rolled ? { initiativeRoll: rolled } : {}),
        ...(edition === '2024' && c.surprised ? { surprised: false } : {}),
        initiative: c.initiativeOverride ?? (rolled ? initiativeTotal(rolled) : c.initiative!),
      };
    })
    .sort((a, b) => b.initiative - a.initiative);
  if (rule === 'coc') return updated(state, next, next[0].id, 1);
  return updated(state, next, state.activeId ?? next[0].id, Math.max(state.round, 1));
}

function initiativeTotal(roll: InitiativeRoll): number {
  return roll.selected + roll.dexModifier + roll.bonus;
}

function rollInitiative(
  c: Combatant,
  requestedEdge: Edge,
  bonus: number,
  edition: DndEdition,
  rng?: DieRandom,
): InitiativeRoll {
  if (c.dex === null) throw new Error(`${c.name} 缺少敏捷，请先补充或手填行动值`);
  const surprised = c.surprised === true;
  const edge = initiativeEdge(requestedEdge, edition, surprised);
  const rolls = rollDice(edge === 'normal' ? '1d20' : '2d20', rng).groups[0].rolls;
  return {
    rolls,
    selected: selectInitiativeDie(rolls, edge),
    dexModifier: Math.floor((c.dex - 10) / 2),
    bonus,
    edge,
    requestedEdge,
    edition,
    surprised,
  };
}

export function rollEncounterInitiative(
  state: EncounterState,
  c: Combatant,
  edge: Edge,
  bonus: number,
  edition: DndEdition,
  rng?: DieRandom,
): { state: EncounterState; roll: InitiativeRoll; total: number } {
  if (c.rule !== 'dnd') throw new Error('先攻掷骰仅适用于 D&D');
  if (c.initiativeRoll || c.initiative !== null) throw new Error('该参战者的先攻已记录');
  if (c.initiativeOverride !== null) throw new Error('请先清除手填行动值再掷骰');
  const roll = rollInitiative(c, edge, bonus, edition, rng);
  const participants = state.participants.map((p) =>
    p.id === c.id ? { ...p, initiativeRoll: roll } : p,
  );
  return { state: updated(state, participants), roll, total: initiativeTotal(roll) };
}

export function nextEncounterTurn(state: EncounterState, dndEdition?: DndEdition): EncounterState {
  if (!state.activeId || !state.participants.length) throw new Error('请先生成行动顺序');
  const ordered = turnRoster(state);
  const current = ordered.findIndex((p) => p.id === state.activeId);
  const nextIndex = (current + 1) % ordered.length;
  const ending = ordered[current];
  const participants =
    ending.surprised && getDndEdition(dndEdition) === '2014'
      ? state.participants.map((p) => (p.id === ending.id ? { ...p, surprised: false } : p))
      : state.participants;
  return updated(
    state,
    participants,
    ordered[nextIndex].id,
    state.round + (nextIndex === 0 ? 1 : 0),
  );
}

export function updateCombatant(
  state: EncounterState,
  combatantId: string,
  raw: CombatantPatch,
  dndEdition?: DndEdition,
): EncounterState {
  const patch = CombatantPatchSchema.parse(raw);
  const c = state.participants.find((p) => p.id === combatantId);
  if (!c) throw new Error('该参战者已不在本场');
  if (c.memberId && ['name', 'publicName', 'revealed', 'dex', 'maxHp'].some((key) => key in patch))
    throw new Error('玩家基础资料请在角色卡中修改并重新审核');
  if (c.memberId && patch.hp === null) throw new Error('玩家 HP 不能留空');
  if (
    patch.surprised !== undefined &&
    patch.surprised !== (c.surprised ?? false) &&
    (c.initiativeRoll || c.initiative !== null || state.round > 0) &&
    (patch.surprised || getDndEdition(dndEdition) === '2024')
  )
    throw new Error('请在先攻掷骰和开战前设置突袭');
  const next = CombatantSchema.parse({ ...c, ...patch });
  if (
    c.rule === 'dnd' &&
    patch.initiativeOverride === null &&
    c.initiativeOverride !== null &&
    c.initiative === c.initiativeOverride &&
    !c.initiativeRoll
  )
    next.initiative = null;
  if (c.rule === 'dnd' && ((c.hp === 0 && next.hp !== null && next.hp > 0) || next.stable)) {
    next.deathSuccesses = 0;
    next.deathFailures = 0;
    if (next.hp !== null && next.hp > 0) next.stable = false;
    next.dying = false;
    if (next.hp === 0 && next.stable) next.unconscious = true;
  }
  return updated(
    state,
    state.participants.map((p) => (p.id === c.id ? next : p)),
  );
}

export function setEncounterAutoDamage(state: EncounterState, autoDamage: boolean): EncounterState {
  if ((state.autoDamage ?? false) === autoDamage) return state;
  return updated({ ...state, autoDamage }, state.participants);
}

export function setEncounterLifeChecks(
  state: EncounterState,
  autoLifeChecks: boolean,
): EncounterState {
  if ((state.autoLifeChecks ?? false) === autoLifeChecks) return state;
  return updated({ ...state, autoLifeChecks }, state.participants);
}

export function replaceInjuredCombatant(state: EncounterState, c: Combatant): EncounterState {
  return updated(
    state,
    state.participants.map((current) => (current.id === c.id ? c : current)),
  );
}

export function clearEncounter(state: EncounterState, members: Member[]): EncounterState {
  const next = syncEncounterPlayers(
    {
      ...emptyEncounter(),
      autoDamage: state.autoDamage,
      autoLifeChecks: state.autoLifeChecks,
    },
    members,
  );
  next.participants = next.participants.map((c) => {
    const old = state.participants.find((p) => p.id === c.id);
    if (!old) return c;
    return {
      ...c,
      majorWound: old.majorWound,
      dying: old.dying,
      stable: old.stable,
      deathSuccesses: old.deathSuccesses,
      deathFailures: old.deathFailures,
      dead: old.dead,
      unconscious: old.unconscious,
      injuryChecks: {
        conPending: old.injuryChecks?.conPending,
        firstAidStabilized: old.injuryChecks?.firstAidStabilized,
        firstAidUsed: old.injuryChecks?.firstAidUsed,
        medicineUsed: old.injuryChecks?.medicineUsed,
        ...(old.dying && old.rule === 'coc' ? { cocDueRound: 1 } : {}),
      },
    };
  });
  return { ...next, revision: state.revision + 1 };
}

export function recordEncounterRest(
  state: EncounterState,
  memberIds: string[],
  rest: 'short' | 'long',
): EncounterState {
  const participants =
    rest === 'long'
      ? state.participants.map((c) =>
          c.memberId && c.tempHp && memberIds.includes(c.memberId) ? { ...c, tempHp: 0 } : c,
        )
      : state.participants;
  const slots = state.slotSpentMemberIds;
  const remainingSlots = slots?.filter((memberId) => !memberIds.includes(memberId));
  if (
    remainingSlots?.length === slots?.length &&
    participants.every((c, index) => c === state.participants[index])
  )
    return state;
  return updated(
    { ...state, ...(remainingSlots ? { slotSpentMemberIds: remainingSlots } : {}) },
    participants,
  );
}

export function markEncounterSpellSlot(state: EncounterState, memberId: string): EncounterState {
  if (!state.activeId) return state;
  const slots = state.slotSpentMemberIds ?? [];
  if (slots.includes(memberId)) throw new Error('本回合已经消耗过法术位');
  return updated({ ...state, slotSpentMemberIds: [...slots, memberId] }, state.participants);
}

export function canControlCompanion(combatant: Combatant, memberId?: string): boolean {
  return !!memberId && combatant.revealed && combatant.ownerMemberId === memberId;
}

export function setEncounterCompanionOwner(
  state: EncounterState,
  combatant: Combatant,
  ownerMemberId: string | null,
): EncounterState {
  if (combatant.rule !== 'dnd' || combatant.memberId !== null)
    throw new Error('请选中 D&D NPC 或怪物作为伙伴');
  if ((combatant.ownerMemberId ?? null) === ownerMemberId) return state;
  const { ownerMemberId: _oldOwner, ...base } = combatant;
  const updatedCompanion = ownerMemberId === null ? base : { ...base, ownerMemberId };
  return updated(
    state,
    state.participants.map((c) => (c.id === combatant.id ? updatedCompanion : c)),
  );
}

export const DAMAGE_ADJUSTMENT_LABELS: Record<DamageAdjustment, string> = {
  normal: '无调整',
  resistant: '抗性',
  vulnerable: '易伤',
  immune: '免疫',
  'resistant-vulnerable': '先抗性、后易伤',
};

export function effectiveCocArmor(c: Combatant, override?: number): number | null {
  return override ?? (c.source?.rule === 'coc' ? c.source.armor : 0);
}

/** The attack's dice are doubled on a critical hit; its fixed terms are unchanged. */
export function criticalDamageExpression(damage: string): string {
  return damage
    .replace(/\s+/g, '')
    .replace(
      /(\d*)d(\d+)/gi,
      (_, count: string, sides: string) => `${2 * Number(count || '1')}d${sides}`,
    );
}

export function applyEncounterDamage(
  state: EncounterState,
  target: Combatant,
  rolled: number,
  options: {
    adjustment?: DamageAdjustment;
    armorOverride?: number;
    critical?: boolean;
    edition?: DndEdition;
  },
) {
  if (target.hp === null) throw new Error('目标 HP 未填写，请先补充或手动处理');
  const raw = Math.max(0, rolled);
  const adjustment = options.adjustment ?? 'normal';
  const armor = target.rule === 'coc' ? effectiveCocArmor(target, options.armorOverride) : 0;
  if (armor === null) throw new Error('目标护甲未知，请填写本次护甲');
  let effective = Math.max(0, raw - armor);
  if (target.rule === 'dnd') {
    if (adjustment === 'immune') effective = 0;
    if (adjustment === 'resistant' || adjustment === 'resistant-vulnerable')
      effective = Math.floor(effective / 2);
    if (adjustment === 'vulnerable' || adjustment === 'resistant-vulnerable') effective *= 2;
  }
  const tempAbsorbed = target.rule === 'dnd' ? Math.min(target.tempHp, effective) : 0;
  const beforeHp = target.hp;
  const hp = Math.max(0, beforeHp - (effective - tempAbsorbed));
  const combatant = { ...target, tempHp: target.tempHp - tempAbsorbed };
  const injury = damageInjury(
    combatant,
    hp,
    effective,
    effective - tempAbsorbed,
    state.round,
    options,
  );
  const participants = state.participants.map((p) => (p.id === target.id ? injury.combatant : p));
  return {
    state: updated(state, participants),
    combatant: injury.combatant,
    beforeHp,
    raw,
    effective,
    armor,
    adjustment,
    tempAbsorbed,
    notes: injury.notes,
  };
}

export function removeCombatant(state: EncounterState, combatantId: string): EncounterState {
  const index = state.participants.findIndex((p) => p.id === combatantId);
  if (index < 0) throw new Error('该参战者已不在本场');
  if (state.participants[index].memberId) throw new Error('玩家随角色同步，请在房间管理中处理离席');
  const next = state.participants.filter((p) => p.id !== combatantId);
  const turn = survivingTurn(state, next);
  return updated(state, next, turn.activeId, turn.round);
}

/** Strip host data before it ever reaches a player's socket, including hidden turn IDs. */
export function encounterView(
  state: EncounterState,
  isHost: boolean,
  memberId?: string,
): EncounterState {
  if (isHost) return state;
  const participants = state.participants
    .filter((c) => c.kind === 'player' || c.revealed)
    .map((c): Combatant => {
      if (c.kind === 'player') return { ...c, notes: '' };
      const controlled = canControlCompanion(c, memberId);
      return {
        ...base(c.rule),
        id: c.id,
        kind: c.kind,
        memberId: null,
        ...(c.ownerMemberId ? { ownerMemberId: c.ownerMemberId } : {}),
        sourceCardId: null,
        source: null,
        name: c.publicName,
        publicName: c.publicName,
        revealed: true,
        dex: controlled ? c.dex : null,
        initiative: c.initiative,
        ...(controlled
          ? {
              initiativeOverride: c.initiativeOverride,
              ...(c.initiativeRoll ? { initiativeRoll: c.initiativeRoll } : {}),
              ...(c.surprised !== undefined ? { surprised: c.surprised } : {}),
              dead: c.dead,
              unconscious: c.unconscious,
              dying: c.dying,
              stable: c.stable,
              deathSaveMode: c.deathSaveMode,
              deathSuccesses: c.deathSuccesses,
              deathFailures: c.deathFailures,
              injuryChecks: c.injuryChecks,
            }
          : {}),
        hp: controlled ? c.hp : null,
        maxHp: controlled ? c.maxHp : null,
        ac: null,
        conditions: c.conditions,
      };
    });
  const { loadedWaves: _privateWaves, slotSpentMemberIds, ...publicState } = state;
  const ownSpentSlot = memberId && slotSpentMemberIds?.includes(memberId) ? [memberId] : undefined;
  return {
    ...publicState,
    ...(ownSpentSlot ? { slotSpentMemberIds: ownSpentSlot } : {}),
    participants,
    activeId: participants.some((c) => c.id === state.activeId) ? state.activeId : null,
  };
}

export function validateEncounterReferences(
  state: EncounterState,
  members: Member[],
  rule: RuleId,
  dndEdition?: DndEdition,
): boolean {
  if (!EncounterSchema.safeParse(state).success) return false;
  const edition = getDndEdition(dndEdition);
  if (state.slotSpentMemberIds?.length && (rule !== 'dnd' || edition !== '2024')) return false;
  return state.participants.every(
    (c) =>
      c.rule === rule &&
      (!c.initiativeRoll || c.initiativeRoll.edition === edition) &&
      (c.source?.rule !== 'dnd' || getDndEdition(c.source.dndEdition) === edition) &&
      (c.memberId
        ? members.some(
            (m) =>
              m.id === c.memberId &&
              m.role === 'player' &&
              m.character?.rule === rule &&
              getDndEdition(m.character.dndEdition) === edition &&
              m.character.hp === c.hp &&
              m.character.maxHp === c.maxHp &&
              (!m.character.dndEquipment || c.ac === effectiveCharacter(m.character).ac) &&
              (!m.character.dndMagic ||
                c.concentration === (m.character.dndMagic.concentration ?? '')) &&
              c.id === m.id,
          )
        : c.source !== null && c.source.rule === rule && c.sourceCardId === c.source.id),
  );
}

function cocSuccessLevel(r: CheckResult): number {
  if (!r.success) return 0;
  if (r.selected === 1) return 4;
  if (r.selected <= Math.floor(r.target / 5)) return 3;
  if (r.selected <= Math.floor(r.target / 2)) return 2;
  return 1;
}

export function cocMeleeWinner(
  attack: CheckResult,
  defense: CheckResult,
  response: 'dodge' | 'fight-back',
): 'attacker' | 'defender' | 'dodge' | 'neither' {
  const a = cocSuccessLevel(attack);
  const d = cocSuccessLevel(defense);
  if (!a && !d) return 'neither';
  if (response === 'dodge') return a > d ? 'attacker' : 'dodge';
  return a >= d ? 'attacker' : 'defender';
}

export function compareCocMelee(
  attack: CheckResult,
  defense: CheckResult,
  response: 'dodge' | 'fight-back',
): string {
  return {
    neither: '双方失败，本次均未造成伤害。',
    dodge: '防守方闪避成功，未受此次攻击伤害。',
    attacker: '进攻方命中；请按武器与成功等级裁定伤害。',
    defender: '防守方反击成功；反击只造成普通伤害。',
  }[cocMeleeWinner(attack, defense, response)];
}

export function isCocExtremeSuccess(check: CheckResult): boolean {
  return cocSuccessLevel(check) >= 3;
}

export function concentrationDC(damage: number, dndEdition?: DndEdition): number {
  if (!Number.isInteger(damage) || damage < 0 || damage > 100000)
    throw new Error('伤害须为 0–100000 的整数');
  const dc = Math.max(10, Math.floor(damage / 2));
  return getDndEdition(dndEdition) === '2024' ? Math.min(30, dc) : dc;
}

export function deathSaveSuggestion(roll: number): {
  successes: number;
  failures: number;
  heal: number;
  text: string;
} {
  if (!Number.isInteger(roll) || roll < 1 || roll > 20) throw new Error('死亡豁免原始骰须为 1–20');
  if (roll === 20)
    return { successes: 0, failures: 0, heal: 1, text: '自然 20：恢复 1 HP，清除死亡豁免计数。' };
  if (roll === 1) return { successes: 0, failures: 2, heal: 0, text: '自然 1：记录两次失败。' };
  return roll >= 10
    ? { successes: 1, failures: 0, heal: 0, text: '记录一次成功；三次成功后稳定。' }
    : {
        successes: 0,
        failures: 1,
        heal: 0,
        text: '记录一次失败；三次失败意味着死亡，由主持人确认。',
      };
}
