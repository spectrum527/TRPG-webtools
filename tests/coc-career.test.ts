import { describe, expect, it } from 'vitest';
import { adjustmentLabel } from '../shared/adjustments';
import {
  COC_OCCUPATIONS,
  COC_OCCUPATION_BRANCHES,
  COC_SKILL_CATALOG,
  COC_SKILLS,
  DEFAULT_COC_CAREER,
  CocCareerSchema,
  chooseCocOccupationSkills,
  cocCustomSkillKey,
  cocOccupationBranches,
  cocOccupationProfile,
  cocSkillBase,
  cocSkillDefinitions,
  exportCocOccupationTemplate,
  occupationOptions,
  parseCocOccupationTemplate,
  type CocCareer,
} from '../shared/coc-career';
import {
  CreationPolicySchema,
  cocBudget,
  defaultCocAllocation,
  defaultCreationPolicy,
  policyFields,
  suggestAllocation,
  syncAllocation,
  updateCocCareer,
  updateCocOccupation,
  validateCreation,
  type CocAllocation,
} from '../shared/creation';
import {
  createCharacter,
  deriveCharacter,
  exportCharacter,
  getCharacterErrors,
  parseCharacter,
  rollCheck,
} from '../shared/rules';
import type { Character } from '../shared/types';

const policy = defaultCreationPolicy('coc');
const settings = (changes: Partial<CocCareer> = {}): CocCareer => ({
  ...DEFAULT_COC_CAREER,
  ...changes,
});
function investigator(occupation: string, cocCareer?: CocCareer): Character {
  const card = deriveCharacter({
    ...createCharacter('coc', (sides) => Math.ceil(sides / 2)),
    name: '调查员',
    occupation,
    ...(cocCareer ? { cocCareer } : {}),
    attributes: {
      str: 50,
      con: 50,
      siz: 60,
      dex: 60,
      app: 65,
      int: 70,
      pow: 50,
      edu: 60,
      luck: 50,
    },
  });
  return syncAllocation({ ...card, creation: defaultCocAllocation(card) });
}
function withPoints(card: Character, points: Partial<CocAllocation>): Character {
  return syncAllocation({ ...card, creation: { ...(card.creation as CocAllocation), ...points } });
}

const radioSkill = { key: 'customRadio', label: '无线电报', base: 10 };
const radioProfile: NonNullable<CocCareer['customOccupation']> = {
  name: '电台技师',
  credit: [12, 35],
  bonus: ['int', 'dex'],
  groups: [
    ['customRadio'],
    ['electricalRepair'],
    ['mechanicalRepair'],
    ['listen'],
    ['sciencePhysics', 'scienceChemistry'],
    ['libraryUse'],
    ['persuade'],
  ],
  free: 1,
};

describe('CoC 职业和专长目录', () => {
  it('每个预设职业与分支在两种专长模式下均有八项不同技能和合法分配', () => {
    expect(new Set(COC_OCCUPATIONS).size).toBe(COC_OCCUPATIONS.length);
    expect(new Set(COC_SKILL_CATALOG.map((skill) => skill.key)).size).toBe(
      COC_SKILL_CATALOG.length,
    );
    for (const specializationsEnabled of [false, true]) {
      const variants = [
        ...COC_OCCUPATIONS.map((name) => [name, undefined] as const),
        ...COC_OCCUPATION_BRANCHES.map((branch) => [branch.occupation, branch.id] as const),
      ];
      for (const [occupation, branchId] of variants) {
        const card = suggestAllocation(
          investigator(
            occupation,
            settings({ branchesEnabled: Boolean(branchId), specializationsEnabled, branchId }),
          ),
          policy,
        );
        const allocation = card.creation as CocAllocation;
        expect(new Set(allocation.occupationSkills).size, branchId ?? occupation).toBe(8);
        expect(getCharacterErrors(card), branchId ?? occupation).toEqual([]);
        expect(
          validateCreation(card, { ...policy, requireAllPoints: true }),
          branchId ?? occupation,
        ).toEqual([]);
      }
    }
  });

  it('同一职业的分支开关与技能专长开关相互独立', () => {
    const branchId = cocOccupationBranches('医生').find(
      (branch) => branch.name === '精神科医生',
    )!.id;
    const classic = investigator('医生');
    const branchOnly = investigator('医生', settings({ branchesEnabled: true, branchId }));
    const skillsOnly = investigator('医生', settings({ specializationsEnabled: true, branchId }));
    const both = investigator(
      '医生',
      settings({ branchesEnabled: true, specializationsEnabled: true, branchId }),
    );

    expect(cocOccupationProfile(classic)?.name).toBe('医生');
    expect(cocOccupationProfile(branchOnly)?.name).toBe('精神科医生');
    expect(cocOccupationProfile(skillsOnly)?.name).toBe('医生');
    expect(cocSkillDefinitions(branchOnly).some((skill) => skill.key === 'scienceChemistry')).toBe(
      false,
    );
    expect(cocSkillDefinitions(skillsOnly).some((skill) => skill.key === 'scienceChemistry')).toBe(
      true,
    );
    expect((branchOnly.creation as CocAllocation).occupationSkills).toEqual(
      expect.arrayContaining(['psychoanalysis', 'science']),
    );
    expect((both.creation as CocAllocation).occupationSkills).toEqual(
      expect.arrayContaining(['psychoanalysis', 'scienceChemistry']),
    );
  });

  it('旧卡的分配和既有具体技能保持有效', () => {
    const card = suggestAllocation(investigator('教授'), policy);
    const old = {
      ...card,
      skills: Object.fromEntries(COC_SKILLS.map(({ key }) => [key, card.skills[key]])),
    };
    const allocation = old.creation as CocAllocation;
    // Reconstruct the original 51-skill card, before optional skills existed.
    const originalKeys = new Set(COC_SKILLS.map((skill) => skill.key));
    const personal = Object.fromEntries(
      Object.entries(allocation.personal).filter(([key]) => originalKeys.has(key)),
    );
    old.creation = { ...allocation, personal };
    expect(old.cocCareer).toBeUndefined();
    expect(allocation.occupationSkills).toContain('otherLanguage');
    expect(validateCreation(old, policy)).toEqual([]);
    expect(
      Object.entries(old.skills).every(([key, value]) => syncAllocation(old).skills[key] === value),
    ).toBe(true);
  });

  it('没有分配记录的旧卡启用分支后保留原技能，重建时按该分支选位', () => {
    const old = investigator('医生');
    delete old.creation;
    old.skills.history = 57;
    old.skills.historicalSkill = 32;
    const career = settings({
      branchesEnabled: true,
      specializationsEnabled: true,
      branchId: 'doctorPsychiatry',
    });
    const { card } = updateCocCareer(old, career);
    expect(card.creation).toBeUndefined();
    expect(card.skills).toEqual(old.skills);
    expect(defaultCocAllocation(card).occupationSkills).toContain('scienceChemistry');
  });

  it('固定和自选范围重叠时仍能找到有效的不同选项', () => {
    expect(chooseCocOccupationSkills([['appraise', 'history'], ['appraise']])).toEqual([
      'history',
      'appraise',
    ]);
  });
});

describe('CoC 专长分配与切换', () => {
  it('分开计算同类专长的基础、职业投入和兴趣投入，并应用专长范围', () => {
    const art = investigator('艺术家', settings({ specializationsEnabled: true }));
    const allocation = art.creation as CocAllocation;
    const skills = [...allocation.occupationSkills];
    skills[0] = 'artPainting';
    const card = withPoints(art, {
      occupationSkills: skills,
      occupational: { creditRating: 10, artPainting: 30 },
      personal: { artPainting: 2, artSculpture: 15, fightingSword: 7, fightingWhip: 7 },
    });
    expect(cocSkillBase(card, 'artPainting')).toBe(5);
    expect(card.skills).toMatchObject({
      artPainting: 37,
      artSculpture: 20,
      fightingSword: 27,
      fightingWhip: 12,
    });
    expect(cocBudget(card)).toMatchObject({
      occupational: 240,
      spentOccupation: 40,
      personal: 140,
      spentPersonal: 31,
    });
    expect(validateCreation(card, policy)).toEqual([]);
    const restricted = { ...policy, ranges: [{ field: 'skills.artPainting', min: 0, max: 36 }] };
    expect(CreationPolicySchema.safeParse(restricted).success).toBe(true);
    expect(validateCreation(card, restricted)).toContain('艺术／手艺／绘画须在 0–36 内（当前 37）');
    expect(validateCreation(card, { ...policy, allowInterestOnOccupation: false })).toContain(
      '本房间兴趣点不能用于职业技能：艺术／手艺／绘画',
    );
  });

  it('切换分支时保留仍然有来源的投入，退回已经失效的职业点', () => {
    const journalist = investigator('记者', settings({ branchesEnabled: true }));
    const slots = [...(journalist.creation as CocAllocation).occupationSkills];
    slots[0] = 'artPhotography';
    const card = withPoints(journalist, {
      occupationSkills: slots,
      occupational: { creditRating: 12, artPhotography: 18, history: 20 },
      personal: { artPhotography: 4, medicine: 11 },
    });
    const branchId = 'journalistCorrespondent';
    const changed = updateCocCareer(card, settings({ branchesEnabled: true, branchId }));
    expect(changed).toMatchObject({ returnedOccupation: 18, returnedPersonal: 0 });
    expect(changed.card.creation).toMatchObject({
      occupational: { creditRating: 12, history: 20 },
      personal: { artPhotography: 4, medicine: 11 },
    });
    expect(cocOccupationProfile(changed.card)?.name).toBe('通讯记者');
    expect(validateCreation(changed.card, { ...policy, allowedOccupations: ['通讯记者'] })).toEqual(
      [],
    );
    expect(updateCocOccupation(changed.card, '教授').card.cocCareer?.branchId).toBeUndefined();
    expect(card.skills.artPhotography).toBe(27);
  });

  it('关闭专长保留分支与自定义配置，同时退回失效投入和移除对应修正', () => {
    const career = settings({
      branchesEnabled: true,
      specializationsEnabled: true,
      branchId: 'artistPainter',
      customSkills: [
        radioSkill,
        { key: 'customSwahili', label: '斯瓦希里语', family: 'language', base: 1 },
      ],
    });
    const card = withPoints(investigator('艺术家', career), {
      occupational: { creditRating: 10, artPainting: 20 },
      personal: { scienceChemistry: 13, customSwahili: 4, customRadio: 6 },
    });
    card.adjustments = {
      permanent: [{ target: 'skill', key: 'artPainting', amount: 1, reason: '实践' }],
      temporary: [
        {
          id: 't1',
          name: '作业',
          enabled: true,
          endCondition: '',
          changes: [
            { target: 'skill', key: 'scienceChemistry', amount: 3 },
            { target: 'skill', key: 'listen', amount: 5 },
          ],
        },
      ],
    };

    const changed = updateCocCareer(card, { ...career, specializationsEnabled: false });
    expect(changed).toMatchObject({
      returnedOccupation: 20,
      returnedPersonal: 17,
      removedAdjustments: 2,
    });
    expect(changed.removedSkillKeys).toEqual(
      expect.arrayContaining(['artPainting', 'scienceChemistry', 'customSwahili']),
    );
    expect(changed.card.cocCareer).toMatchObject({
      branchId: 'artistPainter',
      customSkills: career.customSkills,
    });
    expect(changed.card.skills).not.toHaveProperty('artPainting');
    expect(changed.card.skills.customRadio).toBe(16);
    expect(changed.card.adjustments?.temporary[0].changes.map((entry) => entry.key)).toEqual([
      'listen',
    ]);
    expect(changed.card.adjustments?.permanent).toEqual([]);
    expect(cocOccupationProfile(changed.card)?.name).toBe('画家');
    expect(validateCreation(changed.card, policy)).toEqual([]);
    const reopened = updateCocCareer(changed.card, career).card;
    expect(reopened.skills.customSwahili).toBe(1);
  });
});

describe('CoC 自定义职业和技能审核', () => {
  it('职业模板在新卡中复用完整职业范围和引用的技能定义', () => {
    const career = settings({
      customOccupation: radioProfile,
      customSkills: [radioSkill, { key: 'customCraft', label: '修伞', base: 5 }],
    });
    const file = exportCocOccupationTemplate(career);
    const template = parseCocOccupationTemplate(`\uFEFF${file}`);
    expect(template.occupation).toEqual(radioProfile);
    expect(template.skills).toEqual([radioSkill]);
    const draft = investigator('教授');
    const changed = updateCocCareer(
      draft,
      settings({ customOccupation: template.occupation, customSkills: template.skills }),
      template.occupation.name,
    );
    expect(changed.card.skills.customRadio).toBe(10);
    expect(validateCreation(suggestAllocation(changed.card, policy), policy)).toEqual([]);
    expect(() => parseCocOccupationTemplate(JSON.stringify({ ...template, skills: [] }))).toThrow(
      '未定义或保留技能',
    );
    expect(() =>
      parseCocOccupationTemplate(JSON.stringify({ ...template, schemaVersion: 2 })),
    ).toThrow('职业模板格式无效');
  });

  it('JSON 和 Markdown 导入保留专长、自定义技能与其检定名称', () => {
    const career = settings({
      specializationsEnabled: true,
      customOccupation: radioProfile,
      customSkills: [radioSkill],
    });
    const draft = withPoints(investigator(radioProfile.name, career), {
      occupational: { creditRating: 12, customRadio: 30 },
    });
    const card: Character = {
      ...draft,
      adjustments: {
        permanent: [{ target: 'skill', key: 'customRadio', amount: 5, reason: '跑团成长' }],
        temporary: [],
      },
    };
    for (const format of ['json', 'md'] as const) {
      const imported = parseCharacter(exportCharacter(card, format), 'coc');
      expect(imported.cocCareer).toEqual(career);
      expect(adjustmentLabel(imported, 'skill', radioSkill.key)).toBe(radioSkill.label);
      expect(
        rollCheck(
          'coc',
          imported,
          { kind: 'skill', key: radioSkill.key, edge: 'normal', modifier: 0, dc: 0 },
          () => 3,
        ),
      ).toMatchObject({ label: '无线电报检定', target: 45 });
    }
  });

  it('自定义技能可作职业技能并按自定义公式、信用区间和房规审核', () => {
    const career = settings({
      specializationsEnabled: true,
      customOccupation: radioProfile,
      customSkills: [radioSkill],
    });
    const card = suggestAllocation(
      investigator(radioProfile.name, CocCareerSchema.parse(JSON.parse(JSON.stringify(career)))),
      policy,
    );
    const allocation = card.creation as CocAllocation;
    expect(allocation.occupationSkills).toContain(radioSkill.key);
    expect(allocation.occupationAttribute).toBe('int');
    expect(cocBudget(card).occupational).toBe(260);
    expect(card.skills.creditRating).toBe(12);
    expect(card.skills.customRadio).toBe(
      10 + allocation.occupational.customRadio + allocation.personal.customRadio,
    );
    expect(cocOccupationProfile(card)?.source).toBe('custom');
    expect(validateCreation(card, policy)).toEqual([]);
    expect(policyFields('coc', card)).toContainEqual({
      key: 'skills.customRadio',
      label: '无线电报技能',
    });
    expect(
      validateCreation(card, {
        ...policy,
        ranges: [{ field: 'skills.customRadio', min: 0, max: 12 }],
      }).join('\n'),
    ).toContain('无线电报须在 0–12 内');
    expect(validateCreation(withPoints(card, { occupationAttribute: 'app' }), policy)).toContain(
      '职业点公式使用了不允许的属性',
    );
    expect(
      validateCreation({ ...card, skills: { ...card.skills, customRadio: 99 } }, policy),
    ).toContain('无线电报与基础值、职业点和兴趣点合计不一致');
  });

  it('拒绝覆盖预设、重复键、危险名称、保留技能和未声明技能', () => {
    const valid = settings({ customSkills: [radioSkill], customOccupation: radioProfile });
    expect(CocCareerSchema.safeParse(valid).success).toBe(true);
    for (const customSkills of [
      [{ ...radioSkill, key: 'creditRating' }],
      [{ ...radioSkill, key: '__proto__' }],
      [{ ...radioSkill, label: '克苏鲁 神话' }],
      [{ ...radioSkill, label: '<script>' }],
      [{ ...radioSkill, base: 100 }],
      [radioSkill, { ...radioSkill, label: '无线电通信' }],
    ])
      expect(CocCareerSchema.safeParse({ ...valid, customSkills }).success).toBe(false);
    for (const customOccupation of [
      { ...radioProfile, name: '医 生' },
      { ...radioProfile, credit: [40, 20] },
      { ...radioProfile, bonus: ['luck'] },
      { ...radioProfile, groups: [['customMissing'], ...radioProfile.groups.slice(1)] },
      { ...radioProfile, groups: [['cthulhuMythos'], ...radioProfile.groups.slice(1)] },
      { ...radioProfile, groups: Array.from({ length: 7 }, () => ['listen']) },
    ])
      expect(CocCareerSchema.safeParse({ ...valid, customOccupation }).success).toBe(false);
    expect(CocCareerSchema.safeParse({ ...valid, branchId: 'notReal' }).success).toBe(false);
    expect(
      CocCareerSchema.safeParse({
        ...valid,
        customSkills: [{ ...radioSkill, key: cocCustomSkillKey() }],
        customOccupation: undefined,
      }).success,
    ).toBe(true);
    const teacher = investigator(
      '教授',
      settings({ branchesEnabled: true, branchId: 'doctorForensics' }),
    );
    expect(validateCreation(teacher, policy)).toContain('职业分支与当前职业不匹配');
    const forged = withPoints(investigator('教授'), { personal: { customMissing: 10 } });
    expect(validateCreation(forged, policy)).toContain('兴趣点不能用于未支持的技能');
  });

  it('专长收起后可保留自定义方案，并报告八项技能无法选满', () => {
    const profile = {
      ...radioProfile,
      groups: [
        ['sciencePhysics'],
        ['scienceChemistry'],
        ...radioProfile.groups.slice(0, 4),
        ['persuade'],
      ],
    };
    const career = settings({
      specializationsEnabled: true,
      customOccupation: profile,
      customSkills: [radioSkill],
    });
    const card = suggestAllocation(investigator(profile.name, career), policy);
    expect(validateCreation(card, policy)).toEqual([]);
    const basic = updateCocCareer(card, { ...career, specializationsEnabled: false }).card;
    expect(getCharacterErrors(basic)).toEqual([]);
    expect(validateCreation(basic, policy)).toContain(
      '当前职业技能范围不能选满八项不同技能，请启用专长或调整技能范围',
    );
    const reopened = updateCocCareer(basic, career).card;
    expect(occupationOptions(cocOccupationProfile(reopened), reopened)[0]).toEqual([
      'sciencePhysics',
    ]);
    expect(validateCreation(reopened, policy)).toEqual([]);
  });
});
