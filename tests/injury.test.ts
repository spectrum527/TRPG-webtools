import { describe, expect, it } from 'vitest';
import { createDndStatBlock } from '../shared/dnd';
import { createKeeperCard } from '../shared/keeper';
import {
  addEncounterCards,
  applyEncounterDamage,
  emptyEncounter,
  type Combatant,
} from '../shared/encounter';
import {
  applyConstitution,
  applyDeathSave,
  damageInjury,
  healInjury,
  markDead,
  stabilize,
  usesDeathSaves,
} from '../shared/injury';

function combatant(rule: 'dnd' | 'coc', values: Partial<Combatant> = {}): Combatant {
  const card = rule === 'dnd' ? createDndStatBlock('npc-blank') : createKeeperCard('npc-bystander');
  const c = addEncounterCards(emptyEncounter(), [{ ...card, hp: 10, maxHp: 10 }], 1)
    .participants[0];
  return { ...c, deathSaveMode: 'character', ...values };
}

function damage(c: Combatant, amount: number, options = {}) {
  const state = { ...emptyEncounter(), participants: [c], round: 2 };
  return applyEncounterDamage(state, c, amount, {
    armorOverride: c.rule === 'coc' ? 0 : undefined,
    ...options,
  });
}

describe('CoC injury transitions', () => {
  it('marks half-max damage as a major wound, and applies a CON result without healing', () => {
    const result = damage(combatant('coc'), 5);
    expect(result.combatant).toMatchObject({
      hp: 5,
      majorWound: true,
      injuryChecks: { conPending: true },
    });
    expect(applyConstitution(result.combatant, true, 2)).toMatchObject({
      hp: 5,
      injuryChecks: { conPending: false },
    });
    expect(applyConstitution(result.combatant, false, 2)).toMatchObject({
      hp: 5,
      unconscious: true,
    });
    expect(applyConstitution(result.combatant, false, 2).dead).not.toBe(true);
  });

  it('uses damage after armor and rounds odd half-max thresholds upward', () => {
    expect(damage(combatant('coc', { maxHp: 11 }), 5).combatant.majorWound).toBe(false);
    expect(damage(combatant('coc', { maxHp: 11 }), 6).combatant.majorWound).toBe(true);
    expect(damage(combatant('coc'), 6, { armorOverride: 2 }).combatant).toMatchObject({
      hp: 6,
      majorWound: false,
    });
  });

  it('accumulated minor injuries cause unconsciousness at zero without dying', () => {
    let c = combatant('coc');
    for (const amount of [4, 4, 2]) c = damage(c, amount).combatant;
    expect(c).toMatchObject({ hp: 0, majorWound: false, unconscious: true, dying: false });
    expect(c.dead).not.toBe(true);
  });

  it('a pre-existing major wound becomes dying and schedules the following round', () => {
    const c = damage(combatant('coc', { hp: 2, majorWound: true }), 2).combatant;
    expect(c).toMatchObject({
      hp: 0,
      dying: true,
      unconscious: true,
      injuryChecks: { cocDueRound: 3 },
    });
    expect(applyConstitution(c, true, 3)).toMatchObject({
      dying: true,
      injuryChecks: { cocDueRound: 4 },
    });
    expect(applyConstitution(c, false, 3)).toMatchObject({ dead: true, dying: false, hp: 0 });
  });

  it('marks instant death at full maximum damage and never revives through ordinary healing', () => {
    const c = damage(combatant('coc'), 10).combatant;
    expect(c).toMatchObject({ hp: 0, dead: true, dying: false });
    expect(() => healInjury(c, 1)).toThrow('复活');
  });

  it('stabilization stops dying while preserving the major wound and the need for medicine', () => {
    const c = stabilize(combatant('coc', { hp: 0, majorWound: true, dying: true }));
    expect(c).toMatchObject({
      hp: 0,
      stable: true,
      dying: false,
      unconscious: true,
      majorWound: true,
      injuryChecks: { firstAidStabilized: true, firstAidUsed: true },
    });
    expect(healInjury(c, 1)).toMatchObject({
      hp: 1,
      dying: false,
      majorWound: true,
      injuryChecks: { firstAidUsed: true },
    });
    expect(healInjury(c, 5).majorWound).toBe(false);
  });

  it('still recognizes existing major wounds at zero when max HP is unknown', () => {
    const c = damage(combatant('coc', { hp: 2, maxHp: null, majorWound: true }), 2).combatant;
    expect(c).toMatchObject({ hp: 0, unconscious: true, dying: true });
  });
});

describe.each(['2014', '2024'] as const)('D&D %s life transitions', (edition) => {
  it('only uses the overflow after temporary HP for a new massive-damage death', () => {
    const c = combatant('dnd', { hp: 6, maxHp: 12, tempHp: 3 });
    expect(damage(c, 18, { edition }).combatant).toMatchObject({
      hp: 0,
      tempHp: 0,
      dying: true,
      unconscious: true,
    });
    expect(damage(c, 21, { edition }).combatant).toMatchObject({ hp: 0, dead: true });
  });

  it('records failures at zero even when temporary HP absorbs the damage, and breaks stability', () => {
    const c = combatant('dnd', { hp: 0, tempHp: 20, stable: true });
    expect(damage(c, 1, { edition }).combatant).toMatchObject({
      hp: 0,
      tempHp: 19,
      deathFailures: 1,
      stable: false,
      dying: true,
    });
    expect(damage(c, 1, { edition, critical: true }).combatant.deathFailures).toBe(2);
    expect(damage(c, 10, { edition }).combatant.dead).toBe(true);
  });

  it('does not add failures for immune or fully resisted damage', () => {
    const c = combatant('dnd', { hp: 0, dying: true, deathFailures: 1 });
    expect(damage(c, 4, { edition, adjustment: 'immune' }).combatant.deathFailures).toBe(1);
    expect(damage(c, 1, { edition, adjustment: 'resistant' }).combatant.deathFailures).toBe(1);
  });

  it('kills ordinary NPCs but allows player, companion and host-specified death saves', () => {
    const c = combatant('dnd', { deathSaveMode: undefined });
    expect(damage(c, 10, { edition }).combatant.dead).toBe(true);
    expect(usesDeathSaves({ ...c, ownerMemberId: 'player' })).toBe(true);
    expect(usesDeathSaves({ ...c, ownerMemberId: 'player', deathSaveMode: 'instant' })).toBe(false);
    expect(usesDeathSaves({ ...c, memberId: 'player', deathSaveMode: 'instant' })).toBe(true);
    expect(damage({ ...c, deathSaveMode: 'character' }, 10, { edition }).combatant.dying).toBe(
      true,
    );
  });

  it('applies ordinary, natural 1/20 and third-result boundaries', () => {
    const c = combatant('dnd', { hp: 0, dying: true, unconscious: true });
    expect(applyDeathSave(c, 9)).toMatchObject({ deathFailures: 1 });
    expect(applyDeathSave(c, 10)).toMatchObject({ deathSuccesses: 1 });
    expect(applyDeathSave(c, 1, 20)).toMatchObject({ deathFailures: 2 });
    expect(applyDeathSave({ ...c, deathFailures: 2 }, 1).dead).toBe(true);
    expect(applyDeathSave({ ...c, deathSuccesses: 2, deathFailures: 2 }, 10)).toMatchObject({
      stable: true,
      dying: false,
      unconscious: true,
      deathSuccesses: 0,
      deathFailures: 0,
    });
    expect(applyDeathSave({ ...c, deathFailures: 2 }, 20)).toMatchObject({
      hp: 1,
      unconscious: false,
      dying: false,
      deathFailures: 0,
    });
    expect(applyDeathSave(c, 8, 2).deathSuccesses).toBe(1);
  });

  it('retains the once-per-turn marker through stabilization and healing', () => {
    const c = combatant('dnd', {
      hp: 0,
      dying: true,
      concentration: '雾云术',
      injuryChecks: { lastDeathRound: 2 },
    });
    expect(stabilize(c).injuryChecks?.lastDeathRound).toBe(2);
    expect(stabilize(c).concentration).toBe('');
    const healed = healInjury(c, 1);
    expect(damage(healed, 1, { edition }).combatant.injuryChecks?.lastDeathRound).toBe(2);
    expect(() => applyDeathSave(markDead(c), 20)).toThrow();
  });
});

it('handles the explicit 2024 zero-maximum rule without assuming a positive maximum', () => {
  const c = combatant('dnd', { hp: 0, maxHp: 0 });
  expect(damageInjury(c, 0, 0, 0, 1, { edition: '2024' }).combatant.dead).toBe(true);
});
