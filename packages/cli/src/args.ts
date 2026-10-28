import type { OpSpec } from '@roundertools/sdk';
import { kebab } from '@roundertools/sdk';
import type { z } from 'zod';

/** One option of an op, read off its zod schema: what the CLI flag takes and shows in help */
export interface Field {
  key: string;
  flag: string;
  kind: 'boolean' | 'number' | 'string' | 'list';
  /** allowed values, when the schema lists them */
  choices?: (string | number)[];
  /** numbers are allowed alongside the choices (e.g. resolution: auto | original | 1080 …) */
  numeric: boolean;
  /** free text is allowed too (sizes like "2mb", times like "1:05") */
  text: boolean;
  default?: unknown;
  description?: string;
  required: boolean;
}

type Def = { type: string; innerType?: z.ZodType; defaultValue?: unknown; entries?: Record<string, string>; values?: unknown[]; options?: z.ZodType[]; element?: z.ZodType };
const defOf = (s: z.ZodType) => (s as unknown as { _zod: { def: Def } })._zod.def;

function describe(key: string, schema: z.ZodType): Field {
  let s = schema;
  let required = true;
  let def: unknown;
  let description = schema.description;
  for (;;) {
    const d = defOf(s);
    if (d.type === 'optional') required = false;
    else if (d.type === 'default') {
      required = false;
      def = d.defaultValue;
    } else break;
    s = d.innerType!;
    description ??= s.description;
  }
  const field: Field = { key, flag: kebab(key), kind: 'string', numeric: false, text: false, required, default: def, description };
  const add = (t: z.ZodType) => {
    const d = defOf(t);
    if (d.type === 'boolean') field.kind = 'boolean';
    else if (d.type === 'number') field.numeric = true;
    else if (d.type === 'string') field.text = true;
    else if (d.type === 'enum') field.choices = [...(field.choices ?? []), ...Object.values(d.entries!)];
    else if (d.type === 'literal') field.choices = [...(field.choices ?? []), ...(d.values as (string | number)[])];
    else if (d.type === 'union') d.options!.forEach(add);
  };
  const d = defOf(s);
  if (d.type === 'array') {
    field.kind = 'list';
    add(d.element!);
  } else add(s);
  if (field.kind === 'string' && field.numeric && !field.choices && !field.text) field.kind = 'number';
  // a mix like 90 | 180 | 270 is numbers only
  if (field.choices?.every((c) => typeof c === 'number')) field.numeric = true;
  return field;
}

export function fieldsOf(spec: OpSpec): Field[] {
  return Object.entries(spec.options.shape as Record<string, z.ZodType>).map(([k, s]) => describe(k, s));
}

/** "90" → 90 where the schema takes numbers, so `--rotate 90` and `--resolution 720` validate */
export function coerce(field: Field, raw: string | boolean | string[] | undefined): unknown {
  if (raw === undefined || field.kind === 'boolean') return raw;
  const one = (v: string) => (field.numeric && /^-?\d+(\.\d+)?$/.test(v.trim()) && !field.choices?.includes(v) ? Number(v) : v);
  if (Array.isArray(raw)) return raw.flatMap((v) => v.split(',')).map((v) => one(v.trim()));
  return one(raw as string);
}

/** the shared flags every tool takes, as node:util parseArgs options */
export const COMMON = {
  output: { type: 'string', short: 'o' },
  overwrite: { type: 'boolean' },
  json: { type: 'boolean' },
  ndjson: { type: 'boolean' },
  quiet: { type: 'boolean', short: 'q' },
  verbose: { type: 'boolean' },
  progress: { type: 'boolean' },
  strict: { type: 'boolean' },
  recursive: { type: 'boolean', short: 'r' },
  concurrency: { type: 'string', short: 'j' },
  help: { type: 'boolean', short: 'h' },
} as const;
