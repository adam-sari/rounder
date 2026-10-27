/** Text extracted from the saved file somewhere other than page content */
export interface Place {
  /** e.g. "the document info" or "bookmarks" */
  where: string;
  text: string;
}

export interface VerifyResult {
  /** marked strings that are no longer on their page or anywhere else checked */
  confirmed: number;
  total: number;
  /** marked strings that can still be found, and where */
  leftovers: { text: string; pages: number[]; places: string[] }[];
  /** redacted pages that still have extractable text (should never happen) */
  textOnRedacted: number[];
}

/** case- and spacing-blind form, so "Jane  Doe" and "JANE DOE" count as the same text */
export const squash = (s: string) => s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();

/**
 * Checks a saved file for the text that was marked. `pages` is the saved
 * file's text, page by page; `marks` the strings found by search and the page
 * each was on. A string counts as removed when it's gone from its page and
 * from every extra place (metadata, bookmarks, comments).
 */
export function verifyRedaction(marks: { page: number; text: string }[], pages: string[], redacted: number[], extras: Place[] = []): VerifyResult {
  const pageText = pages.map(squash);
  const extraText = extras.map((p) => ({ ...p, text: squash(p.text) }));
  const seen = new Map<string, { text: string; pages: number[]; places: string[] }>();
  const lookup = (needle: string) => {
    let hit = seen.get(needle);
    if (!hit) {
      hit = {
        text: '',
        pages: pageText.flatMap((t, i) => (t.includes(needle) ? [i] : [])),
        places: [...new Set(extraText.filter((p) => p.text.includes(needle)).map((p) => p.where))],
      };
      seen.set(needle, hit);
    }
    return hit;
  };

  let confirmed = 0;
  let total = 0;
  const leftovers: VerifyResult['leftovers'] = [];
  for (const m of marks) {
    const needle = squash(m.text);
    if (!needle) continue;
    total++;
    const hit = lookup(needle);
    if (!hit.pages.includes(m.page) && !hit.places.length) confirmed++;
    if ((hit.pages.length || hit.places.length) && !hit.text) {
      hit.text = m.text.trim();
      leftovers.push(hit);
    }
  }
  return { confirmed, total, leftovers, textOnRedacted: redacted.filter((i) => pageText[i]) };
}
