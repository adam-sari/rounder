// Entity extraction: what a query names (formats, sizes, dimensions, platforms, actions, objects) and where.
import { ACTIONS, DEVICES, FORMATS, KINDS, OBJECTS, PLATFORMS, UNIT_DIM, UNITS, type Kind } from './lexicon';
import { HI_MAP, normalize, osa } from './text';

export interface Entities {
  /** the normalised text everything was read from */
  text: string;
  formats: { id: string; kind: Kind; at: number }[];
  from?: string;
  to?: string;
  /** a generic kind named as the target: "turn a pdf into images" */
  toKind?: Kind;
  /** kinds named by a noun ("photo", "song"), not implied by a format */
  nounKinds: Set<Kind>;
  /** every kind the query mentions, from nouns and formats */
  kinds: Set<Kind>;
  size?: { maxKb?: number; minKb?: number; rangeKb?: [number, number] };
  dims?: { w: number; h: number; unit: string };
  durationS?: number;
  percent?: number;
  unitConv?: { value?: number; from: string; to: string; fromWord: string; toWord: string };
  platforms: string[];
  devices: string[];
  /** canonical actions in text order */
  actions: string[];
  objects: Set<string>;
  /** actions and objects the query rules out: "enlarge a photo without blur" */
  negated: Set<string>;
  hinglish: boolean;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cache = new Map<string, RegExp>();
const wordRe = (phrase: string) => {
  let re = cache.get(phrase);
  if (!re) cache.set(phrase, (re = new RegExp(`(^| )${esc(phrase)}( |$)`)));
  return re;
};
/** where a whole-word phrase starts in text, or -1 */
export const indexOf = (text: string, phrase: string) => {
  const m = wordRe(phrase).exec(text);
  return m ? m.index + m[1].length : -1;
};
export const has = (text: string, phrase: string) => wordRe(phrase).test(text);

// single words the typo fixer may correct towards: formats, verbs, nouns and a few tool words, never the whole language
const TYPO_VOCAB = [
  ...new Set(
    [
      ...Object.values(FORMATS).flatMap((f) => f.aliases),
      ...Object.values(ACTIONS).flat(),
      ...Object.values(KINDS).flat(),
      ...Object.values(OBJECTS).flat(),
      'generator', 'counter', 'remover', 'qr', 'code', 'compressor',
    ].filter((w) => !w.includes(' ') && w.length >= 3),
  ),
];
const TYPO_SET = new Set(TYPO_VOCAB);
const PROTECT = new Set([...Object.entries(PLATFORMS).flatMap(([k, p]) => [k, ...(p.aliases ?? [])]), ...Object.values(DEVICES).flat(), ...Object.keys(UNITS)]);
const HI_WORDS = new Set([...Object.keys(HI_MAP), 'ka', 'ki', 'ko', 'me', 'mein', 'se', 'kaise', 'kare', 'karna', 'hai', 'banaye']);

const sorted = (w: string) => [...w].sort().join('');

function fixTypos(text: string, known?: (w: string) => boolean): string {
  return text
    .split(' ')
    .map((w) => {
      if (w.length < 3 || /\d/.test(w) || TYPO_SET.has(w) || HI_WORDS.has(w) || PROTECT.has(w) || known?.(w)) return w;
      const max = w.length >= 7 ? 2 : 1;
      let best: string | null = null;
      let bd = max + 1;
      for (const v of TYPO_VOCAB) {
        const d = osa(w, v, max);
        if (d < bd) [bd, best] = [d, v];
      }
      // short words (formats) only fix transpositions (pfd → pdf, hiec → heic), never substitutions (mp4 ↔ mp3)
      if (best && w.length <= 4 && !(w.length === best.length && sorted(w) === sorted(best))) return w;
      return best ?? w;
    })
    .join(' ');
}

const unitKb = (u: string) => (u.startsWith('g') ? 1e6 : u.startsWith('m') ? 1000 : 1);

/** `known`: words the typo fixer must leave alone, e.g. every word in the tool index ("passport" isn't "password") */
export function parse(raw: string, known?: (w: string) => boolean): Entities {
  let text = normalize(raw);
  const hinglish = /(^| )(ka|ki|ko|kaise|kare|karna|hai|banaye|hataye|nikale|kam|se|me|mein)( |$)/.test(text) && text.split(' ').filter((w) => HI_WORDS.has(w)).length >= 2;
  text = text
    .split(' ')
    .map((w) => HI_MAP[w] ?? w)
    .join(' ')
    // "photo ko pdf me convert": ko marks the thing being changed, the word before me/mein is what it becomes
    .replace(/(^| )ko( |$)/g, '$1to$2')
    // "mp34" style typo: a format with a stray digit
    .replace(/\b(mp3|mp4)\d\b/g, '$1');
  text = fixTypos(text, known);

  const e: Entities = {
    text, formats: [], nounKinds: new Set(), kinds: new Set(), platforms: [], devices: [], actions: [],
    objects: new Set(), negated: new Set(), hinglish,
  };

  // sizes: a range first ("20kb to 50kb", "20 to 50 kb", "20-50kb", "between 20 and 50 kb"), then a single value
  const range = /(\d+(?:\.\d+)?)\s*(kb|mb|k)?\s*(?:to|-|and)\s*(\d+(?:\.\d+)?)\s*(kb|mb|k)\b/.exec(text);
  if (range) {
    const u2 = unitKb(range[4]);
    const u1 = range[2] ? unitKb(range[2]) : u2;
    e.size = { rangeKb: [+range[1] * u1, +range[3] * u2] };
  } else {
    const single = /(\d+(?:\.\d+)?)\s*(kb|mb|gb|k)\b/.exec(text);
    // "4k" is a resolution, not 4 KB: a bare k only counts from 10 up
    if (single && !(single[2] === 'k' && +single[1] < 10)) {
      const kb = +single[1] * unitKb(single[2]);
      e.size = /(increase|bigger|at least|more than|above|minimum)/.test(text) ? { minKb: kb } : { maxKb: kb };
    }
  }
  const dim = /(\d+(?:\.\d+)?)\s*(?:x|×|by)\s*(\d+(?:\.\d+)?)\s*(px|cm|mm|in|inch|inches)?\b/.exec(text);
  if (dim && !/\d(kb|mb)/.test(dim[0])) e.dims = { w: +dim[1], h: +dim[2], unit: ({ inch: 'in', inches: 'in' } as Record<string, string>)[dim[3]] ?? dim[3] ?? 'px' };
  const dur = /(\d+)\s*(seconds?|secs?|s|minutes?|mins?)\b/.exec(text);
  if (dur) e.durationS = +dur[1] * (dur[2].startsWith('m') ? 60 : 1);
  const pct = /(\d+(?:\.\d+)?)\s*%/.exec(text);
  if (pct) e.percent = +pct[1];
  for (const um of text.matchAll(/(?:(\d+(?:\.\d+)?)\s*)?\b([a-z]+)\s+(?:to|in|into)\s+([a-z]+)\b/g)) {
    let [from, to] = [UNITS[um[2]], UNITS[um[3]]];
    if (!from || !to || from === to || !(um[1] || (um[2] !== 'in' && um[3] !== 'in'))) continue;
    // ounces beside a volume are fluid ounces
    if (from === 'oz' && UNIT_DIM[to] === 'volume') from = 'floz-us';
    if (to === 'oz' && UNIT_DIM[from] === 'volume') to = 'floz-us';
    if (UNIT_DIM[from] !== UNIT_DIM[to]) continue;
    e.unitConv = { value: um[1] ? +um[1] : undefined, from, to, fromWord: um[2], toWord: um[3] };
    break;
  }

  // negation: "without blur" rules an action out; "without background" means remove it
  for (const m of text.matchAll(/(^| )(?:without|no|dont|not)( losing)? ([a-z]+)/g)) {
    const w = m[3];
    const obj = Object.entries(OBJECTS).find(([, ws]) => ws.includes(w))?.[0];
    if (obj && !m[2]) {
      e.objects.add(obj);
      e.actions.push('remove');
    } else {
      const act = Object.entries(ACTIONS).find(([, ws]) => ws.includes(w))?.[0];
      if (act) e.negated.add(act);
    }
  }
  const scan = text.replace(/(^| )(?:without|no|dont|not)( losing)? [a-z]+/g, ' ').trim();

  for (const [id, f] of Object.entries(FORMATS)) {
    let at = -1;
    for (const a of f.aliases) {
      const i = indexOf(text, a);
      if (i >= 0 && (at < 0 || i < at)) at = i;
    }
    if (at >= 0) e.formats.push({ id, kind: f.kind, at });
  }
  // "text" is a format only at either end of a conversion ("image to text", "text to speech"); "word" isn't one in "word counter"
  e.formats = e.formats.filter((f) => !(f.id === 'txt' && !/(to|into) (text|txt|notes|transcript)\b|^(text|txt) (to|into) /.test(text)));
  e.formats = e.formats.filter((f) => !(f.id === 'docx' && /(counter|count|how many|words)/.test(text)));
  // a unit conversion's words ("in", "m") aren't file formats
  if (e.unitConv) e.formats = [];
  e.formats.sort((a, b) => a.at - b.at);

  for (const [k, words] of Object.entries(KINDS) as [Kind, string[]][]) if (words.some((w) => has(text, w))) e.nounKinds.add(k);
  for (const k of e.nounKinds) e.kinds.add(k);
  for (const f of e.formats) e.kinds.add(f.kind);

  const acts: { a: string; at: number }[] = [];
  for (const [a, words] of Object.entries(ACTIONS)) {
    const at = Math.min(...words.map((w) => indexOf(scan, w)).filter((i) => i >= 0));
    if (Number.isFinite(at) && !e.negated.has(a)) acts.push({ a, at });
  }
  acts.sort((x, y) => x.at - y.at);
  e.actions = [...new Set([...e.actions, ...acts.map((x) => x.a)])];
  for (const [o, words] of Object.entries(OBJECTS)) if (words.some((w) => has(scan, w))) e.objects.add(o);
  for (const [p, def] of Object.entries(PLATFORMS)) if ((def.aliases ?? [p]).some((w) => has(text, w))) e.platforms.push(p);
  for (const [d, words] of Object.entries(DEVICES)) if (words.some((w) => has(text, w))) e.devices.push(d);

  // roles: what follows "to/into/as" is the target, what comes before it the source
  // "how to", "need to" aren't conversions
  const toAt = text.replace(/\b(how|want|need|have|has|going|way|trying|able|try|is) to\b/g, '$1 __').search(/(^| )(to|into|as)( |$)/);
  const after = (at: number) => toAt >= 0 && at > toAt;
  if (e.formats.length >= 2) {
    const src = e.formats.find((f) => !after(f.at)) ?? e.formats[0];
    const dst = e.formats.find((f) => f !== src && after(f.at)) ?? e.formats.find((f) => f !== src)!;
    [e.from, e.to] = [src.id, dst.id];
  } else if (e.formats.length === 1) {
    const f = e.formats[0];
    if (after(f.at)) e.to = f.id;
    else e.from = f.id;
  }
  // "a gif from a video", "pdf from photos": what follows "from" is the source, the format before it the target
  const fromAt = text.search(/(^| )from( |$)/);
  if (fromAt > 0 && toAt < 0) {
    const before = e.formats.filter((f) => f.at < fromAt);
    const afterFrom = e.formats.filter((f) => f.at > fromAt);
    const tail = text.slice(fromAt);
    const srcKind = (Object.entries(KINDS) as [Kind, string[]][]).find(([, ws]) => ws.some((w) => has(tail, w)))?.[0];
    if (before.length && (afterFrom.length || srcKind)) {
      e.to = before[0].id;
      e.from = afterFrom[0]?.id;
      if (!e.from && srcKind) e.nounKinds = new Set([srcKind]);
    }
  }
  // a kind noun after "to/into" is the target kind ("pdf into images", "photos to video")
  if (toAt >= 0 && !e.to) {
    const tail = text.slice(toAt);
    for (const [k, words] of Object.entries(KINDS) as [Kind, string[]][]) if (words.some((w) => has(tail, w)) && !(e.from && FORMATS[e.from].kind === k)) e.toKind ??= k;
  }
  return e;
}
