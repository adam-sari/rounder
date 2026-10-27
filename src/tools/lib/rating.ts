// "Rate this tool": the rules both sides share. The prompt (src/components/tool/RatePrompt.svelte) builds the request
// with them, and the Worker (worker/) checks every request against them again.

export const COMMENT_MAX = 280;
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface RatingInput {
  slug: string;
  stars: number;
  comment: string;
}

/** trimmed and whitespace-collapsed, with control characters dropped */
export const cleanComment = (text: string) =>
  text
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** a request body, checked: a known-looking slug, 1–5 whole stars, an optional comment of at most COMMENT_MAX characters */
export function parseRating(body: unknown): { ok: true; value: RatingInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Expected a JSON object.' };
  const { slug, stars, comment = '' } = body as Record<string, unknown>;
  if (typeof slug !== 'string' || slug.length > 64 || !SLUG_RE.test(slug)) return { ok: false, error: 'Unknown tool.' };
  if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 5) {
    return { ok: false, error: 'Stars must be a whole number from 1 to 5.' };
  }
  if (typeof comment !== 'string') return { ok: false, error: 'The comment must be text.' };
  const text = cleanComment(comment);
  if ([...text].length > COMMENT_MAX) return { ok: false, error: `Keep the comment to ${COMMENT_MAX} characters.` };
  return { ok: true, value: { slug, stars, comment: text } };
}

// The prompt remembers, per tool and in this browser only, that it was answered or closed, so it never asks again.
export type PromptState = 'rated' | 'dismissed';
export const promptKey = (slug: string) => `rounder:rate:${slug}`;

/** localStorage can be missing or throw (private windows, blocked storage); then the prompt simply asks */
export function promptState(storage: Pick<Storage, 'getItem'> | undefined, slug: string): PromptState | null {
  try {
    const v = storage?.getItem(promptKey(slug));
    return v === 'rated' || v === 'dismissed' ? v : null;
  } catch {
    return null;
  }
}

export function rememberPrompt(storage: Pick<Storage, 'setItem'> | undefined, slug: string, state: PromptState) {
  try {
    storage?.setItem(promptKey(slug), state);
  } catch {
    // nothing to do: it may ask again next visit
  }
}
