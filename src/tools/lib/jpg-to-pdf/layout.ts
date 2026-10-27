import { PAGE_SIZES, pdfName } from '@/engines/pdf/lib';

export type PageSizeOption = 'fit' | 'A4' | 'Letter';
export type Orientation = 'auto' | 'portrait' | 'landscape';
export type Margin = 'none' | 'small' | 'big';
export type Placement = 'fit' | 'fill';

export interface LayoutOptions {
  size: PageSizeOption;
  orientation: Orientation;
  margin: Margin;
  placement: Placement;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** in points, measured from the page's top-left corner */
export interface PageLayout {
  width: number;
  height: number;
  /** the area inside the margins; the image is clipped to it when filling */
  box: Rect;
  image: Rect;
}

/** ¼ inch and ½ inch */
export const MARGINS: Record<Margin, number> = { none: 0, small: 18, big: 36 };

/** "fit to image" pages treat pixels as css pixels (96 per inch), so screenshots keep their on-screen size */
const PT_PER_PX = 0.75;
/** the largest page the PDF format allows (200 inches) */
const MAX_PAGE = 14_400;

export function layoutPage(imgW: number, imgH: number, o: LayoutOptions): PageLayout {
  const m = MARGINS[o.margin];
  if (o.size === 'fit') {
    const s = Math.min(PT_PER_PX, (MAX_PAGE - 2 * m) / Math.max(imgW, imgH));
    const image = { x: m, y: m, w: imgW * s, h: imgH * s };
    return { width: image.w + 2 * m, height: image.h + 2 * m, box: image, image };
  }
  const [a, b] = PAGE_SIZES[o.size];
  const landscape = o.orientation === 'landscape' || (o.orientation === 'auto' && imgW > imgH);
  const [width, height] = landscape ? [b, a] : [a, b];
  const box = { x: m, y: m, w: width - 2 * m, h: height - 2 * m };
  const s = (o.placement === 'fill' ? Math.max : Math.min)(box.w / imgW, box.h / imgH);
  const w = imgW * s;
  const h = imgH * s;
  return { width, height, box, image: { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h } };
}

/** true when any pixel isn't fully opaque (RGBA data) */
export function hasTransparency(data: ArrayLike<number>) {
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

/** one image → "beach.pdf"; several → "beach-and-4-more.pdf" */
export function combinedName(names: string[]) {
  if (!names.length) return 'images.pdf';
  return pdfName(names[0], names.length > 1 ? `-and-${names.length - 1}-more` : '');
}
