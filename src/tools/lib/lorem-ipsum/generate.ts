export type Unit = 'paragraphs' | 'sentences' | 'words' | 'items';
export type Flavor = 'latin' | 'english';
export type Format = 'text' | 'html' | 'markdown';

export interface LoremOptions {
  unit: Unit;
  count: number;
  flavor: Flavor;
  /** open with the familiar "Lorem ipsum dolor sit amet…" (Latin only) */
  classicStart: boolean;
  seed: number;
}

export const LIMITS: Record<Unit, number> = { paragraphs: 200, sentences: 1000, words: 20000, items: 500 };

const OPENING = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';

const LATIN = (
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ' +
  'enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in ' +
  'reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa ' +
  'qui officia deserunt mollit anim id est laborum ac accumsan aenean aliquam ante arcu at auctor augue bibendum blandit ' +
  'condimentum congue convallis cras curabitur cursus dapibus diam dictum dignissim donec egestas eget eleifend elementum ' +
  'eros etiam eu euismod facilisis fames faucibus felis fermentum feugiat fringilla gravida hendrerit iaculis imperdiet ' +
  'integer interdum justo lacinia lacus laoreet lectus leo libero ligula lobortis luctus maecenas massa mattis mauris metus ' +
  'mi molestie morbi nam nec neque nibh nisl nunc odio orci ornare pellentesque pharetra phasellus placerat porta porttitor ' +
  'posuere praesent pretium proin pulvinar purus quam quisque rhoncus risus rutrum sagittis sapien scelerisque semper ' +
  'sodales sollicitudin suscipit suspendisse tellus tincidunt tortor tristique turpis ultrices ultricies urna varius ' +
  'vehicula vel vestibulum vitae vivamus viverra volutpat vulputate'
).split(' ');

// Plain sentences that read naturally but say nothing, so nobody mistakes them for final copy.
const ENGLISH = [
  'This is placeholder text that stands in for the real thing.',
  'It shows how a block of writing will look once the page is finished.',
  'Swap it out for your own words when they are ready.',
  'A short sentence here helps you check the rhythm of the layout.',
  'Longer sentences like this one test how lines wrap and where the eye goes next.',
  'The headline above should tell readers what this section is about.',
  'Here is where the main idea would be explained in a little more detail.',
  'Good copy is clear, friendly and easy to scan.',
  'Most people skim first and read properly only when something catches their eye.',
  'Keep paragraphs short so the page feels light and approachable.',
  'This line is only here to fill space for now.',
  'Imagine a helpful explanation of a product, a service or an idea.',
  'You might mention who it is for and why it matters to them.',
  'A quick example often makes an abstract point easier to follow.',
  'Real text will probably be a little shorter or a little longer than this.',
  'Check how the spacing looks between this paragraph and the next one.',
  'The final wording will come later, once the design feels right.',
  'Every section needs a clear purpose and a natural place to end.',
  'Placeholder text lets you judge the design without getting stuck on the words.',
  'Readers like to know what to do next, so a clear next step helps.',
  'This sentence is a stand-in for a detail worth knowing.',
  'Here the writer would add a fact, a quote or a small story.',
  'A friendly tone usually works better than a formal one.',
  'Try reading the page aloud to hear whether it flows.',
  'Some lines are short.',
  'Others run on a bit to show how a longer thought sits on the page.',
  'Use this space to describe what makes the offer different.',
  'A list of benefits might fit nicely in a spot like this.',
  'Nothing here is final, and that is exactly the point.',
  'Think about what a first-time visitor would want to know.',
  'The real content should answer their question quickly.',
  'This paragraph will be replaced before anything goes live.',
  'Simple words travel further than clever ones.',
  'Leave room for images, buttons and a little breathing space.',
  'A good summary at the end ties the section together.',
  'Here the story would move on to the next point.',
  'This text has no meaning beyond showing where words will go.',
  'Designers use filler like this to focus on shape and balance.',
  'Make sure the important parts stand out from the rest.',
  'The closing line could invite the reader to take a look around.',
];

/** mulberry32: tiny seedable PRNG, so the same seed always gives the same text */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function makeSource(flavor: Flavor, seed: number) {
  const rand = rng(seed);
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  const word = () => LATIN[Math.floor(rand() * LATIN.length)];

  // English sentences are dealt like a shuffled deck so repeats stay far apart
  let deck: string[] = [];
  const englishSentence = () => {
    if (!deck.length) {
      deck = [...ENGLISH];
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
    }
    return deck.pop()!;
  };

  const latinSentence = () => {
    const n = int(6, 14);
    const parts: string[] = [];
    for (let i = 0; i < n; i++) parts.push(word() + (i > 2 && i < n - 2 && rand() < 0.12 ? ',' : ''));
    return cap(parts.join(' ')) + '.';
  };

  const sentence = flavor === 'latin' ? latinSentence : englishSentence;

  // English words are taken from whole sentences so the result still reads like text
  const words = (n: number) => {
    if (flavor === 'latin') return Array.from({ length: n }, word);
    const out: string[] = [];
    while (out.length < n) out.push(...sentence().split(' '));
    return out.slice(0, n);
  };

  return {
    int,
    sentence,
    words,
    item: () => (flavor === 'latin' ? cap(Array.from({ length: int(2, 6) }, word).join(' ')) : sentence().replace(/\.$/, '')),
  };
}

/** Returns blocks of text: one per paragraph or list item, or a single block for sentences and words */
export function generate(opts: LoremOptions): string[] {
  const count = Math.min(LIMITS[opts.unit], Math.max(1, Math.floor(opts.count) || 1));
  const src = makeSource(opts.flavor, opts.seed);
  const classic = opts.flavor === 'latin' && opts.classicStart;

  const sentences = (n: number, first: boolean) => {
    const out = Array.from({ length: n }, src.sentence);
    if (first && classic) out[0] = OPENING;
    return out.join(' ');
  };

  switch (opts.unit) {
    case 'paragraphs':
      return Array.from({ length: count }, (_, i) => sentences(src.int(4, 7), i === 0));
    case 'sentences':
      return [sentences(count, true)];
    case 'words': {
      const words = src.words(count);
      if (classic) OPENING.toLowerCase().replace(/[.,]/g, '').split(' ').slice(0, count).forEach((w, i) => (words[i] = w));
      return [cap(words.join(' ').replace(/[.,!?]$/, '')) + '.'];
    }
    case 'items': {
      const items = Array.from({ length: count }, src.item);
      if (classic) items[0] = 'Lorem ipsum dolor sit amet';
      return items;
    }
  }
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function render(blocks: string[], unit: Unit, format: Format): string {
  if (unit === 'items') {
    if (format === 'html') return `<ul>\n${blocks.map((b) => `  <li>${escapeHtml(b)}</li>`).join('\n')}\n</ul>`;
    if (format === 'markdown') return blocks.map((b) => `- ${b}`).join('\n');
    return blocks.join('\n');
  }
  if (format === 'html') return blocks.map((b) => `<p>${escapeHtml(b)}</p>`).join('\n\n');
  return blocks.join('\n\n');
}

export const extensions: Record<Format, string> = { text: 'txt', html: 'html', markdown: 'md' };
