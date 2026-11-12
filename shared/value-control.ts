import { z } from 'zod';

const mode = z.enum(['auto', 'manual']);
export const NumberControlSchema = z.strictObject({
  mode,
  locked: z.boolean(),
  manual: z.number().finite().min(-1000000000000).max(1000000000000).nullable(),
});
export const TextControlSchema = z.strictObject({
  mode,
  locked: z.boolean(),
  manual: z.string().max(500).nullable(),
});
const lockEdit = z.strictObject({ kind: z.literal('lock'), locked: z.boolean() });
const modeEdit = z.strictObject({ kind: z.literal('mode'), mode });
export const NumberControlEditSchema = z.discriminatedUnion('kind', [
  lockEdit,
  modeEdit,
  z.strictObject({
    kind: z.literal('value'),
    value: z.number().finite().min(-1000000000000).max(1000000000000),
  }),
]);
export const TextControlEditSchema = z.discriminatedUnion('kind', [
  lockEdit,
  modeEdit,
  z.strictObject({ kind: z.literal('value'), value: z.string().max(500) }),
]);
export type NumberControl = z.infer<typeof NumberControlSchema>;
export type TextControl = z.infer<typeof TextControlSchema>;
export type ValueControl<T> = { mode: 'auto' | 'manual'; locked: boolean; manual: T | null };
export type ValueControlEdit<T> =
  | { kind: 'lock'; locked: boolean }
  | { kind: 'mode'; mode: 'auto' | 'manual' }
  | { kind: 'value'; value: T };

export function automaticControl<T>(): ValueControl<T> {
  return { mode: 'auto', locked: true, manual: null };
}

export function controlledValue<T>(control: ValueControl<T> | undefined, automatic: T): T {
  return control?.mode === 'manual' && control.manual !== null ? control.manual : automatic;
}

/** A lock protects human edits; automatic rule updates continue to use the source value. */
export function editValueControl<T>(
  control: ValueControl<T> | undefined,
  edit: ValueControlEdit<T>,
  automatic: T,
): ValueControl<T> {
  const current = control ?? automaticControl<T>();
  if (edit.kind === 'lock') return { ...current, locked: edit.locked };
  if (current.locked) throw new Error('请先解锁此数值');
  if (edit.kind === 'mode')
    return {
      ...current,
      mode: edit.mode,
      manual: edit.mode === 'manual' && current.manual === null ? automatic : current.manual,
    };
  if (current.mode !== 'manual') throw new Error('请先切换为手动模式');
  return { ...current, manual: edit.value };
}
