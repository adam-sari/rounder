// Grammar quick checks without AI: instant, predictable, and tuned to avoid false alarms. The
// English-specific ones (a/an, word confusions, "i") only run on text that looks English.

export interface Issue {
  start: number;
  end: number;
  replacement: string;
  message: string;
  kind: 'repeat' | 'spacing' | 'punctuation' | 'article' | 'confusion' | 'spelling' | 'capital';
}

const WORD = String.raw`[\p{L}\p{N}][\p{L}\p{N}'’]*`;
/** doubled words that are often right: "had had", "that that" */
const DOUBLES_OK = new Set(['had', 'that', 'ha', 'bye', 'no', 'yeah', 'very', 'so', 'knock', 'tut', 'chop', 'pooh', 'cha', 'hush', 'boo']);

const ENGLISH = new Set('the an and or but is are was were of to in that it you your we he she they my for with this on not be have has as at by from will would can what which who'.split(' '));
export function looksEnglish(text: string): boolean {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < 3) return /^[\x00-\x7f]*$/.test(text);
  return words.filter((w) => ENGLISH.has(w)).length / words.length > 0.08;
}

/** "Teh" + "the" → "The" */
function matchCase(source: string, word: string) {
  if (source.length > 1 && source === source.toUpperCase()) return word.toUpperCase();
  return /^\p{Lu}/u.test(source) ? word[0].toUpperCase() + word.slice(1) : word;
}

// words where the letter misleads: "an hour", "a university", "a one-off"
const VOWEL_SOUND = /^(?:hour|honest|honou?r|heir)/i;
const CONSONANT_SOUND = /^(?:uni(?:on|que|t|vers|form|corn|son|lateral|cycl)|us(?:e|u|a)|ut(?:e|i|o)|ur(?:a|i|o)|eu|ewe|one(?![a-z])|once|ubiq|uku|ufo)/i;

/** "a" or "an" for a word, or null when it can't be told from spelling (numbers, acronyms, letters) */
export function articleFor(word: string): 'a' | 'an' | null {
  if (word.length < 2 || /\d/.test(word) || word === word.toUpperCase()) return null;
  if (VOWEL_SOUND.test(word)) return 'an';
  if (CONSONANT_SOUND.test(word)) return 'a';
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

const MISSPELLINGS: Record<string, string> = Object.fromEntries(
  (
    'definately definitely|seperate separate|recieve receive|occured occurred|untill until|wich which|teh the|beleive believe|accomodate accommodate|acheive achieve|adress address|wierd weird|tommorow tomorrow|tommorrow tomorrow|goverment government|enviroment environment|existance existence|independant independent|neccessary necessary|necessery necessary|occassion occasion|publically publicly|recomend recommend|reccomend recommend|succesful successful|truely truly|arguement argument|calender calendar|commited committed|concious conscious|embarass embarrass|foriegn foreign|freind friend|grammer grammar|harrass harass|millenium millennium|noticable noticeable|persue pursue|posession possession|priviledge privilege|refered referred|relevent relevant|rythm rhythm|sieze seize|supercede supersede|thier their|threshhold threshold|begining beginning|buisness business|busines business|catagory category|cemetary cemetery|collegue colleague|completly completely|curiousity curiosity|dissapoint disappoint|enterpreneur entrepreneur|finaly finally|guage gauge|happend happened|immediatly immediately|knowlege knowledge|liason liaison|lenght length|maintainance maintenance|mispell misspell|neice niece|occurence occurrence|peice piece|persistant persistent|prefered preferred|realy really|remeber remember|sucess success|suprise surprise|tounge tongue|useing using|writting writing|alot a lot|irregardless regardless|youre you’re|dont don’t|doesnt doesn’t|didnt didn’t|isnt isn’t|wasnt wasn’t|arent aren’t|werent weren’t|couldnt couldn’t|shouldnt shouldn’t|wouldnt wouldn’t|havent haven’t|hasnt hasn’t|thats that’s|theyre they’re|becuase because|beacuse because|ive I’ve'
  )
    .split('|')
    .map((pair) => pair.split(' ') as [string, string]),
);

/** [pattern, replacement, why]; patterns match whole words, case-insensitively */
const CONFUSIONS: [RegExp, string, string][] = [
  [/\b(could|should|would|must|might) of\b/giu, '$1 have', '“of” should be “have” here'],
  [/\b(more|less|better|worse|rather|other|bigger|smaller|faster|slower|greater|higher|lower|larger|older|younger|easier|harder) then\b/giu, '$1 than', 'comparisons use “than”'],
  [/\byour welcome\b/giu, 'you’re welcome', '“you’re” means “you are”'],
  [/\bit'?s own\b/giu, 'its own', '“its” (no apostrophe) is the possessive'],
  [/\bthere own\b/giu, 'their own', '“their” is the possessive'],
  [/\btheir (is|are|was|were)\b/giu, 'there $1', '“there is / there are”'],
  [/\bfor all intensive purposes\b/giu, 'for all intents and purposes', 'the phrase is “intents and purposes”'],
  [/\bcase and point\b/giu, 'case in point', 'the phrase is “case in point”'],
  [/\bone in the same\b/giu, 'one and the same', 'the phrase is “one and the same”'],
  [/\b(?<!not )suppose to\b/giu, 'supposed to', '“supposed to”'],
  [/\bloose (weight|track|sleep|interest)\b/giu, 'lose $1', '“lose” means to stop having; “loose” means not tight'],
  [/\bsneak peak\b/giu, 'sneak peek', 'a “peek” is a quick look'],
  [/\bfree reign\b/giu, 'free rein', 'the phrase is “free rein”'],
  [/\bbaited breath\b/giu, 'bated breath', 'the phrase is “bated breath”'],
  [/\bwreck havoc\b/giu, 'wreak havoc', 'the phrase is “wreak havoc”'],
  [/\bdeep seeded\b/giu, 'deep-seated', 'the phrase is “deep-seated”'],
  [/\beach others\b/giu, 'each other’s', '“each other’s” takes an apostrophe'],
  [/\bpeak (my|your|his|her|their|our) interest\b/giu, 'pique $1 interest', 'to “pique” interest is to arouse it'],
];

const NOT_NOUNS = new Set('and or of to is it in on at as if are an a the into onto'.split(' '));

/** abbreviations a lowercase word may follow: "e.g. this", "etc. and" */
const ABBREVIATIONS = new Set('etc vs mr mrs ms dr st approx no fig inc ltd jr sr cf al eg ie am pm min max'.split(' '));

export function quickCheck(text: string): Issue[] {
  const issues: Issue[] = [];
  const add = (start: number, end: number, replacement: string, message: string, kind: Issue['kind']) => issues.push({ start, end, replacement, message, kind });

  // the same word twice: "the the"
  for (const m of text.matchAll(new RegExp(String.raw`(?<![\p{L}\p{N}'’])(${WORD})(\s+)\1(?![\p{L}\p{N}'’])`, 'giu'))) {
    if (DOUBLES_OK.has(m[1].toLowerCase()) || m[2].includes('\n\n')) continue;
    add(m.index, m.index + m[0].length, m[1], `“${m[1]}” is repeated`, 'repeat');
  }
  // two or more spaces between words
  for (const m of text.matchAll(/(?<=\S) {2,}(?=\S)/g)) add(m.index, m.index + m[0].length, ' ', 'Extra spaces between words', 'spacing');
  // a space before a comma, period or semicolon
  for (const m of text.matchAll(/(?<=[\p{L}\p{N}]) +([,.;])(?=[\s"'”’)\]]|$)/gu)) add(m.index, m.index + m[0].length, m[1], `No space before “${m[1]}”`, 'punctuation');
  // no space after a comma ("one,two") or between sentences ("end.Next")
  for (const m of text.matchAll(/(?<=\p{L}),(?=\p{L})|(?<=\p{Ll}{2})\.(?=\p{Lu}\p{Ll})/gu)) add(m.index, m.index + 1, `${m[0]} `, `Add a space after “${m[0]}”`, 'punctuation');

  if (looksEnglish(text)) {
    for (const m of text.matchAll(/(?<![\p{L}\p{N}'’-])(a|an)(\s+)([\p{L}\p{N}][\p{L}\p{N}'’-]*)/giu)) {
      const want = articleFor(m[3]);
      // "part a and b" is a label, not an article
      if (!want || want === m[1].toLowerCase() || NOT_NOUNS.has(m[3].toLowerCase())) continue;
      add(m.index, m.index + m[1].length, matchCase(m[1], want), `Use “${want}” before “${m[3]}”`, 'article');
    }
    for (const [pattern, replacement, message] of CONFUSIONS)
      for (const m of text.matchAll(pattern)) add(m.index, m.index + m[0].length, matchCase(m[0], m[0].replace(new RegExp(pattern.source, 'iu'), replacement)), message, 'confusion');
    for (const m of text.matchAll(/(?<![\p{L}\p{N}'’-])\p{L}+(?![\p{L}\p{N}'’-])/gu)) {
      const fix = MISSPELLINGS[m[0].toLowerCase()];
      if (fix && m[0] !== m[0].toUpperCase()) add(m.index, m.index + m[0].length, /^[A-Z]/.test(fix) ? fix : matchCase(m[0], fix), `Did you mean “${fix}”?`, 'spelling');
    }
    // the pronoun "i" (not "i.e." or a list's "(i)")
    for (const m of text.matchAll(/(?<![\p{L}\p{N}'’.(-])i(?=(?:['’](?:m|ve|ll|d))?(?![\p{L}\p{N}.)]))/gu)) add(m.index, m.index + 1, 'I', 'The pronoun “I” is always capitalized', 'capital');
    // a sentence that starts lowercase after . ! or ?
    for (const m of text.matchAll(/(?<=[.!?])(\s+)(\p{Ll})/gu)) {
      // just the word before (a whole-text prefix would make long texts slow on every keystroke)
      const before = text.slice(Math.max(0, m.index - 40), m.index);
      const word = before.match(/([\p{L}.]*)[.!?]$/u)?.[1] ?? '';
      if (/\.\.$|…$/.test(before) || word.includes('.') || word.length < 2 || ABBREVIATIONS.has(word.toLowerCase().replace(/\./g, ''))) continue;
      const at = m.index + m[1].length;
      add(at, at + 1, m[2].toUpperCase(), 'Start the sentence with a capital letter', 'capital');
    }
  }
  return dropOverlaps(issues);
}

/** In text order, skipping any issue that overlaps an earlier one */
function dropOverlaps(issues: Issue[]): Issue[] {
  const out: Issue[] = [];
  for (const issue of issues.sort((a, b) => a.start - b.start || b.end - a.end)) {
    if (out.length && issue.start < out.at(-1)!.end) continue;
    out.push(issue);
  }
  return out;
}

/** The text with the given (non-overlapping) issues fixed */
export function applyFixes(text: string, issues: Issue[]): string {
  let out = text;
  for (const i of [...issues].sort((a, b) => b.start - a.start)) out = out.slice(0, i.start) + i.replacement + out.slice(i.end);
  return out;
}

/** A short excerpt around an issue for the list: before · the problem · after */
export function excerpt(text: string, issue: Issue, room = 28) {
  const from = Math.max(0, issue.start - room);
  const to = Math.min(text.length, issue.end + room);
  return {
    before: (from > 0 ? '…' : '') + text.slice(from, issue.start).replace(/\s+/g, ' ').trimStart(),
    target: text.slice(issue.start, issue.end),
    after: text.slice(issue.end, to).replace(/\s+/g, ' ').trimEnd() + (to < text.length ? '…' : ''),
  };
}
