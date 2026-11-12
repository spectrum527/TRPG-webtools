import {
  CocPreparationLibrarySchema,
  emptyCocPreparationLibrary,
  type CocPreparationLibrary,
} from '../shared/coc-library';
import { readStored, writeStored } from './storage';

const key = 'interlude-coc-preparation-library';
export function readCocPreparationLibrary() {
  const parsed = CocPreparationLibrarySchema.safeParse(readStored<unknown>(key, null));
  return parsed.success ? parsed.data : emptyCocPreparationLibrary();
}
export function saveCocPreparationLibrary(library: CocPreparationLibrary) {
  const value = CocPreparationLibrarySchema.parse(library);
  if (!writeStored(key, value)) throw new Error('浏览器空间不足，未保存。请先导出备份。');
  return value;
}
