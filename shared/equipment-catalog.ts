import { z } from 'zod';
import { DndEditionSchema } from './dnd-edition';

const relativePath = z
  .string()
  .min(1)
  .max(1000)
  .refine(
    (path) =>
      !path.startsWith('/') &&
      !path.startsWith('\\') &&
      !/^[A-Za-z]:/.test(path) &&
      !path.split(/[\\/]/).includes('..'),
    '来源路径应为相对路径',
  );
const optionalText = z.string().max(20000).nullable();
const amount = z.number().finite().nonnegative().nullable();
const bool = z.boolean().nullable();

export const EquipmentSourceSchema = z.strictObject({
  id: z.string().min(1).max(120),
  book: z.string().min(1).max(200),
  path: relativePath,
  tableId: z.string().max(100).nullable(),
  row: z.number().int().positive().nullable(),
  additionalPaths: z.array(relativePath).max(10),
});
export const EquipmentWeaponSchema = z.strictObject({
  proficiency: z.enum(['simple', 'martial']),
  ranged: z.boolean(),
  damageDice: z.string().max(40).nullable(),
  damageType: z.string().max(100).nullable(),
  finesse: bool,
  light: bool,
  heavy: bool,
  thrown: bool,
  ammunition: bool,
  twoHanded: bool,
  twoHandedException: optionalText,
  versatileDice: z.string().max(40).nullable(),
  reach: bool,
  loading: bool,
  rangeNormalFt: amount,
  rangeLongFt: amount,
  ammunitionType: z.string().max(100).nullable(),
  mastery: z.string().max(100).nullable(),
  masteryDescription: optionalText,
  propertyText: z.string().max(1000).nullable(),
  specialText: optionalText,
});
export const EquipmentArmorSchema = z.strictObject({
  category: z.enum(['light', 'medium', 'heavy']),
  baseAC: z.number().int().nonnegative().nullable(),
  addsDex: bool,
  dexCap: z.number().int().nullable(),
  strengthRequirement: z.number().int().nonnegative().nullable(),
  stealthDisadvantage: bool,
  armorClassText: z.string().max(1000).nullable(),
  strengthText: z.string().max(1000).nullable(),
  stealthText: z.string().max(1000).nullable(),
});
export const EquipmentShieldSchema = z.strictObject({ bonusAC: z.number().int().nullable() });
export const EquipmentContainerSchema = z.strictObject({
  capacityLb: amount,
  capacityCubicFeet: amount,
  capacityCount: z.number().int().positive().nullable(),
  capacityItem: z.string().max(200).nullable(),
  capacityText: z.string().min(1).max(2000),
});
export const EquipmentCatalogItemSchema = z
  .strictObject({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    edition: DndEditionSchema,
    name: z.string().min(1).max(300),
    nameEn: z.string().max(300).nullable(),
    rawName: z.string().min(1).max(500),
    kind: z.enum(['weapon', 'armor', 'shield', 'adventuring']),
    gearType: z.enum(['ammunition', 'container', 'pack', 'general']).nullable(),
    weightLb: amount,
    weightWhenFullLb: amount,
    weightText: z.string().max(1000).nullable(),
    costCp: z.number().int().nonnegative().nullable(),
    costText: z.string().max(1000).nullable(),
    quantityPerPack: z.number().int().positive().nullable(),
    description: optionalText,
    source: EquipmentSourceSchema,
    weapon: EquipmentWeaponSchema.nullable(),
    armor: EquipmentArmorSchema.nullable(),
    shield: EquipmentShieldSchema.nullable(),
    container: EquipmentContainerSchema.nullable(),
  })
  .superRefine((item, context) => {
    if (
      (item.kind === 'weapon') !== (item.weapon !== null) ||
      (item.kind === 'armor') !== (item.armor !== null) ||
      (item.kind === 'shield') !== (item.shield !== null) ||
      (item.kind !== 'adventuring' && (item.gearType !== null || item.container !== null)) ||
      (item.container !== null && item.gearType !== 'container')
    )
      context.addIssue({ code: 'custom', message: '装备类型与对应字段不一致' });
  });

export type EquipmentCatalogItem = z.infer<typeof EquipmentCatalogItemSchema>;
export type EquipmentWeapon = z.infer<typeof EquipmentWeaponSchema>;
export type EquipmentArmor = z.infer<typeof EquipmentArmorSchema>;
export type EquipmentContainer = z.infer<typeof EquipmentContainerSchema>;
export type EquipmentSource = z.infer<typeof EquipmentSourceSchema>;
export const EquipmentCatalogPackSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    edition: DndEditionSchema,
    items: z.array(EquipmentCatalogItemSchema).max(1000),
  })
  .superRefine((pack, context) => {
    if (pack.items.some((item) => item.edition !== pack.edition))
      context.addIssue({ code: 'custom', message: '装备资料包含其他版次' });
    if (new Set(pack.items.map((item) => item.id)).size !== pack.items.length)
      context.addIssue({ code: 'custom', message: '装备资料包含重复编号' });
  });
export type EquipmentCatalogPack = z.infer<typeof EquipmentCatalogPackSchema>;
export function parseEquipmentCatalog(value: unknown): EquipmentCatalogPack {
  const parsed = EquipmentCatalogPackSchema.safeParse(value);
  if (!parsed.success) throw new Error('装备目录格式无效，请检查资料版本或刷新页面。');
  return parsed.data;
}
