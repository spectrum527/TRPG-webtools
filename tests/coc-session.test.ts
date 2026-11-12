import { describe, expect, it } from 'vitest';
import { effectiveCharacter } from '../shared/adjustments';
import { DEFAULT_COC_CAREER } from '../shared/coc-career';
import { cocResultAtDifficulty, cocLuckResult, cocRangedDifficulty } from '../shared/coc-runtime';
import {
  cocBoutRounds,
  cocCurrentLuck,
  cocDevelopmentMarked,
  cocInsanityHours,
  cocRoomRules,
  cocSessionValueLocked,
  type CocSessionValueField,
} from '../shared/coc-session';
import {
  applyCocSessionEdit,
  getCocSessionErrors,
  markCocDevelopment,
  mergeCocPreparation,
  reconcileCocDevelopmentMarks,
  spendCocLuck,
} from '../shared/coc-session-rules';
import { createCharacter } from '../shared/rules';
import type { Character } from '../shared/types';

const card = () => createCharacter('coc', () => 4);
const rng =
  (...rolls: number[]) =>
  (sides: number) => {
    const value = rolls.shift();
    if (value === undefined || value < 1 || value > sides)
      throw new Error(`unexpected d${sides} roll ${value}`);
    return value;
  };
const sanity = (before: Character, loss: string, rolls = rng(2, 1)) =>
  applyCocSessionEdit(
    before,
    { kind: 'sanity-roll', reason: '恐怖经历', successLoss: loss, failureLoss: loss },
    { rng: rolls },
  ).character;
const confirm = (before: Character, rolls?: ReturnType<typeof rng>) =>
  applyCocSessionEdit(
    before,
    {
      kind: 'sanity-confirm',
      pendingId: before.cocSession!.sanity.pending!.id,
      confirmed: true,
    },
    { rng: rolls },
  ).character;

describe('CoC SAN and game time', () => {
  it('locks each counter independently while allowing normal Luck and SAN updates', () => {
    const correction = (current: Character, field: CocSessionValueField, value: number) =>
      applyCocSessionEdit(current, {
        kind: 'session-value-correct',
        field,
        value,
        reason: '与跑团记录核对',
        confirmed: true,
      }).character;
    const lock = (current: Character, field: CocSessionValueField, locked: boolean) =>
      applyCocSessionEdit(current, { kind: 'session-value-lock', field, locked }).character;
    const original = card();
    expect(() => correction(original, 'luck', 8)).toThrow('解锁');
    let current = lock(original, 'luck', false);
    current = correction(current, 'luck', 8);
    current = lock(current, 'luck', true);
    current = spendCocLuck(current, 3, 'eligible-roll', '消耗 3 幸运');
    expect(cocCurrentLuck(current)).toBe(5);
    expect(current.attributes.luck).toBe(original.attributes.luck);
    expect(cocSessionValueLocked(current.cocSession, 'dayStartSan')).toBe(true);
    current = correction(lock(current, 'dayStartSan', false), 'dayStartSan', 25);
    current = correction(lock(current, 'lostToday', false), 'lostToday', 3);
    const pending = sanity(current, '1');
    expect(() => correction(pending, 'lostToday', 0)).toThrow('待结算');
    current = lock(confirm(pending, rng()), 'lostToday', true);
    expect(current.cocSession!.sanity.lostToday).toBe(4);
    const tomorrow = applyCocSessionEdit(current, {
      kind: 'advance-time',
      minutes: 1440,
      reason: '新的一天',
      confirmed: true,
    }).character;
    expect(tomorrow.cocSession!.sanity).toMatchObject({ dayStartSan: current.san, lostToday: 0 });
    expect(cocSessionValueLocked(tomorrow.cocSession, 'lostToday')).toBe(true);
  });

  it('settles a saved roll once and keeps temporary hours distinct from bout rounds', () => {
    const before = card();
    const pending = sanity(before, '5');
    expect(pending.san).toBe(before.san);
    expect(pending.cocSession!.sanity.pending).toMatchObject({ roll: 1, success: true, loss: 5 });
    const resolved = confirm(pending, rng(2, 1, 3, 9, 4));
    const insanity = resolved.cocSession!.sanity.insanity!;
    expect(resolved.san).toBe(before.san - 5);
    expect(insanity.kind).toBe('temporary');
    expect(cocInsanityHours(insanity)).toBe(3);
    expect(insanity.bout?.kind).toBe('phobia');
    expect(cocBoutRounds(insanity.bout!)).toBe(4);
    expect(() =>
      applyCocSessionEdit(resolved, {
        kind: 'sanity-confirm',
        pendingId: pending.cocSession!.sanity.pending!.id,
        confirmed: true,
      }),
    ).toThrow('已更新');
    const advance = (current: Character, minutes: number, rounds: number) =>
      applyCocSessionEdit(current, {
        kind: 'advance-time',
        minutes,
        rounds,
        reason: '主持人推进',
        confirmed: true,
      }).character;
    const afterRounds = advance(resolved, 0, 4);
    expect(afterRounds.cocSession!.sanity.insanity).toMatchObject({ kind: 'temporary', hours: 3 });
    expect(afterRounds.cocSession!.sanity.insanity?.bout).toBeUndefined();
    expect(advance(afterRounds, 179, 0).cocSession!.sanity.insanity).not.toBeNull();
    expect(advance(afterRounds, 180, 0).cocSession!.sanity.insanity).toBeNull();
  });

  it('reaches indefinite and permanent insanity, including tracked loss with automation disabled', () => {
    let current = { ...card(), san: 15 };
    current = confirm(sanity(current, '3'), rng(1, 2));
    expect(current.cocSession!.sanity.insanity?.kind).toBe('indefinite');
    const pending = sanity(current, '12');
    current = applyCocSessionEdit(
      pending,
      {
        kind: 'sanity-confirm',
        pendingId: pending.cocSession!.sanity.pending!.id,
        confirmed: true,
      },
      { rules: { ...cocRoomRules(), autoSanity: false }, rng: rng() },
    ).character;
    expect(current).toMatchObject({
      san: 0,
      cocSession: { sanity: { lostToday: 15, insanity: { kind: 'indefinite' } } },
    });
    current = applyCocSessionEdit(
      current,
      { kind: 'insanity-set', state: 'permanent', reason: '手动结算' },
      { rng: rng() },
    ).character;
    expect(current.cocSession!.sanity.insanity?.kind).toBe('permanent');
    expect(() =>
      applyCocSessionEdit(current, {
        kind: 'sanity-treatment',
        method: 'keeper',
        points: 10,
        reason: '奖励',
        confirmed: true,
      }),
    ).toThrow('永久疯狂');
  });

  it('caps repeated SAN loss by encounter source and computes the new day from explicit time', () => {
    let current = card();
    const check = {
      kind: 'sanity-roll',
      successLoss: '3',
      failureLoss: '3',
      reason: '同一遭遇',
      source: { name: '雾中生物', limit: 4 },
    } as const;
    current = confirm(applyCocSessionEdit(current, check, { rng: rng(2, 1) }).character, rng());
    current = confirm(applyCocSessionEdit(current, check, { rng: rng(2, 1) }).character, rng());
    expect(current.cocSession!.sanity.lostToday).toBe(4);
    const advanced = applyCocSessionEdit(current, {
      kind: 'advance-time',
      minutes: 1440,
      reason: '新的一天',
      confirmed: true,
    }).character;
    expect(advanced.cocSession!.sanity).toMatchObject({
      day: 2,
      dayStartSan: current.san,
      lostToday: 0,
      sources: [{ loss: 4 }],
    });
    expect(getCocSessionErrors(advanced)).toEqual([]);
  });

  it('honors duration locks and keeps an unlocked manual value when the field is relocked', () => {
    const before = applyCocSessionEdit(
      card(),
      { kind: 'insanity-set', state: 'temporary', reason: '手动结算' },
      { rng: rng(2, 6, 4) },
    ).character;
    const duration = (
      current: Character,
      control: Parameters<typeof import('../shared/value-control').editValueControl<number>>[1],
    ) =>
      applyCocSessionEdit(current, { kind: 'insanity-duration-control', field: 'hours', control })
        .character;
    expect(() => duration(before, { kind: 'value', value: 8 })).toThrow('解锁');
    let next = duration(before, { kind: 'lock', locked: false });
    next = duration(next, { kind: 'mode', mode: 'manual' });
    next = duration(next, { kind: 'value', value: 8 });
    next = duration(next, { kind: 'lock', locked: true });
    expect(cocInsanityHours(next.cocSession!.sanity.insanity!)).toBe(8);
    expect(next.cocSession!.sanity.insanity?.hours).toBe(2);
  });
});

describe('CoC development, spells, and Mythos tomes', () => {
  it('adds long-term growth once per batch and prevents locked or ineligible edits', () => {
    const original = { ...card(), skills: { ...card().skills, spotHidden: 88 } };
    const marked = markCocDevelopment(original, 'spotHidden', 'successful-spot');
    expect(marked.cocSession?.development.marks[0]).toMatchObject({
      locked: true,
      eventIds: ['successful-spot'],
    });
    expect(cocDevelopmentMarked(marked.cocSession!.development.marks[0])).toBe(true);
    expect(() =>
      applyCocSessionEdit(marked, { kind: 'development-mark', key: 'spotHidden', marked: false }),
    ).toThrow('解锁');
    const grow = { kind: 'development-roll', label: '结束调查', confirmed: true } as const;
    const result = applyCocSessionEdit(marked, grow, { rng: rng(99, 4, 2, 3) }).character;
    expect(result.creation).toEqual(original.creation);
    expect(effectiveCharacter(result, false).skills.spotHidden).toBe(92);
    expect(result.san).toBe(original.san + 5);
    expect(result.cocSession!.development.batches[0].results).toEqual([
      { key: 'spotHidden', value: 88, roll: 99, gain: 4, sanityGain: 5 },
    ]);
    expect(() => applyCocSessionEdit(result, grow)).toThrow('至少勾选');
    expect(markCocDevelopment(result, 'creditRating', 'credit')).toBe(result);
    expect(markCocDevelopment(result, 'cthulhuMythos', 'mythos')).toBe(result);
  });

  it('pays the second casting cost and preserves first and pushed POW outcomes', () => {
    const rules = { ...cocRoomRules(), allowPushedRolls: true };
    let current = card();
    current = applyCocSessionEdit(current, {
      kind: 'spell-save',
      spell: {
        id: 'ward',
        name: '护符',
        description: '',
        source: '',
        cost: { mp: 2, hp: 1, san: '1', minutes: 10, rounds: 0 },
      },
    }).character;
    current = applyCocSessionEdit(
      current,
      { kind: 'spell-learn', spellId: 'ward', confirmed: true, minutes: 60, hardIntCheck: true },
      { rng: rng(2, 1) },
    ).character;
    const spellCast = { kind: 'spell-cast', spellId: 'ward', confirmed: true } as const;
    const first = applyCocSessionEdit(current, spellCast, { rules, rng: rng(1, 10) }).character;
    expect(first.cocSession!.spells[0]).toMatchObject({
      casting: 'failed',
      firstAttempt: { roll: 90, success: false },
    });
    expect(() => applyCocSessionEdit(first, spellCast, { rules, rng: rng() })).toThrow('孤注一掷');
    const pushed = applyCocSessionEdit(
      first,
      { ...spellCast, push: { consequence: '古物毁坏' } },
      { rules, rng: rng(1, 10) },
    );
    expect(pushed.summary).toContain('法术生效');
    expect(pushed.character.cocSession!.spells[0]).toMatchObject({
      casting: 'mastered',
      pushedAttempt: { roll: 90, success: false },
    });
    expect(pushed.character).toMatchObject({
      hp: current.hp - 2,
      mp: current.mp - 4,
      san: current.san - 2,
    });
    expect(pushed.character.cocSession!.gameMinutes).toBe(80);
  });

  it('awards each stage of a tome once, caps SAN, and accumulates natural recovery in game time', () => {
    const original = { ...card(), hp: 2, mp: 0 };
    const record = applyCocSessionEdit(original, {
      kind: 'tome-save',
      tome: {
        id: 'book',
        name: '密卷',
        description: '',
        initialMinutes: 60,
        fullMinutes: 120,
        initialMythos: 3,
        fullMythos: 5,
        sanLoss: '1',
        spellIds: [],
      },
    }).character;
    const study = (current: Character, minutes: number) =>
      applyCocSessionEdit(current, { kind: 'tome-study', tomeId: 'book', minutes, confirmed: true })
        .character;
    const initial = study(record, 60);
    expect(initial).toMatchObject({ maxSan: 96, san: original.san - 1 });
    const full = study(initial, 120);
    expect(effectiveCharacter(full).skills.cthulhuMythos).toBe(8);
    expect(full.maxSan).toBe(91);
    expect(() => study(full, 120)).toThrow('已经完成');
    const advance = (current: Character, minutes: number) =>
      applyCocSessionEdit(current, {
        kind: 'advance-time',
        minutes,
        reason: '休养',
        confirmed: true,
      }).character;
    const halfHour = advance(full, 30);
    expect(halfHour.mp).toBe(0);
    const nextHour = advance(halfHour, 30);
    expect(nextHour.mp).toBe(1);
    expect(advance(nextHour, 1380).hp).toBe(original.hp + 1);
  });

  it('never turns a fumble or a purchased roll of 1 into a success', () => {
    const result = (value: number, target = 40) =>
      cocResultAtDifficulty(
        {
          label: '侦查',
          rolls: [value],
          selected: value,
          total: value,
          target,
          modifier: 0,
          outcome: '',
          success: false,
        },
        'hard',
      );
    expect(() => cocLuckResult(result(96), 'hard', 80)).toThrow('大失败');
    expect(() => cocLuckResult(result(40), 'hard', 39)).toThrow('大成功');
    expect(() => cocLuckResult(result(40), 'hard', 10)).toThrow('要求');
    expect(cocLuckResult(result(40), 'hard', 20)).toMatchObject({
      selected: 40,
      rolls: [40],
      total: 20,
      success: true,
    });
  });

  it('reconciles preparation definitions and filters inactive development marks without clearing history', () => {
    const specialized = {
      ...card(),
      cocCareer: { ...DEFAULT_COC_CAREER, specializationsEnabled: true },
    };
    let current = markCocDevelopment(specialized, 'scienceChemistry', 'learned-check');
    current = applyCocSessionEdit(
      current,
      { kind: 'development-roll', label: '第一次调查', confirmed: true },
      { rng: rng(1) },
    ).character;
    current = markCocDevelopment(current, 'scienceChemistry', 'obsolete-check');
    current = markCocDevelopment(current, 'spotHidden', 'active-check');
    const spell = {
      id: 'formula',
      name: '咒式',
      source: '',
      description: '',
      cost: { mp: 1, hp: 0, san: '0', minutes: 0, rounds: 0 },
    };
    current = applyCocSessionEdit(current, { kind: 'spell-save', spell }).character;
    const draft = applyCocSessionEdit(current, {
      kind: 'spell-save',
      spell: { ...spell, name: '新咒式' },
    }).character;
    const reconciled = reconcileCocDevelopmentMarks({
      ...current,
      cocCareer: DEFAULT_COC_CAREER,
      cocSession: mergeCocPreparation(current.cocSession!, draft.cocSession),
    });
    expect(reconciled.cocSession?.spells[0]).toMatchObject({ name: '新咒式', casting: 'untested' });
    expect(reconciled.cocSession?.development.marks.map(({ key }) => key)).toEqual(['spotHidden']);
    expect(reconciled.cocSession?.development.batches).toEqual(
      current.cocSession?.development.batches,
    );
    const learned = applyCocSessionEdit(current, {
      kind: 'spell-learn',
      spellId: 'formula',
      confirmed: true,
    }).character;
    expect(() => mergeCocPreparation(learned.cocSession!, draft.cocSession)).toThrow(
      '须由主持人修改',
    );
  });

  it('enforces regular, hard, and extreme range bands and special shotgun distances', () => {
    const rifle = { range: 30, longerRanges: [] };
    expect(cocRangedDifficulty(rifle, 30)).toEqual({ difficulty: 'regular', veryLong: false });
    expect(cocRangedDifficulty(rifle, 60)).toEqual({ difficulty: 'hard', veryLong: false });
    expect(cocRangedDifficulty(rifle, 120)).toEqual({ difficulty: 'extreme', veryLong: true });
    expect(() => cocRangedDifficulty(rifle, 121)).toThrow('最远射程');
    expect(
      cocRangedDifficulty({ range: 10, longerRanges: [{ range: 20 }, { range: 50 }] }, 50),
    ).toEqual({ difficulty: 'extreme', veryLong: true });
  });
});
