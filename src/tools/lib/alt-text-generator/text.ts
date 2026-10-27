/** What the visitor asks for, mapped to a Florence-2 task prompt and a generation budget */
export type Mode = 'alt' | 'detailed' | 'long' | 'ocr';

export const MODES: Record<Mode, { label: string; task: string; maxTokens: number; hint: string; column: string }> = {
  alt: { label: 'Alt text', task: '<CAPTION>', maxTokens: 64, hint: 'One short sentence for the alt attribute. Aim for under 125 characters.', column: 'alt' },
  detailed: { label: 'Detailed', task: '<DETAILED_CAPTION>', maxTokens: 160, hint: 'Two or three sentences, for figure captions, product listings or richer alt text.', column: 'description' },
  long: { label: 'Long description', task: '<MORE_DETAILED_CAPTION>', maxTokens: 320, hint: 'A full paragraph, for long descriptions of charts, art or complex scenes.', column: 'description' },
  ocr: { label: 'Text in image', task: '<OCR>', maxTokens: 512, hint: 'Reads printed English text in the picture. For scans and documents, Image to text is more accurate.', column: 'text' },
};

/** screen readers read any length, but most style guides cap alt text around here */
export const ALT_LIMIT = 125;

// "The image shows", "In this image we can see", "A photo of"… say nothing a screen reader doesn't already announce
const LEAD_IN =
  /^(?:in (?:this|the) (?:image|picture|photo(?:graph)?),?\s*(?:we|i|you) can see\s*|in (?:this|the) (?:image|picture|photo(?:graph)?),?\s*|(?:the|this) (?:image|picture|photo(?:graph)?) (?:shows|depicts|features|contains|is of)\s*|(?:an? )?(?:image|picture|photo(?:graph)?) of\s*)/i;

// split only where punctuation meets a space, so "a 3.5 inch screen" stays whole
const sentences = (text: string) => text.split(/(?<=[.!?]["')\]]*)\s+/).map((s) => s.trim()).filter(Boolean);

/** Cleans a raw caption: whitespace, filler lead-ins, repeated sentences, capital letter and full stop */
export function tidy(raw: string, mode: Mode): string {
  const text = raw.replace(/<\/?(?:s|pad)>/g, '').replace(/\s+/g, ' ').trim();
  if (mode === 'ocr' || !text) return text;
  const seen = new Set<string>();
  const kept = sentences(text.replace(LEAD_IN, '')).filter((s) => {
    const key = s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  let out = kept.join(' ');
  out = out.charAt(0).toUpperCase() + out.slice(1);
  return out && !/[.!?]["')\]]*$/.test(out) ? `${out}.` : out;
}

/** Keeps whole sentences that fit in `max` characters; a single long sentence is left whole rather than cut mid-thought */
export function shorten(text: string, max = ALT_LIMIT): string {
  if (text.length <= max) return text;
  const parts = sentences(text);
  let out = parts[0] ?? text;
  for (const s of parts.slice(1)) {
    if (out.length + 1 + s.length > max) break;
    out += ` ${s}`;
  }
  return out;
}

/** The caption a mode shows first: tidied, and trimmed to the alt-text budget for 'alt' */
export function finish(raw: string, mode: Mode): string {
  const text = tidy(raw, mode);
  return mode === 'alt' ? shorten(text) : text;
}

const csvCell = (v: string) => (/[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** RFC 4180 CSV with a BOM so Excel reads accents and emoji correctly */
export function toCsv(header: string[], rows: string[][]): string {
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const attr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** An <img> tag with the alt filled in, ready to paste into HTML */
export function imgTag(src: string, alt: string): string {
  return `<img src="${attr(src)}" alt="${attr(alt)}">`;
}
