/** File names for the patch header: identical names get git's a/ and b/ prefixes */
export function patchNames(nameA: string, nameB: string): [string, string] {
  return nameA === nameB ? [`a/${nameA}`, `b/${nameB}`] : [nameA, nameB];
}

/** "report.txt" + "report-v2.txt" → "report-vs-report-v2.diff" */
export function patchFileName(nameA: string, nameB: string) {
  const stem = (n: string) => n.replace(/\.[^.]+$/, '') || 'text';
  return stem(nameA) === stem(nameB) ? `${stem(nameA)}.diff` : `${stem(nameA)}-vs-${stem(nameB)}.diff`;
}
