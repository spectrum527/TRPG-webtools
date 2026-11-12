import { z } from 'zod';
import { getAdjustmentErrors } from './adjustments';
import {
  applyCocEquipmentEdit,
  CocDamageExpressionSchema,
  CocEquipmentSchema,
  cocEquipmentEditOptions,
  type CocEquipmentEdit,
} from './coc-equipment';
import {
  applyCocWealthEdit,
  CocWealthSchema,
  cocWealthEditOptions,
  type CocWealthEdit,
} from './coc-wealth';
import { syncAllocation } from './creation';
import {
  cocAgeMovementPenalty,
  cocDerivedValues,
  synchronizeCocInvestigator,
} from './coc-physical';
import { rollDice, type DieRandom } from './dice';
import type { Character } from './types';
import {
  automaticControl,
  editValueControl,
  NumberControlEditSchema,
  NumberControlSchema,
  TextControlEditSchema,
  TextControlSchema,
} from './value-control';

export {
  cocAgeMovementPenalty,
  cocDamageBonusAndBuild,
  cocDerivedValues,
  synchronizeCocInvestigator,
} from './coc-physical';

export const COC_DERIVED_FIELDS = ['db', 'build', 'mov', 'maxHp', 'maxMp', 'maxSan'] as const;
export const COC_AGE_ATTRIBUTES = [
  'str',
  'con',
  'siz',
  'dex',
  'app',
  'int',
  'pow',
  'edu',
  'luck',
] as const;
const physicalAttributes = ['str', 'con', 'siz', 'dex'] as const;
const adultDeductionKeys = ['str', 'con', 'dex'] as const;
const youthDeductionKeys = ['str', 'siz'] as const;
const numericDerivedFields = ['build', 'mov', 'maxHp', 'maxMp', 'maxSan'] as const;
const whole = (min: number, max: number) => z.number().int().min(min).max(max);
const note = z.string().trim().min(1).max(200);
const ageNumber = whole(1, 2000);
const attributeValue = whole(1, 100);
const ageAttributes = z.enum(COC_AGE_ATTRIBUTES);
const mode = z.enum(['auto', 'manual']);
const timestamp = z.string().datetime({ offset: true });

const CocDerivedControlsSchema = z.strictObject({
  db: TextControlSchema.extend({ manual: CocDamageExpressionSchema.nullable() }).optional(),
  build: NumberControlSchema.extend({ manual: whole(-10, 20).nullable() }).optional(),
  mov: NumberControlSchema.extend({ manual: whole(0, 99).nullable() }).optional(),
  maxHp: NumberControlSchema.extend({ manual: whole(1, 9999).nullable() }).optional(),
  maxMp: NumberControlSchema.extend({ manual: whole(0, 9999).nullable() }).optional(),
  maxSan: NumberControlSchema.extend({ manual: whole(0, 99).nullable() }).optional(),
});

export type CocDerivedField = (typeof COC_DERIVED_FIELDS)[number];
export type CocDerivedControls = z.infer<typeof CocDerivedControlsSchema>;

const CocAgeDeltasSchema = z.partialRecord(ageAttributes, whole(-100, 100));
const CocAgeDeductionsSchema = z.partialRecord(z.enum(physicalAttributes), whole(0, 99));
const CocAgeBaseSchema = z.strictObject({
  str: attributeValue,
  con: attributeValue,
  siz: attributeValue,
  dex: attributeValue,
  app: attributeValue,
  int: attributeValue,
  pow: attributeValue,
  edu: attributeValue,
  luck: attributeValue,
});
const ageControl = z.strictObject({
  mode,
  locked: z.boolean(),
  manual: CocAgeDeltasSchema.nullable(),
});
const educationCheck = z.strictObject({
  before: attributeValue,
  percentile: whole(1, 100),
  d10: whole(1, 10).optional(),
  gain: whole(0, 10),
});
const die6 = whole(1, 6);
const luckRoll = z.tuple([die6, die6, die6]);

export type CocAgeDeltas = z.infer<typeof CocAgeDeltasSchema>;
export type CocAgeDeductions = z.infer<typeof CocAgeDeductionsSchema>;
type CocAgeBase = z.infer<typeof CocAgeBaseSchema>;

const CocAgeApplicationSchema = z
  .strictObject({
    age: ageNumber,
    mode,
    at: timestamp,
    base: CocAgeBaseSchema,
    changes: CocAgeDeltasSchema,
    eduChecks: z.array(educationCheck).max(4),
    luckRolls: z.array(luckRoll).max(2),
    reason: note.optional(),
  })
  .superRefine((record, ctx) => {
    const error = (path: (number | string)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    for (const key of COC_AGE_ATTRIBUTES) {
      const value = record.base[key] + (record.changes[key] ?? 0);
      if (value < 1 || value > 100) error(['changes', key], '年龄修正后的属性超出范围');
    }
    if (record.mode === 'manual') {
      if (!record.reason) error(['reason'], '手动年龄修正须填写原因');
      if (record.eduChecks.length || record.luckRolls.length)
        error(['eduChecks'], '手动年龄修正不包含自动骰点');
      return;
    }
    const rule = cocAgeRule(record.age);
    if (!rule) {
      error(['age'], '该年龄没有自动修正规则');
      return;
    }
    if (
      record.eduChecks.length !== rule.educationChecks ||
      record.luckRolls.length !== rule.luckRolls
    )
      error(['eduChecks'], '年龄检定次数不符');
    let edu = record.base.edu - rule.educationLoss;
    record.eduChecks.forEach(({ before, percentile, d10, gain }, i) => {
      const success = percentile > edu;
      const expected = success && d10 !== undefined ? Math.min(d10, 99 - edu) : 0;
      if (before !== edu || success !== (d10 !== undefined) || expected !== gain)
        error(['eduChecks', i], '教育成长记录与骰点不符');
      edu += gain;
    });
    const luck = record.luckRolls.length
      ? Math.max(...record.luckRolls.map(luckTotal))
      : record.base.luck;
    const physicalKeys = new Set<string>(rule.deductionKeys);
    let deducted = 0;
    for (const key of COC_AGE_ATTRIBUTES) {
      const change = record.changes[key] ?? 0;
      if (physicalKeys.has(key)) {
        if (change > 0) error(['changes', key], '扣减属性不可增加');
        deducted -= change;
      } else {
        const expected =
          key === 'app'
            ? -rule.appearanceLoss
            : key === 'edu'
              ? edu - record.base.edu
              : key === 'luck'
                ? luck - record.base.luck
                : 0;
        if (change !== expected) error(['changes', key], '年龄修正与规则或骰点不符');
      }
    }
    if (deducted !== rule.deductionPoints) error(['changes'], '年龄扣减点数不符');
  });

export type CocAgeApplication = z.infer<typeof CocAgeApplicationSchema>;

export const CocInvestigatorSchema = z.strictObject({
  derived: CocDerivedControlsSchema.optional(),
  age: z
    .strictObject({ control: ageControl, applied: CocAgeApplicationSchema.optional() })
    .optional(),
  equipment: CocEquipmentSchema.optional(),
  wealth: CocWealthSchema.optional(),
});

export type CocInvestigator = z.infer<typeof CocInvestigatorSchema>;

/** Cross-field checks to use after the schema validates the state and base card. */
export function getCocInvestigatorErrors(card: Character): string[] {
  if (!card.cocInvestigator) return [];
  if (card.rule !== 'coc') return ['调查员资料仅适用于 CoC'];
  const errors: string[] = [];
  if (card.cocInvestigator.age?.applied) {
    try {
      cocAgeBase(card);
    } catch (error) {
      errors.push((error as Error).message);
    }
  }
  if (COC_AGE_ATTRIBUTES.every((key) => Number.isInteger(card.attributes[key]))) {
    const expected = synchronizeCocInvestigator(card);
    if (
      card.maxHp !== expected.maxHp ||
      card.maxMp !== expected.maxMp ||
      card.maxSan !== expected.maxSan
    )
      errors.push('调查员的 HP、MP 或 SAN 上限与自动规则或手填值不一致');
  }
  return errors;
}

const ageControlEdit = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('lock'), locked: z.boolean() }),
  z.strictObject({ kind: z.literal('mode'), mode }),
  z.strictObject({ kind: z.literal('value'), value: CocAgeDeltasSchema }),
]);
const derivedOrAgeOptions = [
  z.strictObject({
    kind: z.literal('derived-control'),
    field: z.enum(COC_DERIVED_FIELDS),
    change: z.union([NumberControlEditSchema, TextControlEditSchema]),
  }),
  z.strictObject({ kind: z.literal('age-control'), change: ageControlEdit }),
  z.strictObject({
    kind: z.literal('age-apply'),
    deductions: CocAgeDeductionsSchema.optional(),
    reason: note.optional(),
  }),
  z.strictObject({ kind: z.literal('age-clear') }),
] as const;
export const CocInvestigatorEditSchema = z.discriminatedUnion('kind', [
  ...derivedOrAgeOptions,
  ...cocEquipmentEditOptions,
  ...cocWealthEditOptions,
]);
export type CocInvestigatorEdit = z.infer<typeof CocInvestigatorEditSchema>;

export interface CocInvestigatorEditContext {
  now?: string;
  rng?: DieRandom;
  id?: () => string;
}

export interface CocAgeRule {
  deductionPoints: number;
  deductionKeys: readonly (typeof physicalAttributes)[number][];
  appearanceLoss: number;
  educationLoss: number;
  educationChecks: number;
  luckRolls: number;
  movementPenalty: number;
}

export function cocAgeRule(age: number): CocAgeRule | null {
  if (!Number.isInteger(age) || age < 15 || age >= 90) return null;
  const decade = Math.floor(age / 10);
  const mature = decade >= 4;
  return {
    deductionPoints: mature ? [5, 10, 20, 40, 80][decade - 4] : decade === 1 ? 5 : 0,
    deductionKeys: mature ? adultDeductionKeys : decade === 1 ? youthDeductionKeys : [],
    appearanceLoss: mature ? (decade - 3) * 5 : 0,
    educationLoss: decade === 1 ? 5 : 0,
    educationChecks: decade === 1 ? 0 : Math.min(4, mature ? decade - 2 : 1),
    luckRolls: decade === 1 ? 2 : 0,
    movementPenalty: cocAgeMovementPenalty(age),
  };
}

/** Undo the saved delta rather than restoring a stale snapshot over later base edits. */
export function cocAgeBase(card: Character): CocAgeBase {
  const previous = card.cocInvestigator?.age?.applied;
  const raw = Object.fromEntries(
    COC_AGE_ATTRIBUTES.map((key) => [key, card.attributes[key] - (previous?.changes[key] ?? 0)]),
  );
  const parsed = CocAgeBaseSchema.safeParse(raw);
  if (!parsed.success) throw new Error('还原年龄修正后的基础属性超出范围，请先检查属性数值');
  return parsed.data;
}

/** For creation rerolls that replace the full, unadjusted attributes. The chosen mode and lock persist. */
export function resetCocAgeApplication(card: Character): Character {
  const state = card.cocInvestigator;
  if (!state?.age?.applied) return card;
  return { ...card, cocInvestigator: { ...state, age: { control: state.age.control } } };
}

export function cocAgeDefaultDeductions(card: Character): CocAgeDeductions {
  const rule = cocAgeRule(card.age);
  if (!rule?.deductionPoints) return {};
  const base = cocAgeBase(card);
  const existing = card.cocInvestigator?.age?.applied;
  const deductions: CocAgeDeductions = {};
  if (existing?.mode === 'auto') {
    const saved = Object.fromEntries(
      rule.deductionKeys.map((key) => [key, -(existing.changes[key] ?? 0)]),
    );
    if (
      Object.values(saved).reduce((sum, amount) => sum + amount, 0) === rule.deductionPoints &&
      rule.deductionKeys.every((key) => saved[key] >= 0 && saved[key] < base[key])
    )
      return saved;
  }
  for (let i = 0; i < rule.deductionPoints; i++) {
    const remaining = (key: keyof CocAgeDeductions) => base[key] - (deductions[key] ?? 0);
    const key = rule.deductionKeys.reduce((best, current) =>
      remaining(current) > remaining(best) ? current : best,
    );
    if (remaining(key) <= 1) throw new Error('当前属性不足以分配此年龄段的扣减点数');
    deductions[key] = (deductions[key] ?? 0) + 1;
  }
  return deductions;
}

function luckTotal(dice: [number, number, number]): number {
  return 5 * (dice[0] + dice[1] + dice[2]);
}

function ageApplication(
  card: Character,
  edit: Extract<CocInvestigatorEdit, { kind: 'age-apply' }>,
  { now, rng }: { now: string; rng?: DieRandom },
): CocAgeApplication {
  const state = card.cocInvestigator?.age;
  const base = cocAgeBase(card);
  if (state?.control.mode === 'manual') {
    if (!edit.reason) throw new Error('请填写手动年龄修正的原因');
    if (edit.deductions && Object.keys(edit.deductions).length)
      throw new Error('手动模式请填写修正值');
    return {
      age: card.age,
      mode: 'manual',
      at: now,
      base,
      changes: state.control.manual ?? {},
      eduChecks: [],
      luckRolls: [],
      reason: edit.reason,
    };
  }
  const rule = cocAgeRule(card.age);
  if (!rule) throw new Error('自动年龄修正适用于 15–89 岁；此年龄可使用手动模式');
  const deductions = edit.deductions ?? cocAgeDefaultDeductions(card);
  const keys = new Set<string>(rule.deductionKeys);
  const changes: CocAgeDeltas = {};
  let deducted = 0;
  for (const key of physicalAttributes) {
    const amount = deductions[key] ?? 0;
    if (!amount) continue;
    if (!keys.has(key) || amount >= base[key]) throw new Error('年龄扣减分配无效，请检查各项属性');
    deducted += amount;
    changes[key] = -amount;
  }
  if (deducted !== rule.deductionPoints)
    throw new Error(`此年龄段须分配 ${rule.deductionPoints} 点扣减`);
  if (rule.appearanceLoss >= base.app || rule.educationLoss >= base.edu)
    throw new Error('年龄修正会使属性低于 1，可改用手动模式');
  if (rule.appearanceLoss) changes.app = -rule.appearanceLoss;
  let edu = base.edu - rule.educationLoss;
  const eduChecks: CocAgeApplication['eduChecks'] = [];
  const previous = state?.applied?.mode === 'auto' ? state.applied : undefined;
  for (let index = 0; index < rule.educationChecks; index++) {
    const existing = previous?.eduChecks[index];
    const percentile = existing?.percentile ?? rollDice('1d100', rng).total;
    const d10 = percentile > edu ? (existing?.d10 ?? rollDice('1d10', rng).total) : undefined;
    const gain = d10 === undefined ? 0 : Math.min(d10, 99 - edu);
    eduChecks.push({ before: edu, percentile, ...(d10 !== undefined ? { d10 } : {}), gain });
    edu += gain;
  }
  if (edu !== base.edu) changes.edu = edu - base.edu;
  const luckRolls = Array.from(
    { length: rule.luckRolls },
    (_, i) =>
      previous?.luckRolls[i] ?? (rollDice('3d6', rng).groups[0].rolls as [number, number, number]),
  );
  if (luckRolls.length) changes.luck = Math.max(...luckRolls.map(luckTotal)) - base.luck;
  return {
    age: card.age,
    mode: 'auto',
    at: now,
    base,
    changes,
    eduChecks,
    luckRolls,
    ...(edit.reason ? { reason: edit.reason } : {}),
  };
}

function updateAgeAttributes(card: Character, attributes: Record<string, number>): Character {
  const skills = { ...card.skills };
  const preserve = (key: string, before: number, after: number) => {
    if (before !== after)
      skills[key] = Math.min(1000, Math.max(0, (skills[key] ?? before) - before + after));
  };
  preserve('dodge', Math.floor(card.attributes.dex / 2), Math.floor(attributes.dex / 2));
  preserve('ownLanguage', card.attributes.edu, attributes.edu);
  const next = syncAllocation({ ...card, attributes, skills });
  const errors = getAdjustmentErrors(next);
  if (errors.length) throw new Error(errors[0]);
  return next;
}

export function applyCocInvestigatorEdit(
  card: Character,
  input: CocInvestigatorEdit,
  context: CocInvestigatorEditContext = {},
): Character {
  if (card.rule !== 'coc') throw new Error('此操作仅适用于 CoC 调查员');
  const parsed = CocInvestigatorEditSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  const edit = parsed.data;
  const now = context.now ?? new Date().toISOString();
  const id = context.id ?? (() => globalThis.crypto.randomUUID());
  const state = card.cocInvestigator ?? {};
  let result = card;
  let investigator: CocInvestigator = state;
  if (edit.kind === 'derived-control') {
    const automatic = cocDerivedValues(card).automatic;
    const derived = { ...state.derived };
    if (edit.field === 'db')
      derived.db = editValueControl(
        derived.db,
        TextControlEditSchema.parse(edit.change),
        automatic.db,
      );
    else if ((numericDerivedFields as readonly string[]).includes(edit.field)) {
      const { field } = edit;
      derived[field] = editValueControl(
        derived[field],
        NumberControlEditSchema.parse(edit.change),
        automatic[field],
      );
    }
    investigator = { ...state, derived };
  } else if (edit.kind === 'age-control') {
    const control = editValueControl(
      state.age?.control,
      edit.change,
      state.age?.applied?.changes ?? {},
    );
    investigator = { ...state, age: { ...state.age, control } };
  } else if (edit.kind === 'age-apply') {
    const applied = ageApplication(card, edit, { now, rng: context.rng });
    const checked = CocAgeApplicationSchema.safeParse(applied);
    if (!checked.success) throw new Error(checked.error.issues[0].message);
    const { at: _at, ...appliedResult } = applied;
    const previous = state.age?.applied;
    if (previous) {
      const { at: _previousAt, ...previousResult } = previous;
      if (JSON.stringify(appliedResult) === JSON.stringify(previousResult)) return card;
    }
    const attributes = { ...card.attributes };
    for (const key of COC_AGE_ATTRIBUTES)
      attributes[key] = applied.base[key] + (applied.changes[key] ?? 0);
    result = updateAgeAttributes(card, attributes);
    investigator = {
      ...state,
      age: {
        control: state.age?.control ?? automaticControl<CocAgeDeltas>(),
        applied: checked.data,
      },
    };
  } else if (edit.kind === 'age-clear') {
    if (!state.age?.applied) return card;
    if (state.age.control.locked && state.age.applied.mode === 'manual')
      throw new Error('请先解锁手动年龄修正');
    result = updateAgeAttributes(card, cocAgeBase(card));
    investigator = { ...state, age: { control: state.age.control } };
  } else if (
    edit.kind === 'wealth-setting' ||
    edit.kind === 'wealth-control' ||
    edit.kind === 'wealth-transaction'
  ) {
    investigator = {
      ...state,
      wealth: applyCocWealthEdit(card, edit satisfies CocWealthEdit, { now, id }),
    };
  } else {
    investigator = {
      ...state,
      equipment: applyCocEquipmentEdit(card, edit satisfies CocEquipmentEdit, { now, id }),
    };
  }
  const checked = CocInvestigatorSchema.safeParse(investigator);
  if (!checked.success) throw new Error(checked.error.issues[0].message);
  return synchronizeCocInvestigator({ ...result, updatedAt: now, cocInvestigator: checked.data });
}
