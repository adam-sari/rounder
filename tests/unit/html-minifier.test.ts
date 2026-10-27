import { describe, expect, it } from 'vitest';
import { minifyCss } from '../../src/tools/lib/code-minifier/css';
import { minifyHtml, type InlineMinifiers } from '../../src/tools/lib/code-minifier/html';
import { minifyJs } from '../../src/tools/lib/code-minifier/js';
import { defaultOptions } from '../../src/tools/lib/code-minifier/options';

const inline: InlineMinifiers = {
  css: (code, context) => minifyCss(code, defaultOptions, context),
  js: (code, module) => minifyJs(code, { ...defaultOptions, module }),
};
const run = async (src: string, opts = {}) => (await minifyHtml(src, { ...defaultOptions, ...opts }, inline)).code;

describe('minifyHtml', () => {
  it('removes whitespace between blocks but keeps meaningful spaces', async () => {
    expect(await run('<div>\n  <p>\n    Hello   <b>big</b>   world !\n  </p>\n</div>\n')).toBe('<div><p>Hello <b>big</b> world !</p></div>');
  });

  it('keeps pre and textarea content exactly', async () => {
    const pre = '<pre>  a\n    <b> b </b>\n</pre>';
    expect(await run(`<div>\n${pre}\n</div>`)).toBe(`<div>${pre}</div>`);
    expect(await run('<p>x <textarea>  keep\n  me </textarea> y</p>')).toBe('<p>x <textarea>  keep\n  me </textarea> y</p>');
  });

  it('removes comments but keeps conditional comments', async () => {
    expect(await run('<p>a <!-- note --> b</p><!--[if IE]><p>old</p><![endif]-->')).toBe('<p>a b</p><!--[if IE]><p>old</p><![endif]-->');
    expect(await run('<p>a<!-- x -->b</p>', { removeComments: false })).toBe('<p>a<!-- x -->b</p>');
  });

  it('does not glue words around inline scripts', async () => {
    expect(await run('<p>Hello <script>var a = 1</script> world</p>')).toBe('<p>Hello <script>var a=1;</script> world</p>');
  });

  it('minifies style and script blocks and style attributes', async () => {
    const out = await run('<style>\n a { color: #ff0000 }\n</style>\n<p style="margin: 0px; font-family: \'A B\'">x</p>\n<script>\n function f(longName) { return longName }\n f(1)\n</script>');
    // CSSO prefers double quotes, so the attribute switches to single ones
    expect(out).toBe('<style>a{color:red}</style><p style=\'margin:0;font-family:"A B"\'>x</p><script>function f(f){return f}f(1);</script>');
  });

  it('handles quotes and entities in style attributes', async () => {
    expect(await run("<p style='font-family: \"A B\"'>x</p>")).toBe('<p style=\'font-family:"A B"\'>x</p>');
    expect(await run('<p style="background: url(\'a.png\'); font-family: &quot;A B&quot;">x</p>')).toBe('<p style="background: url(\'a.png\'); font-family: &quot;A B&quot;">x</p>');
  });

  it('compacts JSON scripts and leaves unknown script types alone', async () => {
    expect(await run('<script type="application/ld+json">\n{ "a": "</b>",\n "n": 1 }\n</script>')).toBe('<script type="application/ld+json">{"a":"<\\/b>","n":1}</script>');
    const template = '<script type="text/template">  <b> {{ x }} </b>  </script>';
    expect(await run(template)).toBe(template);
  });

  it('leaves a broken inline script as is and reports where it went wrong', async () => {
    const result = await minifyHtml('<p>x</p>\n<script>\nlet a = ;\n</script>', defaultOptions, inline);
    expect(result.code).toBe('<p>x</p><script>\nlet a = ;\n</script>');
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toMatchObject({ line: 3 });
    expect(result.notes[0].message).toMatch(/In a <script> block.*left as is/);
  });

  it('tidies tags and keeps attribute values intact', async () => {
    expect(await run('<a   href = "x > y"  class=" a   b "   data-x=1   hidden >link</a>')).toBe('<a href="x > y" class="a b" data-x=1 hidden>link</a>');
    expect(await run('<svg viewBox="0 0 1 1"><path d="M0 0"/><use href=a /></svg>')).toBe('<svg viewBox="0 0 1 1"><path d="M0 0"/><use href=a /></svg>');
  });

  it('keeps the doctype and trims titles', async () => {
    expect(await run('<!DOCTYPE html>\n<html>\n<head>\n<title>  My   page </title>\n<meta charset="utf-8">\n</head>\n</html>')).toBe(
      '<!DOCTYPE html><html><head><title>My page</title><meta charset="utf-8"></head></html>',
    );
  });

  it('leaves text with a stray < alone', async () => {
    expect(await run('<p>1 < 2 and 3 > 2</p>')).toBe('<p>1 < 2 and 3 > 2</p>');
  });

  it('keeps processing instructions whole', async () => {
    expect(await run('<p>\n  <?php echo $a->b;   ?>\n</p>')).toBe('<p><?php echo $a->b;   ?></p>');
    expect(await run('<p>Hello <?php echo $name ?> there</p>')).toBe('<p>Hello <?php echo $name ?> there</p>');
  });
});
