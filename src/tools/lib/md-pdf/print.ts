/**
 * The page handed to the browser's print dialog ("Save as PDF"). Its CSS is
 * built from the same theme numbers as the PDF layout, so both look alike.
 */
import { MARGINS, STACKS, THEMES, type NumberPos, type PageOptions } from './themes';

const MARGIN_BOX: Record<NumberPos, string> = {
  off: '',
  bottom: 'bottom-center',
  'bottom-total': 'bottom-center',
  'bottom-right': 'bottom-right',
  'top-right': 'top-right',
};

export function printCss(opts: PageOptions): string {
  const t = THEMES[opts.theme];
  const s = t.size;
  const pt = (n: number) => `${+n.toFixed(2)}pt`;
  const box = MARGIN_BOX[opts.numbers];
  const counter = opts.numbers === 'bottom-total' ? 'counter(page) " of " counter(pages)' : 'counter(page)';
  // page-number margin boxes work in Chromium browsers; others just leave them out
  const numbers = box ? `@${box}{content:${counter};font:${pt(Math.min(9, s * 0.82))} ${STACKS[t.body]};color:${t.muted}}` : '';
  const headings = t.h
    .map(
      (h, k) =>
        `h${k + 1}{font-size:${pt(s * h.scale)};font-weight:${h.bold ? 700 : 400};font-style:${h.italic ? 'italic' : 'normal'};margin:${pt(h.mt * s)} 0 ${pt(h.mb * s)}${h.rule ? `;padding-bottom:${pt(s * h.scale * 0.3)};border-bottom:.8pt solid ${t.rule}` : ''}}`,
    )
    .join('\n');
  const cells = t.tableGrid
    ? `th,td{border:.6pt solid ${t.rule}}`
    : `table{border-top:.9pt solid ${t.text};border-bottom:.9pt solid ${t.text}}th{border-bottom:.9pt solid ${t.text}}td{border-bottom:.4pt solid ${t.rule}}`;
  return `@page{size:${opts.size === 'A4' ? 'A4' : 'letter'};margin:${MARGINS[opts.margin].mm}mm;${numbers}}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font:${pt(s)}/${t.lead} ${STACKS[t.body]};color:${t.text};overflow-wrap:break-word;font-style:normal}
h1,h2,h3,h4,h5,h6{font-family:${STACKS[t.heading]};color:${t.headingColor};line-height:1.25;break-after:avoid}
${headings}
body>:first-child{margin-top:0}
p,ul,ol,pre,table,blockquote,figure,dl{margin:0 0 ${pt(s * 0.8)}}
p{orphans:2;widows:2}
ul,ol{padding-left:${pt(s * 1.7)}}
li+li{margin-top:${pt(s * 0.25)}}
li>ul,li>ol{margin-bottom:0}
li:has(>input[type=checkbox]),li:has(>p>input[type=checkbox]){list-style:none}
input[type=checkbox]{margin:0 .45em 0 -1.4em;accent-color:${t.accent}}
a{color:${t.accent}}
code,kbd,samp{font-family:${STACKS.mono};font-size:${t.codeScale}em;background:${t.inlineCodeBg};padding:.1em .3em;border-radius:2pt}
pre{font:${pt(s * t.codeScale)}/1.45 ${STACKS.mono};background:${t.codeBg};color:${t.codeFg};${t.codeBorder ? `border:.8pt solid ${t.codeBorder};` : ''}border-radius:4pt;padding:8pt 10pt;white-space:pre-wrap;overflow-wrap:anywhere}
pre code{font:inherit;background:none;padding:0;color:inherit}
blockquote{margin-left:0;margin-right:0;padding:2pt 0 2pt ${pt(s * 1.1)};border-left:3pt solid ${t.quoteBar};color:${t.muted}${t.quoteItalic ? ';font-style:italic' : ''}}
blockquote>:last-child{margin-bottom:0}
hr{border:0;border-top:.8pt solid ${t.rule};margin:${pt(s * 1.2)} 0}
img{max-width:100%;height:auto}
table{border-collapse:collapse;font-size:.95em}
th,td{padding:4pt 6pt;text-align:left;vertical-align:top}
th{background:${t.tableHeadBg};font-weight:700}
${cells}
thead{display:table-header-group}
tr{break-inside:avoid}`;
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * A complete print page. `body` must already be sanitized. `extraCss` (the
 * HTML's own style sheets) comes after the theme so it wins; it can't close
 * its <style> element early.
 */
export function printDocument(body: string, opts: PageOptions, title: string, extraCss = ''): string {
  const own = extraCss.trim() ? `\n<style>\n${extraCss.replace(/<\/style/gi, '<\\/style')}\n</style>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title || 'Document')}</title>
<style>
${printCss(opts)}
</style>${own}
</head>
<body>
${body}
</body>
</html>
`;
}
