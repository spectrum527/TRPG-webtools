import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dndReferenceCollectionJSON,
  dndReferenceCollectionMD,
  parseDndReferenceCollection,
  parseDndReferencePack,
  validateDndReferences,
  type DndReferenceEntry,
} from '../shared/dnd-reference';
import {
  getDndReferences,
  mergeDndReferences,
  removeDndReference,
  saveDndReferences,
} from '../src/dnd-reference-storage';

const source2014: unknown = JSON.parse(
  readFileSync(new URL('../public/rules/dnd-2014.json', import.meta.url), 'utf8'),
);
const source2024: unknown = JSON.parse(
  readFileSync(new URL('../public/rules/dnd-2024.json', import.meta.url), 'utf8'),
);
const pack2014 = parseDndReferencePack(source2014);
const pack2024 = parseDndReferencePack(source2024);
const fire2014 = pack2014.spells.find((entry) => entry.nameEn === 'Fireball')!;
const fire2024 = pack2024.spells.find((entry) => entry.nameEn === 'Fireball')!;
afterEach(() => vi.unstubAllGlobals());

describe('processed D&D reference packs', () => {
  it('keeps both editions, core and expansions separate and preserves the source text', () => {
    expect(pack2014.spells.filter((x) => x.source.category === 'core')).toHaveLength(361);
    expect(pack2024.spells.filter((x) => x.source.category === 'core')).toHaveLength(391);
    expect(pack2014.feats.filter((x) => x.source.category === 'core')).toHaveLength(42);
    expect(pack2024.feats.filter((x) => x.source.category === 'core')).toHaveLength(75);
    expect(pack2014.spells.some((x) => x.source.category === 'expansion')).toBe(true);
    expect(pack2014.spells.some((x) => x.source.category === 'third-party')).toBe(true);
    expect(pack2014.spells.some((x) => x.classes === null)).toBe(true);
    expect(fire2014.id).not.toEqual(fire2024.id);
    expect(fire2014.source.book).toBe('玩家手册');
    expect(fire2024.source.book).toBe('玩家手册2024');
    expect(fire2014.rawText).not.toBe(fire2024.rawText);
    expect(fire2014).toMatchObject({
      level: 3,
      school: '塑能',
      classes: ['术士', '法师'],
      concentration: false,
      ritual: false,
    });
    expect(fire2014.source.path).not.toMatch(/^\//);
    expect(fire2014.rawText).toContain('8d6');
    expect(pack2014.feats.find((x) => x.nameEn === 'Defensive Duelist')?.prerequisites).toBe(
      '敏捷13或更高',
    );
    expect(pack2024.feats.find((x) => x.nameEn === 'Boon of Combat Prowess')).toMatchObject({
      featType: '传奇恩惠专长',
      prerequisites: '等级19+',
    });
  });

  it('rejects mismatched editions, duplicate IDs, and local absolute paths', () => {
    expect(() => parseDndReferencePack({ ...pack2014, spells: [fire2024], feats: [] })).toThrow(
      '格式无效',
    );
    expect(() =>
      parseDndReferencePack({ ...pack2014, spells: [fire2014, fire2014], feats: [] }),
    ).toThrow('格式无效');
    expect(() =>
      parseDndReferencePack({
        ...pack2014,
        spells: [{ ...fire2014, source: { ...fire2014.source, path: '/Users/private/rules' } }],
        feats: [],
      }),
    ).toThrow('格式无效');
  });
});

describe('personal spell and feat collections', () => {
  it('round trips JSON and readable Markdown with source snapshots from both editions', () => {
    const entries: DndReferenceEntry[] = [fire2014, fire2024, pack2024.feats[0]];
    const json = dndReferenceCollectionJSON(entries);
    const md = dndReferenceCollectionMD(entries);
    expect(md).toContain('# 法术书与专长清单');
    expect(md).toContain('8d6');
    expect(parseDndReferenceCollection(json)).toEqual(entries);
    expect(parseDndReferenceCollection(md)).toEqual(entries);
    expect(() => parseDndReferenceCollection('{"entries":[]}')).toThrow('格式无效');
    expect(() => dndReferenceCollectionJSON([fire2014, fire2014])).toThrow('重复编号');
  });

  it('rejects dangerous keys in JSON and Markdown, oversized collections, cycles and getters', () => {
    const good = dndReferenceCollectionJSON([fire2014]);
    const hostile = good.replace('"schemaVersion": 1,', '"__proto__": {}, "schemaVersion": 1,');
    expect(() => parseDndReferenceCollection(hostile)).toThrow('键名');
    expect(() => parseDndReferenceCollection(`# Test\n\n\`\`\`json\n${hostile}\n\`\`\``)).toThrow(
      '键名',
    );
    const dangerous = JSON.parse(
      JSON.stringify(fire2014).replace('"book":', '"constructor": {}, "book":'),
    );
    expect(() => validateDndReferences([dangerous])).toThrow('键名');
    expect(() =>
      validateDndReferences(
        Array.from({ length: 1501 }, (_, i) => ({ ...fire2014, id: `large-${i}` })),
      ),
    ).toThrow('过大');
    const sparse = [] as DndReferenceEntry[];
    sparse.length = 1501;
    expect(() => validateDndReferences(sparse)).toThrow('过大');
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => validateDndReferences([cyclic])).toThrow('过大');
    let getterRead = false;
    const getter = { ...fire2014 };
    Object.defineProperty(getter, 'nameZh', {
      enumerable: true,
      get: () => {
        getterRead = true;
        return 'x';
      },
    });
    expect(() => validateDndReferences([getter])).toThrow('键名');
    expect(getterRead).toBe(false);
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it('keeps Markdown with fenced text in a snapshot readable and re-importable', () => {
    const entry = { ...fire2014, rawText: '示例\n```json\n{"example":true}\n```' };
    expect(parseDndReferenceCollection(dndReferenceCollectionMD([entry]))).toEqual([entry]);
  });

  it('merges by source-specific ID, copies input, and rejects malformed batches', () => {
    const updated = { ...fire2014, rawText: '保存的快照' };
    const result = mergeDndReferences([fire2014, fire2024], [updated]);
    expect(result).toEqual([updated, fire2024]);
    result[0].source.book = '改动';
    expect(fire2014.source.book).toBe('玩家手册');
    expect(() => mergeDndReferences([], [fire2014, fire2014])).toThrow('重复编号');
    expect(() => mergeDndReferences([], [{ id: 'bad' } as DndReferenceEntry])).toThrow('格式无效');
    expect(() => mergeDndReferences([fire2014], [{ ...fire2024, id: fire2014.id }])).toThrow(
      '其他版次或来源冲突',
    );
  });

  it('reports unavailable storage and rejects invalid entries before opening it', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(getDndReferences()).rejects.toThrow('无法使用');
    const open = vi.fn();
    vi.stubGlobal('indexedDB', { open });
    await expect(saveDndReferences([{ id: 'bad' } as DndReferenceEntry])).rejects.toThrow(
      '格式无效',
    );
    await expect(removeDndReference('../bad')).rejects.toThrow('编号无效');
    expect(open).not.toHaveBeenCalled();
  });
});

/** Model an IndexedDB request that has succeeded but whose transaction has not committed yet. */
function storageHarness(initial: unknown) {
  let committed = structuredClone(initial);
  let staged: unknown;
  let ready!: () => void;
  const requested = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const events: string[] = [];
  const request: { result: unknown; error: unknown; onsuccess?: () => void } = {
    result: undefined,
    error: null,
  };
  const tx: {
    error: unknown;
    onabort?: () => void;
    oncomplete?: () => void;
    abort: () => void;
    objectStore: (name: string) => unknown;
  } = {
    error: null,
    abort: () => {
      events.push('abort');
      queueMicrotask(() => tx.onabort?.());
      ready();
    },
    objectStore: (name) => {
      expect(name).toBe('library');
      return {
        get: (key: string) => {
          expect(key).toBe('entries');
          events.push('get');
          request.result = structuredClone(committed);
          queueMicrotask(() => {
            request.onsuccess?.();
            ready();
          });
          return request;
        },
        put: (value: unknown, key: string) => {
          expect(key).toBe('entries');
          events.push('put');
          staged = structuredClone(value);
          return { error: null };
        },
      };
    },
  };
  const close = vi.fn();
  const database = {
    close,
    transaction: (_name: string, mode: string) => {
      events.push(mode);
      return tx;
    },
    onversionchange: undefined,
  };
  vi.stubGlobal('indexedDB', {
    open: () => {
      const opening: { result: typeof database; onsuccess?: () => void } = { result: database };
      queueMicrotask(() => opening.onsuccess?.());
      return opening;
    },
  });
  return {
    events,
    requested,
    value: () => structuredClone(committed),
    commit: () => {
      if (staged !== undefined) committed = staged;
      tx.oncomplete?.();
    },
    fail: () => {
      tx.error = new DOMException('late failure', 'QuotaExceededError');
      tx.onabort?.();
    },
  };
}

describe('personal collection transaction boundary', () => {
  it('waits for commit, captures inputs before awaiting, and preserves earlier entries', async () => {
    const storage = storageHarness([fire2014]);
    const incoming = structuredClone(fire2024);
    const expected = structuredClone(incoming);
    let settled = false;
    const operation = saveDndReferences([incoming]).then((result) => {
      settled = true;
      return result;
    });
    incoming.rawText = '调用者改动';
    await storage.requested;
    expect(storage.events).toEqual(['readwrite', 'get', 'put']);
    expect(settled).toBe(false);
    expect(storage.value()).toEqual([fire2014]);
    storage.commit();
    expect(await operation).toEqual([fire2014, expected]);
    expect(storage.value()).toEqual([fire2014, expected]);
  });

  it('reports a failed commit and never overwrites corrupt stored data', async () => {
    const storage = storageHarness([fire2014]);
    const pending = saveDndReferences([fire2024]);
    const rejected = expect(pending).rejects.toThrow('空间不足');
    await storage.requested;
    storage.fail();
    await rejected;
    expect(storage.value()).toEqual([fire2014]);

    const corrupt = [{ id: 'invalid' }];
    const broken = storageHarness(corrupt);
    const failure = expect(saveDndReferences([fire2024])).rejects.toThrow('原数据未修改');
    await broken.requested;
    await failure;
    expect(broken.events).toEqual(['readwrite', 'get', 'abort']);
    expect(broken.value()).toEqual(corrupt);
  });
});
