import { readFileSync } from 'node:fs';

/** One tool page on roundertools.com, from the generated catalog (no page copy, just what the CLI and MCP need) */
export interface CatalogEntry {
  slug: string;
  name: string;
  tagline: string;
  category: string;
  keywords: string[];
  variantOf?: string;
  props?: Record<string, unknown>;
  next?: string[];
}

let cached: CatalogEntry[] | undefined;

/** every tool on the site, including the ones that only run in a browser */
export function catalog(): CatalogEntry[] {
  cached ??= JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url), 'utf8')) as CatalogEntry[];
  return cached;
}

export const SITE = 'https://roundertools.com';
