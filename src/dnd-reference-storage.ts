import { type DndReferenceEntry, validateDndReferences } from '../shared/dnd-reference';

const DATABASE = 'interlude-dnd-references';
const DATABASE_VERSION = 1;
const STORE = 'library';
const LIBRARY_KEY = 'entries';

class DndReferenceLibraryError extends Error {}

function storageError(error: unknown): Error {
  if (error instanceof DndReferenceLibraryError) return error;
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  if (name === 'QuotaExceededError')
    return new DndReferenceLibraryError(
      '浏览器存储空间不足，本次修改未保存。请先导出法术与专长清单，再释放空间后重试。',
    );
  if (name === 'SecurityError' || name === 'NotAllowedError')
    return new DndReferenceLibraryError('浏览器禁止本站存储，请检查存储权限后重试。');
  if (name === 'VersionError' || name === 'NotFoundError')
    return new DndReferenceLibraryError(
      '法术与专长清单的存储格式不兼容，请关闭其他本站页面并刷新后重试。',
    );
  return new DndReferenceLibraryError(
    '法术与专长清单暂时无法读写，本次操作未完成。请检查浏览器存储权限后重试。',
  );
}

function validate(value: unknown, stored = false): DndReferenceEntry[] {
  try {
    return validateDndReferences(value);
  } catch (error) {
    if (stored)
      throw new DndReferenceLibraryError(
        '已保存的法术与专长清单格式异常，原数据未修改。请勿清除浏览器站点数据。',
      );
    throw new DndReferenceLibraryError(
      error instanceof Error ? error.message : '法术与专长清单格式无效。',
    );
  }
}

function merge(existing: DndReferenceEntry[], incoming: DndReferenceEntry[]): DndReferenceEntry[] {
  const merged = new Map(existing.map((entry) => [entry.id, entry]));
  incoming.forEach((entry) => {
    const saved = merged.get(entry.id);
    if (
      saved &&
      (saved.edition !== entry.edition ||
        saved.kind !== entry.kind ||
        saved.source.id !== entry.source.id)
    )
      throw new DndReferenceLibraryError('条目编号与已保存的其他版次或来源冲突，本次未保存。');
    merged.set(entry.id, entry);
  });
  return validate([...merged.values()]);
}

/** Pure merge for previews: an entry ID identifies a particular edition and source. */
export function mergeDndReferences(
  existing: readonly DndReferenceEntry[],
  incoming: readonly DndReferenceEntry[],
): DndReferenceEntry[] {
  return merge(validate(existing), validate(incoming));
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(
      () =>
        fail(new DndReferenceLibraryError('打开法术与专长清单超时，请关闭其他本站页面后重试。')),
      10_000,
    );
    function fail(error: unknown) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(storageError(error));
    }
    try {
      if (!globalThis.indexedDB)
        throw new DndReferenceLibraryError('当前浏览器无法使用本地法术与专长清单。');
      const request = indexedDB.open(DATABASE, DATABASE_VERSION);
      request.onblocked = () =>
        fail(
          new DndReferenceLibraryError('法术与专长清单被其他页面占用，请关闭其他本站页面后重试。'),
        );
      request.onerror = () => fail(request.error);
      request.onupgradeneeded = () => {
        try {
          if (!request.result.objectStoreNames.contains(STORE))
            request.result.createObjectStore(STORE);
        } catch (error) {
          request.transaction?.abort();
          fail(error);
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        if (settled) {
          database.close();
          return;
        }
        settled = true;
        clearTimeout(timer);
        database.onversionchange = () => database.close();
        resolve(database);
      };
    } catch (error) {
      fail(error);
    }
  });
}

async function transaction(
  mode: IDBTransactionMode,
  transform?: (entries: DndReferenceEntry[]) => DndReferenceEntry[],
): Promise<DndReferenceEntry[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    let failure: Error | undefined;
    let result: DndReferenceEntry[] | undefined;
    let tx: IDBTransaction;
    try {
      tx = database.transaction(STORE, mode);
    } catch (error) {
      database.close();
      reject(storageError(error));
      return;
    }
    function abort(error: unknown) {
      failure = storageError(error);
      try {
        tx.abort();
      } catch {
        database.close();
        reject(failure);
      }
    }
    tx.onerror = () => {
      failure ??= storageError(tx.error);
    };
    tx.onabort = () => {
      database.close();
      reject(failure ?? storageError(tx.error));
    };
    tx.oncomplete = () => {
      database.close();
      if (failure) reject(failure);
      else if (!result) reject(storageError(undefined));
      else resolve(result);
    };
    try {
      const store = tx.objectStore(STORE);
      const request = store.get(LIBRARY_KEY);
      request.onerror = () => {
        failure ??= storageError(request.error);
      };
      request.onsuccess = () => {
        try {
          const existing = request.result === undefined ? [] : validate(request.result, true);
          // Both operations are in the same transaction: overlapping tabs cannot lose each other's saves.
          result = transform ? transform(existing) : existing;
          if (transform) {
            const write = store.put(result, LIBRARY_KEY);
            write.onerror = () => {
              failure ??= storageError(write.error);
            };
          }
        } catch (error) {
          abort(error);
        }
      };
    } catch (error) {
      abort(error);
    }
  });
}

/** Personal, browser-origin-local snapshots; nothing is sent to a room automatically. */
export const getDndReferences = (): Promise<DndReferenceEntry[]> => transaction('readonly');

export async function saveDndReferences(
  entries: readonly DndReferenceEntry[],
): Promise<DndReferenceEntry[]> {
  const incoming = validate(entries);
  return transaction('readwrite', (existing) => merge(existing, incoming));
}

export async function removeDndReference(id: string): Promise<DndReferenceEntry[]> {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id))
    throw new DndReferenceLibraryError('条目编号无效，本次未删除。');
  return transaction('readwrite', (existing) => {
    if (!existing.some((entry) => entry.id === id))
      throw new DndReferenceLibraryError('该条目已不在清单中，请刷新后重试。');
    return existing.filter((entry) => entry.id !== id);
  });
}
