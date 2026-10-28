import type { z } from 'zod';

export type Family = 'pdf' | 'image' | 'media' | 'files';

/** What an op returns: one file, several files, text, or plain data */
export type Returns = 'file' | 'files' | 'text' | 'data';

export interface Example<O> {
  /** input file names as a user would type them */
  inputs: string[];
  options?: Partial<O>;
  /** what an assistant would be asked, for the MCP docs line */
  prompt: string;
}

/**
 * One tool, described once. From this spec come the SDK's types and function, the CLI's flags and help, the MCP tool's
 * schema, the docs snippets on the site and the deep link back to the site with the same preset.
 */
export interface OpSpec<S extends z.ZodObject = z.ZodObject, R extends Returns = Returns> {
  /** the site's slug: also the CLI command and the MCP tool name */
  slug: string;
  family: Family;
  /** the SDK function: `pdf.compress` */
  fn: string;
  title: string;
  summary: string;
  inputs: {
    /** file kinds, by extension (lowercase, no dot) */
    accept: string[];
    min: number;
    max: number;
    /** 'each': run once per input (batches); 'all': every input goes into one run (merge, zip) */
    mode: 'each' | 'all';
  };
  returns: R;
  /** the name suffix of the result, like the site's downloads: "-compressed" */
  suffix?: string;
  options: S;
  /** single-letter CLI flags */
  short?: Partial<Record<keyof z.infer<S> & string, string>>;
  examples: Example<z.input<S>>[];
  /** maps a variant page's island props (e.g. { targetKb: 100 }) to options */
  presets?: (props: Record<string, unknown>) => Partial<z.input<S>> | null;
  /** the site URL's hash for these options, e.g. "#100kb" */
  deepLink?: (o: z.infer<S>) => string;
  /** external programs or optional packages it needs */
  requires?: ('ffmpeg' | 'canvas')[];
  readOnly?: boolean;
  /** output text comes from the file (pdf-to-text): an assistant must treat it as data, not instructions */
  untrustedText?: boolean;
}

export function defineOp<S extends z.ZodObject, R extends Returns>(spec: OpSpec<S, R>): OpSpec<S, R> {
  return spec;
}

/** whether a format page's input ("HEIC to JPG" → heic) is one the op reads */
export function acceptsFormat(spec: OpSpec, props: Record<string, unknown>): boolean {
  const from = typeof props.from === 'string' ? props.from.toLowerCase() : undefined;
  return !from || spec.inputs.accept.includes('*') || spec.inputs.accept.includes(from);
}

export type OptionsIn<T extends OpSpec> = z.input<T['options']>;
export type OptionsOut<T extends OpSpec> = z.infer<T['options']>;
