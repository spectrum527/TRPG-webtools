import { effectiveCharacter } from './adjustments';
import type { Character } from './types';
import { controlledValue } from './value-control';

export function cocArmorMovementPenalty(card: Character): number {
  return Math.max(
    0,
    ...(card.cocInvestigator?.equipment?.armor ?? [])
      .filter((armor) => armor.equipped)
      .map((armor) => controlledValue(armor.overrides?.movPenalty, armor.profile.movPenalty)),
  );
}

export function cocDamageBonusAndBuild(str: number, siz: number): { db: string; build: number } {
  const total = str + siz;
  if (total <= 64) return { db: '-2', build: -2 };
  if (total <= 84) return { db: '-1', build: -1 };
  if (total <= 124) return { db: '0', build: 0 };
  if (total <= 164) return { db: '1d4', build: 1 };
  if (total <= 204) return { db: '1d6', build: 2 };
  const build = 3 + Math.floor((total - 205) / 80);
  return { db: `${build - 1}d6`, build };
}

export function cocAgeMovementPenalty(age: number): number {
  return Math.max(0, Math.min(5, Math.floor(age / 10) - 3));
}

function resourceValues(card: Character) {
  const permanent = effectiveCharacter(card, false);
  return {
    maxHp: Math.max(1, Math.floor((permanent.attributes.con + permanent.attributes.siz) / 10)),
    maxMp: Math.floor(permanent.attributes.pow / 5),
    maxSan: Math.max(0, 99 - (permanent.skills.cthulhuMythos ?? 0)),
  };
}

export function cocDerivedValues(
  card: Character,
  { includeTemporary = true }: { includeTemporary?: boolean } = {},
) {
  const { str, dex, siz } = effectiveCharacter(card, includeTemporary).attributes;
  const movementBase = str < siz && dex < siz ? 7 : str > siz && dex > siz ? 9 : 8;
  const ageMovementPenalty = cocAgeMovementPenalty(card.age);
  const armorMovementPenalty = cocArmorMovementPenalty(card);
  const automatic = {
    ...cocDamageBonusAndBuild(str, siz),
    mov: Math.max(0, movementBase - ageMovementPenalty - armorMovementPenalty),
    ...resourceValues(card),
  };
  const derived = card.cocInvestigator?.derived;
  return {
    db: controlledValue(derived?.db, automatic.db),
    build: controlledValue(derived?.build, automatic.build),
    mov: controlledValue(derived?.mov, automatic.mov),
    maxHp: controlledValue(derived?.maxHp, automatic.maxHp),
    maxMp: controlledValue(derived?.maxMp, automatic.maxMp),
    maxSan: controlledValue(derived?.maxSan, automatic.maxSan),
    automatic,
    movementBase,
    ageMovementPenalty,
    armorMovementPenalty,
  };
}

/** Leave old cards field-compatible. Recalculating a ceiling can never replenish a resource. */
export function synchronizeCocInvestigator(card: Character): Character {
  if (card.rule !== 'coc') return card;
  const values = resourceValues(card);
  const derived = card.cocInvestigator?.derived;
  const maxHp = controlledValue(derived?.maxHp, values.maxHp);
  const maxMp = controlledValue(derived?.maxMp, values.maxMp);
  const maxSan = controlledValue(derived?.maxSan, values.maxSan);
  return {
    ...card,
    maxHp,
    maxMp,
    maxSan,
    hp: Math.max(0, Math.min(card.hp, maxHp)),
    mp: Math.max(0, Math.min(card.mp, maxMp)),
    san: Math.max(0, Math.min(card.san, maxSan)),
  };
}
