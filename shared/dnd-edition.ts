import { z } from 'zod';

export const DndEditionSchema = z.enum(['2014', '2024'], { error: '仅支持 2014 / 2024 D&D 规则' });
export type DndEdition = z.infer<typeof DndEditionSchema>;

/** Cards and rooms saved before edition selection used the 2014 rules. */
export function getDndEdition(edition?: DndEdition): DndEdition {
  return edition ?? '2014';
}
