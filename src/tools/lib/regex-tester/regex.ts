/** every flag, in the order the toggles show them */
export const FLAGS = [
  { flag: 'g', name: 'global', info: 'find every match, not just the first' },
  { flag: 'i', name: 'ignore case', info: 'a matches A' },
  { flag: 'm', name: 'multiline', info: '^ and $ match at every line break' },
  { flag: 's', name: 'dot all', info: '. also matches line breaks' },
  { flag: 'u', name: 'unicode', info: 'full Unicode, \\p{…} classes, strict escapes' },
  { flag: 'v', name: 'unicode sets', info: 'u plus set operations in [ ] like [\\p{L}--[a-z]]' },
  { flag: 'y', name: 'sticky', info: 'each match must start right where the last one ended' },
  { flag: 'd', name: 'indices', info: 'record where each group starts and ends (always shown here)' },
] as const;

const ORDER = 'dgimsuvy';

/** adds or removes a flag, keeping the canonical order; u and v can't be combined */
export function toggleFlag(flags: string, flag: string) {
  const set = new Set(flags);
  if (set.has(flag)) set.delete(flag);
  else {
    set.add(flag);
    if (flag === 'u') set.delete('v');
    if (flag === 'v') set.delete('u');
  }
  return [...ORDER].filter((f) => set.has(f)).join('');
}

const HINTS: [RegExp, string][] = [
  [/unterminated group|missing \)|unterminated parenthe/i, 'A group is opened with ( but never closed. Add the matching ).'],
  [/unmatched '?\)'?|unbalanced parenthes|unmatched parenthes/i, 'There is a ) with no ( before it. To match a literal parenthesis, escape it as \\).'],
  [/nothing to repeat/i, 'A quantifier (*, +, ? or {n}) has nothing in front of it. To match the character itself, escape it, e.g. \\+ or \\*.'],
  [/unterminated character class|missing \]|unterminated class/i, 'A [ character class is never closed. Add the matching ].'],
  [/range out of order/i, 'A range like [z-a] runs backwards. Put the lower character first, e.g. [a-z].'],
  [/invalid capture group name|invalid group name/i, 'Group names must start with a letter, $ or _, like (?<year>\\d{4}).'],
  [/duplicate capture group name|duplicate (capture )?group/i, 'Two groups share a name. Give each named group its own name.'],
  [/invalid named (capture )?reference|invalid named reference/i, '\\k<name> points to a group name that doesn\'t exist in the pattern.'],
  [/lone quantifier brackets|incomplete quantifier|out of order in \{\}|numbers out of order/i, 'A {…} quantifier is malformed or its numbers are backwards, like {5,2}. With the u or v flag, escape a literal brace as \\{.'],
  [/invalid property name|invalid unicode property/i, '\\p{…} needs a real Unicode property, like \\p{L} or \\p{Script=Greek}, and the u or v flag.'],
  [/invalid( \w+)? escape/i,'With the u or v flag only meaningful escapes are allowed. Remove the extra backslash, or turn those flags off.'],
  [/invalid class set|invalid set operation|invalid character in (a )?(character )?class/i, 'The v flag treats some characters inside [ ] as operators. Escape ( ) [ ] { } / - | and doubled punctuation like && there.'],
  [/invalid (regexp )?group/i,'(? must be followed by :, =, !, <=, <! or <name>.'],
  [/invalid (regular expression )?flags?\b/i,'Your browser doesn\'t support one of these flags. The v flag needs a recent browser.'],
];

export type Compiled = { ok: true; regex: RegExp } | { ok: false; error: string; hint: string | null };

/** compiles with indices on, so every match can report where its groups are */
export function compile(pattern: string, flags: string): Compiled {
  try {
    return { ok: true, regex: new RegExp(pattern, flags.includes('d') ? flags : `d${flags}`) };
  } catch (e) {
    const message = String((e as Error).message ?? e);
    return { ok: false, error: cleanError(message), hint: HINTS.find(([re]) => re.test(message))?.[1] ?? null };
  }
}

/** drops the engine's "Invalid regular expression: /…/flags: " prefix, which repeats the pattern */
const cleanError = (message: string) => {
  const m = /^invalid regular expression: \/[\s\S]*\/[a-z]*: (.+)$/i.exec(message);
  const text = m?.[1] ?? message;
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export interface Group {
  n: number;
  name?: string;
  /** undefined when the group didn't take part in the match */
  value?: string;
  start?: number;
  end?: number;
}

export interface Match {
  start: number;
  end: number;
  value: string;
  groups: Group[];
}

export interface MatchResult {
  matches: Match[];
  /** all matches found, which can be more than were kept */
  total: number;
  /** counting stopped at the cap */
  capped: boolean;
}

/** names of capturing groups by number (index 0 unused), read straight from the pattern */
export function groupNames(pattern: string, unicodeSets = false): (string | undefined)[] {
  const names: (string | undefined)[] = [undefined];
  let depth = 0; // inside [ ]; only the v flag nests classes, elsewhere a [ inside one is literal
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') i++;
    else if (c === '[') depth = unicodeSets ? depth + 1 : 1;
    else if (c === ']' && depth) depth--;
    else if (c === '(' && !depth) {
      if (pattern[i + 1] !== '?') names.push(undefined);
      else if (pattern[i + 2] === '<' && pattern[i + 3] !== '=' && pattern[i + 3] !== '!') {
        const end = pattern.indexOf('>', i);
        names.push(end > 0 ? pattern.slice(i + 3, end) : undefined);
      }
    }
  }
  return names;
}

/** runs the pattern over the text, keeping the first `limit` matches */
export function findMatches(regex: RegExp, text: string, limit = 5000, cap = 100_000): MatchResult {
  const names = groupNames(regex.source, regex.unicodeSets);
  const matches: Match[] = [];
  const unicode = regex.unicode || regex.unicodeSets;
  let total = 0;
  regex.lastIndex = 0;
  for (;;) {
    const m = regex.exec(text);
    if (!m) break;
    total++;
    if (matches.length < limit) {
      const indices = m.indices!;
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        value: m[0],
        groups: m.slice(1).map((value, k) => ({ n: k + 1, name: names[k + 1], value, start: indices[k + 1]?.[0], end: indices[k + 1]?.[1] })),
      });
    }
    if (!regex.global || total >= cap) break;
    // step past an empty match, by a whole code point in unicode mode
    if (m[0] === '') regex.lastIndex += unicode && (text.codePointAt(regex.lastIndex) ?? 0) > 0xffff ? 2 : 1;
  }
  return { matches, total, capped: total >= cap && regex.global };
}

export interface Segment {
  text: string;
  /** index of the match this run belongs to */
  match?: number;
}

type Span = { start: number; end: number };

/**
 * moves matches found in `from` onto the edited text `to` while a fresh run is pending: matches clear of
 * the edited stretch shift with the text, ones touching it become null so the indices stay put
 */
export function rebaseMatches(from: string, to: string, matches: readonly Span[]): (Span | null)[] {
  if (from === to) return [...matches];
  const max = Math.min(from.length, to.length);
  let pre = 0;
  while (pre < max && from.charCodeAt(pre) === to.charCodeAt(pre)) pre++;
  let suf = 0;
  while (suf < max - pre && from.charCodeAt(from.length - 1 - suf) === to.charCodeAt(to.length - 1 - suf)) suf++;
  const tail = from.length - suf;
  const delta = to.length - from.length;
  return matches.map((m) => {
    if (m.end < pre || (m.end === pre && m.start < pre)) return m;
    if (m.start > tail || (m.start === tail && m.end > tail)) return { start: m.start + delta, end: m.end + delta };
    return null;
  });
}

/** splits the text into plain and matched runs for the highlight layer; empty matches become empty runs */
export function highlightSegments(text: string, matches: readonly (Span | null)[]): Segment[] {
  const out: Segment[] = [];
  let pos = 0;
  matches.forEach((m, i) => {
    if (!m) return;
    const start = Math.min(Math.max(m.start, pos), text.length);
    const end = Math.min(Math.max(m.end, start), text.length);
    if (start > pos) out.push({ text: text.slice(pos, start) });
    out.push({ text: text.slice(start, end), match: i });
    pos = end;
  });
  if (pos < text.length) out.push({ text: text.slice(pos) });
  return out;
}

/** splits a pasted JS literal like /ab+c/gi into pattern and flags, or null when it isn't one */
export function parseLiteral(text: string): { pattern: string; flags: string } | null {
  const m = /^\/([\s\S]+)\/([dgimsuvy]*)$/.exec(text.trim());
  if (!m) return null;
  const [, pattern = '', flags = ''] = m;
  if (new Set(flags).size !== flags.length || (flags.includes('u') && flags.includes('v'))) return null;
  // a bare / in the body (like /usr/local/) means it's a path, not a literal
  if (toLiteral(pattern, '') !== `/${pattern}/`) return null;
  return { pattern, flags: [...'dgimsuvy'].filter((f) => flags.includes(f)).join('') };
}

/** the pattern as a JavaScript regex literal */
export function toLiteral(pattern: string, flags: string) {
  if (!pattern) return `/(?:)/${flags}`;
  let out = '';
  let cls = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '\\') {
      out += c + (pattern[i + 1] ?? '');
      i++;
      continue;
    }
    if (c === '[') cls = true;
    else if (c === ']') cls = false;
    if (c === '/' && !cls) out += '\\/';
    else if (c === '\n') out += '\\n';
    else if (c === '\r') out += '\\r';
    else out += c;
  }
  return `/${out}/${flags}`;
}
