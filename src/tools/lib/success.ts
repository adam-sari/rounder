// "A tool run worked": islands call toolSucceeded() once the visitor has a usable result (a download is ready, the
// result was copied…), at most once per run and never for errors. ToolHost wraps the tool in an element carrying the
// page's slug, and the event bubbles from it to window, where page-level islands (the rating prompt) listen with
// onToolSuccess. Listeners must never hold up or gate the result.

export const TOOL_SUCCESS = 'rounder:tool-success';

export interface ToolSuccessDetail {
  slug: string;
}

/** ToolHost's wrapper; variant pages share an island, so the slug comes from the page, not the island */
const host = () => (typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('[data-tool-slug]'));

export function toolSucceeded(slug?: string) {
  if (typeof window === 'undefined') return;
  const el = host();
  const detail: ToolSuccessDetail = { slug: slug ?? el?.dataset.toolSlug ?? '' };
  if (detail.slug) (el ?? window).dispatchEvent(new CustomEvent(TOOL_SUCCESS, { detail, bubbles: true }));
}

/** calls handler on every success on this page; returns the unsubscribe function */
export function onToolSuccess(handler: (detail: ToolSuccessDetail) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<ToolSuccessDetail>).detail);
  window.addEventListener(TOOL_SUCCESS, listener);
  return () => window.removeEventListener(TOOL_SUCCESS, listener);
}
