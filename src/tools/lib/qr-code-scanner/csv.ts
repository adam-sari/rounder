/** a scanned code can hold anything, so cells that a spreadsheet would run as a formula get a leading ' */
function cell(f: string) {
  const safe = /^[=+\-@\t\r]/.test(f) ? `'${f}` : f;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** RFC 4180 CSV with CRLF between rows */
export function toCsv(rows: string[][]) {
  return rows.map((row) => row.map(cell).join(',')).join('\r\n');
}
