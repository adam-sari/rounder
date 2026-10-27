import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'sql-formatter',
  category: 'dev',
  name: 'SQL formatter',
  title: 'SQL Formatter & Beautifier: PostgreSQL, MySQL, T-SQL & more',
  h1: 'SQL *formatter*',
  description: 'Format, beautify or minify SQL for PostgreSQL, MySQL, SQL Server, BigQuery, Snowflake, Oracle and more. Pick keyword case and indent. Nothing uploaded.',
  tagline: 'Turn one-line queries into readable SQL, in your database\'s dialect.',
  keywords: ['sql beautifier', 'format sql online', 'sql pretty print', 'sql minifier', 'postgresql formatter', 'mysql formatter', 't-sql formatter', 'bigquery sql formatter', 'snowflake sql formatter'],
  island: 'SqlFormatter',
  steps: [
    'Paste your SQL or open a .sql file.',
    'Pick your database dialect, keyword case and indent, or switch on minify.',
    'Copy the result or download it as a .sql file.',
  ],
  faq: [
    { q: 'Why does the dialect matter?', a: 'Databases differ in syntax: SQL Server uses [brackets] and #temp tables, PostgreSQL has $$ quoted bodies and :: casts, MySQL uses `backticks`. Picking yours lets the formatter read those correctly instead of stopping with an error.' },
    { q: 'Does formatting change what my query does?', a: 'No. Only whitespace, line breaks and, if you choose, the case of keywords and data types change; minify also drops comments. Table names, values and strings stay exactly as you wrote them.' },
    { q: 'What does minify do?', a: 'It removes comments and extra whitespace so each statement sits on one line, which is handy for embedding SQL in code or config. Optimizer hints like /*+ INDEX(...) */ are kept.' },
    { q: 'Why do I get an error?', a: 'The formatter has to understand the query to lay it out, so it stops at syntax it can\'t read and tells you the line and column. Most often the query is incomplete, or it uses syntax from a different dialect than the one selected.' },
    privacyFaq,
  ],
  related: ['json-formatter', 'diff-checker', 'css-minifier', 'js-minifier'],
} satisfies Tool;
