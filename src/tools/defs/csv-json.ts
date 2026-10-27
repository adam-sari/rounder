import { filePrivacyFaq, type Tool } from '../types';

export default [
  {
    slug: 'csv-to-json',
    category: 'dev',
    name: 'CSV to JSON',
    title: 'CSV to JSON Converter: big files, nested keys, no upload',
    h1: 'CSV to *JSON*',
    description: 'Convert CSV to JSON in your browser. Detects the delimiter, types numbers and booleans, and nests dot keys. Handles big files, nothing uploaded.',
    tagline: 'Turn spreadsheet exports into clean JSON, typed and shaped the way you need.',
    keywords: ['csv to json', 'convert csv to json', 'csv to json converter', 'csv to json array', 'excel to json', 'tsv to json', 'csv to nested json', 'csv parser online'],
    island: 'CsvJson',
    props: { dir: 'csv-json' },
    steps: [
      'Paste CSV or drop a .csv file. The delimiter is detected for you.',
      'Pick the shape: an array of objects, an array of arrays, or objects keyed by a column. Turn on nesting for headers like address.city.',
      'Copy the JSON or download it as a .json file.',
    ],
    faq: [
      { q: 'How are numbers, booleans and empty cells handled?', a: 'With "numbers, true/false & null" ticked, 42 becomes 42, TRUE becomes true and empty cells become null. Values with leading zeros, like the ZIP code 01234, and numbers too long to store exactly stay as text, so nothing gets mangled. Untick it to keep every value as a string.' },
      { q: 'What does "nest dot keys" do?', a: 'Headers such as address.city and address.zip become a nested object: {"address": {"city": …, "zip": …}}. If nesting a header would clash with another one, for example address and address.city side by side, it stays flat instead of losing data.' },
      { q: 'My file uses semicolons or tabs. Will it work?', a: 'Yes. The delimiter is detected automatically, covering commas, semicolons (common in European Excel exports), tabs and pipes. If the guess is wrong, pick the delimiter yourself.' },
      { q: 'Can it handle large files?', a: 'Yes. Parsing and converting run in a background thread, so the page stays responsive, and there is no size cap from us; the limit is your device\'s memory. For very large results only the start is shown on screen, but copy and download include everything.' },
      filePrivacyFaq,
    ],
    related: ['json-to-csv', 'csv-viewer', 'json-formatter'],
  },
  {
    slug: 'json-to-csv',
    category: 'dev',
    name: 'JSON to CSV',
    title: 'JSON to CSV Converter: flatten nested JSON for Excel',
    h1: 'JSON to *CSV*',
    description: 'Convert JSON to CSV in your browser. Flattens nested objects, merges keys across rows, handles arrays and JSON Lines, with an Excel-friendly option.',
    tagline: 'Flatten nested JSON into a tidy CSV that opens straight in Excel.',
    keywords: ['json to csv', 'convert json to csv', 'json to csv converter', 'json to excel', 'flatten json', 'nested json to csv', 'jsonl to csv', 'json array to csv'],
    island: 'CsvJson',
    props: { dir: 'json-csv' },
    steps: [
      'Paste JSON or drop a .json file. Arrays, single objects and JSON Lines all work.',
      'Pick a delimiter and how arrays are written. Nested objects become columns like address.city.',
      'Copy the CSV or download it. Tick "add BOM for Excel" if accents or emoji look garbled in Excel.',
    ],
    faq: [
      { q: 'What happens to nested objects?', a: 'They are flattened into dot-named columns, so {"address": {"city": "Paris"}} becomes a column called address.city. Untick "flatten nested objects" to keep each nested object as JSON text in a single cell.' },
      { q: 'What if my objects have different keys?', a: 'Every key from every object becomes a column, in the order the keys first appear. A row without a key simply gets an empty cell there.' },
      { q: 'Which JSON shapes work?', a: 'An array of objects is the usual input. A single object becomes one row, an object of objects becomes one row per key, and if your records sit inside a wrapper like {"data": [...]}, the largest array of records is used. JSON Lines, with one object per line, works too.' },
      { q: 'Why do accents look wrong when I open the CSV in Excel?', a: 'Excel can open CSV files in an older encoding unless the file starts with a byte order mark (BOM). Tick "add BOM for Excel" and characters like é, ü and emoji show up correctly.' },
      filePrivacyFaq,
    ],
    related: ['csv-to-json', 'csv-viewer', 'json-formatter'],
  },
] satisfies Tool[];
