import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { exportArchive, readArchive } from '../server/archive';
import { archiveSummary } from '../shared/archive';
import { dndAncestries } from '../shared/catalog';
import {
  defaultCreationPolicy,
  dndAncestry,
  dndClassRule,
  dndSaves,
  expertiseLimit,
  expertiseOptions,
  replacementCount,
  suggestAllocation,
  syncAllocation,
  validateCreation,
  type DndAllocation,
} from '../shared/creation';
import {
  createDndStatBlock,
  dndCollectionMD,
  duplicateDndStatBlock,
  parseDndStatBlocks,
} from '../shared/dnd';
import { getDndEdition, type DndEdition } from '../shared/dnd-edition';
import { getDndExtractionPrompt, getDndImportTemplate } from '../shared/dnd-guide';
import { emptyEncounter } from '../shared/encounter';
import { exportRoomConfig, parseRoomConfig, roomConfiguration } from '../shared/room-config';
import { roomSchema, validRoomReferences, visibleEvent } from '../shared/room-state';
import {
  createCharacter,
  exportCharacter,
  getCharacterErrors,
  parseCharacter,
  passivePerception,
  rollDice,
} from '../shared/rules';
import type { Character, Room, RoomEvent } from '../shared/types';

const policy = defaultCreationPolicy('dnd');
const createdAt = '2026-11-06T00:00:00.000Z';

function card(edition?: DndEdition, values: Partial<Character> = {}): Character {
  return suggestAllocation(
    {
      ...createCharacter('dnd', () => 4, undefined, edition),
      name: '黎雾',
      ancestry: '人类',
      background: '侍僧',
      occupation: '战士',
      ...values,
    },
    policy,
  );
}

function room(edition?: DndEdition): Room {
  return {
    code: 'ABCDE1',
    name: '暮港',
    rule: 'dnd',
    ...(edition ? { dndEdition: edition } : {}),
    hostId: 'host',
    mode: 'in-room',
    phase: 'lobby',
    members: [
      {
        id: 'host',
        name: '主持人',
        role: 'host',
        color: '#123456',
        online: true,
        ready: false,
        character: null,
        characterRevision: 0,
        review: {
          status: 'pending',
          note: '',
          reviewedAt: null,
          characterRevision: 0,
          policyRevision: 0,
        },
      },
      {
        id: 'player',
        name: '玩家',
        role: 'player',
        color: '#654321',
        online: true,
        ready: false,
        character: { ...card(edition), passivePerceptionEnabled: true },
        characterRevision: 0,
        review: {
          status: 'pending',
          note: '',
          reviewedAt: null,
          characterRevision: 0,
          policyRevision: 0,
        },
      },
    ],
    log: [],
    scene: { title: '', description: '' },
    initiative: [],
    activeTurn: 0,
    round: 0,
    createdAt,
    creationPolicy: policy,
    policyRevision: 0,
    configRevision: 0,
    atlases: [],
    keeperCards: [],
    dndCards: [createDndStatBlock('npc-blank', edition)],
    encounter: emptyEncounter(),
  };
}

describe('D&D editions and passive perception', () => {
  it('preserves old cards and round-trips the edition and switch in both formats', () => {
    const old = parseCharacter(exportCharacter(card(), 'json'), 'dnd', '2014');
    expect(old.dndEdition).toBeUndefined();
    expect(old.passivePerceptionEnabled).toBeUndefined();
    expect(getDndEdition(old.dndEdition)).toBe('2014');
    expect(() => parseCharacter(exportCharacter(old, 'json'), 'dnd', '2024')).toThrow('版次不匹配');

    for (const enabled of [true, false]) {
      const modern = { ...card('2024'), passivePerceptionEnabled: enabled };
      for (const format of ['json', 'md'] as const)
        expect(parseCharacter(exportCharacter(modern, format), 'dnd', '2024')).toEqual(modern);
      const md = exportCharacter(modern, 'md');
      expect(md).toContain('D&D 5e (2024)');
      expect(md.includes('被动察觉')).toBe(enabled);
    }
    const coc = createCharacter('coc', () => 4);
    expect(passivePerception(coc)).toBeNull();
    expect(
      getCharacterErrors({ ...coc, dndEdition: '2024', passivePerceptionEnabled: true }),
    ).toEqual(expect.arrayContaining(['D&D 版次：仅适用于 D&D', '被动察觉开关：仅适用于 D&D']));
  });

  it.each(['2014', '2024'] as const)(
    'uses effective Perception and situational edge in %s',
    (edition) => {
      const base = card(edition, { occupation: '游荡者', background: '警卫' });
      const trained = syncAllocation({
        ...base,
        attributes: { ...base.attributes, wis: 15 },
        creation: {
          ...(base.creation as DndAllocation),
          ...(edition === '2014' ? { backgroundSkills: ['history', 'perception'] } : {}),
          expertise: ['perception', 'athletics'],
        },
      });
      expect(passivePerception(trained)).toBe(16);
      expect(passivePerception(trained, { edge: 'advantage' })).toBe(21);
      expect(passivePerception(trained, { edge: 'disadvantage', modifier: -2 })).toBe(9);
      const adjusted = {
        ...trained,
        adjustments: {
          permanent: [{ target: 'attribute' as const, key: 'wis', amount: 2, reason: '成长' }],
          temporary: [
            {
              id: 't1',
              name: '警觉',
              endCondition: '下一场景',
              enabled: true,
              changes: [{ target: 'skill' as const, key: 'perception', amount: 2 }],
            },
          ],
        },
      };
      expect(passivePerception(adjusted)).toBe(19);
      expect(() => passivePerception(trained, { modifier: Number.NaN })).toThrow('情境修正');
    },
  );

  it('selects the edition-specific species, class skill and expertise rules', () => {
    const old = card(undefined, { ancestry: '精灵' });
    const modern = card('2024', { ancestry: '精灵' });
    expect(dndAncestries()).toContain('半精灵');
    expect(dndAncestries('2024')).toContain('歌利亚');
    expect(dndAncestry(old)).toMatchObject({ fixed: ['perception'], choices: 0 });
    expect(dndAncestry(modern)).toEqual({
      fixed: [],
      choices: 1,
      skills: ['insight', 'perception', 'survival'],
    });
    expect(dndClassRule(old)?.skills).not.toContain('persuasion');
    expect(dndClassRule(modern)?.skills).toContain('persuasion');
    expect(dndSaves(card('2024', { occupation: '游荡者', level: 15 }))).toContain('cha');
    expect(dndSaves(card('2014', { occupation: '游荡者', level: 15 }))).not.toContain('cha');
    expect(expertiseLimit(card('2014', { occupation: '吟游诗人', level: 2 }))).toBe(0);
    expect(expertiseLimit(card('2024', { occupation: '吟游诗人', level: 2 }))).toBe(2);
    expect(expertiseLimit(card('2024', { occupation: '游侠', level: 9 }))).toBe(3);
    const wizard = card('2024', { occupation: '法师', level: 2, background: '警卫' });
    expect(expertiseOptions(wizard)).toEqual(['arcana', 'history']);
    expect(validateCreation(wizard, policy)).toEqual([]);
  });

  it('validates 2024 fixed backgrounds and does not grant an additional proficiency for overlap', () => {
    const modern = card('2024', { ancestry: '精灵', background: '警卫' });
    expect(modern.creation).toMatchObject({ backgroundSkills: ['athletics', 'perception'] });
    expect(modern.proficiencies).toContain('skill:perception');
    expect(validateCreation(modern, policy)).toEqual([]);
    const allocation = modern.creation as DndAllocation;
    const overlap = syncAllocation({
      ...modern,
      creation: { ...allocation, ancestrySkills: ['perception'] },
    });
    expect(replacementCount(overlap)).toBe(0);
    expect(overlap.proficiencies.filter((key) => key === 'skill:perception')).toHaveLength(1);
    expect(validateCreation(overlap, policy)).toEqual([]);
    const forged = {
      ...modern,
      creation: {
        ...allocation,
        backgroundSkills: ['insight', 'stealth'],
        ancestrySkills: ['arcana'],
      },
    };
    expect(validateCreation(forged, policy)).toEqual(
      expect.arrayContaining([
        '警卫的技能熟练由 2024 背景固定授予',
        '种族自选技能须符合当前种族的选择范围',
      ]),
    );
  });

  it('round-trips configurations and archives and detects mixed editions in a room', async () => {
    const modern = room('2024');
    const config = roomConfiguration(modern);
    expect(parseRoomConfig(exportRoomConfig(config, 'md'))).toEqual(config);
    expect(config.dndEdition).toBe('2024');
    expect(
      parseRoomConfig(exportRoomConfig(roomConfiguration(room()), 'json')).dndEdition,
    ).toBeUndefined();
    expect(() =>
      parseRoomConfig(
        JSON.stringify({
          ...config,
          rule: 'coc',
          creationPolicy: defaultCreationPolicy('coc'),
        }),
      ),
    ).toThrow('规则版次仅适用于 D&D');
    expect(validRoomReferences(roomSchema.parse(modern))).toBe(true);
    const mixed = { ...modern, dndCards: [createDndStatBlock()] };
    expect(validRoomReferences(roomSchema.parse(mixed))).toBe(false);
    const mixedCharacter = structuredClone(modern);
    mixedCharacter.members[1].character = card('2014');
    expect(validRoomReferences(roomSchema.parse(mixedCharacter))).toBe(false);

    const zip = await exportArchive(modern, {}, createdAt);
    const restored = readArchive(zip).room;
    expect(archiveSummary(restored, createdAt).dndEdition).toBe('2024');
    expect(restored.members[1].character?.passivePerceptionEnabled).toBe(true);
    expect(restored.dndCards[0].dndEdition).toBe('2024');
    expect(strFromU8(unzipSync(zip)['context.md'])).toContain('D&D 5e (2024)');
    const legacy = readArchive(await exportArchive(room(), {}, createdAt)).room;
    expect(legacy.dndEdition).toBeUndefined();
    expect(archiveSummary(legacy, createdAt).dndEdition).toBe('2014');
  });

  it('preserves combat request identity in private backups and redacts the private roll in player projections', async () => {
    const current = room();
    const event: RoomEvent = {
      id: 'e1',
      type: 'system',
      memberId: 'host',
      name: '主持人',
      content: '私密伤害',
      createdAt,
      visibility: 'host',
      requestId: 'retry-1',
      combatRequestHash: 'a'.repeat(64),
      secretLabel: '伤害暗骰',
      roll: rollDice('1d6+3', () => 4),
    };
    current.log = [event];
    expect(visibleEvent(event, true)).not.toHaveProperty('combatRequestHash');
    expect(visibleEvent(event, false)).toMatchObject({ secret: { label: '伤害暗骰' } });
    expect(visibleEvent(event, false)).not.toHaveProperty('roll');
    expect(readArchive(await exportArchive(current, {}, createdAt)).room.log[0]).toEqual(event);
    const tampered = { ...event, roll: { ...event.roll!, total: 80 } };
    const forged = await exportArchive({ ...current, log: [tampered] }, {}, createdAt);
    expect(() => readArchive(forged)).toThrow('记录或遭遇引用无效');
    expect(validRoomReferences({ ...current, log: [event, { ...event, id: 'e2' }] })).toBe(false);
  });
});

describe('D&D stat block edition provenance', () => {
  it('keeps 2024 examples and mixed private collections distinct', () => {
    const cards = parseDndStatBlocks(getDndImportTemplate('2024'));
    expect(cards.map(({ dndEdition }) => dndEdition)).toEqual(['2024', '2024']);
    expect(parseDndStatBlocks(getDndExtractionPrompt('2024'))[0].dndEdition).toBe('2024');
    const legacy = createDndStatBlock();
    const modern = duplicateDndStatBlock(cards[0]);
    expect(modern.dndEdition).toBe('2024');
    const md = dndCollectionMD([legacy, modern]);
    expect(md).toContain('2014 / 2024');
    expect(parseDndStatBlocks(md)).toEqual([legacy, modern]);
  });

  it('rejects an explicit source card edition that conflicts with its batch', () => {
    expect(() =>
      parseDndStatBlocks(
        JSON.stringify({
          schemaVersion: 1,
          documentType: 'dnd-source',
          rule: 'dnd',
          dndEdition: '2024',
          cards: [{ name: '旧守卫', kind: 'npc', dndEdition: '2014' }],
        }),
      ),
    ).toThrow('版次不匹配');
  });
});
