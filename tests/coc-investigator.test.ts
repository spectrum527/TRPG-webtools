import { describe, expect, it } from 'vitest';
import { applyCharacterAdjustment } from '../shared/adjustments';
import {
  applyCocInvestigatorEdit,
  CocInvestigatorEditSchema,
  CocInvestigatorSchema,
  cocAgeBase,
  cocAgeRule,
  cocDamageBonusAndBuild,
  cocDerivedValues,
  getCocInvestigatorErrors,
  resetCocAgeApplication,
  synchronizeCocInvestigator,
} from '../shared/coc-investigator';
import { createCharacter, deriveCharacter, exportCharacter, parseCharacter } from '../shared/rules';

const now = '2026-11-12T00:00:00.000Z';
const noRng = () => {
  throw new Error('不该重复掷骰');
};

function investigator(age = 25) {
  const card = createCharacter('coc', () => 3);
  return deriveCharacter({
    ...card,
    name: '陈安',
    occupation: '记者',
    age,
    creation: undefined,
    attributes: {
      str: 50,
      con: 50,
      siz: 50,
      dex: 60,
      app: 60,
      int: 55,
      pow: 50,
      edu: 75,
      luck: 45,
    },
    skills: { ...card.skills, dodge: 40, ownLanguage: 85, cthulhuMythos: 0 },
    hp: 7,
    mp: 8,
    san: 99,
  });
}

describe('CoC derived values', () => {
  it('reads and round-trips a card without the investigator block', () => {
    const old = investigator();
    expect(old.cocInvestigator).toBeUndefined();
    expect(cocDerivedValues(old)).toMatchObject({
      db: '0',
      build: 0,
      mov: 8,
      maxHp: 10,
      maxMp: 10,
      maxSan: 99,
    });
    expect(synchronizeCocInvestigator(old).cocInvestigator).toBeUndefined();
    expect(parseCharacter(exportCharacter(old, 'json')).cocInvestigator).toBeUndefined();
  });

  it.each([
    [64, '-2', -2],
    [65, '-1', -1],
    [84, '-1', -1],
    [85, '0', 0],
    [124, '0', 0],
    [125, '1d4', 1],
    [164, '1d4', 1],
    [165, '1d6', 2],
    [204, '1d6', 2],
    [205, '2d6', 3],
    [284, '2d6', 3],
    [285, '3d6', 4],
  ])('looks up the exact DB/build threshold at STR + SIZ = %i', (total, db, build) => {
    expect(cocDamageBonusAndBuild(32, total - 32)).toEqual({ db, build });
  });

  it('distinguishes ties and both-low/both-high values when calculating movement', () => {
    const card = investigator(80);
    const mov = (str: number, dex: number) =>
      cocDerivedValues({ ...card, attributes: { ...card.attributes, str, dex } });
    expect(mov(49, 49)).toMatchObject({ movementBase: 7, ageMovementPenalty: 5, mov: 2 });
    expect(mov(50, 49).mov).toBe(3);
    expect(mov(50, 50).mov).toBe(3);
    expect(mov(51, 51).mov).toBe(4);
  });

  it('updates combat attributes for temporary effects and clamps resources only for permanent changes', () => {
    const initial = investigator();
    const temporary = applyCharacterAdjustment(
      initial,
      {
        kind: 'add-effect',
        effect: {
          id: 'adrenaline',
          name: '临时效果',
          endCondition: '',
          enabled: true,
          changes: [
            { target: 'attribute', key: 'str', amount: 30 },
            { target: 'attribute', key: 'con', amount: 20 },
            { target: 'attribute', key: 'pow', amount: 20 },
            { target: 'skill', key: 'cthulhuMythos', amount: 8 },
          ],
        },
      },
      now,
    );
    expect(cocDerivedValues(temporary)).toMatchObject({
      db: '1d4',
      build: 1,
      mov: 9,
      maxHp: 10,
      maxMp: 10,
      maxSan: 99,
    });
    expect(cocDerivedValues(temporary, { includeTemporary: false }).db).toBe('0');
    const permanent = applyCharacterAdjustment(
      temporary,
      { kind: 'set-value', target: 'skill', key: 'cthulhuMythos', value: 12, reason: '阅读古书' },
      now,
    );
    expect(permanent).toMatchObject({ maxSan: 87, san: 87 });
    const raised = applyCharacterAdjustment(
      permanent,
      { kind: 'set-value', target: 'attribute', key: 'con', value: 80, reason: '长期治疗' },
      now,
    );
    expect(raised).toMatchObject({ maxHp: 13, hp: 7 });
    const lowered = applyCharacterAdjustment(
      raised,
      { kind: 'set-value', target: 'attribute', key: 'con', value: 10, reason: '患病' },
      now,
    );
    expect(lowered).toMatchObject({ maxHp: 6, hp: 6 });
    const restored = applyCharacterAdjustment(
      lowered,
      { kind: 'reset-value', target: 'attribute', key: 'con' },
      now,
    );
    expect(restored).toMatchObject({ maxHp: 10, hp: 6 });
  });

  it('keeps mode, lock, and remembered manual value independent', () => {
    let card = investigator();
    const apply = (
      change:
        | { kind: 'mode'; mode: 'auto' | 'manual' }
        | { kind: 'lock'; locked: boolean }
        | { kind: 'value'; value: number },
    ) => {
      card = applyCocInvestigatorEdit(
        card,
        { kind: 'derived-control', field: 'mov', change },
        { now },
      );
    };
    expect(() => apply({ kind: 'mode', mode: 'manual' })).toThrow(/解锁/);
    expect(
      CocInvestigatorEditSchema.safeParse({
        kind: 'derived-control',
        field: 'mov',
        change: { kind: 'lock', locked: false, manual: 25 },
      }).success,
    ).toBe(false);
    apply({ kind: 'lock', locked: false });
    expect(() => apply({ kind: 'value', value: 17 })).toThrow(/手动/);
    apply({ kind: 'mode', mode: 'manual' });
    apply({ kind: 'value', value: 17 });
    apply({ kind: 'lock', locked: true });
    expect(() => apply({ kind: 'value', value: 18 })).toThrow(/解锁/);
    card = { ...card, age: 40 };
    expect(cocDerivedValues(card).mov).toBe(17);
    apply({ kind: 'lock', locked: false });
    apply({ kind: 'mode', mode: 'auto' });
    apply({ kind: 'lock', locked: true });
    expect(cocDerivedValues(card).mov).toBe(7);
    card = { ...card, age: 50 };
    expect(cocDerivedValues(card).mov).toBe(6);
    apply({ kind: 'lock', locked: false });
    apply({ kind: 'mode', mode: 'manual' });
    expect(cocDerivedValues(card).mov).toBe(17);
  });

  it('enforces manual resource ceilings and still never heals', () => {
    let card = investigator();
    for (const change of [
      { kind: 'lock', locked: false },
      { kind: 'mode', mode: 'manual' },
      { kind: 'value', value: 19 },
    ] as const)
      card = applyCocInvestigatorEdit(
        card,
        { kind: 'derived-control', field: 'maxHp', change },
        { now },
      );
    expect(card).toMatchObject({ hp: 7, maxHp: 19 });
    expect(getCocInvestigatorErrors({ ...card, maxHp: 9 })).not.toHaveLength(0);
    expect(() =>
      applyCocInvestigatorEdit(
        card,
        { kind: 'derived-control', field: 'maxHp', change: { kind: 'value', value: 0 } },
        { now },
      ),
    ).toThrow();
  });
});

describe('CoC age corrections', () => {
  it.each([
    [15, 5, 0, 0, 0],
    [19, 5, 0, 0, 0],
    [20, 0, 0, 1, 0],
    [39, 0, 0, 1, 0],
    [40, 5, 5, 2, 1],
    [50, 10, 10, 3, 2],
    [60, 20, 15, 4, 3],
    [70, 40, 20, 4, 4],
    [80, 80, 25, 4, 5],
    [89, 80, 25, 4, 5],
  ])(
    'selects exactly one bracket at age %i',
    (age, deductionPoints, appearanceLoss, educationChecks, movementPenalty) => {
      expect(cocAgeRule(age)).toMatchObject({
        deductionPoints,
        appearanceLoss,
        educationChecks,
        movementPenalty,
      });
    },
  );

  it('saves young-investigator deductions and both Luck rolls once', () => {
    const card = investigator(17);
    const dice = [1, 1, 1, 6, 5, 4];
    const edit = { kind: 'age-apply', deductions: { str: 3, siz: 2 } } as const;
    const result = applyCocInvestigatorEdit(card, edit, { now, rng: () => dice.shift()! });
    expect(dice).toHaveLength(0);
    expect(result.attributes).toMatchObject({ str: 47, siz: 48, edu: 70, luck: 75 });
    expect(result.cocInvestigator?.age?.applied).toMatchObject({
      base: card.attributes,
      changes: { str: -3, siz: -2, edu: -5, luck: 30 },
      eduChecks: [],
      luckRolls: [
        [1, 1, 1],
        [6, 5, 4],
      ],
    });
    expect(applyCocInvestigatorEdit(result, edit, { now, rng: noRng })).toBe(result);
    const amended = applyCocInvestigatorEdit(
      result,
      { ...edit, deductions: { str: 5 } },
      { now, rng: noRng },
    );
    expect(amended.attributes).toMatchObject({ str: 45, siz: 50, edu: 70, luck: 75 });
    const renamed = deriveCharacter({ ...amended, name: '陈冬' });
    expect(renamed.cocInvestigator?.age?.applied).toEqual(amended.cocInvestigator?.age?.applied);
    expect(renamed.skills.ownLanguage).toBe(80);
    expect(parseCharacter(exportCharacter(renamed, 'json')).cocInvestigator).toEqual(
      renamed.cocInvestigator,
    );
  });

  it('checks education sequentially, records capped gains, and clears only the saved deltas', () => {
    const card = investigator(80);
    card.attributes.edu = 96;
    const dice = [97, 7, 98, 100, 8, 99];
    const result = applyCocInvestigatorEdit(
      card,
      { kind: 'age-apply', deductions: { str: 30, con: 20, dex: 30 } },
      { now, rng: () => dice.shift()! },
    );
    expect(result.attributes).toMatchObject({ str: 20, con: 30, dex: 30, app: 35, edu: 99 });
    expect(result.cocInvestigator?.age?.applied?.eduChecks).toEqual([
      { before: 96, percentile: 97, d10: 7, gain: 3 },
      { before: 99, percentile: 98, gain: 0 },
      { before: 99, percentile: 100, d10: 8, gain: 0 },
      { before: 99, percentile: 99, gain: 0 },
    ]);
    expect(dice).toHaveLength(0);
    const edited = deriveCharacter({
      ...result,
      attributes: { ...result.attributes, con: 35 },
      hp: 3,
    });
    const cleared = applyCocInvestigatorEdit(edited, { kind: 'age-clear' }, { now });
    expect(cleared.attributes).toEqual({ ...card.attributes, con: 55 });
    expect(cleared.hp).toBe(3);
    const rerolled = resetCocAgeApplication({ ...result, attributes: investigator(80).attributes });
    expect(cocAgeBase(rerolled)).toEqual(rerolled.attributes);
  });

  it('permits a locked, audited manual adjustment for ages outside the table', () => {
    let card = investigator(12);
    expect(() =>
      applyCocInvestigatorEdit(card, { kind: 'age-apply' }, { now, rng: noRng }),
    ).toThrow(/15–89/);
    expect(() =>
      applyCocInvestigatorEdit(
        card,
        { kind: 'age-control', change: { kind: 'mode', mode: 'manual' } },
        { now },
      ),
    ).toThrow(/解锁/);
    for (const change of [
      { kind: 'lock', locked: false },
      { kind: 'mode', mode: 'manual' },
      { kind: 'value', value: { edu: -8, dex: 2 } },
      { kind: 'lock', locked: true },
    ] as const)
      card = applyCocInvestigatorEdit(card, { kind: 'age-control', change }, { now });
    expect(() =>
      applyCocInvestigatorEdit(card, { kind: 'age-apply' }, { now, rng: noRng }),
    ).toThrow(/原因/);
    const changed = applyCocInvestigatorEdit(
      card,
      { kind: 'age-apply', reason: '少年调查员剧本' },
      { now, rng: noRng },
    );
    expect(changed.attributes).toMatchObject({ edu: 67, dex: 62 });
    expect(changed.cocInvestigator?.age?.applied?.reason).toBe('少年调查员剧本');
    expect(() => applyCocInvestigatorEdit(changed, { kind: 'age-clear' }, { now })).toThrow(/解锁/);
  });

  it('rejects a forged age audit and impossible deductions', () => {
    const card = investigator(45);
    expect(() =>
      applyCocInvestigatorEdit(
        card,
        { kind: 'age-apply', deductions: { siz: 5 } },
        { now, rng: noRng },
      ),
    ).toThrow(/分配/);
    const applied = applyCocInvestigatorEdit(
      card,
      { kind: 'age-apply', deductions: { dex: 5 } },
      { now, rng: () => 50 },
    );
    const tampered = structuredClone(applied.cocInvestigator!);
    tampered.age!.applied!.changes.app = -2;
    expect(CocInvestigatorSchema.safeParse(tampered).success).toBe(false);
  });
});
