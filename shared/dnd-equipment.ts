import { z } from 'zod';
import { DndEditionSchema, getDndEdition } from './dnd-edition';
import {
  EquipmentArmorSchema,
  EquipmentShieldSchema,
  EquipmentContainerSchema,
  type EquipmentCatalogItem,
} from './equipment-catalog';
import { getEquipmentProficiencies } from './equipment-proficiencies';
import type { Character, Item } from './types';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const integer = (min: number, max: number) => z.number().int().min(min).max(max);
const amount = z.number().finite().min(0).max(1000000).nullable();
const WeaponSnapshotSchema = z.strictObject({
  proficiency: z.enum(['simple', 'martial']),
  ranged: z.boolean(),
  damageDice: z
    .string()
    .regex(/^(?:\d{1,2}d\d{1,3}|\d{1,3})$/)
    .nullable(),
  damageType: z.string().max(100).nullable(),
  finesse: z.boolean(),
  light: z.boolean(),
  heavy: z.boolean(),
  thrown: z.boolean(),
  ammunition: z.boolean(),
  twoHanded: z.boolean(),
  mountedException: z.boolean(),
  versatileDice: z
    .string()
    .regex(/^\d{1,2}d\d{1,3}$/)
    .nullable(),
  reach: z.boolean(),
  loading: z.boolean(),
  rangeNormalFt: amount,
  rangeLongFt: amount,
  ammunitionType: z.string().max(100).nullable(),
  mastery: z.string().max(100).nullable(),
  specialText: z.string().max(20000).nullable().optional(),
});
export const DndItemDetailsSchema = z
  .strictObject({
    catalogId: id,
    edition: DndEditionSchema,
    kind: z.enum(['weapon', 'armor', 'shield', 'adventuring']),
    gearType: z.enum(['ammunition', 'container', 'pack', 'general']).nullable(),
    sourcePath: z.string().max(1000),
    baseName: z.string().max(300),
    unitWeightLb: amount,
    unitCostCp: amount,
    weapon: WeaponSnapshotSchema.nullable(),
    armor: EquipmentArmorSchema.nullable(),
    shield: EquipmentShieldSchema.nullable(),
    container: EquipmentContainerSchema.nullable(),
    equipped: z.boolean(),
    attuned: z.boolean(),
    requiresAttunement: z.boolean(),
    grip: z.enum(['one', 'two']),
    mounted: z.boolean(),
    containerId: id.nullable(),
    attackBonus: integer(-10, 10),
    damageBonus: integer(-10, 10),
    acBonus: integer(-10, 10),
    ability: z.enum(['auto', 'str', 'dex', 'con', 'int', 'wis', 'cha']),
    bonusSource: z.string().max(400),
  })
  .superRefine((e, ctx) => {
    if (
      (e.kind === 'weapon') !== !!e.weapon ||
      (e.kind === 'armor') !== !!e.armor ||
      (e.kind === 'shield') !== !!e.shield
    )
      ctx.addIssue({ code: 'custom', message: '装备类型与数值快照不符' });
    if (e.kind !== 'adventuring' && (e.gearType !== null || e.container !== null))
      ctx.addIssue({ code: 'custom', message: '装备分类无效' });
    if (
      (e.attackBonus ||
        e.damageBonus ||
        e.acBonus ||
        e.ability !== 'auto' ||
        e.requiresAttunement) &&
      !e.bonusSource.trim()
    )
      ctx.addIssue({ code: 'custom', message: '魔法加值、同调或特殊属性须填写来源' });
  });
export type DndItemDetails = z.infer<typeof DndItemDetailsSchema>;
export const DndEquipmentStateSchema = z.strictObject({
  armorMode: z.enum(['standard', 'barbarian', 'monk', 'manual']),
  acBonus: integer(-20, 20),
  baseSpeed: integer(0, 200),
  size: z.enum(['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan']),
  carrying: z.enum(['standard', 'variant']),
  capacityMultiplier: z.number().min(0.5).max(8),
  attunementLimit: integer(0, 10),
  extraProficiencies: z.array(z.string().min(1).max(120)).max(50),
  coins: z.strictObject({
    cp: integer(0, 1000000),
    sp: integer(0, 1000000),
    ep: integer(0, 1000000),
    gp: integer(0, 1000000),
    pp: integer(0, 1000000),
  }),
  sourceNotes: z.string().max(1000),
});
export type DndEquipmentState = z.infer<typeof DndEquipmentStateSchema>;
const ItemInputSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  name: z.string().trim().min(1).max(120),
  quantity: integer(0, 9999),
  notes: z.string().max(1000),
  equipment: DndItemDetailsSchema,
});
export const DndEquipmentEditSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('configure'), state: DndEquipmentStateSchema }),
  z.strictObject({ kind: z.literal('disable') }),
  z.strictObject({ kind: z.literal('add'), item: ItemInputSchema }),
  z.strictObject({
    kind: z.literal('equip'),
    itemId: id,
    equipped: z.boolean(),
    grip: z.enum(['one', 'two']).optional(),
    mounted: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal('attune'),
    itemId: id,
    attuned: z.boolean(),
    confirmed: z.literal(true),
  }),
  z.strictObject({ kind: z.literal('consume'), itemId: id, amount: integer(1, 9999) }),
  z.strictObject({ kind: z.literal('move'), itemId: id, containerId: id.nullable() }),
  z.strictObject({ kind: z.literal('drop'), itemId: id }),
]);
export type DndEquipmentEdit = z.infer<typeof DndEquipmentEditSchema>;
export function createDndEquipmentState(): DndEquipmentState {
  return {
    armorMode: 'standard',
    acBonus: 0,
    baseSpeed: 30,
    size: 'medium',
    carrying: 'standard',
    capacityMultiplier: 1,
    attunementLimit: 3,
    extraProficiencies: [],
    coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    sourceNotes: '',
  };
}
export function itemFromEquipmentCatalog(
  entry: EquipmentCatalogItem,
  quantity = entry.quantityPerPack ?? 1,
): Item & { equipment: DndItemDetails } {
  const w = entry.weapon;
  const knownMountedLance =
    entry.edition === '2014' &&
    entry.name === '骑枪' &&
    !!w?.specialText?.includes('不在骑乘状态') &&
    !!w.specialText.includes('两只手');
  if (
    w &&
    ([w.finesse, w.light, w.heavy, w.thrown, w.ammunition, w.reach, w.loading].some(
      (value) => value === null,
    ) ||
      (w.twoHanded === null && !knownMountedLance))
  )
    throw new Error('武器属性尚未确认，请先核对来源再使用自动计算');
  return {
    id: crypto.randomUUID(),
    name: entry.name.slice(0, 120),
    quantity,
    notes: '',
    equipment: {
      catalogId: entry.id,
      edition: entry.edition,
      baseName: entry.name,
      kind: entry.kind,
      gearType: entry.gearType,
      sourcePath: entry.source.path,
      unitWeightLb: entry.weightLb === null ? null : entry.weightLb / (entry.quantityPerPack ?? 1),
      unitCostCp: entry.costCp === null ? null : entry.costCp / (entry.quantityPerPack ?? 1),
      weapon: w
        ? {
            proficiency: w.proficiency,
            ranged: w.ranged,
            damageDice: w.damageDice,
            damageType: w.damageType,
            finesse: !!w.finesse,
            light: !!w.light,
            heavy: !!w.heavy,
            thrown: !!w.thrown,
            ammunition: !!w.ammunition,
            twoHanded: w.twoHanded ?? knownMountedLance,
            mountedException: !!w.twoHandedException,
            versatileDice: w.versatileDice,
            reach: !!w.reach,
            loading: !!w.loading,
            rangeNormalFt: w.rangeNormalFt,
            rangeLongFt: w.rangeLongFt,
            ammunitionType: w.ammunitionType,
            mastery: w.mastery,
            specialText: w.specialText,
          }
        : null,
      armor: entry.armor ? structuredClone(entry.armor) : null,
      shield: entry.shield ? structuredClone(entry.shield) : null,
      container: entry.container ? structuredClone(entry.container) : null,
      equipped: false,
      attuned: false,
      requiresAttunement: false,
      grip: 'one',
      mounted: false,
      containerId: null,
      attackBonus: 0,
      damageBonus: 0,
      acBonus: 0,
      ability: 'auto',
      bonusSource: '',
    },
  };
}
const mod = (score: number) => Math.floor((score - 10) / 2);
const worn = (card: Character) => card.items.filter((i) => i.quantity > 0 && i.equipment?.equipped);
const magical = (e: DndItemDetails) => !e.requiresAttunement || e.attuned;
function classIs(card: Character, ...names: string[]) {
  return names.includes(card.occupation.toLowerCase());
}
/** Card attributes should already include temporary effects. Does not call effectiveCharacter. */
export function effectiveDndAC(card: Character): number {
  const state = card.dndEquipment;
  if (card.rule !== 'dnd' || !state) return card.ac;
  if (state.armorMode === 'manual') return card.ac;
  const gear = worn(card),
    armor = gear.find((i) => i.equipment?.armor)?.equipment,
    shield = gear.find((i) => i.equipment?.shield)?.equipment;
  const dex = mod(card.attributes.dex);
  let ac = 10 + dex;
  if (armor?.armor) {
    const a = armor.armor;
    ac = (a.baseAC ?? 10) + (a.addsDex ? (a.dexCap === null ? dex : Math.min(dex, a.dexCap)) : 0);
  } else if (state.armorMode === 'barbarian' && classIs(card, '野蛮人', 'barbarian'))
    ac += mod(card.attributes.con);
  else if (state.armorMode === 'monk' && !shield && classIs(card, '武僧', 'monk'))
    ac += mod(card.attributes.wis);
  const shieldEffective =
    getDndEdition(card.dndEdition) !== '2024' || hasDndArmorTraining(card, 'shield');
  ac += (shieldEffective ? (shield?.shield?.bonusAC ?? 0) : 0) + state.acBonus;
  for (const i of gear) {
    const e = i.equipment!;
    if (magical(e) && (!e.shield || shieldEffective)) ac += e.acBonus;
  }
  return ac;
}
function proficiencies(card: Character) {
  return getEquipmentProficiencies(getDndEdition(card.dndEdition), card.occupation);
}
export function hasDndArmorTraining(
  card: Character,
  category: 'light' | 'medium' | 'heavy' | 'shield',
) {
  return (
    !!proficiencies(card)?.armorTraining.includes(category) ||
    !!card.dndEquipment?.extraProficiencies.includes(`armor:${category}`)
  );
}
export function hasDndWeaponProficiency(card: Character, item: Item) {
  const e = item.equipment,
    w = e?.weapon;
  if (!e || !w) return false;
  const p = proficiencies(card),
    extra = card.dndEquipment?.extraProficiencies ?? [];
  return (
    extra.includes(`weapon:${e.catalogId}`) ||
    extra.includes(`weapon:${w.proficiency}`) ||
    !!p?.weaponCategories.includes(w.proficiency) ||
    !!p?.specificWeapons.some((n) => n === e.baseName) ||
    !!p?.martialPropertiesAny.some((prop) => w[prop])
  );
}
export function dndArmorPreventsCasting(card: Character): boolean {
  const shieldBlocks = getDndEdition(card.dndEdition) === '2014';
  return worn(card).some(
    (i) =>
      (i.equipment?.armor && !hasDndArmorTraining(card, i.equipment.armor.category)) ||
      (shieldBlocks && i.equipment?.shield && !hasDndArmorTraining(card, 'shield')),
  );
}
export function getDndEquipmentErrors(card: Character): string[] {
  const errors: string[] = [];
  const state = card.dndEquipment;
  const managed = card.items.filter((i) => i.equipment);
  if (card.rule !== 'dnd') return state || managed.length ? ['CoC 角色不使用 D&D 装备联动'] : [];
  if (!state) {
    for (const item of managed) {
      const details = item.equipment!;
      if (!DndItemDetailsSchema.safeParse(details).success)
        errors.push(`${item.name}：装备数值格式无效`);
      if (details.edition !== getDndEdition(card.dndEdition))
        errors.push(`${item.name}：与角色规则版次不符`);
      if (details.equipped || details.attuned) errors.push('请先启用装备联动');
    }
    return [...new Set(errors)];
  }
  if (!DndEquipmentStateSchema.safeParse(state).success) return ['装备设置格式无效'];
  if (state.carrying === 'variant' && getDndEdition(card.dndEdition) === '2024')
    errors.push('变体负重仅适用于 2014 版');
  if (
    (state.acBonus ||
      state.capacityMultiplier !== 1 ||
      state.attunementLimit !== 3 ||
      state.extraProficiencies.length) &&
    !state.sourceNotes.trim()
  )
    errors.push('装备额外修正或熟练须填写规则来源');
  if (state.armorMode === 'barbarian' && !classIs(card, '野蛮人', 'barbarian'))
    errors.push('野蛮人无甲防御须由对应职业授予');
  if (state.armorMode === 'monk' && !classIs(card, '武僧', 'monk'))
    errors.push('武僧无甲防御须由对应职业授予');
  const gear = worn(card);
  if (gear.filter((i) => i.equipment?.armor).length > 1) errors.push('只能同时穿戴一套护甲');
  if (gear.filter((i) => i.equipment?.shield).length > 1) errors.push('只能获得一面盾牌的加值');
  const handCount = gear.reduce((n, i) => {
    const e = i.equipment!;
    return (
      n +
      (e.shield
        ? 1
        : e.weapon
          ? (e.weapon.twoHanded && !(e.mounted && e.weapon.mountedException)) || e.grip === 'two'
            ? 2
            : 1
          : 0)
    );
  }, 0);
  if (handCount > 2) errors.push('持握需要超过两只手：请先收起另一件武器或盾牌');
  if (managed.filter((i) => i.equipment?.attuned).length > state.attunementLimit)
    errors.push(`同调物品不能超过 ${state.attunementLimit} 件`);
  const itemIds = new Set(card.items.map((i) => i.id));
  for (const i of managed) {
    const e = i.equipment!;
    if (!DndItemDetailsSchema.safeParse(e).success) {
      errors.push(`${i.name}：装备数值格式无效`);
      continue;
    }
    if (e.edition !== getDndEdition(card.dndEdition)) errors.push(`${i.name}：与角色规则版次不符`);
    if ((e.equipped || e.attuned) && i.quantity < 1)
      errors.push(`${i.name}：数量为零时不能穿戴或同调`);
    if (
      i.quantity > 1 &&
      (e.attuned || (e.equipped && (e.kind !== 'adventuring' || e.acBonus !== 0)))
    )
      errors.push(`${i.name}：请将要穿戴或同调的装备单独列为一件`);
    if (e.equipped && e.containerId) errors.push(`${i.name}：请先从容器中取出再穿戴`);
    if (e.attuned && !e.requiresAttunement) errors.push(`${i.name}：此物品无需同调`);
    if (
      e.armor &&
      (e.armor.baseAC === null || e.armor.addsDex === null) &&
      e.equipped &&
      state.armorMode !== 'manual'
    )
      errors.push(`${i.name}：护甲公式未知，请使用手动 AC`);
    if (e.shield && e.shield.bonusAC === null && e.equipped && state.armorMode !== 'manual')
      errors.push(`${i.name}：盾牌 AC 未知，请使用手动 AC`);
    if (e.containerId) {
      if (!itemIds.has(e.containerId)) errors.push(`${i.name}：容器不存在`);
      const parent = card.items.find((p) => p.id === e.containerId);
      if (!parent?.equipment?.container || parent.quantity !== 1)
        errors.push(`${i.name}：请选择数量为一的容器`);
      const visited = new Set([i.id]);
      let at: string | null = e.containerId;
      while (at) {
        if (visited.has(at)) {
          errors.push(`${i.name}：容器不能相互套入或放入自身`);
          break;
        }
        visited.add(at);
        at = card.items.find((p) => p.id === at)?.equipment?.containerId ?? null;
      }
    }
  }
  const ac = effectiveDndAC(card);
  if (ac < 0 || ac > 99) errors.push('联动后的 AC 须在 0–99 之间');
  return [...new Set(errors)];
}
export function getDndLoad(card: Character) {
  const state = card.dndEquipment ?? createDndEquipmentState();
  const coinCount = Object.values(state.coins).reduce((a, b) => a + b, 0);
  const weight = card.items.reduce(
    (sum, i) => sum + (i.equipment?.unitWeightLb ?? 0) * i.quantity,
    coinCount / 50,
  );
  const unknown = card.items.filter(
    (i) => i.quantity > 0 && i.equipment?.unitWeightLb == null,
  ).length;
  const sizeScale = { tiny: 0.5, small: 1, medium: 1, large: 2, huge: 4, gargantuan: 8 }[
    state.size
  ];
  const strength = card.attributes.str,
    capacity = strength * 15 * sizeScale * state.capacityMultiplier;
  let speed = state.baseSpeed;
  const heavy = worn(card).find((i) => i.equipment?.armor?.category === 'heavy')?.equipment?.armor;
  if (
    heavy?.strengthRequirement &&
    strength < heavy.strengthRequirement &&
    !(getDndEdition(card.dndEdition) === '2014' && /矮人/.test(card.ancestry))
  )
    speed -= 10;
  let burden = weight > capacity ? '超出负重上限' : '正常';
  if (state.carrying === 'variant') {
    // Variant encumbrance replaces the armor Strength restriction.
    speed = state.baseSpeed;
    if (weight > strength * 10 * sizeScale * state.capacityMultiplier) {
      speed -= 20;
      burden = '严重超载';
    } else if (weight > strength * 5 * sizeScale * state.capacityMultiplier) {
      speed -= 10;
      burden = '超载';
    }
    if (weight > capacity) burden = '超出负重上限';
  }
  return {
    weight: Math.round(weight * 100) / 100,
    unknown,
    capacity,
    speed: Math.max(0, speed),
    burden,
    coinValueCp:
      state.coins.cp +
      state.coins.sp * 10 +
      state.coins.ep * 50 +
      state.coins.gp * 100 +
      state.coins.pp * 1000,
  };
}
export function getDndEquipmentWarnings(card: Character): string[] {
  if (!card.dndEquipment) return [];
  const messages: string[] = [];
  const state = card.dndEquipment;
  const restrictions = proficiencies(card)?.restrictions ?? [];
  if (worn(card).some((i) => i.equipment?.armor || i.equipment?.shield))
    messages.push(...restrictions);
  for (const i of worn(card)) {
    const e = i.equipment!;
    if (e.armor?.stealthDisadvantage) messages.push(`${i.name}：隐匿检定具有劣势`);
    if (e.armor && !hasDndArmorTraining(card, e.armor.category))
      messages.push(`${i.name}：缺少护甲训练，妨碍施法及相关检定`);
    if (e.shield && !hasDndArmorTraining(card, 'shield'))
      messages.push(
        getDndEdition(card.dndEdition) === '2024'
          ? `${i.name}：缺少盾牌受训，无法获得盾牌的 AC 加值`
          : `${i.name}：缺少盾牌熟练，妨碍施法及相关检定`,
      );
    if (e.weapon && !hasDndWeaponProficiency(card, i))
      messages.push(`${i.name}：不熟练，攻击不加熟练加值`);
    if (e.requiresAttunement && !e.attuned) messages.push(`${i.name}：尚未同调，魔法加值不生效`);
    if (e.weapon?.mastery)
      messages.push(`${i.name}精通：${e.weapon.mastery}；须有对应特性，效果由主持人裁定`);
    if (e.weapon?.specialText) messages.push(`${i.name}：${e.weapon.specialText}`);
  }
  if (state.armorMode === 'monk' && worn(card).some((i) => i.equipment?.shield))
    messages.push('持盾时武僧无甲防御不生效');
  const load = getDndLoad(card);
  if (load.unknown) messages.push(`${load.unknown} 项物品重量未知，当前负重为已知小计`);
  if (load.burden !== '正常') messages.push(`负重：${load.burden}，情境限制由主持人执行`);
  for (const container of card.items.filter((i) => i.equipment?.container)) {
    const inside = card.items.filter((i) => {
      const visited = new Set<string>();
      let p = i.equipment?.containerId;
      while (p && !visited.has(p)) {
        if (p === container.id) return true;
        visited.add(p);
        p = card.items.find((x) => x.id === p)?.equipment?.containerId;
      }
      return false;
    });
    const capacity = container.equipment!.container!;
    const weight = inside.reduce(
      (sum, i) => sum + (i.equipment?.unitWeightLb ?? 0) * i.quantity,
      0,
    );
    if (capacity.capacityLb !== null && weight > capacity.capacityLb)
      messages.push(`${container.name}超过已知重量容量`);
    const relevant = inside.filter((i) =>
      capacity.capacityItem === '箭矢'
        ? ['箭', '箭矢'].includes(i.equipment?.baseName ?? '')
        : capacity.capacityItem !== null && i.equipment?.baseName === capacity.capacityItem,
    );
    if (
      capacity.capacityCount !== null &&
      capacity.capacityItem !== null &&
      relevant.reduce((sum, i) => sum + i.quantity, 0) > capacity.capacityCount
    )
      messages.push(`${container.name}超过标注件数；请核对所装物品种类`);
  }
  return messages;
}
export function getDndWeaponAttack(
  card: Character,
  itemId: string,
  mode: 'normal' | 'light-extra' = 'normal',
) {
  const item = card.items.find((i) => i.id === itemId),
    e = item?.equipment,
    w = e?.weapon;
  if (
    card.rule !== 'dnd' ||
    !card.dndEquipment ||
    !item ||
    !e ||
    !w ||
    !e.equipped ||
    item.quantity < 1
  )
    throw new Error('请先穿戴这件武器');
  const a = card.attributes;
  const ability =
    e.ability !== 'auto'
      ? e.ability
      : w.finesse
        ? mod(a.dex) > mod(a.str)
          ? 'dex'
          : 'str'
        : w.ranged
          ? 'dex'
          : 'str';
  const abilityMod = mod(a[ability]);
  if (mode === 'light-extra' && !w.light) throw new Error('额外轻型武器攻击须使用轻型武器');
  const baseDice = e.grip === 'two' && w.versatileDice ? w.versatileDice : w.damageDice;
  if (!baseDice) throw new Error('此物品没有伤害骰式，请由主持人按其效果处理');
  const bonus = magical(e);
  const damageMod =
    (mode === 'light-extra' ? Math.min(0, abilityMod) : abilityMod) + (bonus ? e.damageBonus : 0);
  const modifier =
    abilityMod +
    (hasDndWeaponProficiency(card, item) ? 2 + Math.floor((card.level - 1) / 4) : 0) +
    (bonus ? e.attackBonus : 0);
  const heavyDisadvantage =
    w.heavy &&
    (getDndEdition(card.dndEdition) === '2024'
      ? w.ranged
        ? a.dex < 13
        : a.str < 13
      : ['tiny', 'small'].includes(card.dndEquipment.size));
  const untrained = dndArmorPreventsCasting(card) && ['str', 'dex'].includes(ability);
  const load = getDndLoad(card);
  const overloaded =
    card.dndEquipment.carrying === 'variant' &&
    ['严重超载', '超出负重上限'].includes(load.burden) &&
    ['str', 'dex', 'con'].includes(ability);
  const damageType =
    ({ 钝击: 'bludgeoning', 穿刺: 'piercing', 挥砍: 'slashing' } as Record<string, string>)[
      w.damageType ?? ''
    ] ??
    w.damageType ??
    'untyped';
  return {
    modifier,
    damage: `${baseDice}${damageMod > 0 ? '+' : ''}${damageMod || ''}`,
    damageType,
    disadvantage: heavyDisadvantage || untrained || overloaded,
    ammunition: w.ammunition,
    ammunitionType: w.ammunitionType,
    loading: w.loading,
    reason: heavyDisadvantage
      ? '重型武器要求未满足'
      : untrained
        ? '缺少所穿护甲训练'
        : overloaded
          ? '严重超载'
          : undefined,
  };
}
export function isDndAmmunition(item: Item) {
  return item.quantity > 0 && item.equipment?.gearType === 'ammunition';
}
export function applyDndEquipmentEdit(card: Character, input: DndEquipmentEdit): Character {
  const parsed = DndEquipmentEditSchema.safeParse(input);
  if (!parsed.success) throw new Error('装备操作格式无效');
  if (card.rule !== 'dnd') throw new Error('装备联动仅适用于 D&D');
  const edit = parsed.data,
    next = structuredClone(card);
  if (edit.kind === 'configure') next.dndEquipment = edit.state;
  else if (edit.kind === 'disable') {
    delete next.dndEquipment;
    for (const i of next.items)
      if (i.equipment) {
        i.equipment.equipped = false;
        i.equipment.attuned = false;
      }
  } else if (edit.kind === 'add') {
    if (next.items.length >= 100) throw new Error('行囊最多容纳 100 项物品');
    if (next.items.some((i) => i.id === edit.item.id)) throw new Error('物品编号已存在');
    next.items.push(edit.item);
  } else {
    if (!next.dndEquipment) throw new Error('请先启用装备联动');
    const item = next.items.find((i) => i.id === edit.itemId),
      e = item?.equipment;
    if (!item || !e) throw new Error('找不到该装备');
    if (edit.kind === 'equip') {
      e.equipped = edit.equipped;
      if (edit.grip) e.grip = edit.grip;
      if (edit.mounted !== undefined) e.mounted = edit.mounted;
      if (e.weapon?.twoHanded && !(e.mounted && e.weapon.mountedException)) e.grip = 'two';
    } else if (edit.kind === 'attune') e.attuned = edit.attuned;
    else if (edit.kind === 'move') e.containerId = edit.containerId;
    else if (edit.kind === 'consume') {
      if (edit.amount > item.quantity) throw new Error('物品数量不足');
      item.quantity -= edit.amount;
      if (!item.quantity) {
        e.equipped = false;
        e.attuned = false;
      }
    } else if (edit.kind === 'drop') {
      next.items = next.items.filter((i) => i !== item);
      for (const i of next.items)
        if (i.equipment?.containerId === item.id) i.equipment.containerId = null;
    }
  }
  const errors = getDndEquipmentErrors(next);
  if (errors.length) throw new Error(errors[0]);
  next.updatedAt = new Date().toISOString();
  return next;
}
