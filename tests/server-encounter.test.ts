import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { defaultCreationPolicy, suggestAllocation } from '../shared/creation.ts';
import { createAtlas } from '../shared/atlas.ts';
import { createDndStatBlock } from '../shared/dnd.ts';
import { createDndMagicState } from '../shared/dnd-magic.ts';
import { createDndEquipmentState, itemFromEquipmentCatalog } from '../shared/dnd-equipment.ts';
import { parseEquipmentCatalog } from '../shared/equipment-catalog.ts';
import { createKeeperCard } from '../shared/keeper.ts';
import {
  exportEncounterPlans,
  parseEncounterPlans,
  type EncounterPlan,
} from '../shared/preparation.ts';
import { roomConfiguration } from '../shared/room-config.ts';
import { deriveCharacter } from '../shared/rules.ts';
import { createAppServer, type ServerOptions } from '../server/app.ts';
import type {
  Ack,
  Character,
  DndEdition,
  Room,
  RoomAction,
  RoomConnection,
  Session,
} from '../shared/types.ts';

const clients: Socket[] = [];
const servers: ReturnType<typeof createAppServer>[] = [];
const directories: string[] = [];
function character(rule: 'dnd' | 'coc' = 'dnd', dndEdition?: DndEdition): Character {
  const date = new Date().toISOString();
  const base: Character = {
    schemaVersion: 1,
    id: 'char-test',
    rule,
    ...(dndEdition ? { dndEdition } : {}),
    name: '艾琳',
    occupation: rule === 'dnd' ? '战士' : '教授',
    ancestry: '人类',
    background: '旅行者',
    age: 25,
    level: 1,
    attributes:
      rule === 'dnd'
        ? { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }
        : { str: 50, con: 50, siz: 50, dex: 60, app: 50, int: 60, pow: 60, edu: 60, luck: 50 },
    skills: rule === 'dnd' ? { athletics: 4 } : { spotHidden: 50 },
    proficiencies: rule === 'dnd' ? ['skill:athletics'] : [],
    hp: 12,
    maxHp: 12,
    mp: rule === 'dnd' ? 0 : 12,
    maxMp: rule === 'dnd' ? 0 : 12,
    san: rule === 'dnd' ? 0 : 60,
    maxSan: rule === 'dnd' ? 0 : 99,
    ac: 16,
    backstory: '',
    notes: '',
    traits: [],
    items: [],
    createdAt: date,
    updatedAt: date,
  };
  return suggestAllocation(deriveCharacter(base), defaultCreationPolicy(rule));
}
async function setup(options: ServerOptions = {}) {
  const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), 'interlude-encounter-'));
  if (!directories.includes(dataDir)) directories.push(dataDir);
  const server = createAppServer({
    ...options,
    dataDir,
    rng: options.rng ?? ((sides) => Math.floor(sides / 2) + 1),
  });
  servers.push(server);
  const port = await server.listen();
  const url = `http://127.0.0.1:${port}`;
  return { server, url, dataDir };
}
async function client(url: string) {
  const socket = io(url, { transports: ['websocket'], reconnection: false, forceNew: true });
  clients.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}
function ack<T>(socket: Socket, event: string, input: unknown): Promise<Ack<T>> {
  return new Promise((resolve, reject) =>
    socket
      .timeout(3000)
      .emit(event, input, (error: Error | null, result: Ack<T>) =>
        error ? reject(error) : resolve(result),
      ),
  );
}
async function success<T>(socket: Socket, event: string, input: unknown): Promise<T> {
  const result = await ack<T>(socket, event, input);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
const action = (socket: Socket, value: RoomAction) => success<null>(socket, 'room:action', value);
const create = (
  socket: Socket,
  rule: 'dnd' | 'coc' = 'dnd',
  mode: 'in-room' | 'external' = 'in-room',
  dndEdition?: DndEdition,
) =>
  success<RoomConnection>(socket, 'room:create', {
    name: '余烬旅店',
    nickname: '主持人',
    rule,
    mode,
    dndEdition,
  });
const joinRoom = (
  socket: Socket,
  code: string,
  rule: 'dnd' | 'coc' = 'dnd',
  dndEdition?: DndEdition,
) => success<RoomConnection>(socket, 'room:join', { code, nickname: '玩家', rule, dndEdition });
function nextState(socket: Socket, predicate: (room: Room) => boolean = () => true) {
  return new Promise<Room>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('room:state', listener);
      reject(new Error('未收到房间状态'));
    }, 3000);
    const listener = (room: Room) => {
      if (predicate(room)) {
        clearTimeout(timer);
        socket.off('room:state', listener);
        resolve(room);
      }
    };
    socket.on('room:state', listener);
  });
}
async function approve(host: Socket, player: Socket, session: Session) {
  const { room } = await success<RoomConnection>(player, 'room:resume', session);
  const member = room.members.find((entry) => entry.id === session.memberId)!;
  await action(host, {
    type: 'review-character',
    memberId: member.id,
    decision: 'approved',
    note: '审核通过',
    characterRevision: member.characterRevision,
    policyRevision: room.policyRevision,
  });
}
async function activeRoom(
  url: string,
  mode: 'in-room' | 'external' = 'in-room',
  dndEdition?: DndEdition,
) {
  const host = await client(url);
  const player = await client(url);
  const hostConnection = await create(host, 'dnd', mode, dndEdition);
  const playerConnection = await joinRoom(player, hostConnection.room.code, 'dnd', dndEdition);
  await action(player, { type: 'character', character: character('dnd', dndEdition) });
  await action(player, { type: 'ready', ready: true });
  await action(host, { type: 'ready', ready: true });
  await approve(host, player, playerConnection.session);
  await action(host, { type: 'start' });
  return { host, player, hostConnection, playerConnection };
}
afterEach(async () => {
  clients.splice(0).forEach((socket) => socket.disconnect());
  for (const server of servers.splice(0)) await server.close();
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
});

const snapshot = async (socket: Socket, session: Session) =>
  (await success<RoomConnection>(socket, 'room:resume', session)).room;
const rejected = async (socket: Socket, value: unknown) => {
  const result = await ack(socket, 'room:action', value);
  expect(result.ok).toBe(false);
  return !result.ok ? result.error : '';
};
async function pair(rule: 'dnd' | 'coc' = 'dnd', options?: ServerOptions, dndEdition?: DndEdition) {
  const environment = await setup(options);
  const host = await client(environment.url),
    player = await client(environment.url);
  const h = await create(host, rule, 'in-room', dndEdition),
    p = await joinRoom(player, h.room.code, rule, dndEdition);
  return { ...environment, host, player, h, p };
}

function diceSequence(...values: number[]) {
  return vi.fn((_sides: number) => {
    const value = values.shift();
    if (value === undefined) throw new Error('骰序列已用完');
    return value;
  });
}

async function startParty(
  host: Socket,
  players: { socket: Socket; session: Session; card: Character }[],
) {
  for (const { socket, session, card } of players) {
    await action(socket, { type: 'character', character: card });
    await approve(host, socket, session);
    await action(socket, { type: 'ready', ready: true });
  }
  await action(host, { type: 'ready', ready: true });
  await action(host, { type: 'start' });
}

function runtimeSelection(room: Room, session: Session) {
  const member = room.members.find((m) => m.id === session.memberId)!;
  return {
    memberId: member.id,
    characterId: member.character!.id,
    expectedCharacterRevision: member.characterRevision,
  };
}

async function restoreDndRoom(url: string, session: Session, edition?: DndEdition) {
  const archived = await fetch(`${url}/api/rooms/${session.roomCode}/archive`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${session.token}`,
      'x-interlude-member': session.memberId,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ descriptions: {} }),
  });
  expect(archived.status).toBe(200);
  const restored = await fetch(`${url}/api/archives/restore`, {
    method: 'POST',
    headers: {
      'content-type': 'application/zip',
      'x-interlude-nickname': 'DM',
      'x-interlude-rule': 'dnd',
      ...(edition ? { 'x-interlude-dnd-edition': edition } : {}),
    },
    body: Buffer.from(await archived.arrayBuffer()),
  });
  if (restored.status !== 201) throw new Error(await restored.text());
  return (await restored.json()) as RoomConnection;
}

describe('authoritative encounter and private D&D library', () => {
  it('filters private libraries and hidden NPCs from join, resume and raw broadcast payloads', async () => {
    const { url, host, player, h, p } = await pair();
    const secret = {
      ...createDndStatBlock('npc-bridge-guard'),
      name: '真实秘密名字',
      notes: '私密线索',
      spellcasting: '秘密法术',
    };
    const broadcasts: Room[] = [];
    player.on('room:state', (room) => broadcasts.push(room));
    await action(host, { type: 'dnd-save', cards: [secret] });
    await action(host, { type: 'encounter-add', cardId: secret.id, count: 2 });
    const room = await snapshot(host, h.session);
    expect(room.dndCards).toHaveLength(1);
    expect(room.encounter.participants).toHaveLength(2);
    expect((await snapshot(player, p.session)).encounter.participants).toEqual([]);
    const another = await client(url);
    const joined = await joinRoom(another, h.room.code);
    expect(JSON.stringify(joined.room)).not.toContain(secret.id);
    const first = room.encounter.participants[0];
    await action(host, {
      type: 'encounter-update',
      combatantId: first.id,
      expectedRevision: room.encounter.revision,
      patch: {
        revealed: true,
        publicName: '桥头守卫',
        notes: '参战私密备注',
        concentration: '隐秘专注',
        tempHp: 3,
      },
    });
    const visible = await snapshot(player, p.session);
    expect(visible.encounter.participants).toHaveLength(1);
    expect(visible.encounter.participants[0]).toMatchObject({
      name: '桥头守卫',
      source: null,
      sourceCardId: null,
      hp: null,
      maxHp: null,
      dex: null,
      ac: null,
      notes: '',
      concentration: '',
      tempHp: 0,
      abilities: [],
    });
    for (const state of broadcasts) {
      expect(JSON.stringify(state)).not.toMatch(
        /真实秘密名字|私密线索|秘密法术|参战私密备注|隐秘专注/,
      );
      expect(state.dndCards).toEqual([]);
    }
  });

  it('rejects player impersonation, malformed payloads, wrong-rule operations and duplicate card IDs', async () => {
    const { host, player } = await pair();
    const card = createDndStatBlock();
    for (const value of [
      { type: 'dnd-save', cards: [card] },
      { type: 'dnd-delete', cardId: card.id },
      { type: 'encounter-add', cardId: card.id, count: 1 },
      { type: 'encounter-clear' },
      { type: 'encounter-remove', combatantId: 'unknown' },
      { type: 'encounter-update', combatantId: 'unknown', expectedRevision: 0, patch: { hp: 0 } },
      {
        type: 'coc-melee',
        attacker: 'a',
        defender: 'b',
        attackSkill: 50,
        defenseSkill: 50,
        defense: 'dodge',
        attackEdge: 'normal',
        defenseEdge: 'normal',
        visibility: 'public',
      },
    ])
      expect(await rejected(player, value)).toContain('主持人');
    await rejected(player, { type: 'dnd-save', cards: [card], role: 'host' });
    await rejected(host, { type: 'dnd-save', cards: [card, card] });
    await rejected(host, { type: 'dnd-save', cards: [{ ...card, extra: 'smuggled' }] });
    await rejected(host, { type: 'dnd-save', cards: [createKeeperCard('npc-bystander')] });
    expect(
      await rejected(host, { type: 'keeper-save', cards: [createKeeperCard('npc-bystander')] }),
    ).toContain('CoC');
    const coc = await pair('coc');
    expect(await rejected(coc.host, { type: 'dnd-save', cards: [card] })).toContain('D&D');
    expect(
      await rejected(host, {
        type: 'coc-melee',
        attacker: 'a',
        defender: 'b',
        attackSkill: 50,
        defenseSkill: 50,
        defense: 'dodge',
        attackEdge: 'normal',
        defenseEdge: 'normal',
        visibility: 'public',
      }),
    ).toContain('CoC');
  });

  it('keeps cloned NPC HP, conditions and ability counters independent of siblings and templates', async () => {
    const { host, h } = await pair();
    const card = createDndStatBlock('npc-bridge-guard');
    card.actions[0].uses = 3;
    await action(host, { type: 'dnd-save', cards: [card] });
    await action(host, { type: 'encounter-add', cardId: card.id, count: 2 });
    let room = await snapshot(host, h.session);
    const [first, second] = room.encounter.participants;
    expect(first.id).not.toBe(second.id);
    const abilities = first.abilities.map((a) => ({ ...a, remaining: 1 }));
    await action(host, {
      type: 'encounter-update',
      combatantId: first.id,
      expectedRevision: room.encounter.revision,
      patch: { hp: 1, conditions: ['倒地'], abilities },
    });
    await action(host, {
      type: 'dnd-save',
      cards: [{ ...card, name: '后续新模板', hp: 2, maxHp: 2 }],
    });
    await action(host, { type: 'dnd-delete', cardId: card.id });
    room = await snapshot(host, h.session);
    expect(room.dndCards).toEqual([]);
    expect(room.encounter.participants[0]).toMatchObject({ hp: 1, conditions: ['倒地'] });
    expect(room.encounter.participants[1]).toMatchObject({ hp: card.hp, conditions: [] });
    expect(room.encounter.participants[0].abilities[0].remaining).toBe(1);
    expect(room.encounter.participants[1].abilities[0].remaining).toBe(3);
    expect(room.encounter.participants[0].source?.name).toBe(card.name);
  });

  it('synchronizes player HP both ways, invalidates lobby review and rejects stale or base-stat patches', async () => {
    const { host, player, h, p } = await pair();
    await action(player, { type: 'character', character: character() });
    await approve(host, player, p.session);
    await action(player, { type: 'ready', ready: true });
    let room = await snapshot(host, h.session);
    const revision = room.encounter.revision;
    await action(host, {
      type: 'encounter-update',
      combatantId: p.session.memberId,
      expectedRevision: revision,
      patch: { hp: 1 },
    });
    room = await snapshot(host, h.session);
    const m = room.members.find((m) => m.id === p.session.memberId)!;
    expect(m.character!.hp).toBe(1);
    expect(m.ready).toBe(false);
    expect(m.review.status).toBe('pending');
    expect(room.encounter.participants[0].hp).toBe(1);
    expect(
      await rejected(host, {
        type: 'encounter-update',
        combatantId: p.session.memberId,
        expectedRevision: revision,
        patch: { hp: 2 },
      }),
    ).toContain('更新');
    for (const patch of [
      { maxHp: 1000 },
      { dex: 30 },
      { hp: null },
      { name: '越权' },
      { hp: m.character!.maxHp + 1 },
    ])
      await rejected(host, {
        type: 'encounter-update',
        combatantId: p.session.memberId,
        expectedRevision: room.encounter.revision,
        patch,
      });
    await action(player, {
      type: 'resource',
      memberId: p.session.memberId,
      resource: 'hp',
      value: 2,
    });
    room = await snapshot(host, h.session);
    expect(room.encounter.participants[0].hp).toBe(2);
    await rejected(host, { type: 'encounter-remove', combatantId: p.session.memberId });
  });

  it('uses independent combatants in initiative and preserves the legacy player projection', async () => {
    const { url } = await setup();
    const { host, player, hostConnection: h, playerConnection: p } = await activeRoom(url);
    const card = createDndStatBlock('npc-bridge-guard');
    await action(host, { type: 'dnd-save', cards: [card] });
    await action(host, { type: 'encounter-add', cardId: card.id, count: 2 });
    let room = await snapshot(host, h.session);
    const npc = room.encounter.participants.find((c) => c.memberId === null)!;
    await action(host, {
      type: 'encounter-update',
      combatantId: npc.id,
      expectedRevision: room.encounter.revision,
      patch: { initiativeOverride: 100 },
    });
    await action(host, { type: 'initiative' });
    room = await snapshot(host, h.session);
    expect(room.encounter.activeId).toBe(npc.id);
    expect(room.encounter.participants).toHaveLength(3);
    expect(room.initiative).toEqual([{ memberId: p.session.memberId, value: 13 }]);
    expect(room.round).toBe(1);
    const privateTurn = await snapshot(player, p.session);
    expect(privateTurn.encounter.activeId).toBeNull();
    for (let i = 0; i < 3; i++) await action(host, { type: 'next-turn' });
    expect((await snapshot(host, h.session)).round).toBe(2);
  });

  it('hands private libraries and NPC progress to the new host and removes promoted or departed players', async () => {
    const { host, player, h, p } = await pair();
    const card = { ...createDndStatBlock('npc-bridge-guard'), notes: '主持人秘密' };
    await action(player, { type: 'character', character: character() });
    await action(host, { type: 'dnd-save', cards: [card] });
    await action(host, { type: 'encounter-add', cardId: card.id, count: 1 });
    let room = await snapshot(host, h.session);
    const npc = room.encounter.participants.find((c) => c.memberId === null)!;
    await action(host, {
      type: 'encounter-update',
      combatantId: npc.id,
      expectedRevision: room.encounter.revision,
      patch: { hp: 1 },
    });
    await action(host, { type: 'transfer-host', memberId: p.session.memberId });
    room = await snapshot(player, p.session);
    expect(room.dndCards[0].notes).toBe('主持人秘密');
    expect(room.encounter.participants).toHaveLength(1);
    expect(room.encounter.participants[0].hp).toBe(1);
    expect(room.members.find((m) => m.id === p.session.memberId)!.character).not.toBeNull();
    expect(JSON.stringify(await snapshot(host, h.session))).not.toContain('主持人秘密');
    await rejected(host, { type: 'dnd-delete', cardId: card.id });
    await action(host, { type: 'character', character: character() });
    expect((await snapshot(player, p.session)).encounter.participants).toHaveLength(2);
    await action(host, { type: 'leave' });
    expect((await snapshot(player, p.session)).encounter.participants).toHaveLength(1);
  });

  it('preserves templates, independent HP and player privacy over restart', async () => {
    const { host, player, h, p, server, dataDir } = await pair();
    const card = { ...createDndStatBlock('npc-bridge-guard'), notes: '重启秘密' };
    await action(host, { type: 'dnd-save', cards: [card] });
    await action(host, { type: 'encounter-add', cardId: card.id, count: 2 });
    let room = await snapshot(host, h.session);
    await action(host, {
      type: 'encounter-update',
      combatantId: room.encounter.participants[0].id,
      expectedRevision: room.encounter.revision,
      patch: { hp: 1 },
    });
    host.disconnect();
    player.disconnect();
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    const restarted = await setup({ dataDir });
    const newHost = await client(restarted.url),
      newPlayer = await client(restarted.url);
    room = await snapshot(newHost, h.session);
    expect(room.dndCards).toHaveLength(1);
    expect(room.encounter.participants.map((c) => c.hp)).toEqual([1, card.hp]);
    expect(room.members.find((m) => m.id === p.session.memberId)!.online).toBe(false);
    expect(JSON.stringify(await snapshot(newPlayer, p.session))).not.toContain('重启秘密');
  });

  it('migrates newly added fields without resetting active phase, approval or the CoC private library', async () => {
    const { url, server, dataDir } = await setup();
    const { host, player, hostConnection: h, playerConnection: p } = await activeRoom(url);
    host.disconnect();
    player.disconnect();
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    const saved = JSON.parse(readFileSync(join(dataDir, 'rooms.json'), 'utf8'));
    delete saved[0].room.dndCards;
    delete saved[0].room.encounter;
    writeFileSync(join(dataDir, 'rooms.json'), JSON.stringify(saved));
    const restarted = await setup({ dataDir });
    const newHost = await client(restarted.url);
    const room = await snapshot(newHost, h.session);
    expect(room.phase).toBe('active');
    expect(room.members.find((m) => m.id === p.session.memberId)!.review.status).toBe('approved');
    expect(room.dndCards).toEqual([]);
    expect(room.encounter.participants).toEqual([]);
    // Independently exercise existing CoC templates under the same migration.
    const coc = await pair('coc');
    const card = createKeeperCard('npc-bystander');
    await action(coc.host, { type: 'keeper-save', cards: [card] });
    await coc.server.close();
    servers.splice(servers.indexOf(coc.server), 1);
    const cocSaved = JSON.parse(readFileSync(join(coc.dataDir, 'rooms.json'), 'utf8'));
    delete cocSaved[0].room.dndCards;
    delete cocSaved[0].room.encounter;
    writeFileSync(join(coc.dataDir, 'rooms.json'), JSON.stringify(cocSaved));
    const cocRestart = await setup({ dataDir: coc.dataDir });
    const cocHost = await client(cocRestart.url);
    expect((await snapshot(cocHost, coc.h.session)).keeperCards[0].id).toBe(card.id);
  });

  it.each(['rule', 'member', 'duplicate', 'active'] as const)(
    'rejects corrupted saved combatant %s instead of broadcasting it',
    async (corruption) => {
      const { host, player, h, p, server, dataDir } = await pair();
      const card = createDndStatBlock('npc-bridge-guard');
      await action(host, { type: 'dnd-save', cards: [card] });
      await action(host, { type: 'encounter-add', cardId: card.id, count: 1 });
      host.disconnect();
      player.disconnect();
      await server.close();
      servers.splice(servers.indexOf(server), 1);
      const saved = JSON.parse(readFileSync(join(dataDir, 'rooms.json'), 'utf8'));
      const encounter = saved[0].room.encounter;
      if (corruption === 'rule') encounter.participants[0].rule = 'coc';
      if (corruption === 'member') {
        encounter.participants[0] = {
          ...encounter.participants[0],
          id: 'missing-member',
          kind: 'player',
          memberId: 'missing-member',
          source: null,
          sourceCardId: null,
        };
      }
      if (corruption === 'duplicate') encounter.participants.push(encounter.participants[0]);
      if (corruption === 'active') encounter.activeId = 'missing-active';
      writeFileSync(join(dataDir, 'rooms.json'), JSON.stringify(saved));
      const restarted = await setup({ dataDir });
      const socket = await client(restarted.url);
      expect((await ack(socket, 'room:resume', h.session)).ok).toBe(false);
      expect((await ack(socket, 'room:resume', p.session)).ok).toBe(false);
    },
  );

  it('enforces batch and encounter count limits atomically and clear advances revision', async () => {
    const { host, h } = await pair();
    const card = createDndStatBlock('npc-bridge-guard');
    await action(host, { type: 'dnd-save', cards: [card] });
    for (const count of [0, 21, 1.5])
      await rejected(host, { type: 'encounter-add', cardId: card.id, count });
    for (let i = 0; i < 3; i++)
      await action(host, { type: 'encounter-add', cardId: card.id, count: 20 });
    let room = await snapshot(host, h.session);
    expect(room.encounter.participants).toHaveLength(60);
    await rejected(host, { type: 'encounter-add', cardId: card.id, count: 1 });
    expect((await snapshot(host, h.session)).encounter.participants).toHaveLength(60);
    await rejected(host, {
      type: 'dnd-save',
      cards: Array.from({ length: 201 }, (_, i) => ({ ...card, id: `batch-${i}` })),
    });
    expect((await snapshot(host, h.session)).dndCards).toHaveLength(1);
    const revision = room.encounter.revision;
    await action(host, { type: 'encounter-clear' });
    room = await snapshot(host, h.session);
    expect(room.encounter.participants).toEqual([]);
    expect(room.encounter.revision).toBeGreaterThan(revision);
  });

  it('CoC opposed checks respect hidden logs and only produce advice, with no automatic HP changes', async () => {
    const { host, player, h, p } = await pair('coc');
    const card = createKeeperCard('npc-bystander');
    await action(host, { type: 'keeper-save', cards: [card] });
    await action(host, { type: 'encounter-add', cardId: card.id, count: 2 });
    const before = await snapshot(host, h.session);
    const duel: RoomAction = {
      type: 'coc-melee',
      attacker: '进攻方',
      defender: '防守方',
      attackSkill: 80,
      defenseSkill: 20,
      defense: 'dodge',
      attackEdge: 'normal',
      defenseEdge: 'normal',
      visibility: 'host',
    };
    await action(host, duel);
    let room = await snapshot(host, h.session);
    const result = room.log.at(-1)!;
    expect(result.visibility).toBe('host');
    expect(result.content).toMatch(/55／80.*55／20.*不自动扣除 HP/);
    expect(room.encounter.participants.map((c) => c.hp)).toEqual(
      before.encounter.participants.map((c) => c.hp),
    );
    expect((await snapshot(player, p.session)).log.find((e) => e.id === result.id)).toMatchObject({
      type: 'check',
      secret: { label: '近战对抗' },
      content: '近战对抗 = ？ · 结果 ？',
    });
    await action(host, { ...duel, visibility: 'public' });
    room = await snapshot(player, p.session);
    expect(room.log.at(-1)!.content).toContain('不自动扣除 HP');
    expect(JSON.stringify(room)).not.toContain(card.name);
  });
  it('rolls back character, HP, new instances and kicks when atomic persistence fails', async () => {
    const { host, player, h, p, dataDir } = await pair();
    const card = createDndStatBlock('npc-bridge-guard');
    await action(player, { type: 'character', character: character() });
    await action(host, { type: 'dnd-save', cards: [card] });
    const before = await snapshot(host, h.session);
    // Drain older broadcasts on this transport before observing failed writes.
    await snapshot(player, p.session);
    const beforeDisk = readFileSync(join(dataDir, 'rooms.json'), 'utf8');
    const blockingDirectory = join(dataDir, `rooms.json.${process.pid}.tmp`);
    mkdirSync(blockingDirectory);
    let broadcastCount = 0,
      leftCount = 0;
    player.on('room:state', () => broadcastCount++);
    player.on('room:left', () => leftCount++);
    const changes: Array<[Socket, RoomAction]> = [
      [player, { type: 'character', character: { ...character(), name: '失败的新名字' } }],
      [player, { type: 'resource', memberId: p.session.memberId, resource: 'hp', value: 1 }],
      [
        host,
        {
          type: 'encounter-update',
          combatantId: p.session.memberId,
          expectedRevision: before.encounter.revision,
          patch: { hp: 1 },
        },
      ],
      [host, { type: 'encounter-add', cardId: card.id, count: 2 }],
      [host, { type: 'kick', memberId: p.session.memberId }],
    ];
    try {
      for (const [socket, change] of changes)
        expect(await rejected(socket, change)).toContain('存档保存失败');
      expect(readFileSync(join(dataDir, 'rooms.json'), 'utf8')).toBe(beforeDisk);
      expect(broadcastCount).toBe(0);
      expect(leftCount).toBe(0);
    } finally {
      rmSync(blockingDirectory, { recursive: true });
    }
    expect(await snapshot(host, h.session)).toEqual(before);
    expect((await snapshot(player, p.session)).members).toHaveLength(2);
  });

  it('rejects overflowing player synchronization without changing the character or encounter', async () => {
    const { host, player, h, p } = await pair();
    const card = createDndStatBlock('npc-bridge-guard');
    await action(host, { type: 'dnd-save', cards: [card] });
    for (let i = 0; i < 3; i++)
      await action(host, { type: 'encounter-add', cardId: card.id, count: 20 });
    expect(await rejected(player, { type: 'character', character: character() })).toContain('60');
    const room = await snapshot(host, h.session);
    expect(room.members.find((m) => m.id === p.session.memberId)!.character).toBeNull();
    expect(room.encounter.participants).toHaveLength(60);
  });

  it('preserves large legal snapshot batches beyond incoming-action limits', async () => {
    const { host, h, dataDir } = await pair();
    const card = createDndStatBlock('npc-bridge-guard');
    card.actions = Array.from({ length: 50 }, (_, i) => ({
      ...card.actions[0],
      id: `action-${i}`,
      description: '大型资料'.repeat(750),
    }));
    await action(host, { type: 'dnd-save', cards: [card] });
    await action(host, { type: 'encounter-add', cardId: card.id, count: 20 });
    const room = await snapshot(host, h.session);
    expect(room.encounter.participants).toHaveLength(20);
    expect(Buffer.byteLength(JSON.stringify(room), 'utf8')).toBeGreaterThan(8 * 1024 * 1024);
    expect(
      JSON.parse(readFileSync(join(dataDir, 'rooms.json'), 'utf8'))[0].room.encounter.participants,
    ).toHaveLength(20);
  });

  it('keeps NPC turn progress through explicit host departure and automatically transfers private access', async () => {
    const { url } = await setup();
    const { host, player, hostConnection: h, playerConnection: p } = await activeRoom(url);
    const card = { ...createDndStatBlock('npc-bridge-guard'), notes: '继任私密资料' };
    await action(host, { type: 'dnd-save', cards: [card] });
    await action(host, { type: 'encounter-add', cardId: card.id, count: 1 });
    let room = await snapshot(host, h.session);
    const npc = room.encounter.participants.find((c) => c.memberId === null)!;
    await action(host, {
      type: 'encounter-update',
      combatantId: npc.id,
      expectedRevision: room.encounter.revision,
      patch: { hp: 1, initiativeOverride: 100 },
    });
    await action(host, { type: 'initiative' });
    await action(host, { type: 'leave' });
    room = await snapshot(player, p.session);
    expect(room.hostId).toBe(p.session.memberId);
    expect(room.phase).toBe('lobby');
    expect(room.encounter).toMatchObject({ activeId: npc.id, round: 1 });
    expect(room.encounter.participants).toHaveLength(1);
    expect(room.encounter.participants[0].hp).toBe(1);
    expect(room.dndCards[0].notes).toBe('继任私密资料');
  });

  it('correlates roll and check results with optional request IDs and preserves their privacy over restart', async () => {
    const { host, player, h, p, server, dataDir } = await pair();
    await action(host, {
      type: 'roll',
      expression: '1d20',
      visibility: 'host',
      requestId: 'private-roll',
    });
    await action(host, {
      type: 'check',
      check: { kind: 'ability', key: 'str', target: 10, dc: 10, modifier: 2, edge: 'normal' },
      visibility: 'public',
      requestId: 'public-check',
    });
    const room = await snapshot(host, h.session);
    expect(room.log.find((e) => e.requestId === 'private-roll')!.roll).toBeDefined();
    expect(room.log.find((e) => e.requestId === 'public-check')!.check).toBeDefined();
    const playerRoom = await snapshot(player, p.session);
    expect(playerRoom.log.some((e) => e.requestId === 'private-roll')).toBe(false);
    expect(playerRoom.log.some((e) => e.requestId === 'public-check')).toBe(true);
    await rejected(host, { type: 'roll', expression: '1d20', visibility: 'public', requestId: '' });
    host.disconnect();
    player.disconnect();
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    const restarted = await setup({ dataDir });
    const resumedHost = await client(restarted.url),
      resumedPlayer = await client(restarted.url);
    expect(
      (await snapshot(resumedHost, h.session)).log.some((e) => e.requestId === 'private-roll'),
    ).toBe(true);
    expect(
      (await snapshot(resumedPlayer, p.session)).log.some((e) => e.requestId === 'private-roll'),
    ).toBe(false);
  });
});

describe('edition-aware initiative and automatic damage', () => {
  it('locks room, character and library editions, and records each 2024 initiative only once', async () => {
    const rng = diceSequence(18, 6, 10);
    const { url } = await setup({ rng });
    const {
      host,
      player,
      hostConnection: h,
      playerConnection: p,
    } = await activeRoom(url, 'in-room', '2024');
    const outsider = await client(url);
    expect(
      await ack(outsider, 'room:join', { code: h.room.code, nickname: '旧版', rule: 'dnd' }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('版次') });
    await action(host, { type: 'pause' });
    expect(await rejected(player, { type: 'character', character: character() })).toContain('版次');
    let room = await snapshot(host, h.session);
    const configuration = { ...roomConfiguration(room), dndEdition: '2014' as const };
    expect(
      await rejected(host, {
        type: 'room-config',
        configuration,
        expectedRevision: room.configRevision,
      }),
    ).toContain('版次');
    expect(
      await ack(outsider, 'room:create', {
        name: '错版',
        nickname: '主持',
        rule: 'dnd',
        dndEdition: '2024',
        mode: 'in-room',
        configuration,
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('版次') });
    expect(
      await rejected(host, { type: 'dnd-save', cards: [createDndStatBlock('npc-bridge-guard')] }),
    ).toContain('版次');
    const card = createDndStatBlock('npc-bridge-guard', '2024');
    await action(host, { type: 'dnd-save', cards: [card] });
    await action(host, { type: 'encounter-add', cardId: card.id, count: 1 });
    await approve(host, player, p.session);
    await action(player, { type: 'ready', ready: true });
    await action(host, { type: 'ready', ready: true });
    await action(host, { type: 'start' });
    room = await snapshot(host, h.session);
    const npc = room.encounter.participants.find((c) => c.memberId === null)!;
    for (const combatantId of [p.session.memberId, npc.id]) {
      await action(host, {
        type: 'encounter-update',
        combatantId,
        expectedRevision: room.encounter.revision,
        patch: { surprised: true },
      });
      room = await snapshot(host, h.session);
    }
    const order: RoomAction = {
      type: 'initiative',
      fillMissing: false,
      expectedRevision: room.encounter.revision,
    };
    expect(await rejected(host, order)).toContain('尚未掷先攻');
    const playerRoll: RoomAction = {
      type: 'encounter-initiative-roll',
      combatantId: p.session.memberId,
      edge: 'normal',
      bonus: 3,
      expectedRevision: room.encounter.revision,
      requestId: 'initiative-player',
    };
    expect(await rejected(host, playerRoll)).toContain('只为自己');
    expect(await rejected(player, { ...playerRoll, combatantId: npc.id })).toContain('只为自己');
    expect(rng).not.toHaveBeenCalled();
    await action(player, playerRoll);
    await action(player, playerRoll);
    room = await snapshot(host, h.session);
    expect(
      await rejected(player, {
        ...playerRoll,
        expectedRevision: room.encounter.revision,
        requestId: 'try-reroll',
      }),
    ).toContain('已记录');
    expect(
      room.encounter.participants.find((c) => c.memberId === p.session.memberId),
    ).toMatchObject({
      initiative: null,
      initiativeRoll: {
        rolls: [18, 6],
        selected: 6,
        dexModifier: 2,
        bonus: 3,
        edge: 'disadvantage',
        edition: '2024',
      },
    });
    await action(host, {
      ...playerRoll,
      combatantId: npc.id,
      edge: 'advantage',
      bonus: 0,
      expectedRevision: room.encounter.revision,
      requestId: 'initiative-npc',
    });
    room = await snapshot(host, h.session);
    expect(room.encounter.participants.find((c) => c.id === npc.id)?.initiativeRoll).toMatchObject({
      rolls: [10],
      edge: 'normal',
      requestedEdge: 'advantage',
    });
    const publicRoom = await snapshot(player, p.session);
    expect(publicRoom.log.some((event) => event.requestId === 'initiative-npc')).toBe(false);
    expect(publicRoom.log.filter((event) => event.requestId === 'initiative-player')).toHaveLength(
      1,
    );
    await action(host, { ...order, expectedRevision: room.encounter.revision });
    room = await snapshot(host, h.session);
    expect(room.encounter.participants.map((c) => [c.id, c.initiative, c.surprised])).toEqual([
      [p.session.memberId, 11, false],
      [npc.id, 11, false],
    ]);
    expect(room.encounter).toMatchObject({ activeId: p.session.memberId, round: 1 });
    await action(host, { type: 'next-turn' });
    room = await snapshot(host, h.session);
    await action(host, { ...order, expectedRevision: room.encounter.revision });
    expect((await snapshot(host, h.session)).encounter).toMatchObject({
      activeId: npc.id,
      round: 1,
    });
    expect(rng.mock.calls.flat()).toEqual([20, 20, 20]);
  });

  it('settles only D&D hits, doubles critical dice, and applies typed adjustments before temporary and player HP', async () => {
    const rng = diceSequence(1, 20, 4, 2, 3, 13);
    const { host, player, h, p } = await pair('dnd', { rng });
    await action(player, { type: 'character', character: character() });
    const card = { ...createDndStatBlock('npc-bridge-guard'), hp: 19 };
    await action(host, { type: 'dnd-save', cards: [card] });
    await action(host, { type: 'encounter-add', cardId: card.id, count: 2 });
    let room = await snapshot(host, h.session);
    const pc = p.session.memberId;
    const [attacker, sibling] = room.encounter.participants.filter((c) => c.memberId === null);
    const attack: RoomAction = {
      type: 'encounter-dnd-attack',
      attackerId: attacker.id,
      targetId: pc,
      edge: 'normal',
      modifier: 100,
      damage: { expression: '1d6+3', adjustment: 'resistant' },
      visibility: 'host',
      expectedRevision: room.encounter.revision,
      requestId: 'miss',
    };
    expect(await rejected(player, attack)).toContain('只有主持人');
    await action(host, {
      type: 'encounter-settings',
      expectedRevision: room.encounter.revision,
      autoDamage: true,
    });
    room = await snapshot(host, h.session);
    await action(host, {
      type: 'encounter-update',
      combatantId: pc,
      expectedRevision: room.encounter.revision,
      patch: { tempHp: 4 },
    });
    room = await snapshot(host, h.session);
    const characterRevision = room.members.find((m) => m.id === pc)!.characterRevision;
    await action(host, { ...attack, expectedRevision: room.encounter.revision });
    room = await snapshot(host, h.session);
    expect(room.log.at(-1)).toMatchObject({
      content: expect.stringContaining('未命中'),
      check: { selected: 1, success: false },
    });
    expect(room.log.at(-1)?.roll).toBeUndefined();
    expect(rng.mock.calls.flat()).toEqual([20]);
    await action(host, {
      ...attack,
      modifier: -100,
      expectedRevision: room.encounter.revision,
      requestId: 'critical',
    });
    room = await snapshot(host, h.session);
    expect(room.log.at(-1)).toMatchObject({
      check: { selected: 20, success: true },
      roll: { expression: '2d6+3', total: 9 },
      content: expect.stringContaining('临时 HP 吸收 4'),
    });
    expect(room.encounter.participants.find((c) => c.id === pc)).toMatchObject({
      hp: 12,
      tempHp: 0,
    });
    expect(room.members.find((m) => m.id === pc)?.characterRevision).toBe(characterRevision);
    const direct: RoomAction = {
      type: 'encounter-damage',
      targetId: pc,
      expression: '1d6+2',
      adjustment: 'resistant-vulnerable',
      visibility: 'public',
      expectedRevision: room.encounter.revision,
      requestId: 'direct',
    };
    await action(host, direct);
    room = await snapshot(player, p.session);
    expect(room.members.find((m) => m.id === pc)).toMatchObject({
      characterRevision: characterRevision + 1,
      character: { hp: 8 },
    });
    expect(room.log.at(-1)).toMatchObject({ content: expect.stringContaining('HP 12 → 8') });
    expect(room.log.at(-1)?.combatRequestHash).toBeUndefined();
    expect(await rejected(host, { ...direct, requestId: 'stale' })).toContain('战斗状态已更新');
    await action(host, {
      ...direct,
      targetId: attacker.id,
      expression: '3',
      adjustment: 'vulnerable',
      expectedRevision: room.encounter.revision,
      requestId: 'sibling-test',
    });
    room = await snapshot(host, h.session);
    expect(
      room.encounter.participants
        .filter((c) => c.id === attacker.id || c.id === sibling.id)
        .map((c) => c.hp),
    ).toEqual([13, 19]);
    const publicResult = (await snapshot(player, p.session)).log.at(-1)!;
    expect(publicResult.content).toContain('未公开参战者');
    expect(publicResult.content).not.toContain('HP 19');
    await action(host, {
      type: 'encounter-settings',
      autoDamage: false,
      expectedRevision: room.encounter.revision,
    });
    room = await snapshot(host, h.session);
    await action(host, {
      ...attack,
      expectedRevision: room.encounter.revision,
      requestId: 'automatic-off',
    });
    room = await snapshot(host, h.session);
    expect(room.log.at(-1)).toMatchObject({
      check: { success: true },
      content: expect.stringContaining('未自动扣除 HP'),
    });
    expect(room.log.at(-1)?.roll).toBeUndefined();
    expect(room.encounter.participants.find((c) => c.id === pc)?.hp).toBe(8);
    expect(rng.mock.calls.flat()).toEqual([20, 20, 6, 6, 6, 20]);
  });

  it('applies CoC armor to the actual loser, preserves unresolved extreme damage, and flags major wounds and dying', async () => {
    const rng = diceSequence(8, 4, 2, 3, 5, 1, 2, 1, 7, 1, 2, 1, 7, 8, 4, 9, 4);
    const { host, player, h, p } = await pair('coc', { rng });
    const card = { ...createKeeperCard('npc-bystander'), hp: 9, maxHp: 10, armor: 2 };
    await action(host, { type: 'keeper-save', cards: [card] });
    await action(host, { type: 'encounter-add', cardId: card.id, count: 2 });
    let room = await snapshot(host, h.session);
    const [attacker, defender] = room.encounter.participants;
    await action(host, {
      type: 'encounter-settings',
      expectedRevision: room.encounter.revision,
      autoDamage: true,
    });
    room = await snapshot(host, h.session);
    const duel = {
      type: 'coc-melee',
      attacker: '手填进攻方',
      defender: '手填防守方',
      attackSkill: 50,
      defenseSkill: 80,
      defense: 'fight-back',
      attackEdge: 'normal',
      defenseEdge: 'normal',
      visibility: 'host',
      damage: {
        attackerId: attacker.id,
        defenderId: defender.id,
        attackExpression: '1d6',
        fightBackExpression: '1d6+3',
        expectedRevision: room.encounter.revision,
        requestId: 'counter',
      },
    } satisfies RoomAction;
    await action(host, duel);
    room = await snapshot(host, h.session);
    expect(room.encounter.participants[0]).toMatchObject({ hp: 3, majorWound: true, dying: false });
    expect(room.encounter.participants[1]).toMatchObject({ hp: 9, majorWound: false });
    expect(room.log.at(-1)).toMatchObject({
      content: expect.stringMatching(/反击.*结算 6 点伤害.*护甲 2 抵消 2.*重伤.*CON/),
    });
    const playerLog = (await snapshot(player, p.session)).log.at(-1)!;
    expect(playerLog).toMatchObject({ secret: { label: '近战对抗' } });
    expect(playerLog.roll).toBeUndefined();
    await action(host, {
      type: 'encounter-damage',
      targetId: attacker.id,
      expression: '5',
      visibility: 'host',
      expectedRevision: room.encounter.revision,
      requestId: 'dying',
    });
    room = await snapshot(host, h.session);
    expect(room.encounter.participants[0]).toMatchObject({ hp: 0, majorWound: true, dying: true });
    expect(room.log.at(-1)?.content).toContain('下一轮结束时');
    const dodge = {
      ...duel,
      defense: 'dodge' as const,
      defenseSkill: 50,
      damage: {
        ...duel.damage,
        expectedRevision: room.encounter.revision,
        requestId: 'extreme-no-formula',
      },
    };
    await action(host, dodge);
    room = await snapshot(host, h.session);
    expect(room.encounter.participants[1].hp).toBe(9);
    expect(room.log.at(-1)?.content).toContain('未填写极难伤害式');
    await action(host, {
      ...dodge,
      damage: {
        ...dodge.damage,
        attackExtremeExpression: '12',
        expectedRevision: room.encounter.revision,
        requestId: 'instant-death',
      },
    });
    room = await snapshot(host, h.session);
    expect(room.encounter.participants[1]).toMatchObject({ hp: 0, majorWound: true, dying: false });
    expect(room.log.at(-1)?.content).toContain('当场死亡');
    await action(host, {
      ...dodge,
      damage: {
        ...dodge.damage,
        expectedRevision: room.encounter.revision,
        requestId: 'tie-dodge',
      },
    });
    room = await snapshot(host, h.session);
    expect(room.log.at(-1)?.content).toContain('防守方闪避成功');
    expect(room.log.at(-1)?.roll).toBeUndefined();
    expect(rng.mock.calls.filter(([sides]) => sides === 6)).toHaveLength(1);
    expect(rng).toHaveBeenCalledTimes(17);
  });

  it('rolls back automatic HP on persistence failure and deduplicates on retry, reload and archive restore', async () => {
    const rng = vi.fn(() => 3);
    const { host, player, h, p, server, dataDir } = await pair('dnd', { rng }, '2024');
    await action(player, { type: 'character', character: character('dnd', '2024') });
    let before = await snapshot(host, h.session);
    await action(host, {
      type: 'encounter-settings',
      expectedRevision: before.encounter.revision,
      autoDamage: true,
    });
    before = await snapshot(host, h.session);
    const damage: RoomAction = {
      type: 'encounter-damage',
      targetId: p.session.memberId,
      expression: '1d6',
      visibility: 'host',
      expectedRevision: before.encounter.revision,
      requestId: 'retry-damage',
    };
    const blockingDirectory = join(dataDir, `rooms.json.${process.pid}.tmp`);
    const disk = readFileSync(join(dataDir, 'rooms.json'), 'utf8');
    mkdirSync(blockingDirectory);
    try {
      expect(await rejected(host, damage)).toContain('存档保存失败');
      expect(readFileSync(join(dataDir, 'rooms.json'), 'utf8')).toBe(disk);
    } finally {
      rmSync(blockingDirectory, { recursive: true });
    }
    expect(await snapshot(host, h.session)).toEqual(before);
    await Promise.all([action(host, damage), action(host, damage)]);
    let room = await snapshot(host, h.session);
    expect(room.members.find((m) => m.id === p.session.memberId)?.character?.hp).toBe(9);
    expect(room.log.filter((e) => e.requestId === 'retry-damage')).toHaveLength(1);
    expect(await rejected(host, { ...damage, expression: '1d8' })).toContain('请求编号');
    expect(rng).toHaveBeenCalledTimes(2);

    host.disconnect();
    player.disconnect();
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    const restarted = await setup({ dataDir, rng });
    const resumedHost = await client(restarted.url);
    await snapshot(resumedHost, h.session);
    await action(resumedHost, damage);
    room = await snapshot(resumedHost, h.session);
    expect(room.members.find((m) => m.id === p.session.memberId)?.character?.hp).toBe(9);
    const exported = await fetch(`${restarted.url}/api/rooms/${h.session.roomCode}/archive`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${h.session.token}`,
        'x-interlude-member': h.session.memberId,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ descriptions: {} }),
    });
    expect(exported.status).toBe(200);
    const zip = Buffer.from(await exported.arrayBuffer());
    const restore = (edition?: DndEdition) =>
      fetch(`${restarted.url}/api/archives/restore`, {
        method: 'POST',
        headers: {
          'content-type': 'application/zip',
          'x-interlude-nickname': 'KP',
          'x-interlude-rule': 'dnd',
          ...(edition ? { 'x-interlude-dnd-edition': edition } : {}),
        },
        body: zip,
      });
    const wrong = await restore();
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ error: expect.stringContaining('版次') });
    const recovered = await restore('2024');
    expect(recovered.status).toBe(201);
    const { session: restored, room: restoredRoom } = (await recovered.json()) as RoomConnection;
    expect(restoredRoom.encounter).toEqual(room.encounter);
    expect(restoredRoom.dndEdition).toBe('2024');
    const restoredHost = await client(restarted.url);
    await snapshot(restoredHost, restored);
    await action(restoredHost, damage);
    room = await snapshot(restoredHost, restored);
    expect(room.members.find((m) => m.id === p.session.memberId)?.character?.hp).toBe(9);
    expect(room.log.filter((e) => e.requestId === 'retry-damage')).toHaveLength(1);
    expect(rng).toHaveBeenCalledTimes(2);
  });
});

describe('D&D runtime resources and host preparation', () => {
  it('round-trips private wave snapshots and only appends a wave once per confirmed load', async () => {
    const { host, player, h, p, url } = await pair('dnd');
    const guard = { ...createDndStatBlock('npc-bridge-guard'), hp: 7, name: '未公开的波次守卫' };
    const atlas = createAtlas();
    atlas.scenes = [
      {
        id: 'hall',
        mapId: null,
        title: '桥厅',
        description: '灯火照在石墙上。',
        keeperNotes: '不可公开的场景备注',
        source: '',
        tags: [],
      },
    ];
    const plan: EncounterPlan = {
      documentType: 'encounter-plan',
      schemaVersion: 1,
      id: 'bridge-plan',
      name: '私密遭遇预案',
      rule: 'dnd',
      scene: { atlasId: atlas.id, sceneId: 'hall' },
      waves: [{ id: 'gate', name: '第一波', entries: [{ id: 'guards', card: guard, count: 2 }] }],
      loot: '秘密战利品',
      notes: '私密备注',
    };
    expect(parseEncounterPlans(exportEncounterPlans([plan], 'json'))).toEqual([plan]);
    expect(parseEncounterPlans(exportEncounterPlans([plan], 'md'))).toEqual([plan]);
    expect(() => parseEncounterPlans(JSON.stringify({ ...plan, dndEdition: '2024' }))).toThrow();
    const save = { type: 'encounter-plan-save', plans: [plan], expectedRevision: 0 } as const;
    expect(await rejected(player, save)).toContain('只有主持人');
    await action(host, { ...save, plans: [plan] });
    expect(await rejected(host, save)).toContain('预案已更新');
    await action(host, { type: 'atlas-save', atlases: [atlas] });
    await action(host, { type: 'dnd-save', cards: [{ ...guard, name: '新版本卡库', hp: 8 }] });
    await action(host, { type: 'encounter-add', cardId: guard.id, count: 1 });
    const before = await snapshot(host, h.session);
    const load = {
      type: 'encounter-plan-load',
      planId: plan.id,
      waveId: 'gate',
      expectedRevision: before.encounter.revision,
      expectedPlanRevision: 1,
      requestId: 'load-first',
      publishScene: true,
    } satisfies RoomAction;
    expect(await rejected(player, load)).toContain('只有主持人');
    expect(await rejected(host, { ...load, expectedPlanRevision: 0 })).toContain('预案已更新');
    await action(host, load);
    await action(host, load);
    let room = await snapshot(host, h.session);
    expect(room.encounter.participants.map((c) => c.hp)).toEqual([8, 7, 7]);
    expect(room.encounter.loadedWaves).toEqual([{ planId: plan.id, waveId: 'gate' }]);
    expect(room.log.filter((event) => event.requestId === load.requestId)).toHaveLength(1);
    const audience = await snapshot(player, p.session);
    expect(audience.scene).toEqual({ title: '桥厅', description: '灯火照在石墙上。' });
    expect(audience.encounterPlans).toEqual([]);
    expect(audience.encounter.loadedWaves).toBeUndefined();
    expect(JSON.stringify(audience)).not.toMatch(
      /未公开的波次守卫|私密遭遇预案|秘密战利品|不可公开的场景备注/,
    );
    const recovered = await restoreDndRoom(url, h.session);
    expect(recovered.room.encounterPlans).toEqual([plan]);
    expect(recovered.room.encounter.loadedWaves).toEqual(room.encounter.loadedWaves);
    const recoveredHost = await client(url);
    await snapshot(recoveredHost, recovered.session);
    await action(recoveredHost, load);
    expect((await snapshot(recoveredHost, recovered.session)).encounter.participants).toHaveLength(
      3,
    );
    const newRequest = {
      ...load,
      expectedRevision: room.encounter.revision,
      requestId: 'load-again',
      publishScene: false,
    };
    expect(await rejected(host, newRequest)).toContain('这一波已加入本场');
    await action(host, { ...newRequest, repeat: true });
    await action(host, { type: 'encounter-plan-delete', planId: plan.id, expectedRevision: 1 });
    room = await snapshot(host, h.session);
    expect(room.encounterPlans).toEqual([]);
    expect(room.encounter.participants.map((c) => c.hp)).toEqual([8, 7, 7, 7, 7]);
  });

  it('limits companion HP and initiative to the current owner of a revealed creature', async () => {
    const { host, player, h, p, url } = await pair('dnd');
    const peer = await client(url);
    const other = await joinRoom(peer, h.room.code);
    await startParty(host, [
      { socket: player, session: p.session, card: character() },
      { socket: peer, session: other.session, card: character() },
    ]);
    const card = { ...createDndStatBlock('npc-bridge-guard'), hp: 7, name: '真实私密魔宠' };
    await action(host, { type: 'dnd-save', cards: [card] });
    await action(host, { type: 'encounter-add', cardId: card.id, count: 1 });
    let room = await snapshot(host, h.session);
    const c = room.encounter.participants.find((c) => c.memberId === null)!;
    const assign = {
      type: 'encounter-companion',
      combatantId: c.id,
      ownerMemberId: p.session.memberId,
      expectedRevision: room.encounter.revision,
    } as const;
    expect(await rejected(player, assign)).toContain('只有主持人');
    await action(host, assign);
    room = await snapshot(host, h.session);
    const hp = {
      type: 'encounter-companion-hp',
      combatantId: c.id,
      hp: 4,
      requestId: 'familiar-hp',
      expectedRevision: room.encounter.revision,
    } satisfies RoomAction;
    expect(await rejected(player, hp)).toContain('公开伙伴');
    expect(
      (await snapshot(player, p.session)).encounter.participants.some((entry) => entry.id === c.id),
    ).toBe(false);
    await action(host, {
      type: 'encounter-update',
      combatantId: c.id,
      expectedRevision: room.encounter.revision,
      patch: { revealed: true, publicName: '蓝鸟' },
    });
    room = await snapshot(host, h.session);
    expect(await rejected(peer, { ...hp, expectedRevision: room.encounter.revision })).toContain(
      '公开伙伴',
    );
    const updateHp = { ...hp, expectedRevision: room.encounter.revision };
    await action(player, updateHp);
    await action(player, updateHp);
    room = await snapshot(host, h.session);
    await action(player, {
      type: 'encounter-initiative-roll',
      combatantId: c.id,
      bonus: 0,
      edge: 'normal',
      expectedRevision: room.encounter.revision,
      requestId: 'familiar-order',
    });
    const owner = await snapshot(player, p.session);
    expect(owner.encounter.participants.find((entry) => entry.id === c.id)).toMatchObject({
      name: '蓝鸟',
      ownerMemberId: p.session.memberId,
      hp: 4,
      dex: 12,
      source: null,
      initiativeRoll: { selected: 11 },
    });
    const audience = await snapshot(peer, other.session);
    expect(audience.encounter.participants.find((entry) => entry.id === c.id)).toMatchObject({
      name: '蓝鸟',
      ownerMemberId: p.session.memberId,
      hp: null,
      dex: null,
      source: null,
    });
    expect(audience.log.some((event) => event.requestId === 'familiar-order')).toBe(false);
    expect(JSON.stringify(audience)).not.toContain(card.name);
    await action(host, { type: 'pause' });
    await action(host, { type: 'transfer-host', memberId: p.session.memberId });
    const promoted = await snapshot(player, p.session);
    expect(promoted.encounter.participants.find((entry) => entry.id === c.id)).toMatchObject({
      hp: 4,
      revealed: true,
    });
    expect(
      promoted.encounter.participants.find((entry) => entry.id === c.id)?.ownerMemberId,
    ).toBeUndefined();
    expect(
      (await snapshot(host, h.session)).encounter.participants.find((entry) => entry.id === c.id)
        ?.hp,
    ).toBeNull();
  });

  it('persists reviewed spell resources and concentration with retry and party-rest rollback', async () => {
    const { host, player, h, p, url, dataDir } = await pair('dnd', {}, '2024');
    const peer = await client(url);
    const other = await joinRoom(peer, h.room.code, 'dnd', '2024');
    const spellId = 'spell-84050c16e3a0eede';
    const wizard = suggestAllocation(
      {
        ...character('dnd', '2024'),
        occupation: '法师',
        hp: 8,
        dndMagic: { ...createDndMagicState(), spellbook: [spellId], prepared: [spellId] },
      },
      defaultCreationPolicy('dnd'),
    );
    const bad = {
      ...wizard,
      dndMagic: { ...wizard.dndMagic!, spellbook: ['forged-spell'], prepared: ['forged-spell'] },
    };
    expect(await rejected(player, { type: 'character', character: bad })).toContain('法术');
    await startParty(host, [
      { socket: player, session: p.session, card: wizard },
      { socket: peer, session: other.session, card: { ...character('dnd', '2024'), hp: 5 } },
    ]);
    await action(host, { type: 'initiative' });
    const before = await snapshot(host, h.session);
    const cast = {
      type: 'character-magic',
      ...runtimeSelection(before, p.session),
      requestId: 'first-spell',
      edit: {
        kind: 'cast',
        spellId,
        method: 'slot',
        slotLevel: 1,
        componentNote: '成分的私密备注',
      },
    } satisfies RoomAction;
    expect(await rejected(peer, cast)).toContain('只能修改自己的角色');
    const blocked = join(dataDir, `rooms.json.${process.pid}.tmp`);
    mkdirSync(blocked);
    try {
      expect(await rejected(player, cast)).toContain('存档保存失败');
    } finally {
      rmSync(blocked, { recursive: true });
    }
    expect(await snapshot(host, h.session)).toEqual(before);
    await Promise.all([action(player, cast), action(player, cast)]);
    let room = await snapshot(host, h.session);
    expect(
      room.members.find((m) => m.id === p.session.memberId)?.character?.dndMagic?.slotsUsed[0],
    ).toBe(1);
    expect(
      room.encounter.participants.find((c) => c.id === p.session.memberId)?.concentration,
    ).toBe('侦测魔法');
    expect(room.encounter.slotSpentMemberIds).toEqual([p.session.memberId]);
    expect(room.log.filter((event) => event.requestId === cast.requestId)).toHaveLength(1);
    expect(
      room.log.some(
        (event) => event.visibility === 'host' && event.content.includes('成分的私密备注'),
      ),
    ).toBe(true);
    const audience = await snapshot(peer, other.session);
    expect(
      audience.members.find((m) => m.id === p.session.memberId)?.character?.dndMagic,
    ).toBeUndefined();
    expect(audience.encounter.slotSpentMemberIds).toBeUndefined();
    expect(audience.log.some((event) => event.content.includes('成分的私密备注'))).toBe(false);
    const recovered = await restoreDndRoom(url, h.session, '2024');
    const restoredPlayer = await client(url);
    const returned = await success<RoomConnection>(restoredPlayer, 'room:join', {
      code: recovered.room.code,
      nickname: '继续调查的法师',
      rule: 'dnd',
      dndEdition: '2024',
      seatCode: recovered.room.seatClaims?.find((entry) => entry.memberId === p.session.memberId)
        ?.code,
    });
    await action(restoredPlayer, cast);
    const resumed = await snapshot(restoredPlayer, returned.session);
    expect(
      resumed.members.find((m) => m.id === p.session.memberId)?.character?.dndMagic?.slotsUsed[0],
    ).toBe(1);
    expect(
      resumed.encounter.participants.find((c) => c.id === p.session.memberId)?.concentration,
    ).toBe('侦测魔法');
    expect(resumed.encounter.slotSpentMemberIds).toEqual([p.session.memberId]);
    const again = { ...cast, ...runtimeSelection(room, p.session), requestId: 'second-spell' };
    expect(await rejected(player, again)).toContain('同一回合只能消耗一个法术位');
    const currentTurn = room.encounter.activeId;
    await action(player, {
      type: 'character-magic',
      ...runtimeSelection(room, p.session),
      requestId: 'finish-short-rest',
      edit: { kind: 'rest', rest: 'short', confirmed: true },
    });
    room = await snapshot(host, h.session);
    expect(room.encounter).toMatchObject({ activeId: currentTurn, slotSpentMemberIds: [] });
    await action(player, { ...again, ...runtimeSelection(room, p.session) });
    await action(host, { type: 'next-turn' });
    expect((await snapshot(host, h.session)).encounter.slotSpentMemberIds).toEqual([]);
    await action(host, { type: 'encounter-clear' });
    room = await snapshot(host, h.session);
    expect(
      room.members.find((m) => m.id === p.session.memberId)?.character?.dndMagic?.slotsUsed[0],
    ).toBe(2);
    expect(
      room.encounter.participants.find((c) => c.id === p.session.memberId)?.concentration,
    ).toBe('侦测魔法');
    const manualRecovery = {
      type: 'character-magic',
      ...runtimeSelection(room, p.session),
      requestId: 'manual-slot-recovery',
      edit: { kind: 'restore', resourceId: 'slot:1', amount: 1, reason: '私密的恢复裁定' },
    } satisfies RoomAction;
    expect(await rejected(player, manualRecovery)).toContain('只有主持人');
    await action(host, manualRecovery);
    await action(host, manualRecovery);
    room = await snapshot(host, h.session);
    expect(
      room.members.find((m) => m.id === p.session.memberId)?.character?.dndMagic?.slotsUsed[0],
    ).toBe(1);
    expect(
      room.log.some((e) => e.visibility === 'host' && e.content.includes('私密的恢复裁定')),
    ).toBe(true);
    expect(
      (await snapshot(peer, other.session)).log.some((e) => e.content.includes('私密的恢复裁定')),
    ).toBe(false);
    await action(host, {
      type: 'encounter-update',
      combatantId: p.session.memberId,
      patch: { concentration: '', tempHp: 5 },
      expectedRevision: room.encounter.revision,
    });
    room = await snapshot(host, h.session);
    expect(
      room.members.find((m) => m.id === p.session.memberId)?.character?.dndMagic?.concentration,
    ).toBeUndefined();
    const rest = {
      type: 'party-rest',
      rest: 'long',
      confirmed: true,
      members: [runtimeSelection(room, p.session), runtimeSelection(room, other.session)],
      requestId: 'party-rest',
    } satisfies RoomAction;
    expect(await rejected(player, rest)).toContain('只有主持人');
    expect(
      await rejected(host, {
        ...rest,
        members: [rest.members[0], { ...rest.members[1], expectedCharacterRevision: 0 }],
      }),
    ).toContain('角色状态已更新');
    expect(
      await rejected(host, {
        ...rest,
        rest: 'short',
        members: [rest.members[0], { ...rest.members[1], hitDice: 1 }],
      }),
    ).toContain('准备阶段配置');
    expect(await snapshot(host, h.session)).toEqual(room);
    await action(host, rest);
    await action(host, rest);
    room = await snapshot(host, h.session);
    expect(room.members.find((m) => m.id === p.session.memberId)?.character).toMatchObject({
      hp: 12,
      dndMagic: { slotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
    });
    expect(room.members.find((m) => m.id === other.session.memberId)?.character).toMatchObject({
      hp: 12,
    });
    expect(room.encounter.participants.find((c) => c.id === p.session.memberId)?.tempHp).toBe(0);
    expect(room.log.filter((event) => event.requestId === rest.requestId)).toHaveLength(1);
  });

  it('synchronizes effective AC and derives weapon attacks and ammunition on the server', async () => {
    const rng = diceSequence(1, 15, 5);
    const { host, player, h, p, url } = await pair('dnd', { rng }, '2024');
    const peer = await client(url);
    const other = await joinRoom(peer, h.room.code, 'dnd', '2024');
    const pack = parseEquipmentCatalog(
      JSON.parse(
        readFileSync(new URL('../public/rules/equipment-2024.json', import.meta.url), 'utf8'),
      ),
    );
    const armor = itemFromEquipmentCatalog(pack.items.find((entry) => entry.name === '皮甲')!);
    const bow = itemFromEquipmentCatalog(pack.items.find((entry) => entry.name === '长弓')!);
    bow.equipment!.equipped = true;
    bow.equipment!.grip = 'two';
    const ammo = itemFromEquipmentCatalog(
      pack.items.find((entry) => entry.name === '箭矢')!,
      3,
    );
    const wrongAmmo = itemFromEquipmentCatalog(pack.items.find((entry) => entry.name === '弩矢')!);
    const fighter = {
      ...character('dnd', '2024'),
      dndEquipment: createDndEquipmentState(),
      items: [armor, bow, ammo, wrongAmmo],
    };
    const forged = structuredClone(fighter);
    forged.items[0].equipment!.armor!.baseAC = 30;
    expect(await rejected(player, { type: 'character', character: forged })).toContain(
      '装备基础数值',
    );
    await startParty(host, [
      { socket: player, session: p.session, card: fighter },
      { socket: peer, session: other.session, card: character('dnd', '2024') },
    ]);
    let room = await snapshot(host, h.session);
    expect(room.encounter.participants.find((c) => c.id === p.session.memberId)?.ac).toBe(12);
    const equip = {
      type: 'character-equipment',
      ...runtimeSelection(room, p.session),
      requestId: 'wear-armor',
      edit: { kind: 'equip', itemId: armor.id, equipped: true },
    } satisfies RoomAction;
    await action(player, equip);
    await action(player, equip);
    room = await snapshot(host, h.session);
    expect(room.encounter.participants.find((c) => c.id === p.session.memberId)?.ac).toBe(13);
    const publicCard = (await snapshot(peer, other.session)).members.find(
      (m) => m.id === p.session.memberId,
    )?.character;
    expect(publicCard).toMatchObject({ ac: 13, items: [] });
    expect(publicCard?.dndEquipment).toBeUndefined();
    expect(
      await rejected(player, {
        type: 'item-remove',
        memberId: p.session.memberId,
        itemId: armor.id,
      }),
    ).toContain('装备面板');
    const card = { ...createDndStatBlock('npc-bridge-guard', '2024'), hp: 19 };
    await action(host, { type: 'dnd-save', cards: [card] });
    await action(host, { type: 'encounter-add', cardId: card.id, count: 1 });
    room = await snapshot(host, h.session);
    await action(host, {
      type: 'encounter-settings',
      autoDamage: true,
      expectedRevision: room.encounter.revision,
    });
    room = await snapshot(host, h.session);
    const target = room.encounter.participants.find((c) => c.memberId === null)!;
    const attack = {
      type: 'encounter-dnd-attack',
      attackerId: p.session.memberId,
      targetId: target.id,
      edge: 'normal',
      weaponId: bow.id,
      expectedCharacterRevision: runtimeSelection(room, p.session).expectedCharacterRevision,
      expectedRevision: room.encounter.revision,
      requestId: 'bow-miss',
      visibility: 'host',
      damage: { adjustment: 'normal' },
    } satisfies RoomAction;
    expect(await rejected(host, attack)).toContain('库存中可用');
    expect(
      await rejected(host, { ...attack, ammoItemId: wrongAmmo.id, ammoConfirmed: true }),
    ).toContain('与武器不匹配');
    expect(
      await rejected(host, { ...attack, weaponMode: 'light-extra', ammoItemId: ammo.id }),
    ).toContain('输入格式');
    expect(rng).not.toHaveBeenCalled();
    const shot = { ...attack, ammoItemId: ammo.id };
    await action(host, shot);
    await action(host, shot);
    room = await snapshot(host, h.session);
    expect(room.encounter.participants.find((c) => c.id === target.id)?.hp).toBe(19);
    expect(
      room.members
        .find((m) => m.id === p.session.memberId)
        ?.character?.items.find((item) => item.id === ammo.id)?.quantity,
    ).toBe(2);
    const hit = {
      ...shot,
      expectedRevision: room.encounter.revision,
      expectedCharacterRevision: runtimeSelection(room, p.session).expectedCharacterRevision,
      requestId: 'bow-hit',
      modifier: -100,
      damage: { expression: '999' },
    };
    await action(host, hit);
    room = await snapshot(host, h.session);
    expect(room.log.at(-1)).toMatchObject({
      check: { modifier: 4, success: true },
      roll: { expression: '1d8+2', total: 7 },
    });
    expect(room.encounter.participants.find((c) => c.id === target.id)?.hp).toBe(12);
    expect(
      room.members
        .find((m) => m.id === p.session.memberId)
        ?.character?.items.find((item) => item.id === ammo.id)?.quantity,
    ).toBe(1);
    const recovered = await restoreDndRoom(url, h.session, '2024');
    const resumed = await client(url);
    await snapshot(resumed, recovered.session);
    await action(resumed, hit);
    const replayed = await snapshot(resumed, recovered.session);
    expect(replayed.encounter.participants.find((c) => c.id === target.id)?.hp).toBe(12);
    expect(
      replayed.members
        .find((m) => m.id === p.session.memberId)
        ?.character?.items.find((item) => item.id === ammo.id)?.quantity,
    ).toBe(1);
    expect(rng.mock.calls.flat()).toEqual([20, 20, 8]);
  });

  it('accepts a valid multilingual equipment card above the normal action byte limit', async () => {
    const { host, player, h, p } = await pair('dnd', {}, '2024');
    const pack = parseEquipmentCatalog(
      JSON.parse(
        readFileSync(new URL('../public/rules/equipment-2024.json', import.meta.url), 'utf8'),
      ),
    );
    const gear = pack.items.find((item) => item.name === '巨斧')!;
    const items = Array.from({ length: 100 }, (_, index) => {
      const item = itemFromEquipmentCatalog(gear);
      return {
        ...item,
        id: `gear-${index}`,
        name: '甲'.repeat(120),
        notes: '注'.repeat(1000),
        equipment: { ...item.equipment!, bonusSource: '源'.repeat(400) },
      };
    });
    const card = { ...character('dnd', '2024'), dndEquipment: createDndEquipmentState(), items };
    const portable = JSON.stringify(card);
    expect(portable.length).toBeLessThan(256000);
    expect(Buffer.byteLength(portable)).toBeGreaterThan(512 * 1024);
    await action(player, { type: 'character', character: card });
    expect(
      (await snapshot(host, h.session)).members.find((m) => m.id === p.session.memberId)?.character
        ?.items,
    ).toHaveLength(100);
  });
});
