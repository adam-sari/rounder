// Pure text helpers shared by the writing tools: chunking, sentences, cleaning model output.

export interface Span {
  start: number;
  end: number;
}

/** Sentence spans (each keeps its trailing whitespace, so the spans tile the text) */
export function splitSentences(text: string): Span[] {
  const spans: Span[] = [];
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    for (const s of new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text)) spans.push({ start: s.index, end: s.index + s.segment.length });
  } else {
    for (const m of text.matchAll(/[^.!?…]+(?:[.!?…]+["'”’)\]]*)?\s*/g)) spans.push({ start: m.index, end: m.index + m[0].length });
  }
  return spans;
}

/** Splits `piece` into parts of at most `max` characters at the last space before the limit */
function hardSplit(piece: string, max: number): string[] {
  const out: string[] = [];
  let rest = piece;
  while (rest.length > max) {
    const cut = rest.lastIndexOf(' ', max - 1);
    const at = cut > max / 2 ? cut + 1 : max;
    out.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Splits text into pieces of at most `max` characters, breaking between paragraphs where it can,
 * then between sentences, then between words. Pieces keep their whitespace: join('') gives the text back.
 */
export function chunkText(text: string, max: number): string[] {
  const units: string[] = [];
  for (const para of text.split(/(?<=\n[^\S\n]*\n\s*)(?=\S)/)) {
    if (para.length <= max) units.push(para);
    else
      for (const s of splitSentences(para)) {
        const sentence = para.slice(s.start, s.end);
        units.push(...(sentence.length <= max ? [sentence] : hardSplit(sentence, max)));
      }
  }
  const chunks: string[] = [];
  let current = '';
  for (const unit of units) {
    if (current && current.length + unit.length > max) {
      chunks.push(current);
      current = '';
    }
    current += unit;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Puts the original's leading and trailing whitespace around a model's rewrite of it */
export function keepEdges(original: string, rewritten: string): string {
  const lead = original.match(/^\s*/)![0];
  const trail = original.slice(lead.length).match(/\s*$/)![0];
  return lead + rewritten.trim() + trail;
}

const WRAPPERS = [
  /^\s*(?:sure|okay|ok|certainly|of course)\b[^\n]{0,80}[.!:]\s*\n+/i,
  /^\s*here(?:'s| is| are)\b[^\n]{0,100}:[^\S\n]*\n*/i,
  /^\s*(?:\*\*)?(?:corrected text|corrected version|rewritten text|rewrite|paraphrased text|paraphrase|summary)(?:\*\*)?\s*:[^\S\n]*\n*/i,
];

/**
 * Strips what small models add around the answer: thinking blocks, "Here is the summary:" lines,
 * "Corrected text:" labels and the <<< >>> fences our prompts use. A wrapper the original text
 * itself starts with is kept.
 */
export function cleanOutput(raw: string, original = ''): string {
  const start = original.trimStart().slice(0, 60).toLowerCase();
  let text = raw.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '');
  for (const re of WRAPPERS) text = text.replace(re, (m) => (start && start.startsWith(m.trim().toLowerCase().slice(0, 12)) ? m : ''));
  return text.replace(/^\s*<<<\s*|\s*>>>\s*$/g, '').trim();
}

/** Lines of a numbered or bulleted list, without the markers, quotes or bold */
export function listItems(raw: string): string[] {
  return cleanOutput(raw)
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*(?:[-*•‣–]|\d+[.):])\s*/, '')
        .replace(/\*\*/g, '')
        .replace(/^["“'](.*)["”']$/, '$1')
        .trim(),
    )
    .filter(Boolean);
}

/** Up to three alternatives from a model's list, skipping repeats and the sentence itself */
export function parseAlternatives(raw: string, original: string): string[] {
  const seen = new Set([norm(original)]);
  const out: string[] = [];
  for (const item of listItems(raw)) {
    const key = norm(item);
    if (seen.has(key) || key.length < 2) continue;
    seen.add(key);
    out.push(item);
  }
  return out.slice(0, 3);
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
}
