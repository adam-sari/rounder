import { formatPageRanges } from '@/engines/pdf/ranges';
import { formatShare } from './pixels';
import { foldText, pairLabel, type PagePair, type TextComparison } from './text';

export interface ReportInput {
  nameA: string;
  nameB: string;
  pagesA: number;
  pagesB: number;
  text: TextComparison;
  /** visible share of changed pixels per pair (same order as text.pairs), where the visual scan has run */
  visual?: (number | undefined)[];
  date: Date;
}

const base = (name: string) => name.replace(/\.pdf$/i, '') || 'document';

/** "report-v1-vs-report-v2-comparison.txt" */
export function reportName(nameA: string, nameB: string, ext: 'txt' | 'html') {
  const safe = (s: string) => base(s).replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60);
  return `${safe(nameA)}-vs-${safe(nameB)}-comparison.${ext}`;
}

const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
const squash = (s: string) => s.replace(/\s+/g, ' ');
const oneLine = (s: string) => squash(s).trim();

/** Each change on a page, wdiff style: …context [-removed-]{+added+} context… */
export function changeLines(pair: PagePair, context = 50): string[] {
  const lines: string[] = [];
  let seen = -1;
  pair.parts.forEach((part, j) => {
    if (part.hunk <= seen) return;
    seen = part.hunk;
    let body = '';
    let k = j;
    for (; k < pair.parts.length; k++) {
      const p = pair.parts[k];
      if (p.kind === 'same' && !(p.text.trim() === '' && pair.parts[k + 1]?.hunk === part.hunk)) break;
      body += p.kind === 'add' ? `{+${oneLine(p.text)}+}` : p.kind === 'del' ? `[-${oneLine(p.text)}-]` : ' ';
    }
    // context keeps the text's own spacing next to the change, and is cut at word breaks
    const before = squash(pair.parts[j - 1]?.text ?? '').trimStart();
    const after = squash(pair.parts[k]?.text ?? '').trimEnd();
    const pre = before.length > context ? `…${before.slice(-context).replace(/^\S*\s/, '')}` : before;
    const post = after.length > context ? `${after.slice(0, context).replace(/\s\S*$/, '')}…` : after;
    lines.push(pre + body + post);
  });
  return lines;
}

function summary(r: ReportInput) {
  const t = r.text;
  const visualOnly = r.visual ? t.pairs.filter((p, k) => !p.changes && r.visual![k]) : [];
  return {
    head: t.changes ? `${plural(t.changes, 'text change')} on ${plural(t.changedPages, 'page')}: ${plural(t.added, 'word')} added, ${plural(t.removed, 'word')} removed.` : 'No text differences.',
    unchanged: formatPageRanges(t.pairs.filter((p) => !p.changes && p.b >= 0 && !visualOnly.includes(p)).map((p) => p.b)),
    visualOnly,
  };
}

/** the user's local calendar day (toISOString would give the UTC one) */
const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const visualNote = (share: number | undefined) => (share === undefined ? '' : share ? `looks ${formatShare(share)} different` : 'looks the same');

export function reportText(r: ReportInput): string {
  const s = summary(r);
  const out = [
    'PDF comparison',
    `Original: ${r.nameA} (${plural(r.pagesA, 'page')})`,
    `Changed:  ${r.nameB} (${plural(r.pagesB, 'page')})`,
    `Compared ${day(r.date)} with Rounder (roundertools.com), in the browser.`,
    '',
    s.head,
    '',
  ];
  r.text.pairs.forEach((p, k) => {
    if (!p.changes) return;
    const note = p.a < 0 || p.b < 0 ? '' : visualNote(r.visual?.[k]);
    out.push(`${pairLabel(p)} · ${plural(p.changes, 'change')}${note ? ` · ${note}` : ''}`);
    if (p.a < 0 || p.b < 0) out.push(p.parts.length ? `  ${p.a < 0 ? '+' : '-'} ${oneLine(p.parts[0].text)}` : '  (no text on this page)');
    else for (const line of changeLines(p)) out.push(`  ${line}`);
    out.push('');
  });
  if (s.visualOnly.length) {
    out.push('Pages whose text matches but look different (images, layout or styling):');
    for (const p of s.visualOnly) out.push(`  ${pairLabel(p)} · ${visualNote(r.visual![r.text.pairs.indexOf(p)])}`);
    out.push('');
  }
  if (s.unchanged) out.push(`Unchanged pages (numbers in the changed file): ${s.unchanged}`);
  out.push('', 'Key: [-removed-] {+added+}');
  return out.join('\n') + '\n';
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function pageHtml(p: PagePair) {
  const last = p.parts.length - 1;
  const body = p.parts
    .map((part, j) => {
      if (part.kind === 'add') return `<ins>${esc(part.text)}</ins>`;
      if (part.kind === 'del') return `<del>${esc(part.text)}</del>`;
      const f = foldText(part.text, j > 0 ? 240 : 0, j < last ? 240 : 0);
      return f ? `${esc(f.head)}<span class="fold">⋯ ${plural(f.hidden, 'unchanged word')} ⋯</span>${esc(f.tail)}` : esc(part.text);
    })
    .join('');
  return body || '<span class="fold">no text on this page</span>';
}

export function reportHtml(r: ReportInput): string {
  const s = summary(r);
  const pages = r.text.pairs
    .map((p, k) => {
      if (!p.changes) return '';
      const note = p.a < 0 || p.b < 0 ? '' : visualNote(r.visual?.[k]);
      return `<section><h2>${esc(pairLabel(p))}</h2><p class="meta">${plural(p.changes, 'change')} · +${p.added} −${p.removed} words${note ? ` · ${note}` : ''}</p><div class="text">${pageHtml(p)}</div></section>`;
    })
    .join('\n');
  const visualOnly = s.visualOnly.length
    ? `<section><h2>Text matches, but the page looks different</h2><ul>${s.visualOnly.map((p) => `<li>${esc(pairLabel(p))} · ${visualNote(r.visual![r.text.pairs.indexOf(p)])}</li>`).join('')}</ul></section>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(`${base(r.nameA)} vs ${base(r.nameB)}`)}: PDF comparison</title>
<style>
  body { margin: 0 auto; max-width: 860px; padding: 32px 20px 64px; font: 16px/1.6 system-ui, sans-serif; color: #1d1b18; background: #fbfaf7; }
  h1 { font: 400 34px/1.15 Georgia, serif; margin: 0 0 12px; }
  h2 { font: 600 17px/1.3 system-ui, sans-serif; margin: 0; }
  .files { margin: 0; color: #55504a; }
  .lead { font-size: 18px; margin: 18px 0 28px; }
  section { margin: 0 0 18px; padding: 16px 18px; background: #fff; border: 1px solid #e4e0d8; border-radius: 12px; break-inside: avoid; }
  .meta { margin: 2px 0 10px; color: #77716a; font-size: 13px; }
  .text { white-space: pre-wrap; overflow-wrap: anywhere; }
  ins { background: #d6f5d0; color: #14380f; text-decoration: none; border-radius: 3px; }
  del { background: #fcdcd8; color: #6b130b; border-radius: 3px; }
  .fold { display: block; margin: 6px 0; color: #8d877f; font-size: 13px; }
  footer { margin-top: 32px; color: #8d877f; font-size: 13px; }
</style>
</head>
<body>
<h1>PDF comparison</h1>
<p class="files">Original: <strong>${esc(r.nameA)}</strong> (${plural(r.pagesA, 'page')})<br>Changed: <strong>${esc(r.nameB)}</strong> (${plural(r.pagesB, 'page')})</p>
<p class="lead">${esc(s.head)}</p>
${pages}
${visualOnly}
${s.unchanged ? `<p class="meta">Unchanged pages (numbers in the changed file): ${s.unchanged}</p>` : ''}
<footer>Compared ${day(r.date)} with Rounder (roundertools.com), in the browser. <del>Removed</del> <ins>Added</ins></footer>
</body>
</html>
`;
}
