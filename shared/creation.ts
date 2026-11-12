import { z } from 'zod';
import type { Character, RuleId } from './types';
import { COC_ATTRIBUTES, DND_ATTRIBUTES, DND_SKILLS, DND_2024_BACKGROUNDS } from './catalog';
import {
  COC_SKILL_CATALOG,
  CocCareerSchema,
  CocCustomSkillKeySchema,
  CocSkillKeySchema,
  chooseCocOccupationSkills,
  cocCareerErrors,
  cocOccupationBranches,
  cocOccupationProfile,
  cocSkillBase,
  cocSkillDefinitions,
  occupationOptions,
  type CocCareer,
} from './coc-career';
import { synchronizeCocInvestigator } from './coc-physical';
import { getDndEdition } from './dnd-edition';

export {
  COC_OCCUPATION_RULES,
  cocSkillBase,
  occupationOptions,
  type OccupationProfile,
} from './coc-career';

const keys = (value: string) => value.split(' ');
const allDnd = DND_SKILLS.map((s) => s.key);
export const DND_CLASS_RULES = [
  {
    name: '野蛮人',
    count: 2,
    skills: keys('animalHandling athletics intimidation nature perception survival'),
    saves: ['str', 'con'],
  },
  { name: '吟游诗人', count: 3, skills: allDnd, saves: ['dex', 'cha'] },
  {
    name: '牧师',
    count: 2,
    skills: keys('history insight medicine persuasion religion'),
    saves: ['wis', 'cha'],
  },
  {
    name: '德鲁伊',
    count: 2,
    skills: keys('arcana animalHandling insight medicine nature perception religion survival'),
    saves: ['int', 'wis'],
  },
  {
    name: '战士',
    count: 2,
    skills: keys(
      'acrobatics animalHandling athletics history insight intimidation perception survival',
    ),
    saves: ['str', 'con'],
  },
  {
    name: '武僧',
    count: 2,
    skills: keys('acrobatics athletics history insight religion stealth'),
    saves: ['str', 'dex'],
  },
  {
    name: '圣武士',
    count: 2,
    skills: keys('athletics insight intimidation medicine persuasion religion'),
    saves: ['wis', 'cha'],
  },
  {
    name: '游侠',
    count: 3,
    skills: keys(
      'animalHandling athletics insight investigation nature perception stealth survival',
    ),
    saves: ['str', 'dex'],
  },
  {
    name: '游荡者',
    count: 4,
    skills: keys(
      'acrobatics athletics deception insight intimidation investigation perception performance persuasion sleightOfHand stealth',
    ),
    saves: ['dex', 'int'],
  },
  {
    name: '术士',
    count: 2,
    skills: keys('arcana deception insight intimidation persuasion religion'),
    saves: ['con', 'cha'],
  },
  {
    name: '邪术师',
    count: 2,
    skills: keys('arcana deception history intimidation investigation nature religion'),
    saves: ['wis', 'cha'],
  },
  {
    name: '法师',
    count: 2,
    skills: keys('arcana history insight investigation medicine religion'),
    saves: ['int', 'wis'],
  },
];
// Only the changed skill lists are overridden. The source's 2024 Warlock name
// is displayed separately from the 2014 identifier already stored in cards.
const dnd2024ClassSkills: Record<string, string[]> = {
  战士: keys(
    'acrobatics animalHandling athletics history insight intimidation persuasion perception survival',
  ),
  游荡者: keys(
    'acrobatics athletics deception insight intimidation investigation perception persuasion sleightOfHand stealth',
  ),
  法师: keys('arcana history insight investigation medicine nature religion'),
};

export function dndClassRule(card: Character) {
  const modern = getDndEdition(card.dndEdition) === '2024';
  const name = modern && card.occupation === '魔契师' ? '邪术师' : card.occupation;
  const base = DND_CLASS_RULES.find((entry) => entry.name === name);
  if (!modern || !base) return base;
  return {
    ...base,
    name: name === '邪术师' ? '魔契师' : name,
    // Primal Knowledge grants one more choice from the Barbarian skill list at level 3.
    count: name === '野蛮人' && card.level >= 3 ? base.count + 1 : base.count,
    skills: dnd2024ClassSkills[name] ?? base.skills,
  };
}

export function dndBackground(card: Character) {
  return getDndEdition(card.dndEdition) === '2024'
    ? DND_2024_BACKGROUNDS.find((entry) => entry.name === card.background.trim())
    : undefined;
}

const keySchema = CocSkillKeySchema;
const choiceList = z.array(keySchema).max(30);
const points = z
  .unknown()
  .superRefine((value, ctx) => {
    if (
      value &&
      typeof value === 'object' &&
      Object.keys(value).some((key) => ['__proto__', 'constructor', 'prototype'].includes(key))
    ) {
      ctx.addIssue({ code: 'custom', message: '点数分配包含不允许的键名', fatal: true });
    }
  })
  .pipe(z.record(keySchema, z.number().int().min(0).max(999)));
export const CreationAllocationSchema = z.discriminatedUnion('rule', [
  z
    .object({
      rule: z.literal('coc'),
      occupationSkills: z.array(z.union([keySchema, z.literal('')])).max(8),
      occupationAttribute: z.string().max(10),
      occupational: points,
      personal: points,
    })
    .strict(),
  z
    .object({
      rule: z.literal('dnd'),
      classSkills: choiceList,
      backgroundSkills: choiceList,
      ancestrySkills: choiceList,
      replacementSkills: choiceList,
      extraSkills: choiceList,
      extraSaves: choiceList,
      expertise: choiceList,
    })
    .strict(),
]);
export type CreationAllocation = z.infer<typeof CreationAllocationSchema>;
export type CocAllocation = Extract<CreationAllocation, { rule: 'coc' }>;
export type DndAllocation = Extract<CreationAllocation, { rule: 'dnd' }>;

const fieldList = new Set([
  ...COC_ATTRIBUTES.map((a) => `attributes.${a.key}`),
  ...DND_ATTRIBUTES.map((a) => `attributes.${a.key}`),
  ...COC_SKILL_CATALOG.map((a) => `skills.${a.key}`),
  ...DND_SKILLS.map((a) => `skills.${a.key}`),
  'age',
  'level',
  'hp',
  'maxHp',
  'mp',
  'maxMp',
  'san',
  'maxSan',
  'ac',
  'attributeTotal',
]);
const customSkillField = (field: string) =>
  field.startsWith('skills.') && CocCustomSkillKeySchema.safeParse(field.slice(7)).success;
const RangeSchema = z
  .object({
    field: z
      .string()
      .max(60)
      .refine((f) => fieldList.has(f) || customSkillField(f), '不支持的限制字段'),
    min: z.number().int().min(-100).max(9999),
    max: z.number().int().min(-100).max(9999),
  })
  .strict()
  .refine((r) => r.min <= r.max, '下限不能大于上限');
export const CreationPolicySchema = z
  .object({
    rule: z.enum(['dnd', 'coc']),
    cocSkillCap: z.number().int().min(1).max(99),
    requireAllPoints: z.boolean(),
    allowInterestOnOccupation: z.boolean().default(true),
    allowMythos: z.boolean(),
    dndExtraSkills: z.number().int().min(0).max(18),
    dndExtraSaves: z.number().int().min(0).max(6),
    ranges: z.array(RangeSchema).max(100),
    allowedOccupations: z.array(z.string().trim().min(1).max(80)).max(30),
    allowedAncestries: z.array(z.string().trim().min(1).max(80)).max(30),
    notes: z.string().max(2000),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (new Set(p.ranges.map((r) => r.field)).size !== p.ranges.length)
      ctx.addIssue({ code: 'custom', message: '每个数值字段只能设置一个范围' });
    const valid = new Set(policyFields(p.rule).map((f) => f.key));
    if (
      p.ranges.some((r) => !valid.has(r.field) && !(p.rule === 'coc' && customSkillField(r.field)))
    )
      ctx.addIssue({ code: 'custom', message: '包含其他规则的限制字段' });
  });
export type CreationPolicy = z.infer<typeof CreationPolicySchema>;
export function defaultCreationPolicy(rule: RuleId): CreationPolicy {
  return {
    rule,
    cocSkillCap: 99,
    requireAllPoints: false,
    allowInterestOnOccupation: true,
    allowMythos: false,
    dndExtraSkills: 0,
    dndExtraSaves: 0,
    ranges: [],
    allowedOccupations: [],
    allowedAncestries: [],
    notes: '',
  };
}
export function policyFields(rule: RuleId, card?: Character) {
  const skills =
    rule === 'coc'
      ? [
          ...COC_SKILL_CATALOG,
          ...cocSkillDefinitions(card).filter((skill) => skill.source === 'custom'),
        ]
      : DND_SKILLS;
  return [
    ...(rule === 'coc' ? COC_ATTRIBUTES : DND_ATTRIBUTES).map((a) => ({
      key: `attributes.${a.key}`,
      label: `${a.label}属性`,
    })),
    ...skills.map((s) => ({
      key: `skills.${s.key}`,
      label: `${s.label}${rule === 'coc' ? '技能' : '检定加值'}`,
    })),
    { key: 'attributeTotal', label: rule === 'coc' ? '八项属性总和（不含幸运）' : '六项属性总和' },
    { key: 'age', label: '年龄' },
    ...(rule === 'dnd'
      ? [
          { key: 'level', label: '等级' },
          { key: 'ac', label: '护甲 AC' },
        ]
      : [
          { key: 'san', label: '当前理智' },
          { key: 'mp', label: '当前 MP' },
          { key: 'maxMp', label: 'MP 上限' },
          { key: 'maxSan', label: 'SAN 上限' },
        ]),
    { key: 'hp', label: '当前 HP' },
    { key: 'maxHp', label: 'HP 上限' },
  ];
}
export function defaultAllocation(rule: RuleId, occupation = ''): CreationAllocation {
  if (rule === 'dnd')
    return {
      rule,
      classSkills: [],
      backgroundSkills: [],
      ancestrySkills: [],
      replacementSkills: [],
      extraSkills: [],
      extraSaves: [],
      expertise: [],
    };
  return defaultCocAllocation({ rule, occupation });
}
export function defaultCocAllocation(
  card: Pick<Character, 'rule' | 'occupation' | 'cocCareer'>,
): CocAllocation {
  const profile = cocOccupationProfile(card);
  return {
    rule: 'coc',
    occupationSkills: chooseCocOccupationSkills(occupationOptions(profile, card)),
    occupationAttribute: profile?.bonus[0] ?? 'edu',
    occupational: {},
    personal: {},
  };
}
const pointsSpent = (points?: Record<string, number>) =>
  Object.values(points ?? {}).reduce((sum, value) => sum + value, 0);

export function cocBudget(card: Character) {
  const profile = cocOccupationProfile(card);
  const allocation = card.creation?.rule === 'coc' ? card.creation : null;
  const bonus =
    profile?.bonus.find((key) => key === allocation?.occupationAttribute) ?? profile?.bonus[0];
  const occupational = profile?.bonus.length
    ? 2 * (card.attributes.edu + (card.attributes[bonus ?? 'edu'] ?? 0))
    : 4 * card.attributes.edu;
  return {
    occupational,
    personal: 2 * card.attributes.int,
    spentOccupation: pointsSpent(allocation?.occupational),
    spentPersonal: pointsSpent(allocation?.personal),
  };
}

export interface CocCareerChange {
  card: Character;
  returnedOccupation: number;
  returnedPersonal: number;
  removedSkillKeys: string[];
  removedAdjustments: number;
}

export function updateCocCareer(
  card: Character,
  career: CocCareer | undefined,
  occupation = card.occupation,
): CocCareerChange {
  const result: CocCareerChange = {
    card,
    returnedOccupation: 0,
    returnedPersonal: 0,
    removedSkillKeys: [],
    removedAdjustments: 0,
  };
  if (card.rule !== 'coc') return result;

  const parsed = career === undefined ? undefined : CocCareerSchema.safeParse(career);
  if (parsed && !parsed.success) throw new Error(parsed.error.issues[0]?.message);
  const { cocCareer: _previous, ...fields } = card;
  const next: Character = {
    ...fields,
    occupation,
    ...(parsed?.data ? { cocCareer: parsed.data } : {}),
  };
  const branchId = next.cocCareer?.branchId;
  if (branchId && !cocOccupationBranches(occupation).some((branch) => branch.id === branchId))
    throw new Error('职业分支与当前职业不匹配');

  const active = new Set(cocSkillDefinitions(next).map((skill) => skill.key));
  const removed = new Set(
    cocSkillDefinitions(card)
      .filter((skill) => !active.has(skill.key))
      .map((skill) => skill.key),
  );
  result.removedSkillKeys = [...removed];
  if (removed.size && card.adjustments) {
    const retain = (entry: { target: string; key: string }) => {
      if (entry.target !== 'skill' || !removed.has(entry.key)) return true;
      result.removedAdjustments += 1;
      return false;
    };
    next.adjustments = {
      permanent: card.adjustments.permanent.filter(retain),
      temporary: card.adjustments.temporary
        .map((effect) => ({ ...effect, changes: effect.changes.filter(retain) }))
        .filter((effect) => effect.changes.length > 0),
    };
  }

  const a = card.creation;
  if (a?.rule !== 'coc') {
    if (removed.size)
      next.skills = Object.fromEntries(
        Object.entries(card.skills).filter(([key]) => !removed.has(key)),
      );
    result.card = next;
    return result;
  }

  const profile = cocOccupationProfile(next);
  const occupationSkills = chooseCocOccupationSkills(
    occupationOptions(profile, next),
    a.occupationSkills,
  );
  const occupational = Object.fromEntries(
    Object.entries(a.occupational).filter(
      ([key]) => active.has(key) && (key === 'creditRating' || occupationSkills.includes(key)),
    ),
  );
  const personal = Object.fromEntries(
    Object.entries(a.personal).filter(([key]) => active.has(key)),
  );
  if (profile && profile.credit[1] < (cocOccupationProfile(card)?.credit[1] ?? 99)) {
    const occupationCredit = occupational.creditRating ?? 0;
    const personalCredit = personal.creditRating ?? 0;
    const excess = Math.max(0, occupationCredit + personalCredit - profile.credit[1]);
    if (excess) {
      personal.creditRating = Math.max(0, personalCredit - excess);
      occupational.creditRating = Math.min(occupationCredit, profile.credit[1]);
    }
  }
  next.creation = {
    rule: 'coc',
    occupationSkills,
    occupationAttribute:
      profile?.bonus.find((key) => key === a.occupationAttribute) ?? profile?.bonus[0] ?? 'edu',
    occupational,
    personal,
  };
  result.returnedOccupation = pointsSpent(a.occupational) - pointsSpent(occupational);
  result.returnedPersonal = pointsSpent(a.personal) - pointsSpent(personal);
  result.card = syncAllocation(next);
  return result;
}

export function updateCocOccupation(card: Character, occupation: string): CocCareerChange {
  const career =
    card.cocCareer && occupation !== card.occupation
      ? { ...card.cocCareer, branchId: undefined }
      : card.cocCareer;
  return updateCocCareer(card, career, occupation);
}

export function dndAncestry(card: Character): {
  fixed: string[];
  choices: number;
  skills: string[];
} {
  if (getDndEdition(card.dndEdition) === '2024') {
    if (card.ancestry.trim() === '精灵')
      return { fixed: [], choices: 1, skills: ['insight', 'perception', 'survival'] };
    if (card.ancestry.trim() === '人类') return { fixed: [], choices: 1, skills: allDnd };
    return { fixed: [], choices: 0, skills: [] };
  }
  return card.ancestry === '精灵'
    ? { fixed: ['perception'], choices: 0, skills: [] }
    : card.ancestry === '半兽人'
      ? { fixed: ['intimidation'], choices: 0, skills: [] }
      : card.ancestry === '半精灵'
        ? { fixed: [], choices: 2, skills: allDnd }
        : { fixed: [], choices: 0, skills: [] };
}
export function dndSaves(card: Character) {
  const base = dndClassRule(card)?.saves ?? [];
  if (card.occupation === '武僧' && card.level >= 14) return DND_ATTRIBUTES.map((a) => a.key);
  if (card.occupation !== '游荡者' || card.level < 15) return base;
  return getDndEdition(card.dndEdition) === '2024' ? [...base, 'wis', 'cha'] : [...base, 'wis'];
}
export function expertiseLimit(card: Character) {
  if (getDndEdition(card.dndEdition) === '2024') {
    if (card.occupation === '吟游诗人') return card.level >= 9 ? 4 : card.level >= 2 ? 2 : 0;
    if (card.occupation === '游侠') return card.level >= 9 ? 3 : card.level >= 2 ? 1 : 0;
    if (card.occupation === '法师') return card.level >= 2 ? 1 : 0;
  }
  return card.occupation === '游荡者'
    ? card.level >= 6
      ? 4
      : 2
    : card.occupation === '吟游诗人' && card.level >= 3
      ? card.level >= 10
        ? 4
        : 2
      : 0;
}
export function expertiseOptions(card: Character): string[] {
  const skills =
    getDndEdition(card.dndEdition) === '2024' && card.occupation === '法师'
      ? ['arcana', 'history', 'nature', 'religion']
      : allDnd;
  return skills.filter((skill) => card.proficiencies.includes(`skill:${skill}`));
}
export function dndSkillModifier(card: Character, key: string) {
  const skill = DND_SKILLS.find((s) => s.key === key);
  if (!skill) return 0;
  const prof = 2 + Math.floor((card.level - 1) / 4);
  const trained = card.proficiencies.includes(`skill:${key}`);
  const expert = trained && card.creation?.rule === 'dnd' && card.creation.expertise.includes(key);
  return (
    Math.floor((card.attributes[skill.attribute] - 10) / 2) +
    (expert
      ? 2 * prof
      : trained
        ? prof
        : card.occupation === '吟游诗人' && card.level >= 2
          ? Math.floor(prof / 2)
          : 0)
  );
}
function sourcedDndSkills(card: Character, allocation: DndAllocation): string[] {
  return [
    ...allocation.classSkills,
    ...(dndBackground(card)?.skills ?? allocation.backgroundSkills),
    ...dndAncestry(card).fixed,
    ...allocation.ancestrySkills,
  ];
}
export function replacementCount(card: Character) {
  if (card.creation?.rule !== 'dnd' || getDndEdition(card.dndEdition) === '2024') return 0;
  const sources = sourcedDndSkills(card, card.creation);
  return sources.length - new Set(sources).size;
}
/** Only called by explicit editor changes, never on imported/untrusted server data. */
export function syncAllocation(card: Character): Character {
  const a = card.creation;
  if (!a || a.rule !== card.rule) return card;
  if (a.rule === 'coc')
    return {
      ...card,
      proficiencies: [],
      skills: Object.fromEntries(
        cocSkillDefinitions(card).map((s) => [
          s.key,
          cocSkillBase(card, s) + (a.occupational[s.key] ?? 0) + (a.personal[s.key] ?? 0),
        ]),
      ),
    };
  const background = dndBackground(card);
  const proficiencies = [
    ...new Set([
      ...[...sourcedDndSkills(card, a), ...a.replacementSkills, ...a.extraSkills].map(
        (s) => `skill:${s}`,
      ),
      ...[...dndSaves(card), ...a.extraSaves].map((s) => `save:${s}`),
    ]),
  ];
  const updated = {
    ...card,
    ...(background ? { creation: { ...a, backgroundSkills: [...background.skills] } } : {}),
    proficiencies,
  };
  return {
    ...updated,
    skills: Object.fromEntries(DND_SKILLS.map((s) => [s.key, dndSkillModifier(updated, s.key)])),
  };
}
export function skillRange(policy: CreationPolicy, key: string): { min: number; max: number } {
  return (
    policy.ranges.find((r) => r.field === `skills.${key}`) ?? { min: 0, max: policy.cocSkillCap }
  );
}
export function validateCreation(card: Character, policy: CreationPolicy): string[] {
  const errors: string[] = [];
  if (!CreationPolicySchema.safeParse(policy).success || policy.rule !== card.rule)
    return ['房间制卡规则不匹配或格式无效'];
  const parsed = CreationAllocationSchema.safeParse(card.creation);
  if (!parsed.success || parsed.data.rule !== card.rule)
    return ['请在制卡器中补齐技能分配来源；旧版卡片需重新分配后提交审核'];
  const a = parsed.data;
  const careerErrors = cocCareerErrors(card);
  if (careerErrors.length) return careerErrors;
  const cocProfile = a.rule === 'coc' ? cocOccupationProfile(card) : undefined;
  const duplicate = (values: string[], label: string) => {
    if (new Set(values).size !== values.length) errors.push(`${label}不可重复选择`);
  };
  if (a.rule === 'coc') {
    const p = cocProfile;
    if (!p) errors.push('请选择已支持的职业方案，以便计算职业点与信用范围');
    else {
      const options = occupationOptions(p, card);
      if (chooseCocOccupationSkills(options).includes(''))
        errors.push('当前职业技能范围不能选满八项不同技能，请启用专长或调整技能范围');
      else if (
        a.occupationSkills.length !== 8 ||
        a.occupationSkills.some((s, i) => !options[i]?.includes(s))
      )
        errors.push('职业技能的八个位置须符合当前职业的选择范围');
      if (
        p.bonus.length
          ? !p.bonus.some((key) => key === a.occupationAttribute)
          : a.occupationAttribute !== 'edu'
      )
        errors.push('职业点公式使用了不允许的属性');
      const credit = card.skills.creditRating ?? 0;
      if (credit < p.credit[0] || credit > p.credit[1])
        errors.push(`信用评级须在职业范围 ${p.credit[0]}–${p.credit[1]} 内`);
    }
    duplicate(a.occupationSkills.filter(Boolean), '职业技能');
    const allowed = new Set([...a.occupationSkills, 'creditRating']);
    const definitions = cocSkillDefinitions(card);
    const known = new Map(definitions.map((skill) => [skill.key, skill]));
    for (const [key, value] of Object.entries(a.occupational)) {
      if (!known.has(key) || (value > 0 && !allowed.has(key)))
        errors.push(`职业点不能用于 ${known.get(key)?.label ?? key}`);
    }
    for (const [key, value] of Object.entries(a.personal)) {
      if (!known.has(key)) errors.push('兴趣点不能用于未支持的技能');
      if (policy.allowInterestOnOccupation === false && value > 0 && allowed.has(key))
        errors.push(`本房间兴趣点不能用于职业技能：${known.get(key)?.label ?? key}`);
    }
    if (!policy.allowMythos && (card.skills.cthulhuMythos ?? 0) !== 0)
      errors.push('本房间新调查员的克苏鲁神话须为 0');
    const b = cocBudget(card);
    if (b.spentOccupation > b.occupational)
      errors.push(`职业点超支 ${b.spentOccupation - b.occupational} 点`);
    if (b.spentPersonal > b.personal) errors.push(`兴趣点超支 ${b.spentPersonal - b.personal} 点`);
    if (
      policy.requireAllPoints &&
      (b.spentOccupation !== b.occupational || b.spentPersonal !== b.personal)
    )
      errors.push('本房间要求分完职业点与兴趣点');
    for (const s of definitions) {
      const base = cocSkillBase(card, s);
      const expected = base + (a.occupational[s.key] ?? 0) + (a.personal[s.key] ?? 0);
      if ((card.skills[s.key] ?? base) !== expected)
        errors.push(`${s.label}与基础值、职业点和兴趣点合计不一致`);
      const range = skillRange(policy, s.key);
      if (expected < range.min || expected > range.max)
        errors.push(`${s.label}须在 ${range.min}–${range.max} 内（当前 ${expected}）`);
    }
    if (Object.keys(card.skills).some((s) => !known.has(s)))
      errors.push('包含没有分配来源的自定义技能');
    const derived = synchronizeCocInvestigator(card);
    if (
      card.maxHp !== derived.maxHp ||
      card.maxMp !== derived.maxMp ||
      card.maxSan !== derived.maxSan
    )
      errors.push('HP／MP／SAN 上限与调查员的派生设置不一致');
  } else {
    const modern = getDndEdition(card.dndEdition) === '2024';
    const cls = dndClassRule(card);
    const background = dndBackground(card);
    const ancestry = dndAncestry(card);
    if (!cls) errors.push(modern ? '请选择 2024 规则支持的职业' : '请选择 SRD 5.1 支持的职业');
    else if (
      a.classSkills.length !== cls.count ||
      a.classSkills.some((s) => !cls.skills.includes(s))
    )
      errors.push(`${cls.name}须从职业范围选择 ${cls.count} 项技能`);
    if (modern && !card.background.trim()) errors.push('请填写 2024 角色背景');
    if (background) {
      if (
        a.backgroundSkills.length !== background.skills.length ||
        background.skills.some((skill) => !a.backgroundSkills.includes(skill))
      )
        errors.push(`${background.name}的技能熟练由 2024 背景固定授予`);
    } else if (a.backgroundSkills.length !== 2) errors.push('背景须选择 2 项技能熟练');
    if (a.ancestrySkills.length !== ancestry.choices)
      errors.push(`当前种族须自选 ${ancestry.choices} 项额外技能`);
    else if (a.ancestrySkills.some((skill) => !ancestry.skills.includes(skill)))
      errors.push('种族自选技能须符合当前种族的选择范围');
    const replacements = replacementCount(card);
    if (a.replacementSkills.length !== replacements)
      errors.push(
        modern ? '2024 制卡不使用旧版替代熟练名额' : `重复来源须补选 ${replacements} 项替代熟练`,
      );
    if (a.extraSkills.length > policy.dndExtraSkills) errors.push('额外技能熟练超出主持人给定名额');
    if (
      a.extraSaves.length > policy.dndExtraSaves ||
      a.extraSaves.some(
        (s) => !DND_ATTRIBUTES.some((attr) => attr.key === s) || dndSaves(card).includes(s),
      )
    )
      errors.push('额外豁免熟练超出主持人名额或重复');
    for (const [label, values] of [
      ['职业', a.classSkills],
      ['背景', a.backgroundSkills],
      ['种族', a.ancestrySkills],
      ['替代', a.replacementSkills],
      ['额外', a.extraSkills],
      ['专精', a.expertise],
    ] as const) {
      duplicate(values, label);
      if (values.some((s) => !allDnd.includes(s))) errors.push(`${label}包含未支持的技能`);
    }
    duplicate(a.extraSaves, '额外豁免');
    const sourced = [...new Set(sourcedDndSkills(card, a))];
    duplicate([...sourced, ...a.replacementSkills, ...a.extraSkills], '补选和额外技能');
    const expertise = expertiseLimit(card);
    const options = expertiseOptions(card);
    if (
      (modern ? a.expertise.length !== expertise : a.expertise.length > expertise) ||
      a.expertise.some((s) => !options.includes(s))
    )
      errors.push(
        modern
          ? `专精须从当前职业允许的已熟练技能中选择 ${expertise} 项`
          : '专精须选择已熟练技能，且不能超过当前职业等级的名额',
      );
    const expected = syncAllocation(card);
    if ([...card.proficiencies].sort().join('|') !== [...expected.proficiencies].sort().join('|'))
      errors.push('熟练项与职业、背景、种族和主持人名额不一致');
    if (
      Object.entries(card.skills).some(
        ([s, value]) => !allDnd.includes(s) || value !== dndSkillModifier(card, s),
      )
    )
      errors.push('D&D 技能加值必须由属性、熟练和专精计算，不能自由填写');
  }
  const attrs = card.rule === 'dnd' ? DND_ATTRIBUTES : COC_ATTRIBUTES;
  for (const attr of attrs) {
    const range = policy.ranges.find((r) => r.field === `attributes.${attr.key}`) ?? {
      min: 1,
      max: card.rule === 'dnd' ? 20 : 99,
    };
    if (card.attributes[attr.key] < range.min || card.attributes[attr.key] > range.max)
      errors.push(`${attr.label}须在 ${range.min}–${range.max} 内`);
  }
  const labels = policyFields(card.rule, card);
  for (const range of policy.ranges) {
    let value: number;
    if (range.field.startsWith('attributes.')) continue;
    if (range.field.startsWith('skills.')) {
      // Active CoC skills were checked against these ranges above.
      if (card.rule === 'coc') continue;
      value = dndSkillModifier(card, range.field.slice(7));
    } else if (range.field === 'attributeTotal')
      value = attrs
        .filter((s) => s.key !== 'luck')
        .reduce((sum, s) => sum + card.attributes[s.key], 0);
    else value = card[range.field as 'hp'];
    if (value < range.min || value > range.max)
      errors.push(
        `${labels.find((l) => l.key === range.field)?.label ?? range.field}须在 ${range.min}–${range.max} 内（当前 ${value}）`,
      );
  }
  if (
    policy.allowedOccupations.length &&
    !policy.allowedOccupations.includes(card.occupation) &&
    !(cocProfile && policy.allowedOccupations.includes(cocProfile.name))
  )
    errors.push('职业不在本剧本允许的列表中');
  if (policy.allowedAncestries.length && !policy.allowedAncestries.includes(card.ancestry))
    errors.push('种族／国籍不在本剧本允许的列表中');
  return [...new Set(errors)];
}
/** A convenient starting distribution, still editable and subject to review. */
export function suggestAllocation(card: Character, policy: CreationPolicy): Character {
  const result = {
    ...card,
    creation:
      card.rule === 'coc'
        ? defaultCocAllocation(card)
        : defaultAllocation(card.rule, card.occupation),
  };
  if (result.creation.rule === 'dnd') {
    const cls = dndClassRule(card);
    const background = dndBackground(card);
    const ancestry = dndAncestry(card);
    const a = result.creation;
    const freeClassSkills =
      cls?.skills.filter((skill) => !background?.skills.includes(skill)) ?? [];
    a.classSkills = [...new Set([...freeClassSkills, ...(cls?.skills ?? [])])].slice(
      0,
      cls?.count ?? 0,
    );
    const used = [...a.classSkills, ...ancestry.fixed];
    a.backgroundSkills = background
      ? [...background.skills]
      : allDnd.filter((s) => !used.includes(s)).slice(0, 2);
    const freeAncestrySkills = ancestry.skills.filter(
      (s) => ![...used, ...a.backgroundSkills].includes(s),
    );
    a.ancestrySkills = [...new Set([...freeAncestrySkills, ...ancestry.skills])].slice(
      0,
      ancestry.choices,
    );
    const count = replacementCount(result);
    a.replacementSkills = allDnd
      .filter((s) => ![...used, ...a.backgroundSkills, ...a.ancestrySkills].includes(s))
      .slice(0, count);
  } else {
    const a = result.creation;
    const profile = cocOccupationProfile(card);
    if (!profile) return syncAllocation(result);
    a.occupationSkills = chooseCocOccupationSkills(
      occupationOptions(profile, card),
      card.creation?.rule === 'coc' ? card.creation.occupationSkills : [],
    );
    a.occupationAttribute = profile.bonus.reduce(
      (best, key) => (card.attributes[key] > card.attributes[best] ? key : best),
      profile.bonus[0] ?? 'edu',
    );
    const budget = cocBudget(result);
    a.occupational.creditRating = profile.credit[0];
    const definitions = new Map(cocSkillDefinitions(card).map((skill) => [skill.key, skill]));
    const distribute = (pool: Record<string, number>, choices: string[], amount: number) => {
      let left = amount;
      for (let pass = 0; pass < 100 && left > 0; pass++)
        for (const key of choices) {
          if (!left) break;
          const skill = definitions.get(key);
          if (!skill) continue;
          const current =
            cocSkillBase(card, skill) + (a.occupational[key] ?? 0) + (a.personal[key] ?? 0);
          if (current < skillRange(policy, key).max) {
            pool[key] = (pool[key] ?? 0) + 1;
            left--;
          }
        }
    };
    // A tight room cap can intentionally leave points unspent; validation explains it.
    distribute(a.occupational, a.occupationSkills, budget.occupational - profile.credit[0]);
    distribute(
      a.personal,
      [...definitions.keys()].filter(
        (key) =>
          key !== 'creditRating' &&
          key !== 'cthulhuMythos' &&
          (policy.allowInterestOnOccupation !== false || !a.occupationSkills.includes(key)),
      ),
      budget.personal,
    );
  }
  const suggested = syncAllocation(result);
  if (suggested.creation?.rule === 'dnd' && getDndEdition(suggested.dndEdition) === '2024') {
    return syncAllocation({
      ...suggested,
      creation: {
        ...suggested.creation,
        expertise: expertiseOptions(suggested).slice(0, expertiseLimit(suggested)),
      },
    });
  }
  return suggested;
}
