// A chart's data as a Markdown table, read from the values the file caches for it (no spreadsheet needed).
import { table } from './markdown';
import { all, attr, kid, kids, local, textOf, type XmlElement } from './xml';

const KIND: Record<string, string> = { barChart: 'bar', bar3DChart: 'bar', lineChart: 'line', line3DChart: 'line', pieChart: 'pie', pie3DChart: 'pie', doughnutChart: 'doughnut', areaChart: 'area', area3DChart: 'area', scatterChart: 'scatter', radarChart: 'radar', bubbleChart: 'bubble' };

/** the cached points of a data reference, by index */
function points(el: XmlElement | undefined): string[] {
  if (!el) return [];
  // a multi-level category axis: the first level is the innermost labels
  const lvl = all(el, 'lvl')[0];
  const out: string[] = [];
  for (const pt of all(lvl ?? el, 'pt')) {
    const idx = Number(attr(pt, 'idx') ?? out.length);
    if (idx >= 0 && idx < 100_000) out[idx] = textOf(kid(pt, 'v') ?? '').trim();
  }
  return Array.from(out, (v) => v ?? '');
}

export function chartToMarkdown(doc: XmlElement): string {
  const chart = all(doc, 'chart')[0];
  const plot = chart && kid(chart, 'plotArea');
  if (!plot) return '';
  const title = (() => {
    const t = kid(chart, 'title');
    return t ? all(t, 't').map(textOf).join('').trim() : '';
  })();
  const groups = plot.children.filter((c): c is XmlElement => typeof c === 'object' && local(c.name).endsWith('Chart'));
  const kind = groups.map((g) => KIND[local(g.name)] ?? local(g.name).replace(/Chart$/, '')).filter((k, i, a) => a.indexOf(k) === i).join(' + ');
  const series = groups.flatMap((g) => kids(g, 'ser'));
  if (!series.length) return '';
  const names = series.map((s, i) => {
    const tx = kid(s, 'tx');
    return (tx && (points(tx)[0] || textOf(kid(tx, 'v') ?? ''))) || `Series ${i + 1}`;
  });
  // scatter and bubble charts use xVal/yVal instead of cat/val
  const cats = points(kid(series[0], 'cat') ?? kid(series[0], 'xVal'));
  const vals = series.map((s) => points(kid(s, 'val') ?? kid(s, 'yVal')));
  const n = Math.max(cats.length, ...vals.map((v) => v.length));
  const rows = [[kind === 'scatter' || kind === 'bubble' ? 'X' : 'Category', ...names]];
  for (let i = 0; i < Math.min(n, 500); i++) rows.push([cats[i] ?? String(i + 1), ...vals.map((v) => v[i] ?? '')]);
  const caption = `_Chart${kind ? ` (${kind})` : ''}${title ? `: ${title}` : ''}_`;
  return `${caption}\n\n${table(rows)}`;
}
