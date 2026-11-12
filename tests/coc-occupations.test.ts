import { describe, expect, it } from 'vitest';
import {
  COC_WORKBOOK_OCCUPATIONS,
  COC_WORKBOOK_OCCUPATION_BY_ID,
  cocOccupationBook,
} from '../shared/coc-occupations';
import {
  COC_SKILL_CATALOG,
  DEFAULT_COC_CAREER,
  CocCareerSchema,
  cocOccupationProfile,
  cocOccupationBranches,
  occupationOptions,
  cocOccupationSkillPool,
} from '../shared/coc-career';
import {
  cocBudget,
  defaultCreationPolicy,
  suggestAllocation,
  syncAllocation,
  updateCocCareer,
  updateCocOccupation,
  validateCreation,
} from '../shared/creation';
import {
  createCharacter,
  deriveCharacter,
  getCharacterErrors,
  exportCharacter,
  parseCharacter,
} from '../shared/rules';
import type { Character } from '../shared/types';

function investigator(number: number, specializationsEnabled = false): Character {
  const profile = COC_WORKBOOK_OCCUPATION_BY_ID.get(`workbook${number}`)!;
  const base = createCharacter('coc', () => 3);
  base.name = '陈默';
  base.attributes.edu = number === 163 ? 55 : 60;
  base.attributes.str = 85;
  base.attributes.siz = 85;
  base.cocCareer = { ...DEFAULT_COC_CAREER, specializationsEnabled };
  return deriveCharacter(updateCocOccupation(base, profile.name, profile.id).card);
}

describe('自动卡完整职业目录', () => {
  it('具体列出的多项表演与驾驶专长分别分配，不误读为任选一项', () => {
    for (const number of [187, 188, 189, 194]) {
      const card = investigator(number, true);
      const profile = cocOccupationProfile(card)!;
      const options = occupationOptions(profile, card);
      expect(options.length).toBe(10);
      expect(options.slice(0, 3).every((group) => group.length === 1)).toBe(true);
    }
    const explorer = investigator(218, true);
    expect(occupationOptions(cocOccupationProfile(explorer), explorer)).toEqual(
      expect.arrayContaining([['pilotBoat'], ['pilotBalloon']]),
    );
  });
  it('逐项保留原表 2–230 的 229 项职业及五个来源', () => {
    expect(COC_WORKBOOK_OCCUPATIONS.map((p) => p.reference?.number)).toEqual(
      Array.from({ length: 229 }, (_, i) => i + 2),
    );
    expect(COC_WORKBOOK_OCCUPATION_BY_ID.size).toBe(229);
    expect(
      Object.fromEntries(
        ['handbook', 'companion', 'japan', 'japanese', 'gaslight'].map((book) => [
          book,
          COC_WORKBOOK_OCCUPATIONS.filter((p) => p.reference?.book === book).length,
        ]),
      ),
    ).toEqual({ handbook: 114, companion: 41, japan: 13, japanese: 35, gaslight: 26 });
    for (const profile of COC_WORKBOOK_OCCUPATIONS) {
      expect(profile.reference?.row).toBe(profile.reference!.number + 2);
      expect(profile.skillsText?.length).toBeGreaterThan(5);
      expect(profile.credit[0]).toBeLessThanOrEqual(profile.credit[1]);
    }
    expect(cocOccupationBook(157)).toBe('japan');
    expect(cocOccupationBook(170)).toBe('japanese');
    expect(cocOccupationBook(205)).toBe('gaslight');
  });

  it.each([false, true])(
    '全部职业可生成不同的合法选位、分完点数并导出导入（专长 %s）',
    (specializations) => {
      const policy = { ...defaultCreationPolicy('coc'), requireAllPoints: true };
      for (const profile of COC_WORKBOOK_OCCUPATIONS) {
        const card = suggestAllocation(
          investigator(profile.reference!.number, specializations),
          policy,
        );
        const label = `${profile.id} ${profile.name}`;
        expect(getCharacterErrors(card), label).toEqual([]);
        expect(validateCreation(card, policy), label).toEqual([]);
        expect(card.creation?.rule).toBe('coc');
        if (card.creation?.rule !== 'coc') throw new Error(label);
        const selections = card.creation.occupationSkills;
        expect(selections.every(Boolean), label).toBe(true);
        expect(new Set(selections).size, label).toBe(selections.length);
        expect(occupationOptions(profile, card).length, label).toBe(selections.length);
        expect(parseCharacter(exportCharacter(card, 'json')).cocCareer?.occupationId, label).toBe(
          profile.id,
        );
      }
    },
  );

  it.each([false, true])(
    '目录职业的分支仍可独立开关，按各自来源校验（专长 %s）',
    (specializationsEnabled) => {
      const policy = defaultCreationPolicy('coc');
      for (const profile of COC_WORKBOOK_OCCUPATIONS) {
        const original = investigator(profile.reference!.number, specializationsEnabled);
        for (const branch of cocOccupationBranches(profile.name, profile.id)) {
          const card = updateCocCareer(original, {
            ...original.cocCareer!,
            branchesEnabled: true,
            branchId: branch.id,
          }).card;
          expect(cocOccupationProfile(card)?.id).toBe(branch.id);
          expect(validateCreation(suggestAllocation(card, policy), policy), branch.id).toEqual([]);
          expect(
            getCharacterErrors(parseCharacter(exportCharacter(card, 'md'))),
            branch.id,
          ).toEqual([]);
          const off = updateCocCareer(card, { ...card.cocCareer!, branchesEnabled: false }).card;
          expect(cocOccupationProfile(off)?.id).toBe(profile.id);
          expect(off.cocCareer?.specializationsEnabled).toBe(specializationsEnabled);
        }
      }
    },
  );

  it('同名职业按编号区分，旧卡和分支仍使用原有定义', () => {
    const original = investigator(13);
    const gaslight = investigator(208);
    expect(original.occupation).toBe(gaslight.occupation);
    expect(cocOccupationProfile(original)?.credit).toEqual([9, 50]);
    expect(cocOccupationProfile(gaslight)?.credit).toEqual([10, 40]);
    const legacy = updateCocOccupation(gaslight, '医生').card;
    expect(legacy.cocCareer?.occupationId).toBeUndefined();
    const branch = updateCocCareer(legacy, {
      ...legacy.cocCareer!,
      branchesEnabled: true,
      branchId: 'doctorPsychiatry',
    }).card;
    expect(cocOccupationProfile(branch)?.name).toBe('精神科医生');
    expect(CocCareerSchema.safeParse({ ...DEFAULT_COC_CAREER, occupationId: 'fake' }).success).toBe(
      false,
    );
    expect(getCharacterErrors({ ...original, occupation: '医生' }).join(' ')).toContain(
      '职业目录编号与职业名称不匹配',
    );
  });

  it('职业切换返还失效投入，属性二选一公式按来源计算', () => {
    let card = investigator(175, true);
    if (card.creation?.rule !== 'coc') throw new Error('allocation');
    card = syncAllocation({
      ...card,
      creation: {
        ...card.creation,
        occupational: { creditRating: 10, medicine: 40 },
        personal: { listen: 15 },
      },
    });
    const next = updateCocOccupation(card, '游戏测试员', 'workbook204');
    expect(next.returnedOccupation).toBe(40);
    expect(next.card.creation?.rule === 'coc' && next.card.creation.personal.listen).toBe(15);
    const athlete = investigator(15);
    expect(cocBudget(athlete).occupational).toBe(290);
    if (athlete.creation?.rule !== 'coc') throw new Error('allocation');
    athlete.creation.occupationAttribute = 'dex';
    expect(cocBudget(athlete).occupational).toBe(
      2 * (athlete.attributes.edu + athlete.attributes.dex),
    );
  });

  it('来源中的可选位置可留空，多专长仍受点数与房间限制', () => {
    const policy = defaultCreationPolicy('coc');
    let card = suggestAllocation(investigator(225, true), policy);
    if (card.creation?.rule !== 'coc') throw new Error('allocation');
    card = syncAllocation({
      ...card,
      creation: {
        ...card.creation,
        occupationSkills: [...card.creation.occupationSkills.slice(0, 4), ...Array(6).fill('')],
        occupational: { creditRating: 20 },
        personal: {},
      },
    });
    expect(validateCreation(card, policy)).toEqual([]);
    const toggled = updateCocCareer(card, { ...card.cocCareer!, branchesEnabled: true }).card;
    expect(toggled.creation?.rule === 'coc' && toggled.creation.occupationSkills.slice(4)).toEqual(
      Array(6).fill(''),
    );
    let artist = investigator(208, true);
    expect(cocOccupationSkillPool(artist)).toContain('artDancing');
    if (artist.creation?.rule !== 'coc') throw new Error('allocation');
    artist = syncAllocation({
      ...artist,
      creation: {
        ...artist.creation,
        occupational: { creditRating: 10, artDancing: 20 },
        personal: { artDancing: 1 },
      },
    });
    expect(validateCreation(artist, policy)).toEqual([]);
    expect(
      validateCreation(artist, { ...policy, allowInterestOnOccupation: false }).join(' '),
    ).toContain('兴趣点不能用于职业技能');
  });

  it('未注明基础值的技能须确认，且锁定值、范围和特殊职业条件可校验', () => {
    let card = investigator(172, true);
    if (card.creation?.rule !== 'coc') throw new Error('allocation');
    card = syncAllocation({
      ...card,
      creation: {
        ...card.creation,
        occupational: { creditRating: 5, driveCycle: 10 },
        personal: {},
      },
    });
    const policy = defaultCreationPolicy('coc');
    expect(validateCreation(card, policy).join(' ')).toContain('确认自行车驾驶的基础值');
    card = updateCocCareer(card, {
      ...card.cocCareer!,
      skillBases: { driveCycle: { mode: 'manual', manual: 20, locked: true } },
    }).card;
    expect(card.skills.driveCycle).toBe(30);
    expect(validateCreation(card, policy)).toEqual([]);
    expect(
      CocCareerSchema.safeParse({
        ...card.cocCareer,
        skillBases: { driveCycle: { mode: 'manual', manual: 100, locked: true } },
      }).success,
    ).toBe(false);
    const pupil = suggestAllocation(investigator(163), policy);
    pupil.attributes.edu = 65;
    expect(validateCreation(syncAllocation(pupil), policy).join(' ')).toContain('教育不高于 60');
    const wrestler = suggestAllocation(investigator(169), policy);
    wrestler.attributes.siz = 70;
    expect(validateCreation(syncAllocation(wrestler), policy).join(' ')).toContain('体型至少 81');
    expect(new Set(COC_SKILL_CATALOG.map((s) => s.key)).size).toBe(COC_SKILL_CATALOG.length);
  });
});
