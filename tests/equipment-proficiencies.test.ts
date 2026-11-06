import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dndClasses } from '../shared/catalog';
import { parseEquipmentCatalog } from '../shared/equipment-catalog';
import {
  EQUIPMENT_PROFICIENCIES,
  getEquipmentProficiencies,
} from '../shared/equipment-proficiencies';

describe('source-backed starting equipment proficiencies', () => {
  it('has the twelve initial classes for each edition and resolvable weapon names', () => {
    expect(EQUIPMENT_PROFICIENCIES).toHaveLength(24);
    for (const edition of ['2014', '2024'] as const) {
      const entries = EQUIPMENT_PROFICIENCIES.filter((profile) => profile.edition === edition);
      expect(entries.map((entry) => entry.className).sort()).toEqual(
        [...dndClasses(edition)].sort(),
      );
      const catalog = parseEquipmentCatalog(
        JSON.parse(
          readFileSync(
            new URL(`../public/rules/equipment-${edition}.json`, import.meta.url),
            'utf8',
          ),
        ),
      );
      const weapons = new Set(
        catalog.items.filter((item) => item.kind === 'weapon').map((item) => item.name),
      );
      for (const entry of entries) {
        expect(entry.source.id).toMatch(/^chm-/);
        expect(entry.source.path.startsWith('01-规则正文/')).toBe(true);
        expect(entry.armorText.length).toBeGreaterThan(0);
        expect(entry.weaponText.length).toBeGreaterThan(0);
        expect(entry.specificWeapons.every((name) => weapons.has(name))).toBe(true);
      }
    }
    expect(getEquipmentProficiencies('2014', '未知职业')).toBeNull();
    expect(getEquipmentProficiencies('2024', '邪术师')).toBeNull();
    expect(getEquipmentProficiencies('2024', '魔契师')?.weaponCategories).toEqual(['simple']);
  });

  it('does not silently grant other editions class proficiencies', () => {
    const oldBard = getEquipmentProficiencies('2014', '吟游诗人')!;
    const newBard = getEquipmentProficiencies('2024', '吟游诗人')!;
    expect(oldBard.specificWeapons).toEqual(['手弩', '长剑', '刺剑', '短剑']);
    expect(newBard.specificWeapons).toEqual([]);
    expect(newBard.weaponCategories).toEqual(['simple']);
    expect(getEquipmentProficiencies('2014', '法师')?.specificWeapons).toEqual([
      '匕首',
      '飞镖',
      '投石索',
      '长棍',
      '轻弩',
    ]);
    expect(getEquipmentProficiencies('2024', '法师')?.weaponCategories).toEqual(['simple']);
    expect(getEquipmentProficiencies('2014', '德鲁伊')?.restrictions.join('')).toContain('金属');
    expect(getEquipmentProficiencies('2024', '德鲁伊')?.restrictions).toEqual([]);
  });

  it('keeps optional 2024 armor and weapon grants conditional on the chosen feature', () => {
    const cleric = getEquipmentProficiencies('2024', '牧师')!;
    expect(cleric.armorTraining).toEqual(['light', 'medium', 'shield']);
    expect(cleric.weaponCategories).toEqual(['simple']);
    expect(cleric.options).toMatchObject([
      { name: '圣职：保护者', armorTraining: ['heavy'], weaponCategories: ['martial'] },
    ]);
    const druid = getEquipmentProficiencies('2024', '德鲁伊')!;
    expect(druid.armorTraining).toEqual(['light', 'shield']);
    expect(druid.options).toMatchObject([
      { name: '原初职能：卫士', armorTraining: ['medium'], weaponCategories: ['martial'] },
    ]);
    const monk = getEquipmentProficiencies('2024', '武僧')!;
    const rogue = getEquipmentProficiencies('2024', '游荡者')!;
    expect(monk.martialPropertiesAny).toEqual(['light']);
    expect(rogue.martialPropertiesAny).toEqual(['finesse', 'light']);
    expect(rogue.weaponCategories).not.toContain('martial');
  });
});
