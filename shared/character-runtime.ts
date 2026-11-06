import { z } from 'zod';
import { DndEquipmentEditSchema } from './dnd-equipment';
import { DndMagicEditSchema } from './dnd-magic';
import type { Item } from './types';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const characterVersion = {
  memberId: id,
  characterId: id,
  expectedCharacterRevision: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER - 1),
};

export const CharacterRuntimeActionSchemas = [
  z.strictObject({
    type: z.literal('character-magic'),
    ...characterVersion,
    requestId: id,
    edit: DndMagicEditSchema,
  }),
  z.strictObject({
    type: z.literal('character-equipment'),
    ...characterVersion,
    requestId: id,
    edit: DndEquipmentEditSchema,
  }),
  z.strictObject({
    type: z.literal('party-rest'),
    rest: z.enum(['short', 'long']),
    members: z
      .array(
        z.strictObject({
          ...characterVersion,
          hitDice: z.number().int().min(0).max(20).optional(),
        }),
      )
      .min(1)
      .max(7)
      .refine(
        (members) => new Set(members.map((member) => member.memberId)).size === members.length,
        '同一角色只可加入一次休息',
      ),
    requestId: id,
    confirmed: z.literal(true),
  }),
] as const;

export type CharacterRuntimeAction = z.infer<(typeof CharacterRuntimeActionSchemas)[number]>;

type AmmunitionFamily = 'arrow' | 'bolt' | 'dart' | 'sling' | 'firearm';
const ammoFamilies = new Map<string, AmmunitionFamily>([
  ['箭', 'arrow'],
  ['箭矢', 'arrow'],
  ['弩矢', 'bolt'],
  ['吹矢', 'dart'],
  ['投石索弹丸', 'sling'],
  ['投石索子弹', 'sling'],
  ['枪械子弹', 'firearm'],
]);
const weaponAmmoFamilies = new Map<string, AmmunitionFamily>([
  ['短弓', 'arrow'],
  ['长弓', 'arrow'],
  ['手弩', 'bolt'],
  ['轻弩', 'bolt'],
  ['重弩', 'bolt'],
  ['吹箭筒', 'dart'],
  ['投石索', 'sling'],
  ['火铳', 'firearm'],
  ['手铳', 'firearm'],
]);

export function dndAmmoCompatibility(weapon: Item, ammo: Item): 'match' | 'mismatch' | 'unknown' {
  const gear = weapon.equipment;
  const expected =
    ammoFamilies.get(gear?.weapon?.ammunitionType ?? '') ??
    weaponAmmoFamilies.get(gear?.baseName ?? '');
  const actual = ammoFamilies.get(ammo.equipment?.baseName ?? '');
  if (!expected || !actual) return 'unknown';
  return expected === actual ? 'match' : 'mismatch';
}
