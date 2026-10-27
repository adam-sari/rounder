import { filePrivacyFaq, type Tool } from '../types';

// Compress PDF opened at a target size. Each page has its own number, its own copy about what fits at that size, and
// the same working tool underneath (CompressPdf { targetKb }); the hub /compress-to-exact-size lists them all.

type Copy = Pick<Tool, 'slug' | 'name' | 'title' | 'h1' | 'description' | 'tagline' | 'keywords' | 'steps' | 'faq'>;

const preset = (targetKb: number, copy: Copy): Tool => ({
  ...copy,
  category: 'pdf',
  island: 'CompressPdf',
  props: { targetKb },
  variantOf: 'compress-pdf',
  related: ['compress-pdf', 'split-pdf', 'jpg-to-pdf', 'merge-pdf'],
});

const howKb = {
  q: 'Does "100 KB" mean 100,000 or 102,400 bytes?',
  a: 'We aim under 1 KB = 1,000 bytes, the stricter of the two. A file that fits here also passes an upload form that counts 1 KB as 1,024 bytes, so you never have to guess which one a site uses.',
};

export default [
  preset(50, {
    slug: 'compress-pdf-to-50kb',
    name: 'Compress PDF to 50 KB',
    title: 'Compress PDF to 50 KB: shrink a PDF under 50 KB, no upload',
    h1: 'Compress PDF to *50 KB*',
    description: 'Get a PDF under 50 KB for a strict upload form. The tool finds the sharpest photos that fit and tells you plainly if 50 KB is out of reach. No upload.',
    tagline: 'For the strictest upload boxes: one or two pages, under 50 KB.',
    keywords: ['compress pdf to 50kb', 'pdf under 50kb', 'reduce pdf size to 50kb', 'pdf 50 kb', 'compress pdf below 50kb'],
    steps: [
      'Drop in your PDF. The target is already set to 50 KB; type another number if your form asks for one.',
      'The tool tries a few photos first to estimate, then compresses the whole file at the sharpest setting that fits.',
      'Check the result line ("✓ fits" or why not), then download it.',
    ],
    faq: [
      {
        q: 'Can any PDF get under 50 KB?',
        a: 'Not always. 50 KB is enough for a one-page letter, or one scanned page at low resolution. Text, fonts and drawings can\'t be squeezed much further without turning pages into pictures, so a long typed document may stay above 50 KB however hard the photos are compressed. When that happens, the tool shows how far off it is and offers grayscale or a split.',
      },
      {
        q: 'My scan is still too big. What helps most?',
        a: 'Fewer pages and less color. Scan only the page the form asks for, use the grayscale option (a gray photo needs less data than a color one), and crop away empty margins before scanning. Each of these helps more than lowering quality further.',
      },
      howKb,
      filePrivacyFaq,
    ],
  }),
  preset(100, {
    slug: 'compress-pdf-to-100kb',
    name: 'Compress PDF to 100 KB',
    title: 'Compress PDF to 100 KB: get any PDF under 100 KB, free',
    h1: 'Compress PDF to *100 KB*',
    description: 'Shrink a PDF to under 100 KB for an online application. It keeps the sharpest photos that fit and shows the exact result: ✓ fits, or why not. No upload.',
    tagline: 'For application forms that cap each document at 100 KB.',
    keywords: ['compress pdf to 100kb', 'pdf to 100kb', 'reduce pdf size to 100kb', 'pdf under 100kb', 'pdf size 100kb', 'compress pdf below 100kb'],
    steps: [
      'Drop in one or more PDFs. The target is set to 100 KB; change it if your form says otherwise.',
      'Each file is estimated from a few of its photos, then compressed in one to three passes at the sharpest setting that fits.',
      'Read the result line under each file, then download it or all of them as a zip.',
    ],
    faq: [
      {
        q: 'Where is 100 KB asked for?',
        a: 'Online applications often cap each uploaded document at a fixed size, and 100 KB is one of the most common: certificates, ID proofs, mark sheets and signed forms for job, exam, university and government portals. The limit is per file, so each PDF is aimed under 100 KB on its own.',
      },
      {
        q: 'How many pages fit in 100 KB?',
        a: 'Typed pages from Word or a website are small, and several usually fit. Scanned pages are photos: as a rough guide, one or two scanned pages fit comfortably, while five or more usually need 72 dpi or grayscale. The result line tells you what it took, so you can check that small print still reads well.',
      },
      {
        q: 'What if it can\'t reach 100 KB?',
        a: 'You get the smallest version it made, a plain reason (for example, the text and fonts alone are over the limit), and two ways forward: grayscale photos, or splitting the PDF into parts that each fit. It never pretends a file fits when it doesn\'t.',
      },
      howKb,
      filePrivacyFaq,
    ],
  }),
  preset(200, {
    slug: 'compress-pdf-to-200kb',
    name: 'Compress PDF to 200 KB',
    title: 'Compress PDF to 200 KB: reduce PDF size under 200 KB',
    h1: 'Compress PDF to *200 KB*',
    description: 'Reduce a PDF to under 200 KB with photos as sharp as the limit allows. Every result is checked against 200 KB, with a clear reason if it misses. No upload.',
    tagline: 'Room for a few scanned pages, still crisp enough to read.',
    keywords: ['compress pdf to 200kb', 'pdf to 200kb', 'reduce pdf size to 200kb', 'pdf under 200kb', 'pdf size 200kb', 'compress pdf below 200kb'],
    steps: [
      'Drop in your PDFs. The target starts at 200 KB.',
      'The tool estimates from a sample of photos, then compresses each file at the best setting that stays under 200 KB.',
      'Check "Result: … ✓ fits" under each file and download.',
    ],
    faq: [
      {
        q: 'What fits in 200 KB?',
        a: 'Most typed documents, and a handful of scanned pages at around 100 dpi, which is still comfortable to read on screen. A long scan, or one in full color with many photos, may need lower resolution or grayscale, and the result line says which setting it used.',
      },
      {
        q: 'Will the text get blurry?',
        a: 'Typed text, fonts and drawings are never turned into pictures, so they stay sharp at any size. Only photos and scanned pages are resampled. On a scan, the whole page is a photo, so at the lowest settings small print can soften; zoom in and check before you submit.',
      },
      howKb,
      filePrivacyFaq,
    ],
  }),
  preset(300, {
    slug: 'compress-pdf-to-300kb',
    name: 'Compress PDF to 300 KB',
    title: 'Compress PDF to 300 KB: make a PDF under 300 KB online',
    h1: 'Compress PDF to *300 KB*',
    description: 'Make a PDF smaller than 300 KB, keeping photos as sharp as the size allows. The result is checked against 300 KB and the reason is shown if it misses.',
    tagline: 'A middle size: multi-page scans that stay readable.',
    keywords: ['compress pdf to 300kb', 'pdf to 300kb', 'pdf under 300kb', 'reduce pdf to 300 kb', 'pdf size 300kb'],
    steps: [
      'Drop in your PDFs; the target is 300 KB.',
      'Each file is estimated from a few photos, then compressed at the sharpest setting that fits.',
      'Check the result line and download one file or a zip.',
    ],
    faq: [
      {
        q: 'Why 300 KB?',
        a: 'It\'s a common cap for supporting documents in online applications where 100 KB is too tight for a multi-page scan. At 300 KB, two or three scanned pages can usually keep a higher resolution than 100 KB allows, so they read well on screen and print legibly.',
      },
      {
        q: 'What if my PDF is already under 300 KB?',
        a: 'You get it back after a lossless repack, which sometimes trims a little more, and the photos are left untouched. Nothing is made worse just to hit a number.',
      },
      howKb,
      filePrivacyFaq,
    ],
  }),
  preset(500, {
    slug: 'compress-pdf-to-500kb',
    name: 'Compress PDF to 500 KB',
    title: 'Compress PDF to 500 KB: shrink PDFs under 500 KB, free',
    h1: 'Compress PDF to *500 KB*',
    description: 'Shrink a PDF to under 500 KB with the sharpest photos that fit. Batches welcome, each result checked against 500 KB. Runs on your device, nothing uploaded.',
    tagline: 'Half a megabyte: enough for most scans at print quality.',
    keywords: ['compress pdf to 500kb', 'pdf to 500kb', 'pdf under 500kb', 'reduce pdf size to 500kb', 'pdf less than 500kb'],
    steps: [
      'Drop in one or many PDFs. The target is 500 KB.',
      'The tool estimates each file from a few photos, then compresses it in as few full passes as it can.',
      'Read the result line, then download each PDF or all of them as a zip.',
    ],
    faq: [
      {
        q: 'How much quality is left at 500 KB?',
        a: 'Usually plenty for a short document. A few scanned pages often fit at 150 dpi, a good print resolution, and a photo-heavy flyer keeps photos that look fine on screen. Longer scans step down to lower settings. The result line shows the resolution and quality it settled on.',
      },
      {
        q: 'Why did it take a few passes?',
        a: 'The first estimate comes from a sample of the photos, so it can be a little off. If the first full pass lands over 500 KB, the next aims lower by however much it missed; if it lands far under, it tries a sharper setting. It stops after three passes.',
      },
      howKb,
      filePrivacyFaq,
    ],
  }),
  preset(1000, {
    slug: 'compress-pdf-to-1mb',
    name: 'Compress PDF to 1 MB',
    title: 'Compress PDF to 1 MB: reduce PDF size under 1 MB, free',
    h1: 'Compress PDF to *1 MB*',
    description: 'Get a PDF under 1 MB for email, a portal or a job application, with photos kept as sharp as 1 MB allows. Each result is checked. No upload, no sign-up.',
    tagline: 'Under a megabyte, with photos that still look good.',
    keywords: ['compress pdf to 1mb', 'pdf to 1mb', 'pdf under 1mb', 'reduce pdf size to 1mb', 'compress pdf less than 1mb', 'pdf 1 mb'],
    steps: [
      'Drop in your PDFs; the target is 1 MB (1,000,000 bytes).',
      'Each file is estimated from a few photos and compressed at the sharpest setting under 1 MB.',
      'Check the result line, then download.',
    ],
    faq: [
      {
        q: 'Is 1 MB 1,000 KB or 1,024 KB here?',
        a: 'We aim under 1,000,000 bytes, the smaller of the two definitions, so the file passes either way a site counts it.',
      },
      {
        q: 'What usually needs compressing to 1 MB?',
        a: 'Phone scans and photo-heavy PDFs. A phone camera page is often 2–4 MB on its own, mostly because the photo is far sharper than a page needs. Bringing it to 150–200 dpi usually gets several pages under 1 MB with no visible difference on screen.',
      },
      howKb,
      filePrivacyFaq,
    ],
  }),
  preset(2000, {
    slug: 'compress-pdf-to-2mb',
    name: 'Compress PDF to 2 MB',
    title: 'Compress PDF to 2 MB: make a PDF smaller than 2 MB',
    h1: 'Compress PDF to *2 MB*',
    description: 'Shrink a large PDF under 2 MB with the least loss. The tool tries the sharpest settings first and checks each result against 2 MB. Nothing is uploaded.',
    tagline: 'Big reports and long scans, under 2 MB with little visible change.',
    keywords: ['compress pdf to 2mb', 'pdf to 2mb', 'pdf under 2mb', 'reduce pdf size to 2mb', 'pdf less than 2 mb'],
    steps: [
      'Drop in your PDFs; the target is 2 MB.',
      'Each file is estimated from a sample of photos, then compressed at the sharpest setting that fits.',
      'Check the result line and download.',
    ],
    faq: [
      {
        q: 'Will a big PDF work in my browser?',
        a: 'Usually, yes. Files are handled one at a time so each gets all the memory it needs, and the photos are worked on two at a time. A very large scan (hundreds of pages) can still be too much for a phone; a computer handles it more easily.',
      },
      {
        q: 'Does 2 MB keep print quality?',
        a: 'Often. The tool starts at 200 dpi, which prints sharply, and only steps down when the file won\'t fit. The result line shows where it ended up.',
      },
      howKb,
      filePrivacyFaq,
    ],
  }),
] satisfies Tool[];
