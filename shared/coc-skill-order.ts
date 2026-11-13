import { cocOccupationSkillPool, cocSkillBase, cocSkillDefinitions } from './coc-career';
import type { Character } from './types';

export const COC_SKILL_ORDERS = {
  occupation: '职业技能优先',
  invested: '已投入技能优先',
  category: '按技能类别',
  name: '按名称',
  value: '按数值从高到低',
} as const;
export type CocSkillOrder = keyof typeof COC_SKILL_ORDERS;
type Skill = { key: string; label: string; family?: string };
const names = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });
const familyRoot: Record<string, string> = {
  artCraft: 'artCraft',
  science: 'science',
  language: 'otherLanguage',
  fighting: 'fightingBrawl',
  firearms: 'firearmsHandgun',
  pilot: 'pilot',
  survival: 'survival',
  lore: 'lore',
};
const order = new Map(
  'accounting anthropology appraise archaeology artCraft charm climb computerUse creditRating cthulhuMythos disguise dodge driveAuto electricalRepair electronics fastTalk fightingBrawl firearmsHandgun firstAid history intimidate jump otherLanguage ownLanguage law libraryUse listen locksmith mechanicalRepair medicine naturalWorld navigate occult operateHeavyMachinery persuade pilot psychoanalysis psychology ride science sleightOfHand spotHidden stealth survival swim throw track animalHandling diving demolitions lipReading hypnosis artillery lore driveCarriage driveCycle etiquette'
    .split(' ')
    .map((key, index) => [key, index]),
);

/** Base values (notably EDU and DEX/2) alone do not mean a skill was trained. */
export function cocInvestedSkills(card: Character): Set<string> {
  const result = new Set<string>();
  const allocation = card.creation?.rule === 'coc' ? card.creation : undefined;
  if (allocation) {
    for (const pool of [allocation.occupational, allocation.personal])
      for (const [key, points] of Object.entries(pool)) if (points > 0) result.add(key);
  } else {
    for (const skill of cocSkillDefinitions(card))
      if ((card.skills[skill.key] ?? cocSkillBase(card, skill)) > cocSkillBase(card, skill))
        result.add(skill.key);
  }
  for (const entry of card.adjustments?.permanent ?? [])
    if (entry.target === 'skill' && entry.amount > 0) result.add(entry.key);
  for (const mark of card.cocSession?.development.marks ?? [])
    if (mark.mode === 'manual' ? mark.manual : mark.eventIds.length > 0) result.add(mark.key);
  for (const batch of card.cocSession?.development.batches ?? [])
    for (const entry of batch.results) if (entry.gain > 0) result.add(entry.key);
  return result;
}

/** A view-only order. Never reorder allocation slots or mutate saved character data. */
export function sortCocSkills<T extends Skill>(
  skills: readonly T[],
  card: Character,
  mode: CocSkillOrder = 'occupation',
  values = card.skills,
): T[] {
  const occupation = new Set(cocOccupationSkillPool(card));
  const invested = cocInvestedSkills(card);
  const definitions = new Map(cocSkillDefinitions(card).map((skill) => [skill.key, skill]));
  const root = (skill: Skill) => {
    const family = skill.family ?? definitions.get(skill.key)?.family;
    return family ? (familyRoot[family] ?? skill.key) : skill.key;
  };
  const category = (a: Skill, b: Skill) => {
    const ak = root(a),
      bk = root(b);
    return (
      (order.get(ak) ?? 100) - (order.get(bk) ?? 100) ||
      (ak === bk
        ? 0
        : names.compare(definitions.get(ak)?.label ?? ak, definitions.get(bk)?.label ?? bk)) ||
      (ak === bk ? Number(b.key === bk) - Number(a.key === ak) : 0) ||
      names.compare(a.label.split('／').at(-1) ?? a.label, b.label.split('／').at(-1) ?? b.label) ||
      a.key.localeCompare(b.key)
    );
  };
  return [...skills].sort((a, b) => {
    if (mode === 'occupation' || mode === 'invested') {
      const first = mode === 'occupation' ? occupation : invested;
      const priority = Number(first.has(b.key)) - Number(first.has(a.key));
      if (priority) return priority;
    }
    if (mode === 'value') {
      const difference = (values[b.key] ?? 0) - (values[a.key] ?? 0);
      if (difference) return difference;
    }
    return mode === 'name'
      ? names.compare(a.label, b.label) || a.key.localeCompare(b.key)
      : category(a, b);
  });
}
