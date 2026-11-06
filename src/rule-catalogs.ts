import { useEffect, useState } from 'react';
import type { DndEdition } from '../shared/dnd-edition';
import { parseDndReferencePack, type DndReferencePack } from '../shared/dnd-reference';
import { parseEquipmentCatalog, type EquipmentCatalogPack } from '../shared/equipment-catalog';
const magic = new Map<DndEdition, Promise<DndReferencePack>>();
const equipment = new Map<DndEdition, Promise<EquipmentCatalogPack>>();
async function load<T>(
  cache: Map<DndEdition, Promise<T>>,
  edition: DndEdition,
  file: string,
  parse: (v: unknown) => T,
): Promise<T> {
  if (!cache.has(edition))
    cache.set(
      edition,
      fetch(`${import.meta.env.BASE_URL}rules/${file}-${edition}.json`)
        .then(async (r) => {
          if (!r.ok) throw new Error('规则目录读取失败，请重试。');
          return parse(await r.json());
        })
        .catch((e) => {
          cache.delete(edition);
          throw e;
        }),
    );
  return cache.get(edition)!;
}
export function loadMagicCatalog(edition: DndEdition) {
  return load(magic, edition, 'dnd', parseDndReferencePack);
}
export function loadEquipmentCatalog(edition: DndEdition) {
  return load(equipment, edition, 'equipment', parseEquipmentCatalog);
}
export function useRuleCatalog<T>(edition: DndEdition, loader: (e: DndEdition) => Promise<T>) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setData(null);
    setError('');
    void loader(edition)
      .then((v) => {
        if (live) setData(v);
      })
      .catch((e) => {
        if (live) setError((e as Error).message);
      });
    return () => {
      live = false;
    };
  }, [edition, loader, retry]);
  return { data, error, reload: () => setRetry((r) => r + 1) };
}
