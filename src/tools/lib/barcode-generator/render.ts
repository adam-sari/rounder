import JsBarcode from 'jsbarcode';
import { jsFormat, type FormatId, type Options } from './formats';

export interface Style {
  /** width of the narrowest bar, in px */
  barWidth: number;
  height: number;
  margin: number;
  showText: boolean;
  fontSize: number;
  lineColor: string;
  /** '' for a transparent background */
  background: string;
}

export interface Spec {
  value: string;
  format: FormatId;
  options: Options;
  style: Style;
}

/** JsBarcode options at a given scale; everything is multiplied so a 2× PNG is a crisp copy of the preview */
function jsOptions({ format, options, style }: Spec, scale = 1) {
  return {
    format: jsFormat(format, options),
    mod43: format === 'CODE39' && !!options.mod43,
    width: style.barWidth * scale,
    height: style.height * scale,
    margin: style.margin * scale,
    displayValue: style.showText,
    fontSize: style.fontSize * scale,
    textMargin: 2 * scale,
    font: 'monospace',
    lineColor: style.lineColor,
    background: style.background,
  } as JsBarcode.Options;
}

/** draws into an existing <svg>; throws if JsBarcode rejects the value */
export function drawSvg(svg: SVGSVGElement, spec: Spec) {
  JsBarcode(svg, spec.value, jsOptions(spec));
}

export function svgMarkup(spec: Spec) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  drawSvg(svg, spec);
  return new XMLSerializer().serializeToString(svg);
}

export function svgBlob(spec: Spec) {
  return new Blob([svgMarkup(spec)], { type: 'image/svg+xml' });
}

export function pngBlob(spec: Spec, scale: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, spec.value, jsOptions(spec, scale));
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed.'))), 'image/png'));
}
