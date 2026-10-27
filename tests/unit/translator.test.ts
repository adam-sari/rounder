import { describe, expect, it } from 'vitest';
import tool from '@/tools/defs/translator';
import { guessLanguage } from '@/tools/lib/translator/detect';
import { assemble, prepare, restore, translateDoc } from '@/tools/lib/translator/doc';
import { hop, normalizeLanguage, opusCoverage, opusRoute } from '@/tools/lib/translator/languages';

/** a fake translator that upper-cases text and keeps placeholders, like a well-behaved model */
const upper = async (texts: string[]) => texts.map((t) => t.replace(/[^{}\d]+/g, (s) => s.toUpperCase()));

describe('page copy', () => {
  it('fits search limits', () => {
    expect(tool.title.length).toBeLessThanOrEqual(65);
    expect(tool.description.length).toBeLessThanOrEqual(160);
    expect(tool.keywords.length).toBeGreaterThanOrEqual(6);
    expect(tool.faq.at(-1)!.q).toMatch(/uploaded/);
  });
});

describe('languages', () => {
  it('normalizes browser tags', () => {
    expect(normalizeLanguage('pt-BR')).toBe('pt');
    expect(normalizeLanguage('zh-TW')).toBe('zh-Hant');
    expect(normalizeLanguage('zh-Hans-CN')).toBe('zh');
    expect(normalizeLanguage('iw')).toBe('he');
    expect(normalizeLanguage('nb')).toBe('no');
    expect(normalizeLanguage('xx')).toBeNull();
  });

  it('routes through registry models, pivoting through English', () => {
    expect(opusRoute('en', 'de')).toEqual([{ key: 'opus-mt-en-de' }]);
    expect(opusRoute('de', 'fr')).toEqual([{ key: 'opus-mt-de-en' }, { key: 'opus-mt-en-fr' }]);
    expect(opusRoute('ja', 'es')).toEqual([{ key: 'opus-mt-ja-en' }, { key: 'opus-mt-en-es' }]);
    // no English → Japanese model exists
    expect(opusRoute('en', 'ja')).toBeNull();
    expect(opusRoute('es', 'ja')).toBeNull();
    expect(hop('en', 'bn')).toBeNull();
  });

  it('summarizes coverage for page copy', () => {
    const c = opusCoverage();
    expect(c.both).toContain('Spanish');
    expect(c.intoEnglish).toEqual(expect.arrayContaining(['Japanese', 'Korean']));
  });
});

describe('guessLanguage', () => {
  it.each([
    ['The quick brown fox jumps over the lazy dog and it was not happy with this.', 'en'],
    ['El perro de mi vecino es muy grande y no le gusta que lo dejen solo en casa.', 'es'],
    ['Je ne sais pas pourquoi le chat est sur la table avec les enfants.', 'fr'],
    ['Ich weiß nicht, warum die Katze auf dem Tisch ist und nicht schläft.', 'de'],
    ['Eu não sei por que o gato está em cima da mesa com as crianças.', 'pt'],
    ['Nie wiem, dlaczego kot jest na stole, ale to jest bardzo śmieszne.', 'pl'],
    ['Привет, как дела? Я давно тебя не видел.', 'ru'],
    ['Привіт, як справи? Я дуже давно тебе не бачив, їжак.', 'uk'],
    ['今日はとても良い天気ですね。散歩に行きましょう。', 'ja'],
    ['今天天气很好，我们去散步吧。', 'zh'],
    ['안녕하세요, 오늘 날씨가 정말 좋네요.', 'ko'],
    ['مرحبا، كيف حالك اليوم؟', 'ar'],
  ])('%s → %s', (text, lang) => expect(guessLanguage(text)).toBe(lang));

  it('stays undecided on too little text', () => {
    expect(guessLanguage('ok')).toBeNull();
    expect(guessLanguage('123 456')).toBeNull();
  });
});

describe('prepare + translateDoc', () => {
  it('splits plain text into sentences and keeps line structure', async () => {
    const doc = prepare('Hello there. How are you?\n\n  Fine, thanks!  ', { maxChars: 400, lang: 'en' });
    expect(doc.units.map((u) => u.text)).toEqual(['Hello there.', 'How are you?', 'Fine, thanks!']);
    expect(await translateDoc(doc, upper, 'es')).toBe('HELLO THERE. HOW ARE YOU?\n\n  FINE, THANKS!  ');
  });

  it('groups sentences up to maxChars when asked', () => {
    const doc = prepare('One. Two. Three.', { maxChars: 10, group: true, lang: 'en' });
    expect(doc.units.map((u) => u.text)).toEqual(['One. Two.', 'Three.']);
  });

  it('cuts overlong sentences at clause breaks', () => {
    const long = `${'word '.repeat(30)}, and ${'more '.repeat(30)}end`;
    const doc = prepare(long, { maxChars: 200 });
    expect(doc.units.length).toBeGreaterThan(1);
    expect(doc.units.every((u) => u.text.length <= 200)).toBe(true);
  });

  it('protects URLs in plain text', async () => {
    const doc = prepare('See https://example.com/a.b for more.', { maxChars: 400, lang: 'en' });
    expect(doc.units[0]).toEqual({ text: 'See {0} for more.', slots: ['https://example.com/a.b'] });
    expect(await translateDoc(doc, upper, 'fr')).toBe('SEE https://example.com/a.b FOR MORE.');
  });

  it('keeps Markdown structure and inline code, links and HTML', async () => {
    const md = [
      '---',
      'title: Hello',
      '---',
      '# Getting started',
      '',
      '- [ ] Install the `cli` tool from [our site](https://x.dev/cli "CLI").',
      '> Quoted text here.',
      '',
      '```js',
      'const greeting = "hello";',
      '```',
      '',
      '| Name | Notes |',
      '| --- | :-: |',
      '| Apple | A red fruit |',
      '',
      '***',
      '<br>',
      '1. ![logo](logo.png) Done.',
    ].join('\n');
    const out = await translateDoc(prepare(md, { markdown: true, maxChars: 400, lang: 'en' }), upper, 'de');
    expect(out).toBe(
      [
        '---',
        'title: Hello',
        '---',
        '# GETTING STARTED',
        '',
        '- [ ] INSTALL THE `cli` TOOL FROM [OUR SITE](https://x.dev/cli "CLI").',
        '> QUOTED TEXT HERE.',
        '',
        '```js',
        'const greeting = "hello";',
        '```',
        '',
        '| NAME | NOTES |',
        '| --- | :-: |',
        '| APPLE | A RED FRUIT |',
        '',
        '***',
        '<br>',
        '1. ![logo](logo.png) DONE.',
      ].join('\n'),
    );
  });

  it('re-translates fragments when a model drops a placeholder', async () => {
    const doc = prepare('Read the [guide](https://x.dev) first.', { markdown: true, maxChars: 400, lang: 'en' });
    const calls: string[][] = [];
    const lossy = async (texts: string[]) => {
      calls.push(texts);
      return calls.length === 1 ? texts.map(() => 'LEA LA GUÍA PRIMERO.') : texts.map((t) => t.toUpperCase());
    };
    expect(await translateDoc(doc, lossy, 'es')).toBe('READ THE [GUIDE](https://x.dev) FIRST.');
    expect(calls[1]).toEqual(['Read the', 'guide', 'first.']);
  });

  it('keeps literal placeholder-like text intact', async () => {
    const doc = prepare('Use {0} as the name.', { maxChars: 400 });
    expect(await translateDoc(doc, upper, 'es')).toBe('USE {0} AS THE NAME.');
  });

  it('drops the space between sentences for Chinese and Japanese', () => {
    const doc = prepare('Hi. Bye.', { maxChars: 400, lang: 'en' });
    expect(assemble(doc, ['你好。', '再见。'], 'zh')).toBe('你好。再见。');
    expect(assemble(doc, ['Hola.', 'Adiós.'], 'es')).toBe('Hola. Adiós.');
  });

  it('adds the space between sentences when Chinese or Japanese go into a spaced language', () => {
    const doc = prepare('今天天气很好。我们去散步吧。', { maxChars: 400, lang: 'zh' });
    expect(assemble(doc, ['The weather is nice today.', "Let's go for a walk."], 'en')).toBe("The weather is nice today. Let's go for a walk.");
    expect(assemble(doc, ['今日はいい天気です。', '散歩に行きましょう。'], 'ja')).toBe('今日はいい天気です。散歩に行きましょう。');
  });

  it('keeps lines without words verbatim', () => {
    const doc = prepare('123\n—\n`x`', { markdown: true, maxChars: 400 });
    expect(doc.units).toEqual([]);
    expect(assemble(doc, [], 'es')).toBe('123\n—\n`x`');
  });

  it('restore accepts spaced placeholders and rejects missing ones', () => {
    expect(restore('a { 0 } b', ['X'])).toBe('a X b');
    expect(restore('a b', ['X'])).toBeNull();
    expect(restore('{0} {0}', ['X'])).toBeNull();
  });
});
