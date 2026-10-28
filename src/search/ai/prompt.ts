// Optional: Chrome's built-in Prompt API (Gemini Nano) turns a long request into a plan of Rounder steps. Off unless
// the visitor turns it on in the palette, used only when the browser says the model is already 'available' (search
// never starts Chrome's multi-gigabyte download), and constrained to a JSON schema whose tool list is the hybrid
// search's own shortlist. It runs on the device; the request goes nowhere else.
import { kbOf } from '@/tools/presets';
import type { Preset, SearchDoc } from '../core/types';

export interface AiStep {
  slug: string;
  preset: Preset;
}
export interface AiPlan {
  steps: AiStep[];
  summary: string;
}

interface Session {
  prompt(input: string, options?: { responseConstraint?: object; signal?: AbortSignal }): Promise<string>;
  clone?(options?: { signal?: AbortSignal }): Promise<Session>;
  destroy(): void;
}
interface LanguageModelApi {
  availability(options?: object): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create(options?: object): Promise<Session>;
}

const OPTIONS = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
const SYSTEM =
  'You route requests to Rounder, a site of browser tools. Pick tools only from the list you are given, in the order the person would use them. ' +
  "Add a preset only with the keys listed for that tool. Never invent tools. Summarise the plan in under 90 characters.";

const api = () => (globalThis as { LanguageModel?: LanguageModelApi }).LanguageModel;
export const aiSupported = () => typeof api()?.availability === 'function';

const SETTING = 'rounder:search-ai';
export function aiEnabled(): boolean {
  try {
    return localStorage.getItem(SETTING) === '1';
  } catch {
    return false;
  }
}
export function setAiEnabled(on: boolean) {
  try {
    if (on) localStorage.setItem(SETTING, '1');
    else localStorage.removeItem(SETTING);
  } catch {}
}

let ready: Promise<boolean> | undefined;
/** true only when the model is already on the device; 'downloadable' and 'downloading' count as no */
export function aiReady(): Promise<boolean> {
  ready ??= (api()?.availability(OPTIONS) ?? Promise.resolve('unavailable')).then((a) => a === 'available', () => false);
  return ready;
}

/** long, multi-part or unresolved requests are worth a plan; Hinglish isn't a language the model supports */
export function wantsPlan(q: string, confident: boolean, hinglish: boolean): boolean {
  return !hinglish && (q.trim().split(/\s+/).length >= 6 || !confident);
}

const PRESET_SCHEMA: Record<string, object> = {
  target: { type: 'string', pattern: '^\\d+(\\.\\d+)?(kb|mb)$' },
  range: { type: 'string', pattern: '^\\d+-\\d+(kb|mb)$' },
  min: { type: 'string', pattern: '^\\d+(\\.\\d+)?(kb|mb)$' },
  size: { type: 'string', pattern: '^\\d+x\\d+(px|cm|mm|in)?$' },
  from: { type: 'string', pattern: '^[a-z0-9]{2,5}$' },
  to: { type: 'string', pattern: '^[a-z0-9]{2,5}$' },
  start: { type: 'number', minimum: 0 },
  end: { type: 'number', minimum: 0 },
  value: { type: 'number' },
};

/** the response schema for one query: the tool enum is the shortlist, presets only the keys any of them read */
export function planSchema(shortlist: SearchDoc[]): object {
  const keys = [...new Set(shortlist.flatMap((d) => d.presets ?? []))].filter((k) => PRESET_SCHEMA[k]);
  return {
    type: 'object',
    required: ['steps', 'summary'],
    properties: {
      steps: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: {
          type: 'object',
          required: ['tool'],
          properties: {
            tool: { enum: shortlist.map((d) => d.slug) },
            preset: { type: 'object', properties: Object.fromEntries(keys.map((k) => [k, PRESET_SCHEMA[k]])), additionalProperties: false },
          },
        },
      },
      summary: { type: 'string', maxLength: 90 },
    },
  };
}

/** keeps only shortlisted tools and the preset keys and values each one accepts; drops anything malformed */
export function validatePlan(raw: string, shortlist: SearchDoc[]): AiPlan | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const d = data as { steps?: { tool?: unknown; preset?: Record<string, unknown> }[]; summary?: unknown };
  if (!Array.isArray(d?.steps)) return null;
  const bySlug = new Map(shortlist.map((x) => [x.slug, x]));
  const steps: AiStep[] = [];
  for (const s of d.steps.slice(0, 4)) {
    const doc = typeof s?.tool === 'string' ? bySlug.get(s.tool) : undefined;
    if (!doc) continue;
    const preset: Preset = {};
    for (const [k, v] of Object.entries(s.preset ?? {})) {
      if (!doc.presets?.includes(k)) continue;
      if ((k === 'target' || k === 'min') && typeof v === 'string' && kbOf(v)) preset[k] = v;
      else if (k === 'range' && typeof v === 'string' && /^\d+-\d+(kb|mb)$/.test(v)) preset[k] = v;
      else if (k === 'size' && typeof v === 'string' && /^\d+x\d+(px|cm|mm|in)?$/.test(v)) preset[k] = v;
      else if ((k === 'from' || k === 'to') && typeof v === 'string' && /^[a-z0-9]{2,5}$/.test(v)) preset[k] = v;
      else if (['start', 'end', 'value'].includes(k) && typeof v === 'number' && Number.isFinite(v) && v >= 0) preset[k] = v;
    }
    if (!steps.some((x) => x.slug === doc.slug)) steps.push({ slug: doc.slug, preset });
  }
  if (!steps.length) return null;
  return { steps, summary: typeof d.summary === 'string' ? d.summary.slice(0, 90) : '' };
}

let base: Promise<Session> | undefined;

/** a plan for the request, or null (not available, timed out, aborted, or nothing usable came back) */
export async function planWithAi(q: string, shortlist: SearchDoc[], { signal, timeoutMs = 4000 }: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<AiPlan | null> {
  const lm = api();
  if (!lm || !shortlist.length || !(await aiReady())) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
  let session: Session | undefined;
  let root: Session | undefined;
  try {
    // one session per page, cloned for each request so earlier ones don't leak into the next
    base ??= lm.create({ ...OPTIONS, initialPrompts: [{ role: 'system', content: SYSTEM }] }).catch((err) => {
      base = undefined;
      throw err;
    });
    root = await base;
    session = root.clone ? await root.clone({ signal: ctrl.signal }) : root;
    const list = shortlist.map((d) => `- ${d.slug}: ${d.name}. ${d.tagline}${d.presets?.length ? ` (preset keys: ${d.presets.join(', ')})` : ''}`).join('\n');
    const raw = await session.prompt(`Request: ${q}\n\nTools:\n${list}`, { responseConstraint: planSchema(shortlist), signal: ctrl.signal });
    return validatePlan(raw, shortlist);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    if (session && session !== root) session.destroy();
  }
}

/** for tests: forget the cached availability and session */
export function resetAi() {
  ready = undefined;
  base = undefined;
}
