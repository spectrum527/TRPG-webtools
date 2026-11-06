import { z } from 'zod';
import { DndEditionSchema } from './dnd-edition';
import { parsePortable } from './portable';

/** The source paths refer to the supplied processed rules library, never to a local absolute path. */
const SourceSchema = z.strictObject({
  id: z.string().min(1).max(100),
  book: z.string().min(1).max(200),
  path: z
    .string()
    .min(1)
    .max(1000)
    .refine(
      (path) =>
        !path.startsWith('/') &&
        !path.startsWith('\\') &&
        !/^[A-Za-z]:/.test(path) &&
        !path.split(/[\\/]/).includes('..'),
      '来源路径应为相对路径',
    ),
  authority: z.string().min(1).max(100),
  category: z.enum(['core', 'expansion', 'playtest', 'third-party', 'other']),
  locator: z.string().max(1000).nullable(),
});

const nullableText = (max: number) => z.string().max(max).nullable();
const common = {
  id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  edition: DndEditionSchema,
  nameZh: nullableText(300),
  nameEn: nullableText(300),
  source: SourceSchema,
  rawText: z.string().min(1).max(100000),
  reviewStatus: nullableText(2000),
};

export const DndSpellReferenceSchema = z.strictObject({
  ...common,
  kind: z.literal('spell'),
  level: z.number().int().min(0).max(9).nullable(),
  school: nullableText(100),
  classes: z.array(z.string().max(100)).max(100).nullable(),
  castingTime: nullableText(2000),
  range: nullableText(2000),
  components: nullableText(4000),
  duration: nullableText(2000),
  concentration: z.boolean().nullable(),
  ritual: z.boolean().nullable(),
});

export const DndFeatReferenceSchema = z.strictObject({
  ...common,
  kind: z.literal('feat'),
  featType: nullableText(200),
  prerequisites: nullableText(4000),
});

export const DndReferenceEntrySchema = z
  .discriminatedUnion('kind', [DndSpellReferenceSchema, DndFeatReferenceSchema])
  .refine((entry) => Boolean(entry.nameZh?.trim() || entry.nameEn?.trim()), '条目缺少名称');

export type DndSpellReference = z.infer<typeof DndSpellReferenceSchema>;
export type DndFeatReference = z.infer<typeof DndFeatReferenceSchema>;
export type DndReferenceEntry = z.infer<typeof DndReferenceEntrySchema>;
export type DndReferenceSource = z.infer<typeof SourceSchema>;
export const MAX_DND_REFERENCES = 1500;
export const MAX_DND_REFERENCE_BYTES = 8 * 1024 * 1024;

/** Reject non-JSON structures before Zod touches a getter or silently strips a dangerous key. */
function assertSafeStructure(value: unknown): void {
  const queue: Array<{ value: unknown; depth: number; ancestors: ReadonlySet<object> }> = [
    { value, depth: 0, ancestors: new Set() },
  ];
  let visited = 0;
  try {
    while (queue.length) {
      const current = queue.pop()!;
      if (++visited > 150_000 || current.depth > 12) throw new Error();
      if (typeof current.value !== 'object' || current.value === null) continue;
      if (current.ancestors.has(current.value)) throw new Error();
      const prototype = Object.getPrototypeOf(current.value);
      if (!Array.isArray(current.value) && prototype !== Object.prototype && prototype !== null)
        throw new Error();
      const descriptors = Object.getOwnPropertyDescriptors(current.value);
      const entries = Object.entries(descriptors);
      if (Array.isArray(current.value) && descriptors.length?.value > MAX_DND_REFERENCES)
        throw new Error();
      if (
        entries.length > MAX_DND_REFERENCES + 1 ||
        Object.getOwnPropertySymbols(current.value).length
      )
        throw new Error();
      const ancestors = new Set([...current.ancestors, current.value]);
      for (const [key, descriptor] of entries) {
        if (Array.isArray(current.value) && key === 'length') continue;
        if (
          ['__proto__', 'constructor', 'prototype'].includes(key) ||
          !('value' in descriptor) ||
          !descriptor.enumerable ||
          (Array.isArray(current.value) && !/^(0|[1-9]\d*)$/.test(key))
        )
          throw new Error();
        queue.push({ value: descriptor.value, depth: current.depth + 1, ancestors });
      }
    }
  } catch {
    throw new Error('资料格式无效，含不允许的键名或过大的嵌套结构。');
  }
}

function validateUnique(entries: readonly DndReferenceEntry[]) {
  return new Set(entries.map((entry) => entry.id)).size === entries.length;
}

export const DndReferencePackSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    edition: DndEditionSchema,
    spells: z.array(DndSpellReferenceSchema).max(MAX_DND_REFERENCES),
    feats: z.array(DndFeatReferenceSchema).max(MAX_DND_REFERENCES),
  })
  .superRefine((pack, context) => {
    const entries = [...pack.spells, ...pack.feats];
    if (entries.length > MAX_DND_REFERENCES)
      context.addIssue({ code: 'custom', message: '资料条目过多' });
    if (entries.some((entry) => entry.edition !== pack.edition))
      context.addIssue({ code: 'custom', message: '资料包含其他版本的条目' });
    if (!validateUnique(entries)) context.addIssue({ code: 'custom', message: '资料包含重复编号' });
    if (entries.some((entry) => !entry.nameZh?.trim() && !entry.nameEn?.trim()))
      context.addIssue({ code: 'custom', message: '资料包含没有名称的条目' });
  });
export type DndReferencePack = z.infer<typeof DndReferencePackSchema>;

export function parseDndReferencePack(value: unknown): DndReferencePack {
  assertSafeStructure(value);
  const parsed = DndReferencePackSchema.safeParse(value);
  if (!parsed.success) throw new Error('D&D 规则资料格式无效，请检查资料版本或刷新页面。');
  return parsed.data;
}

const CollectionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    documentType: z.literal('dnd-reference-collection'),
    entries: z.array(DndReferenceEntrySchema).max(MAX_DND_REFERENCES),
  })
  .refine((collection) => validateUnique(collection.entries), '清单包含重复编号');

/** Validate and copy snapshots before writing or exporting them. */
export function validateDndReferences(value: unknown): DndReferenceEntry[] {
  assertSafeStructure(value);
  const parsed = CollectionSchema.safeParse({
    schemaVersion: 1,
    documentType: 'dnd-reference-collection',
    entries: value,
  });
  if (!parsed.success) throw new Error('法术与专长清单格式无效，或包含重复编号。');
  const size = new TextEncoder().encode(JSON.stringify(parsed.data)).byteLength;
  if (size > MAX_DND_REFERENCE_BYTES) throw new Error('法术与专长清单不能超过 8 MiB。');
  return parsed.data.entries;
}

/** Import JSON or the JSON block in a Markdown export. Imported entries remain snapshots. */
export function parseDndReferenceCollection(text: string): DndReferenceEntry[] {
  if (typeof text !== 'string' || text.length > MAX_DND_REFERENCE_BYTES * 2)
    throw new Error('法术与专长文件过大或格式无效。');
  const value = parsePortable(text, MAX_DND_REFERENCE_BYTES * 2);
  assertSafeStructure(value);
  const parsed = CollectionSchema.safeParse(value);
  if (!parsed.success) throw new Error('法术与专长清单格式无效，或包含重复编号。');
  return validateDndReferences(parsed.data.entries);
}

export function dndReferenceCollectionJSON(entries: readonly DndReferenceEntry[]): string {
  const validated = validateDndReferences(entries);
  return JSON.stringify(
    { schemaVersion: 1, documentType: 'dnd-reference-collection', entries: validated },
    null,
    2,
  );
}

/** The readable portion contains the source text; the JSON block makes the file re-importable. */
export function dndReferenceCollectionMD(entries: readonly DndReferenceEntry[]): string {
  const validated = validateDndReferences(entries);
  const sections = validated.map((entry) => {
    const label = [entry.nameZh, entry.nameEn]
      .filter(Boolean)
      .join(' / ')
      .replace(/[\r\n`#]/g, ' ');
    const book = entry.source.book.replace(/[\r\n`#]/g, ' ');
    const raw = entry.rawText.replace(/^```/gm, '\\`\\`\\`');
    return `## ${label}\n\n${entry.edition} · ${entry.kind === 'spell' ? '法术' : '专长'} · ${book}\n\n${raw}`;
  });
  return `# 法术书与专长清单\n\n${sections.join('\n\n')}\n\n## 可重新导入的数据\n\n\`\`\`json\n${dndReferenceCollectionJSON(validated)}\n\`\`\`\n`;
}
