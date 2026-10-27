/** The languages Whisper knows, by the codes transformers.js accepts (Whisper's own order, by training data) */
export const WHISPER_LANGUAGES = [
  'en', 'zh', 'de', 'es', 'ru', 'ko', 'fr', 'ja', 'pt', 'tr', 'pl', 'ca', 'nl', 'ar', 'sv', 'it', 'id', 'hi', 'fi', 'vi',
  'he', 'uk', 'el', 'ms', 'cs', 'ro', 'da', 'hu', 'ta', 'no', 'th', 'ur', 'hr', 'bg', 'lt', 'la', 'mi', 'ml', 'cy', 'sk',
  'te', 'fa', 'lv', 'bn', 'sr', 'az', 'sl', 'kn', 'et', 'mk', 'br', 'eu', 'is', 'hy', 'ne', 'mn', 'bs', 'kk', 'sq', 'sw',
  'gl', 'mr', 'pa', 'si', 'km', 'sn', 'yo', 'so', 'af', 'oc', 'ka', 'be', 'tg', 'sd', 'gu', 'am', 'yi', 'lo', 'uz', 'fo',
  'ht', 'ps', 'tk', 'nn', 'mt', 'sa', 'lb', 'my', 'bo', 'tl', 'mg', 'as', 'tt', 'haw', 'ln', 'ha', 'ba', 'jw', 'su',
] as const;

export type WhisperLanguage = (typeof WHISPER_LANGUAGES)[number];
/** 'auto' asks the model to detect the language from the first half minute of speech */
export type LanguageChoice = WhisperLanguage | 'auto';

const known = new Set<string>(WHISPER_LANGUAGES);
/** Large-v3 can answer with Cantonese ('yue'), which transformers.js doesn't accept as a language; Chinese is the closest it does */
export const toWhisperLanguage = (code: string): WhisperLanguage => (known.has(code) ? (code as WhisperLanguage) : code === 'yue' ? 'zh' : 'en');

// browsers ship trimmed language data, so a few of Whisper's rarer languages come back as bare codes
const FALLBACK: Record<string, string> = {
  as: 'Assamese', ba: 'Bashkir', bo: 'Tibetan', br: 'Breton', fo: 'Faroese', haw: 'Hawaiian', ht: 'Haitian Creole',
  jw: 'Javanese', lb: 'Luxembourgish', ln: 'Lingala', mg: 'Malagasy', mt: 'Maltese', my: 'Burmese', nn: 'Norwegian Nynorsk',
  oc: 'Occitan', ps: 'Pashto', sa: 'Sanskrit', sn: 'Shona', so: 'Somali', su: 'Sundanese', tk: 'Turkmen', tt: 'Tatar',
  yi: 'Yiddish', yo: 'Yoruba',
};

let names: Intl.DisplayNames | null = null;
/** "es" → "Spanish" (Whisper's "jw" is ISO "jv") */
export function languageName(code: string): string {
  try {
    names ??= new Intl.DisplayNames(['en'], { type: 'language' });
    const name = names.of(code === 'jw' ? 'jv' : code);
    return name && name !== code && name !== 'jv' ? name : (FALLBACK[code] ?? code);
  } catch {
    return FALLBACK[code] ?? code;
  }
}

/** every language, A to Z by English name, for the picker */
export const languageOptions = () => WHISPER_LANGUAGES.map((code) => ({ code, name: languageName(code) })).sort((a, b) => a.name.localeCompare(b.name));
