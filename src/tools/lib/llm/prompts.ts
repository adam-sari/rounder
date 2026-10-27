// Prompts for the writing tools. Written for a small model: the text first, the instruction last,
// one job per request, and a reply that is the result only.
import type { GenerateRequest } from './engine';

type Prompt = Pick<GenerateRequest, 'system' | 'prompt' | 'maxTokens' | 'temperature'>;

/** rough token count for sizing replies (≈3.5 characters a token across languages) */
const tokens = (chars: number) => Math.ceil(chars / 3.5);
const fence = (text: string) => `Text:\n<<<\n${text.trim()}\n>>>`;
const SAME_LANGUAGE = 'Write in the same language as the text.';

// ── summaries ──────────────────────────────────────────────────────────────────────────────

export type SummaryFormat = 'paragraph' | 'points' | 'tldr' | 'headline';
export type SummaryLength = 'short' | 'medium' | 'long';
/** what to write: the visitor's choice, or 'notes' for the condensing pass over long texts */
export type SummarySpec = { format: SummaryFormat; length: SummaryLength } | { format: 'notes' };

const POINTS = { short: 3, medium: 5, long: 8 };
const PARAGRAPH = {
  short: ['Write one paragraph of 2 to 3 sentences.', 180],
  medium: ['Write one paragraph of 4 to 6 sentences.', 320],
  long: ['Write 2 or 3 paragraphs, about 150 to 250 words in all, covering every main point.', 600],
} as const;

export function summaryPrompt(spec: SummarySpec, text: string): Prompt {
  const [task, maxTokens] =
    spec.format === 'notes'
      ? ['List the key facts, names, numbers and conclusions of this part as up to 8 short bullet points, each on its own line starting with "- ".', 420]
      : spec.format === 'points'
        ? [`Summarize the text as a bulleted list of its ${POINTS[spec.length]} most important points, each on its own line starting with "- ".`, 90 * POINTS[spec.length]]
        : spec.format === 'tldr'
          ? ['Summarize the whole text in one sentence (a TL;DR).', 90]
          : spec.format === 'headline'
            ? ['Write one short headline for the text, at most 12 words, without quotes.', 40]
            : [`Summarize the text. ${PARAGRAPH[spec.length][0]}`, PARAGRAPH[spec.length][1]];
  return {
    system: `You summarize text accurately. Use only what the text says: never add facts, opinions or advice. ${SAME_LANGUAGE} Reply with the summary only, with no title, introduction or closing remark.`,
    prompt: `${fence(text)}\n\n${task}`,
    maxTokens,
    temperature: 0.3,
  };
}

/** Tidies a finished (or streaming) summary for display and copying */
export function formatSummary(text: string, format: SummaryFormat | 'notes'): string {
  if (format === 'points' || format === 'notes') {
    return text
      .split('\n')
      .map((l) => l.replace(/\*\*/g, '').trim())
      .filter(Boolean)
      .map((l) => `- ${l.replace(/^(?:[-*•‣–]|\d+[.)])\s*/, '')}`)
      .join('\n');
  }
  const plain = text.replace(/\*\*/g, '').replace(/^\s*(?:#+\s*|tl;dr[:\s-]*)/i, '');
  if (format === 'headline') return plain.split('\n')[0].replace(/^["“'‘]|["”'’]$/g, '').replace(/\.$/, '').trim();
  return plain.replace(/\n{3,}/g, '\n\n').trim();
}

// ── paraphrasing ───────────────────────────────────────────────────────────────────────────

export const MODES = {
  standard: { label: 'Standard', hint: 'new words, same meaning', task: 'Rewrite the text in different words. Keep the meaning and about the same length.', factor: 1.3, style: 'clear, natural' },
  fluent: { label: 'Fluent', hint: 'smooth and natural', task: 'Rewrite the text so it reads smoothly and naturally, fixing awkward phrasing.', factor: 1.3, style: 'smooth, natural' },
  formal: { label: 'Formal', hint: 'professional tone', task: 'Rewrite the text in a formal, professional tone.', factor: 1.4, style: 'formal, professional' },
  casual: { label: 'Casual', hint: 'relaxed and friendly', task: 'Rewrite the text in a relaxed, friendly, conversational tone.', factor: 1.3, style: 'casual, friendly' },
  shorter: { label: 'Shorter', hint: 'about half the length', task: 'Rewrite the text more concisely, at about half the length, keeping every key point.', factor: 0.9, style: 'concise' },
  longer: { label: 'Longer', hint: 'more detail', task: 'Rewrite the text at about one and a half times the length, explaining it more fully without inventing facts.', factor: 2.2, style: 'more detailed' },
  simpler: { label: 'Simpler', hint: 'plain, easy words', task: 'Rewrite the text in plain, simple words that a 12-year-old understands, using short sentences.', factor: 1.4, style: 'simple, plain' },
} as const;
export type Mode = keyof typeof MODES;

const REWRITER = `You rewrite text. Keep the meaning and every fact, name and number. ${SAME_LANGUAGE} Reply with the rewritten text only: no quotes, notes or introduction.`;

export function paraphrasePrompt(mode: Mode, text: string): Prompt {
  return { system: REWRITER, prompt: `${fence(text)}\n\n${MODES[mode].task}`, maxTokens: tokens(text.length * MODES[mode].factor) + 64, temperature: 0.7 };
}

export function alternativesPrompt(mode: Mode, sentence: string): Prompt {
  return {
    system: REWRITER,
    prompt: `Sentence:\n<<<\n${sentence.trim()}\n>>>\n\nWrite 3 different ${MODES[mode].style} ways to say this sentence. Put each on its own line, numbered 1. to 3.`,
    maxTokens: tokens(sentence.length * 3 * MODES[mode].factor) + 48,
    temperature: 0.9,
  };
}

// ── proofreading ───────────────────────────────────────────────────────────────────────────

export function proofreadPrompt(text: string): Prompt {
  return {
    system: `You are a careful proofreader. Fix spelling, grammar, punctuation and capitalization mistakes. Do not change the meaning, the tone, words that are already correct, line breaks or formatting. ${SAME_LANGUAGE} If there are no mistakes, return the text unchanged. Reply with the corrected text only: no explanations, notes or quotes.`,
    prompt: `${fence(text)}\n\nReturn the corrected text.`,
    maxTokens: tokens(text.length * 1.2) + 64,
    temperature: 0,
  };
}
