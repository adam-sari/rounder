import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'csv-viewer',
  category: 'dev',
  name: 'CSV viewer & editor',
  title: 'CSV Viewer & Editor: open large CSV files online, free',
  h1: 'CSV viewer & *editor*',
  description: 'Open big CSV and TSV files in a fast, scrollable table. Sort, filter, check column stats, edit cells and export to CSV, TSV or JSON. Nothing is uploaded.',
  tagline: 'Open huge CSV files in a smooth table, then sort, filter, edit and export.',
  keywords: ['csv viewer', 'csv editor', 'open csv file', 'view csv online', 'large csv viewer', 'tsv viewer', 'csv file reader', 'edit csv online'],
  island: 'CsvViewer',
  steps: [
    'Drop a CSV or TSV file. Hundreds of thousands of rows are fine, because only the rows on screen are drawn.',
    'Search, click a header to sort, and select a column to see its type, unique values, min, max and mean.',
    'Double-click a cell (or tap it twice on a phone) to edit it, insert or delete rows, then export as CSV, TSV or JSON.',
  ],
  faq: [
    { q: 'How big a file can it open?', a: 'There is no cap from us. The table only draws the rows you can see, so scrolling stays smooth with 100,000 rows and more. The real limit is your device\'s memory: a file of several hundred megabytes can be too much for a phone.' },
    { q: 'Are my edits saved?', a: 'Edits live in this browser tab until you export. Download the result as CSV, TSV or JSON when you are done. If you try to close the tab with unexported edits, your browser asks you to confirm first.' },
    { q: 'How are column types detected?', a: 'Each column is checked for numbers (including ones like 1,234.56), ISO dates like 2024-03-01, and true/false or yes/no values. Anything else counts as text. Number columns sort by value and show min, max and mean; date columns show the earliest and latest date.' },
    { q: 'Why do some characters look wrong?', a: 'Files are read as UTF-8, and a file that isn\'t valid UTF-8 is read as Windows-1252, which older versions of Excel save. UTF-16 files with a byte order mark work too. If text still looks off, re-save the file as "CSV UTF-8" and open it again.' },
    filePrivacyFaq,
  ],
  related: ['csv-to-json', 'json-to-csv', 'json-formatter'],
} satisfies Tool;
