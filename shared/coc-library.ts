import { z } from 'zod';
import { CocSpellDefinitionSchema, CocTomeDefinitionSchema } from './coc-session';
import { CocWeaponProfileSchema, CocArmorProfileSchema } from './coc-equipment';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
export const MAX_COC_LIBRARY_BYTES = 1024 * 1024;

function libraryText(library: unknown, format: 'json' | 'md') {
  const json = JSON.stringify(library, null, 2);
  return format === 'json' ? `${json}\n` : `# CoC 备团资料\n\n\`\`\`json\n${json}\n\`\`\`\n`;
}

export const CocPreparationLibrarySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    type: z.literal('interlude-coc-preparation'),
    spells: z.array(CocSpellDefinitionSchema).max(80),
    tomes: z.array(CocTomeDefinitionSchema).max(80),
    weapons: z.array(z.strictObject({ id, profile: CocWeaponProfileSchema })).max(80),
    armor: z.array(z.strictObject({ id, profile: CocArmorProfileSchema })).max(80),
  })
  .superRefine((library, ctx) => {
    if (new TextEncoder().encode(libraryText(library, 'md')).byteLength > MAX_COC_LIBRARY_BYTES)
      ctx.addIssue({ code: 'custom', path: [], message: '备团资料不可超过 1 MiB' });
    for (const key of ['spells', 'tomes', 'weapons', 'armor'] as const)
      if (new Set(library[key].map((entry) => entry.id)).size !== library[key].length)
        ctx.addIssue({ code: 'custom', path: [key], message: '资料编号不可重复' });
    if (
      library.tomes.some((t) => t.spellIds.some((id) => !library.spells.some((s) => s.id === id)))
    )
      ctx.addIssue({
        code: 'custom',
        path: ['tomes'],
        message: '神话书引用了资料库中不存在的法术',
      });
  });
export type CocPreparationLibrary = z.infer<typeof CocPreparationLibrarySchema>;
export function emptyCocPreparationLibrary(): CocPreparationLibrary {
  return {
    schemaVersion: 1,
    type: 'interlude-coc-preparation',
    spells: [],
    tomes: [],
    weapons: [],
    armor: [],
  };
}
export function parseCocPreparationLibrary(text: string): CocPreparationLibrary {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_COC_LIBRARY_BYTES)
    throw new Error('备团资料不可超过 1 MiB');
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  let source = trimmed;
  if (!trimmed.startsWith('{')) {
    const blocks = [...trimmed.matchAll(/^(`{3,})json[ \t]*\r?\n([\s\S]*?)^\1[ \t]*$/gm)];
    if (blocks.length !== 1) throw new Error('请导入 JSON 或只含一个 JSON 数据块的 Markdown');
    source = blocks[0][2];
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('请导入 JSON 或包含 JSON 数据块的 Markdown');
  }
  const result = CocPreparationLibrarySchema.safeParse(value);
  if (!result.success) throw new Error(`备团资料格式无效：${result.error.issues[0].message}`);
  return result.data;
}
export function exportCocPreparationLibrary(library: CocPreparationLibrary, format: 'json' | 'md') {
  return libraryText(CocPreparationLibrarySchema.parse(library), format);
}
export function mergeCocPreparationLibrary(
  base: CocPreparationLibrary,
  incoming: CocPreparationLibrary,
): CocPreparationLibrary {
  const merge = <T extends { id: string }>(a: T[], b: T[]) => [
    ...new Map([...a, ...b].map((entry) => [entry.id, entry])).values(),
  ];
  return CocPreparationLibrarySchema.parse({
    ...base,
    spells: merge(base.spells, incoming.spells),
    tomes: merge(base.tomes, incoming.tomes),
    weapons: merge(base.weapons, incoming.weapons),
    armor: merge(base.armor, incoming.armor),
  });
}
