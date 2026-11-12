import { describe, expect, it } from 'vitest';
import {
  automaticControl,
  controlledValue,
  editValueControl,
  NumberControlSchema,
} from '../shared/value-control';
import {
  emptyCocPreparationLibrary,
  mergeCocPreparationLibrary,
  parseCocPreparationLibrary,
} from '../shared/coc-library';
import { createCharacter, exportCharacter, parseCharacter } from '../shared/rules';
import { editCocPreparation } from '../shared/coc-preparation';
import { applyCocSessionEdit } from '../shared/coc-session-rules';
import type { CocSpellDefinition, CocTomeDefinition } from '../shared/coc-session';

const spell: CocSpellDefinition = {
  id: 'ward',
  name: '守护符文',
  source: '自定义剧本',
  description: '保护目标。',
  cost: { mp: 2, hp: 0, san: '1d3', minutes: 1, rounds: 0 },
};
const tome: CocTomeDefinition = {
  id: 'book',
  name: '旧日手记',
  description: '残缺的抄本',
  initialMinutes: 60,
  fullMinutes: 120,
  initialMythos: 1,
  fullMythos: 2,
  sanLoss: '1d4',
  spellIds: [spell.id],
};

describe('protected automatic/manual values', () => {
  it('keeps automatic calculation live while locked, and preserves a relocked manual override', () => {
    let control = automaticControl<number>();
    expect(controlledValue(control, 10)).toBe(10);
    expect(controlledValue(control, 12)).toBe(12);
    expect(() => editValueControl(control, { kind: 'value', value: 20 }, 12)).toThrow('解锁');
    expect(() => editValueControl(control, { kind: 'mode', mode: 'manual' }, 12)).toThrow('解锁');
    control = editValueControl(control, { kind: 'lock', locked: false }, 12);
    expect(() => editValueControl(control, { kind: 'value', value: 20 }, 12)).toThrow('手动');
    control = editValueControl(control, { kind: 'mode', mode: 'manual' }, 12);
    control = editValueControl(control, { kind: 'value', value: 20 }, 12);
    control = editValueControl(control, { kind: 'lock', locked: true }, 12);
    expect(controlledValue(control, 25)).toBe(20);
    expect(() => editValueControl(control, { kind: 'value', value: 30 }, 25)).toThrow('解锁');
    control = editValueControl(control, { kind: 'lock', locked: false }, 25);
    control = editValueControl(control, { kind: 'mode', mode: 'auto' }, 25);
    expect(controlledValue(control, 25)).toBe(25);
    expect(control.manual).toBe(20);
  });
  it('rejects unsafe persisted numeric values', () => {
    for (const manual of [NaN, Infinity, -Infinity, 1e13])
      expect(NumberControlSchema.safeParse({ mode: 'manual', locked: true, manual }).success).toBe(
        false,
      );
  });
});

describe('CoC reusable preparation and character persistence', () => {
  it('round-trips reusable definitions separately from character learning and costs', () => {
    const library = { ...emptyCocPreparationLibrary(), spells: [spell], tomes: [tome] };
    expect(parseCocPreparationLibrary(JSON.stringify(library))).toEqual(library);
    let card = createCharacter('coc', () => 3);
    card.name = '陈默';
    card.occupation = '记者';
    card = editCocPreparation(card, { kind: 'spell-save', spell });
    card = editCocPreparation(card, { kind: 'tome-save', tome });
    const before = { hp: card.hp, mp: card.mp, san: card.san };
    card = applyCocSessionEdit(card, {
      kind: 'spell-learn',
      spellId: spell.id,
      confirmed: true,
    }).character;
    card = editCocPreparation(card, {
      kind: 'spell-save',
      spell: { ...spell, description: '追加一条主持人说明' },
    });
    expect(card.cocSession?.spells[0].learned).toBe(true);
    expect(card).toMatchObject(before);
    for (const format of ['json', 'md'] as const)
      expect(parseCharacter(exportCharacter(card, format)).cocSession).toEqual(card.cocSession);
  });
  it('does not run cast, study, or SAN actions through the offline definition editor', () => {
    const card = createCharacter('coc', () => 3);
    expect(() =>
      editCocPreparation(card, { kind: 'spell-cast', spellId: spell.id, confirmed: true }),
    ).toThrow('房间');
    expect(() =>
      editCocPreparation(card, {
        kind: 'tome-study',
        tomeId: tome.id,
        minutes: 60,
        confirmed: true,
      }),
    ).toThrow('房间');
  });
  it('rejects unresolved links and malformed formulas before import', () => {
    const library = { ...emptyCocPreparationLibrary(), spells: [spell], tomes: [tome] };
    expect(() => parseCocPreparationLibrary(JSON.stringify({ ...library, spells: [] }))).toThrow(
      '不存在',
    );
    expect(() =>
      parseCocPreparationLibrary(
        JSON.stringify({
          ...library,
          spells: [{ ...spell, cost: { ...spell.cost, san: 'alert(1)' } }],
        }),
      ),
    ).toThrow();
    expect(() =>
      parseCocPreparationLibrary(JSON.stringify({ ...library, spells: [spell, spell] })),
    ).toThrow('重复');
  });
  it('merges by ID without mutating the original library or losing tome references', () => {
    const base = { ...emptyCocPreparationLibrary(), spells: [spell], tomes: [tome] };
    const next = mergeCocPreparationLibrary(base, {
      ...emptyCocPreparationLibrary(),
      spells: [{ ...spell, name: '守护符文修订' }],
    });
    expect(next.spells).toHaveLength(1);
    expect(next.spells[0].name).toBe('守护符文修订');
    expect(base.spells[0].name).toBe('守护符文');
    expect(next.tomes[0].spellIds).toEqual([spell.id]);
  });
});
