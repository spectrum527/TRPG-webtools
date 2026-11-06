import { z } from 'zod';
import { DndStatBlockSchema } from './dnd';
import { DndEditionSchema, getDndEdition, type DndEdition } from './dnd-edition';
import { KeeperCardSchema } from './keeper';
import { parsePortable, portableMarkdown } from './portable';
import type { RuleId } from './types';

export const MAX_ENCOUNTER_PLANS = 40;
export const MAX_ENCOUNTER_PLAN_BYTES = 8 * 1024 * 1024;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const name = z.string().trim().min(1).max(120);
const encounterRevision = z.number().int().min(0).max(1000000000);
const planRevision = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER - 1);

const PlanEntrySchema = z.strictObject({
  id,
  card: z.union([DndStatBlockSchema, KeeperCardSchema]),
  count: z.number().int().min(1).max(20),
});
const PlanWaveSchema = z
  .strictObject({ id, name, entries: z.array(PlanEntrySchema).min(1).max(20) })
  .refine(
    (wave) => new Set(wave.entries.map((entry) => entry.id)).size === wave.entries.length,
    '波次内资料编号重复',
  )
  .refine(
    (wave) => wave.entries.reduce((count, entry) => count + entry.count, 0) <= 60,
    '每个波次最多 60 个参战者',
  );

export const EncounterPlanSchema = z
  .strictObject({
    documentType: z.literal('encounter-plan'),
    schemaVersion: z.literal(1),
    id,
    name,
    rule: z.enum(['dnd', 'coc']),
    dndEdition: DndEditionSchema.optional(),
    scene: z.strictObject({ atlasId: id, sceneId: id }).optional(),
    waves: z.array(PlanWaveSchema).min(1).max(20),
    loot: z.string().max(8000),
    notes: z.string().max(16000),
  })
  .superRefine((plan, context) => {
    if (plan.rule === 'coc' && plan.dndEdition !== undefined)
      context.addIssue({ code: 'custom', message: '规则版次仅适用于 D&D' });
    if (new Set(plan.waves.map((wave) => wave.id)).size !== plan.waves.length)
      context.addIssue({ code: 'custom', message: '波次编号重复' });
    for (const [index, wave] of plan.waves.entries()) {
      if (
        wave.entries.some(
          ({ card }) =>
            card.rule !== plan.rule ||
            (card.rule === 'dnd' &&
              getDndEdition(card.dndEdition) !== getDndEdition(plan.dndEdition)),
        )
      )
        context.addIssue({
          code: 'custom',
          path: ['waves', index],
          message: '资料快照与预案规则或版次不符',
        });
    }
  });
export type EncounterPlan = z.infer<typeof EncounterPlanSchema>;

export const EncounterPlanLibrarySchema = z
  .array(EncounterPlanSchema)
  .max(MAX_ENCOUNTER_PLANS)
  .refine(
    (plans) => new Set(plans.map((plan) => plan.id)).size === plans.length,
    '遭遇预案编号重复',
  )
  .refine(
    (plans) =>
      new TextEncoder().encode(JSON.stringify(plans)).byteLength <= MAX_ENCOUNTER_PLAN_BYTES - 2048,
    '遭遇预案合计不能超过 8 MiB',
  );
const EncounterPlanCollectionSchema = z.strictObject({
  documentType: z.literal('encounter-plan-collection'),
  schemaVersion: z.literal(1),
  plans: EncounterPlanLibrarySchema.min(1),
});

export function parseEncounterPlans(text: string): EncounterPlan[] {
  const raw = parsePortable(text, 2 * MAX_ENCOUNTER_PLAN_BYTES);
  const single = EncounterPlanSchema.safeParse(raw);
  if (single.success) {
    const library = EncounterPlanLibrarySchema.safeParse([single.data]);
    if (library.success) return library.data;
    throw new Error('遭遇预案超过容量上限，请拆分波次或资料。');
  }
  const collection = EncounterPlanCollectionSchema.safeParse(raw);
  if (!collection.success) throw new Error('遭遇预案格式无效，请核对版次、波次和参战资料。');
  return collection.data.plans;
}

export function exportEncounterPlans(plans: EncounterPlan[], format: 'json' | 'md'): string {
  const collection = EncounterPlanCollectionSchema.parse({
    documentType: 'encounter-plan-collection',
    schemaVersion: 1,
    plans,
  });
  if (format === 'json') return JSON.stringify(collection);
  const title = '幕间 · 遭遇预案';
  const note = '包含主持人备团资料、波次、战利品与私密笔记。';
  const formatted = portableMarkdown(title, collection, note, 1);
  return new TextEncoder().encode(formatted).byteLength <= 2 * MAX_ENCOUNTER_PLAN_BYTES
    ? formatted
    : portableMarkdown(title, collection, note, 0);
}

export function validateEncounterPlanForRoom(
  plan: EncounterPlan,
  rule: RuleId,
  edition?: DndEdition,
): boolean {
  return (
    plan.rule === rule &&
    (rule !== 'dnd' || getDndEdition(plan.dndEdition) === getDndEdition(edition))
  );
}

export const PreparationActionSchemas = [
  z.strictObject({
    type: z.literal('encounter-plan-save'),
    plans: EncounterPlanLibrarySchema.min(1),
    expectedRevision: planRevision,
  }),
  z.strictObject({
    type: z.literal('encounter-plan-delete'),
    planId: id,
    expectedRevision: planRevision,
  }),
  z.strictObject({
    type: z.literal('encounter-plan-load'),
    planId: id,
    waveId: id,
    expectedRevision: encounterRevision,
    expectedPlanRevision: planRevision,
    requestId: id,
    repeat: z.boolean().optional(),
    publishScene: z.boolean().optional(),
  }),
] as const;
export type PreparationAction = z.infer<(typeof PreparationActionSchemas)[number]>;
