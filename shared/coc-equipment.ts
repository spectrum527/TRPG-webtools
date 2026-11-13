import { z } from 'zod';
import { effectiveCharacter } from './adjustments';
import { COC_SKILL_CATALOG, CocSkillKeySchema } from './coc-career';
import { cocDamageBonusAndBuild } from './coc-physical';
import { rollDice, type DieRandom } from './dice';
import workbookEquipment from './coc-equipment-data.json';
import type { Character, DiceResult } from './types';
import {
  controlledValue,
  editValueControl,
  NumberControlEditSchema,
  NumberControlSchema,
  TextControlEditSchema,
  TextControlSchema,
} from './value-control';

const whole = (min: number, max: number) => z.number().int().min(min).max(max);
const itemId = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const equipmentName = z.string().trim().min(1).max(100);
const notes = z.string().trim().max(400);
const reason = z.string().trim().min(1).max(200);
const timestamp = z.string().datetime({ offset: true });
const ammoCount = whole(0, 9999);
const weaponLimit = 40;
const armorLimit = 30;

/** Bounded subset of the shared dice grammar; safe to combine a base and a DB. */
export const CocDamageExpressionSchema = z
  .string()
  .max(59)
  .transform((expression) => expression.toLowerCase().replace(/\s+/g, ''))
  .refine((expression) => {
    if (!/^[+\-]?(?:\d*d\d+|\d+)(?:[+\-](?:\d*d\d+|\d+))*$/.test(expression)) return false;
    let dice = 0;
    let flat = 0;
    for (const term of expression.match(/[+\-]?[^+\-]+/g)!) {
      const unsigned = term.replace(/^[+\-]/, '');
      if (!unsigned.includes('d')) flat += Number(unsigned);
      else {
        const [quantity, sides] = unsigned.split('d');
        if (Number(sides) < 2 || Number(sides) > 1000) return false;
        const count = quantity === '' ? 1 : Number(quantity);
        if (count < 1 || count > 40) return false;
        dice += count;
      }
    }
    return dice <= 40 && flat <= 4000;
  }, '请输入有效的伤害骰式，如 1d6+2');

const damageBonusMode = z.enum(['none', 'full', 'half']);
const era = z.enum(['1920s', 'modern', 'any']);
const source = z.enum(['coc7', 'workbook', 'interlude']);
export const COC_ARMOR_KINDS = {
  worn: '穿戴防具',
  shield: '盾牌',
  natural: '天生护甲',
  cover: '掩体',
  environment: '环境防护',
} as const;
export const COC_WEAPON_CATEGORIES = {
  melee: '近战',
  thrown: '投掷',
  bow: '弓弩',
  handgun: '手枪',
  rifle: '步枪',
  shotgun: '霰弹枪',
  smg: '冲锋枪',
  machineGun: '机枪',
  heavy: '重武器',
  explosive: '爆炸物',
  other: '其他',
} as const;
export const COC_ARMOR_LOCATIONS = {
  body: '躯干',
  head: '头部',
  face: '面部',
  eyes: '眼部',
  neck: '颈部',
  arms: '双臂',
  hands: '双手',
  legs: '双腿',
  feet: '双脚',
  chest: '前胸',
  back: '背部',
  abdomen: '腹部',
} as const;
export type CocArmorLocation = keyof typeof COC_ARMOR_LOCATIONS;
const location = z.enum(Object.keys(COC_ARMOR_LOCATIONS) as CocArmorLocation[]);
const coverage = z.enum(['body', 'head', 'all', 'custom', 'none']);
const reference = z.strictObject({
  sheet: z.enum(['武器列表', '防具表 载具表']),
  row: whole(2, 355),
});
const sourceText = z.partialRecord(
  z.enum([
    'skill',
    'damage',
    'range',
    'usesPerRound',
    'capacity',
    'malfunction',
    'era',
    'price',
    'kind',
    'rating',
    'movPenalty',
    'coverage',
    'species',
    'penetration',
    'protection',
  ]),
  z.string().max(500),
);
const distance = z.number().finite().min(0).max(10000);
const armorRating = whole(0, 99);
const movementPenalty = whole(0, 20);
const capacity = whole(0, 9999);
const shotsPerRound = whole(1, 20);
const malfunction = whole(0, 100); // 0 means no malfunction number.
const skillRating = whole(0, 1000);

export const CocWeaponProfileSchema = z
  .strictObject({
    name: equipmentName,
    category: z.enum([
      'melee',
      'thrown',
      'bow',
      'handgun',
      'rifle',
      'shotgun',
      'smg',
      'machineGun',
      'heavy',
      'explosive',
      'other',
    ]),
    skillKey: CocSkillKeySchema,
    damage: CocDamageExpressionSchema,
    damageBonusMode,
    impales: z.boolean(),
    range: distance,
    rangeRule: z.literal('strFifth').optional(),
    longerRanges: z
      .array(z.strictObject({ range: distance, damage: CocDamageExpressionSchema }))
      .max(2)
      .optional(),
    usesPerRound: shotsPerRound,
    rapidUsesPerRound: shotsPerRound.optional(),
    roundsPerUse: whole(2, 10).optional(),
    capacity,
    malfunction,
    ammoType: z.string().trim().min(1).max(50).optional(),
    era,
    reference: reference.optional(),
    sourceText: sourceText.optional(),
    rulesNotes: z.string().max(2000).optional(),
    manualDamage: z.boolean().optional(),
    manualRange: z.boolean().optional(),
  })
  .superRefine((profile, ctx) => {
    if (profile.rapidUsesPerRound !== undefined && profile.rapidUsesPerRound < profile.usesPerRound)
      ctx.addIssue({
        code: 'custom',
        path: ['rapidUsesPerRound'],
        message: '速射次数须不小于通常次数',
      });
    let previous = profile.range;
    for (const [index, band] of (profile.longerRanges ?? []).entries()) {
      if (previous <= 0 || band.range <= previous || profile.rangeRule)
        ctx.addIssue({
          code: 'custom',
          path: ['longerRanges', index, 'range'],
          message: '射程分段须逐段增加',
        });
      previous = band.range;
    }
  });

export const CocArmorProfileSchema = z
  .strictObject({
    name: equipmentName,
    rating: armorRating,
    movPenalty: movementPenalty,
    coverage,
    era,
    kind: z
      .enum(
        Object.keys(COC_ARMOR_KINDS) as [
          keyof typeof COC_ARMOR_KINDS,
          ...Array<keyof typeof COC_ARMOR_KINDS>,
        ],
      )
      .optional(),
    locations: z.array(location).min(1).max(12).optional(),
    reference: reference.optional(),
    sourceText: sourceText.optional(),
    rulesNotes: z.string().max(2000).optional(),
    manualRating: z.boolean().optional(),
  })
  .superRefine((profile, ctx) => {
    if (profile.coverage === 'custom' && !profile.locations?.length)
      ctx.addIssue({ code: 'custom', path: ['locations'], message: '请选择至少一个防护部位' });
    if (profile.locations && new Set(profile.locations).size !== profile.locations.length)
      ctx.addIssue({ code: 'custom', path: ['locations'], message: '防护部位不可重复' });
  });

export type CocWeaponProfile = z.infer<typeof CocWeaponProfileSchema>;
export type CocArmorProfile = z.infer<typeof CocArmorProfileSchema>;

export const COC_WEAPON_NUMBER_FIELDS = [
  'skill',
  'range',
  'usesPerRound',
  'rapidUsesPerRound',
  'capacity',
  'malfunction',
] as const;
export const COC_WEAPON_TEXT_FIELDS = ['skillKey', 'damage', 'damageBonusMode'] as const;
export const COC_ARMOR_FIELDS = ['rating', 'movPenalty'] as const;
export type CocWeaponNumberField = (typeof COC_WEAPON_NUMBER_FIELDS)[number];
export type CocWeaponTextField = (typeof COC_WEAPON_TEXT_FIELDS)[number];
export type CocArmorField = (typeof COC_ARMOR_FIELDS)[number];

const weaponOverrides = z.strictObject({
  skill: NumberControlSchema.extend({ manual: skillRating.nullable() }).optional(),
  range: NumberControlSchema.extend({ manual: distance.nullable() }).optional(),
  usesPerRound: NumberControlSchema.extend({ manual: shotsPerRound.nullable() }).optional(),
  rapidUsesPerRound: NumberControlSchema.extend({ manual: shotsPerRound.nullable() }).optional(),
  capacity: NumberControlSchema.extend({ manual: capacity.nullable() }).optional(),
  malfunction: NumberControlSchema.extend({ manual: malfunction.nullable() }).optional(),
  skillKey: TextControlSchema.extend({ manual: CocSkillKeySchema.nullable() }).optional(),
  damage: TextControlSchema.extend({ manual: CocDamageExpressionSchema.nullable() }).optional(),
  damageBonusMode: TextControlSchema.extend({ manual: damageBonusMode.nullable() }).optional(),
});

export const CocWeaponSchema = z
  .strictObject({
    id: itemId,
    catalogId: itemId.optional(),
    profile: CocWeaponProfileSchema,
    overrides: weaponOverrides.optional(),
    notes,
    ammo: z.strictObject({
      loaded: ammoCount,
      reserve: ammoCount,
      jammed: z.boolean(),
      lastCorrection: z
        .strictObject({ at: timestamp, reason, loaded: ammoCount, reserve: ammoCount })
        .optional(),
    }),
  })
  .superRefine((weapon, ctx) => {
    const limit = controlledValue(weapon.overrides?.capacity, weapon.profile.capacity);
    if (weapon.ammo.loaded > limit || (limit === 0 && weapon.ammo.reserve > 0))
      ctx.addIssue({ code: 'custom', path: ['ammo'], message: '弹药数与装弹量不符' });
    const uses = controlledValue(weapon.overrides?.usesPerRound, weapon.profile.usesPerRound);
    const rapid = weapon.overrides?.rapidUsesPerRound;
    if (rapid?.mode === 'manual' && rapid.manual !== null && rapid.manual < uses)
      ctx.addIssue({
        code: 'custom',
        path: ['overrides', 'rapidUsesPerRound'],
        message: '速射次数须不小于通常次数',
      });
  });

export const CocArmorSchema = z.strictObject({
  id: itemId,
  catalogId: itemId.optional(),
  profile: CocArmorProfileSchema,
  overrides: z
    .strictObject({
      rating: NumberControlSchema.extend({ manual: armorRating.nullable() }).optional(),
      movPenalty: NumberControlSchema.extend({ manual: movementPenalty.nullable() }).optional(),
    })
    .optional(),
  notes,
  equipped: z.boolean(),
});

export const CocEquipmentSchema = z
  .strictObject({
    weapons: z.array(CocWeaponSchema).max(weaponLimit),
    armor: z.array(CocArmorSchema).max(armorLimit),
  })
  .superRefine(({ weapons, armor }, ctx) => {
    const ids = [...weapons, ...armor].map(({ id }) => id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', path: [], message: '装备编号不可重复' });
  });

export type CocEquipment = z.infer<typeof CocEquipmentSchema>;
export type CocWeapon = z.infer<typeof CocWeaponSchema>;
export type CocArmor = z.infer<typeof CocArmorSchema>;

const weaponEntry = z.union([
  z.strictObject({ catalogId: itemId }),
  z.strictObject({ profile: CocWeaponProfileSchema }),
]);
const armorEntry = z.union([
  z.strictObject({ catalogId: itemId }),
  z.strictObject({ profile: CocArmorProfileSchema }),
]);

export const cocEquipmentEditOptions = [
  z.strictObject({
    kind: z.literal('weapon-add'),
    entry: weaponEntry,
    notes: notes.optional(),
    loaded: ammoCount.optional(),
    reserve: ammoCount.optional(),
  }),
  z.strictObject({ kind: z.literal('weapon-remove'), itemId }),
  z.strictObject({ kind: z.literal('weapon-notes'), itemId, notes }),
  z.strictObject({
    kind: z.literal('weapon-control'),
    itemId,
    field: z.enum([...COC_WEAPON_NUMBER_FIELDS, ...COC_WEAPON_TEXT_FIELDS]),
    change: z.union([NumberControlEditSchema, TextControlEditSchema]),
  }),
  z.strictObject({
    kind: z.literal('weapon-ammo'),
    itemId,
    loaded: ammoCount,
    reserve: ammoCount,
    reason,
  }),
  z.strictObject({ kind: z.literal('weapon-reload'), itemId, count: whole(1, 1000).optional() }),
  z.strictObject({ kind: z.literal('weapon-clear-jam'), itemId }),
  z.strictObject({
    kind: z.literal('armor-add'),
    entry: armorEntry,
    notes: notes.optional(),
    equipped: z.boolean().optional(),
  }),
  z.strictObject({ kind: z.literal('armor-remove'), itemId }),
  z.strictObject({ kind: z.literal('armor-notes'), itemId, notes }),
  z.strictObject({
    kind: z.literal('armor-control'),
    itemId,
    field: z.enum(COC_ARMOR_FIELDS),
    change: NumberControlEditSchema,
  }),
  z.strictObject({ kind: z.literal('armor-equip'), itemId, equipped: z.boolean() }),
] as const;

export const CocEquipmentEditSchema = z.discriminatedUnion('kind', cocEquipmentEditOptions);
export type CocEquipmentEdit = z.infer<typeof CocEquipmentEditSchema>;

export type WeaponCatalogEntry = {
  id: string;
  profile: CocWeaponProfile;
  source: z.infer<typeof source>;
  notes?: string;
};
export type ArmorCatalogEntry = {
  id: string;
  profile: CocArmorProfile;
  source: z.infer<typeof source>;
  notes?: string;
};

const brawl = {
  skillKey: 'fightingBrawl',
  category: 'melee',
  usesPerRound: 1,
  capacity: 0,
  range: 0,
  malfunction: 0,
  era: 'any',
  damageBonusMode: 'full',
} as const;
const handgun = {
  skillKey: 'firearmsHandgun',
  category: 'handgun',
  usesPerRound: 1,
  rapidUsesPerRound: 3,
  range: 15,
  damageBonusMode: 'none',
  impales: true,
} as const;
const rifle = {
  skillKey: 'firearmsRifle',
  category: 'rifle',
  usesPerRound: 1,
  damageBonusMode: 'none',
  impales: true,
} as const;
const shotgun = {
  skillKey: 'firearmsRifle',
  category: 'shotgun',
  usesPerRound: 1,
  damageBonusMode: 'none',
  impales: false,
} as const;

// Selected data from Chaosium's public equipment table and the Keeper Rulebook.
// Names are brief equipment labels; rules that need Keeper judgment are in notes.
export const COC_LEGACY_WEAPON_CATALOG: readonly WeaponCatalogEntry[] = [
  {
    id: 'unarmed',
    source: 'coc7',
    profile: { ...brawl, name: '徒手', damage: '1d3', impales: false },
  },
  {
    id: 'brass-knuckles',
    source: 'coc7',
    profile: { ...brawl, name: '黄铜指虎', damage: '1d3+1', impales: false },
  },
  {
    id: 'small-club',
    source: 'coc7',
    profile: { ...brawl, name: '短棍', damage: '1d6', impales: false },
  },
  {
    id: 'baseball-bat',
    source: 'coc7',
    profile: { ...brawl, name: '棒球棍', damage: '1d8', impales: false },
  },
  {
    id: 'small-knife',
    source: 'coc7',
    profile: { ...brawl, name: '小刀', damage: '1d4', impales: true },
  },
  {
    id: 'carving-knife',
    source: 'coc7',
    profile: { ...brawl, name: '切肉刀', damage: '1d4+2', impales: true },
  },
  {
    id: 'machete',
    source: 'coc7',
    profile: { ...brawl, name: '砍刀', damage: '1d8', impales: true },
  },
  {
    id: 'thrown-rock',
    source: 'coc7',
    profile: {
      ...brawl,
      name: '投石',
      category: 'thrown',
      skillKey: 'throw',
      damage: '1d4',
      damageBonusMode: 'half',
      rangeRule: 'strFifth',
      impales: false,
    },
  },
  {
    id: 'thrown-spear',
    source: 'coc7',
    profile: {
      ...brawl,
      name: '投矛',
      category: 'thrown',
      skillKey: 'throw',
      damage: '1d8',
      damageBonusMode: 'half',
      rangeRule: 'strFifth',
      impales: true,
    },
  },
  {
    id: 'bow',
    source: 'coc7',
    profile: {
      name: '弓',
      category: 'bow',
      skillKey: 'firearmsBow',
      damage: '1d6',
      damageBonusMode: 'half',
      impales: true,
      range: 30,
      usesPerRound: 1,
      capacity: 1,
      malfunction: 97,
      ammoType: '箭',
      era: 'any',
    },
  },
  {
    id: 'automatic-22',
    source: 'coc7',
    profile: {
      ...handgun,
      name: '.22 短弹半自动手枪',
      damage: '1d6',
      range: 10,
      capacity: 6,
      malfunction: 100,
      ammoType: '.22 Short',
      era: '1920s',
    },
  },
  {
    id: 'derringer-25',
    source: 'coc7',
    profile: {
      ...handgun,
      name: '.25 德林杰手枪',
      damage: '1d6',
      range: 3,
      rapidUsesPerRound: 1,
      capacity: 1,
      malfunction: 100,
      ammoType: '.25 ACP',
      era: '1920s',
    },
  },
  {
    id: 'revolver-32',
    source: 'coc7',
    profile: {
      ...handgun,
      name: '.32 左轮手枪',
      damage: '1d8',
      capacity: 6,
      malfunction: 100,
      ammoType: '.32',
      era: 'any',
    },
  },
  {
    id: 'revolver-38',
    source: 'coc7',
    profile: {
      ...handgun,
      name: '.38 左轮手枪',
      damage: '1d10',
      capacity: 6,
      malfunction: 100,
      ammoType: '.38',
      era: 'any',
    },
  },
  {
    id: 'p08-luger',
    source: 'coc7',
    profile: {
      ...handgun,
      name: 'P08 鲁格手枪',
      damage: '1d10',
      capacity: 8,
      malfunction: 99,
      ammoType: '9 mm',
      era: '1920s',
    },
  },
  {
    id: 'revolver-45',
    source: 'coc7',
    profile: {
      ...handgun,
      name: '.45 左轮手枪',
      damage: '1d10+2',
      capacity: 6,
      malfunction: 100,
      ammoType: '.45',
      era: 'any',
    },
  },
  {
    id: 'automatic-45',
    source: 'coc7',
    profile: {
      ...handgun,
      name: '.45 半自动手枪',
      damage: '1d10+2',
      capacity: 7,
      malfunction: 100,
      ammoType: '.45 ACP',
      era: 'any',
    },
  },
  {
    id: 'beretta-m9',
    source: 'workbook',
    profile: {
      ...handgun,
      name: '贝雷塔 M9 手枪',
      damage: '1d10',
      capacity: 15,
      malfunction: 98,
      ammoType: '9 mm',
      era: 'modern',
    },
  },
  {
    id: 'glock-17',
    source: 'workbook',
    profile: {
      ...handgun,
      name: '格洛克 17 手枪',
      damage: '1d10',
      capacity: 17,
      malfunction: 98,
      ammoType: '9 mm',
      era: 'modern',
    },
  },
  {
    id: 'bolt-rifle-22',
    source: 'coc7',
    profile: {
      ...rifle,
      name: '.22 栓动步枪',
      damage: '1d6+1',
      range: 30,
      capacity: 6,
      malfunction: 99,
      ammoType: '.22',
      era: 'any',
    },
  },
  {
    id: 'lever-carbine-30',
    source: 'coc7',
    profile: {
      ...rifle,
      name: '.30 杠杆式卡宾枪',
      damage: '2d6',
      range: 50,
      capacity: 6,
      malfunction: 98,
      ammoType: '.30',
      era: 'any',
    },
  },
  {
    id: 'martini-henry-45',
    source: 'coc7',
    profile: {
      ...rifle,
      name: '.45 马蒂尼－亨利步枪',
      damage: '1d8+1d6+3',
      range: 80,
      roundsPerUse: 3,
      capacity: 1,
      malfunction: 100,
      ammoType: '.45',
      era: '1920s',
    },
  },
  {
    id: 'lee-enfield-303',
    source: 'coc7',
    profile: {
      ...rifle,
      name: '.303 李－恩菲尔德步枪',
      damage: '2d6+4',
      range: 110,
      capacity: 10,
      malfunction: 100,
      ammoType: '.303 British',
      era: '1920s',
    },
  },
  {
    id: 'bolt-rifle-30-06',
    source: 'coc7',
    profile: {
      ...rifle,
      name: '.30-06 栓动步枪',
      damage: '2d6+4',
      range: 110,
      capacity: 5,
      malfunction: 100,
      ammoType: '.30-06',
      era: 'any',
    },
  },
  {
    id: 'double-shotgun-12',
    source: 'coc7',
    profile: {
      ...shotgun,
      name: '12 号双管霰弹枪',
      damage: '4d6',
      range: 10,
      longerRanges: [
        { range: 20, damage: '2d6' },
        { range: 50, damage: '1d6' },
      ],
      rapidUsesPerRound: 2,
      capacity: 2,
      malfunction: 100,
      ammoType: '12 号霰弹',
      era: 'any',
    },
  },
  {
    id: 'pump-shotgun-12',
    source: 'workbook',
    profile: {
      ...shotgun,
      name: '12 号泵动霰弹枪',
      damage: '4d6',
      range: 10,
      longerRanges: [
        { range: 20, damage: '2d6' },
        { range: 50, damage: '1d6' },
      ],
      capacity: 5,
      malfunction: 100,
      ammoType: '12 号霰弹',
      era: 'modern',
    },
  },
  {
    id: 'semiauto-shotgun-12',
    source: 'coc7',
    profile: {
      ...shotgun,
      name: '12 号半自动霰弹枪',
      damage: '4d6',
      range: 10,
      longerRanges: [
        { range: 20, damage: '2d6' },
        { range: 50, damage: '1d6' },
      ],
      rapidUsesPerRound: 2,
      capacity: 5,
      malfunction: 100,
      ammoType: '12 号霰弹',
      era: 'any',
    },
  },
  {
    id: 'thompson',
    source: 'coc7',
    profile: {
      name: '汤普森冲锋枪',
      category: 'other',
      skillKey: 'firearmsSmg',
      damage: '1d10+2',
      damageBonusMode: 'none',
      impales: true,
      range: 20,
      usesPerRound: 1,
      capacity: 20,
      malfunction: 96,
      ammoType: '.45 ACP',
      era: '1920s',
    },
    notes: '此档案使用 20 发弹匣。全自动射击由守秘人裁定。',
  },
];

export const COC_LEGACY_ARMOR_CATALOG: readonly ArmorCatalogEntry[] = [
  {
    id: 'heavy-leather-jacket',
    source: 'coc7',
    profile: { name: '厚皮夹克', rating: 1, movPenalty: 0, coverage: 'body', era: 'any' },
  },
  {
    id: 'steel-helmet',
    source: 'coc7',
    profile: { name: '一战钢盔', rating: 2, movPenalty: 0, coverage: 'head', era: '1920s' },
    notes: '只保护头部。',
  },
  {
    id: 'modern-helmet',
    source: 'coc7',
    profile: { name: '现代军用头盔', rating: 5, movPenalty: 0, coverage: 'head', era: 'modern' },
    notes: '只保护头部。',
  },
  {
    id: 'heavy-kevlar-vest',
    source: 'coc7',
    profile: { name: '重型凯夫拉背心', rating: 8, movPenalty: 0, coverage: 'body', era: 'modern' },
  },
  {
    id: 'body-armor',
    source: 'coc7',
    profile: { name: '重型军用防弹衣', rating: 12, movPenalty: 0, coverage: 'body', era: 'modern' },
  },
  {
    id: 'protective-suit',
    source: 'workbook',
    profile: { name: '防刺西服', rating: 5, movPenalty: 1, coverage: 'body', era: 'modern' },
  },
];

export const COC_WORKBOOK_WEAPONS: readonly WeaponCatalogEntry[] = workbookEquipment.weapons.map(
  (entry) => ({
    ...entry,
    source: 'workbook',
    profile: CocWeaponProfileSchema.parse(entry.profile),
  }),
);
export const COC_WORKBOOK_ARMOR: readonly ArmorCatalogEntry[] = workbookEquipment.armor.map(
  (entry) => ({
    ...entry,
    source: 'workbook',
    profile: CocArmorProfileSchema.parse(entry.profile),
  }),
);
export const COC_WEAPON_CATALOG = [...COC_LEGACY_WEAPON_CATALOG, ...COC_WORKBOOK_WEAPONS];
export const COC_ARMOR_CATALOG = [...COC_LEGACY_ARMOR_CATALOG, ...COC_WORKBOOK_ARMOR];

export function cocArmorCoverageLabel(profile: CocArmorProfile): string {
  if (profile.coverage === 'custom')
    return (profile.locations ?? []).map((key) => COC_ARMOR_LOCATIONS[key]).join('、');
  return { body: '躯干', head: '头部', all: '全身', none: '按遮挡范围裁定' }[profile.coverage];
}

export function defaultCocEquipment(): CocEquipment {
  return { weapons: [], armor: [] };
}

function getWeapon(card: Character, itemId: string) {
  const weapon = card.cocInvestigator?.equipment?.weapons.find(({ id }) => id === itemId);
  if (!weapon) throw new Error('这件武器已不在装备栏');
  return weapon;
}

function joinDamage(base: string, bonus: string): string {
  return bonus === '0' ? base : `${base}${/^[+-]/.test(bonus) ? '' : '+'}${bonus}`;
}

export function cocWeaponValues(
  card: Character,
  weaponOrId: CocWeapon | string,
  options: { distanceYards?: number; includeTemporary?: boolean } = {},
) {
  const weapon = typeof weaponOrId === 'string' ? getWeapon(card, weaponOrId) : weaponOrId;
  const { profile, overrides } = weapon;
  const effective = effectiveCharacter(card, options.includeTemporary ?? true);
  const skillKey = controlledValue(overrides?.skillKey, profile.skillKey);
  const automaticSkill =
    effective.skills[skillKey] ??
    COC_SKILL_CATALOG.find((item) => item.key === skillKey)?.base ??
    0;
  const skill = controlledValue(overrides?.skill, automaticSkill);
  const automaticRange = profile.rangeRule
    ? Math.floor((effective.attributes.str ?? 0) / 5)
    : profile.range;
  const range = controlledValue(overrides?.range, automaticRange);
  const usesPerRound = controlledValue(overrides?.usesPerRound, profile.usesPerRound);
  const automaticRapid = Math.max(usesPerRound, profile.rapidUsesPerRound ?? 0);
  const rapidUsesPerRound = controlledValue(overrides?.rapidUsesPerRound, automaticRapid);
  const baseDamage = controlledValue(overrides?.damage, profile.damage);
  const longerRanges =
    range === 0
      ? []
      : (profile.longerRanges ?? []).map((band) => ({
          range: band.range + range - profile.range,
          damage:
            overrides?.damage?.mode === 'manual' && overrides.damage.manual !== null
              ? baseDamage
              : band.damage,
        }));
  let damage = baseDamage;
  if (options.distanceYards !== undefined) {
    if (!Number.isFinite(options.distanceYards) || options.distanceYards < 0)
      throw new Error('射击距离无效');
    if (options.distanceYards > range && longerRanges.length) {
      const band = longerRanges.find((item) => options.distanceYards! <= item.range);
      if (!band) throw new Error('已超出这件武器的最远射程');
      damage = band.damage;
    }
  }
  const mode = controlledValue(overrides?.damageBonusMode, profile.damageBonusMode);
  const damageBonus =
    mode === 'none'
      ? '0'
      : controlledValue(
          card.cocInvestigator?.derived?.db,
          cocDamageBonusAndBuild(effective.attributes.str, effective.attributes.siz).db,
        );
  const halfDice = mode === 'half' && damageBonus.includes('d');
  const bonusExpression =
    mode === 'half' && !halfDice
      ? String(Math.trunc(rollDice(damageBonus).total / 2))
      : damageBonus;
  const damageExpression = halfDice
    ? `${damage}+(${damageBonus})÷2`
    : joinDamage(damage, bonusExpression);
  return {
    name: profile.name,
    category: profile.category,
    skillKey,
    skill,
    range,
    longerRanges,
    usesPerRound,
    rapidUsesPerRound,
    roundsPerUse: profile.roundsPerUse,
    capacity: controlledValue(overrides?.capacity, profile.capacity),
    malfunction: controlledValue(overrides?.malfunction, profile.malfunction),
    damage,
    damageBonus,
    damageBonusMode: mode,
    damageExpression,
    damageRequiresRuling:
      profile.manualDamage === true &&
      !(overrides?.damage?.mode === 'manual' && overrides.damage.manual !== null),
    rangeRequiresRuling:
      profile.manualRange === true &&
      !(overrides?.range?.mode === 'manual' && overrides.range.manual !== null),
    impales: profile.impales,
    ammo: weapon.ammo,
    ammoType: profile.ammoType,
    automatic: {
      skill: automaticSkill,
      skillKey: profile.skillKey,
      damage: profile.damage,
      damageBonusMode: profile.damageBonusMode,
      range: automaticRange,
      usesPerRound: profile.usesPerRound,
      rapidUsesPerRound: automaticRapid,
      capacity: profile.capacity,
      malfunction: profile.malfunction,
    },
  };
}

function maximumDamage(expression: string): number {
  const result = rollDice(expression, () => 1);
  return (
    result.modifier +
    result.groups.reduce((sum, { count, sides, sign }) => sum + count * (sign > 0 ? sides : -1), 0)
  );
}

/** Half DB is evaluated as a separate roll; the formatted expression is never executed. */
export function rollCocWeaponDamage(
  values: Pick<
    ReturnType<typeof cocWeaponValues>,
    'damage' | 'damageBonus' | 'damageBonusMode' | 'damageExpression' | 'impales'
  > & { damageRequiresRuling?: boolean },
  rng?: DieRandom,
  { extreme = false }: { extreme?: boolean } = {},
): DiceResult {
  if (values.damageRequiresRuling)
    throw new Error('此武器没有固定 HP 伤害，请由主持人裁定或解锁填写伤害骰式');
  const damage = CocDamageExpressionSchema.parse(values.damage);
  const mode = damageBonusMode.parse(values.damageBonusMode);
  const bonus = mode === 'none' ? '0' : CocDamageExpressionSchema.parse(values.damageBonus);
  const half = mode === 'half';
  const maxBase = extreme ? maximumDamage(damage) : 0;
  const maxBonus = extreme ? maximumDamage(bonus) : 0;
  const bonusMax = half ? Math.trunc(maxBonus / 2) : maxBonus;
  if (extreme) {
    const maximum = maxBase + bonusMax;
    if (!values.impales)
      return {
        expression: String(maximum),
        groups: [],
        modifier: maximum,
        total: Math.max(0, maximum),
      };
    const result = rollDice(damage, rng);
    return {
      ...result,
      expression: joinDamage(result.expression, String(maximum)),
      modifier: result.modifier + maximum,
      total: Math.max(0, result.total + maximum),
    };
  }
  if (!half) {
    const result = rollDice(joinDamage(damage, bonus), rng);
    return { ...result, total: Math.max(0, result.total) };
  }
  const base = rollDice(damage, rng);
  const bonusRoll = rollDice(bonus, rng);
  const bonusContribution = Math.trunc(bonusRoll.total / 2);
  const bonusDiceTotal = bonusRoll.total - bonusRoll.modifier;
  return {
    expression: `${base.expression}+(${bonusRoll.expression})÷2`,
    groups: [...base.groups, ...bonusRoll.groups],
    modifier: base.modifier + bonusContribution - bonusDiceTotal,
    total: Math.max(0, base.total + bonusContribution),
  };
}

/** Shotgun pellets each meet the armor; a slug uses the normal flat reduction. */
export function cocWeaponArmorReduction(
  values: Pick<ReturnType<typeof cocWeaponValues>, 'category' | 'impales' | 'damage'>,
  roll: DiceResult,
  armor: number,
): number {
  // NPC armor and explicit encounter overrides can exceed wearable armor values.
  if (!Number.isInteger(armor) || armor < 0 || armor > 100000) throw new Error('护甲值无效');
  if (!armor || values.category !== 'shotgun' || values.impales) return Math.min(roll.total, armor);
  const base = rollDice(values.damage, (sides) => sides).groups;
  const groups = roll.groups.length ? roll.groups.slice(0, base.length) : base;
  const pellets = groups
    .filter(({ sign, sides }) => sign > 0 && sides === 6)
    .flatMap(({ rolls }) => rolls);
  const reduction = pellets.length
    ? pellets.reduce((sum, value) => sum + Math.min(value, armor), 0)
    : armor;
  return Math.min(roll.total, reduction);
}

export function cocArmorValues(armor: CocArmor) {
  return {
    name: armor.profile.name,
    coverage: armor.profile.coverage,
    resolved:
      !armor.profile.manualRating ||
      (armor.overrides?.rating?.mode === 'manual' && armor.overrides.rating.manual !== null),
    rating: controlledValue(armor.overrides?.rating, armor.profile.rating),
    movPenalty: controlledValue(armor.overrides?.movPenalty, armor.profile.movPenalty),
  };
}

function armorCovers(profile: CocArmorProfile, location: CocArmorLocation): boolean {
  if (profile.kind && !['worn', 'natural'].includes(profile.kind)) return false;
  if (profile.coverage === 'none') return false;
  if (profile.coverage === 'all') return true;
  const locations = profile.coverage === 'custom' ? (profile.locations ?? []) : [profile.coverage];
  return (
    locations.includes(location) ||
    (['chest', 'back', 'abdomen'].includes(location) && locations.includes('body'))
  );
}

export function cocUnresolvedArmor(
  card: Character,
  location: CocArmorLocation = 'body',
): CocArmor[] {
  return (card.cocInvestigator?.equipment?.armor ?? []).filter(
    (armor) =>
      armor.equipped && armorCovers(armor.profile, location) && !cocArmorValues(armor).resolved,
  );
}

/** Situational shields, cover and environmental protection require a keeper ruling. */
export function cocArmorValue(
  card: Character,
  { location = 'body' }: { location?: CocArmorLocation } = {},
): number {
  return Math.max(
    0,
    ...(card.cocInvestigator?.equipment?.armor ?? [])
      .filter(
        (armor) =>
          armor.equipped && armorCovers(armor.profile, location) && cocArmorValues(armor).resolved,
      )
      .map((armor) => cocArmorValues(armor).rating),
  );
}

function replaceWeapon(card: Character, weapon: CocWeapon): Character {
  const equipment = card.cocInvestigator?.equipment;
  if (!equipment) throw new Error('这件武器已不在装备栏');
  return {
    ...card,
    cocInvestigator: {
      ...card.cocInvestigator,
      equipment: {
        ...equipment,
        weapons: equipment.weapons.map((item) => (item.id === weapon.id ? weapon : item)),
      },
    },
  };
}

export function consumeCocAmmunition(
  card: Character,
  weaponId: string,
  { shots = 1, roll }: { shots?: number; roll?: number } = {},
): Character {
  const weapon = getWeapon(card, weaponId);
  const values = cocWeaponValues(card, weapon);
  if (!Number.isInteger(shots) || shots < 1 || shots > values.rapidUsesPerRound)
    throw new Error('射击次数超出此武器的每轮次数');
  if (roll !== undefined && (!Number.isInteger(roll) || roll < 1 || roll > 100))
    throw new Error('检定骰点无效');
  if (weapon.ammo.jammed) throw new Error('武器发生故障，请先解除故障');
  if (values.capacity > 0 && weapon.ammo.loaded < shots) throw new Error('武器弹药不足，请先装填');
  const jammed = values.malfunction > 0 && roll !== undefined && roll >= values.malfunction;
  if (values.capacity === 0 && !jammed) return card;
  const loaded = values.capacity > 0 && !jammed ? weapon.ammo.loaded - shots : weapon.ammo.loaded;
  return replaceWeapon(card, { ...weapon, ammo: { ...weapon.ammo, loaded, jammed } });
}

export function reloadCocWeapon(card: Character, weaponId: string, count?: number): Character {
  const weapon = getWeapon(card, weaponId);
  const { capacity } = cocWeaponValues(card, weapon);
  if (weapon.ammo.jammed) throw new Error('请先解除武器故障');
  if (!capacity) throw new Error('这件武器无需装填');
  const available = Math.min(capacity - weapon.ammo.loaded, weapon.ammo.reserve);
  if (!available) throw new Error(weapon.ammo.loaded === capacity ? '武器已装满' : '备用弹药不足');
  const amount = count ?? available;
  if (!Number.isInteger(amount) || amount < 1 || amount > available)
    throw new Error('装填数量超出空位或备用弹药');
  return replaceWeapon(card, {
    ...weapon,
    ammo: {
      ...weapon.ammo,
      loaded: weapon.ammo.loaded + amount,
      reserve: weapon.ammo.reserve - amount,
    },
  });
}

export function clearCocWeaponJam(card: Character, weaponId: string): Character {
  const weapon = getWeapon(card, weaponId);
  if (!weapon.ammo.jammed) throw new Error('这件武器没有故障');
  return replaceWeapon(card, { ...weapon, ammo: { ...weapon.ammo, jammed: false } });
}

function isWeaponTextField(
  field: CocWeaponNumberField | CocWeaponTextField,
): field is CocWeaponTextField {
  return (COC_WEAPON_TEXT_FIELDS as readonly string[]).includes(field);
}

export function applyCocEquipmentEdit(
  card: Character,
  input: CocEquipmentEdit,
  context: { now: string; id: () => string },
): CocEquipment {
  const edit = CocEquipmentEditSchema.parse(input);
  const state = card.cocInvestigator?.equipment ?? defaultCocEquipment();
  const replace = (weapon: CocWeapon) => ({
    ...state,
    weapons: state.weapons.map((item) => (item.id === weapon.id ? weapon : item)),
  });
  switch (edit.kind) {
    case 'weapon-add': {
      if (state.weapons.length >= weaponLimit) throw new Error('已达到武器数量上限');
      const preset =
        'catalogId' in edit.entry
          ? COC_WEAPON_CATALOG.find(
              ({ id }) => id === ('catalogId' in edit.entry ? edit.entry.catalogId : ''),
            )
          : undefined;
      if ('catalogId' in edit.entry && !preset) throw new Error('装备目录中没有这件武器');
      const profile = 'profile' in edit.entry ? edit.entry.profile : preset!.profile;
      const weapon = CocWeaponSchema.parse({
        id: context.id(),
        catalogId: preset?.id,
        profile,
        notes: edit.notes ?? preset?.notes ?? '',
        ammo: { loaded: edit.loaded ?? 0, reserve: edit.reserve ?? 0, jammed: false },
      });
      return { ...state, weapons: [...state.weapons, weapon] };
    }
    case 'weapon-remove': {
      getWeapon(card, edit.itemId);
      return { ...state, weapons: state.weapons.filter(({ id }) => id !== edit.itemId) };
    }
    case 'weapon-notes':
      return replace({ ...getWeapon(card, edit.itemId), notes: edit.notes });
    case 'weapon-control': {
      const weapon = getWeapon(card, edit.itemId);
      const { field } = edit;
      const values = cocWeaponValues(card, weapon);
      const overrides = { ...weapon.overrides };
      if (isWeaponTextField(field)) {
        const change = TextControlEditSchema.parse(edit.change);
        if (field === 'damageBonusMode') {
          const typedChange =
            change.kind === 'value'
              ? { ...change, value: damageBonusMode.parse(change.value) }
              : change;
          overrides.damageBonusMode = editValueControl(
            overrides.damageBonusMode,
            typedChange,
            values.automatic.damageBonusMode,
          );
        } else
          overrides[field] = editValueControl(overrides[field], change, values.automatic[field]);
      } else {
        const change = NumberControlEditSchema.parse(edit.change);
        overrides[field] = editValueControl(overrides[field], change, values.automatic[field]);
      }
      const next = CocWeaponSchema.safeParse({ ...weapon, overrides });
      if (!next.success) throw new Error(next.error.issues[0].message);
      return replace(next.data);
    }
    case 'weapon-ammo': {
      const weapon = getWeapon(card, edit.itemId);
      const ammo = {
        ...weapon.ammo,
        loaded: edit.loaded,
        reserve: edit.reserve,
        lastCorrection: {
          at: context.now,
          reason: edit.reason,
          loaded: edit.loaded,
          reserve: edit.reserve,
        },
      };
      const next = CocWeaponSchema.safeParse({ ...weapon, ammo });
      if (!next.success) throw new Error(next.error.issues[0].message);
      return replace(next.data);
    }
    case 'weapon-reload':
      return reloadCocWeapon(card, edit.itemId, edit.count).cocInvestigator!.equipment!;
    case 'weapon-clear-jam':
      return clearCocWeaponJam(card, edit.itemId).cocInvestigator!.equipment!;
    case 'armor-add': {
      if (state.armor.length >= armorLimit) throw new Error('已达到防具数量上限');
      const preset =
        'catalogId' in edit.entry
          ? COC_ARMOR_CATALOG.find(
              ({ id }) => id === ('catalogId' in edit.entry ? edit.entry.catalogId : ''),
            )
          : undefined;
      if ('catalogId' in edit.entry && !preset) throw new Error('装备目录中没有这件防具');
      const profile = 'profile' in edit.entry ? edit.entry.profile : preset!.profile;
      const armor = CocArmorSchema.parse({
        id: context.id(),
        catalogId: preset?.id,
        profile,
        equipped: edit.equipped ?? false,
        notes: edit.notes ?? preset?.notes ?? '',
      });
      return { ...state, armor: [...state.armor, armor] };
    }
    default: {
      const armor = state.armor.find(({ id }) => id === edit.itemId);
      if (!armor) throw new Error('这件防具已不在装备栏');
      if (edit.kind === 'armor-remove')
        return { ...state, armor: state.armor.filter(({ id }) => id !== edit.itemId) };
      let next: CocArmor;
      if (edit.kind === 'armor-equip') next = { ...armor, equipped: edit.equipped };
      else if (edit.kind === 'armor-notes') next = { ...armor, notes: edit.notes };
      else {
        const { field } = edit;
        const overrides = {
          ...armor.overrides,
          [field]: editValueControl(armor.overrides?.[field], edit.change, armor.profile[field]),
        };
        const checked = CocArmorSchema.safeParse({ ...armor, overrides });
        if (!checked.success) throw new Error(checked.error.issues[0].message);
        next = checked.data;
      }
      return { ...state, armor: state.armor.map((item) => (item.id === armor.id ? next : item)) };
    }
  }
}
