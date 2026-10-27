/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import { Marked } from 'marked';
import { isWinAnsi, missingGlyphs } from '@/engines/pdf/lib';
import { layoutDocument, type ImageSize, type Layout } from './layout';
import { allText, type Block } from './model';
import { measurer, paintPdf, type PdfImage } from './pdf';
import type { PageOptions } from './themes';

const md = new Marked({ gfm: true });

async function fontsFor(blocks: Block[]) {
  const text = allText(blocks);
  const noto = !isWinAnsi(text);
  return { text, noto, measure: await measurer(noto) };
}

// Parsing, laying out and drawing a long document can take a while, so it all happens here, off the page
const api = {
  /** Markdown → HTML; the page sanitizes it, since that needs a DOM */
  markdown(src: string): string {
    return md.parse(src, { async: false });
  },

  /** Pages for the preview, plus characters the PDF fonts can't draw */
  async layout(blocks: Block[], opts: PageOptions, images: Record<string, ImageSize>): Promise<{ layout: Layout; missing: string[] }> {
    const { text, noto, measure } = await fontsFor(blocks);
    const layout = layoutDocument(blocks, opts, measure, images);
    return { layout, missing: noto ? await missingGlyphs(text) : [] };
  },

  async pdf(blocks: Block[], opts: PageOptions, images: Record<string, PdfImage>, title: string): Promise<{ blob: Blob; pages: number }> {
    const { measure } = await fontsFor(blocks);
    const layout = layoutDocument(blocks, opts, measure, images);
    return { blob: await paintPdf(layout, images, title), pages: layout.pages.length };
  },
};

export type MdPdfWorker = typeof api;
Comlink.expose(api);
