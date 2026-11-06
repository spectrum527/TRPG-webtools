import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { DndEdition } from '../shared/dnd-edition';
import {
  applyDndMagicEdit,
  createDndMagicState,
  getDndMagicErrors,
  getDndMagicProfile,
  type DndMagicCharacter,
  type DndMagicEdit,
  type DndMagicState,
} from '../shared/dnd-magic';
import { parseDndReferencePack } from '../shared/dnd-reference';
import { createCharacter, exportCharacter, parseCharacter } from '../shared/rules';

const spells = Object.fromEntries(
  (['2014', '2024'] as const).map((edition) => [
    edition,
    parseDndReferencePack(
      JSON.parse(
        readFileSync(new URL(`../public/rules/dnd-${edition}.json`, import.meta.url), 'utf8'),
      ),
    ).spells,
  ]),
);
const catalog = (edition: DndEdition) => (id: string) =>
  spells[edition].find((entry) => entry.id === id);
const spellId = (edition: DndEdition, name: string) =>
  spells[edition].find((entry) => entry.nameEn === name && entry.source.category === 'core')!.id;

function card(
  occupation: string,
  level: number,
  edition: DndEdition = '2024',
  state: Partial<DndMagicState> = {},
): DndMagicCharacter {
  const base = createCharacter('dnd', () => 4, undefined, edition);
  return {
    ...base,
    name: '暮页',
    occupation,
    level,
    hp: 5,
    maxHp: 20,
    attributes: { ...base.attributes, int: 18, wis: 16, cha: 14, con: 12 },
    dndMagic: { ...createDndMagicState(), ...state },
  };
}

const edit = (
  character: DndMagicCharacter,
  action: DndMagicEdit,
  rng?: (sides: number) => number,
) =>
  applyDndMagicEdit(character, action, { catalog: catalog(character.dndEdition ?? '2014'), rng });
const shortRest = { kind: 'rest', rest: 'short', confirmed: true } as const;
const longRest = { kind: 'rest', rest: 'long', confirmed: true } as const;

describe('D&D magic class profiles', () => {
  it('keeps legacy characters opt-in and a noncaster free of default casting', () => {
    const legacy = createCharacter('dnd', () => 4);
    expect(legacy.dndMagic).toBeUndefined();
    expect(getDndMagicErrors(legacy)).toEqual([]);
    expect(() => edit(legacy, longRest)).toThrow('先启用');
    expect(getDndMagicProfile(card('战士', 10))).toMatchObject({
      mode: 'none',
      cantripLimit: 0,
      ability: null,
      hitDie: 10,
    });
    expect(getDndMagicProfile(createCharacter('coc', () => 4))).toBeNull();
  });

  it('round-trips compact magic state in portable character files and rejects edition mismatches', () => {
    const spell = spellId('2024', 'Fireball');
    const wizard = card('法师', 5, '2024', { spellbook: [spell], prepared: [spell] });
    const result = edit(wizard, { kind: 'cast', method: 'slot', slotLevel: 3, spellId: spell });
    const saved = { ...wizard, dndMagic: result.state };
    const portable = exportCharacter(saved, 'json');
    expect(portable).not.toContain('rawText');
    expect(portable).not.toContain('sourcePath');
    expect(parseCharacter(portable, 'dnd', '2024')).toEqual(saved);
    expect(() => parseCharacter(portable, 'dnd', '2014')).toThrow('版次不匹配');
  });

  it('uses the actual class tables and 2014 ability-based preparation formulas', () => {
    expect(getDndMagicProfile(card('法师', 3, '2014'))).toMatchObject({
      mode: 'spellbook',
      cantripLimit: 3,
      preparedLimit: 7,
      slots: [4, 2, 0, 0, 0, 0, 0, 0, 0],
    });
    expect(getDndMagicProfile(card('法师', 20))).toMatchObject({
      mode: 'spellbook',
      cantripLimit: 5,
      preparedLimit: 25,
      slots: [4, 3, 3, 3, 3, 2, 2, 1, 1],
    });
    expect(getDndMagicProfile(card('游侠', 1, '2014'))?.mode).toBe('none');
    expect(getDndMagicProfile(card('游侠', 1))).toMatchObject({
      mode: 'prepared',
      preparedLimit: 2,
      slots: [2, 0, 0, 0, 0, 0, 0, 0, 0],
    });
    expect(getDndMagicProfile(card('圣武士', 5, '2014'))?.preparedLimit).toBe(4);
    expect(getDndMagicProfile(card('圣武士', 5))?.preparedLimit).toBe(6);
    expect(getDndMagicProfile(card('术士', 8, '2014'))).toMatchObject({
      mode: 'known',
      knownLimit: 9,
      cantripLimit: 5,
    });
    expect(getDndMagicProfile(card('术士', 8))).toMatchObject({
      mode: 'prepared',
      preparedLimit: 12,
      cantripLimit: 5,
    });
    expect(getDndMagicProfile(card('牧师', 20, '2014'))?.preparedLimit).toBe(23);
    expect(getDndMagicProfile(card('德鲁伊', 20))?.preparedLimit).toBe(22);
  });

  it('validates third casters, old school limits and automatic Mage Hand', () => {
    const old = card('战士', 3, '2014', {
      subclass: 'eldritch-knight',
      known: ['Disguise Self', 'Charm Person', 'Magic Missile'].map((name) =>
        spellId('2014', name),
      ),
    });
    expect(getDndMagicErrors(old, catalog('2014'))).toContain(
      '2014 施法子职的不限学派法术超过名额',
    );
    const modern = card('战士', 3, '2024', {
      subclass: 'eldritch-knight',
      prepared: ['Disguise Self', 'Charm Person', 'Magic Missile'].map((name) =>
        spellId('2024', name),
      ),
    });
    expect(getDndMagicErrors(modern, catalog('2024'))).toEqual([]);
    expect(getDndMagicProfile(modern)).toMatchObject({
      mode: 'prepared',
      preparedLimit: 3,
      cantripLimit: 2,
    });
    expect(getDndMagicErrors(card('武僧', 7, '2024', { subclass: 'eldritch-knight' }))).toContain(
      '该施法子职须匹配职业并达到 3 级',
    );
    const trickster = card('游荡者', 3, '2024', { subclass: 'arcane-trickster' });
    const result = edit(trickster, {
      kind: 'cast',
      method: 'cantrip',
      spellId: spellId('2024', 'Mage Hand'),
    });
    expect(result.level).toBe(0);
    expect(result.spentSlot).toBe(false);
  });

  it('keeps magical secrets within the old known budget and expands only the modern bard spell list', () => {
    const modern = card('吟游诗人', 10, '2024', { prepared: [spellId('2024', 'Fireball')] });
    expect(getDndMagicErrors(modern, catalog('2024'))).toEqual([]);
    expect(getDndMagicErrors({ ...modern, level: 9 }, catalog('2024'))).toHaveLength(1);
    const old = card('吟游诗人', 10, '2014', {
      secrets: [spellId('2014', 'Fireball'), spellId('2014', 'Guidance')],
    });
    expect(getDndMagicErrors(old, catalog('2014'))).toEqual([]);
    expect(
      edit(old, { kind: 'cast', method: 'cantrip', spellId: spellId('2014', 'Guidance') })
        .spentSlot,
    ).toBe(false);
    const late = card('吟游诗人', 18, '2014', { secrets: [spellId('2014', 'Power Word Kill')] });
    expect(getDndMagicErrors(late, catalog('2014'))).toEqual([]);
  });
});

describe('spell authorization, slot spending and concentration', () => {
  it.each(['2014', '2024'] as const)(
    'scribes but does not prepare or spend a slot for a wizard book ritual in %s',
    (edition) => {
      const wizard = card('法师', 1, edition);
      const alarm = spellId(edition, 'Alarm');
      const scribed = edit(wizard, { kind: 'scribe', spellId: alarm, confirmed: true });
      expect(scribed.summary).toContain('2 小时，费用 50 GP');
      expect(wizard.dndMagic?.spellbook).toEqual([]);
      expect(scribed.state).toMatchObject({ spellbook: [alarm], prepared: [] });
      const withBook = { ...wizard, dndMagic: scribed.state };
      expect(() =>
        edit(withBook, { kind: 'cast', method: 'slot', spellId: alarm, slotLevel: 1 }),
      ).toThrow('没有以法术位施展');
      const ritual = edit(withBook, { kind: 'cast', method: 'ritual', spellId: alarm });
      expect(ritual.summary).toContain('10 分钟');
      expect(ritual.state?.slotsUsed).toEqual(createDndMagicState().slotsUsed);
      expect(edit(withBook, { ...longRest, prepared: [alarm] }).state?.prepared).toEqual([alarm]);
      expect(() =>
        edit(withBook, {
          kind: 'scribe',
          spellId: spellId(edition === '2014' ? '2024' : '2014', 'Alarm'),
          confirmed: true,
        }),
      ).toThrow('找不到同版次');
    },
  );

  it('gates normal slots by rank, availability, effects and the 2024 turn cap', () => {
    const fireball = spellId('2024', 'Fireball');
    const wizard = card('法师', 7, '2024', { spellbook: [fireball], prepared: [fireball] });
    wizard.adjustments = {
      permanent: [{ target: 'attribute', key: 'int', amount: 2, reason: '战役成长' }],
      temporary: [],
    };
    const attempt = {
      kind: 'cast',
      method: 'slot',
      spellId: fireball,
      slotLevel: 4,
      componentNote: '已核对材料',
    } as const;
    expect(() => edit(wizard, { ...attempt, slotLevel: 2 })).toThrow('环阶低于');
    expect(() =>
      applyDndMagicEdit(wizard, attempt, { catalog: catalog('2024'), slotSpentThisTurn: true }),
    ).toThrow('同一回合');
    expect(() =>
      applyDndMagicEdit(wizard, attempt, {
        catalog: catalog('2024'),
        castingBlockedReason: '护甲训练不足',
      }),
    ).toThrow('护甲训练不足');
    const cast = edit(wizard, attempt);
    expect(cast).toMatchObject({
      level: 4,
      attackBonus: 8,
      saveDc: 16,
      spentSlot: true,
      componentNote: '已核对材料',
    });
    expect(cast.state?.slotsUsed[3]).toBe(1);
    expect(wizard.dndMagic?.slotsUsed[3]).toBe(0);
    expect(() => edit({ ...wizard, dndMagic: cast.state }, attempt)).toThrow('普通法术位不足');
  });

  it('keeps pact slots and arcanum separate and recovers them on the correct rests', () => {
    const hex = spellId('2024', 'Hex');
    const sixth = spells['2024'].find(
      (entry) => entry.level === 6 && entry.classes?.includes('魔契师'),
    )!.id;
    const warlock = card('魔契师', 11, '2024', { prepared: [hex], arcanum: [sixth] });
    const cast = edit(warlock, { kind: 'cast', method: 'pact', spellId: hex });
    expect(cast.state).toMatchObject({
      pactUsed: 1,
      slotsUsed: Array(9).fill(0),
      concentration: '脆弱诅咒',
    });
    expect(cast).toMatchObject({ level: 5, concentration: { spellId: hex, name: '脆弱诅咒' } });
    const arcanum = edit(
      { ...warlock, dndMagic: cast.state },
      { kind: 'cast', method: 'arcanum', spellId: sixth },
    );
    expect(arcanum.state).toMatchObject({ pactUsed: 1, presetSpent: { 'arcanum-6': 1 } });
    expect(edit({ ...warlock, dndMagic: arcanum.state }, shortRest).state).toMatchObject({
      pactUsed: 0,
      presetSpent: { 'arcanum-6': 1 },
    });
    expect(edit({ ...warlock, dndMagic: arcanum.state }, longRest).state).toMatchObject({
      pactUsed: 0,
      presetSpent: { 'arcanum-6': 0 },
    });
    expect(
      edit({ ...warlock, dndMagic: cast.state }, { kind: 'end-concentration' }).state
        ?.concentration,
    ).toBeUndefined();
    const legacy = card('邪术师', 5, '2014', { known: [spellId('2014', 'Hex')] });
    expect(getDndMagicProfile(legacy)).toMatchObject({ mode: 'known', pact: { level: 3, max: 2 } });
    expect(
      edit(legacy, { kind: 'cast', method: 'pact', spellId: spellId('2014', 'Hex') }).level,
    ).toBe(3);
  });

  it('supports explicit source grants and automatic 2024 class spells without taking class list places', () => {
    const familiar = spellId('2024', 'Find Familiar');
    const fighter = card('战士', 2, '2024', {
      grants: [
        {
          id: 'feat-familiar',
          spellId: familiar,
          source: 'feat',
          label: '魔法学徒（法师）',
          ability: 'wis',
          allowSlots: false,
          allowRitual: false,
          free: { max: 1, used: 0, recovery: 'long' },
        },
      ],
    });
    const free = {
      kind: 'cast',
      method: 'grant',
      spellId: familiar,
      grantId: 'feat-familiar',
    } as const;
    expect(() => edit(fighter, { ...free, grantId: 'different' })).toThrow('指定授予来源');
    expect(() => edit(fighter, { ...free, method: 'ritual' })).toThrow('仪式施法资格');
    const cast = edit(fighter, free);
    expect(cast).toMatchObject({ level: 1, attackBonus: 5, saveDc: 13, spentSlot: false });
    expect(() => edit({ ...fighter, dndMagic: cast.state }, free)).toThrow('次数已用完');
    expect(edit({ ...fighter, dndMagic: cast.state }, longRest).state?.grants[0].free?.used).toBe(
      0,
    );

    const druid = card('德鲁伊', 2);
    expect(
      edit(druid, { kind: 'cast', method: 'grant', spellId: familiar }).state?.presetSpent[
        'wild-shape'
      ],
    ).toBe(1);
    expect(
      edit(druid, { kind: 'cast', method: 'slot', slotLevel: 1, spellId: familiar }).state
        ?.slotsUsed[0],
    ).toBe(1);
    expect(() => edit(druid, { kind: 'cast', method: 'ritual', spellId: familiar })).toThrow(
      '仪式施法资格',
    );
    const mark = spellId('2024', "Hunter's Mark");
    const ranger = card('游侠', 1);
    expect(
      edit(ranger, { kind: 'cast', method: 'grant', spellId: mark }).state?.presetSpent[
        'favored-enemy'
      ],
    ).toBe(1);
    expect(
      getDndMagicErrors(
        { ...ranger, dndMagic: { ...ranger.dndMagic!, prepared: [mark] } },
        catalog('2024'),
      ),
    ).toHaveLength(1);
  });

  it('does not turn a ritual-only feat into free non-ritual casting or bypass canonical references', () => {
    const alarm = spellId('2014', 'Alarm');
    const fighter = card('战士', 4, '2014', {
      grants: [
        {
          id: 'ritual-caster',
          spellId: alarm,
          source: 'feat',
          label: '仪式施法者',
          allowSlots: false,
          allowRitual: true,
        },
      ],
    });
    const cast = {
      kind: 'cast',
      spellId: alarm,
      grantId: 'ritual-caster',
      method: 'ritual',
    } as const;
    expect(edit(fighter, cast).spentSlot).toBe(false);
    expect(() => edit(fighter, { ...cast, method: 'grant' })).toThrow('不耗法术位施展权限');
    expect(() => edit(fighter, { ...cast, method: 'slot', slotLevel: 1 })).toThrow(
      '没有以法术位施展',
    );
    expect(() =>
      applyDndMagicEdit(fighter, cast, {
        catalog: () => catalog('2024')(spellId('2024', 'Alarm')),
      }),
    ).toThrow('找不到同版次');
    const falseClass = card('牧师', 5, '2024', { prepared: [spellId('2024', 'Fireball')] });
    expect(() =>
      edit(falseClass, {
        kind: 'cast',
        spellId: spellId('2024', 'Fireball'),
        method: 'slot',
        slotLevel: 3,
      }),
    ).toThrow('不符合该职业法术列表');
  });

  it('lets a prepared 2024 warlock cast a ritual that a standard 2014 warlock cannot ritual-cast', () => {
    const spell2014 = spellId('2014', 'Contact Other Plane');
    const spell2024 = spellId('2024', 'Contact Other Plane');
    const legacy = card('邪术师', 9, '2014', { known: [spell2014] });
    const modern = card('魔契师', 9);
    expect(() => edit(legacy, { kind: 'cast', method: 'ritual', spellId: spell2014 })).toThrow(
      '仪式施法资格',
    );
    expect(
      edit(modern, { kind: 'cast', method: 'ritual', spellId: spell2024 }).state?.pactUsed,
    ).toBe(0);
  });
});

describe('class resources and rests', () => {
  it('uses half rounded down with a minimum of one hit die in 2014 and all dice in 2024', () => {
    for (const edition of ['2014', '2024'] as const) {
      const bruised = card('战士', 5, edition, {
        hitDiceUsed: 5,
        presetSpent: { 'second-wind': 1 },
      });
      const result = edit(bruised, longRest);
      expect(result.hp).toBe(bruised.maxHp);
      expect(result.state?.hitDiceUsed).toBe(edition === '2014' ? 3 : 0);
      expect(result.state?.presetSpent['second-wind']).toBe(0);
      expect(() => edit({ ...bruised, hp: 0 }, longRest)).toThrow('至少有 1 点 HP');
    }
    expect(edit(card('战士', 1, '2014', { hitDiceUsed: 1 }), longRest).state?.hitDiceUsed).toBe(0);
  });

  it('applies the edition-specific short-rest healing floors and limits before consuming dice', () => {
    const lowCon = (edition: DndEdition) => {
      const fighter = card('战士', 2, edition);
      return { ...fighter, attributes: { ...fighter.attributes, con: 6 } };
    };
    expect(edit(lowCon('2014'), { ...shortRest, hitDice: 1 }, () => 1).hp).toBe(5);
    expect(edit(lowCon('2024'), { ...shortRest, hitDice: 1 }, () => 1).hp).toBe(6);
    const dice = vi.fn(() => 1);
    expect(() => edit(lowCon('2024'), { ...shortRest, hitDice: 3 }, dice)).toThrow(
      '可用生命骰不足',
    );
    expect(dice).not.toHaveBeenCalled();
    expect(() => edit({ ...lowCon('2024'), hp: 0 }, shortRest)).toThrow('至少有 1 点 HP');
    expect(edit({ ...lowCon('2014'), hp: 0 }, { ...shortRest, hitDice: 1 }, () => 3).hp).toBe(1);
  });

  it('restores fighter and barbarian presets, and custom resources as configured', () => {
    const fighter = card('战士', 4, '2024', {
      presetSpent: { 'second-wind': 3, 'action-surge': 1 },
      customResources: [{ id: 'amulet', name: '护符', max: 3, used: 2, recovery: 'none' }],
    });
    expect(edit(fighter, shortRest).state).toMatchObject({
      presetSpent: { 'second-wind': 2, 'action-surge': 0 },
      customResources: [{ used: 2 }],
    });
    expect(edit(fighter, longRest).state?.customResources[0].used).toBe(2);
    expect(() => edit(fighter, { kind: 'spend', resourceId: 'amulet', amount: 2 })).toThrow(
      '剩余次数不足',
    );
    for (const edition of ['2014', '2024'] as const) {
      const barbarian = card('野蛮人', 3, edition, { presetSpent: { rage: 3 } });
      expect(edit(barbarian, shortRest).state?.presetSpent.rage).toBe(edition === '2014' ? 3 : 2);
    }
  });

  it('keeps 2014 Archdruid Wild Shape unlimited and 2024 usage capped', () => {
    const old = card('德鲁伊', 20, '2014');
    const modern = card('德鲁伊', 20, '2024');
    expect(
      getDndMagicProfile(old)?.resources.find(({ id }) => id === 'wild-shape')?.max,
    ).toBeNull();
    expect(
      edit(old, { kind: 'spend', resourceId: 'wild-shape', amount: 5 }).state?.presetSpent,
    ).toEqual({});
    expect(getDndMagicProfile(modern)?.resources.find(({ id }) => id === 'wild-shape')?.max).toBe(
      4,
    );
    expect(() => edit(modern, { kind: 'spend', resourceId: 'wild-shape', amount: 5 })).toThrow(
      '剩余次数不足',
    );
  });

  it('validates Arcane Recovery and Sorcerous Restoration', () => {
    const wizard = card('法师', 4, '2024', { slotsUsed: [1, 1, 0, 0, 0, 0, 0, 0, 0] });
    expect(() => edit(wizard, { ...shortRest, arcaneRecovery: [1, 2] })).toThrow('超出名额');
    const recovered = edit(wizard, { ...shortRest, arcaneRecovery: [2] });
    expect(recovered.state).toMatchObject({
      slotsUsed: [1, 0, 0, 0, 0, 0, 0, 0, 0],
      presetSpent: { 'arcane-recovery': 1 },
    });
    expect(() =>
      edit({ ...wizard, dndMagic: recovered.state }, { ...shortRest, arcaneRecovery: [1] }),
    ).toThrow('剩余次数不足');
    const sorcerer = card('术士', 7, '2024', { presetSpent: { 'sorcery-points': 5 } });
    expect(
      edit(sorcerer, { ...shortRest, sorcerousRestoration: true }).state?.presetSpent,
    ).toMatchObject({ 'sorcery-points': 2, 'sorcerous-restoration': 1 });
    const old = card('术士', 20, '2014', { presetSpent: { 'sorcery-points': 5 } });
    expect(edit(old, shortRest).state?.presetSpent['sorcery-points']).toBe(1);
  });

  it('caps 2024 Magical Cunning at half the maximum Pact slots rounded up', () => {
    const recover = { kind: 'recover-pact', confirmed: true } as const;
    const warlock = card('魔契师', 11, '2024', { pactUsed: 2 });
    expect(getDndMagicProfile(warlock)?.pact?.max).toBe(3);
    expect(edit(warlock, recover).state).toMatchObject({
      pactUsed: 0,
      presetSpent: { 'magical-cunning': 1 },
    });
    const capped = card('魔契师', 17, '2024', { pactUsed: 3 });
    expect(edit(capped, recover).state?.pactUsed).toBe(1);
    const oneSpent = card('魔契师', 17, '2024', { pactUsed: 1 });
    expect(edit(oneSpent, recover).state?.pactUsed).toBe(0);
  });

  it('restores all expended Pact slots with the level 20 features in both editions', () => {
    const recover = { kind: 'recover-pact', confirmed: true } as const;
    const modern = card('魔契师', 20, '2024', { pactUsed: 3 });
    expect(edit(modern, recover).state).toMatchObject({
      pactUsed: 0,
      presetSpent: { 'magical-cunning': 1 },
    });
    const legacy = card('邪术师', 20, '2014', { pactUsed: 3 });
    expect(edit(legacy, recover).state).toMatchObject({
      pactUsed: 0,
      presetSpent: { 'eldritch-master': 1 },
    });
  });

  it('allows one modern wizard change on short rest and never rewrites learned bard spells on rest', () => {
    const book = ['Alarm', 'Fireball', 'Magic Missile', 'Shield'].map((name) =>
      spellId('2024', name),
    );
    const wizard = card('法师', 5, '2024', { spellbook: book, prepared: book.slice(0, 2) });
    expect(edit(wizard, { ...shortRest, prepared: [book[0], book[2]] }).state?.prepared).toEqual([
      book[0],
      book[2],
    ]);
    expect(() => edit(wizard, { ...shortRest, prepared: book.slice(2) })).toThrow('此次休息');
    const bard = card('吟游诗人', 1, '2024', { prepared: [spellId('2024', 'Cure Wounds')] });
    expect(() => edit(bard, { ...longRest, prepared: [] })).toThrow('此次休息');
  });
});

describe('manual resource restoration', () => {
  const restore = (resourceId: string, amount = 1, reason = '主持人核对来源') =>
    ({ kind: 'restore', resourceId, amount, reason }) as const;

  function wizard() {
    const spell = spellId('2024', 'Shield');
    return card('法师', 20, '2024', {
      spellbook: [spell],
      prepared: [spell],
      slotsUsed: [2, 0, 0, 0, 0, 0, 0, 0, 1],
      hitDiceUsed: 3,
      presetSpent: { 'arcane-recovery': 1 },
      customResources: [{ id: 'charm', name: '护符充能', max: 6, used: 4, recovery: 'none' }],
      grants: [
        {
          id: 'focus',
          spellId: spell,
          label: '法器授予',
          source: 'item',
          allowSlots: false,
          allowRitual: false,
          free: { max: 2, used: 2, recovery: 'long' },
        },
      ],
      concentration: '霜雾',
    });
  }

  it.each([
    [
      'charm',
      { customResources: [{ id: 'charm', name: '护符充能', max: 6, used: 3, recovery: 'none' }] },
    ],
    ['hit-dice', { hitDiceUsed: 2 }],
    ['arcane-recovery', { presetSpent: { 'arcane-recovery': 0 } }],
    ['slot:1', { slotsUsed: [1, 0, 0, 0, 0, 0, 0, 0, 1] }],
    ['slot:9', { slotsUsed: [2, 0, 0, 0, 0, 0, 0, 0, 0] }],
  ] as const)(
    'only changes the selected %s counter and keeps the source card unchanged',
    (resourceId, patch) => {
      const original = wizard();
      const snapshot = structuredClone(original);
      const result = edit(original, restore(resourceId));
      expect(result.state).toEqual({ ...snapshot.dndMagic, ...patch });
      expect(result.hp).toBe(snapshot.hp);
      expect(result.summary).toContain('主持人核对来源');
      expect(original).toEqual(snapshot);
    },
  );

  it('can restore a named grant or pact slot without recovering unrelated uses', () => {
    const original = wizard();
    const result = edit(original, restore('grant:focus'));
    const [grant] = original.dndMagic!.grants;
    expect(result.state).toEqual({
      ...original.dndMagic,
      grants: [{ ...grant, free: { ...grant.free, used: 1 } }],
    });
    const warlock = card('魔契师', 11, '2024', {
      pactUsed: 2,
      presetSpent: { 'magical-cunning': 1, 'arcanum-6': 1 },
    });
    expect(edit(warlock, restore('pact')).state).toEqual({ ...warlock.dndMagic, pactUsed: 1 });
    expect(() => edit(warlock, restore('pact', 3))).toThrow('恢复数量超出已消耗额度');
  });

  it('rejects over-restoring, invalid IDs, missing reasons and unlimited sources atomically', () => {
    const original = wizard();
    const snapshot = structuredClone(original);
    for (const resourceId of ['arcane-recovery', 'charm', 'slot:1', 'hit-dice', 'grant:focus']) {
      expect(() => edit(original, restore(resourceId, 5))).toThrow('恢复数量超出已消耗额度');
    }
    expect(() => edit(original, restore('slot:10'))).toThrow('恢复资源编号无效');
    expect(() => edit(original, restore('charm', 0))).toThrow();
    expect(() => edit(original, restore('charm', 1000))).toThrow();
    expect(() => edit(original, restore('charm', 1, '   '))).toThrow();
    expect(() => edit(original, restore('charm', 1, '补'.repeat(201)))).toThrow();
    expect(() => edit(original, restore('pact'))).toThrow('没有契约法术位');
    expect(() => edit(card('野蛮人', 20, '2014'), restore('rage'))).toThrow('无限使用');
    const unlimited = structuredClone(original);
    unlimited.dndMagic!.grants[0].free = { max: null, used: 0, recovery: 'none' };
    expect(() => edit(unlimited, restore('grant:focus'))).toThrow('无限使用');
    expect(original).toEqual(snapshot);
  });

  it('preserves custom records with old identifiers that overlap standard pool names', () => {
    const warlock = card('魔契师', 2, '2024', {
      pactUsed: 1,
      customResources: [{ id: 'pact', name: '自定义契约', max: 2, used: 1, recovery: 'none' }],
    });
    expect(edit(warlock, restore('custom:pact')).state).toMatchObject({
      pactUsed: 1,
      customResources: [{ id: 'pact', used: 0 }],
    });
    expect(edit(warlock, restore('pact')).state).toMatchObject({
      pactUsed: 0,
      customResources: [{ id: 'pact', used: 1 }],
    });
  });
});
