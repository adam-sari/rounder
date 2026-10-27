/**
 * OCR languages: Tesseract's "fast" LSTM models (tessdata_fast, Apache-2.0), fetched once per
 * language from jsDelivr's GitHub mirror at a pinned commit (data only; the OCR engine itself is
 * self-hosted under /vendor/tesseract). Sizes are the uncompressed .traineddata files.
 */
export const TESSDATA = {
  repo: 'tesseract-ocr/tessdata_fast',
  revision: '87416418657359cb625c412a48b6e1d6d41c29bd',
  license: { name: 'Apache-2.0', url: 'https://github.com/tesseract-ocr/tessdata_fast/blob/main/LICENSE' },
} as const;

/** folder of the pinned .traineddata files (tesseract.js langPath) */
export const LANGUAGE_BASE = `https://cdn.jsdelivr.net/gh/${TESSDATA.repo}@${TESSDATA.revision}/`;

export interface OcrLanguage {
  /** Tesseract code, e.g. "chi_sim" */
  code: string;
  name: string;
  /** the language's own name, when it differs */
  native?: string;
  bytes: number;
  /** BCP 47 primary tags (or full tags) that pick this language by default */
  locales: string[];
}

export const LANGUAGES: OcrLanguage[] = [
  { code: 'eng', name: 'English', bytes: 4113088, locales: ['en'] },
  { code: 'spa', name: 'Spanish', native: 'Español', bytes: 2294433, locales: ['es'] },
  { code: 'fra', name: 'French', native: 'Français', bytes: 1130365, locales: ['fr'] },
  { code: 'deu', name: 'German', native: 'Deutsch', bytes: 1525436, locales: ['de'] },
  { code: 'ita', name: 'Italian', native: 'Italiano', bytes: 2701314, locales: ['it'] },
  { code: 'por', name: 'Portuguese', native: 'Português', bytes: 1982756, locales: ['pt'] },
  { code: 'nld', name: 'Dutch', native: 'Nederlands', bytes: 6050296, locales: ['nl'] },
  { code: 'pol', name: 'Polish', native: 'Polski', bytes: 4765518, locales: ['pl'] },
  { code: 'ces', name: 'Czech', native: 'Čeština', bytes: 3795684, locales: ['cs'] },
  { code: 'tur', name: 'Turkish', native: 'Türkçe', bytes: 4550554, locales: ['tr'] },
  { code: 'ell', name: 'Greek', native: 'Ελληνικά', bytes: 1419514, locales: ['el'] },
  { code: 'rus', name: 'Russian', native: 'Русский', bytes: 3861738, locales: ['ru'] },
  { code: 'ukr', name: 'Ukrainian', native: 'Українська', bytes: 3825102, locales: ['uk'] },
  { code: 'ara', name: 'Arabic', native: 'العربية', bytes: 1432056, locales: ['ar'] },
  { code: 'heb', name: 'Hebrew', native: 'עברית', bytes: 961404, locales: ['he', 'iw'] },
  { code: 'hin', name: 'Hindi', native: 'हिन्दी', bytes: 1122751, locales: ['hi'] },
  { code: 'ben', name: 'Bengali', native: 'বাংলা', bytes: 855841, locales: ['bn'] },
  { code: 'tha', name: 'Thai', native: 'ไทย', bytes: 1072600, locales: ['th'] },
  { code: 'vie', name: 'Vietnamese', native: 'Tiếng Việt', bytes: 531275, locales: ['vi'] },
  { code: 'ind', name: 'Indonesian', native: 'Bahasa Indonesia', bytes: 1122661, locales: ['id', 'in', 'ms'] },
  { code: 'chi_sim', name: 'Chinese (Simplified)', native: '简体中文', bytes: 2469156, locales: ['zh', 'zh-cn', 'zh-sg', 'zh-hans'] },
  { code: 'chi_tra', name: 'Chinese (Traditional)', native: '繁體中文', bytes: 2366642, locales: ['zh-tw', 'zh-hk', 'zh-mo', 'zh-hant'] },
  { code: 'jpn', name: 'Japanese', native: '日本語', bytes: 2471260, locales: ['ja'] },
  { code: 'kor', name: 'Korean', native: '한국어', bytes: 1677415, locales: ['ko'] },
];

const byCode = new Map(LANGUAGES.map((l) => [l.code, l]));

export const getLanguage = (code: string): OcrLanguage | undefined => byCode.get(code);
export const languageUrl = (code: string) => `${LANGUAGE_BASE}${code}.traineddata`;
export const languageBytes = (codes: readonly string[]) => codes.reduce((sum, c) => sum + (byCode.get(c)?.bytes ?? 0), 0);
/** "English + German" */
export const languageNames = (codes: readonly string[]) => codes.map((c) => byCode.get(c)?.name ?? c).join(' + ');

/** Keeps known codes, in list order, without repeats; English when nothing is left */
export function normalizeLanguages(codes: readonly string[]): string[] {
  const picked = LANGUAGES.filter((l) => codes.includes(l.code)).map((l) => l.code);
  return picked.length ? picked : ['eng'];
}

/** The language matching the visitor's browser languages ("de-AT" → deu, "zh-TW" → chi_tra), else English */
export function defaultLanguages(locales: readonly string[]): string[] {
  for (const raw of locales) {
    const tag = raw.toLowerCase();
    // the most specific match wins: "zh-hant-tw" is Traditional even though it starts with "zh"
    let best: { code: string; len: number } | null = null;
    for (const l of LANGUAGES)
      for (const loc of l.locales) if ((tag === loc || tag.startsWith(`${loc}-`)) && loc.length > (best?.len ?? 0)) best = { code: l.code, len: loc.length };
    if (best) return [best.code];
  }
  return ['eng'];
}
