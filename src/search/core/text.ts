// Text handling shared by the intent parser and the lexical index: normalisation, romanised Hindi, typo distance.

/** romanised Hindi function words that carry no intent */
export const HI_STOP = new Set(
  'ka ki ke ko me mein mai se kaise kare karen karein karna karni karo hai hain ho wala wali wale app ke liye liye kr kar krna kya aur bhi'.split(' '),
);

/** romanised Hindi content words, mapped to the English the rest of the search understands */
export const HI_MAP: Record<string, string> = {
  kam: 'reduce', chhota: 'smaller', chota: 'smaller', bada: 'bigger', badha: 'increase', badhaye: 'increase',
  hataye: 'remove', hatana: 'remove', hatao: 'remove', hatane: 'remove', nikale: 'extract', nikalo: 'extract', nikalna: 'extract',
  banaye: 'make', banana: 'make', banaen: 'make', badle: 'convert', badlo: 'convert', jode: 'merge', jodo: 'merge',
  gana: 'song', gane: 'song', gaana: 'song', gaane: 'song', awaz: 'voice', awaaz: 'voice', aawaz: 'voice',
  tasveer: 'photo', foto: 'photo', likhai: 'text', saaf: 'clear',
};

/** English words that say nothing about which tool is wanted ("how to … online free") */
export const EN_STOP = new Set(
  'a an the to of for my me i in on and or is it this that these with from into how can do you your want need please some any be as at by online free tool converter app best way without loss quality file files'.split(' '),
);

/** lowercase, no accents, numbers glued to their unit ("20 kb" → "20kb"), only the punctuation sizes and times use */
export function normalize(q: string): string {
  return q
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/(\d)\s*(kb|mb|gb|k|m)\b/g, '$1$2')
    .replace(/[^\p{L}\p{N}.%x:\- ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const stem = (w: string) => (w.length > 4 ? w.replace(/(ing|ers|er|ed|es|s)$/, '') : w);

/** tokens for the lexical index: Hinglish mapped, stopwords dropped, light stemming */
export function lexTokens(text: string, stop = true): string[] {
  return normalize(text)
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => HI_MAP[w] ?? w)
    .filter((w) => !stop || (!EN_STOP.has(w) && !HI_STOP.has(w)))
    .map(stem);
}

/** optimal string alignment distance (edits plus adjacent transpositions), giving up past `max` */
export function osa(a: string, b: string, max = 2): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > max) return max + 1;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array<number>(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= n; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[m][n];
}
