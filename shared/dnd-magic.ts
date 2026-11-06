import { z } from 'zod';
import { effectiveCharacter } from './adjustments';
import { getDndEdition, type DndEdition } from './dnd-edition';
import type { DndSpellReference } from './dnd-reference';
import {
  barbarianRage,
  dndSlotTable,
  fighterSecondWind2024,
  known2014,
  prepared2024,
  thirdSpellLimits,
  type SlotProgression,
} from './dnd-magic-tables';
import type { DieRandom } from './rules';
import type { Character } from './types';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/, '法术或资源编号无效');
const shortText = (max: number) => z.string().trim().min(1).max(max);
const amount = z.number().int().min(0).max(999);
const level = z.number().int().min(1).max(9);
const ability = z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']);
const abilityModifier = (score: number) => Math.floor((score - 10) / 2);
const proficiencyBonus = (level: number) => 2 + Math.floor((level - 1) / 4);
const recovery = z.enum(['short', 'long', 'short-one', 'none']);
const subclass = z.enum(['eldritch-knight', 'arcane-trickster']);
const spellIds = (max: number) =>
  z
    .array(id)
    .max(max)
    .refine((ids) => new Set(ids).size === ids.length, '同一法术不可重复');
const presetIds = z.enum([
  'rage',
  'bardic-inspiration',
  'channel-divinity',
  'wild-shape',
  'second-wind',
  'action-surge',
  'indomitable',
  'focus',
  'lay-on-hands',
  'divine-smite',
  'faithful-steed',
  'favored-enemy',
  'stroke-of-luck',
  'sorcery-points',
  'innate-sorcery',
  'sorcerous-restoration',
  'arcane-recovery',
  'magical-cunning',
  'eldritch-master',
  'contact-patron',
  'arcanum-6',
  'arcanum-7',
  'arcanum-8',
  'arcanum-9',
]);
export type DndMagicPresetId = z.infer<typeof presetIds>;

const GrantUsesSchema = z
  .strictObject({ max: amount.min(1).nullable(), used: amount, recovery })
  .refine((pool) => pool.used <= (pool.max ?? 0), '额外施法的已用次数超过上限');
export const DndSpellGrantSchema = z
  .strictObject({
    id,
    spellId: id,
    source: z.enum(['species', 'feat', 'item', 'class', 'dm']),
    label: shortText(100),
    ability: ability.optional(),
    attackBonus: z.number().int().min(-100).max(100).optional(),
    saveDc: z.number().int().min(0).max(100).optional(),
    allowSlots: z.boolean(),
    allowRitual: z.boolean(),
    free: GrantUsesSchema.optional(),
  })
  .refine((grant) => grant.allowSlots || grant.allowRitual || grant.free, '至少授予一种施法方式');

export const DndCustomResourceSchema = z
  .strictObject({
    id,
    name: shortText(80),
    max: amount.min(1),
    used: amount,
    recovery,
  })
  .refine((resource) => resource.used <= resource.max, '自定义资源的已用次数超过上限');

export const DndMagicStateSchema = z
  .strictObject({
    subclass: subclass.optional(),
    cantrips: spellIds(20),
    known: spellIds(30),
    prepared: spellIds(30),
    spellbook: spellIds(500),
    secrets: spellIds(6),
    arcanum: spellIds(4),
    grants: z.array(DndSpellGrantSchema).max(50),
    slotsUsed: z.array(z.number().int().min(0).max(4)).length(9),
    pactUsed: z.number().int().min(0).max(4),
    hitDiceUsed: z.number().int().min(0).max(20),
    presetSpent: z.partialRecord(presetIds, amount),
    customResources: z.array(DndCustomResourceSchema).max(30),
    concentration: shortText(200).optional(),
  })
  .superRefine((state, context) => {
    if (new Set(state.grants.map((grant) => grant.id)).size !== state.grants.length)
      context.addIssue({ code: 'custom', path: ['grants'], message: '额外施法授予编号不可重复' });
    if (
      new Set(state.customResources.map((resource) => resource.id)).size !==
        state.customResources.length ||
      state.customResources.some((resource) => presetIds.safeParse(resource.id).success)
    )
      context.addIssue({
        code: 'custom',
        path: ['customResources'],
        message: '自定义资源编号重复或与职业资源冲突',
      });
  });
export type DndMagicState = z.infer<typeof DndMagicStateSchema>;
export type DndSpellGrant = z.infer<typeof DndSpellGrantSchema>;
export type DndCustomResource = z.infer<typeof DndCustomResourceSchema>;
export type DndResourceRecovery = z.infer<typeof recovery>;

const CastSchema = z
  .strictObject({
    kind: z.literal('cast'),
    spellId: id,
    method: z.enum(['cantrip', 'slot', 'pact', 'ritual', 'grant', 'arcanum']),
    slotLevel: level.optional(),
    grantId: id.optional(),
    componentNote: shortText(200).optional(),
  })
  .superRefine((cast, context) => {
    if ((cast.method === 'slot') !== (cast.slotLevel !== undefined))
      context.addIssue({
        code: 'custom',
        path: ['slotLevel'],
        message: '普通法术位施法须指定消耗的环阶',
      });
    if (cast.grantId !== undefined && (cast.method === 'cantrip' || cast.method === 'arcanum'))
      context.addIssue({
        code: 'custom',
        path: ['grantId'],
        message: '该方式使用职业法术，请为额外来源选择相应方式',
      });
  });

export const DndMagicEditSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('configure'), state: DndMagicStateSchema }),
  z.strictObject({ kind: z.literal('disable') }),
  z.strictObject({ kind: z.literal('end-concentration') }),
  z.strictObject({ kind: z.literal('scribe'), spellId: id, confirmed: z.literal(true) }),
  z.strictObject({ kind: z.literal('recover-pact'), confirmed: z.literal(true) }),
  CastSchema,
  z.strictObject({ kind: z.literal('spend'), resourceId: id, amount: amount.min(1) }),
  z.strictObject({
    kind: z.literal('restore'),
    resourceId: z
      .string()
      .regex(/^(?:(?:(?:grant|custom):)?[A-Za-z0-9_-]{1,100}|slot:[1-9])$/, '恢复资源编号无效'),
    amount: amount.min(1),
    reason: shortText(200),
  }),
  z.strictObject({
    kind: z.literal('rest'),
    rest: z.enum(['short', 'long']),
    confirmed: z.literal(true),
    hitDice: z.number().int().min(0).max(20).optional(),
    arcaneRecovery: z.array(z.number().int().min(1).max(5)).max(10).optional(),
    sorcerousRestoration: z.boolean().optional(),
    prepared: spellIds(30).optional(),
  }),
]);

export type DndMagicEdit = z.infer<typeof DndMagicEditSchema>;
type CastEdit = Extract<DndMagicEdit, { kind: 'cast' }>;
type RestEdit = Extract<DndMagicEdit, { kind: 'rest' }>;
export type DndSpellLookup = (id: string) => DndSpellReference | undefined;
export type DndMagicCharacter = Character & { dndMagic?: DndMagicState };
export interface DndMagicContext {
  catalog?: DndSpellLookup;
  rng?: DieRandom;
  slotSpentThisTurn?: boolean;
  castingBlockedReason?: string;
}
export interface DndMagicResult {
  state: DndMagicState | undefined;
  hp: number;
  summary: string;
  spell?: DndSpellReference;
  level?: number;
  attackBonus?: number;
  saveDc?: number;
  concentration?: { spellId: string; name: string };
  hitDiceRolls?: number[];
  spentSlot?: boolean;
  componentNote?: string;
}

export interface DndResourceProfile {
  id: DndMagicPresetId;
  name: string;
  max: number | null;
  recovery: DndResourceRecovery;
}

type PreparationChange = 'none' | 'one' | 'all';
type SpellAbility = z.infer<typeof ability>;
type Caster = keyof typeof prepared2024;
type KnownCaster = keyof typeof known2014;

const classTraits: Record<
  string,
  { hitDie: number; caster?: Caster; ability?: SpellAbility; progression?: SlotProgression }
> = {
  野蛮人: { hitDie: 12 },
  吟游诗人: { hitDie: 8, caster: 'bard', ability: 'cha', progression: 'full' },
  牧师: { hitDie: 8, caster: 'cleric', ability: 'wis', progression: 'full' },
  德鲁伊: { hitDie: 8, caster: 'druid', ability: 'wis', progression: 'full' },
  战士: { hitDie: 10 },
  武僧: { hitDie: 8 },
  圣武士: { hitDie: 10, caster: 'paladin', ability: 'cha', progression: 'half' },
  游侠: { hitDie: 10, caster: 'ranger', ability: 'wis', progression: 'half' },
  游荡者: { hitDie: 8 },
  术士: { hitDie: 6, caster: 'sorcerer', ability: 'cha', progression: 'full' },
  邪术师: { hitDie: 8, caster: 'warlock', ability: 'cha', progression: 'pact' },
  法师: { hitDie: 6, caster: 'wizard', ability: 'int', progression: 'full' },
};

const cantripBase: Partial<Record<Caster, number>> = {
  bard: 2,
  cleric: 3,
  druid: 2,
  sorcerer: 4,
  warlock: 2,
  wizard: 3,
};
const arcanumResource: Record<number, DndMagicPresetId> = {
  6: 'arcanum-6',
  7: 'arcanum-7',
  8: 'arcanum-8',
  9: 'arcanum-9',
};

const archetypeClass = { 'eldritch-knight': '战士', 'arcane-trickster': '游荡者' } as const;
const mageHand = { '2014': 'spell-0236816b1a53783f', '2024': 'spell-a5945c3c002014da' };
const autoSpells2024 = {
  hunterMark: 'spell-3bea05b129d6cf18',
  divineSmite: 'spell-6b912298afb6e8ac',
  findSteed: 'spell-1500c284181f4dd6',
  findFamiliar: 'spell-196fa0843a1bb72f',
  contactOtherPlane: 'spell-eadb1e54c326252d',
  powerWordHeal: 'spell-5653162ac83df474',
  powerWordKill: 'spell-74e0b83ab8f074c9',
};

interface AutomaticSpell {
  spellId: string;
  resourceId: DndMagicPresetId | null;
  ritual: boolean;
}

export interface DndMagicProfile {
  edition: DndEdition;
  ability: SpellAbility | null;
  attackBonus: number | null;
  saveDc: number | null;
  mode: 'none' | 'known' | 'prepared' | 'spellbook';
  slots: number[];
  pact: { level: number; max: number } | null;
  cantripLimit: number;
  knownLimit: number;
  preparedLimit: number;
  secretLimit: number;
  arcanumLevels: number[];
  hitDie: number | null;
  resources: DndResourceProfile[];
  automaticSpells: AutomaticSpell[];
  spellLists: string[];
  cantripList: string | null;
  requiredCantrip: string | null;
  longPreparation: PreparationChange;
  shortPreparation: PreparationChange;
  ritualMode: 'none' | 'known' | 'prepared' | 'spellbook';
}

export function createDndMagicState(): DndMagicState {
  return {
    cantrips: [],
    known: [],
    prepared: [],
    spellbook: [],
    secrets: [],
    arcanum: [],
    grants: [],
    slotsUsed: dndSlotTable('none', 1, '2014'),
    pactUsed: 0,
    hitDiceUsed: 0,
    presetSpent: {},
    customResources: [],
  };
}

function baseResources(
  className: string,
  edition: DndEdition,
  level: number,
  charisma: number,
): DndResourceProfile[] {
  const modern = edition === '2024';
  const resources: DndResourceProfile[] = [];
  const add = (
    id: DndMagicPresetId,
    name: string,
    max: number | null,
    recovery: DndResourceRecovery,
  ) => {
    resources.push({ id, name, max, recovery });
  };
  switch (className) {
    case '野蛮人':
      add(
        'rage',
        '狂暴',
        !modern && level === 20 ? null : barbarianRage[level - 1],
        modern ? 'short-one' : 'long',
      );
      break;
    case '吟游诗人':
      add('bardic-inspiration', '诗人激励', Math.max(1, charisma), level >= 5 ? 'short' : 'long');
      break;
    case '牧师':
      if (level >= 2)
        add(
          'channel-divinity',
          '引导神力',
          (modern ? 2 : 1) + Number(level >= 6) + Number(level >= 18),
          modern ? 'short-one' : 'short',
        );
      break;
    case '德鲁伊':
      if (level >= 2)
        add(
          'wild-shape',
          '荒野变形',
          !modern && level === 20
            ? null
            : 2 + (modern ? Number(level >= 6) + Number(level >= 17) : 0),
          modern ? 'short-one' : 'short',
        );
      break;
    case '战士':
      add(
        'second-wind',
        '回气',
        modern ? fighterSecondWind2024[level - 1] : 1,
        modern ? 'short-one' : 'short',
      );
      if (level >= 2) add('action-surge', '动作如潮', level >= 17 ? 2 : 1, 'short');
      if (level >= 9)
        add('indomitable', '不屈', 1 + Number(level >= 13) + Number(level >= 17), 'long');
      break;
    case '武僧':
      if (level >= 2) add('focus', modern ? '功力点' : '气', level, 'short');
      break;
    case '圣武士':
      add('lay-on-hands', '圣疗', level * 5, 'long');
      if (level >= 3)
        add(
          'channel-divinity',
          '引导神力',
          modern ? 2 + Number(level >= 11) : 1,
          modern ? 'short-one' : 'short',
        );
      if (modern && level >= 2) add('divine-smite', '至圣斩免费施展', 1, 'long');
      if (modern && level >= 5) add('faithful-steed', '忠实坐骑', 1, 'long');
      break;
    case '游侠':
      if (modern) add('favored-enemy', '宿敌 · 猎人印记', 2 + Math.floor((level - 1) / 4), 'long');
      break;
    case '游荡者':
      if (level === 20) add('stroke-of-luck', '幸运一击', 1, 'short');
      break;
    case '术士':
      if (level >= 2) add('sorcery-points', '术法点', level, 'long');
      if (modern) {
        add('innate-sorcery', '先天术法', 2, 'long');
        if (level >= 5) add('sorcerous-restoration', '术法复苏', 1, 'long');
      }
      break;
    case '邪术师':
      if (modern && level >= 2) add('magical-cunning', '秘法回流', 1, 'long');
      if (modern && level >= 9) add('contact-patron', '联络宗主', 1, 'long');
      if (!modern && level === 20) add('eldritch-master', '魔能掌控', 1, 'long');
      for (const [rank, key] of Object.entries(arcanumResource)) {
        if (level >= 2 * Number(rank) - 1) add(key, `玄奥秘法 · ${rank} 环`, 1, 'long');
      }
      break;
    case '法师':
      add('arcane-recovery', '奥术回想', 1, 'long');
      break;
  }
  return resources;
}

function classAutomaticSpells(
  className: string,
  edition: DndEdition,
  level: number,
): AutomaticSpell[] {
  if (edition !== '2024') return [];
  const result: AutomaticSpell[] = [];
  const add = (spellId: string, resourceId: DndMagicPresetId | null, ritual = true) => {
    result.push({ spellId, resourceId, ritual });
  };
  if (className === '游侠') add(autoSpells2024.hunterMark, 'favored-enemy');
  if (className === '圣武士' && level >= 2) add(autoSpells2024.divineSmite, 'divine-smite');
  if (className === '圣武士' && level >= 5) add(autoSpells2024.findSteed, 'faithful-steed');
  if (className === '德鲁伊' && level >= 2) add(autoSpells2024.findFamiliar, 'wild-shape', false);
  if (className === '邪术师' && level >= 9) add(autoSpells2024.contactOtherPlane, 'contact-patron');
  if (className === '吟游诗人' && level === 20) {
    add(autoSpells2024.powerWordHeal, null);
    add(autoSpells2024.powerWordKill, null);
  }
  return result;
}

export function getDndMagicProfile(card: DndMagicCharacter): DndMagicProfile | null {
  if (card.rule !== 'dnd') return null;
  const edition = getDndEdition(card.dndEdition);
  const modern = edition === '2024';
  const className = modern && card.occupation === '魔契师' ? '邪术师' : card.occupation;
  const config = Object.hasOwn(classTraits, className) ? classTraits[className] : undefined;
  const level = card.level;
  const trait = card.dndMagic?.subclass;
  const third = trait && archetypeClass[trait] === className && level >= 3;
  const caster = config?.caster;
  const progression = third ? 'third' : (config?.progression ?? 'none');
  const slots = dndSlotTable(progression, level, edition);
  const pact =
    progression === 'pact'
      ? {
          level: Math.min(5, Math.ceil(level / 2)),
          max: level === 1 ? 1 : level < 11 ? 2 : level < 17 ? 3 : 4,
        }
      : null;
  const ability = third ? 'int' : pact || slots[0] > 0 ? (config?.ability ?? null) : null;
  const hasCasting = ability !== null;
  const knownTable =
    caster && Object.hasOwn(known2014, caster) ? known2014[caster as KnownCaster] : undefined;
  const mode = !hasCasting
    ? 'none'
    : caster === 'wizard'
      ? 'spellbook'
      : !modern && (knownTable || third)
        ? 'known'
        : 'prepared';
  const knownLimit =
    mode === 'known' ? ((third ? thirdSpellLimits : knownTable)?.[level - 1] ?? 0) : 0;
  const baseCantrips = caster ? (cantripBase[caster] ?? 0) : 0;
  const cantripLimit = third
    ? (trait === 'arcane-trickster' ? 3 : 2) +
      Number(level >= 10 && (!modern || trait === 'eldritch-knight'))
    : baseCantrips
      ? baseCantrips + Number(level >= 4) + Number(level >= 10)
      : 0;
  const preparedLimit =
    mode === 'none' || mode === 'known'
      ? 0
      : modern
        ? ((third ? thirdSpellLimits : caster ? prepared2024[caster] : [])?.[level - 1] ?? 0)
        : Math.max(
            1,
            (caster === 'paladin' ? Math.floor(level / 2) : level) +
              abilityModifier(card.attributes[ability!]),
          );
  const baseList = third
    ? '法师'
    : !hasCasting
      ? null
      : modern && className === '邪术师'
        ? '魔契师'
        : className;
  const spellLists = !baseList
    ? []
    : modern && caster === 'bard' && level >= 10
      ? [baseList, '牧师', '德鲁伊', '法师']
      : [baseList];
  const effectiveAbility = ability
    ? abilityModifier(effectiveCharacter(card).attributes[ability])
    : null;
  const attackBonus = effectiveAbility === null ? null : proficiencyBonus(level) + effectiveAbility;
  const longPreparation =
    mode === 'spellbook' ||
    caster === 'cleric' ||
    caster === 'druid' ||
    (hasCasting && caster === 'paladin') ||
    (modern && caster === 'ranger')
      ? 'all'
      : 'none';
  const ritualMode =
    mode === 'spellbook'
      ? 'spellbook'
      : modern && hasCasting
        ? 'prepared'
        : caster === 'bard'
          ? 'known'
          : caster === 'cleric' || caster === 'druid'
            ? 'prepared'
            : 'none';

  return {
    edition,
    ability,
    attackBonus,
    saveDc: attackBonus === null ? null : 8 + attackBonus,
    mode,
    slots,
    pact,
    cantripLimit,
    knownLimit,
    preparedLimit,
    secretLimit:
      !modern && caster === 'bard'
        ? 2 * [10, 14, 18].filter((required) => level >= required).length
        : 0,
    arcanumLevels: pact ? [6, 7, 8, 9].filter((rank) => level >= 2 * rank - 1) : [],
    hitDie: config?.hitDie ?? null,
    resources: baseResources(className, edition, level, abilityModifier(card.attributes.cha)),
    automaticSpells: classAutomaticSpells(className, edition, level),
    spellLists,
    cantripList: baseList,
    requiredCantrip: third && trait === 'arcane-trickster' ? mageHand[edition] : null,
    longPreparation,
    shortPreparation: modern && caster === 'wizard' && level >= 5 ? 'one' : 'none',
    ritualMode,
  };
}

export type DndMagicSpellList =
  'cantrips' | 'known' | 'prepared' | 'spellbook' | 'secrets' | 'arcanum';
const spellLists: DndMagicSpellList[] = [
  'cantrips',
  'known',
  'prepared',
  'spellbook',
  'secrets',
  'arcanum',
];

function highestSlot(profile: DndMagicProfile): number {
  return (
    profile.pact?.level ??
    profile.slots.reduce((highest, count, index) => (count ? index + 1 : highest), 0)
  );
}

/** Candidate filter. The actual selection also checks list budgets and the spellbook relationship. */
export function canChooseDndSpell(
  profile: DndMagicProfile,
  spell: DndSpellReference,
  list: DndMagicSpellList,
): boolean {
  const rank = spell.level;
  if (spell.edition !== profile.edition || spell.source.category !== 'core' || rank === null)
    return false;
  if (list === 'secrets')
    return profile.secretLimit > 0 && rank <= highestSlot(profile) && !!spell.classes?.length;
  if (list === 'arcanum')
    return (
      profile.arcanumLevels.includes(rank) &&
      profile.spellLists.some((name) => spell.classes?.includes(name))
    );
  if (list === 'cantrips')
    return (
      rank === 0 && profile.cantripList !== null && !!spell.classes?.includes(profile.cantripList)
    );
  if (list === 'known' && profile.mode !== 'known') return false;
  if (list === 'spellbook' && profile.mode !== 'spellbook') return false;
  if (list === 'prepared' && profile.mode !== 'prepared' && profile.mode !== 'spellbook')
    return false;
  return (
    rank >= 1 &&
    rank <= highestSlot(profile) &&
    !profile.automaticSpells.some(({ spellId }) => spellId === spell.id) &&
    profile.spellLists.some((name) => spell.classes?.includes(name))
  );
}

const spellName = (spell: DndSpellReference) => spell.nameZh || spell.nameEn || spell.id;

function resolveSpell(
  spellId: string,
  edition: DndEdition,
  catalog?: DndSpellLookup,
): DndSpellReference & { level: number } {
  const spell = catalog?.(spellId);
  if (!spell || spell.id !== spellId || spell.edition !== edition || spell.level === null)
    throw new Error(`找不到同版次、环阶明确的法术「${spellId}」`);
  return { ...spell, level: spell.level };
}

export function getDndMagicErrors(card: DndMagicCharacter, catalog?: DndSpellLookup): string[] {
  if (card.dndMagic === undefined) return [];
  if (card.rule !== 'dnd') return ['法术与资源管理仅适用于 D&D'];
  const parsed = DndMagicStateSchema.safeParse(card.dndMagic);
  if (!parsed.success)
    return parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '魔法状态'}：${issue.message}`,
    );
  const state = parsed.data;
  const profile = getDndMagicProfile({ ...card, dndMagic: state })!;
  const errors: string[] = [];
  if (state.subclass && (archetypeClass[state.subclass] !== card.occupation || card.level < 3))
    errors.push('该施法子职须匹配职业并达到 3 级');
  const requiredCantrip =
    profile.requiredCantrip && !state.cantrips.includes(profile.requiredCantrip) ? 1 : 0;
  if (state.cantrips.length + requiredCantrip > profile.cantripLimit)
    errors.push('已选职业戏法超过名额');
  if (state.known.length + state.secrets.length > profile.knownLimit)
    errors.push('已知职业法术超过名额');
  if (state.prepared.length > profile.preparedLimit) errors.push('准备职业法术超过名额');
  if (state.secrets.length > profile.secretLimit) errors.push('魔法奥秘超过当前职业等级的名额');
  if (state.arcanum.length > profile.arcanumLevels.length)
    errors.push('玄奥秘法超过当前职业等级的名额');
  if (state.spellbook.length && profile.mode !== 'spellbook') errors.push('职业法术书仅适用于法师');
  if (
    profile.mode === 'spellbook' &&
    state.prepared.some((spellId) => !state.spellbook.includes(spellId))
  )
    errors.push('法师只能从法术书中选择职业准备法术');
  const chosen = [
    ...state.cantrips,
    ...state.known,
    ...state.prepared,
    ...state.secrets,
    ...state.arcanum,
  ];
  if (new Set(chosen).size !== chosen.length) errors.push('同一职业法术不可重复计入不同名额');
  if (state.slotsUsed.some((used, index) => used > profile.slots[index]))
    errors.push('普通法术位的已用数量超过上限');
  if (state.pactUsed > (profile.pact?.max ?? 0)) errors.push('契约魔法的已用法术位超过上限');
  if (state.hitDiceUsed > (profile.hitDie ? card.level : 0)) errors.push('已用生命骰超过职业等级');
  for (const [key, used] of Object.entries(state.presetSpent)) {
    const resource = profile.resources.find((item) => item.id === key);
    if (used > (resource?.max ?? 0)) errors.push(`${resource?.name ?? key}的已用数量超过上限`);
  }
  if (!catalog) return errors;

  const resolved = new Map<string, DndSpellReference & { level: number }>();
  for (const spellId of new Set([
    ...chosen,
    ...state.spellbook,
    ...state.grants.map((grant) => grant.spellId),
  ])) {
    try {
      resolved.set(spellId, resolveSpell(spellId, profile.edition, catalog));
    } catch (error) {
      errors.push((error as Error).message);
    }
  }
  for (const list of spellLists) {
    for (const spellId of state[list]) {
      const spell = resolved.get(spellId);
      if (spell && !canChooseDndSpell(profile, spell, list))
        errors.push(`「${spellName(spell)}」不符合该职业法术列表或环阶`);
    }
  }
  for (const grant of state.grants) {
    const spell = resolved.get(grant.spellId);
    if (spell && grant.allowRitual && (spell.level === 0 || spell.ritual !== true))
      errors.push(`「${spellName(spell)}」没有仪式标签`);
  }
  const arcanumRanks = state.arcanum
    .map((spellId) => resolved.get(spellId)?.level)
    .filter((rank) => rank !== undefined);
  if (new Set(arcanumRanks).size !== arcanumRanks.length)
    errors.push('每个玄奥秘法环阶只可选择一道法术');

  if (profile.edition === '2014' && state.subclass) {
    const schools = state.subclass === 'eldritch-knight' ? ['防护', '塑能'] : ['惑控', '幻术'];
    const unrestricted = [3, 8, 14, 20].filter((required) => card.level >= required).length;
    const outside = state.known.filter((spellId) => {
      const spell = resolved.get(spellId);
      return spell && !schools.some((school) => spell.school?.startsWith(school));
    }).length;
    if (outside > unrestricted) errors.push('2014 施法子职的不限学派法术超过名额');
  }
  const secretRanks = state.secrets
    .map((spellId) => resolved.get(spellId)?.level ?? 0)
    .sort((a, b) => b - a);
  const secretCaps = [18, 14, 10]
    .filter((required) => card.level >= required)
    .flatMap((required) => {
      const rank = Math.ceil(required / 2);
      return [rank, rank];
    });
  if (secretRanks.some((rank, index) => rank > (secretCaps[index] ?? 0)))
    errors.push('魔法奥秘超过取得该名额时可施展的法术环阶');
  return [...new Set(errors)];
}

function requireValidMagic(card: DndMagicCharacter, catalog?: DndSpellLookup) {
  const errors = getDndMagicErrors(card, catalog);
  if (errors.length) throw new Error(errors.join('；'));
}

function spendPreset(
  state: DndMagicState,
  profile: DndMagicProfile,
  resourceId: DndMagicPresetId,
  amount: number,
) {
  const resource = profile.resources.find((entry) => entry.id === resourceId);
  if (!resource) throw new Error('当前职业没有这项资源');
  if (resource.max === null) return resource.name;
  const next = (state.presetSpent[resourceId] ?? 0) + amount;
  if (next > resource.max) throw new Error(`「${resource.name}」剩余次数不足`);
  state.presetSpent[resourceId] = next;
  return resource.name;
}

function restoreMagicResource(
  state: DndMagicState,
  profile: DndMagicProfile,
  resourceId: string,
  amount: number,
): string {
  const reduceUsed = (used: number, name: string) => {
    if (amount > used) throw new Error(`「${name}」已消耗 ${used}，恢复数量超出已消耗额度`);
    return used - amount;
  };
  if (resourceId === 'pact') {
    if (!profile.pact) throw new Error('当前职业没有契约法术位');
    const name = `${profile.pact.level} 环契约法术位`;
    state.pactUsed = reduceUsed(state.pactUsed, name);
    return name;
  }
  if (resourceId === 'hit-dice') {
    if (!profile.hitDie) throw new Error('当前职业没有可管理的生命骰');
    const name = `d${profile.hitDie} 生命骰`;
    state.hitDiceUsed = reduceUsed(state.hitDiceUsed, name);
    return name;
  }
  if (resourceId.startsWith('slot:')) {
    const rank = Number(resourceId.slice('slot:'.length));
    const index = rank - 1;
    if (!profile.slots[index]) throw new Error(`当前职业没有 ${rank} 环普通法术位`);
    const name = `${rank} 环普通法术位`;
    state.slotsUsed[index] = reduceUsed(state.slotsUsed[index], name);
    return name;
  }
  if (resourceId.startsWith('grant:')) {
    const grant = state.grants.find(({ id }) => id === resourceId.slice('grant:'.length));
    if (!grant?.free) throw new Error('此授予没有可恢复的施法次数');
    if (grant.free.max === null) throw new Error(`「${grant.label}」可无限使用，无需恢复`);
    grant.free.used = reduceUsed(grant.free.used, grant.label);
    return grant.label;
  }

  const customId = resourceId.startsWith('custom:')
    ? resourceId.slice('custom:'.length)
    : resourceId;
  const custom = state.customResources.find(({ id }) => id === customId);
  if (custom) {
    custom.used = reduceUsed(custom.used, custom.name);
    return custom.name;
  }
  const preset = profile.resources.find(({ id }) => id === resourceId);
  if (!preset) throw new Error('找不到该角色资源');
  if (preset.max === null) throw new Error(`「${preset.name}」可无限使用，无需恢复`);
  state.presetSpent[preset.id] = reduceUsed(state.presetSpent[preset.id] ?? 0, preset.name);
  return preset.name;
}

function spellCast(
  card: DndMagicCharacter,
  state: DndMagicState,
  profile: DndMagicProfile,
  edit: CastEdit,
  context: DndMagicContext,
): DndMagicResult {
  if (context.castingBlockedReason) throw new Error(context.castingBlockedReason);
  const spell = resolveSpell(edit.spellId, profile.edition, context.catalog);
  const grant =
    edit.grantId === undefined
      ? undefined
      : state.grants.find((entry) => entry.id === edit.grantId && entry.spellId === spell.id);
  if (edit.grantId !== undefined && !grant) throw new Error('角色没有此法术的指定授予来源');
  const automatic = profile.automaticSpells.find((entry) => entry.spellId === spell.id);
  const known = state.known.includes(spell.id) || state.secrets.includes(spell.id);
  const prepared = state.prepared.includes(spell.id);
  const available = grant ? grant.allowSlots : known || prepared || automatic !== undefined;
  const spentSlot = edit.method === 'slot' || edit.method === 'pact';
  if (spentSlot && profile.edition === '2024' && context.slotSpentThisTurn)
    throw new Error('2024 规则同一回合只能消耗一个法术位来施法');

  let rank = spell.level;
  let method: string;
  switch (edit.method) {
    case 'cantrip':
      if (
        rank !== 0 ||
        (!state.cantrips.includes(spell.id) && !known && profile.requiredCantrip !== spell.id)
      )
        throw new Error('角色未习得此职业戏法');
      method = '戏法';
      break;
    case 'slot': {
      const requested = edit.slotLevel!;
      if (rank < 1 || !available) throw new Error('角色没有以法术位施展此法术的准备或授予资格');
      if (requested < rank) throw new Error('所选法术位环阶低于法术环阶');
      const index = requested - 1;
      if (state.slotsUsed[index] >= profile.slots[index]) throw new Error('该环阶的普通法术位不足');
      state.slotsUsed[index] += 1;
      rank = requested;
      method = `${rank} 环普通法术位`;
      break;
    }
    case 'pact':
      if (rank < 1 || !available) throw new Error('角色没有以契约法术位施展此法术的准备或授予资格');
      if (!profile.pact || profile.pact.level < rank || state.pactUsed >= profile.pact.max)
        throw new Error('没有足够环阶或剩余数量的契约法术位');
      state.pactUsed += 1;
      rank = profile.pact.level;
      method = `${rank} 环契约法术位`;
      break;
    case 'ritual': {
      const allowed = grant
        ? grant.allowRitual
        : automatic?.ritual ||
          (profile.ritualMode === 'spellbook' && state.spellbook.includes(spell.id)) ||
          (profile.ritualMode === 'known' && known) ||
          (profile.ritualMode === 'prepared' && prepared);
      if (rank === 0 || spell.ritual !== true || !allowed)
        throw new Error('该法术不符合角色的仪式施法资格');
      method = '仪式，施法时间增加 10 分钟';
      break;
    }
    case 'grant':
      if (grant?.free) {
        if (grant.free.max !== null) {
          if (grant.free.used >= grant.free.max)
            throw new Error(`「${grant.label}」的施法次数已用完`);
          grant.free.used += 1;
        }
        method = grant.label;
      } else if (!grant && automatic?.resourceId) {
        method = spendPreset(state, profile, automatic.resourceId, 1);
      } else throw new Error('没有对此法术的不耗法术位施展权限');
      break;
    case 'arcanum':
      if (!state.arcanum.includes(spell.id) || !profile.arcanumLevels.includes(rank))
        throw new Error('该法术未选为玄奥秘法');
      method = spendPreset(state, profile, arcanumResource[rank], 1);
      break;
  }

  const castAbility = grant?.ability ?? profile.ability;
  const abilityBonus = castAbility
    ? abilityModifier(effectiveCharacter(card).attributes[castAbility]) +
      proficiencyBonus(card.level)
    : undefined;
  const name = spellName(spell);
  const concentration =
    spell.concentration === true ? { spellId: spell.id, name: name.slice(0, 200) } : undefined;
  if (concentration) state.concentration = concentration.name;
  return {
    state,
    hp: card.hp,
    summary: `施展「${name}」（${method}）`,
    spell,
    level: rank,
    attackBonus: grant?.attackBonus ?? abilityBonus,
    saveDc: grant?.saveDc ?? (abilityBonus === undefined ? undefined : 8 + abilityBonus),
    concentration,
    spentSlot,
    componentNote: edit.componentNote,
  };
}

function recoveredUse(used: number, recovery: DndResourceRecovery, rest: 'short' | 'long'): number {
  if (recovery === 'none' || (rest === 'short' && recovery === 'long')) return used;
  return rest === 'short' && recovery === 'short-one' ? Math.max(0, used - 1) : 0;
}

function hitDieRoll(sides: number, rng?: DieRandom): number {
  if (rng) {
    const result = rng(sides);
    if (!Number.isInteger(result) || result < 1 || result > sides)
      throw new Error(`随机源必须返回 1 至 ${sides} 的整数`);
    return result;
  }
  const range = 0x1_0000_0000;
  const limit = range - (range % sides);
  const value = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(value);
  } while (value[0] >= limit);
  return (value[0] % sides) + 1;
}

function applyRest(
  card: DndMagicCharacter,
  state: DndMagicState,
  profile: DndMagicProfile,
  edit: RestEdit,
  context: DndMagicContext,
): DndMagicResult {
  const short = edit.rest === 'short';
  const dice = edit.hitDice ?? 0;
  const arcane = edit.arcaneRecovery ?? [];
  if (card.hp === 0 && (!short || profile.edition === '2024'))
    throw new Error('该休息开始时须至少有 1 点 HP');
  if (!short && (dice || arcane.length || edit.sorcerousRestoration))
    throw new Error('这些恢复选项仅在完成短休时使用');
  if (dice && (!profile.hitDie || dice > card.level - state.hitDiceUsed))
    throw new Error('可用生命骰不足');
  if (edit.prepared) {
    if (edit.prepared.length > 0 && !context.catalog) throw new Error('请先载入对应版次的法术资料');
    const change = short ? profile.shortPreparation : profile.longPreparation;
    const newCount = edit.prepared.filter((spellId) => !state.prepared.includes(spellId)).length;
    if (
      change === 'none' ||
      (change === 'one' && (newCount > 1 || edit.prepared.length !== state.prepared.length))
    )
      throw new Error('该职业无法在此次休息中按所选方式更改准备法术');
    state.prepared = edit.prepared;
    requireValidMagic({ ...card, dndMagic: state }, context.catalog);
  }

  // All eligibility checks happen before consuming randomness for healing dice.
  if (arcane.length) {
    if (arcane.reduce((sum, rank) => sum + rank, 0) > Math.ceil(card.level / 2))
      throw new Error('奥术回想所选法术位的环阶总和超出名额');
    spendPreset(state, profile, 'arcane-recovery', 1);
    for (const rank of arcane) {
      if (state.slotsUsed[rank - 1] === 0) throw new Error('奥术回想只能恢复已消耗的法术位');
      state.slotsUsed[rank - 1] -= 1;
    }
  }
  if (edit.sorcerousRestoration) {
    if (!state.presetSpent['sorcery-points']) throw new Error('没有已消耗的术法点');
    spendPreset(state, profile, 'sorcerous-restoration', 1);
    state.presetSpent['sorcery-points'] = Math.max(
      0,
      state.presetSpent['sorcery-points'] - Math.floor(card.level / 2),
    );
  } else if (
    short &&
    profile.edition === '2014' &&
    card.occupation === '术士' &&
    card.level === 20
  ) {
    state.presetSpent['sorcery-points'] = Math.max(
      0,
      (state.presetSpent['sorcery-points'] ?? 0) - 4,
    );
  }

  state.pactUsed = 0;
  for (const resource of profile.resources) {
    const spent = state.presetSpent[resource.id];
    if (spent !== undefined)
      state.presetSpent[resource.id] = recoveredUse(spent, resource.recovery, edit.rest);
  }
  for (const resource of state.customResources)
    resource.used = recoveredUse(resource.used, resource.recovery, edit.rest);
  for (const grant of state.grants)
    if (grant.free) grant.free.used = recoveredUse(grant.free.used, grant.free.recovery, edit.rest);

  if (!short) {
    const restoredDice = Math.min(
      state.hitDiceUsed,
      profile.edition === '2024' ? card.level : Math.max(1, Math.floor(card.level / 2)),
    );
    state.hitDiceUsed -= restoredDice;
    state.slotsUsed.fill(0);
    return {
      state,
      hp: card.maxHp,
      summary: `完成长休，HP 恢复到 ${card.maxHp}，恢复 ${restoredDice} 枚生命骰`,
    };
  }

  const hitDiceRolls = Array.from({ length: dice }, () => hitDieRoll(profile.hitDie!, context.rng));
  const con = abilityModifier(effectiveCharacter(card).attributes.con);
  const healing =
    profile.edition === '2024' && hitDiceRolls.length
      ? Math.max(
          1,
          hitDiceRolls.reduce((sum, die) => sum + die + con, 0),
        )
      : hitDiceRolls.reduce((sum, die) => sum + Math.max(0, die + con), 0);
  const hp = Math.min(card.maxHp, card.hp + healing);
  state.hitDiceUsed += dice;
  return {
    state,
    hp,
    hitDiceRolls,
    summary: `完成短休${dice ? `，消耗 ${dice} 枚生命骰，恢复 ${hp - card.hp} HP` : ''}`,
  };
}

/** Pure state transition. Request authorization, retries, encounter synchronization and logging are handled by the caller. */
export function applyDndMagicEdit(
  card: DndMagicCharacter,
  input: DndMagicEdit,
  context: DndMagicContext = {},
): DndMagicResult {
  if (card.rule !== 'dnd') throw new Error('法术与资源管理仅适用于 D&D');
  const parsed = DndMagicEditSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? '魔法操作格式无效');
  const edit = parsed.data;
  if (edit.kind === 'disable')
    return { state: undefined, hp: card.hp, summary: '关闭法术与资源管理' };
  if (edit.kind === 'configure') {
    requireValidMagic({ ...card, dndMagic: edit.state }, context.catalog);
    return { state: edit.state, hp: card.hp, summary: '更新法术与资源配置' };
  }
  if (!card.dndMagic) throw new Error('请先启用法术与资源管理');
  requireValidMagic(card, context.catalog);
  const profile = getDndMagicProfile(card)!;
  const state = structuredClone(card.dndMagic);
  if (edit.kind === 'cast') return spellCast(card, state, profile, edit, context);
  if (edit.kind === 'rest') return applyRest(card, state, profile, edit, context);
  let summary: string;
  switch (edit.kind) {
    case 'end-concentration':
      delete state.concentration;
      summary = '结束专注';
      break;
    case 'scribe': {
      const spell = resolveSpell(edit.spellId, profile.edition, context.catalog);
      if (profile.mode !== 'spellbook' || !canChooseDndSpell(profile, spell, 'spellbook'))
        throw new Error('只能向法师法术书抄录当前环阶的法师法术');
      if (state.spellbook.includes(spell.id)) throw new Error('法术书已包含该法术');
      state.spellbook.push(spell.id);
      requireValidMagic({ ...card, dndMagic: state }, context.catalog);
      summary = `抄录「${spellName(spell)}」到法术书（基础用时 ${spell.level * 2} 小时，费用 ${spell.level * 50} GP）`;
      break;
    }
    case 'recover-pact': {
      if (!profile.pact || !state.pactUsed) throw new Error('没有已消耗的契约法术位');
      const resource = profile.edition === '2024' ? 'magical-cunning' : 'eldritch-master';
      const label = spendPreset(state, profile, resource, 1);
      const limit = card.level === 20 ? profile.pact.max : Math.ceil(profile.pact.max / 2);
      const regained = Math.min(state.pactUsed, limit);
      state.pactUsed -= regained;
      summary = `使用「${label}」，恢复 ${regained} 枚契约法术位`;
      break;
    }
    case 'spend': {
      const custom = state.customResources.find((resource) => resource.id === edit.resourceId);
      const preset = presetIds.safeParse(edit.resourceId);
      let label: string;
      if (custom) {
        if (custom.used + edit.amount > custom.max)
          throw new Error(`「${custom.name}」剩余次数不足`);
        custom.used += edit.amount;
        label = custom.name;
      } else if (preset.success) label = spendPreset(state, profile, preset.data, edit.amount);
      else throw new Error('找不到该角色资源');
      summary = `消耗「${label}」${edit.amount} 次`;
      break;
    }
    case 'restore': {
      const label = restoreMagicResource(state, profile, edit.resourceId, edit.amount);
      requireValidMagic({ ...card, dndMagic: state }, context.catalog);
      summary = `手动恢复「${label}」× ${edit.amount}（${edit.reason}）`;
      break;
    }
  }
  return { state, hp: card.hp, summary };
}
