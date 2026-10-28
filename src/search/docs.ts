// Registry tool → the lean search entry. Runs at build time (the hashed index endpoint, the vectors) and in tests.
import { PRESET_KEYS } from '@/tools/presets';
import type { Tool } from '@/tools/types';
import type { SearchDoc } from './core/types';

/** preset props the router reads; example lists (targets, table, limits) stay on the page */
const PROP_KEYS = ['from', 'to', 'targetKb', 'targetMB', 'rangeKb', 'mode', 'unit', 'w', 'h', 'dpi', 'category', 'format', 'dir', 'lang', 'size', 'compress', 'output', 'focus'];

export function toSearchDoc(t: Tool): SearchDoc {
  const props = t.props && Object.fromEntries(Object.entries(t.props).filter(([k]) => PROP_KEYS.includes(k)));
  return {
    slug: t.slug,
    name: t.name,
    tagline: t.tagline,
    kind: t.category,
    keywords: t.keywords,
    description: t.description,
    ...(t.variantOf ? { variantOf: t.variantOf } : {}),
    ...(props && Object.keys(props).length ? { props } : {}),
    ...(t.next?.length ? { next: t.next } : {}),
    ...(PRESET_KEYS[t.island] ? { presets: PRESET_KEYS[t.island] } : {}),
  };
}

/** the passages a tool is embedded as: one vector for its whole text, and the max over its short fields */
export function passagesOf(t: Pick<SearchDoc, 'name' | 'slug' | 'tagline' | 'keywords'>): string[] {
  return [t.name, t.slug.replace(/-/g, ' '), t.tagline, ...t.keywords];
}

export function docTextOf(t: Tool): string {
  return [t.name, t.slug.replace(/-/g, ' '), t.keywords.join(' . '), t.tagline, t.description, t.steps.join(' '), t.faq.map((f) => f.q).join(' ')].join('. ');
}
