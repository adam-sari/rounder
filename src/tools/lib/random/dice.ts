import { cryptoRand32, randBelow, type Rand32 } from './rng';

export type KeepMode = 'kh' | 'kl' | 'dh' | 'dl';

export interface DiceTerm {
  type: 'dice';
  sign: 1 | -1;
  count: number;
  sides: number;
  keep?: { mode: KeepMode; n: number };
}
export interface ModTerm {
  type: 'mod';
  sign: 1 | -1;
  value: number;
}
export type Term = DiceTerm | ModTerm;

export interface DieRoll {
  sides: number;
  value: number;
  kept: boolean;
}
export interface TermResult {
  term: Term;
  dice: DieRoll[];
  /** signed contribution to the total */
  subtotal: number;
}
export interface RollResult {
  notation: string;
  terms: TermResult[];
  total: number;
}

export const STANDARD_DICE = [4, 6, 8, 10, 12, 20, 100] as const;
export const MAX_DICE = 1000;
export const MAX_SIDES = 1000;
const MAX_MOD = 1_000_000;

// one term after its sign: "4d6kh3", "d%", "d20", "5"
const TERM = /^(?:(\d*)d(\d+|%)(?:(kh|kl|k|dh|dl)(\d+))?|(\d+))$/;

/**
 * Parses dice notation such as "2d6+3", "4d6kh3" or "d20 + d4 - 1".
 * Supports keep highest/lowest (kh, kl, k) and drop highest/lowest (dh, dl).
 * Throws an Error with a readable message when the notation can't be used.
 */
export function parseDice(input: string): Term[] {
  // accept a typographic minus or dash, as pasted from documents
  const text = input.toLowerCase().replace(/[−–—]/g, '-').trim();
  if (!text) throw new Error('Type some dice, like 2d6+3.');
  // "2d6 3" must not quietly become a 63-sided die
  if (/[^\s+-]\s+[^\s+-]/.test(text)) throw new Error('Put + or - between terms, like 2d6 + 3.');
  const src = text.replace(/\s+/g, '');
  const parts = src.match(/[+-]?[^+-]+|[+-]$/g) ?? [];
  if (parts.join('') !== src) throw new Error(`"${input.trim()}" isn't dice notation I can read. Try something like 2d6+3.`);

  let dice = 0;
  const terms = parts.map((part): Term => {
    const sign = part.startsWith('-') ? -1 : 1;
    const body = part.replace(/^[+-]/, '');
    const m = TERM.exec(body);
    if (!m) throw new Error(`"${body || part}" isn't a die or a number. Dice look like d20, 3d6 or 4d6kh3.`);
    if (m[5] !== undefined) {
      const value = Number(m[5]);
      if (value > MAX_MOD) throw new Error(`Modifiers go up to ${MAX_MOD.toLocaleString('en-US')}.`);
      return { type: 'mod', sign, value };
    }
    const count = m[1] ? Number(m[1]) : 1;
    const sides = m[2] === '%' ? 100 : Number(m[2]);
    if (count < 1) throw new Error('Roll at least one die.');
    if (sides < 2 || sides > MAX_SIDES) throw new Error(`Dice can have 2 to ${MAX_SIDES} sides.`);
    dice += count;
    if (dice > MAX_DICE) throw new Error(`That's more than ${MAX_DICE} dice. Try fewer.`);
    const term: DiceTerm = { type: 'dice', sign, count, sides };
    if (m[3]) {
      const mode = (m[3] === 'k' ? 'kh' : m[3]) as KeepMode;
      const n = Number(m[4]);
      const keeping = mode[0] === 'k';
      if (keeping ? n < 1 || n > count : n >= count) {
        throw new Error(keeping ? `You can keep 1 to ${count} of ${count} dice.` : `You can drop at most ${count - 1} of ${count} dice.`);
      }
      if (n > 0) term.keep = { mode, n };
    }
    return term;
  });
  if (!terms.some((t) => t.type === 'dice')) throw new Error('Add at least one die, like d20.');
  return terms;
}

/** tidy, canonical notation: "2d6 + d20 - 1" */
export function formatDice(terms: Term[]): string {
  return terms
    .map((t, i) => {
      const body = t.type === 'mod' ? String(t.value) : `${t.count > 1 ? t.count : ''}d${t.sides}${t.keep ? t.keep.mode + t.keep.n : ''}`;
      if (i === 0) return t.sign < 0 ? `-${body}` : body;
      return `${t.sign < 0 ? '-' : '+'} ${body}`;
    })
    .join(' ');
}

/** adds one die of `sides` to the notation, merging into a plain term of the same die */
export function addDie(terms: Term[], sides: number): Term[] {
  const next = terms.map((t) => ({ ...t }));
  const same = next.find((t): t is DiceTerm => t.type === 'dice' && t.sides === sides && t.sign > 0 && !t.keep);
  if (same) same.count++;
  else {
    // keep modifiers at the end so "d20 + 5" grows into "d20 + d6 + 5"
    const at = next.findIndex((t) => t.type === 'mod');
    next.splice(at < 0 ? next.length : at, 0, { type: 'dice', sign: 1, count: 1, sides });
  }
  return next;
}

/** how many dice of each standard size, for the counters on the dice buttons */
export function countDice(terms: Term[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const t of terms) if (t.type === 'dice') out[t.sides] = (out[t.sides] ?? 0) + t.count;
  return out;
}

/** which of the rolled values count, by index */
export function keptMask(values: number[], keep?: DiceTerm['keep']): boolean[] {
  if (!keep) return values.map(() => true);
  const kept = keep.mode[0] === 'k' ? keep.n : values.length - keep.n;
  const highest = keep.mode === 'kh' || keep.mode === 'dl';
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => (highest ? b[0] - a[0] : a[0] - b[0]) || a[1] - b[1]);
  const mask = values.map(() => false);
  for (const [, i] of order.slice(0, kept)) mask[i] = true;
  return mask;
}

export function rollDice(terms: Term[], next: Rand32 = cryptoRand32): RollResult {
  const results = terms.map((term): TermResult => {
    if (term.type === 'mod') return { term, dice: [], subtotal: term.sign * term.value };
    const values = Array.from({ length: term.count }, () => 1 + randBelow(term.sides, next));
    const mask = keptMask(values, term.keep);
    const dice = values.map((value, i) => ({ sides: term.sides, value, kept: mask[i] }));
    const sum = dice.reduce((s, d) => s + (d.kept ? d.value : 0), 0);
    return { term, dice, subtotal: term.sign * sum };
  });
  return { notation: formatDice(terms), terms: results, total: results.reduce((s, r) => s + r.subtotal, 0) };
}

/** lowest and highest possible totals */
export function diceRange(terms: Term[]): { min: number; max: number } {
  let min = 0;
  let max = 0;
  for (const t of terms) {
    if (t.type === 'mod') {
      min += t.sign * t.value;
      max += t.sign * t.value;
      continue;
    }
    const kept = !t.keep ? t.count : t.keep.mode[0] === 'k' ? t.keep.n : t.count - t.keep.n;
    const [lo, hi] = [kept, kept * t.sides];
    if (t.sign > 0) [min, max] = [min + lo, max + hi];
    else [min, max] = [min - hi, max - lo];
  }
  return { min, max };
}
