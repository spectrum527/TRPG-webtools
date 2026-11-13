import { describe, expect, it } from 'vitest';
import {
  COC_WORKBOOK_WEAPONS,
  COC_WORKBOOK_ARMOR,
  CocArmorProfileSchema,
  cocArmorValue,
  cocArmorCoverageLabel,
  cocUnresolvedArmor,
  cocWeaponValues,
  rollCocWeaponDamage,
} from '../shared/coc-equipment';
import { createCharacter, exportCharacter, parseCharacter } from '../shared/rules';
import { applyCocInvestigatorEdit, type CocInvestigatorEdit } from '../shared/coc-investigator';
import { cocArmorMovementPenalty } from '../shared/coc-physical';
import {
  emptyCocPreparationLibrary,
  exportCocPreparationLibrary,
  parseCocPreparationLibrary,
} from '../shared/coc-library';
import type { Character } from '../shared/types';

const apply = (card: Character, edit: CocInvestigatorEdit, id = 'item') =>
  applyCocInvestigatorEdit(card, edit, { now: '2026-11-14T00:00:00Z', id: () => id });
const base = () => ({ ...createCharacter('coc', () => 3), name: '林恩', occupation: '记者' });

describe('完整 CoC 装备目录与防护部位', () => {
  it('逐行覆盖 104 项武器、73 项防护物，来源和原文可随角色往返保存', () => {
    expect(COC_WORKBOOK_WEAPONS.map((entry) => entry.profile.reference!.row)).toEqual(
      Array.from({ length: 104 }, (_, i) => i + 2),
    );
    expect(COC_WORKBOOK_ARMOR.map((entry) => entry.profile.reference!.row)).toEqual(
      Array.from({ length: 73 }, (_, i) => i + 2),
    );
    for (const [kind, entries] of [
      ['weapon-add', COC_WORKBOOK_WEAPONS],
      ['armor-add', COC_WORKBOOK_ARMOR],
    ] as const) {
      for (const entry of entries) {
        const card = apply(base(), { kind, entry: { catalogId: entry.id } });
        for (const format of ['json', 'md'] as const)
          expect(parseCharacter(exportCharacter(card, format)).cocInvestigator, entry.id).toEqual(
            card.cocInvestigator,
          );
      }
    }
  });

  it('保留慢速装填、射程分段、多个弹匣规格和大装弹量', () => {
    const find = (row: number) =>
      COC_WORKBOOK_WEAPONS.find((entry) => entry.profile.reference?.row === row)!.profile;
    expect(find(10)).toMatchObject({ roundsPerUse: 2, damage: '1d8+2' });
    expect(find(58).longerRanges).toEqual([
      { range: 20, damage: '1d6' },
      { range: 50, damage: '1d3' },
    ]);
    expect(find(76)).toMatchObject({ capacity: 20, sourceText: { capacity: '20/30/32' } });
    expect(find(87).capacity).toBe(4000);
    expect(find(4).range).toBeCloseTo(10 / 3, 3);
    expect(find(97).sourceText?.damage).toBe('4D10/3码');
    expect(find(97).damage).toBe('4d10');
  });

  it('眩晕等没有 HP 骰式的武器不可把占位 0 当作已结算伤害', () => {
    let card = apply(base(), { kind: 'weapon-add', entry: { catalogId: 'workbook-weapon-17' } });
    expect(cocWeaponValues(card, 'item').damageRequiresRuling).toBe(true);
    expect(() => rollCocWeaponDamage(cocWeaponValues(card, 'item'))).toThrow('没有固定 HP 伤害');
    for (const change of [
      { kind: 'lock', locked: false },
      { kind: 'mode', mode: 'manual' },
      { kind: 'value', value: '1d3' },
    ] as const)
      card = apply(card, { kind: 'weapon-control', itemId: 'item', field: 'damage', change });
    expect(rollCocWeaponDamage(cocWeaponValues(card, 'item'), () => 2).total).toBe(2);
  });

  it('手、脚、面部和组合部位不会被扩大成躯干或全身护甲', () => {
    let card = apply(
      base(),
      { kind: 'armor-add', entry: { catalogId: 'workbook-armor-59' }, equipped: true },
      'gloves',
    );
    expect(cocArmorValue(card)).toBe(0);
    expect(cocArmorValue(card, { location: 'hands' })).toBe(2);
    expect(cocArmorValue(card, { location: 'head' })).toBe(0);
    card = apply(
      card,
      { kind: 'armor-add', entry: { catalogId: 'workbook-armor-45' }, equipped: true },
      'plate',
    );
    expect(cocArmorValue(card, { location: 'chest' })).toBe(3);
    expect(cocArmorValue(card, { location: 'back' })).toBe(0);
    expect(cocArmorValue(card)).toBe(0);
    const helmet = COC_WORKBOOK_ARMOR.find((entry) => entry.profile.reference?.row === 39)!;
    expect(cocArmorCoverageLabel(helmet.profile)).toBe('头部、面部、颈部');
  });

  it('盾牌和掩体不自动覆盖穿戴护甲；掩体不减少角色 MOV', () => {
    let card = apply(
      base(),
      { kind: 'armor-add', entry: { catalogId: 'heavy-leather-jacket' }, equipped: true },
      'jacket',
    );
    card = apply(
      card,
      { kind: 'armor-add', entry: { catalogId: 'workbook-armor-69' }, equipped: true },
      'shield',
    );
    expect(cocArmorValue(card)).toBe(1);
    expect(cocArmorMovementPenalty(card)).toBe(2);
    const cover = {
      name: '挡板',
      rating: 19,
      movPenalty: 10,
      coverage: 'none' as const,
      kind: 'cover' as const,
      era: 'any' as const,
    };
    card = apply(card, { kind: 'armor-add', entry: { profile: cover }, equipped: true }, 'cover');
    expect(cocArmorValue(card)).toBe(1);
    expect(cocArmorMovementPenalty(card)).toBe(2);
  });

  it('未知或骰式护甲必须手动确认，确认值仍受锁保护', () => {
    let card = apply(base(), {
      kind: 'armor-add',
      entry: { catalogId: 'workbook-armor-10' },
      equipped: true,
    });
    expect(cocUnresolvedArmor(card)).toHaveLength(1);
    expect(cocArmorValue(card)).toBe(0);
    expect(() =>
      apply(card, {
        kind: 'armor-control',
        itemId: 'item',
        field: 'rating',
        change: { kind: 'value', value: 4 },
      }),
    ).toThrow('解锁');
    for (const change of [
      { kind: 'lock', locked: false },
      { kind: 'mode', mode: 'manual' },
      { kind: 'value', value: 4 },
      { kind: 'lock', locked: true },
    ] as const)
      card = apply(card, { kind: 'armor-control', itemId: 'item', field: 'rating', change });
    expect(cocUnresolvedArmor(card)).toHaveLength(0);
    expect(cocArmorValue(card)).toBe(4);
  });

  it('自定义组合部位和防护条件可随备团库保存，拒绝空部位与重复部位', () => {
    const profile = {
      name: '护面与手套',
      kind: 'worn' as const,
      coverage: 'custom' as const,
      locations: ['face', 'hands'] as const,
      rating: 2,
      movPenalty: 0,
      era: 'any' as const,
      rulesNotes: '仅防护正面飞溅物。',
    };
    const parsed = CocArmorProfileSchema.parse(profile);
    const library = { ...emptyCocPreparationLibrary(), armor: [{ id: 'guard', profile: parsed }] };
    expect(parseCocPreparationLibrary(exportCocPreparationLibrary(library, 'md'))).toEqual(library);
    expect(CocArmorProfileSchema.safeParse({ ...profile, locations: [] }).success).toBe(false);
    expect(
      CocArmorProfileSchema.safeParse({ ...profile, locations: ['hands', 'hands'] }).success,
    ).toBe(false);
    expect(CocArmorProfileSchema.safeParse({ ...profile, locations: ['tail'] }).success).toBe(
      false,
    );
  });
});
