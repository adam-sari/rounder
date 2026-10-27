/**
 * Unicode "font" styles. None of these are real fonts: each maps plain letters to
 * look-alike characters (mostly from the Mathematical Alphanumeric Symbols block),
 * so the result survives being pasted anywhere that accepts text.
 */

export type Group = 'serif' | 'sans' | 'script' | 'shapes' | 'effects' | 'decor';

export interface FancyStyle {
  id: string;
  name: string;
  group: Group;
  apply: (text: string, opts: { seed: number; intensity: number }) => string;
}

type Table = Map<string, string>;

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';

const run = (chars: string, start: number, table: Table) =>
  [...chars].forEach((c, i) => table.set(c, String.fromCodePoint(start + i)));

/**
 * A math alphabet. Some letters existed in Unicode before the math block (ℎ, ℬ, ℭ…),
 * so the block leaves holes at those code points and the old characters must be used.
 */
function alphabet(upper: number, lower: number | null, digits: number | null, holes: Record<string, string> = {}): Table {
  const t: Table = new Map();
  run(UPPER, upper, t);
  if (lower !== null) run(LOWER, lower, t);
  if (digits !== null) run(DIGITS, digits, t);
  for (const [k, v] of Object.entries(holes)) t.set(k, v);
  return t;
}

function fromPairs(from: string, to: string): Table {
  const a = [...from];
  const b = [...to];
  if (a.length !== b.length) throw new Error('mapping length mismatch');
  return new Map(a.map((c, i) => [c, b[i]]));
}

export const tables = {
  bold: alphabet(0x1d400, 0x1d41a, 0x1d7ce),
  italic: alphabet(0x1d434, 0x1d44e, null, { h: 'ℎ' }),
  boldItalic: alphabet(0x1d468, 0x1d482, null),
  sans: alphabet(0x1d5a0, 0x1d5ba, 0x1d7e2),
  sansBold: alphabet(0x1d5d4, 0x1d5ee, 0x1d7ec),
  sansItalic: alphabet(0x1d608, 0x1d622, null),
  sansBoldItalic: alphabet(0x1d63c, 0x1d656, null),
  script: alphabet(0x1d49c, 0x1d4b6, null, {
    B: 'ℬ', E: 'ℰ', F: 'ℱ', H: 'ℋ', I: 'ℐ', L: 'ℒ', M: 'ℳ', R: 'ℛ', e: 'ℯ', g: 'ℊ', o: 'ℴ',
  }),
  boldScript: alphabet(0x1d4d0, 0x1d4ea, null),
  fraktur: alphabet(0x1d504, 0x1d51e, null, { C: 'ℭ', H: 'ℌ', I: 'ℑ', R: 'ℜ', Z: 'ℨ' }),
  boldFraktur: alphabet(0x1d56c, 0x1d586, null),
  doubleStruck: alphabet(0x1d538, 0x1d552, 0x1d7d8, { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' }),
  monospace: alphabet(0x1d670, 0x1d68a, 0x1d7f6),
  circled: (() => {
    const t = alphabet(0x24b6, 0x24d0, null);
    run('123456789', 0x2460, t);
    t.set('0', '⓪');
    return t;
  })(),
  // only capitals exist for the filled and squared sets, so lower case shares them
  circledBlack: (() => {
    const t = alphabet(0x1f150, 0x1f150, null);
    run('123456789', 0x2776, t);
    t.set('0', '⓿');
    return t;
  })(),
  squared: alphabet(0x1f130, 0x1f130, null),
  squaredBlack: alphabet(0x1f170, 0x1f170, null),
  parenthesized: (() => {
    const t = alphabet(0x249c, 0x249c, null);
    run('123456789', 0x2474, t);
    return t;
  })(),
  smallCaps: fromPairs(LOWER, 'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘꞯʀꜱᴛᴜᴠᴡxʏᴢ'),
  // C, F, Q, S, X, Y and Z have no superscript capital, so they borrow the small one;
  // there is no widely supported superscript q at all
  superscript: (() => {
    const t = fromPairs(LOWER + DIGITS + '+-=()', 'ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖqʳˢᵗᵘᵛʷˣʸᶻ⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾');
    for (const c of UPPER) t.set(c, t.get(c.toLowerCase())!);
    for (const [k, v] of fromPairs('ABDEGHIJKLMNOPRTUVW', 'ᴬᴮᴰᴱᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾᴿᵀᵁⱽᵂ')) t.set(k, v);
    return t;
  })(),
  upsideDown: fromPairs(
    LOWER + UPPER + DIGITS + `.,'"!?()[]{}<>&_;`,
    'ɐqɔpǝɟƃɥᴉɾʞlɯuodbɹsʇnʌʍxʎz' + '∀ꓭƆꓷƎℲ⅁HIſꓘ⅂WNOԀΌꓤS⊥∩ΛMX⅄Z' + '0ƖᄅƐㄣϛ9ㄥ86' + `˙',„¡¿)(][}{><⅋‾؛`,
  ),
};

export function mapChars(text: string, table: Table): string {
  let out = '';
  for (const c of text) out += table.get(c) ?? c;
  return out;
}

/** Fullwidth forms: printable ASCII shifts up to U+FF01…, spaces become ideographic spaces */
export function fullwidth(text: string): string {
  let out = '';
  for (const c of text) {
    const n = c.codePointAt(0)!;
    out += n === 0x20 ? '　' : n > 0x20 && n < 0x7f ? String.fromCodePoint(n + 0xfee0) : c;
  }
  return out;
}

let segmenter: Intl.Segmenter | undefined;

/** Splits text into visible characters, so emoji like 👍🏽 or 🇺🇸 and accented letters stay whole */
export function graphemes(text: string): string[] {
  // text without combining marks, emoji or other joiners splits much faster by code point
  if (!/[^\0-˿]/.test(text) || typeof Intl.Segmenter !== 'function') return text.match(/\r\n|[^]/gu) ?? [];
  segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

/** Puts a combining mark after every character except line breaks */
export function combine(text: string, mark: string): string {
  let out = '';
  for (const c of graphemes(text)) out += /[\r\n]/.test(c) ? c : c + mark;
  return out;
}

export function upsideDown(text: string): string {
  return graphemes(mapChars(text, tables.upsideDown)).reverse().join('');
}

/** Small, fast, seedable PRNG (mulberry32), so glitch text stays put while you type */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const marks = (...parts: (number | [number, number])[]) =>
  parts.flatMap((p) => (Array.isArray(p) ? Array.from({ length: p[1] - p[0] + 1 }, (_, i) => p[0] + i) : [p])).map((n) => String.fromCodePoint(n));
// combining marks that sit above, through and below a letter
const ZALGO_UP = marks([0x0300, 0x0314], [0x033d, 0x0344], 0x0346, [0x034a, 0x034c], [0x0350, 0x0352], 0x0357, 0x035b, [0x0363, 0x036f]);
const ZALGO_MID = marks([0x0334, 0x0338], 0x0315, 0x031b, 0x0358, [0x035c, 0x0362]);
const ZALGO_DOWN = marks([0x0316, 0x031a], [0x031c, 0x0333], [0x0339, 0x033c], 0x0345, [0x0347, 0x0349], 0x034d, 0x034e, [0x0353, 0x0356], 0x0359, 0x035a);

/** Glitch ("zalgo") text: stacks random combining marks above, through and below each letter. Intensity 1–10. */
export function zalgo(text: string, seed: number, intensity: number): string {
  const rand = rng(seed);
  const level = Math.min(10, Math.max(1, Math.round(intensity)));
  const pick = (set: string[], max: number) => {
    let s = '';
    const n = Math.floor(rand() * (max + 1));
    for (let i = 0; i < n; i++) s += set[Math.floor(rand() * set.length)];
    return s;
  };
  let out = '';
  for (const c of graphemes(text)) {
    out += c;
    if (/\s/.test(c)) continue;
    out += pick(ZALGO_UP, level) + pick(ZALGO_MID, Math.ceil(level / 4)) + pick(ZALGO_DOWN, level);
  }
  return out;
}

const table = (t: Table) => (s: string) => mapChars(s, t);
const wrap = (before: string, after: string) => (s: string) => (s ? `${before}${s}${after}` : s);

export const styles: FancyStyle[] = [
  { id: 'bold', name: 'Bold', group: 'serif', apply: table(tables.bold) },
  { id: 'italic', name: 'Italic', group: 'serif', apply: table(tables.italic) },
  { id: 'bold-italic', name: 'Bold italic', group: 'serif', apply: table(tables.boldItalic) },
  { id: 'sans', name: 'Sans', group: 'sans', apply: table(tables.sans) },
  { id: 'sans-bold', name: 'Sans bold', group: 'sans', apply: table(tables.sansBold) },
  { id: 'sans-italic', name: 'Sans italic', group: 'sans', apply: table(tables.sansItalic) },
  { id: 'sans-bold-italic', name: 'Sans bold italic', group: 'sans', apply: table(tables.sansBoldItalic) },
  { id: 'monospace', name: 'Monospace', group: 'sans', apply: table(tables.monospace) },
  { id: 'script', name: 'Script (cursive)', group: 'script', apply: table(tables.script) },
  { id: 'bold-script', name: 'Bold script', group: 'script', apply: table(tables.boldScript) },
  { id: 'fraktur', name: 'Fraktur (old English)', group: 'script', apply: table(tables.fraktur) },
  { id: 'bold-fraktur', name: 'Bold fraktur', group: 'script', apply: table(tables.boldFraktur) },
  { id: 'double-struck', name: 'Double-struck', group: 'script', apply: table(tables.doubleStruck) },
  { id: 'small-caps', name: 'Small caps', group: 'script', apply: table(tables.smallCaps) },
  { id: 'superscript', name: 'Superscript (tiny)', group: 'script', apply: table(tables.superscript) },
  { id: 'bubble', name: 'Bubble', group: 'shapes', apply: table(tables.circled) },
  { id: 'bubble-black', name: 'Black bubble', group: 'shapes', apply: table(tables.circledBlack) },
  { id: 'squared', name: 'Squared', group: 'shapes', apply: table(tables.squared) },
  { id: 'squared-black', name: 'Black squared', group: 'shapes', apply: table(tables.squaredBlack) },
  { id: 'parenthesized', name: 'Parenthesized', group: 'shapes', apply: table(tables.parenthesized) },
  { id: 'wide', name: 'Wide (fullwidth)', group: 'shapes', apply: fullwidth },
  { id: 'upside-down', name: 'Upside down', group: 'effects', apply: upsideDown },
  { id: 'strike', name: 'Strikethrough', group: 'effects', apply: (s) => combine(s, '̶') },
  { id: 'underline', name: 'Underline', group: 'effects', apply: (s) => combine(s, '̲') },
  { id: 'double-underline', name: 'Double underline', group: 'effects', apply: (s) => combine(s, '̳') },
  { id: 'slash', name: 'Slashed', group: 'effects', apply: (s) => combine(s, '̸') },
  { id: 'spaced', name: 'Spaced out', group: 'effects', apply: (s) => graphemes(s).join(' ').replace(/ ?(\r\n|\n|\r) ?/g, '$1') },
  { id: 'glitch', name: 'Glitch (zalgo)', group: 'effects', apply: (s, o) => zalgo(s, o.seed, o.intensity) },
  { id: 'sparkles', name: 'Sparkles', group: 'decor', apply: wrap('✨ ', ' ✨') },
  { id: 'stars', name: 'Shooting stars', group: 'decor', apply: wrap('★彡 ', ' 彡★') },
  { id: 'wings', name: 'Wings', group: 'decor', apply: wrap('꧁ ', ' ꧂') },
  { id: 'hearts', name: 'Hearts', group: 'decor', apply: wrap('♡ ', ' ♡') },
  { id: 'brackets', name: 'Lenticular brackets', group: 'decor', apply: wrap('【', '】') },
  { id: 'arrows', name: 'Arrows', group: 'decor', apply: wrap('➳ ', ' ➳') },
];
