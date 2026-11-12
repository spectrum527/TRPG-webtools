import { applyCocSessionEdit } from './coc-session-rules';
import type { Character } from './types';
import type { CocSessionEdit } from './coc-runtime';

/** Preparation cannot run checks, advance time, or pay spell costs. */
export function editCocPreparation(card: Character, edit: CocSessionEdit): Character {
  if (!['spell-save', 'spell-remove', 'tome-save', 'tome-remove'].includes(edit.kind))
    throw new Error('此操作需在开始后的房间内进行');
  return applyCocSessionEdit(card, edit).character;
}
