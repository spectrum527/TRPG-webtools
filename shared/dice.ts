import type { DiceGroup, DiceResult } from './types';

/** An injectable die returns a whole number in the inclusive range 1..sides. */
export type DieRandom = (sides: number) => number;

export function secureDie(sides: number): number {
  // Rejection sampling avoids the bias produced by a plain uint32 % sides.
  const range = 0x1_0000_0000;
  const limit = range - (range % sides);
  const value = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(value);
  } while (value[0] >= limit);
  return (value[0] % sides) + 1;
}

export function die(sides: number, rng: DieRandom): number {
  const value = rng(sides);
  if (!Number.isInteger(value) || value < 1 || value > sides) {
    throw new Error(`随机源必须返回 1 至 ${sides} 的整数`);
  }
  return value;
}

export function integer(
  value: unknown,
  min: number,
  max: number,
  name: string,
): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name}须为 ${min} 至 ${max} 的整数`);
  }
}

/** Grammar: signed dice/integer terms joined by + or -. No code is evaluated. */
export function rollDice(expression: string, rng: DieRandom = secureDie): DiceResult {
  if (typeof expression !== 'string' || expression.length > 120)
    throw new Error('骰子表达式最多 120 个字符');
  const compact = expression.toLowerCase().replace(/\s+/g, '');
  if (!compact || !/^[+\-]?(?:\d*d\d+|\d+)(?:[+\-](?:\d*d\d+|\d+))*$/.test(compact)) {
    throw new Error('请输入如 2d6+3、d20 或 1d8+1d4-2 的表达式');
  }
  const terms = compact.match(/[+\-]?[^+\-]+/g)!;
  const parsed: Array<{ sign: number; count: number; sides: number } | { value: number }> = [];
  let diceCount = 0;
  let modifier = 0;
  // Validate the complete expression before consuming any randomness.
  for (const term of terms) {
    const sign = term.startsWith('-') ? -1 : 1;
    const unsigned = term.replace(/^[+\-]/, '');
    if (unsigned.includes('d')) {
      const [rawCount, rawSides] = unsigned.split('d');
      const count = rawCount === '' ? 1 : Number(rawCount);
      const sides = Number(rawSides);
      integer(count, 1, 100, '骰子数量');
      integer(sides, 2, 1000, '骰子面数');
      diceCount += count;
      if (diceCount > 100) throw new Error('每次最多投掷 100 颗骰子');
      parsed.push({ count, sides, sign });
    } else {
      const value = Number(unsigned);
      integer(value, 0, 10000, '固定修正值');
      modifier += sign * value;
      if (Math.abs(modifier) > 10000) throw new Error('固定修正值的合计不可超过 ±10000');
      parsed.push({ value: sign * value });
    }
  }
  const groups: DiceGroup[] = [];
  let total = modifier;
  for (const term of parsed) {
    if ('value' in term) continue;
    const rolls = Array.from({ length: term.count }, () => die(term.sides, rng));
    groups.push({ ...term, rolls });
    total += term.sign * rolls.reduce((sum, value) => sum + value, 0);
  }
  return { expression: compact, groups, modifier, total };
}
