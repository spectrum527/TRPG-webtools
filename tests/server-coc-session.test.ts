import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppServer } from '../server/app';
import { readArchive } from '../server/archive';
import { effectiveCharacter } from '../shared/adjustments';
import { cocCheckStatus, type CocSessionEdit } from '../shared/coc-runtime';
import { cocCurrentLuck, cocRoomRules } from '../shared/coc-session';
import { previewCocSpellHp } from '../shared/coc-session-rules';
import { parseRoomConfig, exportRoomConfig, roomConfiguration } from '../shared/room-config';
import type { Ack, Room, RoomAction, RoomConnection } from '../shared/types';
import { preparedCharacter } from './fixtures/adjustment-character';

const sockets: Socket[] = [];
const servers: ReturnType<typeof createAppServer>[] = [];
const dirs: string[] = [];
afterEach(async () => {
  sockets.splice(0).forEach((socket) => socket.disconnect());
  for (const server of servers.splice(0)) await server.close();
  dirs.splice(0).forEach((dir) => rmSync(dir, { force: true, recursive: true }));
});

function request<T>(socket: Socket, event: string, data: unknown) {
  return new Promise<Ack<T>>((resolve, reject) => {
    socket.timeout(2500).emit(event, data, (error: Error | null, reply: Ack<T>) => {
      if (error) reject(error);
      else resolve(reply);
    });
  });
}

async function good<T>(socket: Socket, event: string, data: unknown): Promise<T> {
  const response = await request<T>(socket, event, data);
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

const act = (socket: Socket, input: RoomAction) => good(socket, 'room:action', input);
const send = (socket: Socket, input: RoomAction) => request(socket, 'room:action', input);
const state = async (socket: Socket, connection: RoomConnection) =>
  (await good<RoomConnection>(socket, 'room:resume', connection.session)).room;
const id = () => crypto.randomUUID();

async function client(url: string) {
  const socket = io(url, { transports: ['websocket'], reconnection: false, forceNew: true });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

async function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'interlude-coc-'));
  dirs.push(dataDir);
  const queue: number[] = [];
  let randomCalls = 0;
  const rng = (sides: number) => {
    randomCalls += 1;
    const value = queue.shift() ?? Math.ceil(sides / 2);
    if (value < 1 || value > sides) throw new Error(`invalid roll ${value} for d${sides}`);
    return value;
  };
  const server = createAppServer({ dataDir, rng });
  servers.push(server);
  const url = `http://127.0.0.1:${await server.listen()}`;
  const host = await client(url),
    player = await client(url),
    observer = await client(url);
  const h = await good<RoomConnection>(host, 'room:create', {
    name: '调查',
    nickname: '主持人',
    rule: 'coc',
    mode: 'in-room',
  });
  const joinPlayer = (socket: Socket, nickname: string) =>
    good<RoomConnection>(socket, 'room:join', { code: h.room.code, rule: 'coc', nickname });
  const p = await joinPlayer(player, '调查员');
  const o = await joinPlayer(observer, '第二位调查员');
  for (const [socket, connection] of [
    [player, p],
    [observer, o],
  ] as const) {
    await act(socket, { type: 'character', character: preparedCharacter('coc') });
    const room = await state(host, h);
    const member = room.members.find(({ id }) => id === connection.session.memberId)!;
    await act(host, {
      type: 'review-character',
      memberId: member.id,
      decision: 'approved',
      note: '',
      characterRevision: member.characterRevision,
      policyRevision: room.policyRevision,
    });
    await act(socket, { type: 'ready', ready: true });
  }
  await act(host, { type: 'ready', ready: true });
  await act(host, { type: 'start' });
  const selected = (room: Room) => room.members.find((m) => m.id === p.session.memberId)!;
  const edit = (
    room: Room,
    edit: CocSessionEdit,
  ): Extract<RoomAction, { type: 'character-coc' }> => {
    const member = selected(room);
    return {
      type: 'character-coc',
      requestId: id(),
      memberId: member.id,
      characterId: member.character!.id,
      expectedCharacterRevision: member.characterRevision,
      edit,
    };
  };
  const roll = (value: number) => queue.push((value % 10) + 1, (Math.floor(value / 10) % 10) + 1);
  const snapshot = () => state(host, h);
  const archive = async () => {
    const response = await fetch(`${url}/api/rooms/${h.room.code}/archive`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${h.session.token}`,
        'x-interlude-member': h.session.memberId,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ descriptions: {} }),
    });
    if (!response.ok) throw new Error(await response.text());
    return readArchive(new Uint8Array(await response.arrayBuffer())).room;
  };
  return {
    host,
    player,
    observer,
    h,
    p,
    o,
    selected,
    snapshot,
    edit,
    roll,
    archive,
    randomCalls: () => randomCalls,
  };
}

describe('CoC session socket and archive', () => {
  it('authorizes counter corrections to the host and keeps retries and pending SAN atomic', async () => {
    const env = await setup();
    let room = await env.snapshot();
    const unlock = env.edit(room, { kind: 'session-value-lock', field: 'luck', locked: false });
    expect(await send(env.player, unlock)).toMatchObject({ ok: false });
    await act(env.host, unlock);
    room = await env.snapshot();
    const revision = env.selected(room).characterRevision;
    const correction = env.edit(room, {
      kind: 'session-value-correct',
      field: 'luck',
      value: 0,
      reason: '核对幸运消耗记录',
      confirmed: true,
    });
    expect(await send(env.observer, correction)).toMatchObject({ ok: false });
    await Promise.all([act(env.host, correction), act(env.host, correction)]);
    room = await env.snapshot();
    expect(env.selected(room).characterRevision).toBe(revision + 1);
    expect(cocCurrentLuck(env.selected(room).character!)).toBe(0);
    await act(
      env.host,
      env.edit(room, { kind: 'session-value-lock', field: 'lostToday', locked: false }),
    );
    env.roll(10);
    await act(
      env.player,
      env.edit(await env.snapshot(), {
        kind: 'sanity-roll',
        visibility: 'public',
        reason: '遇到异常',
        successLoss: '1',
        failureLoss: '1',
      }),
    );
    room = await env.snapshot();
    expect(
      await send(
        env.host,
        env.edit(room, {
          kind: 'session-value-correct',
          field: 'lostToday',
          value: 5,
          reason: '补录',
          confirmed: true,
        }),
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining('待结算') });
    const saved = await env.archive();
    expect(env.selected(saved).character?.cocSession).toMatchObject({
      luck: 0,
      valueLocks: { luck: false, lostToday: false },
      sanity: { lostToday: 0, pending: { loss: 1 } },
    });
    expect(saved.log.filter((event) => event.requestId === correction.requestId)).toHaveLength(1);
  });

  it('marks a bound investigator’s successful public combat dodge for development', async () => {
    const env = await setup();
    const room = await env.snapshot();
    env.roll(97);
    env.roll(1);
    const action = {
      type: 'coc-melee',
      attacker: '进攻方',
      defender: '闪避方',
      attackSkill: 40,
      defenseSkill: 30,
      defense: 'dodge',
      attackEdge: 'normal',
      defenseEdge: 'normal',
      visibility: 'public',
      damage: {
        attackerId: env.o.session.memberId,
        defenderId: env.p.session.memberId,
        attackExpression: '1d3',
        requestId: id(),
        expectedRevision: room.encounter.revision,
      },
    } as const;
    await act(env.host, action);
    const saved = await env.archive();
    const event = saved.log.find(({ requestId }) => requestId === action.damage.requestId)!;
    expect(event.content).toContain('闪避成功');
    expect(env.selected(saved).character?.cocSession?.development.marks).toMatchObject([
      { key: 'dodge', eventIds: [event.id] },
    ]);
  });

  it('persists independent room rules and private pending SAN, then settles it once', async () => {
    const env = await setup();
    let room = await env.snapshot();
    const original = env.selected(room);
    const rules = { ...cocRoomRules(room.cocRules), allowLuckSpending: true, autoSanity: false };
    expect(room.cocRules?.allowPushedRolls).toBe(false);
    const update = {
      type: 'coc-rules',
      rules,
      expectedRevision: room.configRevision,
      requestId: id(),
    } as const;
    expect(await send(env.player, update)).toMatchObject({ ok: false });
    await act(env.host, update);
    await act(env.host, update);
    room = await env.snapshot();
    expect(room.configRevision).toBe(update.expectedRevision + 1);
    expect(env.selected(room).characterRevision).toBe(original.characterRevision);
    expect(parseRoomConfig(exportRoomConfig(roomConfiguration(room), 'md')).cocRules).toEqual(
      rules,
    );

    env.roll(21);
    const roll = env.edit(room, {
      kind: 'sanity-roll',
      reason: '隐藏的真名',
      successLoss: '5',
      failureLoss: '5',
      visibility: 'host',
      source: { name: '暗处的生物', limit: 5 },
    });
    await Promise.all([act(env.host, roll), act(env.host, roll)]);
    expect(env.randomCalls()).toBe(2);
    room = await env.snapshot();
    const pending = env.selected(room).character!.cocSession!.sanity.pending!;
    expect(pending).toMatchObject({ roll: 21, loss: 5, reason: '隐藏的真名' });
    expect(env.selected(room).character!.san).toBe(original.character!.san);
    expect(env.selected(await env.archive()).character!.cocSession!.sanity.pending).toEqual(
      pending,
    );
    for (const [socket, connection] of [
      [env.player, env.p],
      [env.observer, env.o],
    ] as const) {
      const projected = await state(socket, connection);
      expect(JSON.stringify(projected)).not.toContain('隐藏的真名');
      expect(JSON.stringify(projected)).not.toContain('暗处的生物');
      expect(
        projected.log.find((event) => event.secret?.label === '理智检定')?.check,
      ).toBeUndefined();
    }

    const settle = env.edit(room, {
      kind: 'sanity-confirm',
      confirmed: true,
      pendingId: pending.id,
    });
    expect(await send(env.player, settle)).toMatchObject({ ok: false });
    await act(env.host, settle);
    await act(env.host, settle);
    const settled = await env.archive();
    expect(settled.cocRules).toEqual(rules);
    expect(env.selected(settled).character).toMatchObject({
      san: original.character!.san - 5,
      cocSession: { sanity: { lostToday: 5, insanity: null } },
    });
    expect(env.selected(settled).character?.cocSession?.sanity.pending).toBeUndefined();
    expect(env.randomCalls()).toBe(2);
  });

  it('spends Luck once, excludes the changed result from growth and protects linked push decisions', async () => {
    const env = await setup();
    let room = await env.snapshot();
    await act(env.host, {
      type: 'coc-rules',
      expectedRevision: room.configRevision,
      requestId: id(),
      rules: { ...cocRoomRules(room.cocRules), allowLuckSpending: true, allowPushedRolls: true },
    });
    const key = 'spotHidden';
    const target = effectiveCharacter(env.selected(room).character!).skills[key];
    const initialLuck = cocCurrentLuck(env.selected(room).character!);
    const check = {
      type: 'check',
      visibility: 'public',
      requestId: id(),
      check: { kind: 'skill', key, dc: 0, modifier: 0, edge: 'normal' },
    } as const;
    const natural = Math.min(target, 80);
    env.roll(natural);
    await act(env.player, check);
    await act(env.player, check);
    room = await env.snapshot();
    const original = room.log.find((event) => event.requestId === check.requestId)!;
    expect(env.selected(room).character?.cocSession?.development.marks[0]?.eventIds).toContain(
      original.id,
    );
    const points = natural - Math.floor(target / 2);
    const spend = {
      type: 'coc-check-followup',
      eventId: original.id,
      expectedVersion: 0,
      expectedCharacterRevision: env.selected(room).characterRevision,
      requestId: id(),
      edit: { kind: 'spend-luck', points },
    } as const;
    expect(await send(env.observer, spend)).toMatchObject({ ok: false });
    await Promise.all([act(env.player, spend), act(env.player, spend)]);
    room = await env.snapshot();
    expect(cocCurrentLuck(env.selected(room).character!)).toBe(initialLuck - points);
    expect(env.selected(room).character?.cocSession?.development.marks).toHaveLength(0);
    expect(cocCheckStatus(room.log, original.id)).toMatchObject({
      version: 1,
      original: { check: { total: natural } },
      luck: { points },
    });
    expect(
      await send(env.player, {
        ...spend,
        requestId: id(),
        expectedVersion: 1,
        expectedCharacterRevision: env.selected(room).characterRevision,
      }),
    ).toMatchObject({ ok: false });

    const hard = {
      ...check,
      requestId: id(),
      check: { ...check.check, cocDifficulty: 'hard' },
    } as const;
    env.roll(Math.floor(target / 2) + 1);
    await act(env.player, hard);
    room = await env.snapshot();
    const first = room.log.find((event) => event.requestId === hard.requestId)!;
    expect(first.check?.success).toBe(false);
    const followup = {
      type: 'coc-check-followup',
      eventId: first.id,
      expectedCharacterRevision: env.selected(room).characterRevision,
    } as const;
    const attempt = {
      ...followup,
      expectedVersion: 0,
      requestId: id(),
      edit: { kind: 'request-push', reason: '再次检查桌底', consequence: '发出声响' },
    } as const;
    await act(env.player, attempt);
    const decision = {
      ...followup,
      expectedVersion: 1,
      requestId: id(),
      edit: { kind: 'decide-push', allowed: true, consequence: '惊动保安' },
    } as const;
    expect(await send(env.player, decision)).toMatchObject({ ok: false });
    await act(env.host, decision);
    env.roll(1);
    const push = {
      ...followup,
      expectedVersion: 2,
      requestId: id(),
      edit: { kind: 'push' },
    } as const;
    await act(env.player, push);
    await act(env.player, push);
    const saved = await env.archive();
    expect(cocCheckStatus(saved.log, first.id)).toMatchObject({
      version: 3,
      pushed: { result: { selected: 1 } },
    });
    expect(env.selected(saved).character?.cocSession?.development.marks[0]?.eventIds).toEqual([
      first.id,
    ]);
  });

  it('checks HP and character revisions before casting and leaves dead investigators dead during natural recovery', async () => {
    const env = await setup();
    let room = await env.snapshot();
    await act(env.host, {
      type: 'encounter-settings',
      expectedRevision: room.encounter.revision,
      autoDamage: true,
    });
    room = await env.snapshot();
    const initial = env.selected(room).character!;
    await act(
      env.host,
      env.edit(room, {
        kind: 'spell-save',
        spell: {
          id: 'warning-ward',
          name: '代价',
          source: '',
          description: '',
          cost: { mp: initial.mp + initial.maxHp, hp: 0, san: '1', minutes: 0, rounds: 0 },
        },
      }),
    );
    await act(
      env.host,
      env.edit(await env.snapshot(), {
        kind: 'spell-learn',
        spellId: 'warning-ward',
        confirmed: true,
      }),
    );
    room = await env.snapshot();
    const preview = previewCocSpellHp(room, env.p.session.memberId, 'warning-ward')!;
    expect(preview).toMatchObject({ requiresConfirmation: true, value: 0, hpCost: initial.maxHp });
    const cast = env.edit(room, {
      kind: 'spell-cast',
      spellId: 'warning-ward',
      allowHpPayment: true,
      confirmed: true,
    });
    expect(await send(env.player, cast)).toMatchObject({
      ok: false,
      error: expect.stringContaining('先确认'),
    });
    expect(
      await send(env.player, {
        ...cast,
        hpConfirmation: {
          expectedHp: preview.expectedHp,
          expectedRevision: preview.expectedRevision - 1,
          outcome: 'rules',
        },
      }),
    ).toMatchObject({ ok: false });
    expect(env.randomCalls()).toBe(0);
    expect(env.selected(await env.snapshot()).character).toMatchObject({
      hp: initial.hp,
      mp: initial.mp,
      san: initial.san,
    });
    env.roll(1);
    const confirmed = {
      ...cast,
      hpConfirmation: {
        expectedHp: preview.expectedHp,
        expectedRevision: preview.expectedRevision,
        outcome: 'rules',
      },
    } as const;
    await act(env.player, confirmed);
    await act(env.player, confirmed);
    room = await env.snapshot();
    expect(env.randomCalls()).toBe(2);
    expect(env.selected(room).character).toMatchObject({ hp: 0, mp: 0, san: initial.san - 1 });
    expect(
      room.encounter.participants.find(({ memberId }) => memberId === env.p.session.memberId)?.dead,
    ).toBe(true);
    await act(
      env.host,
      env.edit(room, { kind: 'advance-time', minutes: 10080, reason: '过去一周', confirmed: true }),
    );
    const saved = await env.archive();
    expect(env.selected(saved).character).toMatchObject({ hp: 0, mp: 0 });
    expect(
      saved.encounter.participants.find(({ memberId }) => memberId === env.p.session.memberId)
        ?.dead,
    ).toBe(true);
  });
});
