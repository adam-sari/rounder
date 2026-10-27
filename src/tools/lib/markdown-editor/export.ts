/** Text of the first heading, without Markdown syntax: "# **Trip** notes" → "Trip notes" */
export function docTitle(md: string): string {
  // a closing run of #s only counts after a space, so "# Learn C#" keeps its #
  const atx = /^ {0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/m.exec(md)?.[1];
  if (!atx) return '';
  return atx
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

/** A safe file name from a title: "Trip notes: Day 1" → "trip-notes-day-1" */
export function fileBase(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return base || 'document';
}

export function countWords(text: string): number {
  let n = 0;
  const re = /[\p{L}\p{N}'’-]+/gu;
  while (re.exec(text)) n++;
  return n;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

const CSS = `:root{color-scheme:light dark;--fg:#1f1d1a;--muted:#6b665e;--line:#e4dfd6;--soft:#f6f3ee;--accent:#a66b00}
@media (prefers-color-scheme:dark){:root{--fg:#ece7de;--muted:#a39d93;--line:#3a3732;--soft:#22211e;--accent:#ffd25e}body{background:#161514}}
*{box-sizing:border-box}
body{margin:0;color:var(--fg);font:17px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:760px;margin:0 auto;padding:56px 24px 96px}
h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.8em 0 .6em}
h1{font-size:2.1em;margin-top:0}h2{font-size:1.5em;padding-bottom:.25em;border-bottom:1px solid var(--line)}h3{font-size:1.2em}
p,ul,ol,blockquote,pre,table{margin:0 0 1.1em}
a{color:var(--accent)}
img{max-width:100%;height:auto}
hr{border:0;border-top:1px solid var(--line);margin:2em 0}
blockquote{margin-left:0;padding:.2em 1.1em;border-left:3px solid var(--accent);color:var(--muted)}
code{font:.88em/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--soft);padding:.15em .4em;border-radius:5px}
pre{background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:14px 16px;overflow-x:auto}
pre code{background:none;padding:0;font-size:.85em}
table{border-collapse:collapse;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:6px 12px;text-align:left}
th{background:var(--soft)}
li:has(>input[type=checkbox]),li:has(>p>input[type=checkbox]){list-style:none;margin-left:-1.3em}
@media print{body{font-size:12pt}main{padding:0;max-width:none}a{color:inherit}pre{white-space:pre-wrap}}`;

/** A complete, self-contained page that looks good on screen and in print */
export function standaloneHtml(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title || 'Document')}</title>
<style>
${CSS}
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}
