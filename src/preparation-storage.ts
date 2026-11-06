import { getDndEdition } from '../shared/dnd-edition';
import {
  EncounterPlanLibrarySchema,
  MAX_ENCOUNTER_PLANS,
  type EncounterPlan,
} from '../shared/preparation';

const DATABASE = 'interlude-encounter-plans';
const DATABASE_VERSION = 1;
const STORE = 'library';
const LIBRARY_KEY = 'plans';

class EncounterPlanStorageError extends Error {}

function storageError(error: unknown): Error {
  if (error instanceof EncounterPlanStorageError) return error;
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  if (name === 'QuotaExceededError')
    return new EncounterPlanStorageError(
      '浏览器存储空间不足，本次遭遇预案修改未保存。请先导出备份并释放空间。',
    );
  if (name === 'SecurityError' || name === 'NotAllowedError')
    return new EncounterPlanStorageError('浏览器禁止本站存储，请允许本站使用存储后重试。');
  if (name === 'VersionError' || name === 'NotFoundError')
    return new EncounterPlanStorageError(
      '遭遇预案的存储格式不兼容，请关闭其他本站页面并刷新后重试。',
    );
  return new EncounterPlanStorageError(
    '遭遇预案暂时无法读写，本次操作未完成。请检查浏览器存储权限后重试。',
  );
}

function validatePlans(value: unknown, stored = false): EncounterPlan[] {
  const error = (message: string) =>
    new EncounterPlanStorageError(
      stored ? '已保存的遭遇预案格式异常，原数据未修改。请勿清除浏览器站点数据。' : message,
    );
  if (!Array.isArray(value)) throw error('遭遇预案格式无效，本次未保存。');
  if (value.length > MAX_ENCOUNTER_PLANS)
    throw error(`遭遇预案最多保存 ${MAX_ENCOUNTER_PLANS} 个，本次未保存。`);
  try {
    const parsed = EncounterPlanLibrarySchema.safeParse(value);
    if (!parsed.success) {
      const issue = parsed.error.issues.find(
        (entry) => entry.message.includes('重复') || entry.message.includes('8 MiB'),
      );
      throw error(issue?.message ?? '遭遇预案格式无效，请核对规则、版次、波次与参战资料。');
    }
    return parsed.data;
  } catch (caught) {
    if (caught instanceof EncounterPlanStorageError) throw caught;
    throw error('遭遇预案格式无效，请核对规则、版次、波次与参战资料。');
  }
}

function merge(existing: EncounterPlan[], incoming: EncounterPlan[]): EncounterPlan[] {
  const merged = new Map(existing.map((plan) => [plan.id, plan]));
  for (const plan of incoming) {
    const previous = merged.get(plan.id);
    if (
      previous &&
      (previous.rule !== plan.rule ||
        (plan.rule === 'dnd' &&
          getDndEdition(previous.dndEdition) !== getDndEdition(plan.dndEdition)))
    )
      throw new EncounterPlanStorageError(
        '预案编号与已保存的其他规则或版次冲突，本次未保存。请用新编号另存。',
      );
    merged.set(plan.id, plan);
  }
  return validatePlans([...merged.values()]);
}

/** Validate and merge a complete batch without mutating either input. */
export function mergeEncounterPlans(
  existing: readonly EncounterPlan[],
  incoming: readonly EncounterPlan[],
): EncounterPlan[] {
  return merge(validatePlans(existing), validatePlans(incoming));
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(
      () => fail(new EncounterPlanStorageError('打开遭遇预案超时，请关闭其他本站页面后重试。')),
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
        throw new EncounterPlanStorageError('当前浏览器无法使用本地遭遇预案。');
      const request = indexedDB.open(DATABASE, DATABASE_VERSION);
      request.onblocked = () =>
        fail(new EncounterPlanStorageError('遭遇预案被其他页面占用，请关闭其他本站页面后重试。'));
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
  transform?: (plans: EncounterPlan[]) => EncounterPlan[],
): Promise<EncounterPlan[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    let failure: Error | undefined;
    let result: EncounterPlan[] | undefined;
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
          const existing = request.result === undefined ? [] : validatePlans(request.result, true);
          // One readwrite transaction serializes updates from different tabs.
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

/** Private, browser-origin-local plans; a room receives them only through an explicit action. */
export const listEncounterPlans = (): Promise<EncounterPlan[]> => transaction('readonly');

export async function saveEncounterPlans(
  plans: readonly EncounterPlan[],
): Promise<EncounterPlan[]> {
  const incoming = validatePlans(plans);
  return transaction('readwrite', (existing) => merge(existing, incoming));
}

export async function deleteEncounterPlan(id: string): Promise<EncounterPlan[]> {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(id))
    throw new EncounterPlanStorageError('预案编号无效，本次未删除。');
  return transaction('readwrite', (existing) => {
    if (!existing.some((plan) => plan.id === id))
      throw new EncounterPlanStorageError('该预案已不在个人清单中，请刷新后重试。');
    return existing.filter((plan) => plan.id !== id);
  });
}
