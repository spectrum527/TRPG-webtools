import { describe, expect, it } from 'vitest';
import { COC_WEAPON_CATALOG } from '../shared/coc-equipment';
import {
  emptyCocPreparationLibrary,
  exportCocPreparationLibrary,
  mergeCocPreparationLibrary,
  parseCocPreparationLibrary,
} from '../shared/coc-library';

function library() {
  const value = emptyCocPreparationLibrary();
  value.spells.push({
    id: 'scribe',
    name: '记号术',
    description: '书记在门边写下 ```json 和三个反引号 ```。',
    source: '剧本第 2 页',
    cost: { mp: 1, san: '0', hp: 0, minutes: 1, rounds: 0 },
  });
  value.weapons.push({ id: 'test-weapon', profile: COC_WEAPON_CATALOG[0].profile });
  return value;
}

describe('portable CoC preparation library', () => {
  it('preserves literal fences in exported JSON and Markdown, including BOM and CRLF', () => {
    const value = library();
    expect(
      parseCocPreparationLibrary('\uFEFF' + exportCocPreparationLibrary(value, 'json')),
    ).toEqual(value);
    const markdown = exportCocPreparationLibrary(value, 'md');
    expect(parseCocPreparationLibrary(markdown.replace(/\n/g, '\r\n'))).toEqual(value);
    expect(() => parseCocPreparationLibrary(`${markdown}\n${markdown}`)).toThrow(/一个 JSON/);
  });

  it('rejects malformed executable-looking damage and validates the merged relationships', () => {
    const value = library();
    const updated = library();
    updated.weapons[0] = {
      ...updated.weapons[0],
      profile: { ...updated.weapons[0].profile, damage: '1d8' },
    };
    expect(mergeCocPreparationLibrary(value, updated).weapons).toEqual(updated.weapons);
    updated.weapons[0].profile.damage = '1d6+Math.random()';
    expect(() => parseCocPreparationLibrary(JSON.stringify(updated))).toThrow(/伤害骰式/);
  });

  it('cannot export a valid-looking library too large to reimport', () => {
    const value = emptyCocPreparationLibrary();
    const sample = library().spells[0];
    value.spells = Array.from({ length: 80 }, (_, i) => ({
      ...sample,
      id: `spell-${i}`,
      description: '密'.repeat(4000),
    }));
    value.tomes = Array.from({ length: 20 }, (_, i) => ({
      id: `tome-${i}`,
      name: '神话书',
      description: '密'.repeat(4000),
      initialMinutes: 30,
      fullMinutes: 60,
      initialMythos: 1,
      fullMythos: 1,
      sanLoss: '0',
      spellIds: ['spell-0'],
    }));
    expect(() => exportCocPreparationLibrary(value, 'md')).toThrow(/1 MiB/);
    expect(() => parseCocPreparationLibrary(JSON.stringify(value))).toThrow(/1 MiB/);
  });
});
