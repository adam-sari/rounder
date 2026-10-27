// The three jobs on top of an engine: summarize (map-reduce for long texts), paraphrase, proofread.
import { isTooLong, type Llm, type SummarizerRequest } from './engine';
import { formatSummary, paraphrasePrompt, proofreadPrompt, summaryPrompt, type Mode, type SummaryFormat, type SummaryLength, type SummarySpec } from './prompts';
import { chunkText, cleanOutput, keepEdges } from './text';

export interface Stage {
  part: number;
  parts: number;
}

export interface RunOptions {
  /** the whole result so far, as it streams */
  onText?: (soFar: string) => void;
  /** which part of a long text is being worked on; null once on the last step */
  onStage?: (stage: Stage | null) => void;
  signal?: AbortSignal;
}

/** small models rewrite and proofread best a few paragraphs at a time */
const REWRITE_CHARS = 1500;

// ── summarize ──────────────────────────────────────────────────────────────────────────────

/** Chrome's Summarizer settings for a spec (its lengths: tldr 1/3/5 sentences, key points 3/5/7) */
export function builtinSummary(spec: SummarySpec): Pick<SummarizerRequest, 'type' | 'length' | 'format'> {
  if (spec.format === 'notes') return { type: 'key-points', length: 'long', format: 'markdown' };
  if (spec.format === 'points') return { type: 'key-points', length: spec.length, format: 'markdown' };
  if (spec.format === 'tldr') return { type: 'tldr', length: 'short', format: 'plain-text' };
  if (spec.format === 'headline') return { type: 'headline', length: 'medium', format: 'plain-text' };
  return { type: 'tldr', length: spec.length === 'short' ? 'medium' : 'long', format: 'plain-text' };
}

async function summarizeOnce(llm: Llm, text: string, spec: SummarySpec, lang: string | undefined, o: RunOptions): Promise<string> {
  const tidy = (t: string) => formatSummary(cleanOutput(t), spec.format);
  const show = (t: string) => o.onText?.(tidy(t));
  if (llm.summarize) {
    // the built-in summarizer tops out at 5 sentences, so a long paragraph summary gets one per half
    const long = spec.format === 'paragraph' && spec.length === 'long' && text.length > 3000;
    let done = '';
    for (const part of long ? chunkText(text, Math.ceil(text.length / 2) + 400) : [text]) {
      const lead = done ? `${done}\n\n` : '';
      done = lead + (await llm.summarize(part, { ...builtinSummary(spec), lang, signal: o.signal, onText: (t) => show(lead + t) })).trim();
    }
    return tidy(done);
  }
  if (!llm.generate) throw new Error('This engine cannot summarize');
  return tidy(await llm.generate({ ...summaryPrompt(spec, text), lang, signal: o.signal, onText: show }));
}

/**
 * Summarizes text of any length: parts that don't fit one request are condensed into notes first
 * (map), then the notes are summarized in the chosen format (reduce). Retries with smaller parts
 * when the built-in model says the input is too long.
 */
export async function summarizeText(llm: Llm, text: string, choice: { format: SummaryFormat; length: SummaryLength }, o: RunOptions = {}): Promise<string> {
  const lang = await llm.language(text);
  for (let budget = llm.maxChars; ; budget = Math.floor(budget / 2)) {
    try {
      let source = text;
      while (source.length > budget) {
        const parts = chunkText(source, budget);
        const notes: string[] = [];
        for (const [i, part] of parts.entries()) {
          o.onStage?.({ part: i + 1, parts: parts.length });
          notes.push(await summarizeOnce(llm, part, { format: 'notes' }, lang, { signal: o.signal }));
        }
        const condensed = notes.join('\n');
        if (condensed.length >= source.length) break;
        source = condensed;
      }
      o.onStage?.(null);
      return await summarizeOnce(llm, source, choice, lang, o);
    } catch (err) {
      if (!isTooLong(err) || budget < 1500) throw err;
    }
  }
}

// ── rewrite (paraphrase, proofread) ────────────────────────────────────────────────────────

/** Rewrites text a part at a time, keeping each part's surrounding whitespace, streaming the whole */
export async function rewriteInParts(text: string, maxChars: number, rewrite: (part: string, onText: (soFar: string) => void) => Promise<string>, o: RunOptions = {}): Promise<string> {
  const parts = chunkText(text, maxChars);
  let done = '';
  for (const [i, part] of parts.entries()) {
    if (!part.trim()) {
      done += part;
      continue;
    }
    o.onStage?.(parts.length > 1 ? { part: i + 1, parts: parts.length } : null);
    const fix = (t: string) => keepEdges(part, cleanOutput(t, part) || part);
    done += fix(await rewrite(part, (t) => o.onText?.(done + fix(t))));
    o.onText?.(done);
  }
  o.onStage?.(null);
  return done;
}

export async function paraphraseText(llm: Llm, text: string, mode: Mode, o: RunOptions = {}): Promise<string> {
  if (!llm.generate) throw new Error('This engine cannot rewrite');
  const lang = await llm.language(text);
  return rewriteInParts(text, Math.min(llm.maxChars, REWRITE_CHARS), (part, onText) => llm.generate!({ ...paraphrasePrompt(mode, part), lang, signal: o.signal, onText }), o);
}

export async function proofreadText(llm: Llm, text: string, o: RunOptions = {}): Promise<string> {
  const lang = await llm.language(text);
  const { proofread, generate } = llm;
  // Chrome's Proofreader reads English only; other languages go to the Prompt API when there is one
  if (proofread && (!generate || !lang || lang === 'en')) return rewriteInParts(text, Math.min(llm.maxChars, 4000), (part) => proofread(part, { lang, signal: o.signal }), o);
  if (!generate) throw new Error('This engine cannot proofread');
  return rewriteInParts(text, Math.min(llm.maxChars, REWRITE_CHARS), (part, onText) => generate({ ...proofreadPrompt(part), lang, signal: o.signal, onText }), o);
}
