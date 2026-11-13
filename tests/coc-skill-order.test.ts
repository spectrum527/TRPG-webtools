import { describe, expect, it } from 'vitest';
import { createCharacter } from '../shared/rules';
import {
  DEFAULT_COC_CAREER,
  cocOccupationSkillPool,
  cocSkillDefinitions,
} from '../shared/coc-career';
import { cocInvestedSkills, sortCocSkills } from '../shared/coc-skill-order';
import { syncAllocation, updateCocOccupation } from '../shared/creation';
import { emptyCocSession } from '../shared/coc-session';

function card() {
  const base = createCharacter('coc', () => 3);
  base.name = '林恩';
  base.cocCareer = { ...DEFAULT_COC_CAREER, specializationsEnabled: true };
  return updateCocOccupation(base, '医生（原作向）', 'workbook44').card;
}

describe('CoC 技能显示顺序', () => {
  it('未投入的职业技能和信用评级也在最前；不改变保存的选位与数值', () => {
    const original = card();
    const before = JSON.stringify(original);
    const skills = cocSkillDefinitions(original);
    const beforeKeys = skills.map((skill) => skill.key);
    const occupation = new Set(cocOccupationSkillPool(original));
    const sorted = sortCocSkills(skills, original);
    expect(sorted.slice(0, occupation.size).every((s) => occupation.has(s.key))).toBe(true);
    expect(sorted.slice(occupation.size).every((s) => !occupation.has(s.key))).toBe(true);
    expect(occupation.has('creditRating')).toBe(true);
    expect(JSON.stringify(original)).toBe(before);
    expect(skills.map((skill) => skill.key)).toEqual(beforeKeys);
  });

  it('职业、兴趣投入与成长记录都会被识别，EDU/DEX 基础值不算投入', () => {
    let original = card();
    if (original.creation?.rule !== 'coc') throw new Error('allocation');
    original = syncAllocation({
      ...original,
      creation: { ...original.creation, occupational: { medicine: 10 }, personal: { listen: 5 } },
    });
    original.cocSession = emptyCocSession(original);
    original.cocSession.development.marks.push({
      key: 'track',
      mode: 'auto',
      manual: null,
      locked: true,
      eventIds: ['roll-1'],
    });
    original.cocSession.development.batches.push({
      id: 'growth-1',
      label: '幕间',
      createdAt: '2026-11-14T00:00:00Z',
      results: [{ key: 'swim', value: 20, roll: 90, gain: 2 }],
    });
    original.adjustments = {
      permanent: [{ target: 'skill', key: 'occult', amount: 5, reason: '学习' }],
      temporary: [
        {
          id: 'temp',
          name: '临时辅助',
          enabled: true,
          endCondition: '',
          changes: [{ target: 'skill', key: 'dodge', amount: 10 }],
        },
      ],
    };
    const trained = cocInvestedSkills(original);
    expect([...trained].sort()).toEqual(['listen', 'medicine', 'occult', 'swim', 'track']);
    expect(trained.has('ownLanguage')).toBe(false);
    expect(trained.has('dodge')).toBe(false);
    expect(
      sortCocSkills(cocSkillDefinitions(original), original, 'invested')
        .slice(0, 5)
        .every((skill) => trained.has(skill.key)),
    ).toBe(true);
  });

  it('旧卡按高于基础值的技能识别投入；自定义技能可正常排序', () => {
    const original = card();
    original.creation = undefined;
    original.skills.listen = 40;
    original.cocCareer!.customSkills = [{ key: 'customRadio', label: '无线电联络', base: 10 }];
    original.skills.customRadio = 25;
    expect(cocInvestedSkills(original)).toEqual(new Set(['listen', 'customRadio']));
    const sorted = sortCocSkills(cocSkillDefinitions(original), original, 'invested');
    expect(
      sorted
        .slice(0, 2)
        .map((skill) => skill.key)
        .sort(),
    ).toEqual(['customRadio', 'listen']);
  });

  it('同族专长相邻排列，名称和数值排序可独立使用', () => {
    const original = card();
    const skills = cocSkillDefinitions(original);
    const sorted = sortCocSkills(skills, original, 'category');
    for (const family of ['science', 'artCraft', 'language', 'fighting', 'firearms']) {
      const positions = sorted.flatMap((skill, index) =>
        skill.family === family ||
        skill.key ===
          {
            science: 'science',
            artCraft: 'artCraft',
            language: 'otherLanguage',
            fighting: 'fightingBrawl',
            firearms: 'firearmsHandgun',
          }[family]
          ? [index]
          : [],
      );
      expect(positions.at(-1)! - positions[0] + 1, family).toBe(positions.length);
    }
    const numeric = sortCocSkills(skills, original, 'value', { listen: 95, accounting: 90 });
    expect(numeric.slice(0, 2).map((skill) => skill.key)).toEqual(['listen', 'accounting']);
    const byName = sortCocSkills(skills, original, 'name');
    expect(byName).toEqual(
      [...skills].sort(
        (a, b) =>
          new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' }).compare(
            a.label,
            b.label,
          ) || a.key.localeCompare(b.key),
      ),
    );
  });
});
