/*
 * A small language guesser for browsers without the built-in LanguageDetector: the writing
 * system settles most languages, and for Latin-script text common short words (plus letters only
 * one language uses) decide. Good for a paragraph; a few words may stay undecided (null).
 */

const SCRIPTS: [RegExp, string][] = [
  [/\p{Script=Hangul}/gu, 'ko'],
  [/[\p{Script=Hiragana}\p{Script=Katakana}]/gu, 'ja'],
  [/\p{Script=Han}/gu, 'zh'],
  [/\p{Script=Arabic}/gu, 'ar'],
  [/\p{Script=Hebrew}/gu, 'he'],
  [/\p{Script=Devanagari}/gu, 'hi'],
  [/\p{Script=Bengali}/gu, 'bn'],
  [/\p{Script=Tamil}/gu, 'ta'],
  [/\p{Script=Telugu}/gu, 'te'],
  [/\p{Script=Kannada}/gu, 'kn'],
  [/\p{Script=Thai}/gu, 'th'],
  [/\p{Script=Greek}/gu, 'el'],
  [/\p{Script=Cyrillic}/gu, 'ru'],
  [/\p{Script=Latin}/gu, 'latin'],
];

const WORDS: Record<string, string> = {
  en: 'the and is are was were of to in that it you for with this have not be on at from they will would',
  es: 'el la los las de que y en es por para con una un del se no muy pero como está más',
  fr: 'le la les des est et un une du que pour dans pas qui sur avec ce je vous nous mais au',
  de: 'der die das und ist nicht ein eine zu mit den von sich auf für ich auch dem wir sie',
  it: 'il lo la che di è e un una per non sono con del della gli anche questo ma come',
  pt: 'o a os as de que e é não um uma para com do da em você muito mas se',
  nl: 'de het een en is van dat niet op te zijn met voor ik je ook maar er',
  pl: 'i w nie się na to jest że z do co jak ale tak już jestem mnie',
  tr: 've bir bu da de için ne ile çok var değil ben sen ama gibi daha olan',
  sv: 'och att det är som en på inte jag för med har den till av om',
  da: 'og at det er som en på ikke jeg for med har den til af om',
  fi: 'ja on ei se että hän oli ovat mutta kun tämä mitä joka myös',
  cs: 'a je se na že to v ve s jsem jako ale by pro jsou',
  ro: 'și este în că nu o cu pe la un care mai sunt pentru',
  id: 'dan yang di ini itu dengan untuk tidak dari ada akan saya',
  vi: 'và của là có không những được một trong cho các này người',
  hu: 'a az és hogy nem van egy is meg de csak már ez',
};
const STOP = Object.fromEntries(Object.entries(WORDS).map(([k, v]) => [k, new Set(v.split(' '))]));

/** letters only one of these languages uses */
const LETTERS: [RegExp, string][] = [
  [/[ñ¿¡]/g, 'es'],
  [/[ãõ]/g, 'pt'],
  [/ß/g, 'de'],
  [/[łąęśźżń]/g, 'pl'],
  [/[ğı]/g, 'tr'],
  [/[őű]/g, 'hu'],
  [/[ěřů]/g, 'cs'],
  [/[șț]/g, 'ro'],
  [/[ơưđ]/g, 'vi'],
  [/[æø]/g, 'da'],
];

export function guessLanguage(text: string): string | null {
  const sample = text.slice(0, 3000);
  let script = '';
  let most = 0;
  for (const [re, code] of SCRIPTS) {
    const n = sample.match(re)?.length ?? 0;
    // kana settles Japanese even when kanji outnumber it
    if (code === 'ja' && n > 0) return 'ja';
    if (n > most) [script, most] = [code, n];
  }
  if (most < 4) return null;
  if (script === 'ru') return /[іїєґ]/i.test(sample) ? 'uk' : !/[ыэё]/i.test(sample) && /ъ/i.test(sample) ? 'bg' : 'ru';
  if (script !== 'latin') return script;

  const lower = sample.toLowerCase();
  const score: Record<string, number> = {};
  for (const word of lower.match(/\p{L}+/gu) ?? []) {
    for (const lang in STOP) if (STOP[lang].has(word)) score[lang] = (score[lang] ?? 0) + 1;
  }
  for (const [re, lang] of LETTERS) score[lang] = (score[lang] ?? 0) + 3 * (lower.match(re)?.length ?? 0);
  const [first, second] = Object.entries(score).sort((a, b) => b[1] - a[1]);
  return first && first[1] >= 2 && first[1] > (second?.[1] ?? 0) ? first[0] : null;
}
