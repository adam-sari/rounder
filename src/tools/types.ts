import type { CategoryId } from './categories';

export interface Faq {
  q: string;
  a: string;
}

export interface Tool {
  /** url path segment, e.g. "word-counter" → /word-counter */
  slug: string;
  category: CategoryId;
  /** short name used on cards and in search */
  name: string;
  /** <title>, written for search */
  title: string;
  /** page heading; may contain one *emphasised* word */
  h1: string;
  /** meta description */
  description: string;
  /** one line under the heading */
  tagline: string;
  /** extra search terms for the ⌘K palette */
  keywords: string[];
  /** island file name in src/tools/islands, without .svelte */
  island: string;
  /** props passed to the island (lets one island power several variant pages) */
  props?: Record<string, unknown>;
  steps: string[];
  faq: Faq[];
  related?: string[];
  /** where to go once this tool is done, in order (e.g. compress → protect): a "Next step" line under the tool */
  next?: string[];
  /** privacy-critical tools (passwords, encryption, redaction) carry no ad code at all */
  noAds?: boolean;
  /** paid or limited on other sites; shown as a flagship */
  flagship?: { elsewhere: string; here: string };
  /**
   * variant pages (e.g. /png-to-jpg) get their own page and search entry but stay
   * off category grids so the main tool isn't listed a dozen times
   */
  variantOf?: string;
}

export const privacyFaq: Faq = {
  q: 'Is my data uploaded anywhere?',
  a: "No. This tool runs entirely in your browser, and Rounder never sends what you type or drop in to a server, ours or anyone else's. Once the page has loaded, along with any AI model the tool uses, it even works offline.",
};

export const filePrivacyFaq: Faq = {
  q: 'Are my files uploaded anywhere?',
  a: 'No. Your files are processed on your own device by your browser. They never touch our servers, so there are no upload waits, no size caps from us, and nothing to delete afterwards.',
};
