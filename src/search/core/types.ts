// Shapes shared by the search engine, its build step and the UI. No DOM, no registry import.

/** one tool as the search sees it: the lean index entry built from the registry at build time */
export interface SearchDoc {
  slug: string;
  name: string;
  tagline: string;
  /** category id (image, pdf, video…) */
  kind: string;
  keywords: string[];
  description?: string;
  variantOf?: string;
  /** the island's preset props (variant pages), arrays of examples left out */
  props?: Record<string, unknown>;
  next?: string[];
  /** the hash preset keys the tool's page reads (src/tools/presets.ts) */
  presets?: string[];
}

/** a preset the tool page can open in: the public deep-link vocabulary (see src/tools/presets.ts) */
export type Preset = Record<string, string | number | [number, number]>;

export interface Route {
  slug: string;
  preset: Preset;
  /** one line saying why: "Compress PDF · 25 MB for Gmail" */
  why: string;
  conf: number;
  /** explicit format pairs, size and platform presets; verb + object rules are 'rule' */
  tier: 'exact' | 'rule' | 'weak';
}

export interface Hit {
  slug: string;
  name: string;
  kind: string;
  /** shown under the best match; the tagline when no parser route explains it */
  why: string;
  preset: Preset;
  /** the deep link: /slug, or /slug#target=100kb for a preset without its own page */
  href: string;
  score: number;
  source: 'parser' | 'lexical' | 'semantic' | 'ai';
}

export interface SearchResult {
  query: string;
  hits: Hit[];
  /** "Best match" when true, "Closest tools" otherwise */
  confident: boolean;
  /** several steps, in the order to do them (parser chains, or the best match's next step) */
  chain: Hit[];
  /** an honest line when Rounder can't do what was asked ("No PNG to GIF converter") */
  note?: string;
  /** the query had words a semantic model could help with and no confident parser route */
  wantsSemantic: boolean;
  /** romanised Hindi, which Chrome's built-in model doesn't support */
  hinglish: boolean;
}
