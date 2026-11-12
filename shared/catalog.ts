import { getDndEdition, type DndEdition } from './dnd-edition';

export const DND_ATTRIBUTES = [
  { key: 'str', label: '力量' },
  { key: 'dex', label: '敏捷' },
  { key: 'con', label: '体质' },
  { key: 'int', label: '智力' },
  { key: 'wis', label: '感知' },
  { key: 'cha', label: '魅力' },
];
export const COC_ATTRIBUTES = [
  { key: 'str', label: '力量' },
  { key: 'con', label: '体质' },
  { key: 'siz', label: '体型' },
  { key: 'dex', label: '敏捷' },
  { key: 'app', label: '外貌' },
  { key: 'int', label: '智力' },
  { key: 'pow', label: '意志' },
  { key: 'edu', label: '教育' },
  { key: 'luck', label: '幸运' },
];
export const DND_SKILLS = [
  { key: 'acrobatics', label: '体操', attribute: 'dex' },
  { key: 'animalHandling', label: '驯兽', attribute: 'wis' },
  { key: 'arcana', label: '奥秘', attribute: 'int' },
  { key: 'athletics', label: '运动', attribute: 'str' },
  { key: 'deception', label: '欺瞒', attribute: 'cha' },
  { key: 'history', label: '历史', attribute: 'int' },
  { key: 'insight', label: '洞悉', attribute: 'wis' },
  { key: 'intimidation', label: '威吓', attribute: 'cha' },
  { key: 'investigation', label: '调查', attribute: 'int' },
  { key: 'medicine', label: '医药', attribute: 'wis' },
  { key: 'nature', label: '自然', attribute: 'int' },
  { key: 'perception', label: '察觉', attribute: 'wis' },
  { key: 'performance', label: '表演', attribute: 'cha' },
  { key: 'persuasion', label: '游说', attribute: 'cha' },
  { key: 'religion', label: '宗教', attribute: 'int' },
  { key: 'sleightOfHand', label: '巧手', attribute: 'dex' },
  { key: 'stealth', label: '隐匿', attribute: 'dex' },
  { key: 'survival', label: '求生', attribute: 'wis' },
];
export const DND_CLASSES = [
  '野蛮人',
  '吟游诗人',
  '牧师',
  '德鲁伊',
  '战士',
  '武僧',
  '圣武士',
  '游侠',
  '游荡者',
  '术士',
  '邪术师',
  '法师',
];
export const DND_ANCESTRIES = [
  '人类',
  '矮人',
  '精灵',
  '半身人',
  '龙裔',
  '侏儒',
  '半精灵',
  '半兽人',
  '提夫林',
];

const DND_2024_CLASSES = DND_CLASSES.map((name) => (name === '邪术师' ? '魔契师' : name));
const DND_2024_ANCESTRIES = [
  '人类',
  '矮人',
  '精灵',
  '半身人',
  '龙裔',
  '侏儒',
  '阿斯莫',
  '兽人',
  '歌利亚',
  '提夫林',
];

export function dndClasses(edition?: DndEdition): string[] {
  return getDndEdition(edition) === '2024' ? DND_2024_CLASSES : DND_CLASSES;
}

export function dndAncestries(edition?: DndEdition): string[] {
  return getDndEdition(edition) === '2024' ? DND_2024_ANCESTRIES : DND_ANCESTRIES;
}

// Player's Handbook (2024), Character Origins. Final ability scores and feat effects are manual.
export const DND_2024_BACKGROUNDS = [
  {
    name: '侍僧',
    abilities: ['int', 'wis', 'cha'],
    skills: ['insight', 'religion'],
    feat: '魔法学徒（牧师）',
  },
  {
    name: '农民',
    abilities: ['str', 'con', 'wis'],
    skills: ['animalHandling', 'nature'],
    feat: '健壮',
  },
  {
    name: '向导',
    abilities: ['dex', 'con', 'wis'],
    skills: ['stealth', 'survival'],
    feat: '魔法学徒（德鲁伊）',
  },
  {
    name: '商人',
    abilities: ['con', 'int', 'cha'],
    skills: ['animalHandling', 'persuasion'],
    feat: '幸运',
  },
  {
    name: '士兵',
    abilities: ['str', 'dex', 'con'],
    skills: ['athletics', 'intimidation'],
    feat: '凶蛮打手',
  },
  {
    name: '工匠',
    abilities: ['str', 'dex', 'int'],
    skills: ['investigation', 'persuasion'],
    feat: '巧匠',
  },
  {
    name: '抄写员',
    abilities: ['dex', 'int', 'wis'],
    skills: ['investigation', 'perception'],
    feat: '熟习',
  },
  {
    name: '智者',
    abilities: ['con', 'int', 'wis'],
    skills: ['arcana', 'history'],
    feat: '魔法学徒（法师）',
  },
  {
    name: '水手',
    abilities: ['str', 'dex', 'wis'],
    skills: ['acrobatics', 'perception'],
    feat: '酒馆斗殴者',
  },
  {
    name: '流浪者',
    abilities: ['dex', 'wis', 'cha'],
    skills: ['insight', 'stealth'],
    feat: '幸运',
  },
  {
    name: '罪犯',
    abilities: ['dex', 'con', 'int'],
    skills: ['sleightOfHand', 'stealth'],
    feat: '警戒',
  },
  {
    name: '艺人',
    abilities: ['str', 'dex', 'cha'],
    skills: ['acrobatics', 'performance'],
    feat: '音乐家',
  },
  {
    name: '警卫',
    abilities: ['str', 'int', 'wis'],
    skills: ['athletics', 'perception'],
    feat: '警戒',
  },
  {
    name: '贵族',
    abilities: ['str', 'int', 'cha'],
    skills: ['history', 'persuasion'],
    feat: '熟习',
  },
  {
    name: '隐士',
    abilities: ['con', 'wis', 'cha'],
    skills: ['medicine', 'religion'],
    feat: '医疗师',
  },
  {
    name: '骗子',
    abilities: ['dex', 'con', 'cha'],
    skills: ['deception', 'sleightOfHand'],
    feat: '熟习',
  },
];

export { COC_OCCUPATIONS, COC_SKILLS } from './coc-career';
