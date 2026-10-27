import { FIELDS, parseField, type FieldName, type FieldSpec } from './cron';

export type Mode = 'every' | 'specific' | 'range' | 'step' | 'custom';

export interface FieldState {
  mode: Mode;
  /** specific */
  values: number[];
  /** range */
  from: number;
  to: number;
  /** step: every n, starting at start */
  every: number;
  start: number;
  /** anything the builder can't show, kept verbatim */
  raw: string;
}

/** Last valid value in the builder (weekday 7 is just Sunday again) */
export const top = (spec: FieldSpec) => (spec.name === 'weekday' ? 6 : spec.max);

const blank = (spec: FieldSpec): FieldState => ({
  mode: 'every', values: [], from: spec.min, to: spec.min, every: 1, start: spec.min, raw: '*',
});

function single(token: string, spec: FieldSpec) {
  const v = [...parseField(token, spec)];
  if (v.length !== 1) throw new Error('not a single value');
  return v[0];
}

/** Reads a field string into builder state, falling back to "custom" for anything unusual */
export function decomposeField(text: string, spec: FieldSpec): FieldState {
  const state = { ...blank(spec), raw: text };
  try {
    if (text === '*' || text === '?') return state;
    if (/^\w+(,\w+)*$/.test(text)) return { ...state, mode: 'specific', values: [...parseField(text, spec)].sort((a, b) => a - b) };
    let m = /^(\w+)-(\w+)$/.exec(text);
    if (m) {
      const [from, to] = [single(m[1], spec), single(m[2], spec)];
      // weekday 0-7 is every day, which a Sun-to-Sun pair can't show
      if (from !== to || m[1] === m[2]) return { ...state, mode: 'range', from, to };
    }
    m = /^(\*|\w+)\/(\d+)$/.exec(text);
    if (m && Number(m[2]) >= 1) {
      return { ...state, mode: 'step', every: Number(m[2]), start: m[1] === '*' ? spec.min : single(m[1], spec) };
    }
  } catch {
    // invalid fields stay as typed so the error message can point at them
  }
  return { ...state, mode: 'custom' };
}

/** Joins runs of three or more neighbours into ranges: 1,2,3,4,5,9 → 1-5,9 */
function compact(values: number[]) {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    if (j - i >= 2) parts.push(`${sorted[i]}-${sorted[j]}`);
    else parts.push(...sorted.slice(i, j + 1).map(String));
    i = j + 1;
  }
  return parts.join(',');
}

export function composeField(state: FieldState, spec: FieldSpec): string {
  switch (state.mode) {
    case 'every': return '*';
    case 'specific': return state.values.length ? compact(state.values) : '*';
    case 'range': {
      const { from, to } = state;
      if (from <= to) return span(from, to);
      // a backwards pick wraps round (Fri to Sun, 22 to 6); cron ranges can't, so split it
      if (spec.name === 'weekday' && to === 0) return `${from}-7`;
      return `${span(from, top(spec))},${span(spec.min, to)}`;
    }
    case 'step': return `${state.start === spec.min ? '*' : state.start}/${Math.max(1, state.every)}`;
    // a space would split the expression into extra fields
    case 'custom': return state.raw.replace(/\s+/g, '') || '*';
  }
}

const span = (a: number, b: number) => (a === b ? String(a) : `${a}-${b}`);

/** Switches mode, seeding the new mode with something sensible */
export function withMode(state: FieldState, mode: Mode, spec: FieldSpec): FieldState {
  const next = { ...state, mode };
  if (mode === 'specific' && !state.values.length) next.values = [spec.min];
  // working hours and working days are the ranges people usually want
  if (mode === 'range' && state.from === state.to) [next.from, next.to] = spec.name === 'hour' ? [9, 17] : spec.name === 'weekday' ? [1, 5] : [spec.min, top(spec)];
  if (mode === 'step' && state.every < 2) next.every = spec.name === 'minute' || spec.name === 'second' ? 15 : 2;
  if (mode === 'custom') next.raw = composeField(state, spec);
  return next;
}

export const order = (seconds: boolean): FieldName[] =>
  seconds ? ['second', 'minute', 'hour', 'day', 'month', 'weekday'] : ['minute', 'hour', 'day', 'month', 'weekday'];

export type Builder = Partial<Record<FieldName, FieldState>>;

/** Splits an expression (already macro-expanded) into builder state for each field */
export function decompose(fields: string[]): Builder {
  const names = order(fields.length === 6);
  return Object.fromEntries(names.map((n, i) => [n, decomposeField(fields[i] ?? '*', FIELDS[n])]));
}

export function compose(builder: Builder, seconds: boolean): string {
  return order(seconds).map((n) => composeField(builder[n] ?? blank(FIELDS[n]), FIELDS[n])).join(' ');
}
