/**
 * Finds where JSON text first goes wrong. Browsers word JSON.parse errors
 * differently (newer Chrome drops the position entirely), so we walk the
 * text ourselves and report a consistent line, column and reason.
 */
export interface JsonProblem {
  line: number;
  column: number;
  reason: string;
}

export function locateJsonError(src: string): JsonProblem | null {
  let i = 0;

  const fail = (reason: string): never => {
    throw { at: i, reason };
  };
  const ws = () => {
    while (i < src.length && ' \t\n\r'.includes(src[i])) i++;
  };
  const describe = () => (i >= src.length ? 'the end of the text' : `"${src[i]}"`);

  function value(): void {
    ws();
    const c = src[i];
    if (c === '{') return object();
    if (c === '[') return array();
    if (c === '"') return string();
    if (c === '-' || (c >= '0' && c <= '9')) return number();
    for (const word of ['true', 'false', 'null']) {
      if (src.startsWith(word, i)) {
        i += word.length;
        return;
      }
    }
    if (c === "'") fail('JSON strings need double quotes, not single quotes');
    fail(`expected a value but found ${describe()}`);
  }

  function object() {
    i++;
    ws();
    if (src[i] === '}') return void i++;
    for (;;) {
      ws();
      if (src[i] !== '"') fail(src[i] === '}' ? 'trailing comma before "}"' : `expected a "quoted" key but found ${describe()}`);
      string();
      ws();
      if (src[i] !== ':') fail(`expected ":" after the key but found ${describe()}`);
      i++;
      value();
      ws();
      if (src[i] === ',') {
        i++;
        continue;
      }
      if (src[i] === '}') return void i++;
      fail(`expected "," or "}" but found ${describe()}`);
    }
  }

  function array() {
    i++;
    ws();
    if (src[i] === ']') return void i++;
    for (;;) {
      ws();
      if (src[i] === ']') fail('trailing comma before "]"');
      value();
      ws();
      if (src[i] === ',') {
        i++;
        continue;
      }
      if (src[i] === ']') return void i++;
      fail(`expected "," or "]" but found ${describe()}`);
    }
  }

  function string() {
    i++;
    while (i < src.length && src[i] !== '"') {
      if (src[i] === '\n') fail('line break inside a string (use \\n)');
      if (src[i] === '\\') i++;
      i++;
    }
    if (i >= src.length) fail('a string is never closed');
    i++;
  }

  function number() {
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(src.slice(i));
    if (!m) fail('malformed number');
    i += m![0].length;
  }

  try {
    value();
    ws();
    if (i < src.length) fail(`unexpected ${describe()} after the end of the JSON`);
    return null;
  } catch (e) {
    const { at, reason } = e as { at: number; reason: string };
    const before = src.slice(0, at).split('\n');
    return { line: before.length, column: before.at(-1)!.length + 1, reason };
  }
}
