import type { Preset } from './types';

/** "#target=150kb&from=heic": the tool page's preset, in the hash so no new URLs get crawled (src/tools/presets.ts) */
export function presetHash(preset: Preset): string {
  const parts = Object.entries(preset).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('-') : v}`);
  return parts.length ? `#${parts.join('&')}` : '';
}
