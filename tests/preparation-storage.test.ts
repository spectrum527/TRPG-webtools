import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDndStatBlock } from '../shared/dnd';
import { createKeeperCard } from '../shared/keeper';
import type { DndEdition } from '../shared/dnd-edition';
import type { EncounterPlan } from '../shared/preparation';
import {
  deleteEncounterPlan,
  listEncounterPlans,
  mergeEncounterPlans,
  saveEncounterPlans,
} from '../src/preparation-storage';

afterEach(() => vi.unstubAllGlobals());

function plan(id = 'plan-one', edition?: DndEdition): EncounterPlan {
  return {
    documentType: 'encounter-plan',
    schemaVersion: 1,
    id,
    name: '街巷遭遇',
    rule: 'dnd',
    ...(edition ? { dndEdition: edition } : {}),
    waves: [
      {
        id: 'wave-one',
        name: '第一波',
        entries: [{ id: 'entry-one', card: createDndStatBlock('npc-blank', edition), count: 1 }],
      },
    ],
    loot: '',
    notes: '',
  };
}
function cocPlan(id = 'plan-one'): EncounterPlan {
  return {
    documentType: 'encounter-plan',
    schemaVersion: 1,
    id,
    name: '调查遭遇',
    rule: 'coc',
    waves: [
      {
        id: 'wave-one',
        name: '第一波',
        entries: [{ id: 'entry-one', card: createKeeperCard('npc'), count: 1 }],
      },
    ],
    loot: '',
    notes: '',
  };
}

describe('personal encounter-plan validation', () => {
  it('upserts copies without sharing nested data and treats omitted editions as 2014', () => {
    const original = plan();
    const update = { ...structuredClone(original), dndEdition: '2014' as const, name: '新版标题' };
    const previous = structuredClone({ original, update });
    const result = mergeEncounterPlans([original], [update]);
    expect(result).toEqual([update]);
    result[0].waves[0].entries[0].card.name = '结果改动';
    expect({ original, update }).toEqual(previous);
  });

  it('rejects the entire batch for cross-rule or cross-edition ID conflicts', () => {
    const old = plan('same');
    const good = plan('new');
    const before = structuredClone([old]);
    expect(() => mergeEncounterPlans([old], [good, plan('same', '2024')])).toThrow(
      '其他规则或版次冲突',
    );
    expect(() => mergeEncounterPlans([old], [good, cocPlan('same')])).toThrow('其他规则或版次冲突');
    expect([old]).toEqual(before);
    expect(() => mergeEncounterPlans([], [old, old])).toThrow('重复');
  });

  it('enforces the shared count and UTF-8 size limits before committing a merge', () => {
    const seed = plan();
    const forty = Array.from({ length: 40 }, (_, index) => ({ ...seed, id: `plan-${index}` }));
    expect(mergeEncounterPlans(forty, [{ ...forty[0], name: '更新' }])).toHaveLength(40);
    expect(() => mergeEncounterPlans(forty, [plan('extra')])).toThrow('最多保存 40');
    const heavy = plan();
    const card = { ...createDndStatBlock('npc-blank'), notes: '汉'.repeat(24000) };
    heavy.waves[0].entries = Array.from({ length: 4 }, (_, index) => ({
      id: `entry-${index}`,
      card,
      count: 1,
    }));
    const many = Array.from({ length: 31 }, (_, index) => ({ ...heavy, id: `heavy-${index}` }));
    expect(() => mergeEncounterPlans([], many)).toThrow('8 MiB');
  });

  it('refuses malformed data and missing storage before opening a write transaction', async () => {
    const open = vi.fn();
    vi.stubGlobal('indexedDB', { open });
    await expect(saveEncounterPlans([{ id: 'bad' } as EncounterPlan])).rejects.toThrow('格式无效');
    await expect(deleteEncounterPlan('../bad')).rejects.toThrow('编号无效');
    expect(open).not.toHaveBeenCalled();
    vi.stubGlobal('indexedDB', undefined);
    await expect(listEncounterPlans()).rejects.toThrow('无法使用');
  });
});

/** The write request may succeed before the transaction commits. */
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
          expect(key).toBe('plans');
          events.push('get');
          request.result = structuredClone(committed);
          queueMicrotask(() => {
            request.onsuccess?.();
            ready();
          });
          return request;
        },
        put: (value: unknown, key: string) => {
          expect(key).toBe('plans');
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
  const open = vi.fn(() => {
    const opening: { result: typeof database; onsuccess?: () => void } = { result: database };
    queueMicrotask(() => opening.onsuccess?.());
    return opening;
  });
  vi.stubGlobal('indexedDB', { open });
  return {
    open,
    close,
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

describe('personal encounter-plan transaction boundary', () => {
  it('reads and writes in one transaction, captures input before awaiting and resolves only on commit', async () => {
    const existing = plan('old');
    const incoming = plan('new', '2024');
    const intended = structuredClone(incoming);
    const storage = storageHarness([existing]);
    let settled = false;
    const operation = saveEncounterPlans([incoming]).then((value) => {
      settled = true;
      return value;
    });
    incoming.waves[0].entries[0].card.name = '调用方改动';
    await storage.requested;
    expect(storage.open).toHaveBeenCalledWith('interlude-encounter-plans', 1);
    expect(storage.events).toEqual(['readwrite', 'get', 'put']);
    expect(settled).toBe(false);
    expect(storage.value()).toEqual([existing]);
    storage.commit();
    expect(await operation).toEqual([existing, intended]);
    expect(storage.value()).toEqual([existing, intended]);
    expect(storage.close).toHaveBeenCalledOnce();
  });

  it('rolls back failed writes and refuses to replace damaged saved data', async () => {
    const existing = plan('old');
    const storage = storageHarness([existing]);
    const pending = saveEncounterPlans([plan('new')]);
    const rejected = expect(pending).rejects.toThrow('空间不足');
    await storage.requested;
    storage.fail();
    await rejected;
    expect(storage.value()).toEqual([existing]);

    const corrupt = [{ id: 'invalid' }];
    const broken = storageHarness(corrupt);
    const failure = expect(saveEncounterPlans([plan('new')])).rejects.toThrow('原数据未修改');
    await broken.requested;
    await failure;
    expect(broken.events).toEqual(['readwrite', 'get', 'abort']);
    expect(broken.value()).toEqual(corrupt);
  });

  it('aborts a cross-version batch after reading existing storage and deletes only the specified ID', async () => {
    const existing = plan('same');
    const storage = storageHarness([existing]);
    const rejection = expect(
      saveEncounterPlans([plan('new'), plan('same', '2024')]),
    ).rejects.toThrow('其他规则或版次冲突');
    await storage.requested;
    await rejection;
    expect(storage.events).toEqual(['readwrite', 'get', 'abort']);
    expect(storage.value()).toEqual([existing]);

    const other = plan('other');
    const remove = storageHarness([existing, other]);
    const operation = deleteEncounterPlan(existing.id);
    await remove.requested;
    expect(remove.value()).toEqual([existing, other]);
    remove.commit();
    expect(await operation).toEqual([other]);
  });
});
