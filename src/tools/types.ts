import type { CategoryId } from './categories';

export interface Faq {
  q: string;
  a: string;
}

/**
 * First-hand facts about a tool, shown between "How it works" and the questions. Only what we checked ourselves:
 * results come from real runs (never estimates), and limits say where they come from.
 */
export interface ToolNotes {
  /** "What the settings do": each control and what it changes in the result */
  settings?: { name: string; effect: string }[];
  /** "Typical results": measured runs, e.g. { input: '12-page scan, 8.4 MB', setting: 'Strong', output: '1.1 MB' } */
  results?: { input: string; setting: string; output: string; note?: string }[];
  /** when (YYYY-MM-DD) and on what the results were measured, e.g. 'Chrome 141 on a 2021 MacBook Air'; required with results */
  measured?: { date: string; device: string };
  /** "About the formats": what each format is good at */
  formats?: { name: string; about: string }[];
  /** "Platform limits": where a file has to fit, with an https link to the platform's own docs when there is one */
  limits?: { where: string; limit: string; source?: string }[];
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
  /** first-hand content (settings, measured results, formats, platform limits); see ToolNotes */
  notes?: ToolNotes;
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
