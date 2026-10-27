import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'pdf-to-excel',
  category: 'pdf',
  name: 'PDF to Excel',
  title: 'PDF to Excel Converter: tables to XLSX with real numbers',
  h1: 'PDF to *Excel*',
  description: 'Pull tables out of a PDF into an Excel workbook (.xlsx), with amounts as real numbers you can sum. Bank statements, invoices, reports. Free and never uploaded.',
  tagline: 'Turn the tables in a PDF into spreadsheet rows and columns, numbers included.',
  keywords: ['pdf to excel', 'pdf to xlsx', 'convert pdf to excel', 'pdf table to excel', 'bank statement pdf to excel', 'pdf to spreadsheet', 'extract tables from pdf', 'pdf to csv'],
  island: 'PdfToOffice',
  props: { to: 'excel' },
  steps: [
    'Drop in a PDF: a statement, an invoice, a report with tables. Password-protected files ask for their password first.',
    'Tables are found where the text lines up in columns, and the first one is previewed. Choose "Tables only" or "All text" for every line of every page.',
    'Download the .xlsx. Amounts, percentages and thousands separators arrive as real numbers.',
  ],
  faq: [
    {
      q: 'Which numbers become real numbers?',
      a: 'Amounts like 1,234.50, -4.75, (80.00) and $12, and percentages like 12.5%, are stored as numbers with a matching format, so sums and sorting work straight away. Documents that write 1.234,56 are recognized too. Dates, phone numbers, account numbers and codes with leading zeros stay text exactly as written, so nothing is silently changed.',
    },
    {
      q: 'What does "Tables only" leave out?',
      a: 'Everything that isn’t in a table: headings, addresses, notes. Each table gets its own sheet, named after its page. Switch to "All text" to get every line of every page, one sheet per page, with the tables’ rows and columns kept in place. If no tables are found, all text is used.',
    },
    {
      q: 'Will it work on a scanned statement?',
      a: 'Yes, with OCR. Scanned pages are pictures, so the tool offers to read them with Tesseract on your device (a one-time download of a few MB). The recognized words are then laid out and split into columns like any other page. Check the numbers afterwards: OCR can misread a digit on a faint scan.',
    },
    {
      q: 'Why are some of my columns merged or split?',
      a: 'Columns are worked out from where the text sits, not from lines drawn on the page. Tables with very tight columns, or cells that overflow into the next column, can come out merged; very wide gaps inside a cell can split it. The preview shows the first table, so you can spot this before downloading.',
    },
    filePrivacyFaq,
  ],
  notes: {
    settings: [
      { name: 'Tables only', effect: 'One sheet per table found, named after its page, with a bold header row when the PDF has one.' },
      { name: 'All text', effect: 'One sheet per page with every line as a row, cut into cells at wide gaps, tables kept in place.' },
    ],
    results: [
      { input: 'Bank statement (3 KB): 14 transactions', setting: 'Tables only', output: '1 sheet, 16 rows, amounts as numbers, 7 KB, in 0.3 s' },
      { input: '40-page report (51 KB) with a table on each page', setting: 'Tables only', output: '40 sheets, 37 KB, in 0.4 s' },
    ],
    measured: { date: '2026-10-27', device: 'Chromium 156 on a Windows 11 desktop (Intel Core i7-12700F)' },
  },
  related: ['excel-to-pdf', 'pdf-to-word', 'pdf-to-text', 'csv-viewer', 'ocr-pdf'],
  next: ['excel-to-pdf'],
  flagship: { elsewhere: 'Uploads your statement to someone’s server', here: 'Read on your device, never uploaded' },
} satisfies Tool;
