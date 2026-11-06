import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseEquipmentCatalog, type EquipmentCatalogItem } from '../shared/equipment-catalog';
import {
  createCharacter,
  rollDice,
  exportCharacter,
  parseCharacter,
  MAX_CHARACTER_BYTES,
} from '../shared/rules';
import { criticalDamageExpression } from '../shared/encounter';
import type { Character, Item } from '../shared/types';
import type { DndEdition } from '../shared/dnd-edition';
import {
  applyDndEquipmentEdit,
  createDndEquipmentState,
  DndItemDetailsSchema,
  dndArmorPreventsCasting,
  effectiveDndAC,
  getDndEquipmentErrors,
  getDndEquipmentWarnings,
  getDndLoad,
  getDndWeaponAttack,
  hasDndArmorTraining,
  hasDndWeaponProficiency,
  isDndAmmunition,
  itemFromEquipmentCatalog,
} from '../shared/dnd-equipment';

const packs = Object.fromEntries(
  (['2014', '2024'] as const).map((edition) => [
    edition,
    parseEquipmentCatalog(
      JSON.parse(
        readFileSync(new URL(`../public/rules/equipment-${edition}.json`, import.meta.url), 'utf8'),
      ),
    ),
  ]),
) as Record<DndEdition, ReturnType<typeof parseEquipmentCatalog>>;
function catalog(edition: DndEdition, name: string, kind?: EquipmentCatalogItem['kind']) {
  const found = packs[edition].items.filter(
    (item) => item.name === name && (!kind || item.kind === kind),
  );
  expect(found, `${edition} ${name}`).toHaveLength(1);
  return found[0];
}
function character(edition: DndEdition, occupation = '战士'): Character {
  const base = createCharacter('dnd', () => 4, undefined, edition);
  return {
    ...base,
    name: '测试角色',
    occupation,
    level: 1,
    attributes: { ...base.attributes, str: 10, dex: 14, con: 16, wis: 16 },
    items: [],
    dndEquipment: createDndEquipmentState(),
  };
}
function item(edition: DndEdition, name: string, kind?: EquipmentCatalogItem['kind']): Item {
  return itemFromEquipmentCatalog(catalog(edition, name, kind));
}
function equip(entry: Item): Item {
  entry.equipment!.equipped = true;
  return entry;
}

describe('equipment AC and actual training', () => {
  it.each(['2014', '2024'] as const)(
    'applies negative Dex to medium armor but never to heavy armor in %s',
    (edition) => {
      const card = character(edition);
      card.attributes.dex = 8;
      card.items = [equip(item(edition, '胸甲')), equip(item(edition, '盾牌'))];
      expect(effectiveDndAC(card)).toBe(15); // 14 - 1 + 2
      card.items[0] = equip(item(edition, '板甲'));
      expect(effectiveDndAC(card)).toBe(20); // 18 + 2
    },
  );

  it.each(['2014', '2024'] as const)(
    'does not stack armor with unarmored defense in %s',
    (edition) => {
      const barbarian = character(edition, '野蛮人');
      barbarian.dndEquipment!.armorMode = 'barbarian';
      barbarian.items = [equip(item(edition, '盾牌'))];
      expect(effectiveDndAC(barbarian)).toBe(17); // 10 + Dex 2 + Con 3 + shield 2
      barbarian.items.unshift(equip(item(edition, '胸甲')));
      expect(effectiveDndAC(barbarian)).toBe(18); // 14 + Dex 2 + shield 2
      const monk = character(edition, '武僧');
      monk.dndEquipment!.armorMode = 'monk';
      expect(effectiveDndAC(monk)).toBe(15); // 10 + Dex 2 + Wis 3
      monk.items = [equip(item(edition, '盾牌'))];
      expect(effectiveDndAC(monk)).toBe(edition === '2014' ? 14 : 12);
    },
  );

  it('distinguishes an untrained 2024 shield from untrained armor and from 2014 shield rules', () => {
    const old = character('2014', '术士');
    old.items = [equip(item('2014', '盾牌')), equip(item('2014', '匕首'))];
    expect(hasDndArmorTraining(old, 'shield')).toBe(false);
    expect(effectiveDndAC(old)).toBe(14);
    expect(dndArmorPreventsCasting(old)).toBe(true);
    expect(getDndWeaponAttack(old, old.items[1].id).disadvantage).toBe(true);

    const modern = character('2024', '术士');
    modern.items = [equip(item('2024', '盾牌')), equip(item('2024', '匕首'))];
    modern.items[0].equipment!.acBonus = 1;
    modern.items[0].equipment!.bonusSource = '主持人指定的魔法盾牌';
    expect(hasDndArmorTraining(modern, 'shield')).toBe(false);
    expect(effectiveDndAC(modern)).toBe(12); // 2024 untrained shield gives no AC benefit
    expect(dndArmorPreventsCasting(modern)).toBe(false);
    expect(getDndWeaponAttack(modern, modern.items[1].id).disadvantage).toBe(false);
    modern.items.unshift(equip(item('2024', '皮甲')));
    expect(dndArmorPreventsCasting(modern)).toBe(true);
    expect(getDndWeaponAttack(modern, modern.items[2].id).disadvantage).toBe(true);
    modern.items[2].equipment!.ability = 'wis';
    modern.items[2].equipment!.bonusSource = '主持人赋予的特殊武器';
    expect(getDndWeaponAttack(modern, modern.items[2].id).disadvantage).toBe(false);
  });

  it('can wear an unknown-formula item when the character explicitly uses manual AC', () => {
    const card = character('2024');
    card.ac = 17;
    card.dndEquipment!.armorMode = 'manual';
    const armor = equip(item('2024', '皮甲'));
    armor.equipment!.armor!.baseAC = null;
    card.items = [armor];
    expect(getDndEquipmentErrors(card)).toEqual([]);
    expect(effectiveDndAC(card)).toBe(17);
  });

  it('keeps martial-property proficiency edition-specific and treats finesse/light as alternatives', () => {
    const monk = character('2024', '武僧');
    expect(hasDndWeaponProficiency(monk, item('2024', '刺剑'))).toBe(false);
    expect(hasDndWeaponProficiency(monk, item('2024', '手弩'))).toBe(true);
    const rogue = character('2024', '游荡者');
    expect(hasDndWeaponProficiency(rogue, item('2024', '刺剑'))).toBe(true);
    expect(hasDndWeaponProficiency(rogue, item('2024', '手弩'))).toBe(true);
    expect(hasDndWeaponProficiency(character('2014', '法师'), item('2014', '短弓'))).toBe(false);
    expect(hasDndWeaponProficiency(character('2024', '法师'), item('2024', '短弓'))).toBe(true);
  });

  it('applies optional training only after an explicit source-backed grant', () => {
    const cleric = character('2024', '牧师');
    const sword = item('2024', '长剑');
    expect(hasDndArmorTraining(cleric, 'heavy')).toBe(false);
    expect(hasDndWeaponProficiency(cleric, sword)).toBe(false);
    cleric.dndEquipment!.extraProficiencies = ['armor:heavy', 'weapon:martial'];
    cleric.dndEquipment!.sourceNotes = '圣职：保护者';
    expect(hasDndArmorTraining(cleric, 'heavy')).toBe(true);
    expect(hasDndWeaponProficiency(cleric, sword)).toBe(true);
    expect(getDndEquipmentErrors(cleric)).toEqual([]);
  });
});

describe('weapons, ammunition and carried objects', () => {
  it.each(['2014', '2024'] as const)('can add and roll a fixed-damage blowgun in %s', (edition) => {
    let card = character(edition);
    const blowgun = item(edition, '吹箭筒');
    expect(DndItemDetailsSchema.safeParse(blowgun.equipment).success).toBe(true);
    card = applyDndEquipmentEdit(card, {
      kind: 'add',
      item: { ...blowgun, equipment: blowgun.equipment! },
    });
    card = applyDndEquipmentEdit(card, { kind: 'equip', itemId: blowgun.id, equipped: true });
    const attack = getDndWeaponAttack(card, blowgun.id);
    expect(attack.modifier).toBe(4);
    expect(attack.damage).toBe('1+2');
    expect(rollDice(attack.damage, () => 1).total).toBe(3);
    expect(criticalDamageExpression(attack.damage)).toBe('1+2');
    expect(attack.ammunition).toBe(true);
    expect(attack.loading).toBe(true);
    expect(attack.ammunitionType).toBe(edition === '2024' ? '吹矢' : null);
  });

  it('enforces 2014 lance two-hand use unless mounted', () => {
    let card = character('2014');
    const lance = item('2014', '骑枪');
    const shield = item('2014', '盾牌');
    card = applyDndEquipmentEdit(card, {
      kind: 'add',
      item: { ...lance, equipment: lance.equipment! },
    });
    card = applyDndEquipmentEdit(card, {
      kind: 'add',
      item: { ...shield, equipment: shield.equipment! },
    });
    card = applyDndEquipmentEdit(card, { kind: 'equip', itemId: lance.id, equipped: true });
    expect(card.items.find((entry) => entry.id === lance.id)?.equipment?.grip).toBe('two');
    expect(getDndEquipmentWarnings(card).some((message) => message.includes('5尺范围内目标'))).toBe(
      true,
    );
    expect(() =>
      applyDndEquipmentEdit(card, { kind: 'equip', itemId: shield.id, equipped: true }),
    ).toThrow('超过两只手');
    card = applyDndEquipmentEdit(card, {
      kind: 'equip',
      itemId: lance.id,
      equipped: true,
      mounted: true,
      grip: 'one',
    });
    card = applyDndEquipmentEdit(card, { kind: 'equip', itemId: shield.id, equipped: true });
    expect(getDndEquipmentErrors(card)).toEqual([]);
  });

  it('rejects catalog weapons with genuinely unknown properties instead of converting unknown to false', () => {
    const original = catalog('2024', '匕首');
    const unknown = { ...original, weapon: { ...original.weapon!, finesse: null } };
    expect(() => itemFromEquipmentCatalog(unknown)).toThrow('属性');
  });

  it('only applies the additional light attack modifier according to the rules', () => {
    const card = character('2024');
    card.attributes.str = 8;
    card.attributes.dex = 8;
    const dagger = equip(item('2024', '匕首'));
    const shortSword = equip(item('2024', '短剑'));
    card.items = [dagger, shortSword];
    expect(getDndWeaponAttack(card, dagger.id, 'light-extra')).toMatchObject({
      modifier: 1,
      damage: '1d4-1',
    });
    const longSword = equip(item('2024', '长剑'));
    card.items = [longSword];
    expect(() => getDndWeaponAttack(card, longSword.id, 'light-extra')).toThrow('轻型');
  });

  it('produces a damage expression the encounter dice engine can double on a critical', () => {
    const card = character('2024');
    const dagger = equip(item('2024', '匕首'));
    card.items = [dagger];
    const attack = getDndWeaponAttack(card, dagger.id);
    expect(attack.damage).toBe('1d4+2');
    expect(rollDice(attack.damage, () => 4).total).toBe(6);
    const critical = criticalDamageExpression(attack.damage);
    expect(critical).toBe('2d4+2');
    expect(rollDice(critical, () => 4).total).toBe(10);
  });

  it('applies 2014 size and 2024 strength or dexterity heavy-weapon restrictions independently', () => {
    const old = character('2014');
    old.attributes.str = 16;
    old.dndEquipment!.size = 'small';
    old.items = [equip(item('2014', '巨剑'))];
    expect(getDndWeaponAttack(old, old.items[0].id).disadvantage).toBe(true);
    const modern = character('2024');
    modern.attributes.str = 16;
    modern.dndEquipment!.size = 'small';
    modern.items = [equip(item('2024', '巨剑'))];
    expect(getDndWeaponAttack(modern, modern.items[0].id).disadvantage).toBe(false);
    modern.attributes.str = 12;
    expect(getDndWeaponAttack(modern, modern.items[0].id).disadvantage).toBe(true);
    modern.attributes.str = 16;
    modern.attributes.dex = 12;
    modern.items = [equip(item('2024', '长弓'))];
    expect(getDndWeaponAttack(modern, modern.items[0].id).disadvantage).toBe(true);
    modern.attributes.dex = 13;
    expect(getDndWeaponAttack(modern, modern.items[0].id).disadvantage).toBe(false);
  });

  it('converts packs to per-item weight, counts coins once, and allows arrows in a quiver', () => {
    const card = character('2024');
    const backpack = item('2024', '背包');
    const quiver = item('2024', '箭袋');
    const arrows = item('2024', '箭矢');
    arrows.equipment!.containerId = quiver.id;
    card.items = [backpack, quiver, arrows];
    card.dndEquipment!.coins.cp = 50;
    expect(arrows.quantity).toBe(20);
    expect(arrows.equipment?.unitWeightLb).toBeCloseTo(0.05);
    expect(getDndLoad(card)).toMatchObject({ weight: 8, unknown: 0, capacity: 150 });
    expect(isDndAmmunition(arrows)).toBe(true);
    expect(getDndEquipmentWarnings(card).some((message) => message.includes('超过标注件数'))).toBe(
      false,
    );
  });

  it('applies the 2014 variant encumbrance attack penalty without adding the heavy-armor penalty again', () => {
    const card = character('2014');
    card.attributes.str = 10;
    card.dndEquipment!.carrying = 'variant';
    const heavyGear = item('2014', '箱子');
    heavyGear.quantity = 2; // With armor and dagger, 116 lb: above 10 × Strength but below 150 lb.
    const dagger = equip(item('2014', '匕首'));
    const plate = equip(item('2014', '板甲'));
    card.items = [heavyGear, dagger, plate];
    const load = getDndLoad(card);
    expect(load.speed).toBe(10);
    expect(getDndWeaponAttack(card, dagger.id)).toMatchObject({
      disadvantage: true,
      reason: '严重超载',
    });
  });

  it('surfaces the 2014 druid material restriction without guessing shield or armor material', () => {
    const old = character('2014', '德鲁伊');
    old.items = [equip(item('2014', '皮甲')), equip(item('2014', '盾牌'))];
    expect(getDndEquipmentWarnings(old).some((message) => message.includes('金属'))).toBe(true);
    const modern = character('2024', '德鲁伊');
    modern.items = [equip(item('2024', '皮甲')), equip(item('2024', '盾牌'))];
    expect(getDndEquipmentWarnings(modern).some((message) => message.includes('金属'))).toBe(false);
  });

  it('checks typed quiver capacity and prevents container cycles without partially mutating the card', () => {
    let card = character('2024');
    const backpack = item('2024', '背包');
    const chest = item('2024', '箱子');
    const quiver = item('2024', '箭袋');
    const arrows = item('2024', '箭矢');
    const books = item('2024', '书籍');
    arrows.equipment!.containerId = quiver.id;
    books.equipment!.containerId = quiver.id;
    books.quantity = 2;
    card.items = [backpack, chest, quiver, arrows, books];
    expect(getDndEquipmentWarnings(card).some((message) => message.includes('超过标注件数'))).toBe(
      false,
    );
    arrows.quantity = 21;
    expect(getDndEquipmentWarnings(card).some((message) => message.includes('超过标注件数'))).toBe(
      true,
    );
    card = applyDndEquipmentEdit(card, {
      kind: 'move',
      itemId: backpack.id,
      containerId: chest.id,
    });
    const snapshot = structuredClone(card);
    expect(() =>
      applyDndEquipmentEdit(card, { kind: 'move', itemId: chest.id, containerId: backpack.id }),
    ).toThrow('容器');
    expect(card).toEqual(snapshot);
  });

  it('does not apply an unattuned bonus and cannot treat multiple magic items as one attunement', () => {
    let card = character('2024');
    const rings = Array.from({ length: 4 }, () => {
      const entry = equip(item('2024', '书籍'));
      Object.assign(entry.equipment!, {
        requiresAttunement: true,
        acBonus: 1,
        bonusSource: '主持人指定的魔法物品',
      });
      return entry;
    });
    rings.slice(0, 3).forEach((entry) => {
      entry.equipment!.attuned = true;
    });
    card.items = rings;
    expect(effectiveDndAC(card)).toBe(15); // 10 + Dex 2 + three attuned bonuses
    expect(() =>
      applyDndEquipmentEdit(card, {
        kind: 'attune',
        itemId: rings[3].id,
        attuned: true,
        confirmed: true,
      }),
    ).toThrow('同调物品不能超过');
    const stacked = structuredClone(card);
    stacked.items[0].quantity = 2;
    expect(getDndEquipmentErrors(stacked).some((message) => message.includes('单独列为一件'))).toBe(
      true,
    );
  });

  it('keeps legacy manual AC intact when equipment linkage is absent', () => {
    const legacy = character('2014');
    delete legacy.dndEquipment;
    legacy.ac = 17;
    legacy.items = [{ id: 'old-item', name: '旧行囊', quantity: 1, notes: '' }];
    expect(effectiveDndAC(legacy)).toBe(17);
    expect(getDndEquipmentErrors(legacy)).toEqual([]);
    expect(getDndEquipmentWarnings(legacy)).toEqual([]);
  });

  it('reports unweighed legacy items separately from the known weight subtotal', () => {
    const card = character('2024');
    card.items = [{ id: 'old-item', name: '尚未称重的行囊', quantity: 1, notes: '' }];
    expect(getDndLoad(card)).toMatchObject({ weight: 0, unknown: 1 });
    expect(getDndEquipmentWarnings(card).some((message) => message.includes('重量未知'))).toBe(
      true,
    );
  });
});

describe('portable equipment character boundaries', () => {
  it('round-trips a full UTF-8 inventory through its actual JSON and Markdown exports', () => {
    const card = character('2024');
    card.notes = '角色笔记'.repeat(3000);
    card.backstory = '经历'.repeat(3000);
    card.items = Array.from({ length: 100 }, (_, index) => ({
      ...item('2024', '皮甲'),
      name: `备份护甲${index}`,
      notes: '中文来源记录'.repeat(166),
      equipment: { ...item('2024', '皮甲').equipment!, bonusSource: '中文来源'.repeat(100) },
    }));
    for (const format of ['json', 'md'] as const) {
      const document = exportCharacter(card, format);
      expect(new TextEncoder().encode(document).byteLength).toBeGreaterThan(512 * 1024);
      expect(new TextEncoder().encode(document).byteLength).toBeLessThan(MAX_CHARACTER_BYTES);
      const restored = parseCharacter(document, 'dnd', '2024');
      expect(restored.items).toEqual(card.items);
      expect(restored.dndEquipment).toEqual(card.dndEquipment);
    }
    expect(() => parseCharacter(' '.repeat(MAX_CHARACTER_BYTES + 1))).toThrow('1 MiB');
  });

  it('rejects cross-edition snapshots even with equipment linking disabled', () => {
    const card = character('2024');
    delete card.dndEquipment;
    card.items = [item('2014', '皮甲')];
    expect(getDndEquipmentErrors(card).join(' ')).toContain('版次');
    expect(() => exportCharacter(card, 'json')).toThrow();
  });
});
