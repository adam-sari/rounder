import { describe, expect, it } from 'vitest';
import tool from '@/tools/defs/text-to-speech';
import { fileStem, formatSpoken, joinAudio, MAX_CHARS, splitParagraphs, splitSentences, textStats } from '@/tools/lib/text-to-speech/text';
import { previewLine, VOICES, voiceById } from '@/tools/lib/text-to-speech/voices';

describe('splitParagraphs', () => {
  it('splits on blank lines and line breaks', () => {
    expect(splitParagraphs('One.\n\nTwo.\nThree.')).toEqual(['One.', 'Two.', 'Three.']);
  });

  it('keeps headings and list items apart', () => {
    expect(splitParagraphs('Chapter One\nIt was late.\n- apples\n- pears')).toEqual(['Chapter One', 'It was late.', '- apples', '- pears']);
  });

  it('re-joins hard-wrapped prose', () => {
    const wrapped = 'This line was wrapped by an email client at roughly seventy\nCharacters, and it goes on\nwith the rest of the sentence.';
    expect(splitParagraphs(wrapped)).toEqual(['This line was wrapped by an email client at roughly seventy Characters, and it goes on with the rest of the sentence.']);
  });

  it('collapses whitespace and handles Windows line endings', () => {
    expect(splitParagraphs('  Hello   there.\r\n\r\n\tBye.  ')).toEqual(['Hello there.', 'Bye.']);
    expect(splitParagraphs(' \n\n ')).toEqual([]);
  });
});

describe('splitSentences', () => {
  it('splits on sentence punctuation', () => {
    expect(splitSentences('Hello there. How are you? Great! Fine…')).toEqual(['Hello there.', 'How are you?', 'Great!', 'Fine…']);
  });

  it('keeps closing quotes with their sentence', () => {
    expect(splitSentences('She said "stop." Then she left.')).toEqual(['She said "stop."', 'Then she left.']);
  });

  it('does not split after abbreviations, initials or before lowercase', () => {
    expect(splitSentences('Dr. Smith met J. K. Rowling at 5 p.m. today. It went well.')).toEqual(['Dr. Smith met J. K. Rowling at 5 p.m. today.', 'It went well.']);
    expect(splitSentences('Bring fruit, e.g. apples. Thanks.')).toEqual(['Bring fruit, e.g. apples.', 'Thanks.']);
  });

  it('ends a sentence on "no."', () => {
    expect(splitSentences('I said no. Then I left.')).toEqual(['I said no.', 'Then I left.']);
  });

  it('breaks long sentences at clauses, then between words, within the limit', () => {
    const clause = 'this clause is a fairly long stretch of words that keeps going';
    const long = `${Array.from({ length: 12 }, () => clause).join(', ')}.`;
    const parts = splitSentences(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= MAX_CHARS)).toBe(true);
    expect(parts.join(' ')).toBe(long);

    const words = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
    const chunks = splitSentences(words, 100);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    expect(chunks.join(' ')).toBe(words);
  });
});

describe('textStats & formatSpoken', () => {
  it('counts words and estimates speaking time', () => {
    const s = textStats('One two three, four.');
    expect(s).toMatchObject({ chars: 20, words: 4 });
    expect(s.seconds).toBeCloseTo((4 / 155) * 60);
    expect(textStats('').words).toBe(0);
  });

  it('formats spoken lengths', () => {
    expect(formatSpoken(0.2)).toBe('1 s');
    expect(formatSpoken(42)).toBe('42 s');
    expect(formatSpoken(185)).toBe('3 min');
    expect(formatSpoken(3900)).toBe('1 h 05 min');
  });
});

describe('joinAudio', () => {
  it('puts silence between clips but not after the last', () => {
    const out = joinAudio(
      [
        { audio: new Float32Array([1, 1]), gap: 0.5 },
        { audio: new Float32Array([2]), gap: 9 },
      ],
      4,
    );
    expect([...out]).toEqual([1, 1, 0, 0, 2]);
    expect(joinAudio([]).length).toBe(0);
  });
});

describe('fileStem', () => {
  it('names the download after the first words', () => {
    expect(fileStem("Hello, World! It's a fine day today.")).toBe('hello-world-it-s-a');
    expect(fileStem('Café déjà vu')).toBe('cafe-deja-vu');
    expect(fileStem('!!!')).toBe('speech');
  });
});

describe('voices', () => {
  it('lists all 28 English Kokoro voices once each', () => {
    expect(VOICES).toHaveLength(28);
    expect(new Set(VOICES.map((v) => v.id)).size).toBe(28);
    for (const v of VOICES) expect(v.id.startsWith(`${v.accent === 'US' ? 'a' : 'b'}${v.gender === 'female' ? 'f' : 'm'}_`)).toBe(true);
  });

  it('previews with the reader\'s first sentence when it is short', () => {
    const heart = voiceById('af_heart')!;
    expect(previewLine(heart, 'Good morning.')).toBe('Good morning.');
    expect(previewLine(heart)).toContain('Heart');
    expect(previewLine(heart, 'x'.repeat(200))).toContain('Heart');
  });
});

describe('page copy', () => {
  it('fits search limits', () => {
    expect(tool.title.length).toBeLessThanOrEqual(65);
    expect(tool.description.length).toBeLessThanOrEqual(160);
    expect(tool.keywords.length).toBeGreaterThanOrEqual(6);
    expect(tool.keywords.length).toBeLessThanOrEqual(10);
    expect(tool.steps).toHaveLength(3);
  });
});

describe('nothing to say', () => {
  it('drops separator lines and punctuation-only pieces', () => {
    expect(splitParagraphs('Intro.\n\n***\n\n---\nEnd.')).toEqual(['Intro.', 'End.']);
    expect(splitSentences('Wait… … Done.')).toEqual(['Wait…', 'Done.']);
    expect(splitSentences('— !')).toEqual([]);
  });
});
