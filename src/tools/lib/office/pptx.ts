/*
 * PDF pages → a .pptx deck (pptxgenjs, MIT): one slide per page at the page's own shape, the page
 * as a full-slide picture, and its text in the speaker notes so the deck stays searchable.
 */

export interface SlidePage {
  /** points */
  width: number;
  height: number;
  /** JPEG or PNG */
  image: { data: Uint8Array; type: 'jpg' | 'png' };
  notes?: string;
}

/** slide size in inches: the first page's shape, scaled so the long side is 13.333 in (PowerPoint's widescreen width) */
export function slideSize(width: number, height: number): { w: number; h: number } {
  const long = 13.333;
  return width >= height ? { w: long, h: Math.round(((long * height) / width) * 1000) / 1000 } : { w: Math.round(((long * width) / height) * 1000) / 1000, h: long };
}

/** Fits a page inside the slide, centered (pages of another shape get bars) */
export function fit(page: { width: number; height: number }, slide: { w: number; h: number }) {
  const scale = Math.min(slide.w / page.width, slide.h / page.height);
  const w = page.width * scale;
  const h = page.height * scale;
  return { x: (slide.w - w) / 2, y: (slide.h - h) / 2, w, h };
}

function base64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function buildPptx(pages: SlidePage[], { title }: { title?: string } = {}): Promise<Blob> {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pres = new PptxGenJS();
  const size = slideSize(pages[0]?.width ?? 792, pages[0]?.height ?? 612);
  pres.defineLayout({ name: 'PDF', width: size.w, height: size.h });
  pres.layout = 'PDF';
  pres.company = 'Rounder Tools (roundertools.com)';
  if (title) pres.title = title;
  for (const p of pages) {
    const slide = pres.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addImage({ data: `data:image/${p.image.type === 'jpg' ? 'jpeg' : 'png'};base64,${base64(p.image.data)}`, ...fit(p, size) });
    if (p.notes?.trim()) slide.addNotes(p.notes.trim());
  }
  return (await pres.write({ outputType: 'blob' })) as Blob;
}
