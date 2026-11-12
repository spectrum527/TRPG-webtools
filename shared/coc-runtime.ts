import { z } from 'zod';
import {
  CocBoutKindSchema,
  CocInsanityKindSchema,
  CocMythosSourceSchema,
  CocRoomRulesSchema,
  CocSessionValueFieldSchema,
  CocSpellDefinitionSchema,
  CocTomeDefinitionSchema,
  cocIdSchema,
  cocKeySchema,
  cocLossExpressionSchema,
  cocMinutesSchema,
  cocPercentSchema,
  cocReasonSchema,
  cocSessionValueMaximum,
  cocVisibilitySchema,
  type CocRoomRules,
} from './coc-session.ts';
import { NumberControlEditSchema } from './value-control.ts';
import { HpConfirmationSchema } from './injury.ts';
import { CocInvestigatorEditSchema } from './coc-investigator.ts';
import type { CheckResult, RoomEvent } from './types.ts';

const revision = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER - 1);
const diceEdge = z.enum(['normal', 'advantage', 'disadvantage']);
const confirmed = z.literal(true);
const visibility = cocVisibilitySchema.optional();
const boutChoice = z.strictObject({
  kind: CocBoutKindSchema,
  description: z.string().trim().max(500),
});

export const CocDifficultySchema = z.enum(['regular', 'hard', 'extreme']);
export type CocDifficulty = z.infer<typeof CocDifficultySchema>;

export const CocSessionEditSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('sanity-roll'),
    successLoss: cocLossExpressionSchema,
    failureLoss: cocLossExpressionSchema,
    reason: cocReasonSchema,
    source: CocMythosSourceSchema.optional(),
    visibility,
  }),
  z.strictObject({
    kind: z.literal('sanity-confirm'),
    pendingId: cocIdSchema,
    confirmed,
    automatic: z.boolean().optional(),
    bout: boutChoice.optional(),
  }),
  z.strictObject({ kind: z.literal('sanity-cancel'), pendingId: cocIdSchema }),
  z.strictObject({ kind: z.literal('sanity-reset-sources'), confirmed }),
  z.strictObject({
    kind: z.literal('session-value-lock'),
    field: CocSessionValueFieldSchema,
    locked: z.boolean(),
  }),
  z
    .strictObject({
      kind: z.literal('session-value-correct'),
      field: CocSessionValueFieldSchema,
      value: z.number().int().min(0).max(cocSessionValueMaximum('lostToday')),
      reason: cocReasonSchema,
      confirmed,
    })
    .refine(({ field, value }) => value <= cocSessionValueMaximum(field), '修正值超出范围'),
  z.strictObject({
    kind: z.literal('insanity-set'),
    state: CocInsanityKindSchema,
    reason: cocReasonSchema,
    bout: boutChoice.optional(),
    visibility,
  }),
  z.strictObject({
    kind: z.literal('insanity-stop'),
    scope: z.enum(['bout', 'insanity']),
    reason: cocReasonSchema,
    confirmed,
    visibility,
  }),
  z.strictObject({
    kind: z.literal('insanity-duration-control'),
    field: z.enum(['hours', 'rounds']),
    control: NumberControlEditSchema,
  }),
  z.strictObject({
    kind: z.literal('insanity-condition-add'),
    condition: z.enum(['phobia', 'mania']),
    description: cocReasonSchema,
  }),
  z.strictObject({ kind: z.literal('insanity-condition-remove'), conditionId: cocIdSchema }),
  z.strictObject({
    kind: z.literal('development-mark'),
    key: cocKeySchema,
    marked: z.boolean().nullable(),
  }),
  z.strictObject({ kind: z.literal('development-lock'), key: cocKeySchema, locked: z.boolean() }),
  z.strictObject({ kind: z.literal('development-roll'), label: cocReasonSchema, confirmed }),
  z.strictObject({
    kind: z.literal('mythos-gain'),
    points: cocPercentSchema.min(1).max(99),
    source: cocReasonSchema,
    confirmed,
  }),
  z.strictObject({ kind: z.literal('luck-recover'), confirmed }),
  z.strictObject({
    kind: z.literal('advance-time'),
    minutes: cocMinutesSchema.max(5256000),
    rounds: cocMinutesSchema.max(100000).optional(),
    recovery: z.enum(['natural', 'none']).optional(),
    healingEdge: diceEdge.optional(),
    reason: cocReasonSchema,
    confirmed,
  }),
  z.strictObject({
    kind: z.literal('sanity-treatment'),
    method: z.enum(['keeper', 'therapy-success', 'therapy-failure', 'therapy-fumble']),
    points: cocPercentSchema.optional(),
    reason: cocReasonSchema,
    confirmed,
  }),
  z.strictObject({ kind: z.literal('spell-save'), spell: CocSpellDefinitionSchema }),
  z.strictObject({
    kind: z.literal('spell-learn'),
    spellId: cocIdSchema,
    sourceTomeId: cocIdSchema.optional(),
    minutes: cocMinutesSchema.max(5256000).optional(),
    hardIntCheck: z.literal(true).optional(),
    confirmed,
  }),
  z.strictObject({ kind: z.literal('spell-remove'), spellId: cocIdSchema }),
  z.strictObject({
    kind: z.literal('spell-cast'),
    spellId: cocIdSchema,
    allowHpPayment: z.boolean().optional(),
    push: z.strictObject({ consequence: cocReasonSchema }).optional(),
    confirmed,
    visibility,
  }),
  z.strictObject({ kind: z.literal('tome-save'), tome: CocTomeDefinitionSchema }),
  z.strictObject({
    kind: z.literal('tome-study'),
    tomeId: cocIdSchema,
    minutes: cocMinutesSchema.min(1).max(5256000),
    confirmed,
    visibility,
  }),
  z.strictObject({ kind: z.literal('tome-remove'), tomeId: cocIdSchema }),
]);
export type CocSessionEdit = z.infer<typeof CocSessionEditSchema>;

const checkRequest = z.strictObject({
  kind: z.enum(['ability', 'skill']),
  key: cocKeySchema,
  edge: diceEdge,
});
const checkResult = z.strictObject({
  label: z.string().max(200),
  rolls: z.array(z.number().int().min(1).max(100)).min(1).max(2),
  selected: z.number().int().min(1).max(100),
  modifier: z.number().int().min(0).max(0),
  total: z.number().int().min(1).max(100),
  target: z.number().int().min(0).max(100000),
  outcome: z.string().max(200),
  success: z.boolean(),
});
const followup = { originalEventId: cocIdSchema, version: revision.min(1) };
export const CocCheckRecordSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('original'),
    characterId: cocIdSchema,
    request: checkRequest,
    difficulty: CocDifficultySchema,
    combat: z.boolean(),
    cycle: cocMinutesSchema,
  }),
  z.strictObject({
    kind: z.literal('luck'),
    ...followup,
    points: cocPercentSchema.min(1),
    result: checkResult,
  }),
  z.strictObject({
    kind: z.literal('push-request'),
    ...followup,
    reason: cocReasonSchema,
    consequence: cocReasonSchema,
  }),
  z.strictObject({
    kind: z.literal('push-decision'),
    ...followup,
    allowed: z.boolean(),
    consequence: cocReasonSchema.optional(),
  }),
  z.strictObject({ kind: z.literal('pushed'), ...followup, result: checkResult }),
]);
export type CocCheckRecord = z.infer<typeof CocCheckRecordSchema>;
export type CocCheckOriginal = Extract<CocCheckRecord, { kind: 'original' }>;
export type CocCheckFollowup = Exclude<CocCheckRecord, CocCheckOriginal>;

export const CocCheckFollowupEditSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('spend-luck'), points: cocPercentSchema.min(1) }),
  z.strictObject({
    kind: z.literal('request-push'),
    reason: cocReasonSchema,
    consequence: cocReasonSchema,
  }),
  z.strictObject({
    kind: z.literal('decide-push'),
    allowed: z.boolean(),
    consequence: cocReasonSchema.optional(),
  }),
  z.strictObject({ kind: z.literal('push') }),
]);
export type CocCheckFollowupEdit = z.infer<typeof CocCheckFollowupEditSchema>;

export const CocRulesActionSchema = z.strictObject({
  type: z.literal('coc-rules'),
  rules: CocRoomRulesSchema,
  expectedRevision: revision,
  requestId: cocIdSchema,
});
export const CocCharacterActionSchema = z.strictObject({
  type: z.literal('character-coc'),
  memberId: cocIdSchema,
  characterId: cocIdSchema,
  expectedCharacterRevision: revision,
  requestId: cocIdSchema,
  edit: z.union([CocSessionEditSchema, CocInvestigatorEditSchema]),
  hpConfirmation: HpConfirmationSchema.optional(),
});
export const CocCheckFollowupActionSchema = z.strictObject({
  type: z.literal('coc-check-followup'),
  eventId: cocIdSchema,
  expectedVersion: revision,
  expectedCharacterRevision: revision,
  requestId: cocIdSchema,
  edit: CocCheckFollowupEditSchema,
});
export const CocRuntimeActionSchemas = [
  CocRulesActionSchema,
  CocCharacterActionSchema,
  CocCheckFollowupActionSchema,
] as const;
export type CocRuntimeAction = z.infer<(typeof CocRuntimeActionSchemas)[number]>;

export function cocCheckStatus(log: readonly RoomEvent[], eventId: string) {
  const original = log.find((event) => event.id === eventId && event.cocCheck?.kind === 'original');
  const record = original?.cocCheck;
  if (!original || record?.kind !== 'original' || !original.check) return null;
  const followups = log.flatMap((event) => {
    const followup = event.cocCheck;
    return followup && followup.kind !== 'original' && followup.originalEventId === eventId
      ? [followup]
      : [];
  });
  return {
    original,
    record,
    version: followups.at(-1)?.version ?? 0,
    luck: followups.find((entry) => entry.kind === 'luck'),
    request: followups.find((entry) => entry.kind === 'push-request'),
    decision: followups.find((entry) => entry.kind === 'push-decision'),
    pushed: followups.find((entry) => entry.kind === 'pushed'),
  };
}

const levels = ['大失败', '失败', '普通成功', '困难成功', '极难成功', '大成功'];
const difficulties = { regular: 2, hard: 3, extreme: 4 };

export function cocRangedDifficulty(
  { range, longerRanges }: { range: number; longerRanges: { range: number }[] },
  distance: number | undefined,
  requested: CocDifficulty = 'regular',
) {
  if (distance === undefined || distance <= range)
    return { difficulty: requested, veryLong: false };
  const hardRange = longerRanges[0]?.range ?? range * 2;
  const maxRange = longerRanges.at(-1)?.range ?? range * 4;
  if (distance > maxRange) throw new Error('已超出这件武器的最远射程');
  const minimum = distance <= hardRange ? 'hard' : 'extreme';
  return {
    difficulty: difficulties[requested] > difficulties[minimum] ? requested : minimum,
    veryLong: minimum === 'extreme',
  };
}

function cocResultLevel(total: number, target: number) {
  if (total >= (target < 50 ? 96 : 100)) return 0;
  if (total === 1) return 5;
  if (total <= Math.floor(target / 5)) return 4;
  if (total <= Math.floor(target / 2)) return 3;
  return total <= target ? 2 : 1;
}

export function cocResultAtDifficulty(result: CheckResult, difficulty: CocDifficulty): CheckResult {
  const level = cocResultLevel(result.total, result.target);
  return { ...result, outcome: levels[level], success: level >= difficulties[difficulty] };
}

export function cocLuckResult(
  result: CheckResult,
  difficulty: CocDifficulty,
  points: number,
): CheckResult {
  const total = result.total - points;
  if (!Number.isInteger(points) || points < 1 || total < 2 || result.outcome === '大失败')
    throw new Error('幸运不能改变大失败，也不能制造大成功');
  const next = cocResultAtDifficulty({ ...result, total }, difficulty);
  if (
    !next.success ||
    cocResultLevel(total, result.target) <= cocResultLevel(result.total, result.target)
  )
    throw new Error('请消耗足够的幸运以满足要求或提升成功等级');
  return next;
}

export function cocLuckOptions(
  result: CheckResult,
  difficulty: CocDifficulty,
  currentLuck: number,
) {
  if (result.outcome === '大失败' || result.outcome === '大成功') return [];
  const thresholds = [result.target, Math.floor(result.target / 2), Math.floor(result.target / 5)];
  const options: { points: number; outcome: string }[] = [];
  for (const threshold of new Set(thresholds)) {
    const points = result.total - threshold;
    if (threshold < 2 || points < 1 || points > currentLuck) continue;
    const next = cocResultAtDifficulty({ ...result, total: threshold }, difficulty);
    if (next.success) options.push({ points, outcome: next.outcome });
  }
  return options;
}

type CocCheckStatus = NonNullable<ReturnType<typeof cocCheckStatus>>;

export function cocCheckEligibility(status: CocCheckStatus, rules: CocRoomRules) {
  const available = !status.luck && !status.pushed;
  const push =
    available && rules.allowPushedRolls && !status.record.combat && !status.original.check!.success;
  return {
    canSpendLuck:
      available &&
      rules.allowLuckSpending &&
      (!status.request || status.decision?.allowed === false) &&
      cocLuckOptions(status.original.check!, status.record.difficulty, 100).length > 0,
    canRequestPush: push && !status.request,
    canDecidePush: push && !!status.request && !status.decision,
    canPush: push && !!status.decision?.allowed,
  };
}

function sameCheck(a: CheckResult, b: CheckResult) {
  return (
    a.label === b.label &&
    a.target === b.target &&
    a.total === b.total &&
    a.selected === b.selected &&
    a.modifier === b.modifier &&
    a.success === b.success &&
    a.outcome === b.outcome &&
    a.rolls.length === b.rolls.length &&
    a.rolls.every((value, index) => value === b.rolls[index])
  );
}

function validOriginalResult(result: CheckResult, record: CocCheckOriginal) {
  const { edge } = record.request;
  const selected =
    edge === 'normal'
      ? result.rolls[0]
      : edge === 'advantage'
        ? Math.min(...result.rolls)
        : Math.max(...result.rolls);
  return (
    checkResult.safeParse(result).success &&
    result.rolls.length === (edge === 'normal' ? 1 : 2) &&
    selected === result.selected &&
    result.total === result.selected &&
    sameCheck(result, cocResultAtDifficulty(result, record.difficulty))
  );
}

export function validCocCheckHistory(log: readonly RoomEvent[]) {
  const checks = new Map<string, CocCheckStatus>();
  const rules = {
    allowLuckSpending: true,
    allowPushedRolls: true,
    autoSanity: true,
    autoDevelopment: true,
  };
  for (const event of log) {
    const record = event.cocCheck;
    if (!record) continue;
    if (record.kind === 'original') {
      if (
        event.type !== 'check' ||
        !event.memberId ||
        !event.check ||
        event.visibility !== 'public' ||
        record.request.key === 'luck' ||
        !validOriginalResult(event.check, record) ||
        checks.has(event.id)
      )
        return false;
      checks.set(event.id, {
        original: event,
        record,
        version: 0,
        luck: undefined,
        request: undefined,
        decision: undefined,
        pushed: undefined,
      });
      continue;
    }
    const status = checks.get(record.originalEventId);
    if (
      !status ||
      record.version !== status.version + 1 ||
      event.type !== 'system' ||
      !event.combatRequestHash ||
      event.visibility !== status.original.visibility ||
      !event.memberId ||
      (record.kind !== 'push-decision' && event.memberId !== status.original.memberId)
    )
      return false;
    const eligible = cocCheckEligibility(status, rules);
    if (record.kind === 'luck') {
      if (!eligible.canSpendLuck) return false;
      try {
        if (
          !sameCheck(
            record.result,
            cocLuckResult(status.original.check!, status.record.difficulty, record.points),
          )
        )
          return false;
      } catch {
        return false;
      }
      status.luck = record;
    } else if (record.kind === 'push-request') {
      if (!eligible.canRequestPush) return false;
      status.request = record;
    } else if (record.kind === 'push-decision') {
      if (!eligible.canDecidePush) return false;
      status.decision = record;
    } else {
      if (
        !eligible.canPush ||
        record.result.target !== status.original.check!.target ||
        !validOriginalResult(record.result, status.record)
      )
        return false;
      status.pushed = record;
    }
    status.version = record.version;
  }
  return true;
}
