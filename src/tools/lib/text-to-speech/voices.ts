/** Kokoro's English voices (kokoro-js VOICES), best first within each group; grades are the model card's */
export const VOICES = [
  { id: 'af_heart', name: 'Heart', accent: 'US', gender: 'female', grade: 'A' },
  { id: 'af_bella', name: 'Bella', accent: 'US', gender: 'female', grade: 'A-' },
  { id: 'af_nicole', name: 'Nicole', accent: 'US', gender: 'female', grade: 'B-' },
  { id: 'af_aoede', name: 'Aoede', accent: 'US', gender: 'female', grade: 'C+' },
  { id: 'af_kore', name: 'Kore', accent: 'US', gender: 'female', grade: 'C+' },
  { id: 'af_sarah', name: 'Sarah', accent: 'US', gender: 'female', grade: 'C+' },
  { id: 'af_alloy', name: 'Alloy', accent: 'US', gender: 'female', grade: 'C' },
  { id: 'af_nova', name: 'Nova', accent: 'US', gender: 'female', grade: 'C' },
  { id: 'af_sky', name: 'Sky', accent: 'US', gender: 'female', grade: 'C-' },
  { id: 'af_jessica', name: 'Jessica', accent: 'US', gender: 'female', grade: 'D' },
  { id: 'af_river', name: 'River', accent: 'US', gender: 'female', grade: 'D' },
  { id: 'am_fenrir', name: 'Fenrir', accent: 'US', gender: 'male', grade: 'C+' },
  { id: 'am_michael', name: 'Michael', accent: 'US', gender: 'male', grade: 'C+' },
  { id: 'am_puck', name: 'Puck', accent: 'US', gender: 'male', grade: 'C+' },
  { id: 'am_echo', name: 'Echo', accent: 'US', gender: 'male', grade: 'D' },
  { id: 'am_eric', name: 'Eric', accent: 'US', gender: 'male', grade: 'D' },
  { id: 'am_liam', name: 'Liam', accent: 'US', gender: 'male', grade: 'D' },
  { id: 'am_onyx', name: 'Onyx', accent: 'US', gender: 'male', grade: 'D' },
  { id: 'am_santa', name: 'Santa', accent: 'US', gender: 'male', grade: 'D-' },
  { id: 'am_adam', name: 'Adam', accent: 'US', gender: 'male', grade: 'F+' },
  { id: 'bf_emma', name: 'Emma', accent: 'UK', gender: 'female', grade: 'B-' },
  { id: 'bf_isabella', name: 'Isabella', accent: 'UK', gender: 'female', grade: 'C' },
  { id: 'bf_alice', name: 'Alice', accent: 'UK', gender: 'female', grade: 'D' },
  { id: 'bf_lily', name: 'Lily', accent: 'UK', gender: 'female', grade: 'D' },
  { id: 'bm_fable', name: 'Fable', accent: 'UK', gender: 'male', grade: 'C' },
  { id: 'bm_george', name: 'George', accent: 'UK', gender: 'male', grade: 'C' },
  { id: 'bm_lewis', name: 'Lewis', accent: 'UK', gender: 'male', grade: 'D+' },
  { id: 'bm_daniel', name: 'Daniel', accent: 'UK', gender: 'male', grade: 'D' },
] as const;

export type Voice = (typeof VOICES)[number];
export type VoiceId = Voice['id'];

export const DEFAULT_VOICE: VoiceId = 'af_heart';
export const voiceById = (id: string): Voice | undefined => VOICES.find((v) => v.id === id);
/** the clearest voices, worth a badge */
export const isTopPick = (v: Voice) => v.grade.startsWith('A') || v.grade.startsWith('B');

export const MIN_SPEED = 0.5;
export const MAX_SPEED = 2;

/** what a voice says when previewed: the reader's own first sentence when there is one */
export function previewLine(voice: Voice, firstSentence = ''): string {
  return firstSentence && firstSentence.length <= 160 ? firstSentence : `Hi, I'm ${voice.name}. This is how I sound reading your text out loud.`;
}

// ── remembered choices (per browser, best effort) ──

const PREFS = 'rounder:tts';

export interface Prefs {
  voice: VoiceId;
  speed: number;
  mode: 'ai' | 'basic';
  /** voiceURI of the browser voice in basic mode */
  basicVoice: string;
}

export function loadPrefs(): Partial<Prefs> {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Partial<Prefs>;
    return {
      ...p,
      voice: p.voice && voiceById(p.voice) ? p.voice : undefined,
      speed: typeof p.speed === 'number' && p.speed >= MIN_SPEED && p.speed <= MAX_SPEED ? p.speed : undefined,
    };
  } catch {
    return {};
  }
}

export function savePrefs(p: Partial<Prefs>): void {
  try {
    localStorage.setItem(PREFS, JSON.stringify({ ...loadPrefs(), ...p }));
  } catch {
    // private mode or storage blocked: choices just aren't remembered
  }
}
