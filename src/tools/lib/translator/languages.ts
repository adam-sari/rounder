import { MODELS, type ModelKey } from '@/engines/ai/models';

export interface Language {
  /** BCP 47 code, as Chrome's Translator API takes it */
  code: string;
  name: string;
}

/** The languages Chrome's and Edge's built-in translator handle, by English name */
export const LANGUAGES: Language[] = (
  [
    ['ar', 'Arabic'], ['bn', 'Bengali'], ['bg', 'Bulgarian'], ['zh', 'Chinese (Simplified)'], ['zh-Hant', 'Chinese (Traditional)'],
    ['hr', 'Croatian'], ['cs', 'Czech'], ['da', 'Danish'], ['nl', 'Dutch'], ['en', 'English'], ['fi', 'Finnish'], ['fr', 'French'],
    ['de', 'German'], ['el', 'Greek'], ['he', 'Hebrew'], ['hi', 'Hindi'], ['hu', 'Hungarian'], ['id', 'Indonesian'], ['it', 'Italian'],
    ['ja', 'Japanese'], ['kn', 'Kannada'], ['ko', 'Korean'], ['lt', 'Lithuanian'], ['mr', 'Marathi'], ['no', 'Norwegian'], ['pl', 'Polish'],
    ['pt', 'Portuguese'], ['ro', 'Romanian'], ['ru', 'Russian'], ['sk', 'Slovak'], ['sl', 'Slovenian'], ['es', 'Spanish'], ['sv', 'Swedish'],
    ['ta', 'Tamil'], ['te', 'Telugu'], ['th', 'Thai'], ['tr', 'Turkish'], ['uk', 'Ukrainian'], ['vi', 'Vietnamese'],
  ] as const
).map(([code, name]) => ({ code, name }));

const NAMES = new Map(LANGUAGES.map((l) => [l.code, l.name]));

export const languageName = (code: string) => NAMES.get(code) ?? code;

/** "pt-BR" → "pt", "zh-TW" → "zh-Hant", "iw" → "he"; null when we don't offer the language */
export function normalizeLanguage(tag: string): string | null {
  const [base, ...rest] = tag.toLowerCase().split(/[-_]/);
  if (base === 'zh') return rest.some((s) => ['hant', 'tw', 'hk', 'mo'].includes(s)) ? 'zh-Hant' : 'zh';
  const code = ({ iw: 'he', nb: 'no', nn: 'no' } as Record<string, string>)[base] ?? base;
  return NAMES.has(code) ? code : null;
}

/** Scripts written without spaces between sentences */
export const NO_SPACE = new Set(['ja', 'zh', 'zh-Hant']);

/** One model step of the open-model fallback; multilingual models need a target token in front */
export interface Hop {
  key: ModelKey;
  prefix?: string;
}

/** Directions served by a multilingual OPUS-MT model (active once the registry lists it) */
const MULTI: Record<string, { key: string; prefix?: string }> = {
  'en-pt': { key: 'opus-mt-en-ROMANCE', prefix: '>>pt<< ' },
  'pt-en': { key: 'opus-mt-ROMANCE-en' },
};

/** The OPUS-MT model for one direction, if the registry has it */
export function hop(from: string, to: string): Hop | null {
  const h = MULTI[`${from}-${to}`] ?? { key: `opus-mt-${from}-${to}` };
  return h.key in MODELS ? (h as Hop) : null;
}

/** The models that translate from → to: one direct model, or two through English; null when none */
export function opusRoute(from: string, to: string): Hop[] | null {
  const direct = hop(from, to);
  if (direct) return [direct];
  if (from === 'en' || to === 'en') return null;
  const a = hop(from, 'en');
  const b = hop('en', to);
  return a && b ? [a, b] : null;
}

/** Which languages the open models cover, for page copy: both ways, only into English, only out of it */
export function opusCoverage() {
  const others = LANGUAGES.filter((l) => l.code !== 'en');
  const into = others.filter((l) => hop(l.code, 'en'));
  const out = others.filter((l) => hop('en', l.code));
  return {
    both: into.filter((l) => out.includes(l)).map((l) => l.name),
    intoEnglish: into.filter((l) => !out.includes(l)).map((l) => l.name),
    fromEnglish: out.filter((l) => !into.includes(l)).map((l) => l.name),
  };
}
