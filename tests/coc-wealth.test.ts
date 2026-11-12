import { describe, expect, it } from 'vitest';
import { applyCharacterAdjustment } from '../shared/adjustments';
import { applyCocInvestigatorEdit, type CocInvestigatorEdit } from '../shared/coc-investigator';
import { cocWealthValues, CocWealthSchema } from '../shared/coc-wealth';
import { createCharacter, deriveCharacter, exportCharacter, parseCharacter } from '../shared/rules';
import type { Character } from '../shared/types';

const now = '2026-11-12T00:00:00.000Z';
const apply = (card: Character, edit: CocInvestigatorEdit, id = 'entry') =>
  applyCocInvestigatorEdit(card, edit, { now, id: () => id });

function investigator(creditRating = 20) {
  const card = createCharacter('coc', () => 3);
  return deriveCharacter({
    ...card,
    name: '陈安',
    occupation: '记者',
    creation: undefined,
    skills: { ...card.skills, creditRating },
  });
}

describe('CoC reference wealth and ledger', () => {
  it.each([
    [0, 0.5, 0, 0.5],
    [1, 1, 10, 2],
    [9, 9, 90, 2],
    [10, 20, 500, 10],
    [49, 98, 2450, 10],
    [50, 250, 25000, 50],
    [89, 445, 44500, 50],
    [90, 1800, 180000, 250],
    [98, 1960, 196000, 250],
    [99, 50000, 5000000, 5000],
  ])('computes 1920s USD for CR %i with no state to migrate', (credit, cash, assets, spending) => {
    const card = investigator(credit);
    expect(cocWealthValues(card)).toMatchObject({
      currency: 'USD',
      creditRating: credit,
      reference: { cash, assets, spending },
      assetsIsMinimum: credit === 99,
    });
    expect(card.cocInvestigator).toBeUndefined();
  });

  it('switches references to modern USD or a Keeper-defined era and currency', () => {
    const base = investigator(99);
    const modern = apply(base, { kind: 'wealth-setting', setting: { era: 'modern' } });
    expect(cocWealthValues(modern)).toMatchObject({
      currency: 'USD',
      reference: { cash: 1000000, assets: 100000000, spending: 100000 },
    });
    const custom = apply(modern, {
      kind: 'wealth-setting',
      setting: {
        era: 'custom',
        label: '本团现代日本',
        currency: 'JPY',
        basis: 'modern',
        rate: 150,
      },
    });
    expect(cocWealthValues(custom)).toMatchObject({
      currency: 'JPY',
      reference: { cash: 150000000, assets: 15000000000, spending: 15000000 },
    });
  });

  it('pins balances at the first posting while credit and era continue changing the references', () => {
    let card = investigator();
    card = apply(
      card,
      {
        kind: 'wealth-transaction',
        account: 'cash',
        operation: 'expense',
        amount: 10,
        reason: '购买车票',
      },
      'ticket',
    );
    expect(cocWealthValues(card)).toMatchObject({
      reference: { cash: 40, assets: 1000 },
      current: { cash: 30, assets: 1000 },
      opening: { creditRating: 20, cash: 40, assets: 1000 },
    });
    card = applyCharacterAdjustment(
      card,
      { kind: 'set-value', target: 'skill', key: 'creditRating', value: 50, reason: '经营改善' },
      now,
    );
    expect(cocWealthValues(card)).toMatchObject({
      reference: { cash: 250, assets: 25000 },
      current: { cash: 30, assets: 1000 },
    });
    card = apply(card, { kind: 'wealth-setting', setting: { era: 'modern' } });
    expect(cocWealthValues(card)).toMatchObject({
      reference: { cash: 5000, assets: 500000 },
      current: { cash: 30, assets: 1000 },
    });
    card = apply(
      card,
      {
        kind: 'wealth-transaction',
        account: 'cash',
        operation: 'income',
        amount: 0.1,
        reason: '找零',
      },
      'ten-cents',
    );
    card = apply(
      card,
      {
        kind: 'wealth-transaction',
        account: 'cash',
        operation: 'income',
        amount: 0.2,
        reason: '找零',
      },
      'twenty-cents',
    );
    card = apply(
      card,
      {
        kind: 'wealth-transaction',
        account: 'assets',
        operation: 'override',
        amount: 875,
        reason: '重新估值',
      },
      'revalue',
    );
    expect(cocWealthValues(card)).toMatchObject({ current: { cash: 30.3, assets: 875 } });
    expect(cocWealthValues(card).ledger.at(-1)).toMatchObject({
      before: 1000,
      after: 875,
      currency: 'USD',
      reason: '重新估值',
    });
    expect(parseCharacter(exportCharacter(card, 'json')).cocInvestigator).toEqual(
      card.cocInvestigator,
    );
  });

  it('rejects overspending, fractional-cent entries, empty reasons, and forged balances', () => {
    const card = investigator();
    const spend = {
      kind: 'wealth-transaction',
      account: 'cash',
      operation: 'expense',
      reason: '车票',
    } as const;
    expect(() => apply(card, { ...spend, amount: 41 })).toThrow(/余额不足/);
    expect(() => apply(card, { ...spend, amount: 1.001 })).toThrow(/两位小数/);
    expect(() => apply(card, { ...spend, amount: 1, reason: '' })).toThrow(/原因/);
    const paid = apply(card, { ...spend, amount: 1 });
    const tampered = structuredClone(paid.cocInvestigator!.wealth!);
    tampered.ledger[0].after = 42;
    expect(CocWealthSchema.safeParse(tampered).success).toBe(false);
    expect(() =>
      apply(paid, {
        kind: 'wealth-setting',
        setting: {
          era: 'custom',
          label: '本团现代日本',
          currency: 'JPY',
          basis: 'modern',
          rate: 150,
        },
      }),
    ).toThrow(/货币固定/);
  });

  it('requires a reason for unlocked manual references and retains them through auto mode', () => {
    let card = investigator();
    expect(() =>
      apply(card, {
        kind: 'wealth-control',
        field: 'spending',
        change: { kind: 'mode', mode: 'manual' },
      }),
    ).toThrow(/解锁/);
    for (const change of [
      { kind: 'lock', locked: false },
      { kind: 'mode', mode: 'manual' },
    ] as const)
      card = apply(card, { kind: 'wealth-control', field: 'spending', change });
    expect(() =>
      apply(card, {
        kind: 'wealth-control',
        field: 'spending',
        change: { kind: 'value', value: 20 },
      }),
    ).toThrow(/原因/);
    card = apply(card, {
      kind: 'wealth-control',
      field: 'spending',
      change: { kind: 'value', value: 20 },
      reason: '剧本补贴',
    });
    card = apply(card, {
      kind: 'wealth-control',
      field: 'spending',
      change: { kind: 'mode', mode: 'auto' },
    });
    card = apply(card, {
      kind: 'wealth-control',
      field: 'spending',
      change: { kind: 'lock', locked: true },
    });
    expect(cocWealthValues(card).reference.spending).toBe(10);
    expect(card.cocInvestigator?.wealth?.controls?.spending).toEqual({
      locked: true,
      mode: 'auto',
      manual: 20,
    });
    expect(card.cocInvestigator?.wealth?.controlReasons?.spending).toBe('剧本补贴');
  });
});
