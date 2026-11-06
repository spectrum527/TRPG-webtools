import type { DndEdition } from './dnd-edition';

/** First-class starting proficiencies only: multiclass, subclass, species and feats need their own evidence. */
export type ArmorTraining = 'light' | 'medium' | 'heavy' | 'shield';
export type WeaponProficiencyCategory = 'simple' | 'martial';
export type MartialWeaponProperty = 'finesse' | 'light';
export interface EquipmentProficiencySource {
  book: string;
  id: string;
  path: string;
}
export interface EquipmentProficiencyOption {
  id: string;
  name: string;
  armorTraining: readonly ArmorTraining[];
  weaponCategories: readonly WeaponProficiencyCategory[];
  source: EquipmentProficiencySource;
}
export interface EquipmentProficiencies {
  edition: DndEdition;
  className: string;
  armorTraining: readonly ArmorTraining[];
  weaponCategories: readonly WeaponProficiencyCategory[];
  specificWeapons: readonly string[];
  /** A martial weapon qualifies if any of these properties is true, not necessarily all. */
  martialPropertiesAny: readonly MartialWeaponProperty[];
  restrictions: readonly string[];
  armorText: string;
  weaponText: string;
  source: EquipmentProficiencySource;
  /** Not granted automatically; the player must actually choose this class feature. */
  options: readonly EquipmentProficiencyOption[];
}

type Entry = Omit<
  EquipmentProficiencies,
  'edition' | 'source' | 'options' | 'restrictions' | 'specificWeapons' | 'martialPropertiesAny'
> & {
  sourceId: string;
  sourcePath: string;
  restrictions?: readonly string[];
  specificWeapons?: readonly string[];
  martialPropertiesAny?: readonly MartialWeaponProperty[];
  options?: readonly EquipmentProficiencyOption[];
};

const light: readonly ArmorTraining[] = ['light'];
const mediumShield: readonly ArmorTraining[] = ['light', 'medium', 'shield'];
const allArmor: readonly ArmorTraining[] = ['light', 'medium', 'heavy', 'shield'];
const simple: readonly WeaponProficiencyCategory[] = ['simple'];
const allWeapons: readonly WeaponProficiencyCategory[] = ['simple', 'martial'];
const duelistWeapons = ['手弩', '长剑', '刺剑', '短剑'] as const;
const casterWeapons = ['匕首', '飞镖', '投石索', '长棍', '轻弩'] as const;
const firstEdition: readonly Entry[] = [
  {
    className: '野蛮人',
    armorTraining: mediumShield,
    weaponCategories: allWeapons,
    armorText: '轻甲、中甲、盾牌',
    weaponText: '简易武器、军用武器',
    sourceId: 'chm-062d0fd14500',
    sourcePath: '01-规则正文/CHM/玩家手册/职业/野蛮人.md',
  },
  {
    className: '吟游诗人',
    armorTraining: light,
    weaponCategories: simple,
    specificWeapons: duelistWeapons,
    armorText: '轻甲',
    weaponText: '简易武器、手弩、长剑、刺剑、短剑',
    sourceId: 'chm-c8ec8242c4ed',
    sourcePath: '01-规则正文/CHM/玩家手册/职业/吟游诗人1.md',
  },
  {
    className: '牧师',
    armorTraining: mediumShield,
    weaponCategories: simple,
    armorText: '轻甲、中甲、盾牌',
    weaponText: '简易武器',
    sourceId: 'chm-97d897da0b2e',
    sourcePath: '01-规则正文/CHM/玩家手册/职业/牧师.md',
  },
  {
    className: '德鲁伊',
    armorTraining: mediumShield,
    weaponCategories: [],
    specificWeapons: [
      '短棒',
      '匕首',
      '飞镖',
      '标枪',
      '硬头锤',
      '长棍',
      '弯刀',
      '镰刀',
      '投石索',
      '矛',
    ],
    restrictions: ['源文注明：德鲁伊不能装备或使用金属质的护甲和盾。'],
    armorText: '轻甲、中甲、盾牌（德鲁伊不能装备或使用金属质的护甲和盾）',
    weaponText: '短棒、匕首、飞镖、标枪、硬头锤、长棍、弯刀、镰刀、投石索、矛',
    sourceId: 'chm-2c59408a346f',
    sourcePath: '01-规则正文/CHM/玩家手册/职业/德鲁伊.md',
  },
  {
    className: '战士',
    armorTraining: allArmor,
    weaponCategories: allWeapons,
    armorText: '全部护甲、盾牌',
    weaponText: '简易武器、军用武器',
    sourceId: 'chm-a73c581fb606',
    sourcePath: '01-规则正文/CHM/玩家手册/职业/战士.md',
  },
  {
    className: '武僧',
    armorTraining: [],
    weaponCategories: simple,
    specificWeapons: ['短剑'],
    armorText: '无',
    weaponText: '简易武器、短剑',
    sourceId: 'chm-851aad1ddb21',
    sourcePath: '01-规则正文/CHM/玩家手册/职业/武僧.md',
  },
  {
    className: '圣武士',
    armorTraining: allArmor,
    weaponCategories: allWeapons,
    armorText: '所有护甲和盾牌',
    weaponText: '简易武器和军用武器',
    sourceId: 'chm-bd4d05167550',
    sourcePath: '01-规则正文/CHM/玩家手册/职业/圣武士.md',
  },
  {
    className: '游侠',
    armorTraining: mediumShield,
    weaponCategories: allWeapons,
    armorText: '轻甲、中甲、盾牌',
    weaponText: '简易武器、军用武器',
    sourceId: 'chm-32a9a17d0acd',
    sourcePath: '01-规则正文/CHM/玩家手册/职业/游侠.md',
  },
  {
    className: '游荡者',
    armorTraining: light,
    weaponCategories: simple,
    specificWeapons: duelistWeapons,
    armorText: '轻甲',
    weaponText: '简易武器、手弩、长剑、刺剑、短剑',
    sourceId: 'chm-5bae97dda112',
    sourcePath: '01-规则正文/CHM/玩家手册/职业/游荡者.md',
  },
  {
    className: '术士',
    armorTraining: [],
    weaponCategories: [],
    specificWeapons: casterWeapons,
    armorText: '无',
    weaponText: '匕首、飞镖、投石索、长棍、轻弩',
    sourceId: 'chm-9cf9f02024fe',
    sourcePath: '01-规则正文/CHM/玩家手册/职业/术士.md',
  },
  {
    className: '邪术师',
    armorTraining: light,
    weaponCategories: simple,
    armorText: '轻甲',
    weaponText: '简易武器',
    sourceId: 'chm-710058e106bc',
    sourcePath: '01-规则正文/CHM/玩家手册/职业/邪术师.md',
  },
  {
    className: '法师',
    armorTraining: [],
    weaponCategories: [],
    specificWeapons: casterWeapons,
    armorText: '无',
    weaponText: '匕首、飞镖、投石索、长棍、轻弩',
    sourceId: 'chm-962e043e1262',
    sourcePath: '01-规则正文/CHM/玩家手册/职业/法师.md',
  },
];
const clericProtector: EquipmentProficiencyOption = {
  id: 'cleric-divine-order-protector',
  name: '圣职：保护者',
  armorTraining: ['heavy'],
  weaponCategories: ['martial'],
  source: {
    book: '玩家手册2024',
    id: 'chm-5341fa1a6550',
    path: '01-规则正文/分节/chm-5341fa1a6550/003.md',
  },
};
const druidWarden: EquipmentProficiencyOption = {
  id: 'druid-primal-order-warden',
  name: '原初职能：卫士',
  armorTraining: ['medium'],
  weaponCategories: ['martial'],
  source: {
    book: '玩家手册2024',
    id: 'chm-95a2e31caa9f',
    path: '01-规则正文/分节/chm-95a2e31caa9f/003.md',
  },
};
const secondEdition: readonly Entry[] = [
  {
    className: '野蛮人',
    armorTraining: mediumShield,
    weaponCategories: allWeapons,
    armorText: '轻甲、中甲和盾牌',
    weaponText: '简易和军用武器',
    sourceId: 'chm-af0eceb33b75',
    sourcePath: '01-规则正文/CHM/玩家手册2024/角色职业/野蛮人/野蛮人.md',
  },
  {
    className: '吟游诗人',
    armorTraining: light,
    weaponCategories: simple,
    armorText: '轻甲',
    weaponText: '简易武器',
    sourceId: 'chm-dfde3e99284a',
    sourcePath: '01-规则正文/CHM/玩家手册2024/角色职业/吟游诗人/吟游诗人.md',
  },
  {
    className: '牧师',
    armorTraining: mediumShield,
    weaponCategories: simple,
    options: [clericProtector],
    armorText: '轻甲、中甲和盾牌',
    weaponText: '简易武器',
    sourceId: 'chm-5341fa1a6550',
    sourcePath: '01-规则正文/CHM/玩家手册2024/角色职业/牧师/牧师.md',
  },
  {
    className: '德鲁伊',
    armorTraining: ['light', 'shield'],
    weaponCategories: simple,
    options: [druidWarden],
    armorText: '轻甲和盾牌',
    weaponText: '简易武器',
    sourceId: 'chm-95a2e31caa9f',
    sourcePath: '01-规则正文/CHM/玩家手册2024/角色职业/德鲁伊/德鲁伊.md',
  },
  {
    className: '战士',
    armorTraining: allArmor,
    weaponCategories: allWeapons,
    armorText: '轻甲、中甲、重甲和盾牌',
    weaponText: '简易和军用武器',
    sourceId: 'chm-7005f6d0a966',
    sourcePath: '01-规则正文/CHM/玩家手册2024/角色职业/战士/战士.md',
  },
  {
    className: '武僧',
    armorTraining: [],
    weaponCategories: simple,
    martialPropertiesAny: ['light'],
    armorText: '无',
    weaponText: '简易与具备轻型词条的军用武器',
    sourceId: 'chm-4ece2e56bea8',
    sourcePath: '01-规则正文/CHM/玩家手册2024/角色职业/武僧/武僧.md',
  },
  {
    className: '圣武士',
    armorTraining: allArmor,
    weaponCategories: allWeapons,
    armorText: '轻甲、中甲、重甲和盾牌',
    weaponText: '简易和军用武器',
    sourceId: 'chm-fa540dd9b466',
    sourcePath: '01-规则正文/CHM/玩家手册2024/角色职业/圣武士/圣武士.md',
  },
  {
    className: '游侠',
    armorTraining: mediumShield,
    weaponCategories: allWeapons,
    armorText: '轻甲、中甲和盾牌',
    weaponText: '简易和军用武器',
    sourceId: 'chm-fcad573e0dcb',
    sourcePath: '01-规则正文/CHM/玩家手册2024/角色职业/游侠/游侠.md',
  },
  {
    className: '游荡者',
    armorTraining: light,
    weaponCategories: simple,
    martialPropertiesAny: ['finesse', 'light'],
    armorText: '轻甲',
    weaponText: '简易武器和具有灵巧或轻型词条的军用武器',
    sourceId: 'chm-5a9891b9de0c',
    sourcePath: '01-规则正文/CHM/玩家手册2024/角色职业/游荡者/游荡者.md',
  },
  {
    className: '术士',
    armorTraining: [],
    weaponCategories: simple,
    armorText: '无',
    weaponText: '简易武器',
    sourceId: 'chm-cfa8dbe24824',
    sourcePath: '01-规则正文/CHM/玩家手册2024/角色职业/术士/术士.md',
  },
  {
    className: '魔契师',
    armorTraining: light,
    weaponCategories: simple,
    armorText: '轻甲',
    weaponText: '简易武器',
    sourceId: 'chm-f43314f26d12',
    sourcePath: '01-规则正文/CHM/玩家手册2024/角色职业/魔契师/魔契师.md',
  },
  {
    className: '法师',
    armorTraining: [],
    weaponCategories: simple,
    armorText: '无',
    weaponText: '简易武器',
    sourceId: 'chm-53d2ac333374',
    sourcePath: '01-规则正文/CHM/玩家手册2024/角色职业/法师/法师.md',
  },
];

function makeProfile(entry: Entry, edition: DndEdition): EquipmentProficiencies {
  const { sourceId, sourcePath, ...fields } = entry;
  return {
    ...fields,
    edition,
    specificWeapons: entry.specificWeapons ?? [],
    martialPropertiesAny: entry.martialPropertiesAny ?? [],
    restrictions: entry.restrictions ?? [],
    options: entry.options ?? [],
    source: {
      book: edition === '2024' ? '玩家手册2024' : '玩家手册',
      id: sourceId,
      path: sourcePath,
    },
  };
}

export const EQUIPMENT_PROFICIENCIES: readonly EquipmentProficiencies[] = [
  ...firstEdition.map((entry) => makeProfile(entry, '2014')),
  ...secondEdition.map((entry) => makeProfile(entry, '2024')),
];

/** Unknown classes return null. Do not treat absent entries as having no proficiencies. */
export function getEquipmentProficiencies(
  edition: DndEdition,
  className: string,
): EquipmentProficiencies | null {
  return (
    EQUIPMENT_PROFICIENCIES.find(
      (entry) => entry.edition === edition && entry.className === className.trim(),
    ) ?? null
  );
}
