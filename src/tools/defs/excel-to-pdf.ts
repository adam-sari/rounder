import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'excel-to-pdf',
  category: 'pdf',
  name: 'Excel to PDF',
  title: 'Excel to PDF Converter: XLSX to PDF, fit to page, free',
  h1: 'Excel to *PDF*',
  description: 'Convert Excel spreadsheets (.xlsx) to PDF with number formats, colors, borders and merged cells. Fit wide sheets to the page. Free, and never uploaded.',
  tagline: 'Print a spreadsheet to PDF in your browser, with every column on the page.',
  keywords: ['excel to pdf', 'xlsx to pdf', 'convert excel to pdf', 'spreadsheet to pdf', 'xls to pdf', 'excel to pdf fit to page', 'excel sheet to pdf', 'save excel as pdf'],
  island: 'OfficeToPdf',
  props: { from: 'excel' },
  steps: [
    'Drop in an Excel workbook (.xlsx). The first time, the Excel reader loads once, about 1.3 MB.',
    'Pick Letter or A4, the orientation, whether wide sheets shrink to fit the page width, gridlines, and which sheets to include.',
    'Check the page previews, then download the PDF. Each sheet starts on a new page.',
  ],
  faq: [
    {
      q: 'Do numbers and dates look the way they do in Excel?',
      a: 'Yes. Each cell is shown through its own number format, so currency, percentages, thousands separators and dates come out as Excel shows them. Formulas show the result Excel saved with the file; they aren’t recalculated here.',
    },
    {
      q: 'What about wide sheets?',
      a: 'With “Fit all columns on one page” on, a sheet wider than the page is scaled down so every column fits, and its rows continue onto as many pages as needed. Turn it off to keep the original size, in which case columns past the page edge are cut off. On “Automatic”, a sheet keeps the orientation saved in its own page setup, and a wide sheet without one turns landscape; pick Portrait or Landscape to override it.',
    },
    {
      q: 'Which formatting is kept?',
      a: 'Fonts (matched to free equivalents), bold, italics, text and fill colors, borders, alignment, wrapped text, merged cells, column widths and row heights. Charts, pictures, conditional formatting, comments and the sheet’s print area and page breaks are not carried over yet, and hidden rows, columns and sheets are left out.',
    },
    {
      q: 'Can I convert .xls or .csv files?',
      a: 'Only .xlsx (and .xlsm) files can be read here. Open an older .xls file in Excel, Google Sheets or LibreOffice and save it as .xlsx first. A password-protected workbook needs its password removed first.',
    },
    filePrivacyFaq,
  ],
  notes: {
    settings: [
      { name: 'Paper', effect: 'Letter or A4, with Excel’s narrow margins (0.5 in).' },
      { name: 'Orientation', effect: 'Follows the sheet’s own page setup; without one, a sheet wider than a portrait page turns landscape.' },
      { name: 'Fit all columns on one page', effect: 'Scales a wide sheet down until every column fits across the page; rows continue onto more pages.' },
      { name: 'Print gridlines', effect: 'Draws light lines between all cells, as Excel’s “Print gridlines” option does. Cell borders are always kept.' },
      { name: 'Sheets', effect: 'Picks which sheets go into the PDF. Each starts on a new page. Up to 300,000 cells go into one PDF, so for a huge workbook pick fewer sheets.' },
    ],
    results: [
      { input: 'Sales workbook (.xlsx, 10 KB): 2 sheets, 60 styled rows, merged title', setting: 'Letter, orientation from the sheet, fit width', output: '3-page landscape PDF, 32 KB, in 0.5 s' },
      { input: 'Order log (.xlsx, 0.8 MB): 20,000 rows × 8 columns', setting: 'Letter, automatic, fit width', output: '417-page PDF, 6.9 MB, in 30 s' },
    ],
    measured: { date: '2026-10-27', device: 'Chromium 156 on a Windows 11 desktop (Intel Core i7-12700F)' },
  },
  related: ['pdf-to-excel', 'word-to-pdf', 'powerpoint-to-pdf', 'csv-viewer', 'merge-pdf'],
  next: ['compress-pdf', 'merge-pdf'],
  flagship: { elsewhere: 'Your spreadsheet is uploaded to someone’s server', here: 'Converted on your device, never uploaded' },
} satisfies Tool;
