import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCharacter } from '../shared/rules';
import { getLibrary, saveToLibrary } from '../src/storage';

beforeEach(() => {
  const entries = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

const legacyCharacter = () => ({
  ...createCharacter('dnd', () => 4),
  name: '2014 角色',
  occupation: '战士',
});

describe('character library edition identity', () => {
  it('updates the same ID when the rule and effective edition match', () => {
    const original = legacyCharacter();
    const edited = { ...original, name: '改名的旧卡', dndEdition: '2014' as const };
    saveToLibrary(original);
    expect(saveToLibrary(edited)).toEqual([edited]);
    expect(getLibrary()).toEqual([edited]);
  });

  it('keeps an older card intact when importing a 2024 character with the same ID', () => {
    const original = legacyCharacter();
    const modern = { ...original, name: '2024 角色', dndEdition: '2024' as const };
    saveToLibrary(original);
    const [saved, retained] = saveToLibrary(modern);
    expect(retained).toEqual(original);
    expect(saved.id).not.toBe(original.id);
    expect(saved).toEqual({ ...modern, id: saved.id });
    expect(modern.id).toBe(original.id);
    expect(getLibrary()).toEqual([saved, original]);
  });

  it('also keeps characters from different rule systems with the same ID', () => {
    const original = legacyCharacter();
    const investigator = {
      ...createCharacter('coc', () => 4),
      id: original.id,
      name: 'CoC 角色',
      occupation: '记者',
    };
    saveToLibrary(original);
    const [saved, retained] = saveToLibrary(investigator);
    expect(saved.id).not.toBe(original.id);
    expect(saved).toEqual({ ...investigator, id: saved.id });
    expect(retained).toEqual(original);
    expect(getLibrary()).toEqual([saved, original]);
  });
});
