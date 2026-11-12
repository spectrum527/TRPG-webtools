import { z } from 'zod';
import { rollDice } from './dice.ts';
import type { Character } from './types.ts';
import { NumberControlSchema, controlledValue } from './value-control.ts';

export const CocRoomRulesSchema = z.strictObject({
  allowLuckSpending: z.boolean(),
  allowPushedRolls: z.boolean(),
  autoSanity: z.boolean(),
  autoDevelopment: z.boolean(),
});
export type CocRoomRules = z.infer<typeof CocRoomRulesSchema>;

export function cocRoomRules(rules?: CocRoomRules): CocRoomRules {
  return (
    rules ?? {
      allowLuckSpending: false,
      allowPushedRolls: false,
      autoSanity: true,
      autoDevelopment: true,
    }
  );
}

export const cocIdSchema = z.string().min(1).max(100);
export const cocKeySchema = z.string().regex(/^[a-z][a-zA-Z0-9]{0,39}$/);
export const cocReasonSchema = z.string().trim().min(1).max(300);
export const cocVisibilitySchema = z.enum(['public', 'host']);
export const cocMinutesSchema = z.number().int().min(0).max(1000000000);
export const cocPercentSchema = z.number().int().min(0).max(100);
export const CocSessionValueFieldSchema = z.enum(['luck', 'dayStartSan', 'lostToday']);
export type CocSessionValueField = z.infer<typeof CocSessionValueFieldSchema>;
export function cocLossDefinition(expression: string) {
  const definition = rollDice(expression, () => 1);
  const minimum = definition.groups.reduce(
    (sum, { sign, count, sides }) => sum + sign * count * (sign === 1 ? 1 : sides),
    definition.modifier,
  );
  const maximum = definition.groups.reduce(
    (sum, { sign, count, sides }) => sum + sign * count * (sign === 1 ? sides : 1),
    definition.modifier,
  );
  if (minimum < 0 || maximum > 9999) throw new Error('理智损失的可能结果须在 0–9999 之间');
  return { definition, maximum };
}
export const cocLossExpressionSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((expression) => {
    try {
      cocLossDefinition(expression);
      return true;
    } catch {
      return false;
    }
  }, '理智损失须为有效骰式，可能结果在 0–9999 之间');
const rollNumber = z.number().int().min(1).max(100);
const skillValue = z.number().int().min(0).max(1000);
const text = z.string().trim().max(500);

export const COC_BOUTS = [
  { key: 'amnesia', label: '失忆' },
  { key: 'disability', label: '心因性障碍' },
  { key: 'violence', label: '暴力冲动' },
  { key: 'paranoia', label: '偏执' },
  { key: 'significant-person', label: '认错重要之人' },
  { key: 'faint', label: '昏厥' },
  { key: 'flee', label: '恐慌逃离' },
  { key: 'outburst', label: '情绪失控' },
  { key: 'phobia', label: '恐惧症' },
  { key: 'mania', label: '躁狂' },
] as const;
export const CocBoutKindSchema = z.enum(COC_BOUTS.map(({ key }) => key));
export const CocInsanityKindSchema = z.enum(['temporary', 'indefinite', 'permanent']);

export const CocMythosSourceSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  limit: cocPercentSchema,
});
const pendingSanitySchema = z.strictObject({
  id: cocIdSchema,
  reason: cocReasonSchema,
  visibility: cocVisibilitySchema,
  successLoss: cocLossExpressionSchema,
  failureLoss: cocLossExpressionSchema,
  san: cocPercentSchema,
  roll: rollNumber,
  success: z.boolean(),
  loss: cocPercentSchema,
  dice: z.array(z.number().int().min(1).max(1000)).max(100),
  source: CocMythosSourceSchema.optional(),
});
const boutSchema = z.strictObject({
  kind: CocBoutKindSchema,
  startedRound: cocMinutesSchema,
  rounds: z.number().int().min(1).max(1000),
  roundsControl: NumberControlSchema.optional(),
  description: text,
  roll: z.number().int().min(1).max(10).optional(),
});
const insanitySchema = z.strictObject({
  kind: CocInsanityKindSchema,
  reason: cocReasonSchema,
  visibility: cocVisibilitySchema.optional(),
  startedMinute: cocMinutesSchema,
  hours: z.number().int().min(1).max(1000).optional(),
  hoursControl: NumberControlSchema.optional(),
  bout: boutSchema.optional(),
});
const conditionSchema = z.strictObject({
  id: cocIdSchema,
  kind: z.enum(['phobia', 'mania']),
  description: cocReasonSchema,
  visibility: cocVisibilitySchema.optional(),
});

export const CocSpellDefinitionSchema = z.strictObject({
  id: cocIdSchema,
  name: z.string().trim().min(1).max(120),
  description: text,
  source: z.string().trim().max(150),
  cost: z.strictObject({
    mp: z.number().int().min(0).max(9999),
    san: cocLossExpressionSchema,
    hp: z.number().int().min(0).max(9999),
    minutes: cocMinutesSchema.max(525600),
    rounds: z.number().int().min(0).max(1000),
  }),
});
const castAttemptSchema = z.strictObject({
  roll: rollNumber,
  target: cocPercentSchema,
  success: z.boolean(),
  at: z.iso.datetime(),
  visibility: cocVisibilitySchema.optional(),
});
const spellSchema = CocSpellDefinitionSchema.extend({
  learned: z.boolean(),
  casting: z.enum(['untested', 'failed', 'mastered']),
  firstAttempt: castAttemptSchema.optional(),
  pushedAttempt: castAttemptSchema.optional(),
  learnedAt: z.iso.datetime().optional(),
});
export type CocSpellDefinition = z.infer<typeof CocSpellDefinitionSchema>;
export type CocSpell = z.infer<typeof spellSchema>;

export const COC_SPELL_PRESETS: readonly CocSpellDefinition[] = [
  {
    id: 'quickstart-flesh-ward',
    name: '肉体防护',
    description: '以投入的魔法点换取临时防护。实际投入和护甲效果由主持人裁定。',
    source: 'Chaosium 快速入门规则《鬼屋》法术条目',
    cost: { mp: 1, san: '0', hp: 0, minutes: 0, rounds: 5 },
  },
  {
    id: 'quickstart-dominate-corbitt',
    name: '支配术（柯比特变体）',
    description: '尝试用意志控制一名目标。《鬼屋》NPC 的法术模板，调查员代价由主持人确认。',
    source: 'Chaosium 快速入门规则《鬼屋》NPC 法术条目',
    cost: { mp: 1, san: '0', hp: 0, minutes: 0, rounds: 1 },
  },
];

export const CocTomeDefinitionSchema = z.strictObject({
  id: cocIdSchema,
  name: z.string().trim().min(1).max(120),
  description: text,
  initialMinutes: cocMinutesSchema.min(1).max(525600),
  fullMinutes: cocMinutesSchema.min(1).max(5256000),
  initialMythos: cocPercentSchema.max(99),
  fullMythos: cocPercentSchema.max(99),
  sanLoss: cocLossExpressionSchema,
  spellIds: z.array(cocIdSchema).max(30),
});
const tomeSchema = CocTomeDefinitionSchema.extend({
  progressMinutes: cocMinutesSchema,
  initialComplete: z.boolean(),
  fullComplete: z.boolean(),
});
export type CocTomeDefinition = z.infer<typeof CocTomeDefinitionSchema>;
export type CocTome = z.infer<typeof tomeSchema>;

const developmentMarkSchema = z.strictObject({
  key: cocKeySchema,
  mode: z.enum(['auto', 'manual']),
  locked: z.boolean(),
  manual: z.boolean().nullable(),
  eventIds: z.array(cocIdSchema).max(200),
});
const developmentResultSchema = z.strictObject({
  key: cocKeySchema,
  value: skillValue,
  roll: rollNumber,
  gain: z.number().int().min(0).max(10),
  sanityGain: z.number().int().min(0).max(12).optional(),
});
const developmentBatchSchema = z.strictObject({
  id: cocIdSchema,
  label: cocReasonSchema,
  createdAt: z.iso.datetime(),
  results: z.array(developmentResultSchema).min(1).max(160),
});

const historyEntrySchema = z.strictObject({
  id: cocIdSchema,
  kind: z.enum([
    'sanity',
    'insanity',
    'development',
    'luck',
    'mythos',
    'time',
    'treatment',
    'spell',
    'tome',
  ]),
  at: z.iso.datetime(),
  summary: z.string().max(1500),
  visibility: cocVisibilitySchema,
});

export const CocSessionSchema = z
  .strictObject({
    gameMinutes: cocMinutesSchema,
    gameRound: cocMinutesSchema,
    luck: cocPercentSchema.optional(),
    valueLocks: z.partialRecord(CocSessionValueFieldSchema, z.boolean()).optional(),
    sanity: z.strictObject({
      day: cocMinutesSchema.min(1),
      dayStartSan: cocPercentSchema,
      lostToday: cocMinutesSchema,
      insanity: insanitySchema.nullable(),
      conditions: z.array(conditionSchema).max(100),
      sources: z.array(CocMythosSourceSchema.extend({ loss: cocPercentSchema })).max(100),
      pending: pendingSanitySchema.optional(),
      firstMythosInsanity: z.boolean(),
      lastTherapyMinute: cocMinutesSchema.optional(),
    }),
    recovery: z.strictObject({
      mpMinutes: z.number().int().min(0).max(59),
      hpMinutes: z.number().int().min(0).max(10079),
      majorWound: z.boolean(),
    }),
    development: z.strictObject({
      marks: z.array(developmentMarkSchema).max(160),
      batches: z.array(developmentBatchSchema).max(30),
      cycle: cocMinutesSchema,
      mastered: z.array(cocKeySchema).max(160),
    }),
    spells: z.array(spellSchema).max(80),
    tomes: z.array(tomeSchema).max(80),
    history: z.array(historyEntrySchema).max(250),
  })
  .superRefine((session, ctx) => {
    const unique = (values: string[], path: string[]) => {
      if (new Set(values).size !== values.length)
        ctx.addIssue({ code: 'custom', path, message: '记录编号不能重复' });
    };
    unique(
      session.spells.map(({ id }) => id),
      ['spells'],
    );
    unique(
      session.tomes.map(({ id }) => id),
      ['tomes'],
    );
    unique(
      session.sanity.conditions.map(({ id }) => id),
      ['sanity', 'conditions'],
    );
    unique(
      session.sanity.sources.map(({ name }) => name.toLowerCase()),
      ['sanity', 'sources'],
    );
    unique(
      session.development.marks.map(({ key }) => key),
      ['development', 'marks'],
    );
    unique(session.development.mastered, ['development', 'mastered']);
    unique(
      session.development.batches.map(({ id }) => id),
      ['development', 'batches'],
    );
    unique(
      session.history.map(({ id }) => id),
      ['history'],
    );
    const insanity = session.sanity.insanity;
    if (insanity) {
      const invalidHours = (insanity.kind === 'temporary') !== (insanity.hours !== undefined);
      if (
        invalidHours ||
        insanity.startedMinute > session.gameMinutes ||
        (insanity.bout && insanity.bout.startedRound > session.gameRound)
      )
        ctx.addIssue({
          code: 'custom',
          path: ['sanity', 'insanity'],
          message: '疯狂开始时间或持续时间无效',
        });
    }
    const pending = session.sanity.pending;
    if (pending && (pending.success !== pending.roll <= pending.san || pending.loss > pending.san))
      ctx.addIssue({ code: 'custom', path: ['sanity', 'pending'], message: '待结算理智结果无效' });
    for (const tome of session.tomes) {
      if (
        tome.progressMinutes > tome.initialMinutes + tome.fullMinutes ||
        tome.initialComplete !== tome.progressMinutes >= tome.initialMinutes ||
        tome.fullComplete !== tome.progressMinutes >= tome.initialMinutes + tome.fullMinutes ||
        tome.spellIds.some((id) => !session.spells.some((spell) => spell.id === id))
      )
        ctx.addIssue({ code: 'custom', path: ['tomes'], message: '神话书阅读进度或法术引用无效' });
    }
    for (const spell of session.spells) {
      if (
        (!spell.learned &&
          (spell.casting !== 'untested' || spell.firstAttempt || spell.learnedAt)) ||
        (spell.pushedAttempt &&
          (spell.firstAttempt?.success !== false || spell.casting !== 'mastered')) ||
        (spell.firstAttempt && spell.casting === 'untested')
      )
        ctx.addIssue({ code: 'custom', path: ['spells'], message: '首次施法记录与学习状态不符' });
    }
  });

export type CocSession = z.infer<typeof CocSessionSchema>;
export type CocSanity = CocSession['sanity'];
export type CocInsanity = NonNullable<CocSanity['insanity']>;
export type CocHistoryEntry = CocSession['history'][number];
export type CocPendingSanity = NonNullable<CocSanity['pending']>;

export function emptyCocSession(card: Pick<Character, 'san'>): CocSession {
  return {
    gameMinutes: 0,
    gameRound: 0,
    sanity: {
      day: 1,
      dayStartSan: card.san,
      lostToday: 0,
      insanity: null,
      conditions: [],
      sources: [],
      firstMythosInsanity: false,
    },
    recovery: { mpMinutes: 0, hpMinutes: 0, majorWound: false },
    development: { marks: [], batches: [], cycle: 0, mastered: [] },
    spells: [],
    tomes: [],
    history: [],
  };
}

export function cocCurrentLuck(card: Pick<Character, 'cocSession' | 'attributes'>): number {
  return card.cocSession?.luck ?? card.attributes.luck ?? 0;
}

export function cocSessionValueLocked(
  session: CocSession | undefined,
  field: CocSessionValueField,
) {
  return session?.valueLocks?.[field] ?? true;
}

export function cocSessionValueMaximum(field: CocSessionValueField) {
  return field === 'lostToday' ? 9999 : 100;
}

export function cocInsanityHours(insanity: CocInsanity) {
  return controlledValue(insanity.hoursControl, insanity.hours ?? 0);
}

export function cocBoutRounds(bout: NonNullable<CocInsanity['bout']>) {
  return controlledValue(bout.roundsControl, bout.rounds);
}

export function cocDevelopmentMarked(mark: CocSession['development']['marks'][number]) {
  return mark.mode === 'manual' && mark.manual !== null ? mark.manual : mark.eventIds.length > 0;
}
