import { describe, expect, it } from 'vitest';
import {
  clearCocWeaponJam,
  COC_ARMOR_CATALOG,
  COC_WEAPON_CATALOG,
  CocArmorProfileSchema,
  CocDamageExpressionSchema,
  CocWeaponProfileSchema,
  cocArmorValue,
  cocWeaponArmorReduction,
  cocWeaponValues,
  consumeCocAmmunition,
  reloadCocWeapon,
  rollCocWeaponDamage,
} from '../shared/coc-equipment';
import {
  applyCocInvestigatorEdit,
  cocDerivedValues,
  type CocInvestigatorEdit,
} from '../shared/coc-investigator';
import { createCharacter, deriveCharacter, exportCharacter, parseCharacter } from '../shared/rules';
import type { Character } from '../shared/types';

const now = '2026-11-12T00:00:00.000Z';
const apply = (card: Character, edit: CocInvestigatorEdit, id = 'gear') =>
  applyCocInvestigatorEdit(card, edit, { now, id: () => id });

function investigator() {
  const card = createCharacter('coc', () => 3);
  return deriveCharacter({
    ...card,
    name: '陈安',
    occupation: '记者',
    age: 25,
    creation: undefined,
    attributes: { ...card.attributes, str: 70, siz: 60, dex: 60 },
    skills: { ...card.skills, fightingBrawl: 55, firearmsHandgun: 43 },
  });
}

describe('CoC weapon catalog and damage', () => {
  it('validates the public profiles and saves a separate portable snapshot', () => {
    expect(new Set(COC_WEAPON_CATALOG.map(({ id }) => id)).size).toBe(COC_WEAPON_CATALOG.length);
    expect(new Set(COC_ARMOR_CATALOG.map(({ id }) => id)).size).toBe(COC_ARMOR_CATALOG.length);
    expect(
      COC_WEAPON_CATALOG.every(({ profile }) => CocWeaponProfileSchema.safeParse(profile).success),
    ).toBe(true);
    expect(
      COC_ARMOR_CATALOG.every(({ profile }) => CocArmorProfileSchema.safeParse(profile).success),
    ).toBe(true);
    const card = apply(
      investigator(),
      { kind: 'weapon-add', entry: { catalogId: 'revolver-38' }, loaded: 4, reserve: 10 },
      'r1',
    );
    const gear = card.cocInvestigator!.equipment!.weapons[0];
    const preset = COC_WEAPON_CATALOG.find(({ id }) => id === 'revolver-38')!;
    expect(gear.profile).toEqual(preset.profile);
    expect(gear.profile).not.toBe(preset.profile);
    expect(cocWeaponValues(card, 'r1')).toMatchObject({
      skill: 43,
      range: 15,
      usesPerRound: 1,
      rapidUsesPerRound: 3,
      capacity: 6,
      malfunction: 100,
      damageExpression: '1d10',
    });
    expect(parseCharacter(exportCharacter(card, 'json')).cocInvestigator).toEqual(
      card.cocInvestigator,
    );
  });

  it('links live DB and skill values, and impales with the maximum DB only once', () => {
    let card = apply(investigator(), { kind: 'weapon-add', entry: { catalogId: 'small-knife' } });
    let values = cocWeaponValues(card, 'gear');
    expect(values).toMatchObject({
      skill: 55,
      skillKey: 'fightingBrawl',
      damageExpression: '1d4+1d4',
    });
    expect(rollCocWeaponDamage(values, () => 2).total).toBe(4);
    expect(rollCocWeaponDamage(values, () => 2, { extreme: true })).toMatchObject({
      expression: '1d4+8',
      total: 10,
    });
    card = {
      ...card,
      attributes: { ...card.attributes, str: 20 },
      skills: { ...card.skills, fightingBrawl: 68 },
    };
    values = cocWeaponValues(card, 'gear');
    expect(values).toMatchObject({ skill: 68, damageExpression: '1d4-1' });
    expect(rollCocWeaponDamage(values, () => 1).total).toBe(0);
  });

  it('rolls half DB before rounding, treats half -1 as zero, and keeps thrown range linked', () => {
    let card = apply(investigator(), { kind: 'weapon-add', entry: { catalogId: 'thrown-rock' } });
    const values = cocWeaponValues(card, 'gear');
    const dice = [2, 3];
    expect(values).toMatchObject({ range: 14, damageBonusMode: 'half', damageBonus: '1d4' });
    expect(rollCocWeaponDamage(values, () => dice.shift()!).total).toBe(3);
    expect(dice).toHaveLength(0);
    card = { ...card, attributes: { ...card.attributes, str: 20 } };
    const weak = cocWeaponValues(card, 'gear');
    expect(weak).toMatchObject({ range: 4, damageExpression: '1d4' });
    expect(rollCocWeaponDamage(weak, () => 2).total).toBe(2);
  });

  it('rejects unsafe formulas and prevents profile override edits when locked', () => {
    for (const expression of ['1d6+db+alert(1)', '1d6;1', '41d6', 'd1001', 'd0', '4001', '2d6*2'])
      expect(CocDamageExpressionSchema.safeParse(expression).success).toBe(false);
    let card = apply(investigator(), { kind: 'weapon-add', entry: { catalogId: 'baseball-bat' } });
    expect(() =>
      apply(card, {
        kind: 'weapon-control',
        itemId: 'gear',
        field: 'damage',
        change: { kind: 'mode', mode: 'manual' },
      }),
    ).toThrow(/解锁/);
    for (const change of [
      { kind: 'lock', locked: false },
      { kind: 'mode', mode: 'manual' },
      { kind: 'value', value: '2D6 + 1' },
      { kind: 'lock', locked: true },
    ] as const)
      card = apply(card, { kind: 'weapon-control', itemId: 'gear', field: 'damage', change });
    expect(cocWeaponValues(card, 'gear').damageExpression).toBe('2d6+1+1d4');
    expect(() =>
      apply(card, {
        kind: 'weapon-control',
        itemId: 'gear',
        field: 'damage',
        change: { kind: 'value', value: '1d4' },
      }),
    ).toThrow(/解锁/);
    expect(cocWeaponValues(card, 'gear').automatic.damage).toBe('1d8');
  });

  it('selects shotgun bands and subtracts armor from each pellet instead of the total', () => {
    const card = apply(investigator(), {
      kind: 'weapon-add',
      entry: { catalogId: 'double-shotgun-12' },
    });
    expect(cocWeaponValues(card, 'gear', { distanceYards: 10 }).damage).toBe('4d6');
    const medium = cocWeaponValues(card, 'gear', { distanceYards: 10.5 });
    const dice = [1, 6];
    const roll = rollCocWeaponDamage(medium, () => dice.shift()!);
    expect(medium.damage).toBe('2d6');
    expect(roll.total).toBe(7);
    expect(cocWeaponArmorReduction(medium, roll, 2)).toBe(3);
    expect(cocWeaponArmorReduction(medium, roll, 200)).toBe(7);
    expect(
      cocWeaponArmorReduction(medium, rollCocWeaponDamage(medium, undefined, { extreme: true }), 2),
    ).toBe(4);
    expect(cocWeaponValues(card, 'gear', { distanceYards: 50 }).damage).toBe('1d6');
    expect(() => cocWeaponValues(card, 'gear', { distanceYards: 51 })).toThrow(/最远射程/);
  });
});

describe('CoC armor and ammunition state', () => {
  it('does not stack body armor or give helmets generic body protection', () => {
    let card = apply(
      investigator(),
      { kind: 'armor-add', entry: { catalogId: 'steel-helmet' }, equipped: true },
      'helmet',
    );
    expect(cocArmorValue(card)).toBe(0);
    expect(cocArmorValue(card, { location: 'head' })).toBe(2);
    card = apply(
      card,
      { kind: 'armor-add', entry: { catalogId: 'heavy-leather-jacket' }, equipped: true },
      'jacket',
    );
    card = apply(
      card,
      { kind: 'armor-add', entry: { catalogId: 'protective-suit' }, equipped: true },
      'suit',
    );
    expect(cocArmorValue(card)).toBe(5);
    expect(cocDerivedValues(card).armorMovementPenalty).toBe(1);
    card = apply(card, { kind: 'armor-equip', itemId: 'suit', equipped: false });
    expect(cocArmorValue(card)).toBe(1);
    expect(cocDerivedValues(card).armorMovementPenalty).toBe(0);
  });

  it('reloads from reserves, spends rounds on firing, and jams at the threshold', () => {
    const original = apply(investigator(), {
      kind: 'weapon-add',
      entry: { catalogId: 'p08-luger' },
      loaded: 1,
      reserve: 2,
    });
    expect(() => consumeCocAmmunition(original, 'gear', { shots: 2 })).toThrow(/弹药不足/);
    expect(() => consumeCocAmmunition(original, 'gear', { shots: 4 })).toThrow(/每轮次数/);
    const jammed = consumeCocAmmunition(original, 'gear', { roll: 99 });
    expect(cocWeaponValues(jammed, 'gear').ammo).toEqual({ loaded: 1, reserve: 2, jammed: true });
    expect(cocWeaponValues(original, 'gear').ammo.jammed).toBe(false);
    expect(() => reloadCocWeapon(jammed, 'gear')).toThrow(/故障/);
    expect(() => consumeCocAmmunition(jammed, 'gear')).toThrow(/故障/);
    const cleared = clearCocWeaponJam(jammed, 'gear');
    const fired = consumeCocAmmunition(cleared, 'gear', { roll: 98 });
    expect(cocWeaponValues(fired, 'gear').ammo.loaded).toBe(0);
    expect(cocWeaponValues(reloadCocWeapon(fired, 'gear', 1), 'gear').ammo).toEqual({
      loaded: 1,
      reserve: 1,
      jammed: false,
    });
    expect(() => reloadCocWeapon(fired, 'gear', 3)).toThrow(/备用弹药/);
  });

  it('rejects a capacity decrease that would discard loaded ammunition', () => {
    let card = apply(investigator(), {
      kind: 'weapon-add',
      entry: { catalogId: 'revolver-38' },
      loaded: 5,
    });
    for (const change of [
      { kind: 'lock', locked: false },
      { kind: 'mode', mode: 'manual' },
    ] as const)
      card = apply(card, { kind: 'weapon-control', itemId: 'gear', field: 'capacity', change });
    expect(() =>
      apply(card, {
        kind: 'weapon-control',
        itemId: 'gear',
        field: 'capacity',
        change: { kind: 'value', value: 3 },
      }),
    ).toThrow(/装弹量/);
    expect(cocWeaponValues(card, 'gear')).toMatchObject({ capacity: 6, ammo: { loaded: 5 } });
    card = apply(card, {
      kind: 'weapon-ammo',
      itemId: 'gear',
      loaded: 3,
      reserve: 2,
      reason: '取出两发',
    });
    card = apply(card, {
      kind: 'weapon-control',
      itemId: 'gear',
      field: 'capacity',
      change: { kind: 'value', value: 3 },
    });
    expect(cocWeaponValues(card, 'gear')).toMatchObject({
      capacity: 3,
      ammo: { loaded: 3, reserve: 2, lastCorrection: { reason: '取出两发' } },
    });
  });
});
