import records from './coc-occupation-data.json';
import type { OccupationProfile } from './coc-career';

export const COC_OCCUPATION_BOOKS = {
  handbook: '基础职业',
  companion: '调查员伴侣',
  japan: '日本秘史',
  japanese: '日系扩展',
  gaslight: '煤气灯',
} as const;
export type CocOccupationBook = keyof typeof COC_OCCUPATION_BOOKS;

export function cocOccupationBook(number: number): CocOccupationBook {
  if (number >= 205) return 'gaslight';
  if (number >= 170) return 'japanese';
  if (number >= 157) return 'japan';
  if (number >= 116) return 'companion';
  return 'handbook';
}

/** One entry per numbered preset in 职业列表!A4:G232. Never resolve by name:
 * Gaslight and the core list include distinct occupations with the same name.
 * Existing name-only cards continue to use the original compatibility catalog.
 */
export const COC_WORKBOOK_OCCUPATIONS: OccupationProfile[] = records.map((record) => ({
  ...record,
  id: `workbook${record.number}`,
  source: 'workbook',
  credit: record.credit as OccupationProfile['credit'],
  bonus: record.bonus as OccupationProfile['bonus'],
  requirements: record.requirements as OccupationProfile['requirements'],
  reference: {
    number: record.number,
    row: record.number + 2,
    book: cocOccupationBook(record.number),
  },
}));

export const COC_WORKBOOK_OCCUPATION_BY_ID = new Map(
  COC_WORKBOOK_OCCUPATIONS.map((profile) => [profile.id!, profile]),
);

// Navigation families only: each branch retains its own source formula and
// skill list. All entries can also be selected directly from the full catalog.
export const COC_WORKBOOK_OCCUPATION_FAMILIES = [
  [4, 5],
  [15, 117, 118, 119, 120],
  [23, 123, 124, 125, 159, 160],
  [28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38],
  [44, 58, 95, 134, 135, 136, 175, 176],
  [46, 47, 48, 137],
  [52, 179, 187, 188, 189],
  [57, 65, 66],
  [60, 61],
  [69, 70, 71],
  [79, 143],
  [85, 86],
  [87, 88],
  [89, 90],
  [98, 99],
  [100, 146, 147],
  [112, 113],
  [145, 191, 192, 193],
] as const;

export function cocOccupationSource(profile: OccupationProfile): string {
  return profile.reference
    ? `${COC_OCCUPATION_BOOKS[profile.reference.book]} · #${profile.reference.number}`
    : profile.source === 'custom'
      ? '自定义职业'
      : '原有模板';
}
