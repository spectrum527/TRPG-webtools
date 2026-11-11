import { z } from 'zod';
import type { Combatant } from './encounter';
import type { DndEdition, Room, RoomAction } from './types';

export const InjuryChecksSchema = z.strictObject({
  conPending: z.boolean().optional(),
  cocDueRound: z.number().int().min(0).max(100001).optional(),
  lastDeathRound: z.number().int().min(1).max(100000).optional(),
  firstAidStabilized: z.boolean().optional(),
  firstAidUsed: z.boolean().optional(),
  medicineUsed: z.boolean().optional(),
});

export const HpConfirmationSchema = z.strictObject({
  expectedHp: z.number().int().min(0).max(100000).nullable(),
  expectedRevision: z.number().int().min(0).max(1000000000),
  outcome: z.enum(['rules', 'dead']),
});
export type HpConfirmation = z.infer<typeof HpConfirmationSchema>;

export function usesDeathSaves(c: Combatant): boolean {
  return (
    c.rule === 'dnd' &&
    (c.memberId !== null ||
      c.deathSaveMode === 'character' ||
      (c.deathSaveMode === undefined && c.ownerMemberId !== undefined))
  );
}

export function injuryLabels(c: Combatant): string[] {
  if (c.dead) return ['死亡'];
  const labels: string[] = [];
  if (c.majorWound && c.rule === 'coc') labels.push('重伤');
  if (c.dying) labels.push('濒死');
  if (c.stable) labels.push(c.injuryChecks?.firstAidStabilized ? '急救后暂时稳定' : '已稳定');
  if (c.unconscious) labels.push('昏迷');
  if (c.injuryChecks?.conPending) labels.push('待体质检定');
  return labels;
}

export function markDead(c: Combatant): Combatant {
  return {
    ...c,
    hp: 0,
    dead: true,
    unconscious: false,
    dying: false,
    stable: false,
    concentration: '',
    injuryChecks: {},
  };
}

export function stabilize(c: Combatant): Combatant {
  if (c.dead || c.hp !== 0) throw new Error('只有未死亡且 HP 为 0 的角色可以稳定伤势');
  return {
    ...c,
    stable: true,
    dying: false,
    unconscious: true,
    concentration: '',
    deathSuccesses: 0,
    deathFailures: 0,
    injuryChecks:
      c.rule === 'coc'
        ? {
            ...c.injuryChecks,
            conPending: false,
            cocDueRound: undefined,
            firstAidStabilized: true,
            firstAidUsed: true,
          }
        : { lastDeathRound: c.injuryChecks?.lastDeathRound },
  };
}

export function healInjury(c: Combatant, hp: number): Combatant {
  if (c.dead && hp > 0) throw new Error('角色已死亡，请由主持人先确认复活');
  const next = { ...c, hp };
  if (hp > 0 && c.hp !== null && hp > c.hp) {
    if (c.rule === 'dnd' || c.hp === 0) {
      next.dying = false;
      next.stable = false;
      next.unconscious = false;
      next.deathSuccesses = 0;
      next.deathFailures = 0;
      next.injuryChecks = {
        lastDeathRound: c.injuryChecks?.lastDeathRound,
        firstAidUsed: c.injuryChecks?.firstAidUsed,
        medicineUsed: c.injuryChecks?.medicineUsed,
      };
    }
    if (c.rule === 'coc' && c.maxHp !== null && hp >= Math.ceil(c.maxHp / 2))
      next.majorWound = false;
  }
  return next;
}

/** damage is after armor/resistance, hpDamage is after temporary HP absorption. */
export function damageInjury(
  c: Combatant,
  hp: number,
  damage: number,
  hpDamage: number,
  round: number,
  options: { critical?: boolean; edition?: DndEdition } = {},
): { combatant: Combatant; notes: string[] } {
  let next: Combatant = { ...c, hp };
  const notes: string[] = [];
  if (c.dead) return { combatant: { ...c, hp: 0 }, notes: ['目标已死亡。'] };
  if (c.rule === 'dnd' && options.edition === '2024' && c.maxHp === 0)
    return { combatant: markDead(next), notes: ['生命上限为 0，角色死亡。'] };
  if (damage <= 0) return { combatant: next, notes };
  if (c.rule === 'coc') {
    next.injuryChecks = { ...c.injuryChecks, firstAidUsed: false, medicineUsed: false };
    const max = c.maxHp;
    if (max === null || max <= 0) {
      if (hp === 0) {
        next.unconscious = true;
        next.dying = c.majorWound;
        next.stable = false;
        if (next.dying)
          next.injuryChecks = { cocDueRound: c.injuryChecks?.cocDueRound ?? round + 1 };
      }
      return { combatant: next, notes: ['HP 上限未知，由 KP 判定重伤与死亡。'] };
    }
    const major = damage >= Math.ceil(max / 2);
    next.majorWound ||= major;
    if (damage >= max)
      return { combatant: markDead(next), notes: ['单次伤害达到 HP 上限，角色当场死亡。'] };
    if (hp === 0) {
      next.unconscious = true;
      next.stable = false;
      next.dying = next.majorWound;
      if (next.dying) {
        next.injuryChecks = {
          cocDueRound:
            c.dying && c.injuryChecks?.cocDueRound !== undefined
              ? c.injuryChecks.cocDueRound
              : round + 1,
        };
        notes.push('昏迷且濒死；从下一轮结束时起，每轮进行 CON 检定。');
      } else {
        next.injuryChecks = {};
        notes.push('HP 为 0，昏迷；未受重伤，不进入濒死。');
      }
    } else if (major) {
      next.injuryChecks = { ...next.injuryChecks, conPending: true };
      notes.push('本次造成重伤，需进行 CON 检定；失败则昏迷。');
    }
    return { combatant: next, notes };
  }
  if (hp !== 0) return { combatant: next, notes };
  if (!usesDeathSaves(c))
    return { combatant: markDead(next), notes: ['HP 为 0；该生物未启用死亡豁免，角色死亡。'] };
  const lethalDamage = c.hp === 0 ? damage : Math.max(0, hpDamage - (c.hp ?? 0));
  if (c.maxHp !== null && c.maxHp > 0 && lethalDamage >= c.maxHp)
    return { combatant: markDead(next), notes: ['伤害达到即时死亡阈值，角色死亡。'] };
  next.unconscious = true;
  next.dying = true;
  next.stable = false;
  next.concentration = '';
  if (c.hp === 0) {
    next.deathFailures = Math.min(3, c.deathFailures + (options.critical ? 2 : 1));
    notes.push(`0 HP 时受伤，增加 ${options.critical ? 2 : 1} 次死亡豁免失败。`);
    if (next.deathFailures >= 3) {
      next = markDead(next);
      notes.push('累计三次失败，角色死亡。');
    }
  } else {
    next.deathSuccesses = 0;
    next.deathFailures = 0;
    next.injuryChecks = { lastDeathRound: c.injuryChecks?.lastDeathRound };
    notes.push('HP 为 0，昏迷并进入濒死；回合开始时进行死亡豁免。');
  }
  return { combatant: next, notes };
}

export function applyDeathSave(c: Combatant, die: number, modifier = 0): Combatant {
  if (!Number.isInteger(die) || die < 1 || die > 20) throw new Error('死亡豁免原始骰须为 1–20');
  if (!usesDeathSaves(c) || c.hp !== 0 || c.stable || c.dead || c.deathFailures >= 3)
    throw new Error('只有未稳定、未死亡且 HP 为 0 的角色可以进行死亡豁免');
  if (die === 20) return healInjury({ ...c, concentration: '' }, 1);
  const next = { ...c, dying: true, unconscious: true, concentration: '' };
  if (die === 1) next.deathFailures = Math.min(3, next.deathFailures + 2);
  else if (die + modifier >= 10) next.deathSuccesses = Math.min(3, next.deathSuccesses + 1);
  else next.deathFailures = Math.min(3, next.deathFailures + 1);
  if (next.deathFailures >= 3) return markDead(next);
  if (next.deathSuccesses >= 3) return stabilize(next);
  return next;
}

export function applyConstitution(c: Combatant, success: boolean, round: number): Combatant {
  if (c.rule !== 'coc' || c.dead || (!c.dying && !c.injuryChecks?.conPending))
    throw new Error('该角色当前没有待处理的重伤或濒死检定');
  if (c.dying) return success ? { ...c, injuryChecks: { cocDueRound: round + 1 } } : markDead(c);
  return {
    ...c,
    unconscious: c.unconscious || !success,
    injuryChecks: { ...c.injuryChecks, conPending: false },
  };
}

export type ManualHpChange = { target: Combatant; value: number };
export function lifeFields(c: Combatant) {
  return {
    hp: c.hp,
    dead: c.dead,
    unconscious: c.unconscious,
    dying: c.dying,
    stable: c.stable,
    majorWound: c.majorWound,
    deathSuccesses: c.deathSuccesses,
    deathFailures: c.deathFailures,
    injuryChecks: c.injuryChecks,
    concentration: c.concentration,
  };
}
export function manualHpChange(room: Room, action: RoomAction): ManualHpChange | null {
  let targetId: string | undefined, value: number | null | undefined;
  if (action.type === 'resource' && action.resource === 'hp') {
    targetId = action.memberId;
    value = action.value;
  } else if (action.type === 'encounter-update') {
    targetId = action.combatantId;
    value = action.patch.hp;
  } else if (action.type === 'encounter-companion-hp') {
    targetId = action.combatantId;
    value = action.hp;
  }
  let target = room.encounter.participants.find((c) => c.id === targetId);
  if (target && action.type === 'encounter-update') {
    const { hp: _hp, ...patch } = action.patch;
    target = { ...target, ...patch };
  }
  return target && typeof value === 'number' ? { target, value } : null;
}

export function previewManualHp(room: Room, change: ManualHpChange) {
  const { target, value } = change;
  if (value > (target.maxHp ?? 100000)) throw new Error('HP 不能超过已知上限');
  if (target.dead && value > 0) throw new Error('角色已死亡，请由主持人先确认复活');
  const lost = Math.max(0, (target.hp ?? value) - value);
  const projected = damageInjury(target, value, lost, lost, room.encounter.round, {
    edition: room.dndEdition,
  });
  if (target.hp === null && value === 0 && !target.dead) {
    projected.combatant =
      target.rule === 'dnd' && !usesDeathSaves(target)
        ? markDead({ ...target, hp: 0 })
        : {
            ...target,
            hp: 0,
            unconscious: true,
            stable: false,
            dying: target.rule === 'dnd' || target.majorWound,
            ...(target.rule === 'coc' && target.majorWound
              ? { injuryChecks: { cocDueRound: room.encounter.round + 1 } }
              : {}),
          };
  }
  const requiresConfirmation =
    room.phase === 'active' &&
    value !== target.hp &&
    (target.hp === null || value < target.hp) &&
    (value === 0 || projected.combatant.dead || projected.combatant.dying);
  return { ...projected, requiresConfirmation };
}
