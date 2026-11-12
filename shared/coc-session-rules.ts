import { adjustmentLabel, applyCharacterAdjustment, effectiveCharacter } from './adjustments.ts';
import { cocSkillDefinitions } from './coc-career.ts';
import { cocResultAtDifficulty, CocSessionEditSchema, type CocSessionEdit } from './coc-runtime.ts';
import {
  COC_BOUTS,
  CocSessionSchema,
  CocSpellDefinitionSchema,
  CocTomeDefinitionSchema,
  cocBoutRounds,
  cocCurrentLuck,
  cocDevelopmentMarked,
  cocInsanityHours,
  cocLossDefinition,
  cocRoomRules,
  cocSessionValueLocked,
  emptyCocSession,
  type CocHistoryEntry,
  type CocInsanity,
  type CocPendingSanity,
  type CocRoomRules,
  type CocSanity,
  type CocSession,
} from './coc-session.ts';
import { syncEncounterPlayers, type Combatant } from './encounter.ts';
import { damageInjury, previewManualHp } from './injury.ts';
import { rollCheck, rollDice, type DieRandom } from './rules.ts';
import type { Character, DiceResult, Edge, Room, Visibility } from './types.ts';
import { editValueControl } from './value-control.ts';

const DAY = 1440;
const WEEK = DAY * 7;
const MONTH = DAY * 30;
const MYTHOS = 'cthulhuMythos';
const insanityLabels = { temporary: '临时疯狂', indefinite: '不定性疯狂', permanent: '永久疯狂' };

function requireRule(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type JournalOptions = { now?: string; id?: () => string };
type Life = Pick<Combatant, 'dead' | 'dying' | 'majorWound' | 'unconscious' | 'injuryChecks'>;
type CocSessionOptions = JournalOptions & {
  rules?: CocRoomRules;
  rng?: DieRandom;
  life?: Life;
  validateHpChange?: (hp: number) => void;
};
type Context = {
  now: string;
  id: () => string;
  rng?: DieRandom;
  rules: CocRoomRules;
  life?: Life;
  validateHpChange?: (hp: number) => void;
};
type Result = {
  character: Character;
  summary: string;
  visibility: Visibility;
  clearMajorWound: boolean;
};
type BoutChoice = Pick<NonNullable<CocInsanity['bout']>, 'kind' | 'description'>;

function journalOptions(options: JournalOptions) {
  return {
    now: options.now ?? new Date().toISOString(),
    id: options.id ?? (() => globalThis.crypto.randomUUID()),
  };
}

function journal(
  session: CocSession,
  kind: CocHistoryEntry['kind'],
  summary: string,
  visibility: Visibility,
  { now, id }: Required<JournalOptions>,
) {
  session.history = [
    ...session.history,
    { id: id(), at: now, kind, summary: summary.slice(0, 1500), visibility },
  ].slice(-250);
}

function resolveLoss(expression: string, rng?: DieRandom, maximum = false): DiceResult {
  const checked = cocLossDefinition(expression);
  if (!maximum) return rollDice(expression, rng);
  const { definition, maximum: total } = checked;
  return {
    ...definition,
    groups: definition.groups.map((group) => ({
      ...group,
      rolls: group.rolls.map(() => (group.sign === 1 ? group.sides : 1)),
    })),
    total,
  };
}

function sourceRecord(sanity: CocSanity, name: string) {
  return sanity.sources.find((source) => source.name.toLowerCase() === name.toLowerCase());
}

function availableLoss(
  sanity: CocSanity,
  san: number,
  total: number,
  source?: CocPendingSanity['source'],
) {
  if (!source) return Math.min(san, total);
  const previous = sourceRecord(sanity, source.name);
  requireRule(
    previous === undefined || previous.limit === source.limit,
    '本次冒险中同一遭遇来源的累计上限须一致',
  );
  return Math.min(san, total, source.limit - (previous?.loss ?? 0));
}

export function getCocSessionErrors(card: Character): string[] {
  const session = card.cocSession;
  if (!session) return [];
  if (card.rule !== 'coc' || !CocSessionSchema.safeParse(session).success)
    return ['CoC 局内记录格式无效'];
  try {
    const { insanity, pending, sources } = session.sanity;
    const invalidDuration = (value: number | null | undefined) =>
      value !== null &&
      value !== undefined &&
      (!Number.isInteger(value) || value < 1 || value > 1000);
    requireRule(
      !invalidDuration(insanity?.hoursControl?.manual) &&
        !invalidDuration(insanity?.bout?.roundsControl?.manual),
      '疯狂持续时间须为 1–1000 的整数',
    );
    requireRule(
      sources.every(({ loss, limit }) => loss <= limit),
      '累计理智损失超过来源上限',
    );
    requireRule(
      session.sanity.day === 1 + Math.floor(session.gameMinutes / DAY),
      '游戏日与游戏时间不匹配',
    );
    requireRule(
      (session.sanity.lastTherapyMinute ?? 0) <= session.gameMinutes,
      '心理治疗记录时间无效',
    );
    if (pending) {
      const loss = pending.success ? pending.successLoss : pending.failureLoss;
      const { definition, maximum } = cocLossDefinition(loss);
      let index = 0;
      let total = definition.modifier;
      for (const group of definition.groups) {
        for (let die = 0; die < group.count; die += 1) {
          const value = pending.dice[index++];
          requireRule(
            Number.isInteger(value) && value >= 1 && value <= group.sides,
            '待结算理智损失的骰值无效',
          );
          total += group.sign * value;
        }
      }
      requireRule(
        index === pending.dice.length &&
          (pending.roll !== 100 || total === maximum) &&
          pending.loss === availableLoss(session.sanity, pending.san, total, pending.source),
        '待结算理智损失不一致',
      );
    }
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : 'CoC 局内记录无效'];
  }
}

/** Update unused preparation entries while keeping room-owned play progress. */
export function mergeCocPreparation(previous: CocSession, draft?: CocSession): CocSession {
  if (!draft) return previous;
  const spellDefinition = CocSpellDefinitionSchema.strip();
  const tomeDefinition = CocTomeDefinitionSchema.strip();
  const savedTomes = previous.tomes.filter((tome) => tome.progressMinutes > 0);
  const protectedSpells = new Set(savedTomes.flatMap((tome) => tome.spellIds));
  const savedSpells = previous.spells.filter(
    (spell) => spell.learned || protectedSpells.has(spell.id),
  );
  const spells = draft.spells.map((spell) => {
    const saved = savedSpells.find(({ id }) => id === spell.id);
    const definition = spellDefinition.parse(spell);
    if (!saved) return { ...definition, learned: false, casting: 'untested' as const };
    requireRule(
      JSON.stringify(spellDefinition.parse(saved)) === JSON.stringify(definition),
      '已学会或已被研读引用的法术须由主持人修改',
    );
    return saved;
  });
  const tomes = draft.tomes.map((tome) => {
    const saved = savedTomes.find(({ id }) => id === tome.id);
    const definition = tomeDefinition.parse(tome);
    if (!saved)
      return { ...definition, progressMinutes: 0, initialComplete: false, fullComplete: false };
    requireRule(
      JSON.stringify(tomeDefinition.parse(saved)) === JSON.stringify(definition),
      '已开始研读的神话书须由主持人修改',
    );
    return saved;
  });
  return CocSessionSchema.parse({
    ...previous,
    spells: [
      ...spells,
      ...savedSpells.filter((saved) => !spells.some(({ id }) => id === saved.id)),
    ],
    tomes: [...tomes, ...savedTomes.filter((saved) => !tomes.some(({ id }) => id === saved.id))],
  });
}

export function canDevelopCocSkill(card: Character, key: string) {
  return (
    card.rule === 'coc' &&
    key !== 'creditRating' &&
    key !== MYTHOS &&
    (!card.cocCareer || cocSkillDefinitions(card).some((skill) => skill.key === key)) &&
    Object.hasOwn(effectiveCharacter(card, false).skills, key)
  );
}

export function reconcileCocDevelopmentMarks(card: Character): Character {
  const session = card.cocSession;
  if (!session) return card;
  const marks = session.development.marks.filter(({ key }) => canDevelopCocSkill(card, key));
  return marks.length === session.development.marks.length
    ? card
    : {
        ...card,
        cocSession: { ...session, development: { ...session.development, marks } },
      };
}

export function markCocDevelopment(card: Character, key: string, eventId: string): Character {
  if (!canDevelopCocSkill(card, key)) return card;
  const session = structuredClone(card.cocSession ?? emptyCocSession(card));
  const previous = session.development.marks.find((mark) => mark.key === key);
  if (previous?.eventIds.includes(eventId) || (previous?.eventIds.length ?? 0) >= 200) return card;
  if (previous) previous.eventIds.push(eventId);
  else
    session.development.marks.push({
      key,
      mode: 'auto',
      locked: true,
      manual: null,
      eventIds: [eventId],
    });
  return { ...card, cocSession: CocSessionSchema.parse(session) };
}

export function spendCocLuck(
  card: Character,
  points: number,
  eventId: string,
  summary: string,
  options: JournalOptions = {},
): Character {
  const luck = cocCurrentLuck(card);
  requireRule(
    Number.isInteger(points) && points > 0 && points <= luck,
    '当前幸运不足以支付这次调整',
  );
  const session = structuredClone(card.cocSession ?? emptyCocSession(card));
  session.luck = luck - points;
  for (const mark of session.development.marks)
    mark.eventIds = mark.eventIds.filter((id) => id !== eventId);
  session.development.marks = session.development.marks.filter(
    (mark) => mark.eventIds.length || mark.manual !== null || !mark.locked,
  );
  journal(session, 'luck', summary, 'public', journalOptions(options));
  return { ...card, cocSession: CocSessionSchema.parse(session) };
}

function setSkill(card: Character, key: string, value: number, reason: string, ctx: Context) {
  const changed = applyCharacterAdjustment(
    card,
    { kind: 'set-value', target: 'skill', key, value, reason: reason.slice(0, 200) },
    ctx.now,
  );
  return {
    ...changed,
    hp: card.hp,
    maxHp: card.maxHp,
    mp: card.mp,
    maxMp: card.maxMp,
    ...(key !== MYTHOS ? { san: card.san, maxSan: card.maxSan } : {}),
  };
}

function gainMythos(card: Character, points: number, source: string, ctx: Context) {
  const before = effectiveCharacter(card, false).skills[MYTHOS] ?? 0;
  const gain = Math.min(points, 99 - before);
  if (gain <= 0) return { card, gain: 0 };
  const next = setSkill(card, MYTHOS, before + gain, source, ctx);
  return { card: next, gain };
}

function makeBout(
  session: CocSession,
  ctx: Context,
  choice?: BoutChoice,
  old?: CocInsanity['bout'],
) {
  const roll = choice ? undefined : rollDice('1d10', ctx.rng).total;
  return {
    kind: choice?.kind ?? COC_BOUTS[roll! - 1].key,
    startedRound: session.gameRound,
    rounds: rollDice('1d10', ctx.rng).total,
    ...(old?.roundsControl ? { roundsControl: old.roundsControl } : {}),
    description: choice?.description ?? '',
    ...(roll === undefined ? {} : { roll }),
  };
}

function addBoutCondition(session: CocSession, ctx: Context) {
  const bout = session.sanity.insanity?.bout;
  if (
    (bout?.kind !== 'phobia' && bout?.kind !== 'mania') ||
    !bout.description ||
    session.sanity.conditions.some(
      (condition) => condition.kind === bout.kind && condition.description === bout.description,
    )
  )
    return;
  session.sanity.conditions.push({
    id: ctx.id(),
    kind: bout.kind,
    description: bout.description.slice(0, 300),
    visibility: session.sanity.insanity?.visibility,
  });
}

function describeInsanity(insanity: CocInsanity) {
  const label = insanityLabels[insanity.kind];
  const hours = insanity.kind === 'temporary' ? ` ${cocInsanityHours(insanity)} 小时` : '';
  const bout = insanity.bout;
  if (!bout) return label + hours;
  const symptom = COC_BOUTS.find(({ key }) => key === bout.kind)!.label;
  const result = bout.roll ? `（症状骰 ${bout.roll}）` : '';
  return `${label}${hours}，发作 ${symptom}${result} ${cocBoutRounds(bout)} 轮${bout.description ? `，${bout.description}` : ''}`;
}

function createInsanity(
  session: CocSession,
  kind: CocInsanity['kind'],
  reason: string,
  ctx: Context,
  choice?: BoutChoice,
  visibility: Visibility = 'host',
): CocInsanity {
  const current = session.sanity.insanity;
  if (kind === 'permanent') return { kind, reason, visibility, startedMinute: session.gameMinutes };
  return {
    kind,
    reason,
    visibility,
    startedMinute: session.gameMinutes,
    ...(kind === 'temporary' ? { hours: rollDice('1d10', ctx.rng).total } : {}),
    bout: makeBout(session, ctx, choice, current?.bout),
  };
}

function applyLoss(
  card: Character,
  session: CocSession,
  loss: number,
  reason: string,
  ctx: Context,
  options: {
    automatic?: boolean;
    mythos?: boolean;
    bout?: BoutChoice;
    visibility?: Visibility;
  } = {},
) {
  const actualLoss = Math.min(card.san, loss);
  let next = { ...card, san: card.san - actualLoss };
  const notes = [`SAN ${card.san} → ${next.san}`];
  session.sanity.lostToday += actualLoss;
  if (!(options.automatic ?? ctx.rules.autoSanity) || actualLoss === 0)
    return { card: next, notes };
  const current = session.sanity.insanity;
  const threshold = Math.ceil(session.sanity.dayStartSan / 5);
  let kind = current?.kind;
  if (next.san === 0) kind = 'permanent';
  else if (kind !== 'permanent' && threshold > 0 && session.sanity.lostToday >= threshold)
    kind = 'indefinite';
  else if (!kind && actualLoss >= 5) {
    const check = rollCheck(
      'coc',
      next,
      { kind: 'ability', key: 'int', edge: 'normal', dc: 0, modifier: 0 },
      ctx.rng,
    );
    const understands = check.selected <= check.target;
    notes.push(`INT ${check.selected}/${check.target} ${understands ? '成功' : '失败'}`);
    if (understands) kind = 'temporary';
  }
  if (!kind) return { card: next, notes };
  if (current?.kind !== kind) {
    session.sanity.insanity = createInsanity(
      session,
      kind,
      reason,
      ctx,
      options.bout,
      options.visibility,
    );
    if (options.mythos) {
      const result = gainMythos(next, session.sanity.firstMythosInsanity ? 1 : 5, reason, ctx);
      next = result.card;
      session.sanity.firstMythosInsanity = true;
      notes.push(`神话知识 +${result.gain}，SAN 上限 ${next.maxSan}`);
      if (next.san === 0 && kind !== 'permanent')
        session.sanity.insanity = createInsanity(
          session,
          'permanent',
          reason,
          ctx,
          undefined,
          options.visibility,
        );
    }
  } else if (kind !== 'permanent') {
    session.sanity.insanity = {
      ...current,
      visibility: options.visibility ?? 'host',
      bout: makeBout(session, ctx, options.bout, current.bout),
    };
  }
  addBoutCondition(session, ctx);
  notes.push(describeInsanity(session.sanity.insanity!));
  return { card: next, notes };
}

function moveClock(card: Character, session: CocSession, minutes: number, rounds: number) {
  const notes: string[] = [];
  if (minutes) requireRule(!session.sanity.pending, '请先确认或撤销待结算的理智检定');
  session.gameMinutes += minutes;
  session.gameRound += rounds;
  const day = 1 + Math.floor(session.gameMinutes / DAY);
  if (day !== session.sanity.day) {
    session.sanity.day = day;
    session.sanity.dayStartSan = card.san;
    session.sanity.lostToday = 0;
  }
  const insanity = session.sanity.insanity;
  if (!insanity) return notes;
  if (
    insanity.kind === 'temporary' &&
    session.gameMinutes - insanity.startedMinute >= cocInsanityHours(insanity) * 60
  ) {
    session.sanity.insanity = null;
    notes.push('临时疯狂结束');
  } else if (
    insanity.bout &&
    session.gameRound - insanity.bout.startedRound >= cocBoutRounds(insanity.bout)
  ) {
    delete insanity.bout;
    notes.push('本次疯狂发作结束');
  }
  return notes;
}

export function advanceCocEncounterRounds(
  card: Character,
  rounds: number,
  options: JournalOptions = {},
): Result | null {
  if (!card.cocSession?.sanity.insanity?.bout || rounds <= 0) return null;
  const session = structuredClone(card.cocSession);
  const notes = moveClock(card, session, 0, rounds);
  if (notes.length) journal(session, 'time', notes.join('，'), 'host', journalOptions(options));
  return {
    character: { ...card, cocSession: CocSessionSchema.parse(session) },
    summary: notes.join('，'),
    visibility: 'host',
    clearMajorWound: false,
  };
}

export function recordCocManualSan(
  card: Character,
  value: number,
  options: CocSessionOptions = {},
): Result {
  const ctx = { ...options, ...journalOptions(options), rules: cocRoomRules(options.rules) };
  const session = structuredClone(card.cocSession ?? emptyCocSession(card));
  requireRule(!session.sanity.pending, '请先确认或撤销待结算的理智检定');
  const result =
    value < card.san
      ? applyLoss(card, session, card.san - value, '手动调整理智', ctx, { visibility: 'public' })
      : { card: { ...card, san: value }, notes: [`SAN ${card.san} → ${value}`] };
  const summary = ['手动调整理智', ...result.notes].join('，');
  journal(session, 'sanity', summary, 'public', ctx);
  return {
    character: { ...result.card, cocSession: CocSessionSchema.parse(session), updatedAt: ctx.now },
    summary,
    visibility: 'public',
    clearMajorWound: false,
  };
}

function recoverNaturally(
  card: Character,
  session: CocSession,
  minutes: number,
  edge: Edge,
  ctx: Context,
) {
  let { hp, mp } = card;
  const notes: string[] = [];
  let majorWound = Boolean(ctx.life?.majorWound);
  let elapsed = session.recovery.majorWound === majorWound ? session.recovery.hpMinutes : 0;
  if (!ctx.life?.dead) {
    const mpMinutes = mp < card.maxMp ? session.recovery.mpMinutes + minutes : 0;
    mp = Math.min(card.maxMp, mp + Math.floor(mpMinutes / 60));
    session.recovery.mpMinutes = mp < card.maxMp ? mpMinutes % 60 : 0;
  }
  if (
    ctx.life?.dead ||
    ctx.life?.dying ||
    (hp === 0 && majorWound && !ctx.life?.injuryChecks?.medicineUsed)
  ) {
    elapsed = 0;
  } else {
    elapsed += minutes;
    while (majorWound && elapsed >= WEEK) {
      elapsed -= WEEK;
      const check = rollCheck(
        'coc',
        card,
        { kind: 'ability', key: 'con', edge, dc: 0, modifier: 0 },
        ctx.rng,
      );
      const extreme = check.success && check.total <= Math.floor(check.target / 5);
      const healed = check.success ? rollDice(extreme ? '2d3' : '1d3', ctx.rng).total : 0;
      hp = Math.min(card.maxHp, hp + healed);
      notes.push(
        `每周 CON ${check.total}/${check.target}${healed ? `，恢复 ${healed} HP` : '，无恢复'}`,
      );
      if (extreme || (check.success && hp >= Math.ceil(card.maxHp / 2))) majorWound = false;
    }
    if (!majorWound) {
      hp = Math.min(card.maxHp, hp + Math.floor(elapsed / DAY));
      elapsed = hp < card.maxHp ? elapsed % DAY : 0;
    }
  }
  session.recovery.hpMinutes = elapsed;
  session.recovery.majorWound = majorWound;
  const clearMajorWound = Boolean(ctx.life?.majorWound && !majorWound);
  if (clearMajorWound) notes.push('重伤解除');
  if (hp !== card.hp) notes.push(`HP ${card.hp} → ${hp}`);
  if (mp !== card.mp) notes.push(`MP ${card.mp} → ${mp}`);
  return { card: { ...card, hp, mp }, notes, clearMajorWound };
}

function develop(card: Character, session: CocSession, label: string, ctx: Context) {
  const selected = session.development.marks.filter(cocDevelopmentMarked);
  requireRule(selected.length > 0, '请至少勾选一项合格技能');
  requireRule(
    selected.every(({ key }) => canDevelopCocSkill(card, key)),
    '成长勾选包含无法成长的技能',
  );
  const next = selected.reduce(
    (current, { key }) => {
      const value = effectiveCharacter(current.card, false).skills[key];
      const roll = rollDice('1d100', ctx.rng).total;
      const gain =
        roll > value || roll > 95 ? Math.min(1000 - value, rollDice('1d10', ctx.rng).total) : 0;
      if (gain) current.card = setSkill(current.card, key, value + gain, label, ctx);
      let sanityGain: number | undefined;
      if (value < 90 && value + gain >= 90 && !session.development.mastered.includes(key)) {
        session.development.mastered.push(key);
        if (session.sanity.insanity?.kind !== 'permanent' && current.card.san > 0) {
          sanityGain = Math.min(
            current.card.maxSan - current.card.san,
            rollDice('2d6', ctx.rng).total,
          );
          current.card.san += sanityGain;
        }
      }
      current.results.push({
        key,
        value,
        roll,
        gain,
        ...(sanityGain === undefined ? {} : { sanityGain }),
      });
      return current;
    },
    { card, results: [] as CocSession['development']['batches'][number]['results'] },
  );
  const batch = { id: ctx.id(), label, createdAt: ctx.now, results: next.results };
  session.development.batches = [...session.development.batches, batch].slice(-30);
  session.development.cycle += 1;
  session.development.marks = session.development.marks
    .filter((mark) => !mark.locked)
    .map((mark) => ({ ...mark, mode: 'auto', manual: null, eventIds: [] }));
  return {
    card: next.card,
    details: batch.results
      .map(
        ({ key, value, roll, gain, sanityGain }) =>
          `${adjustmentLabel(card, 'skill', key)} ${roll}/${value} ${gain ? `+${gain}` : '未提高'}${sanityGain ? `，SAN +${sanityGain}` : ''}`,
      )
      .join('、'),
  };
}

function spellHpCost(card: Character, spell: CocSession['spells'][number]) {
  const mpShortfall = Math.max(0, spell.cost.mp - card.mp);
  const hpCost = spell.cost.hp + mpShortfall;
  return { mpShortfall, hpCost, value: Math.max(0, card.hp - hpCost) };
}

export function previewCocSpellHp(room: Room, memberId: string, spellId: string) {
  const card = room.members.find(({ id }) => id === memberId)?.character;
  const spell = card?.cocSession?.spells.find(({ id }) => id === spellId);
  const target =
    room.encounter.participants.find(({ memberId: id }) => id === memberId) ??
    syncEncounterPlayers(room.encounter, room.members).participants.find(
      ({ memberId: id }) => id === memberId,
    );
  if (!card || !spell || !target) return null;
  const cost = spellHpCost(card, spell);
  const manual = previewManualHp(room, { target, value: cost.value });
  const combatant =
    cost.hpCost > card.hp
      ? damageInjury(target, cost.value, cost.hpCost, cost.hpCost, room.encounter.round).combatant
      : manual.combatant;
  return {
    ...cost,
    expectedHp: card.hp,
    expectedRevision: room.encounter.revision,
    requiresConfirmation: manual.requiresConfirmation,
    combatant,
  };
}

function castSpell(
  card: Character,
  session: CocSession,
  edit: Extract<CocSessionEdit, { kind: 'spell-cast' }>,
  ctx: Context,
) {
  const spell = session.spells.find(({ id }) => id === edit.spellId);
  requireRule(spell?.learned, '请先记录已学会这项法术');
  requireRule(!ctx.life?.dead && !ctx.life?.unconscious && card.hp > 0, '死亡或昏迷的角色不能施法');
  requireRule(!session.sanity.pending, '请先确认或撤销待结算的理智检定');
  if (edit.push)
    requireRule(
      ctx.rules.allowPushedRolls && spell.casting === 'failed',
      '这项法术没有可孤注一掷的首次施法',
    );
  if (spell.casting === 'failed') requireRule(edit.push, '再次尝试首次施法需要主持人确认孤注一掷');
  const { mpShortfall, hpCost, value: hp } = spellHpCost(card, spell);
  requireRule(
    !mpShortfall || edit.allowHpPayment,
    `MP 不足，确认用 ${mpShortfall} HP 抵付后再施法`,
  );
  if (hpCost) ctx.validateHpChange?.(hp);
  const loss = resolveLoss(spell.cost.san, ctx.rng);
  let casting = '施法成功';
  if (spell.casting !== 'mastered') {
    const check = cocResultAtDifficulty(
      rollCheck(
        'coc',
        card,
        { kind: 'ability', key: 'pow', edge: 'normal', dc: 0, modifier: 0 },
        ctx.rng,
      ),
      'hard',
    );
    const attempt = {
      roll: check.total,
      target: Math.floor(check.target / 2),
      success: check.success,
      at: ctx.now,
      visibility: edit.visibility ?? 'public',
    } as const;
    if (edit.push) spell.pushedAttempt = attempt;
    else spell.firstAttempt = attempt;
    if (check.success || edit.push) spell.casting = 'mastered';
    else spell.casting = 'failed';
    casting = check.success
      ? '首次施法成功'
      : edit.push
        ? `孤注一掷失败，法术生效并触发后果「${edit.push.consequence}」`
        : '首次施法失败';
    casting = `困难 POW ${check.total}/${Math.floor(check.target / 2)}，${casting}`;
  }
  const paid = { ...card, hp, mp: Math.max(0, card.mp - spell.cost.mp) };
  const elapsed = moveClock(paid, session, spell.cost.minutes, spell.cost.rounds);
  const resolved = applyLoss(paid, session, loss.total, `施放 ${spell.name}`, ctx, {
    mythos: true,
    visibility: edit.visibility ?? 'public',
  });
  return {
    card: resolved.card,
    summary: [
      `「${spell.name}」${casting}`,
      `MP ${card.mp} → ${paid.mp}`,
      `HP ${card.hp} → ${paid.hp}${mpShortfall ? `（其中 ${mpShortfall} 抵付 MP）` : ''}`,
      ...resolved.notes,
      ...(spell.cost.minutes || spell.cost.rounds
        ? [`耗时 ${spell.cost.minutes} 分钟、${spell.cost.rounds} 轮`]
        : []),
      ...elapsed,
    ].join('，'),
  };
}

function studyTome(
  card: Character,
  session: CocSession,
  edit: Extract<CocSessionEdit, { kind: 'tome-study' }>,
  ctx: Context,
) {
  const tome = session.tomes.find(({ id }) => id === edit.tomeId);
  requireRule(tome && !tome.fullComplete, '神话书不存在或已经完成研读');
  const minutes = Math.min(
    edit.minutes,
    tome.initialMinutes + tome.fullMinutes - tome.progressMinutes,
  );
  const notes = moveClock(card, session, minutes, 0);
  tome.progressMinutes += minutes;
  notes.unshift(`研读「${tome.name}」${minutes} 分钟（累计 ${tome.progressMinutes} 分钟）`);
  if (!tome.initialComplete && tome.progressMinutes >= tome.initialMinutes) {
    tome.initialComplete = true;
    const loss = resolveLoss(tome.sanLoss, ctx.rng);
    const resolved = applyLoss(card, session, loss.total, `初读 ${tome.name}`, ctx, {
      mythos: true,
      visibility: edit.visibility,
    });
    const result = gainMythos(resolved.card, tome.initialMythos, `初读 ${tome.name}`, ctx);
    card = result.card;
    notes.push(...resolved.notes, `完成初读，神话知识 +${result.gain}，SAN 上限 ${card.maxSan}`);
  }
  if (!tome.fullComplete && tome.progressMinutes >= tome.initialMinutes + tome.fullMinutes) {
    tome.fullComplete = true;
    const result = gainMythos(card, tome.fullMythos, `通读 ${tome.name}`, ctx);
    card = result.card;
    notes.push(`完成通读，神话知识 +${result.gain}，SAN 上限 ${card.maxSan}`);
  }
  return { card, summary: notes.join('，') };
}

/** Apply one confirmed investigator change. Callers provide authorization and HP validation. */
export function applyCocSessionEdit(
  card: Character,
  input: CocSessionEdit,
  options: CocSessionOptions = {},
): Result {
  requireRule(card.rule === 'coc', '这项局内记录仅适用于 CoC 调查员');
  const edit = CocSessionEditSchema.parse(input);
  const ctx = { ...options, ...journalOptions(options), rules: cocRoomRules(options.rules) };
  const session = structuredClone(card.cocSession ?? emptyCocSession(card));
  const sanity = session.sanity;
  let next = { ...card };
  let summary = '';
  let kind: CocHistoryEntry['kind'] = 'sanity';
  let visibility: Visibility = 'visibility' in edit ? (edit.visibility ?? 'host') : 'host';
  let clearMajorWound = false;

  switch (edit.kind) {
    case 'session-value-lock':
    case 'session-value-correct': {
      const { field } = edit;
      const labels = { luck: '当前幸运', dayStartSan: '日初 SAN', lostToday: '当日累计 SAN 损失' };
      kind = field === 'luck' ? 'luck' : 'sanity';
      if (field !== 'luck') requireRule(!sanity.pending, '请先确认或撤销待结算的理智检定');
      if (edit.kind === 'session-value-lock') {
        session.valueLocks = { ...session.valueLocks, [field]: edit.locked };
        summary = `${edit.locked ? '锁定' : '解锁'}${labels[field]}的手动修正`;
      } else {
        requireRule(!cocSessionValueLocked(session, field), '请先解锁此数值');
        const before = field === 'luck' ? cocCurrentLuck(card) : sanity[field];
        if (field === 'luck') session.luck = edit.value;
        else sanity[field] = edit.value;
        summary = `修正${labels[field]} ${before} → ${edit.value}，${edit.reason}`;
      }
      break;
    }
    case 'sanity-roll': {
      requireRule(!sanity.pending, '请先确认或撤销待结算的理智检定');
      if (edit.source) availableLoss(sanity, card.san, 0, edit.source);
      const result = rollCheck(
        'coc',
        card,
        { kind: 'sanity', key: 'san', dc: 0, modifier: 0, edge: 'normal' },
        ctx.rng,
      );
      const loss = resolveLoss(
        result.success ? edit.successLoss : edit.failureLoss,
        ctx.rng,
        result.selected === 100,
      );
      sanity.pending = {
        id: ctx.id(),
        reason: edit.reason,
        visibility,
        successLoss: edit.successLoss,
        failureLoss: edit.failureLoss,
        san: card.san,
        roll: result.selected,
        success: result.success,
        loss: availableLoss(sanity, card.san, loss.total, edit.source),
        dice: loss.groups.flatMap((group) => group.rolls),
        ...(edit.source ? { source: edit.source } : {}),
      };
      summary = `理智检定「${edit.reason}」${result.selected}/${card.san} ${result.outcome}，${loss.expression} = ${loss.total}，待确认损失 ${sanity.pending.loss} SAN`;
      break;
    }
    case 'sanity-confirm':
    case 'sanity-cancel': {
      const pending = sanity.pending;
      requireRule(pending?.id === edit.pendingId, '待结算的理智检定已更新，请重新查看');
      visibility = pending.visibility;
      delete sanity.pending;
      if (edit.kind === 'sanity-cancel') {
        summary = `撤销待结算的理智检定「${pending.reason}」`;
        break;
      }
      requireRule(card.san === pending.san, '当前 SAN 已变化，请重新发起理智检定');
      if (pending.source) {
        const previous = sourceRecord(sanity, pending.source.name);
        if (previous) previous.loss += pending.loss;
        else sanity.sources.push({ ...pending.source, loss: pending.loss });
      }
      const resolved = applyLoss(card, session, pending.loss, pending.reason, ctx, {
        automatic: edit.automatic,
        mythos: !!pending.source,
        bout: edit.bout,
        visibility,
      });
      next = resolved.card;
      summary = [
        `已结算「${pending.reason}」`,
        ...resolved.notes,
        `当日损失 ${sanity.lostToday}/${sanity.dayStartSan}`,
        ...(pending.success ? [] : ['失控动作由主持人裁定']),
      ].join('，');
      break;
    }
    case 'sanity-reset-sources':
      requireRule(!sanity.pending, '请先确认或撤销待结算的理智检定');
      sanity.sources = [];
      summary = '开启新一段冒险，清空遭遇来源的理智损失累计';
      break;
    case 'insanity-set': {
      kind = 'insanity';
      const previous = sanity.insanity;
      if (previous?.kind === edit.state) {
        sanity.insanity = { ...previous, reason: edit.reason, visibility };
        if (edit.bout && edit.state !== 'permanent') {
          const old = previous.bout;
          if (old) sanity.insanity.bout = { ...old, ...edit.bout, roll: undefined };
          else sanity.insanity.bout = makeBout(session, ctx, edit.bout);
        }
      } else
        sanity.insanity = createInsanity(
          session,
          edit.state,
          edit.reason,
          ctx,
          edit.bout,
          visibility,
        );
      addBoutCondition(session, ctx);
      summary = `主持人设定${describeInsanity(sanity.insanity)}，${edit.reason}`;
      break;
    }
    case 'insanity-stop': {
      kind = 'insanity';
      requireRule(sanity.insanity, '当前没有疯狂状态');
      if (edit.scope === 'bout') {
        requireRule(sanity.insanity.bout, '当前没有正在进行的发作');
        delete sanity.insanity.bout;
      } else {
        requireRule(
          sanity.insanity.kind !== 'permanent' || card.san > 0,
          'SAN 为 0 的永久疯狂不能通过此操作恢复',
        );
        sanity.insanity = null;
      }
      summary = `主持人结束${edit.scope === 'bout' ? '本次疯狂发作' : '疯狂状态'}，${edit.reason}`;
      break;
    }
    case 'insanity-duration-control': {
      kind = 'insanity';
      if (edit.control.kind === 'value')
        requireRule(
          Number.isInteger(edit.control.value) &&
            edit.control.value >= 1 &&
            edit.control.value <= 1000,
          '持续时间须为 1–1000 的整数',
        );
      if (edit.field === 'hours') {
        requireRule(
          sanity.insanity?.kind === 'temporary' && sanity.insanity.hours !== undefined,
          '当前没有临时疯狂',
        );
        sanity.insanity.hoursControl = editValueControl(
          sanity.insanity.hoursControl,
          edit.control,
          sanity.insanity.hours,
        );
      } else {
        const bout = sanity.insanity?.bout;
        requireRule(bout, '当前没有正在进行的发作');
        bout.roundsControl = editValueControl(bout.roundsControl, edit.control, bout.rounds);
      }
      const expired = moveClock(card, session, 0, 0);
      summary = ['主持人调整了疯狂持续时间', ...expired].join('，');
      break;
    }
    case 'insanity-condition-add':
      kind = 'insanity';
      sanity.conditions.push({ id: ctx.id(), kind: edit.condition, description: edit.description });
      summary = `记录${edit.condition === 'phobia' ? '恐惧症' : '躁狂'}「${edit.description}」`;
      break;
    case 'insanity-condition-remove':
      kind = 'insanity';
      requireRule(
        sanity.conditions.some(({ id }) => id === edit.conditionId),
        '这条症状记录已被移除',
      );
      sanity.conditions = sanity.conditions.filter(({ id }) => id !== edit.conditionId);
      summary = '移除了一项恐惧症或躁狂记录';
      break;
    case 'development-mark':
    case 'development-lock': {
      kind = 'development';
      requireRule(canDevelopCocSkill(card, edit.key), '此项目不能参加普通技能成长');
      let mark = session.development.marks.find(({ key }) => key === edit.key);
      if (!mark) {
        mark = { key: edit.key, mode: 'auto', locked: true, manual: null, eventIds: [] };
        session.development.marks.push(mark);
      }
      if (edit.kind === 'development-lock') mark.locked = edit.locked;
      else {
        requireRule(!mark.locked, '请先解锁此勾选');
        mark.mode = edit.marked === null ? 'auto' : 'manual';
        if (edit.marked !== null) mark.manual = edit.marked;
      }
      session.development.marks = session.development.marks.filter(
        (record) => record.eventIds.length || record.manual !== null || !record.locked,
      );
      summary = `更新了${adjustmentLabel(card, 'skill', edit.key)}的成长勾选`;
      break;
    }
    case 'development-roll': {
      kind = 'development';
      requireRule(!sanity.pending, '请先确认或撤销待结算的理智检定');
      const result = develop(next, session, edit.label, ctx);
      next = result.card;
      summary = `幕间成长「${edit.label}」：${result.details}`;
      break;
    }
    case 'mythos-gain': {
      kind = 'mythos';
      requireRule(!sanity.pending, '请先确认或撤销待结算的理智检定');
      const result = gainMythos(card, edit.points, edit.source, ctx);
      next = result.card;
      summary = `「${edit.source}」神话知识 +${result.gain}，SAN 上限 ${next.maxSan}`;
      break;
    }
    case 'luck-recover': {
      kind = 'luck';
      requireRule(ctx.rules.allowLuckSpending, '请先启用幸运消耗选用规则');
      const luck = cocCurrentLuck(card);
      const check = rollDice('1d100', ctx.rng).total;
      const gain =
        check > luck ? Math.min(Math.max(0, 99 - luck), rollDice('1d10', ctx.rng).total) : 0;
      session.luck = luck + gain;
      summary = `幕间幸运恢复检定 ${check}/${luck}，幸运 ${luck} → ${session.luck}`;
      break;
    }
    case 'advance-time': {
      kind = 'time';
      requireRule(edit.minutes > 0 || (edit.rounds ?? 0) > 0, '请填写推进的游戏分钟或轮数');
      const notes = moveClock(next, session, edit.minutes, edit.rounds ?? 0);
      if (edit.recovery !== 'none' && edit.minutes > 0) {
        const recovery = recoverNaturally(
          next,
          session,
          edit.minutes,
          edit.healingEdge ?? 'normal',
          ctx,
        );
        next = recovery.card;
        clearMajorWound = recovery.clearMajorWound;
        notes.push(...recovery.notes);
      }
      summary = [
        `${edit.reason}，推进 ${edit.minutes} 分钟、${edit.rounds ?? 0} 轮`,
        ...notes,
      ].join('，');
      break;
    }
    case 'sanity-treatment': {
      kind = 'treatment';
      requireRule(!ctx.life?.dead, '死亡角色无法接受治疗');
      requireRule(!sanity.pending, '请先确认或撤销待结算的理智检定');
      requireRule(
        sanity.insanity?.kind !== 'permanent' && card.san > 0,
        '永久疯狂的角色无法通过常规治疗恢复 SAN',
      );
      if (edit.method !== 'keeper') {
        requireRule(
          sanity.lastTherapyMinute === undefined ||
            session.gameMinutes - sanity.lastTherapyMinute >= MONTH,
          '心理治疗的进展每游戏月结算一次',
        );
        sanity.lastTherapyMinute = session.gameMinutes;
      }
      if (edit.method === 'therapy-fumble') {
        const loss = rollDice('1d6', ctx.rng).total;
        const resolved = applyLoss(card, session, loss, edit.reason, ctx);
        next = resolved.card;
        summary = `心理治疗大失败，损失 ${loss} SAN，本次治疗结束。${edit.reason}，${resolved.notes.join('，')}`;
        break;
      }
      if (edit.method === 'keeper')
        requireRule(edit.points && edit.points > 0, '请填写主持人确认的 SAN 恢复点数');
      const gain =
        edit.method === 'keeper'
          ? edit.points!
          : edit.method === 'therapy-success'
            ? rollDice('1d3', ctx.rng).total
            : 0;
      next.san = Math.min(card.maxSan, card.san + gain);
      summary = `${edit.reason}，SAN ${card.san} → ${next.san}`;
      break;
    }
    case 'spell-save': {
      kind = 'spell';
      const index = session.spells.findIndex(({ id }) => id === edit.spell.id);
      if (index >= 0) {
        const current = session.spells[index];
        requireRule(
          current.casting !== 'failed' ||
            JSON.stringify(current.cost) === JSON.stringify(edit.spell.cost),
          '请先解决首次施法失败，再调整施法代价',
        );
        session.spells[index] = { ...current, ...edit.spell };
      } else session.spells.push({ ...edit.spell, learned: false, casting: 'untested' });
      summary = `记录法术「${edit.spell.name}」`;
      break;
    }
    case 'spell-learn': {
      kind = 'spell';
      const spell = session.spells.find(({ id }) => id === edit.spellId);
      requireRule(spell && !spell.learned, '法术不存在或已经学会');
      const tome = edit.sourceTomeId
        ? session.tomes.find(
            (tome) =>
              tome.id === edit.sourceTomeId &&
              tome.initialComplete &&
              tome.spellIds.includes(spell.id),
          )
        : undefined;
      requireRule(!edit.sourceTomeId || tome, '请先确认已研读含此法术的神话书');
      requireRule(!edit.hardIntCheck || !!edit.minutes, '困难 INT 学习检定须填写本次学习耗时');
      const elapsed = moveClock(card, session, edit.minutes ?? 0, 0);
      const notes = [`学习「${spell.name}」${tome ? `，来源「${tome.name}」` : ''}`];
      if (edit.minutes) notes.push(`耗时 ${edit.minutes} 分钟`);
      if (edit.hardIntCheck) {
        const check = cocResultAtDifficulty(
          rollCheck(
            'coc',
            card,
            { kind: 'ability', key: 'int', edge: 'normal', dc: 0, modifier: 0 },
            ctx.rng,
          ),
          'hard',
        );
        spell.learned = check.success;
        notes.push(
          `困难 INT ${check.total}/${Math.floor(check.target / 2)}，${check.success ? '学会法术' : '学习失败'}`,
        );
      } else {
        spell.learned = true;
        notes.push('主持人确认已学会');
      }
      if (spell.learned) spell.learnedAt = ctx.now;
      summary = [...notes, ...elapsed].join('，');
      break;
    }
    case 'spell-remove': {
      kind = 'spell';
      const spell = session.spells.find(({ id }) => id === edit.spellId);
      requireRule(spell, '法术不存在');
      requireRule(
        !session.tomes.some((tome) => tome.spellIds.includes(spell.id)),
        '请先移除神话书中的法术引用',
      );
      session.spells = session.spells.filter(({ id }) => id !== edit.spellId);
      summary = `移除法术「${spell.name}」`;
      break;
    }
    case 'spell-cast': {
      kind = 'spell';
      visibility = edit.visibility ?? 'public';
      const result = castSpell(next, session, edit, ctx);
      next = result.card;
      summary = result.summary;
      break;
    }
    case 'tome-save': {
      kind = 'tome';
      const index = session.tomes.findIndex(({ id }) => id === edit.tome.id);
      if (index >= 0) {
        const current = session.tomes[index];
        const { initialMinutes, fullMinutes, initialMythos, fullMythos, sanLoss } = current;
        requireRule(
          current.progressMinutes === 0 ||
            (initialMinutes === edit.tome.initialMinutes &&
              fullMinutes === edit.tome.fullMinutes &&
              initialMythos === edit.tome.initialMythos &&
              fullMythos === edit.tome.fullMythos &&
              sanLoss === edit.tome.sanLoss),
          '已开始阅读的神话书不能更改耗时或代价',
        );
        session.tomes[index] = { ...current, ...edit.tome };
      } else
        session.tomes.push({
          ...edit.tome,
          progressMinutes: 0,
          initialComplete: false,
          fullComplete: false,
        });
      summary = `记录神话书「${edit.tome.name}」`;
      break;
    }
    case 'tome-study': {
      kind = 'tome';
      requireRule(
        !ctx.life?.dead && !ctx.life?.unconscious && card.hp > 0,
        '死亡或昏迷的角色不能研读神话书',
      );
      const result = studyTome(next, session, edit, ctx);
      next = result.card;
      summary = result.summary;
      break;
    }
    case 'tome-remove': {
      kind = 'tome';
      const tome = session.tomes.find(({ id }) => id === edit.tomeId);
      requireRule(tome, '神话书不存在');
      requireRule(tome.progressMinutes === 0, '已经开始研读的神话书须保留其成长与进度记录');
      session.tomes = session.tomes.filter(({ id }) => id !== edit.tomeId);
      summary = `移除神话书「${tome.name}」`;
      break;
    }
  }
  if (
    ctx.rules.autoSanity &&
    card.san > 0 &&
    next.san === 0 &&
    (edit.kind === 'mythos-gain' || edit.kind === 'tome-study') &&
    sanity.insanity?.kind !== 'permanent'
  ) {
    sanity.insanity = createInsanity(session, 'permanent', 'SAN 上限降为 0', ctx);
    summary += '，SAN 降为 0，永久疯狂';
  }
  journal(session, kind, summary, visibility, ctx);
  next = { ...next, cocSession: CocSessionSchema.parse(session), updatedAt: ctx.now };
  return { character: next, summary, visibility, clearMajorWound };
}
