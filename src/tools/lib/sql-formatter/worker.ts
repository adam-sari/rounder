/// <reference lib="webworker" />
import { format, type SqlLanguage } from 'sql-formatter';
import { cleanError, minifySql } from './minify';

export interface FormatSettings {
  language: SqlLanguage;
  keywordCase: 'preserve' | 'upper' | 'lower';
  tabWidth: number;
  useTabs: boolean;
  linesBetweenQueries: number;
  minify: boolean;
}

export interface FormatRequest {
  sql: string;
  settings: FormatSettings;
}

const MYSQLISH = new Set<string>(['mysql', 'mariadb', 'tidb', 'singlestoredb']);
// dialects whose plain '…' strings sql-formatter reads with \' escapes; minify must agree with it
const BACKSLASH = new Set<string>([...MYSQLISH, 'sql', 'bigquery', 'spark', 'hive', 'clickhouse', 'snowflake']);

self.onmessage = (e: MessageEvent<FormatRequest>) => {
  const { sql, settings } = e.data;
  const { minify, ...options } = settings;
  const { language } = options;
  try {
    // formatting first applies keyword case and catches syntax errors, even when minifying;
    // data types (INT, VARCHAR) follow the keyword case as they did before sql-formatter 15
    const pretty = format(sql, { ...options, dataTypeCase: options.keywordCase });
    const out = minify
      ? minifySql(pretty, {
          backslashEscapes: BACKSLASH.has(language),
          hashComments: MYSQLISH.has(language),
          tripleQuotes: language === 'bigquery',
          batchSeparators: language === 'transactsql',
        })
      : pretty;
    self.postMessage({ out });
  } catch (err) {
    self.postMessage({ error: cleanError((err as Error)?.message ?? '', language) });
  }
};
