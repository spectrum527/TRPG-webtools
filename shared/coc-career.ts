import { z } from 'zod';
import type { Character } from './types';

export const COC_CAREER_SOURCE_LABELS = {
  legacy: '原有模板',
  coc7: '七版官方规则',
  workbook: '参考卡',
  interlude: '幕间扩展',
  custom: '自定义',
};
export type CocCareerSource = keyof typeof COC_CAREER_SOURCE_LABELS;
export const COC_SKILL_FAMILIES = {
  artCraft: '艺术／手艺',
  science: '科学',
  language: '外语',
  fighting: '格斗',
  firearms: '射击',
  pilot: '驾驶',
  survival: '生存',
};
export type CocSkillFamily = keyof typeof COC_SKILL_FAMILIES;
export const COC_OCCUPATION_ATTRIBUTES = [
  'str',
  'con',
  'siz',
  'dex',
  'app',
  'int',
  'pow',
  'edu',
] as const;
export type CocOccupationAttribute = (typeof COC_OCCUPATION_ATTRIBUTES)[number];
export const COC_CUSTOM_SKILL_LIMIT = 12;

export const CocSkillKeySchema = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]{0,39}$/)
  .refine((key) => key !== 'constructor' && key !== 'prototype', '不允许的技能键名');
export const CocCustomSkillKeySchema = z
  .string()
  .regex(/^custom[A-Z0-9][a-zA-Z0-9]{0,33}$/, '自定义技能键名格式无效');
const creditSchema = z
  .tuple([z.number().int().min(0).max(99), z.number().int().min(0).max(99)])
  .refine(([min, max]) => min <= max, '信用评级下限不可大于上限');
const nameSchema = z
  .string()
  .trim()
  .min(1, '请填写名称')
  .max(80)
  .refine(
    (name) => !/[<>\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(name),
    '名称包含不支持的字符',
  );

export const CocCustomOccupationSchema = z
  .object({
    name: nameSchema,
    credit: creditSchema,
    bonus: z.array(z.enum(COC_OCCUPATION_ATTRIBUTES)).max(COC_OCCUPATION_ATTRIBUTES.length),
    groups: z.array(z.array(CocSkillKeySchema).min(1).max(24)).max(8),
    free: z.number().int().min(0).max(8),
  })
  .strict()
  .superRefine((profile, ctx) => {
    if (profile.groups.length + profile.free !== 8)
      ctx.addIssue({
        code: 'custom',
        path: ['groups'],
        message: '自定义职业须恰有八个职业技能位置',
      });
    if (new Set(profile.bonus).size !== profile.bonus.length)
      ctx.addIssue({ code: 'custom', path: ['bonus'], message: '职业点的备选属性不可重复' });
    profile.groups.forEach((group, i) => {
      if (new Set(group).size !== group.length)
        ctx.addIssue({
          code: 'custom',
          path: ['groups', i],
          message: '同一职业位置的技能选项不可重复',
        });
    });
  });

export const CocCustomSkillSchema = z
  .object({
    key: CocCustomSkillKeySchema,
    label: nameSchema,
    base: z.number().int().min(0).max(99),
    family: z.enum(Object.keys(COC_SKILL_FAMILIES) as CocSkillFamily[]).optional(),
  })
  .strict();
export type CocCustomSkill = z.infer<typeof CocCustomSkillSchema>;

export const CocCareerSchema = z
  .object({
    branchesEnabled: z.boolean(),
    specializationsEnabled: z.boolean(),
    branchId: z
      .string()
      .regex(/^[a-z][a-zA-Z0-9]{0,39}$/, '职业分支编号格式无效')
      .optional(),
    customOccupation: CocCustomOccupationSchema.optional(),
    customSkills: z.array(CocCustomSkillSchema).max(COC_CUSTOM_SKILL_LIMIT),
  })
  .strict()
  .superRefine((career, ctx) => validateCareerDefinition(career, ctx));

export type CocCareer = z.infer<typeof CocCareerSchema>;

export const DEFAULT_COC_CAREER: CocCareer = {
  branchesEnabled: false,
  specializationsEnabled: false,
  customSkills: [],
};

export function cocCustomSkillKey(): string {
  return `custom0${globalThis.crypto.randomUUID().replace(/-/g, '')}`;
}

export const COC_OCCUPATION_TEMPLATE_MAX_BYTES = 64 * 1024;
const occupationTemplateSchema = z.strictObject({
  type: z.literal('interlude-coc-occupation'),
  schemaVersion: z.literal(1),
  occupation: CocCustomOccupationSchema,
  skills: z.array(CocCustomSkillSchema).max(COC_CUSTOM_SKILL_LIMIT),
});
export type CocOccupationTemplate = z.infer<typeof occupationTemplateSchema>;

export function parseCocOccupationTemplate(text: string): CocOccupationTemplate {
  if (new TextEncoder().encode(text).byteLength > COC_OCCUPATION_TEMPLATE_MAX_BYTES)
    throw new Error('职业模板不能超过 64 KiB。');
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('无法读取职业模板，请选择有效的 JSON。');
  }
  const parsed = occupationTemplateSchema.safeParse(raw);
  if (!parsed.success) throw new Error('职业模板格式无效，请选择导出的 CoC 职业 JSON。');
  const valid = CocCareerSchema.safeParse({
    ...DEFAULT_COC_CAREER,
    customOccupation: parsed.data.occupation,
    customSkills: parsed.data.skills,
  });
  if (!valid.success) throw new Error(valid.error.issues[0]?.message);
  return parsed.data;
}

export function exportCocOccupationTemplate(career: CocCareer): string {
  const occupation = career.customOccupation;
  if (!occupation) throw new Error('请先保存自定义职业。');
  const required = new Set(occupation.groups.flat());
  const template: CocOccupationTemplate = {
    type: 'interlude-coc-occupation',
    schemaVersion: 1,
    occupation,
    skills: career.customSkills.filter((skill) => required.has(skill.key)),
  };
  return `${JSON.stringify(template, null, 2)}\n`;
}

/** Dodge and own language use DEX/2 and EDU at character creation. */
export const COC_SKILLS = [
  { key: 'accounting', label: '会计', base: 5 },
  { key: 'anthropology', label: '人类学', base: 1 },
  { key: 'appraise', label: '估价', base: 5 },
  { key: 'archaeology', label: '考古学', base: 1 },
  { key: 'artCraft', label: '艺术／手艺', base: 5 },
  { key: 'artLiterature', label: '艺术／文学', base: 5 },
  { key: 'artPhotography', label: '艺术／摄影', base: 5 },
  { key: 'artActing', label: '艺术／表演', base: 5 },
  { key: 'scienceBiology', label: '科学／生物学', base: 1 },
  { key: 'sciencePharmacy', label: '科学／药学', base: 1 },
  { key: 'languageLatin', label: '外语／拉丁语', base: 1 },
  { key: 'charm', label: '魅惑', base: 15 },
  { key: 'climb', label: '攀爬', base: 20 },
  { key: 'creditRating', label: '信用评级', base: 0 },
  { key: 'cthulhuMythos', label: '克苏鲁神话', base: 0 },
  { key: 'disguise', label: '乔装', base: 5 },
  { key: 'dodge', label: '闪避', base: 0 },
  { key: 'driveAuto', label: '汽车驾驶', base: 20 },
  { key: 'electricalRepair', label: '电气维修', base: 10 },
  { key: 'fastTalk', label: '话术', base: 5 },
  { key: 'fightingBrawl', label: '斗殴', base: 25 },
  { key: 'firearmsHandgun', label: '手枪', base: 20 },
  { key: 'firearmsRifle', label: '步枪／霰弹枪', base: 25 },
  { key: 'firstAid', label: '急救', base: 30 },
  { key: 'history', label: '历史', base: 5 },
  { key: 'intimidate', label: '恐吓', base: 15 },
  { key: 'jump', label: '跳跃', base: 20 },
  { key: 'law', label: '法律', base: 5 },
  { key: 'libraryUse', label: '图书馆使用', base: 20 },
  { key: 'listen', label: '聆听', base: 20 },
  { key: 'locksmith', label: '锁匠', base: 1 },
  { key: 'mechanicalRepair', label: '机械维修', base: 10 },
  { key: 'medicine', label: '医学', base: 1 },
  { key: 'naturalWorld', label: '博物学', base: 10 },
  { key: 'navigate', label: '领航', base: 10 },
  { key: 'occult', label: '神秘学', base: 5 },
  { key: 'otherLanguage', label: '外语', base: 1 },
  { key: 'ownLanguage', label: '母语', base: 0 },
  { key: 'persuade', label: '说服', base: 10 },
  { key: 'pilot', label: '驾驶（飞行器）', base: 1 },
  { key: 'psychoanalysis', label: '精神分析', base: 1 },
  { key: 'psychology', label: '心理学', base: 10 },
  { key: 'ride', label: '骑术', base: 5 },
  { key: 'science', label: '科学', base: 1 },
  { key: 'sleightOfHand', label: '妙手', base: 10 },
  { key: 'spotHidden', label: '侦查', base: 25 },
  { key: 'stealth', label: '潜行', base: 20 },
  { key: 'survival', label: '生存', base: 10 },
  { key: 'swim', label: '游泳', base: 20 },
  { key: 'throw', label: '投掷', base: 20 },
  { key: 'track', label: '追踪', base: 10 },
];

// Chaosium's 7th-edition investigator sheets list these independent skills.
const additionalSkills = [
  { key: 'operateHeavyMachinery', label: '操作重型机械', base: 1 },
  { key: 'computerUse', label: '计算机使用', base: 5, era: 'modern' },
  { key: 'electronics', label: '电子学', base: 1, era: 'modern' },
] as const;

export interface CocSkillDefinition {
  key: string;
  label: string;
  base: number;
  family?: CocSkillFamily;
  source: CocCareerSource;
  era?: 'modern';
}

const legacyFamilies: Partial<Record<string, CocSkillFamily>> = {
  artLiterature: 'artCraft',
  artPhotography: 'artCraft',
  artActing: 'artCraft',
  scienceBiology: 'science',
  sciencePharmacy: 'science',
  languageLatin: 'language',
  fightingBrawl: 'fighting',
  firearmsHandgun: 'firearms',
  firearmsRifle: 'firearms',
  pilot: 'pilot',
};
const baseDefinitions: CocSkillDefinition[] = [
  ...COC_SKILLS.map((skill) => ({
    ...skill,
    family: legacyFamilies[skill.key],
    source: 'legacy' as const,
  })),
  ...additionalSkills.map((skill) => ({ ...skill, source: 'coc7' as const })),
];

function specialties(
  family: CocSkillFamily,
  base: number,
  names: Record<string, string>,
  source: CocCareerSource = 'workbook',
): CocSkillDefinition[] {
  return Object.entries(names).map(([key, label]) => ({
    key,
    label: `${COC_SKILL_FAMILIES[family]}／${label}`,
    base,
    family,
    source,
  }));
}

// The workbook's specialization table supplies numeric defaults where listed.
// Language and terrain examples follow the base for their skill family.
const newSpecializations: CocSkillDefinition[] = [
  ...specialties('artCraft', 5, {
    artPainting: '绘画',
    artSculpture: '雕塑',
    artInstrument: '乐器',
    artSinging: '歌唱',
    artDancing: '舞蹈',
    artForging: '伪造',
    artTechnicalDrawing: '技术制图',
    artWoodworking: '木工',
    artFarming: '耕作',
    artCooking: '厨艺',
    artShorthand: '速记',
  }),
  ...specialties('science', 1, {
    scienceChemistry: '化学',
    sciencePhysics: '物理学',
    scienceAstronomy: '天文学',
    scienceGeology: '地质学',
    scienceMath: '数学',
    scienceBotany: '植物学',
    scienceZoology: '动物学',
    scienceCryptography: '密码学',
    scienceEngineering: '工程学',
    scienceMeteorology: '气象学',
    scienceForensics: '司法科学',
  }),
  ...specialties(
    'language',
    1,
    {
      languageEnglish: '英语',
      languageChinese: '中文',
      languageFrench: '法语',
      languageGerman: '德语',
      languageItalian: '意大利语',
      languageSpanish: '西班牙语',
      languageJapanese: '日语',
      languageRussian: '俄语',
      languageArabic: '阿拉伯语',
      languageGreek: '希腊语',
    },
    'interlude',
  ),
  ...specialties('fighting', 5, { fightingWhip: '鞭' }),
  ...specialties('fighting', 10, { fightingChainsaw: '电锯', fightingFlail: '链枷' }),
  ...specialties('fighting', 15, { fightingAxe: '斧', fightingGarrote: '绞具' }),
  ...specialties('fighting', 20, { fightingSword: '剑', fightingSpear: '矛' }),
  ...specialties('firearms', 15, { firearmsBow: '弓', firearmsSmg: '冲锋枪' }),
  ...specialties('firearms', 10, {
    firearmsMachineGun: '机枪',
    firearmsFlamethrower: '喷射器',
    firearmsHeavyWeapons: '重武器',
  }),
  ...specialties('pilot', 1, { pilotBoat: '船只' }),
  ...specialties('pilot', 1, { pilotDirigible: '飞艇' }, 'coc7'),
  ...specialties(
    'survival',
    10,
    {
      survivalForest: '森林',
      survivalDesert: '沙漠',
      survivalMountain: '山地',
      survivalArctic: '极地',
      survivalSea: '海上',
    },
    'interlude',
  ),
];
export const COC_SPECIALIZATIONS = [
  ...baseDefinitions.filter((skill) => skill.family),
  ...newSpecializations,
];
export const COC_SKILL_CATALOG = [...baseDefinitions, ...newSpecializations];

type CocCareerCard = Pick<Character, 'rule' | 'occupation' | 'cocCareer'>;

export function cocSkillDefinitions(card?: CocCareerCard): CocSkillDefinition[] {
  const career = card?.rule === 'coc' ? card.cocCareer : undefined;
  const custom = (career?.customSkills ?? [])
    .filter((skill) => !skill.family || career?.specializationsEnabled)
    .map((skill) => ({ ...skill, source: 'custom' as const }));
  return [...(career?.specializationsEnabled ? COC_SKILL_CATALOG : baseDefinitions), ...custom];
}

const keys = (value: string) => value.split(' ');
const social = keys('charm fastTalk intimidate persuade');
export interface OccupationProfile {
  name: string;
  credit: [number, number];
  bonus: CocOccupationAttribute[];
  source: CocCareerSource;
  groups: string[][];
  free: number;
  basicGroups?: string[][];
  era?: 'classic' | 'modern';
}
const legacyOccupations: Array<Omit<OccupationProfile, 'source'>> = [
  {
    name: '古物学家',
    credit: [30, 70],
    bonus: [],
    groups: [
      ['appraise'],
      ['artCraft'],
      ['history'],
      ['libraryUse'],
      ['otherLanguage'],
      social,
      ['spotHidden'],
    ],
    free: 1,
  },
  {
    name: '作家',
    credit: [9, 30],
    bonus: [],
    groups: [
      ['artLiterature'],
      ['history'],
      ['libraryUse'],
      ['naturalWorld', 'occult'],
      ['otherLanguage'],
      ['ownLanguage'],
      ['psychology'],
    ],
    free: 1,
  },
  {
    name: '记者',
    credit: [9, 30],
    bonus: [],
    groups: [
      ['artCraft', 'artPhotography'],
      ['history'],
      ['libraryUse'],
      ['ownLanguage'],
      social,
      ['psychology'],
    ],
    free: 2,
  },
  {
    name: '私家侦探',
    credit: [9, 30],
    bonus: ['str', 'dex'],
    groups: [
      ['artPhotography'],
      ['disguise'],
      ['law'],
      ['libraryUse'],
      social,
      ['psychology'],
      ['spotHidden'],
    ],
    free: 1,
  },
  {
    name: '医生',
    credit: [30, 80],
    bonus: [],
    groups: [
      ['firstAid'],
      ['languageLatin'],
      ['medicine'],
      ['psychology'],
      ['scienceBiology'],
      ['sciencePharmacy'],
    ],
    free: 2,
  },
  {
    name: '教授',
    credit: [20, 70],
    bonus: [],
    groups: [['libraryUse'], ['otherLanguage'], ['ownLanguage'], ['psychology']],
    free: 4,
  },
  {
    name: '警探',
    credit: [20, 50],
    bonus: ['str', 'dex'],
    groups: [
      ['artActing', 'disguise'],
      ['firearmsHandgun', 'firearmsRifle'],
      ['law'],
      ['listen'],
      social,
      ['psychology'],
      ['spotHidden'],
    ],
    free: 1,
  },
  {
    name: '艺术家',
    credit: [9, 50],
    bonus: ['dex', 'pow'],
    groups: [
      ['artCraft'],
      ['history', 'naturalWorld'],
      social,
      ['otherLanguage'],
      ['psychology'],
      ['spotHidden'],
    ],
    free: 2,
  },
  {
    name: '神职人员',
    credit: [9, 60],
    bonus: [],
    groups: [
      ['accounting'],
      ['history'],
      ['libraryUse'],
      ['listen'],
      ['otherLanguage'],
      social,
      ['psychology'],
    ],
    free: 1,
  },
  {
    name: '军人',
    credit: [9, 30],
    bonus: ['str', 'dex'],
    groups: [
      ['climb', 'swim'],
      ['dodge'],
      ['fightingBrawl'],
      ['firearmsHandgun', 'firearmsRifle'],
      ['stealth'],
      ['survival'],
      ['firstAid', 'mechanicalRepair', 'otherLanguage'],
      ['firstAid', 'mechanicalRepair', 'otherLanguage'],
    ],
    free: 0,
  },
  {
    name: '考古学家',
    credit: [10, 40],
    bonus: [],
    groups: [
      ['appraise'],
      ['archaeology'],
      ['history'],
      ['otherLanguage'],
      ['libraryUse'],
      ['spotHidden'],
      ['mechanicalRepair'],
      ['navigate', 'science'],
    ],
    free: 0,
  },
];

const fixed = (skills: string) => keys(skills).map((key) => [key]);
const physical: CocOccupationAttribute[] = ['str', 'dex'];
const traveler: CocOccupationAttribute[] = ['str', 'dex', 'app'];
const academic = keys(
  'anthropology archaeology artCraft history law medicine naturalWorld occult psychology science',
);
const firearms = ['anyFirearms'];
const fighting = ['anyFighting'];

function workbookOccupation(
  name: string,
  credit: [number, number],
  bonus: CocOccupationAttribute[],
  groups: string[][],
  free = 0,
): OccupationProfile {
  return { name, credit, bonus, groups, free, source: 'workbook' };
}

// Selected occupations from the reference workbook, "职业列表". Formulas,
// ranges and slot choices are transcribed as data; the source descriptions are omitted.
export const COC_OCCUPATION_RULES: OccupationProfile[] = [
  ...legacyOccupations.map((profile) => ({ ...profile, source: 'legacy' as const })),
  workbookOccupation(
    '会计师',
    [30, 70],
    [],
    fixed('accounting law libraryUse listen persuade spotHidden'),
    2,
  ),
  workbookOccupation(
    '杂技演员',
    [9, 20],
    ['dex'],
    fixed('climb dodge jump throw spotHidden swim'),
    2,
  ),
  workbookOccupation(
    '演员',
    [9, 40],
    ['app'],
    [...fixed('artActing disguise'), fighting, ['history'], social, social, ['psychology']],
    1,
  ),
  workbookOccupation(
    '古董商',
    [30, 50],
    [],
    [
      ...fixed('accounting appraise driveAuto'),
      social,
      social,
      ...fixed('history libraryUse navigate'),
    ],
  ),
  workbookOccupation(
    '建筑师',
    [30, 70],
    [],
    [
      ...fixed('accounting artTechnicalDrawing law ownLanguage'),
      ['computerUse', 'libraryUse'],
      ...fixed('persuade psychology scienceMath'),
    ],
  ),
  workbookOccupation(
    '运动员',
    [9, 70],
    physical,
    [...fixed('climb jump fightingBrawl ride'), social, ...fixed('swim throw')],
    1,
  ),
  workbookOccupation(
    '酒保',
    [8, 25],
    ['app'],
    [['accounting'], social, social, ...fixed('fightingBrawl listen psychology spotHidden')],
    1,
  ),
  workbookOccupation(
    '书商',
    [20, 40],
    [],
    [
      ...fixed('accounting appraise driveAuto history libraryUse ownLanguage otherLanguage'),
      social,
    ],
  ),
  {
    ...workbookOccupation(
      '程序员',
      [10, 70],
      [],
      fixed('computerUse electricalRepair electronics libraryUse scienceMath spotHidden'),
      2,
    ),
    era: 'modern',
  },
  workbookOccupation(
    '罪犯',
    [5, 40],
    ['dex'],
    [
      ...fixed('appraise climb'),
      ['electricalRepair', 'mechanicalRepair'],
      ...fixed('listen locksmith sleightOfHand stealth spotHidden'),
    ],
  ),
  workbookOccupation(
    '业余艺术爱好者',
    [50, 99],
    ['app'],
    [['artCraft'], firearms, ...fixed('otherLanguage ride'), social],
    3,
  ),
  workbookOccupation(
    '流浪者',
    [0, 5],
    traveler,
    [...fixed('climb jump listen navigate'), social, ['stealth']],
    2,
  ),
  {
    ...workbookOccupation(
      '工程师',
      [30, 60],
      [],
      fixed(
        'artTechnicalDrawing electricalRepair libraryUse mechanicalRepair operateHeavyMachinery scienceEngineering sciencePhysics',
      ),
      1,
    ),
    // With both science specializations collapsed, the second slot may use an
    // adjacent discipline so the investigator can still choose eight distinct skills.
    basicGroups: [
      ...fixed(
        'artCraft electricalRepair libraryUse mechanicalRepair operateHeavyMachinery science',
      ),
      ['navigate', 'accounting'],
    ],
  },
  {
    ...workbookOccupation('探险家', [55, 80], traveler, [
      ['climb', 'swim'],
      firearms,
      ...fixed('history jump naturalWorld navigate otherLanguage survival'),
    ]),
    era: 'classic',
  },
  workbookOccupation(
    '农民',
    [9, 30],
    physical,
    [
      ...fixed('artFarming driveAuto'),
      social,
      ...fixed('mechanicalRepair naturalWorld operateHeavyMachinery track'),
    ],
    1,
  ),
  workbookOccupation(
    '律师',
    [30, 80],
    [],
    [...fixed('accounting law libraryUse'), social, social, ['psychology']],
    2,
  ),
  workbookOccupation(
    '图书馆管理员',
    [9, 35],
    [],
    fixed('accounting libraryUse otherLanguage ownLanguage'),
    4,
  ),
  workbookOccupation(
    '音乐家',
    [9, 30],
    ['pow', 'dex'],
    [['artInstrument'], social, ...fixed('listen psychology')],
    4,
  ),
  workbookOccupation(
    '护士',
    [9, 30],
    [],
    [
      ...fixed('firstAid listen medicine'),
      social,
      ...fixed('psychology scienceBiology scienceChemistry spotHidden'),
    ],
  ),
  workbookOccupation(
    '神秘学家',
    [9, 65],
    [],
    [
      ...fixed('anthropology history libraryUse'),
      social,
      ...fixed('occult otherLanguage scienceAstronomy'),
    ],
    1,
  ),
  workbookOccupation(
    '摄影师',
    [9, 30],
    [],
    [['artPhotography'], social, ...fixed('psychology scienceChemistry stealth spotHidden')],
    2,
  ),
  workbookOccupation(
    '飞行员',
    [20, 70],
    ['dex'],
    fixed(
      'electricalRepair mechanicalRepair navigate operateHeavyMachinery pilot scienceAstronomy',
    ),
    2,
  ),
  workbookOccupation(
    '博物馆管理员',
    [10, 30],
    [],
    fixed('accounting appraise archaeology history libraryUse occult otherLanguage spotHidden'),
  ),
  workbookOccupation(
    '海员',
    [20, 40],
    [],
    [
      ...fixed('firstAid mechanicalRepair naturalWorld navigate'),
      social,
      ...fixed('pilotBoat spotHidden swim'),
    ],
  ),
  workbookOccupation(
    '学生',
    [5, 10],
    [],
    [['ownLanguage', 'otherLanguage'], ...fixed('libraryUse listen'), academic, academic, academic],
    2,
  ),
  workbookOccupation(
    '司机',
    [9, 20],
    physical,
    [
      ...fixed('accounting driveAuto listen'),
      social,
      ...fixed('mechanicalRepair navigate psychology'),
    ],
    1,
  ),
];

export const COC_OCCUPATIONS = COC_OCCUPATION_RULES.map((profile) => profile.name);

export interface CocOccupationBranch extends OccupationProfile {
  id: string;
  occupation: string;
}

function occupationBranch(
  id: string,
  occupation: string,
  profile: OccupationProfile,
): CocOccupationBranch {
  return { ...profile, id, occupation };
}

export const COC_OCCUPATION_BRANCHES: CocOccupationBranch[] = [
  occupationBranch(
    'doctorPsychiatry',
    '医生',
    workbookOccupation(
      '精神科医生',
      [30, 80],
      [],
      fixed(
        'otherLanguage listen medicine persuade psychoanalysis psychology scienceBiology scienceChemistry',
      ),
    ),
  ),
  occupationBranch('doctorForensics', '医生', {
    ...workbookOccupation(
      '法医',
      [30, 80],
      [],
      fixed(
        'firstAid languageLatin medicine law scienceBiology sciencePharmacy scienceForensics spotHidden',
      ),
    ),
    source: 'interlude',
  }),
  occupationBranch(
    'journalistInvestigative',
    '记者',
    workbookOccupation(
      '调查记者',
      [9, 30],
      [],
      [
        ['artCraft', 'artPhotography'],
        social,
        ...fixed('history libraryUse ownLanguage psychology'),
      ],
      2,
    ),
  ),
  occupationBranch(
    'journalistCorrespondent',
    '记者',
    workbookOccupation(
      '通讯记者',
      [9, 30],
      [],
      [
        ...fixed('artActing history listen ownLanguage'),
        social,
        ...fixed('psychology stealth spotHidden'),
      ],
    ),
  ),
  occupationBranch(
    'journalistForeign',
    '记者',
    workbookOccupation(
      '驻外记者',
      [10, 40],
      [],
      [...fixed('history otherLanguage ownLanguage listen'), social, social, ['psychology']],
      1,
    ),
  ),
  occupationBranch('artistPainter', '艺术家', {
    ...workbookOccupation(
      '画家',
      [9, 50],
      ['dex', 'pow'],
      [
        ['artPainting'],
        ['history', 'naturalWorld'],
        social,
        ...fixed('otherLanguage psychology spotHidden appraise'),
      ],
      1,
    ),
    source: 'interlude',
  }),
  occupationBranch('artistSculptor', '艺术家', {
    ...workbookOccupation(
      '雕塑家',
      [9, 50],
      ['dex', 'pow'],
      [
        ['artSculpture'],
        ['history', 'naturalWorld'],
        social,
        ...fixed('otherLanguage psychology spotHidden mechanicalRepair'),
      ],
      1,
    ),
    source: 'interlude',
  }),
  occupationBranch('professorHumanities', '教授', {
    ...workbookOccupation(
      '人文教授',
      [20, 70],
      [],
      [
        ...fixed('libraryUse otherLanguage ownLanguage psychology history'),
        ['anthropology', 'archaeology', 'artLiterature'],
      ],
      2,
    ),
    source: 'interlude',
  }),
  occupationBranch('professorSciences', '教授', {
    ...workbookOccupation(
      '理科教授',
      [20, 70],
      [],
      [
        ...fixed('libraryUse otherLanguage ownLanguage psychology science'),
        ['scienceBiology', 'sciencePhysics', 'scienceMath', 'naturalWorld'],
      ],
      2,
    ),
    source: 'interlude',
  }),
  occupationBranch(
    'policePatrol',
    '警探',
    workbookOccupation('巡警', [9, 30], physical, [
      ['fightingBrawl'],
      firearms,
      ['firstAid'],
      social,
      ...fixed('law psychology spotHidden'),
      ['driveAuto', 'ride'],
    ]),
  ),
  occupationBranch(
    'soldierOfficer',
    '军人',
    workbookOccupation(
      '军官',
      [20, 70],
      physical,
      [['accounting'], firearms, ...fixed('navigate firstAid'), social, social, ['psychology']],
      1,
    ),
  ),
  occupationBranch('soldierMarine', '军人', {
    ...workbookOccupation('陆战队员', [9, 30], physical, [
      ...fixed('swim dodge fightingBrawl'),
      firearms,
      ...fixed('stealth survival firstAid'),
      ['mechanicalRepair', 'otherLanguage'],
    ]),
    source: 'interlude',
  }),
  occupationBranch(
    'actorFilm',
    '演员',
    workbookOccupation(
      '电影演员',
      [20, 90],
      ['app'],
      [...fixed('artActing disguise driveAuto'), social, social, ['psychology']],
      2,
    ),
  ),
  occupationBranch(
    'criminalConArtist',
    '罪犯',
    workbookOccupation(
      '欺诈师',
      [10, 65],
      ['app'],
      [
        ...fixed('appraise artActing'),
        ['law', 'otherLanguage'],
        ['listen'],
        social,
        social,
        ...fixed('psychology sleightOfHand'),
      ],
    ),
  ),
  occupationBranch(
    'criminalForger',
    '罪犯',
    workbookOccupation(
      '赝造者',
      [20, 60],
      [],
      fixed('accounting appraise artForging history libraryUse spotHidden sleightOfHand'),
      1,
    ),
  ),
  occupationBranch(
    'photographerPress',
    '摄影师',
    workbookOccupation(
      '摄影记者',
      [10, 30],
      [],
      [
        ...fixed('artPhotography climb'),
        social,
        ...fixed('otherLanguage psychology scienceChemistry'),
      ],
      2,
    ),
  ),
  occupationBranch('pilotStunt', '飞行员', {
    ...workbookOccupation(
      '特技飞行员',
      [30, 60],
      [],
      fixed('accounting electricalRepair listen mechanicalRepair navigate pilot spotHidden'),
      1,
    ),
    era: 'classic',
  }),
  occupationBranch(
    'sailorNavy',
    '海员',
    workbookOccupation(
      '军舰海员',
      [9, 30],
      [],
      [
        ['electricalRepair', 'mechanicalRepair'],
        fighting,
        firearms,
        ...fixed('firstAid navigate pilotBoat survivalSea swim'),
      ],
    ),
  ),
];

export function cocOccupationBranches(occupation: string): CocOccupationBranch[] {
  return COC_OCCUPATION_BRANCHES.filter((branch) => branch.occupation === occupation);
}

export function cocOccupationProfile(card: CocCareerCard): OccupationProfile | undefined {
  if (card.rule !== 'coc') return undefined;
  const career = card.cocCareer;
  if (career?.customOccupation?.name === card.occupation)
    return { ...career.customOccupation, source: 'custom' };
  const branch = career?.branchesEnabled
    ? cocOccupationBranches(card.occupation).find((entry) => entry.id === career.branchId)
    : undefined;
  return branch ?? COC_OCCUPATION_RULES.find((profile) => profile.name === card.occupation);
}

const familyChoices: Partial<Record<string, CocSkillFamily>> = {
  artCraft: 'artCraft',
  science: 'science',
  otherLanguage: 'language',
  survival: 'survival',
  anyFirearms: 'firearms',
  anyFighting: 'fighting',
};
const familyFallback: Record<CocSkillFamily, string[]> = {
  artCraft: ['artCraft'],
  science: ['science'],
  language: ['otherLanguage'],
  fighting: ['fightingBrawl'],
  firearms: ['firearmsHandgun', 'firearmsRifle'],
  pilot: ['pilot'],
  survival: ['survival'],
};
const skillsWithFixedSlots = new Set(['creditRating', 'cthulhuMythos']);

export function occupationOptions(profile?: OccupationProfile, card?: CocCareerCard): string[][] {
  if (!profile) return [];
  const skills = cocSkillDefinitions(card).filter((skill) => !skillsWithFixedSlots.has(skill.key));
  const active = new Set(skills.map((skill) => skill.key));
  const specializationsEnabled = card?.cocCareer?.specializationsEnabled === true;
  const groups =
    !specializationsEnabled && profile.basicGroups ? profile.basicGroups : profile.groups;
  const definitionOf = (key: string) =>
    COC_SKILL_CATALOG.find((skill) => skill.key === key) ??
    card?.cocCareer?.customSkills.find((skill) => skill.key === key);
  const alternatives = (key: string): string[] => {
    const family = Object.hasOwn(familyChoices, key) ? familyChoices[key] : undefined;
    if (family)
      return [
        ...(specializationsEnabled
          ? skills.filter((skill) => skill.family === family).map((skill) => skill.key)
          : []),
        ...familyFallback[family],
      ];
    if (active.has(key)) return [key];
    const inactiveFamily = definitionOf(key)?.family;
    return inactiveFamily ? familyFallback[inactiveFamily] : [];
  };
  // The existing police and military templates list both old firearm types
  // as one wildcard. Their original options are still available with the toggle off.
  const expand = (group: string[]) =>
    profile.source === 'legacy' &&
    group.length === 2 &&
    group.includes('firearmsHandgun') &&
    group.includes('firearmsRifle')
      ? alternatives('anyFirearms')
      : group.flatMap(alternatives);
  return [
    ...groups.map((group) => [...new Set(expand(group))].filter((key) => active.has(key))),
    ...Array.from({ length: profile.free }, () => skills.map((skill) => skill.key)),
  ];
}

/** Keep usable prior choices, then find distinct skills even when slots overlap. */
export function chooseCocOccupationSkills(options: string[][], previous: string[] = []): string[] {
  if (
    previous.length === options.length &&
    new Set(previous).size === previous.length &&
    previous.every((key, i) => options[i].includes(key))
  )
    return [...previous];

  const choices = Array<string>(options.length).fill('');
  const taken = new Map<string, number>();
  const candidates = options.map((group, i) => [
    ...new Set([previous[i], ...previous, ...group].filter((key) => group.includes(key))),
  ]);
  function place(slot: number, visited: Set<string>): boolean {
    const available = candidates[slot].find((key) => !taken.has(key) && !visited.has(key));
    if (available) {
      taken.set(available, slot);
      choices[slot] = available;
      return true;
    }
    for (const key of candidates[slot]) {
      if (visited.has(key)) continue;
      visited.add(key);
      const owner = taken.get(key);
      if (owner !== undefined && place(owner, visited)) {
        taken.set(key, slot);
        choices[slot] = key;
        return true;
      }
    }
    return false;
  }
  candidates.forEach((_, slot) => place(slot, new Set()));
  return choices;
}

const normalizeLabel = (label: string) =>
  label.normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
const presetSkillLabels = new Set(COC_SKILL_CATALOG.map((skill) => normalizeLabel(skill.label)));
const presetOccupationLabels = new Set(
  [...COC_OCCUPATION_RULES, ...COC_OCCUPATION_BRANCHES].map((profile) =>
    normalizeLabel(profile.name),
  ),
);

function validateCareerDefinition(career: CocCareer, ctx: z.RefinementCtx): void {
  if (career.branchId && !COC_OCCUPATION_BRANCHES.some((branch) => branch.id === career.branchId))
    ctx.addIssue({ code: 'custom', path: ['branchId'], message: '未知的职业分支' });
  const keys = new Set(COC_SKILL_CATALOG.map((skill) => skill.key));
  const labels = new Set(presetSkillLabels);
  career.customSkills.forEach((skill, i) => {
    if (keys.has(skill.key))
      ctx.addIssue({
        code: 'custom',
        path: ['customSkills', i, 'key'],
        message: '自定义技能键名不可重复',
      });
    keys.add(skill.key);
    const label = normalizeLabel(skill.label);
    if (labels.has(label))
      ctx.addIssue({
        code: 'custom',
        path: ['customSkills', i, 'label'],
        message: '自定义技能名称须与已有技能区分',
      });
    labels.add(label);
  });
  const profile = career.customOccupation;
  if (!profile) return;
  if (presetOccupationLabels.has(normalizeLabel(profile.name)))
    ctx.addIssue({
      code: 'custom',
      path: ['customOccupation', 'name'],
      message: '自定义职业名称须与预设职业区分',
    });
  const path = ['customOccupation', 'groups'];
  if (
    profile.groups.some((group) =>
      group.some((key) => !keys.has(key) || skillsWithFixedSlots.has(key)),
    )
  ) {
    ctx.addIssue({ code: 'custom', path, message: '自定义职业技能范围包含未定义或保留技能' });
    return;
  }
  const options = occupationOptions(
    { ...profile, source: 'custom' },
    {
      rule: 'coc',
      occupation: profile.name,
      cocCareer: { ...career, specializationsEnabled: true },
    },
  );
  if (chooseCocOccupationSkills(options).includes(''))
    ctx.addIssue({ code: 'custom', path, message: '自定义职业须能选出八个不同的职业技能' });
}

export function cocCareerErrors(card: CocCareerCard): string[] {
  if (card.cocCareer === undefined) return [];
  if (card.rule !== 'coc') return ['职业分支和技能专长仅适用于 CoC'];
  const parsed = CocCareerSchema.safeParse(card.cocCareer);
  if (!parsed.success) return parsed.error.issues.map((issue) => issue.message);
  if (
    parsed.data.branchId &&
    !cocOccupationBranches(card.occupation).some((branch) => branch.id === parsed.data.branchId)
  )
    return ['职业分支与当前职业不匹配'];
  return [];
}

export function cocSkillBase(
  card: Character,
  skill: string | Pick<CocSkillDefinition, 'key' | 'base'>,
): number {
  const key = typeof skill === 'string' ? skill : skill.key;
  if (key === 'dodge') return Math.floor(card.attributes.dex / 2);
  if (key === 'ownLanguage') return card.attributes.edu;
  return typeof skill === 'string'
    ? (cocSkillDefinitions(card).find((entry) => entry.key === key)?.base ?? 0)
    : skill.base;
}
