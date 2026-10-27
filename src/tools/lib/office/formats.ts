/** What each Office → PDF page takes, and the checks run before a file is read */
export type OfficeFormat = 'word' | 'excel' | 'powerpoint';

export interface FormatInfo {
  label: string;
  /** "document", "workbook", "presentation" */
  noun: string;
  accept: string;
  extensions: string;
  /** what the PDF's pages are called while they're written */
  page: string;
  pages: string;
  /** the reader's one-time download (compressed), MB; measured from the build */
  downloadMb: string;
  modern: string;
  legacy: string;
  broken: string;
}

export const FORMATS: Record<OfficeFormat, FormatInfo> = {
  word: {
    label: 'Word',
    noun: 'document',
    accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.doc,application/msword',
    extensions: '.docx',
    page: 'page',
    pages: 'pages',
    downloadMb: '1.1',
    modern: 'docx',
    legacy: 'doc',
    broken: "This Word file couldn't be read. It may be damaged; try opening it in Word and saving it again.",
  },
  excel: {
    label: 'Excel',
    noun: 'workbook',
    accept: '.xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xls,application/vnd.ms-excel',
    extensions: '.xlsx',
    page: 'page',
    pages: 'sheets',
    downloadMb: '1.3',
    modern: 'xlsx',
    legacy: 'xls',
    broken: "This Excel file couldn't be read. It may be damaged; try opening it in Excel and saving it again.",
  },
  powerpoint: {
    label: 'PowerPoint',
    noun: 'presentation',
    accept: '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation,.ppt,application/vnd.ms-powerpoint',
    extensions: '.pptx',
    page: 'slide',
    pages: 'slides',
    downloadMb: '1.4',
    modern: 'pptx',
    legacy: 'ppt',
    broken: "This PowerPoint file couldn't be read. It may be damaged; try opening it in PowerPoint and saving it again.",
  },
};

/**
 * Why a file can't be converted, judged from its first bytes, or null when it looks right.
 * Modern Office files are ZIP archives; the old binary formats (and password-protected files,
 * which Office wraps the same way) start with the OLE signature D0 CF 11 E0.
 */
export function readError(format: OfficeFormat, head: Uint8Array, name: string): string | null {
  const f = FORMATS[format];
  const ole = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
  const zip = head[0] === 0x50 && head[1] === 0x4b;
  if (ole || new RegExp(`\\.${f.legacy}$`, 'i').test(name))
    return `This is an older .${f.legacy} file or a password-protected one, which can't be read here. Open it in ${f.label}, Google ${format === 'word' ? 'Docs' : format === 'excel' ? 'Sheets' : 'Slides'} or LibreOffice, save it as .${f.modern} without a password, and try again.`;
  if (!zip) return `This doesn't look like a ${f.label} file (.${f.modern}).`;
  return null;
}
