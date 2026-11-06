import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseEquipmentCatalog, type EquipmentCatalogItem } from '../shared/equipment-catalog';

const load = (edition: '2014' | '2024') =>
  parseEquipmentCatalog(
    JSON.parse(
      readFileSync(new URL(`../public/rules/equipment-${edition}.json`, import.meta.url), 'utf8'),
    ),
  );
const older = load('2014');
const modern = load('2024');
const find = (items: EquipmentCatalogItem[], name: string, kind?: EquipmentCatalogItem['kind']) => {
  const found = items.filter((item) => item.name === name && (!kind || item.kind === kind));
  expect(found, `${name} must be unique`).toHaveLength(1);
  return found[0];
};

describe('D&D core equipment source catalogues', () => {
  it('keeps each edition and its source identities separate', () => {
    expect(older.items).toHaveLength(156);
    expect(modern.items).toHaveLength(145);
    for (const [pack, expected] of [
      [older, { weapon: 37, armor: 12, shield: 1, adventuring: 106 }],
      [modern, { weapon: 38, armor: 12, shield: 1, adventuring: 94 }],
    ] as const) {
      for (const [kind, count] of Object.entries(expected))
        expect(pack.items.filter((item) => item.kind === kind)).toHaveLength(count);
      expect(pack.items.every((item) => item.edition === pack.edition)).toBe(true);
      expect(new Set(pack.items.map((item) => item.id)).size).toBe(pack.items.length);
      expect(pack.items.every((item) => !item.source.path.startsWith('/'))).toBe(true);
    }
    expect(find(older.items, '匕首').id).not.toBe(find(modern.items, '匕首').id);
  });

  it('uses the corresponding weapon table, including unknown, exceptional and mastery fields', () => {
    expect(find(older.items, '匕首').weapon).toMatchObject({
      damageDice: '1d4',
      damageType: '穿刺',
      finesse: true,
      light: true,
      thrown: true,
      ranged: false,
      rangeNormalFt: 20,
      rangeLongFt: 60,
    });
    expect(find(older.items, '三叉戟').weapon).toMatchObject({
      damageDice: '1d6',
      versatileDice: '1d8',
    });
    expect(find(modern.items, '三叉戟').weapon).toMatchObject({
      damageDice: '1d8',
      versatileDice: '1d10',
      mastery: '失衡',
    });
    expect(find(older.items, '战镐').weapon).toMatchObject({
      propertyText: '—',
      twoHanded: false,
      finesse: false,
    });
    expect(find(older.items, '战镐').source.additionalPaths).toContain(
      '01-规则正文/PHB-PDF/逐页/p0149.md',
    );
    expect(find(modern.items, '战镐').weapon?.versatileDice).toBe('1d10');
    expect(find(older.items, '骑枪').weapon).toMatchObject({ twoHanded: null, reach: true });
    expect(find(older.items, '骑枪').weapon?.specialText).toContain('不在骑乘状态');
    expect(find(modern.items, '骑枪').weapon).toMatchObject({
      twoHanded: true,
      twoHandedException: '骑乘时除外',
      heavy: true,
    });
    expect(find(older.items, '捕网', 'weapon').weapon).toMatchObject({
      damageDice: null,
      damageType: null,
    });
    expect(find(modern.items, '捕网', 'adventuring').weapon).toBeNull();
    expect(find(modern.items, '火铳').weapon).toMatchObject({
      ammunition: true,
      loading: true,
      ammunitionType: '子弹',
    });
    const dagger = find(modern.items, '匕首');
    expect(dagger.weapon?.mastery).toBe('迅击');
    expect(dagger.weapon?.masteryDescription).toContain('攻击动作的一部分');
    expect(dagger.source.additionalPaths).toContain(
      '01-规则正文/CHM/玩家手册2024/装备/精通词条.md',
    );
    expect(
      modern.items.filter((item) => item.weapon).every((item) => item.weapon?.masteryDescription),
    ).toBe(true);
  });

  it('retains armor formulas, shield bonuses and source limitations without treating unknown weight as zero', () => {
    for (const pack of [older, modern]) {
      expect(find(pack.items, '皮甲').armor).toMatchObject({
        baseAC: 11,
        addsDex: true,
        dexCap: null,
      });
      expect(find(pack.items, '胸甲').armor).toMatchObject({
        baseAC: 14,
        addsDex: true,
        dexCap: 2,
      });
      expect(find(pack.items, '板甲').armor).toMatchObject({
        baseAC: 18,
        addsDex: false,
        dexCap: null,
        strengthRequirement: 15,
        stealthDisadvantage: true,
      });
      expect(find(pack.items, '板甲').costCp).toBe(150000);
      expect(find(pack.items, '盾牌').shield?.bonusAC).toBe(2);
      expect(find(pack.items, '投石索').weightLb).toBeNull();
      expect(find(pack.items, '水袋')).toMatchObject({ weightLb: null, weightWhenFullLb: 5 });
    }
  });

  it('preserves whole-bundle ammunition prices and weights with count and explicit evidence', () => {
    for (const pack of [older, modern]) {
      const bolts = find(pack.items, '弩矢');
      expect(bolts).toMatchObject({
        gearType: 'ammunition',
        weightLb: 1.5,
        costCp: 100,
        quantityPerPack: 20,
      });
    }
    const olderBolts = find(older.items, '弩矢');
    expect(olderBolts.weightText).toBe('11/2磅');
    expect(olderBolts.source.additionalPaths).toContain('01-规则正文/PHB-PDF/逐页/p0150.md');
    expect(older.items.filter((item) => item.gearType === 'ammunition')).toHaveLength(4);
    expect(modern.items.filter((item) => item.gearType === 'ammunition')).toHaveLength(5);
    expect(find(modern.items, '枪械子弹')).toMatchObject({
      quantityPerPack: 10,
      weightLb: 2,
      costCp: 300,
    });
    expect(find(older.items, '投石索弹丸')).toMatchObject({
      quantityPerPack: 20,
      weightLb: 1.5,
      costCp: 4,
    });
    expect(find(older.items, '铁蒺藜')).toMatchObject({ quantityPerPack: 20, weightLb: 2 });
    expect(find(older.items, '滚珠')).toMatchObject({ quantityPerPack: 1000, weightLb: 2 });
    expect(find(older.items, '长铁钉')).toMatchObject({ quantityPerPack: 10, weightLb: 5 });
    expect(find(modern.items, '铁钉')).toMatchObject({ quantityPerPack: 10, weightLb: 5 });
    expect(find(older.items, '链条').quantityPerPack).toBeNull();
  });

  it('does not copy container capacities across editions or invent 2014 pack weights', () => {
    for (const pack of [older, modern]) {
      expect(find(pack.items, '背包').container).toMatchObject({
        capacityLb: 30,
        capacityCubicFeet: 1,
      });
      expect(find(pack.items, '箭袋').container).toMatchObject({
        capacityCount: 20,
        capacityItem: '箭矢',
      });
      expect(find(pack.items, '弩矢匣').container).toMatchObject({
        capacityCount: 20,
        capacityItem: '弩矢',
      });
    }
    expect(find(older.items, '箱子').container).toMatchObject({
      capacityLb: 300,
      capacityCubicFeet: 12,
    });
    expect(find(modern.items, '箱子').container).toMatchObject({
      capacityLb: null,
      capacityCubicFeet: 12,
    });
    expect(find(older.items, '窃贼套组')).toMatchObject({
      costCp: 1600,
      weightLb: null,
      gearType: 'pack',
    });
    expect(find(modern.items, '窃贼套组')).toMatchObject({
      costCp: 1600,
      weightLb: 42,
      gearType: 'pack',
    });
  });

  it('rejects mixed editions, duplicate IDs, wrong shapes and local absolute paths', () => {
    const dagger = find(older.items, '匕首');
    const newDagger = find(modern.items, '匕首');
    expect(() => parseEquipmentCatalog({ ...older, items: [dagger, newDagger] })).toThrow(
      '格式无效',
    );
    expect(() => parseEquipmentCatalog({ ...older, items: [dagger, dagger] })).toThrow('格式无效');
    expect(() =>
      parseEquipmentCatalog({ ...older, items: [{ ...dagger, kind: 'armor' }] }),
    ).toThrow('格式无效');
    expect(() =>
      parseEquipmentCatalog({
        ...older,
        items: [{ ...dagger, source: { ...dagger.source, path: '/Users/private/data' } }],
      }),
    ).toThrow('格式无效');
  });
});
