import { ImageLifecycle } from './image-lifecycle.ts';
import { MAX_ARCHIVE_BYTES, archiveSummary } from '../shared/archive.ts';
import { readArchive, exportArchive } from './archive.ts';
import { roomSchema, validRoomReferences, visibleEvent } from '../shared/room-state.ts';
import { AtlasLibrarySchema, mergeAtlases } from '../shared/atlas.ts';
import { RoomConfigSchema } from '../shared/room-config.ts';
import { cocRoomRules, type CocSession } from '../shared/coc-session.ts';
import {
  CocDifficultySchema,
  CocRuntimeActionSchemas,
  cocCheckEligibility,
  cocCheckStatus,
  cocLuckResult,
  cocRangedDifficulty,
  cocResultAtDifficulty,
  type CocCheckFollowup,
  type CocCheckOriginal,
} from '../shared/coc-runtime.ts';
import {
  advanceCocEncounterRounds,
  applyCocSessionEdit,
  getCocSessionErrors,
  markCocDevelopment,
  mergeCocPreparation,
  previewCocSpellHp,
  reconcileCocDevelopmentMarks,
  recordCocManualSan,
  spendCocLuck,
} from '../shared/coc-session-rules.ts';
import {
  applyCocInvestigatorEdit,
  CocInvestigatorEditSchema,
  synchronizeCocInvestigator,
} from '../shared/coc-investigator.ts';
import {
  cocArmorValue,
  cocWeaponValues,
  consumeCocAmmunition,
  rollCocWeaponDamage,
  cocWeaponArmorReduction,
} from '../shared/coc-equipment.ts';
import { IMAGE_MIMES, MAX_IMAGE_BYTES } from '../shared/media.ts';
import { decodeImage, imagePath, saveImage } from './images.ts';
import express from 'express';
import { ipKeyGenerator, MemoryStore, rateLimit } from 'express-rate-limit';
import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import {
  CreationPolicySchema,
  defaultCreationPolicy,
  validateCreation,
} from '../shared/creation.ts';
import { DndStatBlockSchema, getDndStatBlockErrors } from '../shared/dnd.ts';
import { DndEditionSchema, getDndEdition, type DndEdition } from '../shared/dnd-edition.ts';
import { parseDndReferencePack, type DndSpellReference } from '../shared/dnd-reference.ts';
import {
  applyDndMagicEdit,
  getDndMagicErrors,
  type DndMagicEdit,
  type DndMagicResult,
} from '../shared/dnd-magic.ts';
import {
  applyDndEquipmentEdit,
  getDndWeaponAttack,
  dndArmorPreventsCasting,
  isDndAmmunition,
  itemFromEquipmentCatalog,
  type DndItemDetails,
} from '../shared/dnd-equipment.ts';
import { parseEquipmentCatalog } from '../shared/equipment-catalog.ts';
import {
  CharacterRuntimeActionSchemas,
  dndAmmoCompatibility,
} from '../shared/character-runtime.ts';
import {
  EncounterPlanLibrarySchema,
  PreparationActionSchemas,
  validateEncounterPlanForRoom,
} from '../shared/preparation.ts';
import {
  emptyEncounter,
  EncounterActionSchemas,
  addEncounterCards,
  loadEncounterWave,
  syncEncounterPlayers,
  orderEncounter,
  nextEncounterTurn,
  updateCombatant,
  removeCombatant,
  encounterView,
  rollEncounterInitiative,
  setEncounterAutoDamage,
  setEncounterLifeChecks,
  replaceInjuredCombatant,
  clearEncounter,
  recordEncounterRest,
  markEncounterSpellSlot,
  canControlCompanion,
  setEncounterCompanionOwner,
  applyEncounterDamage,
  effectiveCocArmor,
  criticalDamageExpression,
  DAMAGE_ADJUSTMENT_LABELS,
  cocMeleeWinner,
  isCocExtremeSuccess,
  compareCocMelee,
  type Combatant,
  type DamageAdjustment,
} from '../shared/encounter.ts';
import {
  HpConfirmationSchema,
  applyDeathSave,
  applyConstitution,
  healInjury,
  injuryLabels,
  lifeFields,
  manualHpChange,
  markDead,
  previewManualHp,
  stabilize,
  usesDeathSaves,
} from '../shared/injury.ts';
import { KeeperCardSchema, getKeeperCardErrors } from '../shared/keeper.ts';
import {
  CharacterAdjustmentEditSchema,
  applyCharacterAdjustment,
  adjustmentDescription,
  effectiveCharacter,
} from '../shared/adjustments.ts';
import { getCharacterErrors, rollCheck, rollDice, type DieRandom } from '../shared/rules.ts';
import type {
  Ack,
  Edge,
  Character,
  CheckRequest,
  CheckResult,
  DiceResult,
  Inspiration,
  Member,
  Room,
  RoomAction,
  RoomConnection,
  RoomEvent,
  Session,
  Visibility,
} from '../shared/types.ts';

const ruleSchema = z.enum(['dnd', 'coc']);
const modeSchema = z.enum(['in-room', 'external']);
const visibilitySchema = z.enum(['public', 'host']);
const name = z.string().trim().min(1).max(60);
const id = z.string().min(1).max(100);
const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{6}$/);
const sessionSchema = z
  .object({ roomCode: codeSchema, memberId: id, token: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
const itemSchema = z
  .object({
    // Keep action items compatible with the character schema used during reload.
    id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
    name: z.string().trim().min(1).max(120),
    quantity: z.number().int().min(0).max(9999),
    notes: z.string().max(1000),
  })
  .strict();
const characterSchema = z.custom<Character>((value) => {
  try {
    return getCharacterErrors(value as Character).length === 0;
  } catch {
    return false;
  }
}, '角色卡格式或数值无效');
const checkSchema = z
  .object({
    kind: z.enum(['ability', 'skill', 'save', 'attack', 'sanity']),
    key: z.string().max(100),
    dc: z.number().int().min(0).max(1000),
    modifier: z.number().int().min(-1000).max(1000),
    edge: z.enum(['normal', 'advantage', 'disadvantage']),
    target: z.number().int().min(0).max(100000).optional(),
    cocDifficulty: CocDifficultySchema.optional(),
  })
  .strict();
const createSchema = z
  .object({
    name,
    nickname: name,
    rule: ruleSchema,
    dndEdition: DndEditionSchema.optional(),
    mode: modeSchema,
    configuration: RoomConfigSchema.optional(),
  })
  .strict();
const joinSchema = z
  .object({
    code: codeSchema,
    nickname: name,
    rule: ruleSchema,
    dndEdition: DndEditionSchema.optional(),
    seatCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-F0-9]{16}$/)
      .optional(),
  })
  .strict();
const revision = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER - 1);
function pendingReview(characterRevision: number, policyRevision: number): Member['review'] {
  return { status: 'pending', note: '', reviewedAt: null, characterRevision, policyRevision };
}
function invalidateReviews(room: Room) {
  room.members.forEach((member) => {
    member.ready = false;
    member.review = pendingReview(member.characterRevision, room.policyRevision);
  });
}
// Old rooms have no review metadata; an old active session must be rechecked.
function migrateSaved(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || !('room' in raw)) return raw;
  const candidate = structuredClone(raw) as { room: Record<string, unknown> };
  const room = candidate.room;
  if (
    !room ||
    typeof room !== 'object' ||
    !['dnd', 'coc'].includes(String(room.rule)) ||
    !Array.isArray(room.members)
  )
    return raw;
  const legacy =
    room.creationPolicy === undefined ||
    room.policyRevision === undefined ||
    room.keeperCards === undefined ||
    room.members.some(
      (member) =>
        member &&
        typeof member === 'object' &&
        (member.characterRevision === undefined || member.review === undefined),
    );
  // New private libraries and encounter tools do not invalidate existing reviews.
  room.historyComplete ??= Array.isArray(room.log) && room.log.length < 300;
  room.atlases ??= [];
  room.configRevision ??= 0;
  room.dndCards ??= [];
  room.encounter ??= emptyEncounter();
  if (!legacy) return candidate;
  room.creationPolicy ??= defaultCreationPolicy(room.rule as 'dnd' | 'coc');
  room.policyRevision ??= 0;
  room.keeperCards ??= [];
  room.phase = 'lobby';
  room.initiative = [];
  room.activeTurn = 0;
  room.round = 0;
  room.members.forEach((member) => {
    if (!member || typeof member !== 'object') return;
    member.characterRevision ??= member.character ? 1 : 0;
    member.ready = false;
    member.review = pendingReview(member.characterRevision, room.policyRevision as number);
  });
  return candidate;
}
const actionSchema = z.discriminatedUnion('type', [
  ...EncounterActionSchemas,
  ...CharacterRuntimeActionSchemas,
  ...CocRuntimeActionSchemas,
  ...PreparationActionSchemas,
  z.object({ type: z.literal('atlas-save'), atlases: AtlasLibrarySchema.min(1) }).strict(),
  z.object({ type: z.literal('atlas-delete'), atlasId: id }).strict(),
  z.object({ type: z.literal('atlas-publish'), atlasId: id, sceneId: id }).strict(),
  z
    .object({
      type: z.literal('room-config'),
      configuration: RoomConfigSchema,
      expectedRevision: revision,
    })
    .strict(),
  z
    .object({
      type: z.literal('character-adjust'),
      memberId: id,
      characterId: id,
      expectedRevision: revision,
      edit: CharacterAdjustmentEditSchema,
    })
    .strict(),
  z
    .object({ type: z.literal('dnd-save'), cards: z.array(DndStatBlockSchema).min(1).max(200) })
    .strict(),
  z.object({ type: z.literal('dnd-delete'), cardId: id }).strict(),
  z
    .object({
      type: z.literal('creation-policy'),
      policy: CreationPolicySchema,
      expectedRevision: revision,
    })
    .strict(),
  z
    .object({
      type: z.literal('review-character'),
      memberId: id,
      decision: z.enum(['approved', 'changes']),
      note: z.string().max(2000),
      characterRevision: revision,
      policyRevision: revision,
    })
    .strict(),
  z
    .object({ type: z.literal('keeper-save'), cards: z.array(KeeperCardSchema).min(1).max(200) })
    .strict(),
  z.object({ type: z.literal('keeper-delete'), cardId: id }).strict(),
  z.object({ type: z.literal('character'), character: characterSchema }).strict(),
  z.object({ type: z.literal('ready'), ready: z.boolean() }).strict(),
  ...(['start', 'pause', 'leave'] as const).map((type) =>
    z.object({ type: z.literal(type) }).strict(),
  ),
  z.object({ type: z.literal('message'), content: z.string().trim().min(1).max(2000) }).strict(),
  z
    .object({
      type: z.literal('roll'),
      expression: z.string().trim().min(1).max(120),
      visibility: visibilitySchema,
      requestId: id.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('check'),
      check: checkSchema,
      visibility: visibilitySchema,
      requestId: id.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('scene'),
      title: z.string().trim().max(100),
      description: z.string().max(4000),
    })
    .strict(),
  z.object({ type: z.literal('mode'), mode: modeSchema }).strict(),
  z.strictObject({
    type: z.literal('next-turn'),
    expectedRevision: z.number().int().min(0).max(1000000000).optional(),
    requestId: id.optional(),
  }),
  z
    .object({
      type: z.literal('resource'),
      memberId: id,
      resource: z.enum(['hp', 'mp', 'san']),
      value: z.number().int().min(0).max(9999),
      hpConfirmation: HpConfirmationSchema.optional(),
    })
    .strict(),
  z.object({ type: z.literal('item-add'), memberId: id, item: itemSchema }).strict(),
  z.object({ type: z.literal('item-remove'), memberId: id, itemId: id }).strict(),
  z.object({ type: z.literal('kick'), memberId: id }).strict(),
  z.object({ type: z.literal('transfer-host'), memberId: id }).strict(),
]);
const savedSchema = z
  .object({
    room: roomSchema,
    tokens: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
    updatedAt: z.number().finite(),
    seatClaims: z.record(z.string(), z.string().regex(/^[A-F0-9]{16}$/)).default({}),
    imageDescriptions: z.record(z.string(), z.string().trim().min(1).max(2000)).default({}),
    imageSessionAt: z.number().finite().nullable().default(null),
  })
  .strict();
interface StoredRoom {
  room: Room;
  tokens: Record<string, string>;
  updatedAt: number;
  seatClaims: Record<string, string>;
  imageDescriptions: Record<string, string>;
  imageSessionAt: number | null;
}
interface BoundSeat {
  roomCode: string;
  memberId: string;
}
export interface ServerOptions {
  dataDir?: string;
  imageDir?: string;
  geminiKey?: string;
  geminiModel?: string;
  allowedOrigins?: string[];
  maxRooms?: number;
  roomTtlMs?: number;
  rng?: DieRandom;
  fetch?: typeof fetch;
  now?: () => number;
  httpRateLimits?: Partial<{ imageReads: number; inspiration: number; frontendFallback: number }>;
}
const COLORS = [
  '#f5bb7d',
  '#8bb9cb',
  '#b69adb',
  '#9bc6a1',
  '#dc9eac',
  '#bfbd7c',
  '#7ec1bc',
  '#b1add7',
];
const failure = (error: unknown) => (error instanceof Error ? error.message : '操作失败，请重试');
function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error('输入格式或数值无效，请检查后重试');
  return result.data;
}

function rulePack(fileName: string): unknown {
  const source = new URL(`../public/rules/${fileName}`, import.meta.url);
  const built = new URL(`../dist/rules/${fileName}`, import.meta.url);
  return JSON.parse(readFileSync(existsSync(source) ? source : built, 'utf8'));
}

export function createAppServer(options: ServerOptions = {}) {
  const now = options.now ?? Date.now;
  const rng = options.rng;
  const fetcher = options.fetch ?? fetch;
  const dataDir = resolve(options.dataDir ?? process.env.DATA_DIR ?? './data');
  const storagePath = resolve(dataDir, 'rooms.json');
  const imageDir = resolve(options.imageDir ?? process.env.IMAGE_DIR ?? resolve(dataDir, 'images'));
  const ttl = options.roomTtlMs ?? 7 * 24 * 60 * 60 * 1000;
  const maxRooms = options.maxRooms ?? 200;
  const geminiKey = options.geminiKey ?? process.env.GEMINI_API_KEY ?? '';
  const geminiModel = options.geminiModel ?? process.env.GEMINI_MODEL ?? 'gemini-3.8-flash';
  const allowedOrigins =
    options.allowedOrigins ??
    (process.env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  const spellCatalogs = new Map<DndEdition, (id: string) => DndSpellReference | undefined>();
  function spellCatalog(dndEdition?: DndEdition) {
    const edition = getDndEdition(dndEdition);
    const cached = spellCatalogs.get(edition);
    if (cached) return cached;
    try {
      const pack = parseDndReferencePack(rulePack(`dnd-${edition}.json`));
      requireCondition(pack.edition === edition, '法术资料版次不符');
      const index = new Map(pack.spells.map((spell) => [spell.id, spell]));
      const find = (id: string) => index.get(id);
      spellCatalogs.set(edition, find);
      return find;
    } catch {
      throw new Error('服务器暂无法读取本版法术资料');
    }
  }
  const equipmentCatalogs = new Map<DndEdition, Map<string, DndItemDetails>>();
  function equipmentCatalog(dndEdition?: DndEdition) {
    const edition = getDndEdition(dndEdition);
    const cached = equipmentCatalogs.get(edition);
    if (cached) return cached;
    try {
      const pack = parseEquipmentCatalog(rulePack(`equipment-${edition}.json`));
      requireCondition(pack.edition === edition, '装备目录版次不符');
      const catalog = new Map(
        pack.items.map((item) => [item.id, itemFromEquipmentCatalog(item).equipment!]),
      );
      equipmentCatalogs.set(edition, catalog);
      return catalog;
    } catch {
      throw new Error('服务器暂无法读取本版装备目录');
    }
  }
  const equipmentFields = [
    'edition',
    'kind',
    'gearType',
    'sourcePath',
    'baseName',
    'unitCostCp',
    'weapon',
    'armor',
    'shield',
    'container',
  ] as const;
  function runtimeErrors(character: Character): string[] {
    try {
      if (character.rule === 'coc') return getCocSessionErrors(character);
      const errors = character.dndMagic
        ? getDndMagicErrors(character, spellCatalog(character.dndEdition))
        : [];
      for (const item of character.items) {
        const details = item.equipment;
        if (!details) continue;
        const official = equipmentCatalog(character.dndEdition).get(details.catalogId);
        if (
          !official ||
          equipmentFields.some((field) => !isDeepStrictEqual(official[field], details[field]))
        )
          errors.push(`「${item.name}」的装备基础数值与本版目录不符`);
        else if (
          details.unitWeightLb !== official.unitWeightLb &&
          !item.notes.trim() &&
          !details.bonusSource.trim()
        )
          errors.push(`「${item.name}」的重量覆盖须在备注或来源中说明`);
      }
      return errors;
    } catch (error) {
      return [failure(error)];
    }
  }
  const validRuntimeRoster = (room: Room) =>
    room.members.every(({ character }) => !character || runtimeErrors(character).length === 0);
  mkdirSync(dataDir, { recursive: true });
  const images = new ImageLifecycle(dataDir, imageDir);
  const rooms = new Map<string, StoredRoom>();
  if (existsSync(storagePath)) {
    try {
      const saved: unknown = JSON.parse(readFileSync(storagePath, 'utf8'));
      if (Array.isArray(saved))
        for (const raw of saved.slice(0, maxRooms)) {
          const checked = savedSchema.safeParse(migrateSaved(raw));
          if (!checked.success) continue;
          const entry = checked.data as StoredRoom;
          if (
            !validRoomReferences(entry.room) ||
            Object.keys(entry.tokens).length !== entry.room.members.length ||
            entry.room.members.some((m) => !entry.tokens[m.id]) ||
            Object.keys(entry.seatClaims).some(
              (memberId) =>
                !entry.room.members.some((m) => m.id === memberId && m.role === 'player'),
            )
          )
            continue;
          for (const event of entry.room.log)
            if (event.image) {
              event.image = images.recover(
                event.image,
                entry.imageSessionAt ?? (event.image.reference ? 0 : entry.updatedAt),
              );
            }
          if (now() - entry.updatedAt > ttl) continue;
          entry.room.members.forEach((m) => {
            m.online = false;
          });
          rooms.set(entry.room.code, entry);
        }
    } catch {
      console.warn('房间存档无法读取，已跳过；原文件将在下次保存时更新。');
    }
  }
  images.discoverOrphans();
  images.collect(now());
  const app = express();
  app.disable('x-powered-by');
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    // Large preparation imports are bounded by the same 8 MiB transport limit.
    maxHttpBufferSize: 8 * 1024 * 1024,
    cors: allowedOrigins.length ? { origin: allowedOrigins, credentials: true } : undefined,
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      try {
        const parsed = new URL(origin);
        callback(null, parsed.host === request.headers.host);
      } catch {
        callback('来源无效', false);
      }
    },
  });
  const bindings = new Map<string, BoundSeat>();
  const rateBuckets = new Map<string, { start: number; count: number }>();
  const aiLast = new Map<string, number>();
  let transaction: {
    entry: StoredRoom;
    before: StoredRoom;
    bindings: Map<string, BoundSeat>;
    aiLast: Map<string, number>;
    committed: boolean;
  } | null = null;
  function rate(key: string, max: number, interval = 60_000) {
    const current = now();
    let bucket = rateBuckets.get(key);
    if (!bucket || current - bucket.start >= interval) {
      bucket = { start: current, count: 0 };
      rateBuckets.set(key, bucket);
    }
    bucket.count += 1;
    requireCondition(bucket.count <= max, '操作过于频繁，请稍后重试');
  }
  // Use the connection address, not untrusted forwarded headers. Behind a proxy,
  // the generous per-address limits are shared by clients using that proxy.
  const connectionKey = (request: express.Request) =>
    ipKeyGenerator(request.socket.remoteAddress ?? 'unknown');
  const imageReadStore = new MemoryStore();
  const inspirationStore = new MemoryStore();
  const frontendFallbackStore = new MemoryStore();
  const imageReadLimit = rateLimit({
    windowMs: 60_000,
    limit: options.httpRateLimits?.imageReads ?? 1200,
    store: imageReadStore,
    keyGenerator: (request) => `${request.params.code}:${request.headers['x-interlude-member']}`,
    legacyHeaders: false,
    message: { error: '操作过于频繁，请稍后重试' },
  });
  const inspirationLimit = rateLimit({
    windowMs: 60_000,
    limit: options.httpRateLimits?.inspiration ?? 2400,
    store: inspirationStore,
    keyGenerator: connectionKey,
    legacyHeaders: false,
    message: { error: '操作过于频繁，请稍后重试' },
  });
  const frontendFallbackLimit = rateLimit({
    windowMs: 60_000,
    limit: options.httpRateLimits?.frontendFallback ?? 3000,
    store: frontendFallbackStore,
    keyGenerator: connectionKey,
    legacyHeaders: false,
    message: { error: '操作过于频繁，请稍后重试' },
  });
  function persist() {
    const tempPath = `${storagePath}.${process.pid}.tmp`;
    try {
      writeFileSync(tempPath, JSON.stringify([...rooms.values()]), { mode: 0o600 });
      renameSync(tempPath, storagePath);
    } catch {
      throw new Error(
        '房间存档保存失败，操作未生效；请稍后重试，或联系部署者检查磁盘空间和数据目录权限',
      );
    }
    if (transaction) transaction.committed = true;
  }
  function view(entry: StoredRoom, memberId: string): Room {
    const isHost = entry.room.hostId === memberId;
    return {
      ...entry.room,
      members: isHost
        ? entry.room.members
        : entry.room.members.map((member) => {
            if (member.character?.rule === 'coc') {
              const { cocSession, cocInvestigator: _investigator, ...card } = member.character;
              if (member.id !== memberId) return { ...member, character: card };
              if (!cocSession) return member;
              const session: CocSession = {
                ...cocSession,
                sanity: {
                  ...cocSession.sanity,
                  pending:
                    cocSession.sanity.pending?.visibility === 'public'
                      ? cocSession.sanity.pending
                      : undefined,
                  insanity:
                    cocSession.sanity.insanity?.visibility === 'host'
                      ? null
                      : cocSession.sanity.insanity,
                  conditions: cocSession.sanity.conditions.filter(
                    ({ visibility }) => visibility !== 'host',
                  ),
                  sources: [],
                },
                history: cocSession.history.filter(({ visibility }) => visibility === 'public'),
                spells: cocSession.spells.map((spell) => ({
                  ...spell,
                  firstAttempt:
                    spell.firstAttempt?.visibility === 'host' ? undefined : spell.firstAttempt,
                  pushedAttempt:
                    spell.firstAttempt?.visibility === 'host' ||
                    spell.pushedAttempt?.visibility === 'host'
                      ? undefined
                      : spell.pushedAttempt,
                })),
              };
              return { ...member, character: { ...member.character, cocSession: session } };
            }
            if (member.id === memberId || member.character?.rule !== 'dnd') return member;
            const { dndMagic: _magic, dndEquipment: _equipment, ...card } = member.character;
            const items = card.items.filter((item) => !item.equipment);
            return {
              ...member,
              character: { ...card, items, ac: effectiveCharacter(member.character).ac },
            };
          }),
      log: entry.room.log.slice(-300).flatMap((event) => {
        const visible = visibleEvent(event, isHost);
        return visible ? [visible] : [];
      }),
      historyBefore: entry.room.log.length > 300 ? entry.room.log.at(-300)?.id : undefined,
      seatClaims: isHost
        ? Object.entries(entry.seatClaims).map(([memberId, code]) => ({ memberId, code }))
        : [],
      keeperCards: isHost ? entry.room.keeperCards : [],
      dndCards: isHost ? entry.room.dndCards : [],
      atlases: isHost ? entry.room.atlases : [],
      encounterPlans: isHost ? (entry.room.encounterPlans ?? []) : [],
      encounterPlanRevision: isHost ? (entry.room.encounterPlanRevision ?? 0) : 0,
      encounter: encounterView(entry.room.encounter, isHost, memberId),
    };
  }
  function projectInitiative(room: Room) {
    room.initiative = room.encounter.participants
      .filter((c) => c.memberId !== null && c.initiative !== null)
      .map((c) => ({ memberId: c.memberId!, value: c.initiative! }));
    room.activeTurn = Math.max(
      0,
      room.initiative.findIndex((c) => c.memberId === room.encounter.activeId),
    );
    room.round = room.encounter.round;
  }
  function syncPlayers(room: Room) {
    room.encounter = syncEncounterPlayers(room.encounter, room.members);
    projectInitiative(room);
  }
  const playing = (entry: StoredRoom) =>
    entry.room.phase === 'active' && entry.room.members.some((m) => m.online);
  function syncImageSessions() {
    try {
      images.endMissingRooms(new Set(rooms.keys()), now());
      for (const entry of rooms.values())
        images.setSession(
          entry.room.code,
          entry.room.log.flatMap((e) => (e.image ? [e.image] : [])),
          playing(entry),
          now(),
        );
    } catch {
      console.warn('图片保留记录更新失败，将在下一次维护时重试，请检查数据目录。');
    }
  }
  function broadcast(entry: StoredRoom) {
    entry.updatedAt = now();
    if (playing(entry) || images.isRoomActive(entry.room.code)) entry.imageSessionAt = now();
    persist();
    syncImageSessions();
    for (const [socketId, binding] of bindings)
      if (binding.roomCode === entry.room.code)
        io.sockets.sockets.get(socketId)?.emit('room:state', view(entry, binding.memberId));
  }
  function addEvent(
    entry: StoredRoom,
    type: RoomEvent['type'],
    member: Member | null,
    content: string,
    extra: Partial<RoomEvent> = {},
  ) {
    entry.room.log.push({
      id: randomUUID(),
      type,
      memberId: member?.id ?? '',
      name: member?.name ?? '系统',
      content,
      createdAt: new Date(now()).toISOString(),
      visibility: 'public',
      ...extra,
    });
    // Keep the full history on disk. Socket snapshots project only the newest 300 events.
  }
  function authenticate(raw: unknown): { entry: StoredRoom; member: Member; session: Session } {
    const session = parse(sessionSchema, raw);
    const entry = rooms.get(session.roomCode);
    requireCondition(entry, '房间不存在或已过期');
    const member = entry.room.members.find((m) => m.id === session.memberId);
    const expected = entry.tokens[session.memberId];
    requireCondition(
      member &&
        expected &&
        timingSafeEqual(Buffer.from(session.token, 'hex'), Buffer.from(expected, 'hex')),
      '会话凭证无效，请重新加入房间',
    );
    return { entry, member, session };
  }
  function seat(socket: Socket) {
    const binding = bindings.get(socket.id);
    requireCondition(binding, '请先创建或加入房间');
    const entry = rooms.get(binding.roomCode);
    const member = entry?.room.members.find((m) => m.id === binding.memberId);
    requireCondition(entry && member, '你已离开该房间');
    return { entry, member };
  }
  function bind(socket: Socket, entry: StoredRoom, member: Member) {
    const existing = bindings.get(socket.id);
    requireCondition(
      !existing || (existing.roomCode === entry.room.code && existing.memberId === member.id),
      '请先离开当前房间',
    );
    bindings.set(socket.id, { roomCode: entry.room.code, memberId: member.id });
    member.online = true;
  }
  function removeMember(entry: StoredRoom, member: Member, reason: string) {
    const notifications: (() => void)[] = [];
    entry.room.members = entry.room.members.filter((m) => m.id !== member.id);
    delete entry.tokens[member.id];
    delete entry.seatClaims[member.id];
    aiLast.delete(`${entry.room.code}:${member.id}`);
    for (const [socketId, binding] of bindings)
      if (binding.roomCode === entry.room.code && binding.memberId === member.id) {
        bindings.delete(socketId);
        notifications.push(() => io.sockets.sockets.get(socketId)?.emit('room:left', { reason }));
      }
    addEvent(entry, 'system', null, `${member.name}${reason}`);
    if (member.id === entry.room.hostId) {
      const successor = entry.room.members.find((m) => m.online);
      if (successor) {
        successor.role = 'host';
        entry.room.hostId = successor.id;
        entry.room.phase = 'lobby';
        invalidateReviews(entry.room);
        addEvent(entry, 'system', null, `${successor.name}接任主持人，房间返回准备阶段`);
      } else {
        for (const [socketId, binding] of bindings)
          if (binding.roomCode === entry.room.code) {
            bindings.delete(socketId);
            notifications.push(() =>
              io.sockets.sockets
                .get(socketId)
                ?.emit('room:left', { reason: '主持人已离开，房间已关闭' }),
            );
          }
        rooms.delete(entry.room.code);
        persist();
        syncImageSessions();
        notifications.forEach((notify) => notify());
        return;
      }
    }
    if (entry.room.members.length === 0) {
      rooms.delete(entry.room.code);
      persist();
      syncImageSessions();
      notifications.forEach((notify) => notify());
      return;
    }
    syncPlayers(entry.room);
    broadcast(entry);
    notifications.forEach((notify) => notify());
  }
  function cleanup() {
    for (const entry of rooms.values()) if (playing(entry)) entry.imageSessionAt = now();
    for (const [code, entry] of rooms)
      if (now() - entry.updatedAt > ttl && !entry.room.members.some((m) => m.online))
        rooms.delete(code);
    for (const [key, bucket] of rateBuckets)
      if (now() - bucket.start > 60_000) rateBuckets.delete(key);
    for (const key of aiLast.keys()) if (!rooms.has(key.split(':')[0]!)) aiLast.delete(key);
    try {
      persist();
    } catch {
      console.warn('房间清理后的存档保存失败，请检查数据目录。');
    }
    syncImageSessions();
    try {
      images.collect(now());
    } catch {
      console.warn('图片清理失败，将在下次维护时重试，请检查图片目录。');
    }
  }
  const cleanupTimer = setInterval(cleanup, 60_000);
  cleanupTimer.unref();

  io.on('connection', (socket) => {
    function handler<T>(event: string, work: (raw: unknown) => T) {
      socket.on(event, (raw: unknown, ack: ((result: Ack<T>) => void) | undefined) => {
        if (typeof ack !== 'function') return;
        try {
          rate(`socket:${socket.id}`, 180);
          if (event === 'room:action') {
            const { entry } = seat(socket);
            transaction = {
              entry,
              before: structuredClone(entry),
              bindings: new Map(bindings),
              aiLast: new Map(aiLast),
              committed: false,
            };
          }
          ack({ ok: true, data: work(raw) });
        } catch (error) {
          if (transaction && !transaction.committed) {
            Object.assign(transaction.entry, transaction.before);
            rooms.set(transaction.entry.room.code, transaction.entry);
            bindings.clear();
            transaction.bindings.forEach((value, key) => bindings.set(key, value));
            aiLast.clear();
            transaction.aiLast.forEach((value, key) => aiLast.set(key, value));
          }
          ack({ ok: false, error: failure(error) });
        } finally {
          transaction = null;
        }
      });
    }
    handler<RoomConnection>('room:create', (raw) => {
      requireCondition(!bindings.has(socket.id), '请先离开当前房间');
      const input = parse(createSchema, raw);
      requireCondition(
        !input.configuration || input.configuration.rule === input.rule,
        '配置规则与所选规则不匹配',
      );
      requireCondition(
        input.rule === 'dnd' || input.dndEdition === undefined,
        '规则版次仅适用于 D&D',
      );
      const dndEdition = input.dndEdition ?? input.configuration?.dndEdition;
      requireCondition(
        !input.configuration ||
          getDndEdition(input.configuration.dndEdition) === getDndEdition(dndEdition),
        '配置的 D&D 版次与所选版本不匹配',
      );
      rate(`create:${socket.handshake.address}`, 10);
      cleanup();
      requireCondition(rooms.size < maxRooms, '当前房间数量已达上限，请稍后再试');
      let code: string;
      do {
        code = randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
      } while (rooms.has(code));
      const member: Member = {
        id: randomUUID(),
        name: input.nickname,
        role: 'host',
        color: COLORS[0]!,
        online: true,
        ready: false,
        character: null,
        characterRevision: 0,
        review: pendingReview(0, 0),
      };
      const token = randomBytes(32).toString('hex');
      const entry: StoredRoom = {
        room: {
          code,
          name: input.configuration?.name ?? input.name,
          rule: input.rule,
          ...(dndEdition === undefined ? {} : { dndEdition }),
          ...(input.rule === 'coc'
            ? { cocRules: cocRoomRules(input.configuration?.cocRules) }
            : {}),
          mode: input.configuration?.mode ?? input.mode,
          hostId: member.id,
          phase: 'lobby',
          members: [member],
          log: [],
          historyComplete: true,
          scene: input.configuration?.scene ?? { title: '', description: '' },
          initiative: [],
          activeTurn: 0,
          round: 0,
          createdAt: new Date(now()).toISOString(),
          creationPolicy: input.configuration?.creationPolicy ?? defaultCreationPolicy(input.rule),
          policyRevision: 0,
          configRevision: 0,
          atlases: [],
          keeperCards: [],
          dndCards: [],
          encounterPlans: [],
          encounterPlanRevision: 0,
          encounter: emptyEncounter(),
        },
        tokens: { [member.id]: token },
        seatClaims: {},
        imageDescriptions: {},
        imageSessionAt: null,
        updatedAt: now(),
      };
      rooms.set(code, entry);
      bind(socket, entry, member);
      addEvent(entry, 'system', null, `${member.name}创建了房间`);
      broadcast(entry);
      return {
        session: { roomCode: code, memberId: member.id, token },
        room: view(entry, member.id),
      };
    });
    handler<RoomConnection>('room:join', (raw) => {
      requireCondition(!bindings.has(socket.id), '请先离开当前房间');
      const input = parse(joinSchema, raw);
      const entry = rooms.get(input.code);
      requireCondition(entry, '房间不存在或已过期');
      requireCondition(entry.room.rule === input.rule, '规则不匹配，请选择与房间相同的规则');
      requireCondition(
        input.rule === 'dnd' || input.dndEdition === undefined,
        '规则版次仅适用于 D&D',
      );
      requireCondition(
        getDndEdition(entry.room.dndEdition) === getDndEdition(input.dndEdition),
        'D&D 版次不匹配，请选择与房间相同的版本',
      );
      rate(`join:${socket.handshake.address}`, 30);
      if (input.seatCode) {
        const memberId = Object.entries(entry.seatClaims).find(
          ([, code]) => code === input.seatCode,
        )?.[0];
        const member = entry.room.members.find((m) => m.id === memberId && m.role === 'player');
        requireCondition(member, '席位恢复码无效或已使用，请向主持人确认');
        transaction = {
          entry,
          before: structuredClone(entry),
          bindings: new Map(bindings),
          aiLast: new Map(aiLast),
          committed: false,
        };
        delete entry.seatClaims[member.id];
        member.name = input.nickname;
        addEvent(entry, 'system', null, `${member.name}回到了上次的席位`);
        bind(socket, entry, member);
        broadcast(entry);
        return {
          session: {
            roomCode: entry.room.code,
            memberId: member.id,
            token: entry.tokens[member.id],
          },
          room: view(entry, member.id),
        };
      }
      requireCondition(
        entry.room.phase === 'lobby',
        '故事已经开始，续团玩家请填写主持人提供的席位恢复码',
      );
      requireCondition(entry.room.members.length < 8, '房间已满，最多容纳 8 人');
      const member: Member = {
        id: randomUUID(),
        name: input.nickname,
        role: 'player',
        color: COLORS[entry.room.members.length]!,
        online: true,
        ready: false,
        character: null,
        characterRevision: 0,
        review: pendingReview(0, entry.room.policyRevision),
      };
      const token = randomBytes(32).toString('hex');
      entry.room.members.push(member);
      entry.tokens[member.id] = token;
      bind(socket, entry, member);
      addEvent(entry, 'system', null, `${member.name}加入了房间`);
      broadcast(entry);
      return {
        session: { roomCode: entry.room.code, memberId: member.id, token },
        room: view(entry, member.id),
      };
    });
    handler<RoomConnection>('room:resume', (raw) => {
      const { entry, member, session } = authenticate(raw);
      bind(socket, entry, member);
      broadcast(entry);
      return { session, room: view(entry, member.id) };
    });
    handler<null>('room:action', (raw) => {
      const type = raw && typeof raw === 'object' && 'type' in raw ? raw.type : undefined;
      const bulk =
        typeof type === 'string' &&
        ['keeper-save', 'dnd-save', 'atlas-save', 'encounter-plan-save'].includes(type);
      // The portable character limit is measured in characters, which may occupy up to 3 bytes each.
      const limit = (bulk ? 8 : type === 'character' ? 1 : 0.5) * 1024 * 1024;
      requireCondition(
        Buffer.byteLength(JSON.stringify(raw) ?? '', 'utf8') <= limit,
        '提交内容过大，请分批保存',
      );
      const action = parse(actionSchema, raw) as RoomAction;
      rate(
        `action:${socket.id}:${action.type}`,
        action.type === 'message' || action.type === 'roll' || action.type === 'check' ? 45 : 90,
      );
      const { entry, member } = seat(socket);
      const room = entry.room;
      const host = () =>
        requireCondition(
          room.hostId === member.id && member.role === 'host',
          '只有主持人可以进行此操作',
        );
      const lobby = () => requireCondition(room.phase === 'lobby', '此操作只能在准备阶段进行');
      const target = (memberId: string) => {
        requireCondition(memberId === member.id || room.hostId === member.id, '只能修改自己的角色');
        const targetMember = room.members.find((m) => m.id === memberId);
        requireCondition(targetMember?.character, '该成员尚未载入角色卡');
        requireCondition(targetMember.role === 'player', '主持人的保留人物卡不能在房间中修改');
        return targetMember.character;
      };
      const characterChanged = (memberId: string) => {
        const changed = room.members.find((m) => m.id === memberId)!;
        changed.characterRevision += 1;
        if (room.phase === 'lobby') {
          changed.ready = false;
          changed.review = pendingReview(changed.characterRevision, room.policyRevision);
        }
      };
      const encounterRevision = (expectedRevision: number) =>
        requireCondition(
          expectedRevision === room.encounter.revision,
          '战斗状态已更新，请刷新后再操作',
        );
      const combatant = (id: string) => {
        const selected = room.encounter.participants.find((c) => c.id === id);
        requireCondition(selected, '该参战者已不在本场');
        return selected;
      };
      const requestIdentity = (requestId: string) => {
        const combatRequestHash = createHash('sha256').update(JSON.stringify(action)).digest('hex');
        const committed = room.log.find(
          (event) =>
            event.combatRequestHash &&
            event.memberId === member.id &&
            event.requestId === requestId,
        );
        if (committed) {
          requireCondition(
            committed.combatRequestHash === combatRequestHash,
            '请求编号已经用于其他操作',
          );
          return { replayed: true, requestId, combatRequestHash };
        }
        return { replayed: false, requestId, combatRequestHash };
      };
      const encounterCommand = ({
        expectedRevision,
        requestId,
      }: {
        expectedRevision: number;
        requestId: string;
      }) => {
        const identity = requestIdentity(requestId);
        if (!identity.replayed) encounterRevision(expectedRevision);
        return identity;
      };
      const planRevision = (expectedRevision: number) =>
        requireCondition(
          (room.encounterPlanRevision ?? 0) === expectedRevision,
          '遭遇预案已更新，请刷新后再操作',
        );
      const publishAtlasScene = (atlasId: string, sceneId: string) => {
        const scene = room.atlases
          .find((atlas) => atlas.id === atlasId)
          ?.scenes.find((scene) => scene.id === sceneId);
        requireCondition(scene, '场景不存在，请刷新地图集或取消公开场景');
        room.scene = { title: scene.title, description: scene.description };
        room.configRevision += 1;
        addEvent(entry, 'system', member, `公布场景：${scene.title}`, {
          scene: structuredClone(room.scene),
        });
      };
      const requireActiveDnd = () =>
        requireCondition(
          room.rule === 'dnd' && room.phase === 'active',
          '请在进行中的 D&D 房间操作角色资源',
        );
      const runtimeTarget = (input: {
        memberId: string;
        characterId: string;
        expectedCharacterRevision: number;
      }) => {
        const character = target(input.memberId);
        const selected = room.members.find((m) => m.id === input.memberId)!;
        requireCondition(character.rule === 'dnd', '角色资源仅适用于 D&D');
        requireCondition(
          character.id === input.characterId &&
            selected.characterRevision === input.expectedCharacterRevision,
          '角色状态已更新，请载入最新数值后再操作',
        );
        requireCondition(
          selected.review.status === 'approved' &&
            selected.review.policyRevision === room.policyRevision &&
            selected.review.characterRevision <= selected.characterRevision,
          '角色需通过主持人审核后才能操作局内资源',
        );
        const errors = runtimeErrors(character);
        requireCondition(!errors.length, errors[0] ?? '角色资源或装备无效');
        return { selected, character };
      };
      const updateRuntimeCharacter = (selected: Member, next: Character) => {
        const life = room.encounter.participants.find((c) => c.memberId === selected.id);
        requireCondition(!life?.dead || next.hp === 0, '角色已死亡，请由主持人先确认复活');
        requireCondition(getCharacterErrors(next).length === 0, '更新后的角色资源或装备数值无效');
        const errors = runtimeErrors(next);
        requireCondition(!errors.length, errors[0] ?? '角色资源或装备无效');
        selected.character = { ...next, updatedAt: new Date(now()).toISOString() };
        characterChanged(selected.id);
      };
      const activeCoc = () =>
        requireCondition(room.rule === 'coc' && room.phase === 'active', '请先开启 CoC 故事');
      const cocTarget = (input: {
        memberId: string;
        characterId: string;
        expectedCharacterRevision: number;
      }) => {
        const character = target(input.memberId);
        const selected = room.members.find((m) => m.id === input.memberId)!;
        requireCondition(
          room.rule === 'coc' && character.rule === 'coc',
          '此操作仅适用于 CoC 调查员',
        );
        requireCondition(
          character.id === input.characterId &&
            selected.characterRevision === input.expectedCharacterRevision,
          '角色状态已更新，请载入最新数值后再操作',
        );
        if (room.phase === 'active')
          requireCondition(
            selected.review.status === 'approved' &&
              selected.review.policyRevision === room.policyRevision &&
              selected.review.characterRevision <= selected.characterRevision,
            '角色需通过主持人审核后才能操作局内资源',
          );
        return { selected, character };
      };
      const resolveMagic = (
        character: Character,
        memberId: string,
        edit: DndMagicEdit,
      ): DndMagicResult => {
        if (!character.dndMagic && edit.kind === 'rest') {
          requireCondition(
            !edit.hitDice &&
              !edit.prepared &&
              !edit.arcaneRecovery?.length &&
              !edit.sorcerousRestoration,
            '请在准备阶段配置角色资源并重新审核',
          );
          if (edit.rest === 'long' || getDndEdition(character.dndEdition) === '2024')
            requireCondition(character.hp > 0, '该休息开始时至少需要 1 HP');
          const hp = edit.rest === 'long' ? character.maxHp : character.hp;
          return {
            state: undefined,
            hp,
            summary: edit.rest === 'long' ? `完成长休，HP 恢复到 ${hp}` : '完成短休',
            spentSlot: false,
          };
        }
        return applyDndMagicEdit(character, edit, {
          catalog: spellCatalog(character.dndEdition),
          rng,
          slotSpentThisTurn: room.encounter.slotSpentMemberIds?.includes(memberId),
          ...(edit.kind === 'cast' && dndArmorPreventsCasting(character)
            ? { castingBlockedReason: '所穿护甲或所持盾牌缺少相应训练，不能施法' }
            : {}),
        });
      };
      const combatantName = (c: Combatant, visibility: Visibility) => {
        if (visibility === 'host') return c.name;
        return c.revealed ? c.publicName : '未公开参战者';
      };
      const storeLife = (
        next: Combatant,
        state = replaceInjuredCombatant(room.encounter, next),
      ) => {
        if (next.dead || next.unconscious) next.concentration = '';
        if (next.memberId) {
          const selected = room.members.find((m) => m.id === next.memberId)!;
          const character = selected.character!;
          requireCondition(next.hp !== null && next.hp <= character.maxHp, '玩家 HP 无效');
          const concentrationChanged =
            character.dndMagic && next.concentration !== (character.dndMagic.concentration ?? '');
          if (character.hp !== next.hp || concentrationChanged) {
            character.hp = next.hp;
            if (concentrationChanged) {
              const { concentration: _old, ...magic } = character.dndMagic!;
              character.dndMagic = next.concentration
                ? { ...magic, concentration: next.concentration }
                : magic;
            }
            character.updatedAt = new Date(now()).toISOString();
            characterChanged(selected.id);
          }
        }
        room.encounter = state;
      };
      const lifeCheck = (
        c: Combatant,
        kind: 'death' | 'constitution',
        visibility: Visibility,
        options: {
          modifier?: number;
          edge?: Edge;
          completedRound?: number;
          identity?: { requestId: string; combatRequestHash: string };
        } = {},
      ) => {
        const name = combatantName(c, visibility);
        if (kind === 'death') {
          requireCondition(
            usesDeathSaves(c) && c.hp === 0 && !c.dead && !c.stable && c.deathFailures < 3,
            '该角色当前不需要死亡豁免',
          );
          const turnKey = room.encounter.activeId ? room.encounter.round : undefined;
          requireCondition(
            !turnKey || c.injuryChecks?.lastDeathRound !== turnKey,
            '本回合已记录死亡豁免',
          );
          const rolled = rollDice(options.edge && options.edge !== 'normal' ? '2d20' : '1d20', rng);
          const dice = rolled.groups[0].rolls;
          const die =
            options.edge === 'advantage'
              ? Math.max(...dice)
              : options.edge === 'disadvantage'
                ? Math.min(...dice)
                : dice[0];
          const next = applyDeathSave(c, die, options.modifier ?? 0);
          next.injuryChecks = {
            ...next.injuryChecks,
            ...(turnKey ? { lastDeathRound: turnKey } : {}),
          };
          storeLife(next);
          const total = die + (options.modifier ?? 0);
          addEvent(
            entry,
            'system',
            member,
            `${name}死亡豁免：d20 ${dice.join(' / ')} 取 ${die}，加值 ${options.modifier ?? 0}；${injuryLabels(next).join('、') || '恢复意识'}。成功 ${next.deathSuccesses} 次，失败 ${next.deathFailures} 次，HP ${next.hp}。`,
            {
              ...options.identity,
              check: {
                label: '死亡豁免',
                rolls: dice,
                selected: die,
                modifier: options.modifier ?? 0,
                total,
                target: 10,
                success: die === 20 || (die !== 1 && total >= 10),
                outcome:
                  die === 20
                    ? '自然 20：恢复 1 HP'
                    : die === 1
                      ? '自然 1：两次失败'
                      : total >= 10
                        ? '成功'
                        : '失败',
              },
              visibility,
              secretLabel: '死亡豁免',
            },
          );
        } else {
          requireCondition(
            c.rule === 'coc' && !c.dead && (c.dying || c.injuryChecks?.conPending),
            '该角色当前没有待处理的伤势体质检定',
          );
          const character = room.members.find((m) => m.id === c.memberId)?.character;
          const con = character
            ? effectiveCharacter(character).attributes.con
            : c.source?.attributes.con;
          requireCondition(con !== null && con !== undefined, '该角色缺少体质，请补充后检定');
          const check = rollCheck(
            'coc',
            null,
            {
              kind: 'ability',
              key: 'con',
              target: con,
              dc: 0,
              modifier: 0,
              edge: options.edge ?? 'normal',
            },
            rng,
          );
          const next = applyConstitution(
            c,
            check.success,
            options.completedRound ?? room.encounter.round,
          );
          storeLife(next);
          addEvent(
            entry,
            'system',
            member,
            `${name}${c.dying ? '濒死' : '重伤'}体质检定：${check.total} / ${con}，${check.outcome}；${injuryLabels(next).join('、') || '保持清醒'}。`,
            { ...options.identity, check, visibility, secretLabel: '伤势体质检定' },
          );
        }
      };
      const autoConstitution = (
        c: Combatant,
        completedRound?: number,
        visibility: Visibility = c.memberId ? 'public' : 'host',
      ) => {
        const character = room.members.find((m) => m.id === c.memberId)?.character;
        if ((character?.attributes.con ?? c.source?.attributes.con) == null) {
          addEvent(entry, 'system', member, `${c.name}缺少体质，伤势检定需由主持人处理。`, {
            visibility: 'host',
          });
          return;
        }
        lifeCheck(c, 'constitution', visibility, { completedRound });
      };
      const advanceLifeChecks = (beforeRound: number, beforeId: string | null) => {
        if (!room.encounter.autoLifeChecks) return;
        if (room.rule === 'coc' && room.encounter.round > beforeRound && beforeRound > 0) {
          for (const c of [...room.encounter.participants])
            if (!c.dead && c.dying && (c.injuryChecks?.cocDueRound ?? beforeRound) <= beforeRound)
              autoConstitution(c, beforeRound);
        }
        if (
          room.rule === 'dnd' &&
          (room.encounter.activeId !== beforeId || room.encounter.round !== beforeRound)
        ) {
          const c = room.encounter.participants.find((p) => p.id === room.encounter.activeId);
          if (
            c &&
            usesDeathSaves(c) &&
            c.hp === 0 &&
            !c.dead &&
            !c.stable &&
            c.injuryChecks?.lastDeathRound !== room.encounter.round
          )
            lifeCheck(c, 'death', c.memberId ? 'public' : 'host');
        }
      };
      const manualHealth = (input: RoomAction) => {
        const change = manualHpChange(room, input);
        if (!change) return null;
        const preview = previewManualHp(room, change);
        const confirmation = 'hpConfirmation' in input ? input.hpConfirmation : undefined;
        if (confirmation) {
          encounterRevision(confirmation.expectedRevision);
          requireCondition(
            confirmation.expectedHp === change.target.hp,
            '角色 HP 已变化，请重新确认',
          );
          if (confirmation.outcome === 'dead') {
            host();
            requireCondition(change.value === 0, '只有 HP 为 0 时才能确认死亡');
          }
        }
        requireCondition(
          !preview.requiresConfirmation || !!confirmation,
          '此 HP 修改会触发昏迷、濒死或死亡，请先确认',
        );
        let next: Combatant = { ...change.target, hp: change.value };
        if (change.value > (change.target.hp ?? change.value))
          next = healInjury(change.target, change.value);
        else if (room.encounter.autoDamage && room.phase === 'active')
          next = confirmation?.outcome === 'dead' ? markDead(next) : preview.combatant;
        return { ...change, next, confirmed: !!confirmation };
      };
      const finishManualHealth = (next: Combatant, confirmed: boolean) => {
        storeLife(next);
        if (confirmed)
          addEvent(
            entry,
            'system',
            member,
            `${next.name}已确认 HP 调整为 ${next.hp}${room.encounter.autoDamage ? `，${injuryLabels(next).join('、') || '无新增伤势'}` : '；自动扣血关闭，伤势由主持人记录'}。`,
            { visibility: next.memberId ? 'public' : 'host' },
          );
        if (room.encounter.autoLifeChecks && next.injuryChecks?.conPending && !next.dead)
          autoConstitution(next);
      };
      const cocArmor = (c: Combatant, override?: number) => {
        if (override !== undefined) return override;
        const character = room.members.find((m) => m.id === c.memberId)?.character;
        return character ? cocArmorValue(character) : effectiveCocArmor(c);
      };
      const equippedCocWeapon = (
        combatant: Combatant,
        weaponId: string,
        revision: number | undefined,
        distanceYards?: number,
      ) => {
        const selected = room.members.find((m) => m.id === combatant.memberId);
        requireCondition(
          selected?.character && revision !== undefined,
          '使用人物卡装备须提供调查员和最新角色版本',
        );
        const target = cocTarget({
          memberId: selected.id,
          characterId: selected.character.id,
          expectedCharacterRevision: revision,
        });
        requireCondition(
          !combatant.dead && !combatant.unconscious && target.character.hp > 0,
          '死亡或昏迷的角色不能攻击',
        );
        return {
          ...target,
          values: cocWeaponValues(target.character, weaponId, { distanceYards }),
        };
      };
      const unavailableDamage = (c: Combatant, armorOverride?: number) => {
        if (c.hp === null) return '目标 HP 未填写';
        if (c.rule === 'coc' && cocArmor(c, armorOverride) === null) return '目标护甲未知';
        return null;
      };
      const settleDamage = (
        c: Combatant,
        expression: string | DiceResult,
        visibility: Visibility,
        options: { adjustment?: DamageAdjustment; armorOverride?: number; critical?: boolean },
      ) => {
        const roll = typeof expression === 'string' ? rollDice(expression, rng) : expression;
        const result = applyEncounterDamage(room.encounter, c, roll.total, {
          ...options,
          ...(c.rule === 'coc'
            ? { armorOverride: cocArmor(c, options.armorOverride) ?? undefined }
            : {}),
          edition: room.dndEdition,
        });
        storeLife(result.combatant, result.state);
        if (
          room.encounter.autoLifeChecks &&
          result.combatant.injuryChecks?.conPending &&
          !result.combatant.dead
        )
          autoConstitution(
            result.combatant,
            undefined,
            !result.combatant.memberId ? 'host' : visibility,
          );
        const summary = `${combatantName(c, visibility)}的伤害骰 ${roll.expression} = ${roll.total}。`;
        if (!c.memberId && visibility === 'public')
          return { roll, summary: `${summary}已结算伤害。` };
        const reduction =
          c.rule === 'dnd'
            ? DAMAGE_ADJUSTMENT_LABELS[result.adjustment]
            : `护甲 ${result.armor} 抵消 ${Math.min(result.raw, result.armor)} 点`;
        const absorbed = result.tempAbsorbed ? `，临时 HP 吸收 ${result.tempAbsorbed}` : '';
        return {
          roll,
          summary: `${summary}结算 ${result.effective} 点伤害（${reduction}）${absorbed}，HP ${result.beforeHp} → ${result.combatant.hp}。${result.notes.join('')}`,
        };
      };
      switch (action.type) {
        case 'atlas-save':
          host();
          requireCondition(
            action.atlases.every((a) => a.rule === 'any' || a.rule === room.rule),
            '地图集规则与房间不匹配',
          );
          room.atlases = mergeAtlases(room.atlases, action.atlases);
          break;
        case 'atlas-delete':
          host();
          requireCondition(
            room.atlases.some((a) => a.id === action.atlasId),
            '地图册不存在',
          );
          room.atlases = room.atlases.filter((a) => a.id !== action.atlasId);
          break;
        case 'atlas-publish': {
          host();
          publishAtlasScene(action.atlasId, action.sceneId);
          break;
        }
        case 'encounter-plan-save': {
          host();
          planRevision(action.expectedRevision);
          requireCondition(
            action.plans.every((plan) =>
              validateEncounterPlanForRoom(plan, room.rule, room.dndEdition),
            ),
            '遭遇预案的规则或版次与房间不符',
          );
          const plans = new Map((room.encounterPlans ?? []).map((plan) => [plan.id, plan]));
          action.plans.forEach((plan) => plans.set(plan.id, plan));
          room.encounterPlans = parse(EncounterPlanLibrarySchema, [...plans.values()]);
          room.encounterPlanRevision = action.expectedRevision + 1;
          break;
        }
        case 'encounter-plan-delete': {
          host();
          planRevision(action.expectedRevision);
          const plans = room.encounterPlans ?? [];
          requireCondition(
            plans.some((plan) => plan.id === action.planId),
            '遭遇预案不存在',
          );
          room.encounterPlans = plans.filter((plan) => plan.id !== action.planId);
          room.encounterPlanRevision = action.expectedRevision + 1;
          break;
        }
        case 'encounter-plan-load': {
          host();
          const { replayed, ...identity } = encounterCommand(action);
          if (replayed) return null;
          planRevision(action.expectedPlanRevision);
          const plan = room.encounterPlans?.find((plan) => plan.id === action.planId);
          const wave = plan?.waves.find((wave) => wave.id === action.waveId);
          requireCondition(plan && wave, '遭遇预案或波次已移除');
          requireCondition(
            validateEncounterPlanForRoom(plan, room.rule, room.dndEdition),
            '遭遇预案的规则或版次与房间不符',
          );
          const next = loadEncounterWave(room.encounter, plan.id, wave, action.repeat ?? false);
          if (action.publishScene) {
            requireCondition(plan.scene, '该预案没有关联场景');
            publishAtlasScene(plan.scene.atlasId, plan.scene.sceneId);
          }
          room.encounter = next;
          addEvent(entry, 'system', member, `将「${plan.name}」的「${wave.name}」加入本场。`, {
            ...identity,
            visibility: 'host',
          });
          break;
        }
        case 'room-config':
          host();
          lobby();
          requireCondition(
            action.expectedRevision === room.configRevision,
            '房间配置已更新，请重新读取后再导入',
          );
          requireCondition(action.configuration.rule === room.rule, '配置规则与房间规则不匹配');
          requireCondition(
            getDndEdition(action.configuration.dndEdition) === getDndEdition(room.dndEdition),
            '配置的 D&D 版次与房间不匹配',
          );
          room.name = action.configuration.name;
          room.mode = action.configuration.mode;
          room.scene = structuredClone(action.configuration.scene);
          room.creationPolicy = structuredClone(action.configuration.creationPolicy);
          if (room.rule === 'coc') room.cocRules = cocRoomRules(action.configuration.cocRules);
          room.configRevision += 1;
          room.policyRevision += 1;
          invalidateReviews(room);
          addEvent(entry, 'system', member, '导入了房间配置，请重新准备并审核人物卡');
          break;
        case 'coc-rules': {
          host();
          requireCondition(room.rule === 'coc', '这组选用规则仅适用于 CoC');
          const { replayed, ...identity } = requestIdentity(action.requestId);
          if (replayed) return null;
          requireCondition(
            action.expectedRevision === room.configRevision,
            '房间配置已更新，请刷新后再修改',
          );
          room.cocRules = action.rules;
          room.configRevision += 1;
          addEvent(entry, 'system', member, '更新了 CoC 房间选用规则。', identity);
          break;
        }
        case 'character-coc': {
          const { edit } = action;
          const investigatorEdit = CocInvestigatorEditSchema.safeParse(edit);
          const ownEquipment = [
            'weapon-ammo',
            'weapon-reload',
            'weapon-clear-jam',
            'weapon-notes',
            'armor-equip',
            'armor-notes',
          ];
          const ownSession = ['development-mark', 'development-lock', 'spell-cast'];
          const preparatory = ['spell-save', 'spell-remove', 'tome-save', 'tome-remove'];
          if (
            room.phase === 'active' &&
            investigatorEdit.success &&
            !ownEquipment.includes(edit.kind) &&
            !(edit.kind === 'wealth-transaction' && edit.operation !== 'override')
          )
            host();
          const ownSanityRoll = edit.kind === 'sanity-roll' && edit.visibility === 'public';
          if (
            !investigatorEdit.success &&
            !ownSession.includes(edit.kind) &&
            !ownSanityRoll &&
            !(room.phase === 'lobby' && preparatory.includes(edit.kind))
          )
            host();
          if (!investigatorEdit.success && !preparatory.includes(edit.kind)) activeCoc();
          if (edit.kind === 'spell-cast' && edit.push) host();
          if ('visibility' in edit && edit.visibility === 'host') host();
          requireCondition(
            action.memberId === member.id || room.hostId === member.id,
            '只能修改自己的角色',
          );
          const { replayed, ...identity } = requestIdentity(action.requestId);
          if (replayed) return null;
          const { character, selected } = cocTarget(action);
          const baseState = room.encounter.participants.some((c) => c.memberId === selected.id)
            ? room.encounter
            : syncEncounterPlayers(room.encounter, room.members);
          const life = baseState.participants.find((c) => c.memberId === selected.id)!;
          let damage: Combatant | undefined;
          const validateHpChange = (value: number) => {
            if (value >= character.hp) return;
            const spell =
              edit.kind === 'spell-cast'
                ? previewCocSpellHp(room, selected.id, edit.spellId)
                : null;
            const preview = spell ?? previewManualHp(room, { target: life, value });
            const confirmation = action.hpConfirmation;
            if (confirmation) {
              encounterRevision(confirmation.expectedRevision);
              requireCondition(
                confirmation.expectedHp === character.hp,
                '角色 HP 已变化，请重新确认',
              );
              if (confirmation.outcome === 'dead') {
                host();
                requireCondition(value === 0, '只有 HP 为 0 时才能确认死亡');
              }
            }
            requireCondition(
              !preview.requiresConfirmation || !!confirmation,
              '此操作会触发昏迷、濒死或死亡，请先确认 HP 变化',
            );
            damage =
              room.encounter.autoDamage && room.phase === 'active'
                ? confirmation?.outcome === 'dead'
                  ? markDead(preview.combatant)
                  : preview.combatant
                : { ...life, hp: value };
          };
          const context = {
            now: new Date(now()).toISOString(),
            rng,
            id: randomUUID,
            rules: room.cocRules,
            life,
            validateHpChange,
          };
          const result = investigatorEdit.success
            ? {
                character: applyCocInvestigatorEdit(character, investigatorEdit.data, context),
                summary: '更新了调查员装备、财产或人物资料',
                visibility: 'host' as const,
                clearMajorWound: false,
              }
            : applyCocSessionEdit(
                character,
                edit as Parameters<typeof applyCocSessionEdit>[1],
                context,
              );
          if (!damage) validateHpChange(result.character.hp);
          if (character.cocSession?.sanity.pending && investigatorEdit.success)
            requireCondition(
              result.character.san === character.san,
              '请先确认或撤销待结算的理智检定',
            );
          if (result.character.hp > character.hp) damage = healInjury(life, result.character.hp);
          if (result.clearMajorWound) damage = { ...(damage ?? life), majorWound: false };
          updateRuntimeCharacter(selected, result.character);
          if (damage) {
            room.encounter = replaceInjuredCombatant(baseState, damage);
            if (room.encounter.autoLifeChecks && damage.injuryChecks?.conPending && !damage.dead)
              autoConstitution(damage, undefined, result.visibility);
          }
          addEvent(
            entry,
            'system',
            member,
            `${character.name} · ${result.summary}`.slice(0, 4000),
            {
              ...identity,
              visibility: result.visibility,
              ...(edit.kind === 'sanity-roll' && result.visibility === 'host'
                ? { secretLabel: '理智检定' }
                : {}),
            },
          );
          break;
        }
        case 'coc-check-followup': {
          const { replayed, ...identity } = requestIdentity(action.requestId);
          if (replayed) return null;
          activeCoc();
          const status = cocCheckStatus(room.log, action.eventId);
          requireCondition(status, '这次检定没有可继续结算的记录');
          if (action.edit.kind === 'decide-push') host();
          else requireCondition(status.original.memberId === member.id, '只能继续结算自己的检定');
          requireCondition(status.version === action.expectedVersion, '检定记录已更新，请重新查看');
          const { selected, character } = cocTarget({
            memberId: status.original.memberId,
            characterId: status.record.characterId,
            expectedCharacterRevision: action.expectedCharacterRevision,
          });
          requireCondition(
            (character.cocSession?.development.cycle ?? 0) === status.record.cycle,
            '这次检定已跨过幕间成长阶段',
          );
          const life = room.encounter.participants.find((c) => c.memberId === selected.id);
          requireCondition(!life?.dead, '死亡角色不能继续结算检定');
          const rules = cocRoomRules(room.cocRules);
          const eligible = cocCheckEligibility(status, rules);
          const followup = { originalEventId: status.original.id, version: status.version + 1 };
          const original = status.original.check!;
          const edit = action.edit;
          let record: CocCheckFollowup;
          let content: string;
          if (edit.kind === 'spend-luck') {
            requireCondition(eligible.canSpendLuck, '当前规则或检定结果不允许消耗幸运');
            const result = cocLuckResult(original, status.record.difficulty, edit.points);
            content = `${character.name}消耗 ${edit.points} 幸运，${original.label} ${original.total} → ${result.total}（${result.outcome}）。`;
            const next = spendCocLuck(character, edit.points, status.original.id, content, {
              now: new Date(now()).toISOString(),
              id: randomUUID,
            });
            updateRuntimeCharacter(selected, next);
            record = { kind: 'luck', ...followup, points: edit.points, result };
          } else if (edit.kind === 'request-push') {
            requireCondition(
              eligible.canRequestPush && !room.encounter.activeId,
              '当前规则、检定结果或战斗状态不允许孤注一掷',
            );
            record = {
              kind: 'push-request',
              ...followup,
              reason: edit.reason,
              consequence: edit.consequence,
            };
            content = `${character.name}申请孤注一掷，理由「${edit.reason}」，风险「${edit.consequence}」。`;
          } else if (edit.kind === 'decide-push') {
            requireCondition(eligible.canDecidePush, '没有等待批准的孤注一掷申请');
            const consequence = edit.consequence ?? status.request!.consequence;
            record = { kind: 'push-decision', ...followup, allowed: edit.allowed, consequence };
            content = `主持人${edit.allowed ? '允许' : '拒绝'}${character.name}孤注一掷${edit.allowed ? `，失败后果「${consequence}」` : ''}。`;
          } else {
            requireCondition(
              eligible.canPush && !room.encounter.activeId,
              '孤注一掷未获批准、已经结算，或战斗正在进行',
            );
            const request = {
              ...status.record.request,
              target: original.target,
              dc: 0,
              modifier: 0,
            };
            const result = cocResultAtDifficulty(
              rollCheck('coc', character, request, rng),
              status.record.difficulty,
            );
            record = { kind: 'pushed', ...followup, result };
            const consequence = status.decision?.consequence ?? status.request!.consequence;
            content = `${character.name}孤注一掷，${original.label}原骰 ${original.total}，重掷 ${result.total}（${result.outcome}）${result.success ? '' : `，失败后果「${consequence}」`}。`;
            if (rules.autoDevelopment && result.success && status.record.request.kind === 'skill') {
              const next = markCocDevelopment(
                character,
                status.record.request.key,
                status.original.id,
              );
              if (next !== character) updateRuntimeCharacter(selected, next);
            }
          }
          addEvent(entry, 'system', member, content, {
            ...identity,
            cocCheck: record,
            visibility: status.original.visibility,
          });
          break;
        }
        case 'character-adjust': {
          host();
          requireCondition(
            room.phase === 'active',
            '局内调整在故事开始后使用；准备阶段请编辑角色卡并重新审核',
          );
          const character = target(action.memberId);
          const selected = room.members.find((m) => m.id === action.memberId)!;
          requireCondition(
            character.id === action.characterId &&
              selected.characterRevision === action.expectedRevision,
            '角色状态已更新，请载入最新数值后再调整',
          );
          const updated = applyCharacterAdjustment(
            character,
            action.edit,
            new Date(now()).toISOString(),
          );
          requireCondition(getCharacterErrors(updated).length === 0, '调整后的角色卡数值无效');
          selected.character = updated;
          characterChanged(selected.id);
          addEvent(entry, 'system', member, adjustmentDescription(character, updated, action.edit));
          break;
        }
        case 'character-magic': {
          requireCondition(
            member.id === action.memberId || room.hostId === member.id,
            '只能修改自己的角色',
          );
          const { replayed, ...identity } = requestIdentity(action.requestId);
          if (replayed) return null;
          requireActiveDnd();
          requireCondition(
            action.edit.kind !== 'configure' && action.edit.kind !== 'disable',
            '请在准备阶段修改法术配置并重新审核',
          );
          if (action.edit.kind === 'scribe' || action.edit.kind === 'restore') host();
          const { selected, character } = runtimeTarget(action);
          if (action.edit.kind === 'cast' && getDndEdition(room.dndEdition) === '2014')
            requireCondition(
              !room.encounter.participants.find((c) => c.memberId === selected.id)?.surprised,
              '2014 版遭突袭者须等首回合结束后才能施法',
            );
          const result = resolveMagic(character, selected.id, action.edit);
          const { dndMagic: _previousMagic, ...baseCharacter } = character;
          updateRuntimeCharacter(selected, {
            ...baseCharacter,
            hp: result.hp,
            ...(result.state ? { dndMagic: result.state } : {}),
          });
          if (getDndEdition(room.dndEdition) === '2024' && result.spentSlot)
            room.encounter = markEncounterSpellSlot(room.encounter, selected.id);
          if (action.edit.kind === 'rest')
            room.encounter = recordEncounterRest(room.encounter, [selected.id], action.edit.rest);
          const activity =
            action.edit.kind === 'cast'
              ? '记录了一次施法'
              : action.edit.kind === 'rest'
                ? '完成了休息'
                : '更新了法术或职业资源';
          const components = result.spell?.components;
          const componentNote = result.componentNote;
          addEvent(
            entry,
            'system',
            member,
            [
              character.name + ' ' + result.summary,
              components ? `法术成分 ${components}` : '',
              componentNote ? `成分记录 ${componentNote}` : '',
            ]
              .filter(Boolean)
              .join('。')
              .slice(0, 4000),
            { visibility: 'host' },
          );
          addEvent(entry, 'system', member, `${character.name}${activity}。`, identity);
          break;
        }
        case 'character-equipment': {
          requireCondition(
            member.id === action.memberId || room.hostId === member.id,
            '只能修改自己的角色',
          );
          const { replayed, ...identity } = requestIdentity(action.requestId);
          if (replayed) return null;
          requireActiveDnd();
          if (
            action.edit.kind === 'configure' ||
            action.edit.kind === 'disable' ||
            action.edit.kind === 'add'
          )
            host();
          const { selected, character } = runtimeTarget(action);
          updateRuntimeCharacter(selected, applyDndEquipmentEdit(character, action.edit));
          addEvent(entry, 'system', member, `${character.name}更新了装备记录。`, identity);
          break;
        }
        case 'party-rest': {
          host();
          const { replayed, ...identity } = requestIdentity(action.requestId);
          if (replayed) return null;
          requireActiveDnd();
          const players = action.members.map((input) => ({
            ...runtimeTarget(input),
            hitDice: input.hitDice,
          }));
          const summaries: string[] = [];
          for (const { selected, character, hitDice } of players) {
            const result = resolveMagic(character, selected.id, {
              kind: 'rest',
              rest: action.rest,
              hitDice,
              confirmed: action.confirmed,
            });
            const { dndMagic: _previousMagic, ...baseCharacter } = character;
            updateRuntimeCharacter(selected, {
              ...baseCharacter,
              hp: result.hp,
              ...(result.state ? { dndMagic: result.state } : {}),
            });
            summaries.push(`${character.name} ${result.summary}`);
          }
          room.encounter = recordEncounterRest(
            room.encounter,
            players.map(({ selected }) => selected.id),
            action.rest,
          );
          addEvent(entry, 'system', member, summaries.join('。').slice(0, 4000), {
            visibility: 'host',
          });
          addEvent(
            entry,
            'system',
            member,
            `主持人确认 ${players.length} 位角色完成${action.rest === 'long' ? '长休' : '短休'}。`,
            identity,
          );
          break;
        }
        case 'creation-policy':
          host();
          lobby();
          requireCondition(
            action.expectedRevision === room.policyRevision,
            '建卡规则已更新，请刷新后再保存',
          );
          requireCondition(action.policy.rule === room.rule, '建卡规则与房间规则不匹配');
          room.creationPolicy = structuredClone(action.policy);
          room.policyRevision += 1;
          room.configRevision += 1;
          invalidateReviews(room);
          break;
        case 'review-character': {
          host();
          lobby();
          const reviewed = room.members.find((m) => m.id === action.memberId);
          requireCondition(
            reviewed?.role === 'player' && reviewed.character,
            '请选择已载入人物卡的玩家',
          );
          requireCondition(
            getDndEdition(reviewed.character.dndEdition) === getDndEdition(room.dndEdition),
            '角色卡的 D&D 版次与房间不匹配',
          );
          requireCondition(
            action.characterRevision === reviewed.characterRevision &&
              action.policyRevision === room.policyRevision,
            '人物卡或建卡规则已更新，请重新审核',
          );
          if (action.decision === 'approved')
            requireCondition(
              validateCreation(reviewed.character, room.creationPolicy).length === 0 &&
                runtimeErrors(reviewed.character).length === 0,
              '人物卡尚未完成分配或不符合建卡规则，不能通过审核',
            );
          reviewed.review = {
            status: action.decision,
            note: action.note,
            reviewedAt: new Date(now()).toISOString(),
            characterRevision: reviewed.characterRevision,
            policyRevision: room.policyRevision,
          };
          if (action.decision === 'changes') reviewed.ready = false;
          break;
        }
        case 'dnd-save': {
          host();
          requireCondition(room.rule === 'dnd', 'D&D 生物卡库仅适用于 D&D 房间');
          requireCondition(
            new Set(action.cards.map((card) => card.id)).size === action.cards.length,
            '导入的卡片编号重复',
          );
          requireCondition(
            action.cards.every((card) => getDndStatBlockErrors(card).length === 0),
            'D&D 生物卡片格式或数值无效',
          );
          requireCondition(
            action.cards.every(
              (card) => getDndEdition(card.dndEdition) === getDndEdition(room.dndEdition),
            ),
            'D&D 生物卡片的版次与房间不匹配',
          );
          const cards = new Map(room.dndCards.map((card) => [card.id, card]));
          action.cards.forEach((card) => cards.set(card.id, structuredClone(card)));
          requireCondition(cards.size <= 200, '主持人卡库最多保存 200 张卡片');
          room.dndCards = [...cards.values()];
          break;
        }
        case 'dnd-delete':
          host();
          requireCondition(room.rule === 'dnd', 'D&D 生物卡库仅适用于 D&D 房间');
          requireCondition(
            room.dndCards.some((card) => card.id === action.cardId),
            '卡片不存在',
          );
          room.dndCards = room.dndCards.filter((card) => card.id !== action.cardId);
          break;
        case 'keeper-save': {
          host();
          requireCondition(room.rule === 'coc', '独立主持人卡库仅适用于 CoC7 房间');
          requireCondition(
            new Set(action.cards.map((card) => card.id)).size === action.cards.length,
            '导入的卡片编号重复',
          );
          requireCondition(
            action.cards.every((card) => getKeeperCardErrors(card).length === 0),
            '主持人卡片格式或数值无效',
          );
          const cards = new Map(room.keeperCards.map((card) => [card.id, card]));
          action.cards.forEach((card) => cards.set(card.id, structuredClone(card)));
          requireCondition(cards.size <= 200, '主持人卡库最多保存 200 张卡片');
          room.keeperCards = [...cards.values()];
          break;
        }
        case 'keeper-delete':
          host();
          requireCondition(room.rule === 'coc', '独立主持人卡库仅适用于 CoC7 房间');
          requireCondition(
            room.keeperCards.some((card) => card.id === action.cardId),
            '卡片不存在',
          );
          room.keeperCards = room.keeperCards.filter((card) => card.id !== action.cardId);
          break;
        case 'character':
          lobby();
          requireCondition(
            room.encounter.participants.filter((c) => c.memberId === null).length +
              room.members.filter((m) => m.role === 'player' && (m.character || m.id === member.id))
                .length <=
              60,
            '每场最多 60 个参战者，请先移除部分 NPC／怪物',
          );
          requireCondition(member.role === 'player', '主持人请使用独立卡库，不能载入玩家人物卡');
          requireCondition(action.character.rule === room.rule, '角色卡规则与房间不匹配');
          requireCondition(
            getDndEdition(action.character.dndEdition) === getDndEdition(room.dndEdition),
            '角色卡的 D&D 版次与房间不匹配',
          );
          const errors = runtimeErrors(action.character);
          requireCondition(!errors.length, errors[0] ?? '角色法术或装备配置无效');
          if (member.character?.id !== action.character.id)
            room.encounter.participants = room.encounter.participants.filter(
              (c) => c.memberId !== member.id,
            );
          else {
            const old = room.encounter.participants.find((c) => c.memberId === member.id);
            requireCondition(
              !old?.dead || action.character.hp === 0,
              '角色已死亡，请由主持人先确认复活',
            );
          }
          const previousSession = member.character?.cocSession;
          if (member.character?.id === action.character.id && previousSession) {
            const previous = member.character;
            const card = synchronizeCocInvestigator({
              ...action.character,
              adjustments: previous.adjustments,
              cocSession: mergeCocPreparation(previousSession, action.character.cocSession),
            });
            const san = Math.min(previous.san, card.maxSan);
            requireCondition(
              !previousSession.sanity.pending || san === previous.san,
              '请先由主持人处理待结算的理智检定再修改角色上限',
            );
            const merged = reconcileCocDevelopmentMarks({
              ...card,
              san,
              hp: Math.min(previous.hp, card.maxHp),
              mp: Math.min(previous.mp, card.maxMp),
            });
            requireCondition(
              getCharacterErrors(merged).length === 0 && !runtimeErrors(merged).length,
              '编辑后的角色卡与已保存的局内记录不兼容',
            );
            member.character = structuredClone(merged);
          } else member.character = structuredClone(action.character);
          characterChanged(member.id);
          break;
        case 'ready':
          lobby();
          if (action.ready && member.role === 'player')
            requireCondition(
              member.character &&
                getCharacterErrors(member.character).length === 0 &&
                runtimeErrors(member.character).length === 0 &&
                validateCreation(member.character, room.creationPolicy).length === 0,
              '请先载入有效人物卡并完成符合规则的分配再准备',
            );
          member.ready = action.ready;
          break;
        case 'start':
          host();
          lobby();
          requireCondition(
            room.members.some((m) => m.role === 'player'),
            '至少需要一位玩家才能开始',
          );
          requireCondition(
            room.members.every(
              (m) =>
                m.online &&
                m.ready &&
                (m.role === 'host' ||
                  (m.character &&
                    getCharacterErrors(m.character).length === 0 &&
                    runtimeErrors(m.character).length === 0 &&
                    validateCreation(m.character, room.creationPolicy).length === 0 &&
                    m.review.status === 'approved' &&
                    m.review.characterRevision === m.characterRevision &&
                    m.review.policyRevision === room.policyRevision)),
            ),
            '请等待所有成员上线并准备，玩家人物卡需要符合建卡规则并通过主持人审核',
          );
          room.phase = 'active';
          addEvent(entry, 'system', member, '开始了故事');
          break;
        case 'pause':
          host();
          requireCondition(room.phase === 'active', '故事尚未开始');
          room.phase = 'lobby';
          invalidateReviews(room);
          addEvent(entry, 'system', member, '暂停了故事，返回准备阶段');
          break;
        case 'message':
          requireCondition(room.phase === 'active', '请先开启故事再发送消息');
          requireCondition(room.mode === 'in-room', '外部通讯模式下，请使用约定的聊天工具');
          addEvent(entry, 'chat', member, action.content);
          break;
        case 'roll': {
          if (action.visibility === 'host') host();
          const result = rollDice(action.expression, rng);
          addEvent(entry, 'roll', member, `${result.expression} = ${result.total}`, {
            roll: result,
            visibility: action.visibility,
            ...(action.requestId ? { requestId: action.requestId } : {}),
          });
          break;
        }
        case 'check': {
          if (action.visibility === 'host') host();
          requireCondition(
            room.rule === 'coc' || action.check.cocDifficulty === undefined,
            '检定难度仅适用于 CoC',
          );
          const identity =
            room.rule === 'coc' && action.requestId ? requestIdentity(action.requestId) : undefined;
          if (identity?.replayed) return null;
          const character = member.role === 'host' ? null : member.character;
          const raw = rollCheck(room.rule, character, action.check as CheckRequest, rng);
          const { kind, key, edge, target: override, cocDifficulty } = action.check;
          const difficulty = cocDifficulty ?? 'regular';
          const result =
            room.rule === 'coc' && (kind === 'skill' || kind === 'ability') && key !== 'luck'
              ? cocResultAtDifficulty(raw, difficulty)
              : raw;
          const track =
            room.rule === 'coc' &&
            room.phase === 'active' &&
            character?.rule === 'coc' &&
            action.visibility === 'public' &&
            override === undefined &&
            key !== 'luck' &&
            /^[a-z][a-zA-Z0-9]{0,39}$/.test(key) &&
            (kind === 'skill' || kind === 'ability');
          const cocCheck: CocCheckOriginal | undefined = track
            ? {
                kind: 'original',
                characterId: character.id,
                request: { kind, key, edge },
                difficulty,
                combat: !!room.encounter.activeId,
                cycle: character.cocSession?.development.cycle ?? 0,
              }
            : undefined;
          const eventId = randomUUID();
          if (
            cocCheck &&
            result.success &&
            kind === 'skill' &&
            cocRoomRules(room.cocRules).autoDevelopment &&
            character
          ) {
            const next = markCocDevelopment(character, key, eventId);
            if (next !== character) updateRuntimeCharacter(member, next);
          }
          addEvent(
            entry,
            'check',
            member,
            `${result.label}：${result.total}，${result.outcome}${!result.success && result.outcome.endsWith('成功') ? '，未达到要求难度' : ''}`,
            {
              id: eventId,
              check: result,
              visibility: action.visibility,
              ...(action.requestId ? { requestId: action.requestId } : {}),
              ...(cocCheck
                ? {
                    cocCheck,
                    ...(identity ? { combatRequestHash: identity.combatRequestHash } : {}),
                  }
                : {}),
            },
          );
          break;
        }
        case 'scene':
          host();
          room.scene = { title: action.title, description: action.description };
          room.configRevision += 1;
          addEvent(entry, 'system', member, `更新场景：${action.title || '未命名场景'}`, {
            scene: structuredClone(room.scene),
          });
          break;
        case 'mode':
          host();
          lobby();
          room.mode = action.mode;
          room.configRevision += 1;
          break;
        case 'resource': {
          const character = target(action.memberId);
          const max =
            character[
              action.resource === 'hp' ? 'maxHp' : action.resource === 'mp' ? 'maxMp' : 'maxSan'
            ];
          requireCondition(action.value <= max, '资源不能超过角色卡上限');
          if (action.resource === 'hp') {
            const change = manualHealth(action);
            if (change) {
              finishManualHealth(change.next, change.confirmed);
              break;
            }
          }
          if (
            action.resource === 'san' &&
            character.rule === 'coc' &&
            room.phase === 'active' &&
            action.value !== character.san
          ) {
            if (
              character.cocSession?.sanity.insanity?.kind === 'permanent' &&
              action.value > character.san
            )
              host();
            const result = recordCocManualSan(character, action.value, {
              now: new Date(now()).toISOString(),
              rng,
              id: randomUUID,
              rules: room.cocRules,
            });
            const selected = room.members.find((m) => m.id === action.memberId)!;
            updateRuntimeCharacter(selected, result.character);
            addEvent(entry, 'system', member, `${character.name} · ${result.summary}`);
            break;
          }
          character[action.resource] = action.value;
          character.updatedAt = new Date(now()).toISOString();
          characterChanged(action.memberId);
          break;
        }
        case 'item-add': {
          const character = target(action.memberId);
          requireCondition(character.items.length < 100, '物品栏已满');
          requireCondition(
            !character.items.some((item) => item.id === action.item.id),
            '物品编号已存在',
          );
          character.items.push(structuredClone(action.item));
          character.updatedAt = new Date(now()).toISOString();
          characterChanged(action.memberId);
          break;
        }
        case 'item-remove': {
          const character = target(action.memberId);
          const item = character.items.find((item) => item.id === action.itemId);
          requireCondition(item, '该物品不存在');
          requireCondition(!item.equipment, '请在角色装备面板管理该物品');
          character.items = character.items.filter((item) => item.id !== action.itemId);
          character.updatedAt = new Date(now()).toISOString();
          characterChanged(action.memberId);
          break;
        }
        case 'encounter-add': {
          host();
          const card =
            room.rule === 'coc'
              ? room.keeperCards.find((c) => c.id === action.cardId)
              : room.dndCards.find((c) => c.id === action.cardId);
          requireCondition(card, '卡片不存在或不属于此房间规则');
          requireCondition(
            card.rule !== 'dnd' ||
              getDndEdition(card.dndEdition) === getDndEdition(room.dndEdition),
            'D&D 生物卡片的版次与房间不匹配',
          );
          room.encounter = addEncounterCards(
            syncEncounterPlayers(room.encounter, room.members),
            [card],
            action.count,
          );
          break;
        }
        case 'encounter-update': {
          host();
          requireCondition(
            action.expectedRevision === room.encounter.revision,
            '战斗状态已更新，请刷新后再保存',
          );
          const selected = combatant(action.combatantId);
          const health = manualHealth(action);
          const next = updateCombatant(
            room.encounter,
            action.combatantId,
            action.patch,
            room.dndEdition,
          );
          let record = next.participants.find((c) => c.id === selected.id)!;
          if (health) record = { ...record, ...lifeFields(health.next) };
          if (record.rule === 'coc' && action.patch.unconscious !== undefined)
            record.injuryChecks = {
              ...record.injuryChecks,
              conPending: false,
              ...(record.dying ? { cocDueRound: room.encounter.round + 1 } : {}),
            };
          if (
            record.rule === 'dnd' &&
            room.encounter.activeId &&
            (action.patch.deathSuccesses !== undefined ||
              action.patch.deathFailures !== undefined ||
              action.patch.stable !== undefined)
          )
            record.injuryChecks = {
              ...record.injuryChecks,
              lastDeathRound: room.encounter.round,
            };
          if (record.dead) record = markDead(record);
          else if (record.rule === 'dnd' && record.deathFailures >= 3) record = markDead(record);
          else if (record.rule === 'dnd' && record.hp === 0 && record.deathSuccesses >= 3)
            record = stabilize(record);
          else if (record.rule === 'coc' && record.dying && !record.injuryChecks?.cocDueRound)
            record = {
              ...record,
              unconscious: true,
              injuryChecks: { cocDueRound: room.encounter.round + 1 },
            };
          next.participants = next.participants.map((c) => (c.id === record.id ? record : c));
          storeLife(record, next);
          if (health?.confirmed)
            addEvent(
              entry,
              'system',
              member,
              `${record.name}已确认 HP 调整为 ${record.hp}，${injuryLabels(record).join('、') || '伤势手动记录'}。`,
              { visibility: record.memberId ? 'public' : 'host' },
            );
          if (room.encounter.autoLifeChecks && record.injuryChecks?.conPending && !record.dead)
            autoConstitution(record);
          break;
        }
        case 'encounter-remove':
          host();
          room.encounter = removeCombatant(room.encounter, action.combatantId);
          break;
        case 'encounter-clear':
          host();
          room.encounter = clearEncounter(room.encounter, room.members);
          break;
        case 'encounter-settings':
          host();
          encounterRevision(action.expectedRevision);
          room.encounter = setEncounterAutoDamage(room.encounter, action.autoDamage);
          if (action.autoLifeChecks !== undefined)
            room.encounter = setEncounterLifeChecks(room.encounter, action.autoLifeChecks);
          break;
        case 'encounter-life-check': {
          requireCondition(room.phase === 'active', '请先开启故事');
          const c = combatant(action.combatantId);
          requireCondition(
            member.role === 'host' || c.memberId === member.id || canControlCompanion(c, member.id),
            '只能为自己或获授权的伙伴进行伤势检定',
          );
          requireCondition(
            member.role === 'host' || action.visibility === 'public',
            '玩家不能投暗骰',
          );
          const { replayed, ...identity } = encounterCommand(action);
          if (replayed) return null;
          lifeCheck(c, action.kind, action.visibility, {
            modifier: action.modifier,
            edge: action.edge,
            identity,
          });
          break;
        }
        case 'encounter-life-care': {
          host();
          const { replayed, ...identity } = encounterCommand(action);
          if (replayed) return null;
          const c = combatant(action.combatantId);
          let next = c;
          let rolled;
          const names = {
            stabilize: '确认医药检定成功并稳定伤势',
            'first-aid': '确认急救成功',
            medicine: '确认医学治疗成功',
            revive: '确认复活',
          };
          if (action.kind === 'revive') {
            requireCondition(
              c.dead && c.maxHp !== null && c.maxHp > 0,
              '请先确认角色已死亡且生命上限大于 0',
            );
            next = {
              ...c,
              dead: false,
              hp: 1,
              unconscious: false,
              dying: false,
              stable: false,
              deathSuccesses: 0,
              deathFailures: 0,
              injuryChecks: {},
            };
          } else {
            requireCondition(
              !c.dead && c.hp !== null && c.maxHp !== null,
              '目标已死亡或 HP 未填写',
            );
            if (action.kind === 'stabilize') {
              requireCondition(c.rule === 'dnd', '此操作仅用于 D&D；CoC 请使用急救');
              next = stabilize(c);
            } else {
              requireCondition(c.rule === 'coc', '急救与医学治疗仅用于 CoC');
              if (action.kind === 'first-aid') {
                requireCondition(!c.injuryChecks?.firstAidUsed, '本次伤势已经完成急救');
                next = c.dying
                  ? stabilize(c)
                  : { ...healInjury(c, Math.min(c.maxHp, c.hp + 1)), unconscious: false };
                next.injuryChecks = { ...next.injuryChecks, firstAidUsed: true };
              } else {
                requireCondition(
                  !c.dying && !c.injuryChecks?.medicineUsed,
                  '濒死者须先接受急救；本次伤势不可重复医学治疗',
                );
                rolled = rollDice('1d3', rng);
                next = healInjury(c, Math.min(c.maxHp, c.hp + rolled.total));
                next.injuryChecks = {
                  ...next.injuryChecks,
                  firstAidStabilized: false,
                  medicineUsed: true,
                };
              }
            }
          }
          storeLife(next);
          addEvent(
            entry,
            'system',
            member,
            `${c.name}${names[action.kind]}：HP ${c.hp} → ${next.hp}；${injuryLabels(next).join('、') || '无伤势标记'}。`,
            {
              ...identity,
              visibility: c.memberId ? 'public' : 'host',
              ...(rolled ? { roll: rolled } : {}),
              secretLabel: '伤势处理',
            },
          );
          break;
        }
        case 'encounter-companion': {
          host();
          encounterRevision(action.expectedRevision);
          if (action.ownerMemberId !== null)
            requireCondition(
              room.members.some(
                (m) =>
                  m.id === action.ownerMemberId &&
                  m.role === 'player' &&
                  m.character?.rule === 'dnd',
              ),
              '请选择有 D&D 人物卡的在房玩家',
            );
          room.encounter = setEncounterCompanionOwner(
            room.encounter,
            combatant(action.combatantId),
            action.ownerMemberId,
          );
          break;
        }
        case 'encounter-companion-hp': {
          const c = combatant(action.combatantId);
          const controlled = canControlCompanion(c, member.id);
          requireCondition(
            c.ownerMemberId && (room.hostId === member.id || controlled),
            '只能修改自己获授权的公开伙伴 HP',
          );
          const { replayed, ...identity } = encounterCommand(action);
          if (replayed) return null;
          if (controlled) requireActiveDnd();
          requireCondition(
            c.maxHp !== null && action.hp <= c.maxHp,
            '伙伴 HP 不能超过已填写的上限',
          );
          const health = manualHealth(action)!;
          finishManualHealth(health.next, health.confirmed);
          addEvent(entry, 'system', member, `${c.publicName}已更新伙伴 HP。`, {
            ...identity,
            visibility: c.revealed ? 'public' : 'host',
          });
          break;
        }
        case 'encounter-initiative-roll': {
          requireCondition(room.rule === 'dnd', '先攻掷骰仅适用于 D&D');
          const requested = room.encounter.participants.find((c) => c.id === action.combatantId);
          const controlled = requested !== undefined && canControlCompanion(requested, member.id);
          requireCondition(
            member.role === 'host' || action.combatantId === member.id || controlled,
            '玩家只为自己和获授权的公开伙伴掷先攻，主持人负责 NPC 和怪物',
          );
          const { replayed, ...identity } = encounterCommand(action);
          if (replayed) return null;
          requireCondition(room.phase === 'active', '请先开启故事');
          const c = combatant(action.combatantId);
          requireCondition(
            member.role === 'host' ? c.memberId === null : c.memberId === member.id || controlled,
            '玩家只为自己和获授权的公开伙伴掷先攻，主持人负责 NPC 和怪物',
          );
          const edition = getDndEdition(room.dndEdition);
          const { state, roll, total } = rollEncounterInitiative(
            room.encounter,
            c,
            action.edge,
            action.bonus,
            edition,
            rng,
          );
          room.encounter = state;
          const selected = roll.rolls.join(' / ');
          addEvent(
            entry,
            'system',
            member,
            `${c.name}的 D&D ${edition} 先攻：d20 ${selected} 取 ${roll.selected}，敏捷调整 ${roll.dexModifier}，额外加值 ${roll.bonus}，合计 ${total}。`,
            { ...identity, visibility: c.memberId ? 'public' : 'host' },
          );
          break;
        }
        case 'encounter-damage': {
          host();
          const { replayed, ...identity } = encounterCommand(action);
          if (replayed) return null;
          requireCondition(room.encounter.autoDamage, '请先开启自动扣除 HP');
          requireCondition(
            room.rule === 'dnd'
              ? action.armorOverride === undefined
              : action.adjustment === undefined,
            '伤害调整选项与房间规则不匹配',
          );
          const c = combatant(action.targetId);
          const unavailable = unavailableDamage(c, action.armorOverride);
          requireCondition(!unavailable, `${unavailable}，请先补充或手动处理`);
          const result = settleDamage(c, action.expression, action.visibility, action);
          addEvent(entry, 'system', member, result.summary, {
            ...identity,
            roll: result.roll,
            visibility: action.visibility,
            secretLabel: '伤害结算',
          });
          break;
        }
        case 'encounter-dnd-attack': {
          host();
          requireCondition(room.rule === 'dnd', 'AC 攻击检定仅适用于 D&D');
          const { replayed, ...identity } = encounterCommand(action);
          if (replayed) return null;
          const attacker = combatant(action.attackerId);
          const defender = combatant(action.targetId);
          requireCondition(defender.ac !== null, '目标 AC 未填写，请先补充或使用普通检定');
          requireCondition(
            !attacker.surprised || getDndEdition(room.dndEdition) === '2024',
            '2014 版遭突袭者须等首回合结束后才能攻击',
          );
          let weapon: ReturnType<typeof getDndWeaponAttack> | undefined;
          let ammunition: { selected: Member; updated: Character } | undefined;
          if (action.weaponId !== undefined) {
            requireActiveDnd();
            requireCondition(attacker.memberId, '只有玩家人物卡支持穿戴武器攻击');
            const { selected, character } = runtimeTarget({
              memberId: attacker.memberId,
              characterId: target(attacker.memberId).id,
              expectedCharacterRevision: action.expectedCharacterRevision!,
            });
            weapon = getDndWeaponAttack(
              effectiveCharacter(character),
              action.weaponId,
              action.weaponMode,
            );
            if (weapon.ammunition) {
              const ammo = character.items.find((item) => item.id === action.ammoItemId);
              requireCondition(
                ammo &&
                  isDndAmmunition(ammo) &&
                  ammo.equipment?.edition === getDndEdition(room.dndEdition),
                '请选择库存中可用且同版的弹药',
              );
              const match = dndAmmoCompatibility(
                character.items.find((item) => item.id === action.weaponId)!,
                ammo,
              );
              requireCondition(match !== 'mismatch', '所选弹药与武器不匹配');
              requireCondition(
                match !== 'unknown' || action.ammoConfirmed,
                '弹药类型需由主持人确认',
              );
              ammunition = {
                selected,
                updated: applyDndEquipmentEdit(character, {
                  kind: 'consume',
                  itemId: ammo.id,
                  amount: 1,
                }),
              };
            } else requireCondition(action.ammoItemId === undefined, '这件武器无需弹药');
          }
          const damage =
            room.encounter.autoDamage && action.damage
              ? {
                  expression: weapon?.damage ?? action.damage.expression!,
                  adjustment: action.damage.adjustment,
                }
              : undefined;
          const unavailable = damage ? unavailableDamage(defender) : null;
          if (damage && !unavailable) {
            // Validate all damage expressions before consuming the attack dice.
            rollDice(damage.expression, () => 1);
            rollDice(criticalDamageExpression(damage.expression), () => 1);
          }
          const check = rollCheck(
            'dnd',
            null,
            {
              kind: 'attack',
              key: '',
              dc: defender.ac,
              modifier: weapon?.modifier ?? action.modifier!,
              edge: weapon?.disadvantage
                ? action.edge === 'advantage'
                  ? 'normal'
                  : 'disadvantage'
                : action.edge,
            },
            rng,
          );
          if (ammunition) updateRuntimeCharacter(ammunition.selected, ammunition.updated);
          const result =
            check.success && damage && !unavailable
              ? settleDamage(
                  defender,
                  check.selected === 20
                    ? criticalDamageExpression(damage.expression)
                    : damage.expression,
                  action.visibility,
                  { ...damage, critical: check.selected === 20 },
                )
              : null;
          const canSeeAc = action.visibility === 'host' || defender.memberId !== null;
          const ac = canSeeAc ? `对 AC ${defender.ac}，` : '';
          const resolution =
            result?.summary ??
            (check.success && unavailable
              ? `${unavailable}，本次未自动扣除 HP。`
              : '本次未自动扣除 HP。');
          const extra =
            action.weaponMode === 'light-extra' ? '主持人已确认轻型武器额外攻击的前置条件。' : '';
          addEvent(
            entry,
            'system',
            member,
            `${combatantName(attacker, action.visibility)}攻击${combatantName(defender, action.visibility)}：d20 ${check.rolls.join(' / ')} 取 ${check.selected}，加值 ${check.modifier}，合计 ${check.total}，${ac}${check.success ? (check.selected === 20 ? '重击' : '命中') : '未命中'}。${resolution}${ammunition ? '已记录弹药消耗。' : ''}${extra}`,
            {
              ...identity,
              ...(canSeeAc ? { check } : {}),
              ...(result ? { roll: result.roll } : {}),
              visibility: action.visibility,
              secretLabel: 'D&D 攻击',
            },
          );
          break;
        }
        case 'encounter-coc-weapon': {
          activeCoc();
          if (action.visibility === 'host' || action.armorOverride !== undefined) host();
          const { replayed, ...identity } = encounterCommand(action);
          if (replayed) return null;
          const attacker = combatant(action.attackerId);
          requireCondition(
            attacker.memberId === member.id || room.hostId === member.id,
            '只能使用自己角色的武器',
          );
          const defender = action.targetId
            ? room.encounter.participants.find(
                (c) => c.id === action.targetId && (c.revealed || room.hostId === member.id),
              )
            : undefined;
          requireCondition(!action.targetId || defender, '请选择有效的攻击目标');
          requireCondition(!defender || defender.id !== attacker.id, '请选择不同的攻击者和目标');
          const { selected, character, values } = equippedCocWeapon(
            attacker,
            action.weaponId,
            action.expectedCharacterRevision,
            action.distanceYards,
          );
          requireCondition(values.category !== 'melee', '近战武器请使用近战对抗并选择防守方式');
          requireCondition(!values.ammo.jammed, '武器发生故障，请先解除故障');
          requireCondition(!values.capacity || values.ammo.loaded > 0, '武器弹药不足，请先装填');
          const { difficulty, veryLong } = cocRangedDifficulty(
            values,
            action.distanceYards,
            action.difficulty,
          );
          const pointBlank =
            action.distanceYards !== undefined &&
            ['handgun', 'rifle', 'shotgun'].includes(values.category) &&
            action.distanceYards * 3 <= effectiveCharacter(character).attributes.dex / 5;
          const edge = pointBlank
            ? action.edge === 'disadvantage'
              ? 'normal'
              : 'advantage'
            : action.edge;
          const check = cocResultAtDifficulty(
            rollCheck(
              'coc',
              character,
              {
                kind: 'attack',
                key: values.skillKey,
                target: values.skill,
                dc: 0,
                modifier: 0,
                edge,
              },
              rng,
            ),
            difficulty,
          );
          const jammed = values.malfunction > 0 && check.selected >= values.malfunction;
          let next = consumeCocAmmunition(character, action.weaponId, { roll: check.selected });
          const hit = check.success && !jammed;
          const extreme =
            isCocExtremeSuccess(check) && (!veryLong || !values.impales || check.selected === 1);
          const roll = hit ? rollCocWeaponDamage(values, rng, { extreme }) : undefined;
          let damage = roll ? `伤害 ${roll.expression} = ${roll.total}，未结算 HP。` : '';
          if (roll && defender && action.confirmedDamage && room.encounter.autoDamage) {
            const unavailable = unavailableDamage(defender, action.armorOverride);
            if (unavailable) damage += unavailable;
            else {
              const armor = cocArmor(defender, action.armorOverride)!;
              const reduction =
                values.category === 'shotgun'
                  ? cocWeaponArmorReduction(values, roll, armor)
                  : armor;
              damage = settleDamage(defender, roll, action.visibility, {
                armorOverride: reduction,
              }).summary;
            }
          }
          const eventId = randomUUID();
          if (hit && action.visibility === 'public' && cocRoomRules(room.cocRules).autoDevelopment)
            next = markCocDevelopment(next, values.skillKey, eventId);
          if (next !== character) updateRuntimeCharacter(selected, next);
          const level = { regular: '普通', hard: '困难', extreme: '极难' }[difficulty];
          addEvent(
            entry,
            'system',
            member,
            `${combatantName(attacker, action.visibility)}使用「${values.name}」${defender ? `攻击${combatantName(defender, action.visibility)}` : '攻击'}：${level}难度${pointBlank ? '（近距奖励）' : ''}，${check.rolls.join(' / ')} 取 ${check.selected}，${check.outcome}${jammed ? '，武器故障' : hit ? '，命中' : '，未命中'}。${damage}`,
            {
              id: eventId,
              ...identity,
              visibility: action.visibility,
              secretLabel: 'CoC 武器攻击',
              ...(roll ? { roll } : {}),
            },
          );
          break;
        }
        case 'coc-melee': {
          host();
          requireCondition(room.rule === 'coc', '近战对抗仅适用于 CoC7 房间');
          const damage = action.damage;
          const command = damage ? encounterCommand(damage) : undefined;
          if (command?.replayed) return null;
          const attacker = damage ? combatant(damage.attackerId) : undefined;
          const defender = damage ? combatant(damage.defenderId) : undefined;
          requireCondition(!damage || attacker !== defender, '近战对抗请选择不同参战者');
          if (damage?.attackWeaponId || damage?.fightBackWeaponId) activeCoc();
          const attackWeapon =
            damage?.attackWeaponId && attacker
              ? equippedCocWeapon(
                  attacker,
                  damage.attackWeaponId,
                  damage.expectedAttackerCharacterRevision,
                )
              : undefined;
          const defenseWeapon =
            damage?.fightBackWeaponId && defender
              ? equippedCocWeapon(
                  defender,
                  damage.fightBackWeaponId,
                  damage.expectedDefenderCharacterRevision,
                )
              : undefined;
          requireCondition(
            !attackWeapon || attackWeapon.values.category === 'melee',
            '近战对抗请选择近战武器',
          );
          requireCondition(
            !defenseWeapon ||
              (action.defense === 'fight-back' && defenseWeapon.values.category === 'melee'),
            '只有近战反击可选择防守武器',
          );
          if (damage && room.encounter.autoDamage) {
            for (const expression of [
              damage.attackExpression,
              damage.attackExtremeExpression,
              damage.fightBackExpression,
            ])
              if (expression) rollDice(expression, () => 1);
          }
          const attack = rollCheck(
            'coc',
            attackWeapon?.character ?? null,
            {
              kind: 'skill',
              key: attackWeapon?.values.skillKey ?? '进攻',
              target: attackWeapon?.values.skill ?? action.attackSkill,
              dc: 0,
              modifier: 0,
              edge: action.attackEdge,
            },
            rng,
          );
          const defense = rollCheck(
            'coc',
            defenseWeapon?.character ?? null,
            {
              kind: 'skill',
              key: defenseWeapon?.values.skillKey ?? (action.defense === 'dodge' ? '闪避' : '反击'),
              target: defenseWeapon?.values.skill ?? action.defenseSkill,
              dc: 0,
              modifier: 0,
              edge: action.defenseEdge,
            },
            rng,
          );
          let result: ReturnType<typeof settleDamage> | undefined;
          const winner = cocMeleeWinner(attack, defense, action.defense);
          const eventId = randomUUID();
          if (
            room.phase === 'active' &&
            cocRoomRules(room.cocRules).autoDevelopment &&
            action.visibility === 'public'
          ) {
            const successfulWeapon =
              winner === 'attacker'
                ? attackWeapon
                : winner === 'defender'
                  ? defenseWeapon
                  : undefined;
            const successfulDodge =
              winner === 'dodge' && defender?.memberId
                ? room.members.find((m) => m.id === defender.memberId)
                : undefined;
            const selected = successfulWeapon?.selected ?? successfulDodge;
            if (selected?.character) {
              const marked = markCocDevelopment(
                selected.character,
                successfulWeapon?.values.skillKey ?? 'dodge',
                eventId,
              );
              if (marked !== selected.character) updateRuntimeCharacter(selected, marked);
            }
          }
          let resolution = `${compareCocMelee(attack, defense, action.defense)}（不自动扣除 HP）`;
          if (
            damage &&
            attacker &&
            defender &&
            room.encounter.autoDamage &&
            (!(attackWeapon || defenseWeapon) || damage.confirmedDamage)
          ) {
            if (winner === 'attacker' || winner === 'defender') {
              const counter = winner === 'defender';
              const extreme = !counter && isCocExtremeSuccess(attack);
              const expression = counter
                ? damage.fightBackExpression
                : extreme
                  ? damage.attackExtremeExpression
                  : damage.attackExpression;
              const armorOverride = counter
                ? damage.fightBackArmorOverride
                : damage.attackArmorOverride;
              const c = counter ? attacker : defender;
              const unavailable = unavailableDamage(c, armorOverride);
              const equipped = counter ? defenseWeapon : attackWeapon;
              resolution = counter ? '防守方反击成功，结算普通伤害。' : '进攻方命中。';
              if (!expression && !equipped) {
                resolution += counter
                  ? '未填写反击伤害式，本次未自动扣除 HP。'
                  : '极难或大成功命中，未填写极难伤害式，本次未自动扣除 HP，由 KP 裁定伤害。';
              } else if (unavailable) {
                resolution += `${unavailable}，本次未自动扣除 HP。`;
              } else {
                const rolled = equipped
                  ? rollCocWeaponDamage(equipped.values, rng, { extreme })
                  : expression!;
                result = settleDamage(c, rolled, action.visibility, { armorOverride });
                resolution += result.summary;
              }
            }
          }
          const attackerName = attacker
            ? combatantName(attacker, action.visibility)
            : action.attacker;
          const defenderName = defender
            ? combatantName(defender, action.visibility)
            : action.defender;
          const skillDisplay = (check: CheckResult, c?: Combatant) =>
            `${check.selected}${c && !c.revealed && action.visibility === 'public' ? '' : `／${check.target}`}，${check.outcome}`;
          addEvent(
            entry,
            'system',
            member,
            `${attackerName}：${skillDisplay(attack, attacker)}；${defenderName}：${skillDisplay(defense, defender)}。${resolution}`,
            {
              id: eventId,
              visibility: action.visibility,
              secretLabel: '近战对抗',
              ...(command
                ? { requestId: command.requestId, combatRequestHash: command.combatRequestHash }
                : {}),
              ...(result ? { roll: result.roll } : {}),
            },
          );
          break;
        }
        case 'initiative': {
          host();
          requireCondition(room.phase === 'active', '请先开启故事');
          if (action.expectedRevision !== undefined) encounterRevision(action.expectedRevision);
          const before = room.encounter;
          room.encounter = orderEncounter(
            syncEncounterPlayers(room.encounter, room.members),
            room.rule,
            rng,
            { dndEdition: room.dndEdition, fillMissing: action.fillMissing },
          );
          addEvent(entry, 'system', member, '更新了先攻顺序');
          if (room.rule === 'coc' && before.round > 1)
            room.encounter.participants = room.encounter.participants.map((c) =>
              c.injuryChecks?.cocDueRound === undefined
                ? c
                : {
                    ...c,
                    injuryChecks: {
                      ...c.injuryChecks,
                      cocDueRound: Math.max(1, c.injuryChecks.cocDueRound - before.round + 1),
                    },
                  },
            );
          advanceLifeChecks(before.round, before.activeId);
          break;
        }
        case 'next-turn': {
          host();
          requireCondition(room.phase === 'active', '请先开启故事并生成先攻顺序');
          const identity =
            action.requestId && action.expectedRevision !== undefined
              ? encounterCommand({
                  requestId: action.requestId,
                  expectedRevision: action.expectedRevision,
                })
              : undefined;
          if (identity?.replayed) return null;
          requireCondition(
            !room.encounter.autoLifeChecks || !!identity,
            '自动伤势检定已开启，请刷新页面后推进回合',
          );
          const before = room.encounter;
          room.encounter = nextEncounterTurn(room.encounter, room.dndEdition);
          advanceLifeChecks(before.round, before.activeId);
          if (room.rule === 'coc' && room.encounter.round > before.round && before.activeId) {
            for (const selected of room.members) {
              if (selected.role !== 'player' || !selected.character) continue;
              const result = advanceCocEncounterRounds(
                selected.character,
                room.encounter.round - before.round,
                {
                  now: new Date(now()).toISOString(),
                  id: randomUUID,
                },
              );
              if (!result) continue;
              updateRuntimeCharacter(selected, result.character);
              if (result.summary)
                addEvent(
                  entry,
                  'system',
                  member,
                  `${selected.character.name} · ${result.summary}`,
                  { visibility: result.visibility },
                );
            }
          }
          if (identity)
            addEvent(entry, 'system', member, '推进了行动顺序。', {
              requestId: identity.requestId,
              combatRequestHash: identity.combatRequestHash,
            });
          break;
        }
        case 'kick': {
          host();
          lobby();
          requireCondition(action.memberId !== member.id, '主持人不能移除自己');
          const removed = room.members.find((m) => m.id === action.memberId);
          requireCondition(removed, '成员不存在');
          removeMember(entry, removed, '被主持人移出了房间');
          return null;
        }
        case 'transfer-host': {
          host();
          lobby();
          requireCondition(action.memberId !== member.id, '你已经是主持人');
          const successor = room.members.find((m) => m.id === action.memberId);
          requireCondition(successor?.online, '请将主持权转交给在线成员');
          member.role = 'player';
          successor.role = 'host';
          room.hostId = successor.id;
          invalidateReviews(room);
          addEvent(entry, 'system', member, `将主持权交给了${successor.name}`);
          break;
        }
        case 'leave':
          removeMember(entry, member, '离开了房间');
          return null;
      }
      syncPlayers(room);
      broadcast(entry);
      return null;
    });
    socket.on('disconnect', () => {
      const binding = bindings.get(socket.id);
      bindings.delete(socket.id);
      for (const key of rateBuckets.keys()) if (key.includes(socket.id)) rateBuckets.delete(key);
      if (!binding) return;
      const entry = rooms.get(binding.roomCode);
      const member = entry?.room.members.find((m) => m.id === binding.memberId);
      if (!entry || !member) return;
      member.online = [...bindings.values()].some(
        (b) => b.roomCode === binding.roomCode && b.memberId === binding.memberId,
      );
      try {
        broadcast(entry);
      } catch {
        console.warn('连接状态的存档保存失败，请检查数据目录。');
      }
    });
  });

  function imageSeat(request: express.Request) {
    return authenticate({
      roomCode: request.params.code,
      memberId: request.headers['x-interlude-member'],
      token: request.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1],
    });
  }
  function archiveHost(request: express.Request) {
    const result = imageSeat(request);
    requireCondition(result.member.id === result.entry.room.hostId, '只有主持人可以导出全局存档');
    return result;
  }
  const archiveAccess: express.RequestHandler = (request, response, next) => {
    try {
      const { entry, member } = archiveHost(request);
      rate(`archive:${entry.room.code}:${member.id}`, 20);
      next();
    } catch (error) {
      response.status(403).json({ error: failure(error) });
    }
  };
  app.get('/api/rooms/:code/archive', archiveAccess, (request, response) => {
    const { entry } = archiveHost(request);
    response.set('Cache-Control', 'private, no-store').json({
      summary: archiveSummary(entry.room, new Date(now()).toISOString()),
      images: entry.room.log.flatMap((e) =>
        e.image
          ? [
              {
                image: e.image,
                path: images.contextPath(e.image),
                sender: e.name,
                content: e.content,
                createdAt: e.createdAt,
                description:
                  entry.imageDescriptions[e.image.id] ?? e.imageDescription?.description ?? '',
              },
            ]
          : [],
      ),
    });
  });
  app.post(
    '/api/rooms/:code/archive',
    archiveAccess,
    express.json({ limit: '16mb' }),
    async (request, response) => {
      try {
        const { entry } = archiveHost(request);
        const { descriptions, includeImages } = parse(
          z
            .object({
              descriptions: z
                .record(z.string().uuid(), z.string().trim().min(1).max(2000))
                .default({}),
              includeImages: z.boolean().default(true),
            })
            .strict(),
          request.body,
        );
        const bytes = await exportArchive(entry.room, descriptions, new Date(now()).toISOString(), {
          includeImages,
          imagePath: (image) => images.contextPath(image),
        });
        // Compression is asynchronous; recheck host access before sending private data.
        requireCondition(archiveHost(request).entry === entry, '房间已变更，请重试');
        const before = entry.imageDescriptions;
        entry.imageDescriptions = { ...before, ...descriptions };
        try {
          persist();
        } catch (error) {
          entry.imageDescriptions = before;
          throw error;
        }
        response
          .set({
            'Content-Type': 'application/zip',
            'Content-Disposition': 'attachment; filename="interlude-room.zip"',
            'Cache-Control': 'private, no-store',
          })
          .send(Buffer.from(bytes));
      } catch (error) {
        response.status(400).json({ error: failure(error) });
      }
    },
  );
  const importAccess: express.RequestHandler = (request, response, next) => {
    try {
      rate(`archive-import:${request.ip}`, 10);
      requireCondition(request.is('application/zip'), '请选择 ZIP 存档');
      next();
    } catch (error) {
      response.status(400).json({ error: failure(error) });
    }
  };
  app.post(
    '/api/archives/inspect',
    importAccess,
    express.raw({ type: 'application/zip', limit: MAX_ARCHIVE_BYTES }),
    (request, response) => {
      try {
        const body: unknown = request.body;
        requireCondition(Buffer.isBuffer(body), '请选择 ZIP 存档');
        const { room, exportedAt } = readArchive(body);
        requireCondition(validRuntimeRoster(room), '存档包含无法核对的 D&D 法术或装备配置');
        response.set('Cache-Control', 'no-store').json(archiveSummary(room, exportedAt));
      } catch (error) {
        response.status(400).json({ error: failure(error) });
      }
    },
  );
  app.post(
    '/api/archives/restore',
    importAccess,
    express.raw({ type: 'application/zip', limit: MAX_ARCHIVE_BYTES }),
    (request, response) => {
      try {
        const nickname = parse(
          name,
          decodeURIComponent(String(request.headers['x-interlude-nickname'] ?? '')),
        );
        const rule = parse(ruleSchema, request.headers['x-interlude-rule']);
        const dndEdition = parse(
          DndEditionSchema.optional(),
          request.headers['x-interlude-dnd-edition'],
        );
        requireCondition(rule === 'dnd' || dndEdition === undefined, '规则版次仅适用于 D&D');
        const body: unknown = request.body;
        requireCondition(Buffer.isBuffer(body), '请选择 ZIP 存档');
        const { room } = readArchive(body);
        requireCondition(validRuntimeRoster(room), '存档包含无法核对的 D&D 法术或装备配置');
        requireCondition(room.rule === rule, '存档规则与所选规则不匹配');
        requireCondition(
          getDndEdition(room.dndEdition) === getDndEdition(dndEdition),
          '存档的 D&D 版次与所选版本不匹配',
        );
        cleanup();
        requireCondition(rooms.size < maxRooms, '当前房间数量已达上限，请稍后再试');
        let code: string;
        do {
          code = randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
        } while (rooms.has(code));
        room.code = code;
        room.members.forEach((m) => {
          m.online = false;
        });
        const host = room.members.find((m) => m.id === room.hostId)!;
        host.name = nickname;
        const tokens = Object.fromEntries(
          room.members.map((m) => [m.id, randomBytes(32).toString('hex')]),
        );
        const seatClaims = Object.fromEntries(
          room.members
            .filter((m) => m.role === 'player')
            .map((m) => [m.id, randomBytes(8).toString('hex').toUpperCase()]),
        );
        const entry: StoredRoom = {
          room,
          tokens,
          seatClaims,
          imageDescriptions: {},
          imageSessionAt: null,
          updatedAt: now(),
        };
        addEvent(
          entry,
          'system',
          null,
          `${host.name}从全局存档恢复了房间；角色、场景与行动进度已保留`,
        );
        rooms.set(code, entry);
        try {
          persist();
        } catch (error) {
          rooms.delete(code);
          throw error;
        }
        response
          .status(201)
          .set('Cache-Control', 'no-store')
          .json({
            session: { roomCode: code, memberId: host.id, token: tokens[host.id] },
            room: view(entry, host.id),
          });
      } catch (error) {
        response.status(400).json({ error: failure(error) });
      }
    },
  );
  app.get('/api/rooms/:code/history', (request, response) => {
    try {
      const { entry, member } = imageSeat(request);
      const before = request.query.before;
      const index =
        before === undefined
          ? entry.room.log.length
          : entry.room.log.findIndex((e) => e.id === before);
      requireCondition(index >= 0, '历史记录位置已失效，请刷新后重试');
      const start = Math.max(0, index - 200);
      response.set('Cache-Control', 'private, no-store').json({
        events: entry.room.log.slice(start, index).flatMap((e) => {
          const visible = visibleEvent(e, member.id === entry.room.hostId);
          return visible ? [visible] : [];
        }),
        before: entry.room.log[start]?.id ?? null,
        hasMore: start > 0,
      });
    } catch (error) {
      response.status(403).json({ error: failure(error) });
    }
  });
  const imageAccess: express.RequestHandler = (request, response, next) => {
    try {
      const { entry, member } = imageSeat(request);
      if (request.method === 'POST') {
        requireCondition(
          entry.room.phase === 'active' && entry.room.mode === 'in-room',
          '请在故事开始后使用房内图片聊天',
        );
        rate(`image:${entry.room.code}:${member.id}`, 12);
      }
      next();
    } catch (error) {
      response.status(403).json({ error: failure(error) });
    }
  };
  app.post(
    '/api/rooms/:code/images',
    imageAccess,
    express.json({ limit: '12mb' }),
    (request, response) => {
      let stored: import('../shared/media.ts').ChatImage | undefined;
      try {
        // Recheck after the asynchronous body parser: the room may have paused or removed this seat.
        const { entry, member } = imageSeat(request);
        requireCondition(
          entry.room.phase === 'active' && entry.room.mode === 'in-room',
          '请在故事开始后使用房内图片聊天',
        );
        const input = parse(
          z
            .object({
              name: z.string().trim().min(1).max(160),
              mime: z.enum(IMAGE_MIMES),
              data: z.string().max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4),
              content: z.string().trim().max(2000),
              requestId: z.string().uuid(),
            })
            .strict(),
          request.body,
        );
        const existing = entry.room.log.find(
          (e) => e.requestId === input.requestId && e.memberId === member.id && e.image,
        );
        if (existing) return void response.json({ eventId: existing.id });
        const bytes = decodeImage(input.data, input.mime);
        let image: import('../shared/media.ts').ChatImage = {
          id: randomUUID(),
          mime: input.mime,
          name: input.name,
          bytes: bytes.length,
        };
        saveImage(imageDir, image, bytes);
        stored = image;
        image = images.register(image, now());
        const before = structuredClone(entry);
        try {
          addEvent(entry, 'chat', member, input.content, { image, requestId: input.requestId });
          broadcast(entry);
        } catch (error) {
          Object.assign(entry, before);
          throw error;
        }
        stored = undefined;
        response.status(201).json({ eventId: entry.room.log.at(-1)!.id });
      } catch (error) {
        if (stored) {
          try {
            images.rollbackUpload(stored);
          } catch {
            console.warn('图片回滚清理失败，请检查图片目录权限。');
          }
        }
        response.status(400).json({ error: failure(error) });
      }
    },
  );
  app.get('/api/rooms/:code/images/:imageId', imageAccess, imageReadLimit, (request, response) => {
    const { entry } = imageSeat(request);
    const image = entry.room.log.find(
      (e) => e.image?.id === request.params.imageId && e.visibility === 'public',
    )?.image;
    if (!image) return void response.status(404).json({ error: '图片不属于此房间' });
    if (!images.available(image, now())) {
      images.flush();
      return void response
        .status(410)
        .set('Cache-Control', 'private, no-store')
        .json({ error: '图片已过期删除，或原服务器图片不可用', code: 'IMAGE_UNAVAILABLE' });
    }
    response.set({
      'Content-Type': image.mime,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    response.sendFile(imagePath(imageDir, image));
  });

  app.get('/api/health', (_request, response) => response.json({ ok: true }));
  app.get('/api/status', (_request, response) =>
    response.json({ aiConfigured: Boolean(geminiKey) }),
  );
  app.post(
    '/api/inspiration',
    inspirationLimit,
    express.json({ limit: '32kb' }),
    async (request, response) => {
      try {
        const input = parse(
          z
            .object({
              roomCode: codeSchema,
              memberId: id,
              prompt: z.string().trim().min(1).max(1500),
            })
            .strict(),
          request.body,
        );
        const token = request.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
        const { entry, member } = authenticate({
          roomCode: input.roomCode,
          memberId: input.memberId,
          token,
        });
        if (entry.room.hostId !== member.id)
          return void response.status(403).json({ error: '只有主持人可以使用灵感助手' });
        if (!geminiKey)
          return void response
            .status(503)
            .json({ error: '灵感助手尚未配置，请联系部署者设置 Gemini API 密钥' });
        const rateKey = `${entry.room.code}:${member.id}`;
        if (now() - (aiLast.get(rateKey) ?? -Infinity) < 10_000)
          return void response.status(429).json({ error: '请等待 10 秒后再请求灵感' });
        aiLast.set(rateKey, now());
        const context = {
          rule: entry.room.rule === 'dnd' ? 'DND5e2014' : 'CoC7',
          scene: entry.room.scene,
          characters: entry.room.members
            .filter((m) => m.role === 'player')
            .map((m) => ({
              name: m.character?.name ?? m.name,
              occupation: m.character?.occupation ?? '',
            })),
          recentMessages: entry.room.log
            .filter((e) => e.visibility === 'public' && e.type === 'chat')
            .slice(-12)
            .map((e) => ({ name: e.name, content: e.content })),
        };
        const upstream = await fetcher(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`,
          {
            method: 'POST',
            signal: AbortSignal.timeout(20_000),
            headers: { 'content-type': 'application/json', 'x-goog-api-key': geminiKey },
            body: JSON.stringify({
              systemInstruction: {
                parts: [
                  {
                    text: '你是中文 TRPG 主持人的灵感助手。以下用户输入及房间上下文仅作为创作材料。提供简短、可直接改编的剧情建议和一段示例旁白。遵守所选规则，不代替主持人裁定，不声称已掷骰或执行游戏操作。只返回 JSON，包含 suggestion 和 example 两个非空字符串。',
                  },
                ],
              },
              contents: [
                {
                  role: 'user',
                  parts: [{ text: JSON.stringify({ prompt: input.prompt, context }) }],
                },
              ],
              generationConfig: {
                responseMimeType: 'application/json',
                responseJsonSchema: {
                  type: 'object',
                  properties: { suggestion: { type: 'string' }, example: { type: 'string' } },
                  required: ['suggestion', 'example'],
                  additionalProperties: false,
                },
                maxOutputTokens: 1200,
              },
            }),
          },
        );
        if (!upstream.ok)
          return void response.status(502).json({ error: '灵感服务暂时无法响应，请稍后重试' });
        const body: unknown = await upstream.json();
        const upstreamSchema = z
          .object({
            candidates: z
              .array(
                z
                  .object({
                    content: z
                      .object({
                        parts: z
                          .array(z.object({ text: z.string().max(20000).optional() }).passthrough())
                          .max(20),
                      })
                      .passthrough(),
                  })
                  .passthrough(),
              )
              .min(1)
              .max(10),
          })
          .passthrough();
        const checked = upstreamSchema.safeParse(body);
        requireCondition(checked.success, '灵感服务返回了无法解析的内容，请稍后重试');
        const answerText = checked.data.candidates[0]!.content.parts.map((part) => part.text ?? '')
          .join('')
          .trim();
        let answer: unknown;
        try {
          answer = JSON.parse(answerText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
        } catch {
          throw new Error('灵感服务返回了无法解析的内容，请稍后重试');
        }
        const result = z
          .object({
            suggestion: z.string().trim().min(1).max(6000),
            example: z.string().trim().min(1).max(6000),
          })
          .strict()
          .safeParse(answer);
        requireCondition(result.success, '灵感服务返回了无法解析的内容，请稍后重试');
        response.json(result.data satisfies Inspiration);
      } catch (error) {
        const message = failure(error);
        const status =
          message.includes('凭证') || message.includes('房间不存在')
            ? 401
            : message.includes('输入格式')
              ? 400
              : 502;
        response.status(status).json({
          error:
            status === 502 && !message.startsWith('灵感服务返回')
              ? '灵感请求失败或超时，请稍后重试'
              : message,
        });
      }
    },
  );
  const frontendDir = resolve('dist');
  app.use(express.static(frontendDir));
  app.get('/{*path}', frontendFallbackLimit, (request, response) => {
    if (request.path.startsWith('/api/'))
      return void response.status(404).json({ error: '接口不存在' });
    if (existsSync(resolve(frontendDir, 'index.html')))
      response.sendFile(resolve(frontendDir, 'index.html'));
    else response.status(404).send('前端尚未构建，请先运行 npm run build');
  });
  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      response
        .status(400)
        .json({ error: error instanceof SyntaxError ? '请求 JSON 格式无效' : '请求体无效或过大' });
    },
  );
  return {
    app,
    httpServer,
    io,
    maintain: cleanup,
    listen(port = 0, host = '127.0.0.1'): Promise<number> {
      return new Promise((resolvePort, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          httpServer.off('error', reject);
          const address = httpServer.address();
          resolvePort(typeof address === 'object' && address ? address.port : port);
        });
      });
    },
    async close() {
      clearInterval(cleanupTimer);
      imageReadStore.shutdown();
      inspirationStore.shutdown();
      frontendFallbackStore.shutdown();
      io.disconnectSockets(true);
      try {
        persist();
      } catch {
        console.warn('关闭时存档保存失败，请检查数据目录；此前成功保存的操作仍在原存档。');
      }
      await new Promise<void>((resolveClose) => io.close(() => resolveClose()));
    },
  };
}
