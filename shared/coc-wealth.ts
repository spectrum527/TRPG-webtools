import { z } from 'zod';
import { effectiveCharacter } from './adjustments';
import type { Character } from './types';
import { controlledValue, editValueControl, NumberControlSchema } from './value-control';

export const COC_WEALTH_FIELDS = ['cash', 'assets', 'spending'] as const;
export const COC_LEDGER_LIMIT = 200;
const maximumMoney = 1_000_000_000_000;
const toCents = (amount: number) => Math.round(amount * 100);
const money = z
  .number()
  .finite()
  .min(0)
  .max(maximumMoney)
  .refine((amount) => toCents(amount) / 100 === amount, '金额最多保留两位小数');
const currency = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9]{2,7}$/, '请输入货币简称，如 CNY 或 JPY');
const referenceEra = z.enum(['1920s', 'modern']);
const reason = z.string().trim().min(1, '请填写原因').max(200);
const timestamp = z.string().datetime({ offset: true });

export const CocWealthSettingSchema = z.discriminatedUnion('era', [
  z.strictObject({ era: z.literal('1920s') }),
  z.strictObject({ era: z.literal('modern') }),
  z.strictObject({
    era: z.literal('custom'),
    label: z.string().trim().min(1).max(60),
    currency,
    basis: referenceEra,
    rate: z.number().finite().min(0.000001).max(10000),
  }),
]);
export type CocWealthSetting = z.infer<typeof CocWealthSettingSchema>;

const account = z.enum(['cash', 'assets']);
const operation = z.enum(['income', 'expense', 'override']);
const ledgerEntry = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  at: timestamp,
  account,
  operation,
  currency,
  amount: money,
  before: money,
  after: money,
  reason,
});
const referenceControl = NumberControlSchema.extend({ manual: money.nullable() });
const wealthFields = z.enum(COC_WEALTH_FIELDS);

export const CocWealthSchema = z
  .strictObject({
    setting: CocWealthSettingSchema,
    controls: z
      .strictObject({
        cash: referenceControl.optional(),
        assets: referenceControl.optional(),
        spending: referenceControl.optional(),
      })
      .optional(),
    controlReasons: z.partialRecord(wealthFields, reason).optional(),
    opening: z
      .strictObject({
        at: timestamp,
        creditRating: z.number().int().min(0).max(99),
        setting: CocWealthSettingSchema,
        currency,
        cash: money,
        assets: money,
      })
      .optional(),
    ledger: z.array(ledgerEntry).max(COC_LEDGER_LIMIT),
  })
  .superRefine((state, ctx) => {
    const error = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    for (const field of COC_WEALTH_FIELDS) {
      if (state.controlReasons?.[field] && state.controls?.[field]?.manual == null)
        error(['controlReasons', field], '没有对应的手填金额');
    }
    if (Boolean(state.opening) !== Boolean(state.ledger.length)) {
      error(['opening'], '账本起始余额与流水不匹配');
      return;
    }
    if (!state.opening) return;
    if (
      state.opening.currency !== currencyFor(state.setting) ||
      state.opening.currency !== currencyFor(state.opening.setting)
    )
      error(['opening', 'currency'], '已记账的货币须保持一致');
    const balances = { cash: state.opening.cash, assets: state.opening.assets };
    const ids = new Set<string>();
    state.ledger.forEach((entry, index) => {
      if (ids.has(entry.id)) error(['ledger', index, 'id'], '流水编号不可重复');
      ids.add(entry.id);
      if (entry.currency !== state.opening!.currency)
        error(['ledger', index, 'currency'], '流水货币不匹配');
      if (entry.operation !== 'override' && entry.amount === 0)
        error(['ledger', index, 'amount'], '收支金额须大于零');
      if (entry.before !== balances[entry.account] || entry.after !== ledgerAfter(entry))
        error(['ledger', index, 'after'], '流水与前后余额不匹配');
      balances[entry.account] = entry.after;
    });
  });

export type CocWealth = z.infer<typeof CocWealthSchema>;
export type CocWealthSettingField = (typeof COC_WEALTH_FIELDS)[number];
export type CocLedgerEntry = z.infer<typeof ledgerEntry>;

const controlEdit = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('lock'), locked: z.boolean() }),
  z.strictObject({ kind: z.literal('mode'), mode: z.enum(['auto', 'manual']) }),
  z.strictObject({ kind: z.literal('value'), value: money }),
]);

export const cocWealthEditOptions = [
  z.strictObject({ kind: z.literal('wealth-setting'), setting: CocWealthSettingSchema }),
  z.strictObject({
    kind: z.literal('wealth-control'),
    field: wealthFields,
    change: controlEdit,
    reason: reason.optional(),
  }),
  z.strictObject({
    kind: z.literal('wealth-transaction'),
    account,
    operation,
    amount: money,
    reason,
  }),
] as const;

const CocWealthEditSchema = z.discriminatedUnion('kind', cocWealthEditOptions);
export type CocWealthEdit = z.infer<typeof CocWealthEditSchema>;

export const COC_WEALTH_TIERS = [
  { id: 'penniless', label: '身无分文', max: 0 },
  { id: 'poor', label: '贫穷', max: 9 },
  { id: 'average', label: '普通', max: 49 },
  { id: 'wealthy', label: '富足', max: 89 },
  { id: 'rich', label: '富裕', max: 98 },
  { id: 'superRich', label: '巨富', max: 99 },
] as const;

// Keeper Rulebook, chapter 3, Table II. Middle brackets are multipliers;
// the first and last rows are fixed amounts, with a minimum asset value at CR 99.
const referenceTables = {
  '1920s': [
    [0.5, 0, 0.5],
    [1, 10, 2],
    [2, 50, 10],
    [5, 500, 50],
    [20, 2000, 250],
    [50000, 5000000, 5000],
  ],
  modern: [
    [10, 0, 10],
    [20, 200, 40],
    [40, 1000, 200],
    [100, 10000, 1000],
    [400, 40000, 5000],
    [1000000, 100000000, 100000],
  ],
} as const;

function currencyFor(setting: CocWealthSetting) {
  return setting.era === 'custom' ? setting.currency : 'USD';
}

function ledgerAfter({
  before,
  amount,
  operation,
}: Pick<CocLedgerEntry, 'before' | 'amount' | 'operation'>) {
  if (operation === 'override') return amount;
  return (toCents(before) + (operation === 'income' ? 1 : -1) * toCents(amount)) / 100;
}

export function defaultCocWealth(): CocWealth {
  return { setting: { era: '1920s' }, ledger: [] };
}

/** Credit determines a starting reference; the first posting establishes the actual ledger. */
export function cocWealthValues(
  card: Character,
  state = card.cocInvestigator?.wealth ?? defaultCocWealth(),
) {
  const creditRating = Math.max(
    0,
    Math.min(99, effectiveCharacter(card, false).skills.creditRating ?? 0),
  );
  const tierIndex = COC_WEALTH_TIERS.findIndex(({ max }) => creditRating <= max);
  const tier = COC_WEALTH_TIERS[tierIndex];
  const { setting } = state;
  const era = setting.era === 'custom' ? setting.basis : setting.era;
  const rate = setting.era === 'custom' ? setting.rate : 1;
  const [cash, assets, spending] = referenceTables[era][tierIndex];
  const multiplier = tierIndex === 0 || tierIndex === 5 ? 1 : creditRating;
  const convert = (amount: number) => toCents(amount * rate) / 100;
  const automatic = {
    cash: convert(cash * multiplier),
    assets: convert(assets * multiplier),
    spending: convert(spending),
  };
  const reference = {
    cash: controlledValue(state.controls?.cash, automatic.cash),
    assets: controlledValue(state.controls?.assets, automatic.assets),
    spending: controlledValue(state.controls?.spending, automatic.spending),
  };
  const current = {
    cash: state.opening?.cash ?? reference.cash,
    assets: state.opening?.assets ?? reference.assets,
  };
  for (const entry of state.ledger) current[entry.account] = entry.after;
  return {
    setting,
    currency: currencyFor(setting),
    creditRating,
    tier,
    automatic,
    reference,
    current,
    assetsIsMinimum:
      creditRating === 99 &&
      !(state.controls?.assets?.mode === 'manual' && state.controls.assets.manual !== null),
    opening: state.opening,
    ledger: state.ledger,
  };
}

export function applyCocWealthEdit(
  card: Character,
  edit: CocWealthEdit,
  context: { now: string; id: () => string },
): CocWealth {
  const state = card.cocInvestigator?.wealth ?? defaultCocWealth();
  const values = cocWealthValues(card, state);
  if (edit.kind === 'wealth-setting') {
    if (state.opening && currencyFor(edit.setting) !== state.opening.currency)
      throw new Error('已记账的货币固定；请保留该货币并按剧本汇率折算新流水');
    return { ...state, setting: edit.setting };
  }
  if (edit.kind === 'wealth-control') {
    const control = editValueControl(
      state.controls?.[edit.field],
      edit.change,
      values.automatic[edit.field],
    );
    if (edit.change.kind === 'value' && !edit.reason) throw new Error('请填写手改参考金额的原因');
    return {
      ...state,
      controls: { ...state.controls, [edit.field]: control },
      ...(edit.change.kind === 'value'
        ? { controlReasons: { ...state.controlReasons, [edit.field]: edit.reason! } }
        : {}),
    };
  }
  if (state.ledger.length >= COC_LEDGER_LIMIT) throw new Error('此调查员的账本已达到流水上限');
  if (edit.operation !== 'override' && edit.amount === 0) throw new Error('收支金额须大于零');
  const before = values.current[edit.account];
  const after = ledgerAfter({ ...edit, before });
  if (after < 0) throw new Error('余额不足，请先记入收入或出售资产');
  if (!money.safeParse(after).success) throw new Error('余额超出金额范围');
  const opening = state.opening ?? {
    at: context.now,
    creditRating: values.creditRating,
    setting: state.setting,
    currency: values.currency,
    cash: values.reference.cash,
    assets: values.reference.assets,
  };
  const entry: CocLedgerEntry = {
    id: context.id(),
    at: context.now,
    account: edit.account,
    operation: edit.operation,
    currency: opening.currency,
    amount: edit.amount,
    before,
    after,
    reason: edit.reason,
  };
  return { ...state, opening, ledger: [...state.ledger, entry] };
}
