/** Delimiter choices; '' asks the parser to detect it */
export const delimiters = [
  ['auto', ''],
  ['comma', ','],
  ['semicolon', ';'],
  ['tab', '\t'],
  ['pipe', '|'],
] as const;

export function delimiterName(d: string) {
  return delimiters.find(([, c]) => c === d)?.[0] ?? JSON.stringify(d);
}

/**
 * UTF-16 when there is a UTF-16 byte order mark (Excel's "Unicode Text"), UTF-8 when
 * the bytes are valid UTF-8, otherwise Windows-1252, which older Excel versions save.
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

const SPREADSHEETS = /\.(xlsx|xlsm|xlsb|xls|ods|numbers)$/i;

/** A friendly reason a file can't be read as text, or '' if it looks fine */
export function fileProblem(name: string, text?: string) {
  if (SPREADSHEETS.test(name)) {
    return 'That is a spreadsheet file, not CSV. In Excel, Numbers or Sheets, use File > Save As (or Download / Export) and choose CSV, then open that file here.';
  }
  if (text !== undefined && text.slice(0, 4096).includes('\0')) {
    return 'This file doesn\'t look like text. Pick a CSV, TSV or JSON file.';
  }
  return '';
}
