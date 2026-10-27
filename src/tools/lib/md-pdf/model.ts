/**
 * The document model the PDF layout works from. Markdown and HTML both end up
 * here (via sanitized HTML, see dom.ts), so one layout engine serves both.
 * Plain data only: it's posted to the layout worker.
 */

export interface InlineImage {
  src: string;
  alt: string;
  /** CSS pixels from width/height attributes, when given */
  width?: number;
  height?: number;
}

export interface Run {
  text: string;
  b?: boolean;
  i?: boolean;
  code?: boolean;
  /** strikethrough */
  s?: boolean;
  /** underline */
  u?: boolean;
  /** http(s), mailto or tel only */
  href?: string;
  /** a forced line break; text is '' */
  br?: boolean;
  /** an image that sits in the line like a big character; text is '' */
  img?: InlineImage;
}

export type Align = 'left' | 'center' | 'right';

export interface ListItem {
  task?: 'done' | 'todo';
  blocks: Block[];
}

export type Block =
  /** tight: an anonymous paragraph (bare text in a div or tight list item), which has no margins */
  | { t: 'p'; runs: Run[]; tight?: boolean }
  | { t: 'h'; level: number; runs: Run[] }
  | { t: 'code'; text: string }
  | { t: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { t: 'quote'; blocks: Block[] }
  | { t: 'hr' }
  | ({ t: 'img'; href?: string } & InlineImage)
  | { t: 'table'; align: Align[]; head: Run[][] | null; rows: Run[][][] };

/** Calls fn for every run and every block image, depth first */
export function walkBlocks(blocks: Block[], fn: { run?: (r: Run) => void; image?: (img: InlineImage) => void; code?: (text: string) => void }) {
  const runs = (rs: Run[]) => {
    for (const r of rs) {
      fn.run?.(r);
      if (r.img) fn.image?.(r.img);
    }
  };
  for (const b of blocks) {
    switch (b.t) {
      case 'p':
      case 'h':
        runs(b.runs);
        break;
      case 'code':
        fn.code?.(b.text);
        break;
      case 'list':
        for (const item of b.items) walkBlocks(item.blocks, fn);
        break;
      case 'quote':
        walkBlocks(b.blocks, fn);
        break;
      case 'img':
        fn.image?.(b);
        break;
      case 'table':
        for (const row of b.head ? [b.head, ...b.rows] : b.rows) for (const cell of row) runs(cell);
        break;
    }
  }
}

/** Every image source in the document, once each */
export function imageSources(blocks: Block[]): string[] {
  const set = new Set<string>();
  walkBlocks(blocks, { image: (img) => set.add(img.src) });
  return [...set];
}

/** All the text that will be drawn, for picking fonts */
export function allText(blocks: Block[]): string {
  const parts: string[] = [];
  // alt text is drawn when an image can't be shown
  walkBlocks(blocks, { run: (r) => parts.push(r.text), code: (t) => parts.push(t), image: (img) => parts.push(img.alt) });
  return parts.join(' ');
}

/** The first heading's text, for the PDF title and file name */
export function docTitle(blocks: Block[]): string {
  let found = '';
  const search = (bs: Block[]) => {
    for (const b of bs) {
      if (found) return;
      if (b.t === 'h') found = b.runs.map((r) => r.text).join('').replace(/\s+/g, ' ').trim();
      else if (b.t === 'quote') search(b.blocks);
    }
  };
  search(blocks);
  return found.slice(0, 120);
}

/** "Trip notes: Day 1" → "trip-notes-day-1" */
export function fileBase(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '') || 'document'
  );
}
