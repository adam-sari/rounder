import { describe, expect, it } from 'vitest';
import { cleanError, minifySql } from '@/tools/lib/sql-formatter/minify';

describe('minifySql', () => {
  it('collapses whitespace and drops spaces around brackets and commas', () => {
    expect(minifySql('SELECT\n  a,\n  b\nFROM\n  t\nWHERE\n  id IN ( 1, 2 )')).toBe('SELECT a,b FROM t WHERE id IN(1,2)');
  });

  it('removes comments but keeps hints and version comments', () => {
    expect(minifySql('SELECT a -- first\n, b /* note */ FROM t')).toBe('SELECT a,b FROM t');
    expect(minifySql('SELECT /*+ INDEX(t i) */ a FROM t /*!50000 x */')).toBe('SELECT /*+ INDEX(t i) */ a FROM t /*!50000 x */');
  });

  it('leaves strings and quoted names untouched', () => {
    expect(minifySql("SELECT 'a  --  b', \"my  col\", `x  y`, [z  w] FROM t")).toBe("SELECT 'a  --  b',\"my  col\",`x  y`,[z  w] FROM t");
    expect(minifySql("SELECT 'it''s   ok'")).toBe("SELECT 'it''s   ok'");
  });

  it('handles backslash escapes only when asked', () => {
    expect(minifySql("SELECT 'a\\'  b'", { backslashEscapes: true })).toBe("SELECT 'a\\'  b'");
    expect(minifySql("SELECT 'C:\\'  ,  1")).toBe("SELECT 'C:\\',1");
  });

  it('keeps dollar-quoted bodies', () => {
    expect(minifySql('CREATE FUNCTION f() AS $body$\n  SELECT  1;\n$body$ LANGUAGE sql')).toBe('CREATE FUNCTION f() AS $body$\n  SELECT  1;\n$body$ LANGUAGE sql');
    expect(minifySql('SELECT $1 ,  $2')).toBe('SELECT $1,$2');
  });

  it('puts each statement on its own line', () => {
    expect(minifySql('SELECT 1;\n\n\nSELECT   2;\n')).toBe('SELECT 1;\nSELECT 2;');
  });

  it('treats # as a comment only for MySQL', () => {
    expect(minifySql('SELECT * FROM #temp')).toBe('SELECT * FROM #temp');
    expect(minifySql('SELECT 1 # note\n, 2', { hashComments: true })).toBe('SELECT 1,2');
  });

  it('keeps BigQuery triple-quoted strings whole', () => {
    expect(minifySql("SELECT\n  '''a  ' b  c'''\nFROM\n  t", { tripleQuotes: true })).toBe("SELECT '''a  ' b  c''' FROM t");
  });

  it('keeps T-SQL GO on its own line', () => {
    expect(minifySql('SELECT\n  1\nGO\nSELECT\n  2;\ngo\n', { batchSeparators: true })).toBe('SELECT 1\nGO\nSELECT 2;\ngo');
    expect(minifySql('SELECT\n  1\nGO\nSELECT\n  2')).toBe('SELECT 1 GO SELECT 2');
  });

  it('keeps operators intact', () => {
    expect(minifySql('SELECT a - b, c / d, x::int FROM t')).toBe('SELECT a - b,c / d,x::int FROM t');
  });
});

describe('cleanError', () => {
  it('shortens parser dumps', () => {
    expect(cleanError('Parse error at token: «EOF» at line 1 column 29\nUnexpected EOF token: {...}', 'sql')).toMatch(/^The query ends too early \(line 1, column 29\)/);
    expect(cleanError('Parse error at token: ) at line 2 column 4\nlots of grammar', 'mysql')).toBe('Unexpected ")" at line 2, column 4. Check the dialect matches your database.');
    expect(cleanError('Parse error: Unexpected "[x] FROM #" at line 1 column 8.\nThis likely happens…', 'sql')).toMatch(/^Couldn't read "\[x\] FROM #" at line 1, column 8\. If your query/);
  });
});
