import { filePrivacyFaq, type Tool } from '../types';

// The image resizer opened at a file size (or a size range, or a size in cm). Each page carries copy for its own number;
// the working tool underneath is ImageResizer with props, and /compress-to-exact-size lists them all.

type Copy = Pick<Tool, 'slug' | 'name' | 'title' | 'h1' | 'description' | 'tagline' | 'keywords' | 'steps' | 'faq'>;

const preset = (props: Record<string, unknown>, copy: Copy): Tool => ({
  ...copy,
  category: 'image',
  island: 'ImageResizer',
  props,
  variantOf: 'image-resizer',
  related: ['image-resizer', 'image-compressor', 'crop-image', 'passport-photo-maker'],
});

const howKb = {
  q: 'Which KB does it use, 1,000 or 1,024 bytes?',
  a: 'It aims under 1 KB = 1,000 bytes, the stricter of the two, so the file also passes forms that count 1,024. The result line shows the size the same way.',
};

const how = (kb: string) => [
  `Drop in one photo or a whole batch. The limit is already set to ${kb}; type your own number if the form asks for another.`,
  'Each file gets the highest JPG quality that fits, and is made smaller in pixels only if quality alone isn\'t enough.',
  'Check the result line under each file ("✓ fits", or why not), then download one by one or as a zip.',
];

export default [
  preset({ mode: 'target', targetKb: 20 }, {
    slug: 'compress-image-to-20kb',
    name: 'Compress image to 20 KB',
    title: 'Compress Image to 20 KB: reduce photo size under 20 KB',
    h1: 'Compress image to *20 KB*',
    description: 'Reduce a JPG, PNG or phone photo to under 20 KB for a strict upload form. Best quality that fits, resized only if needed, checked on every file. No upload.',
    tagline: 'For the smallest upload boxes, with the result checked on each file.',
    keywords: ['compress image to 20kb', 'reduce image size to 20kb', 'photo under 20kb', 'jpg to 20kb', 'image size 20kb', 'resize image to 20kb'],
    steps: how('20 KB'),
    faq: [
      {
        q: 'Will a phone photo really fit in 20 KB?',
        a: 'Yes, but not at its full size. A 12-megapixel photo has far more pixels than 20 KB can hold, so after quality alone fails the tool scales it down, often to around 400–600 pixels across. That still looks fine for an ID photo or a thumbnail. The result shows the new pixel size.',
      },
      {
        q: 'The form also asks for a pixel size. Can I set both?',
        a: 'Yes. Tick "Exact dimensions too" and type the width and height (in pixels, cm, mm or inches). The picture is cropped to that shape and only the quality moves to fit the size.',
      },
      howKb,
      filePrivacyFaq,
    ],
  }),
  preset({ mode: 'target', targetKb: 50 }, {
    slug: 'compress-image-to-50kb',
    name: 'Compress image to 50 KB',
    title: 'Compress Image to 50 KB: resize photos under 50 KB, free',
    h1: 'Compress image to *50 KB*',
    description: 'Get any JPG, PNG, WebP or HEIC photo under 50 KB. Keeps the best quality that fits, shrinks pixels only if it must, and checks the result. No upload.',
    tagline: 'A common cap for profile pictures and application photos.',
    keywords: ['compress image to 50kb', 'reduce image size to 50kb', 'photo under 50kb', 'jpg to 50kb', 'image size 50kb', 'resize photo to 50kb'],
    steps: how('50 KB'),
    faq: [
      {
        q: 'What does 50 KB look like?',
        a: 'At 50 KB a photo can usually keep roughly 800–1,000 pixels on its long side at good quality, which is plenty for a profile picture, a passport-style photo or an image in a form. Busy, grainy photos need a bit more room than smooth ones.',
      },
      {
        q: 'Is there a minimum too?',
        a: 'Some forms want 20–50 KB rather than just "under 50". Type 20 in "at least" and the tool keeps each file in that range; see also the 20 KB to 50 KB page.',
      },
      howKb,
      filePrivacyFaq,
    ],
  }),
  preset({ mode: 'target', targetKb: 100 }, {
    slug: 'compress-image-to-100kb',
    name: 'Compress image to 100 KB',
    title: 'Compress Image to 100 KB: JPG & photo size under 100 KB',
    h1: 'Compress image to *100 KB*',
    description: 'Shrink photos and screenshots to under 100 KB in bulk. The best JPG quality that fits, resized only if it has to be, with each result checked. Nothing uploaded.',
    tagline: 'Under 100 KB with the most quality left, a whole batch at once.',
    keywords: ['compress image to 100kb', 'reduce image size to 100kb', 'jpg under 100kb', 'photo to 100kb', 'image size 100kb', 'resize image to 100kb'],
    steps: how('100 KB'),
    faq: [
      {
        q: 'How sharp is a 100 KB photo?',
        a: 'Usually sharp enough for any web form or listing: around 1,200–1,600 pixels on the long side at good JPG quality. If your photo is smaller than that, it may fit without shrinking at all, and the result says "quality …" without "shrunk to fit".',
      },
      {
        q: 'Should I pick JPG or WebP?',
        a: 'JPG, unless you know the site takes WebP. Forms almost always accept JPG; WebP keeps a little more detail at the same size but isn\'t accepted everywhere.',
      },
      howKb,
      filePrivacyFaq,
    ],
  }),
  preset({ mode: 'target', targetKb: 200 }, {
    slug: 'compress-image-to-200kb',
    name: 'Compress image to 200 KB',
    title: 'Compress Image to 200 KB: reduce photo size under 200 KB',
    h1: 'Compress image to *200 KB*',
    description: 'Bring photos under 200 KB for a form, listing or email with almost no visible loss. Batch it, check each result, download as a zip. Runs on your device.',
    tagline: 'Usually no visible change, just a much smaller file.',
    keywords: ['compress image to 200kb', 'reduce image size to 200kb', 'photo under 200kb', 'jpg to 200kb', 'image size 200kb'],
    steps: how('200 KB'),
    faq: [
      {
        q: 'Will I see a difference?',
        a: 'Rarely. 200 KB holds a photo of roughly 1,500 pixels across at good quality, about the width of a laptop screen. Phone photos are mostly 3–5 MB because they keep detail you can only see when zooming in.',
      },
      {
        q: 'Why is one file "unchanged"?',
        a: 'It was already a JPG under 200 KB, so it\'s handed back exactly as it was instead of being saved again (which would only lose a little quality).',
      },
      howKb,
      filePrivacyFaq,
    ],
  }),
  preset({ mode: 'target', targetKb: 500 }, {
    slug: 'compress-image-to-500kb',
    name: 'Compress image to 500 KB',
    title: 'Compress Image to 500 KB: shrink photos under 500 KB',
    h1: 'Compress image to *500 KB*',
    description: 'Shrink large photos to under 500 KB at the highest quality that fits, in bulk. Every file is checked against 500 KB. Free, no sign-up, nothing uploaded.',
    tagline: 'Full-size-looking photos at a fraction of the size.',
    keywords: ['compress image to 500kb', 'reduce image size to 500kb', 'photo under 500kb', 'jpg to 500kb', 'image less than 500kb'],
    steps: how('500 KB'),
    faq: [
      {
        q: 'Does a photo have to be resized to reach 500 KB?',
        a: 'Sometimes. Smaller photos and smooth scenes reach 500 KB by quality alone, keeping every pixel. A full-size 12-megapixel phone photo usually also gets scaled down a little, which you won\'t notice on screen.',
      },
      {
        q: 'Does it remove location data?',
        a: 'When the photo is saved again, yes: EXIF data such as GPS location and camera details is dropped, after the picture is turned the right way up. A JPG that is already under 500 KB is handed back untouched and keeps its data, so use the EXIF remover if that matters.',
      },
      howKb,
      filePrivacyFaq,
    ],
  }),
  preset({ mode: 'target', targetKb: 1000 }, {
    slug: 'compress-image-to-1mb',
    name: 'Compress image to 1 MB',
    title: 'Compress Image to 1 MB: reduce photo size under 1 MB',
    h1: 'Compress image to *1 MB*',
    description: 'Get big photos under 1 MB without visible loss, one or a hundred at a time. Each result is checked against 1 MB. Works offline once loaded; nothing uploaded.',
    tagline: 'Under a megabyte, still sharp enough to print.',
    keywords: ['compress image to 1mb', 'reduce image size to 1mb', 'photo under 1mb', 'jpg to 1mb', 'image less than 1mb', 'resize photo to 1mb'],
    steps: how('1 MB'),
    faq: [
      {
        q: 'Is 1 MB 1,000 KB or 1,024 KB?',
        a: 'We aim under 1,000,000 bytes, so the file passes either definition.',
      },
      {
        q: 'Can I still print it?',
        a: 'Usually, yes. Many phone photos reach 1 MB by lowering the JPG quality while keeping every pixel, and even when they are scaled down a little they keep enough pixels for a sharp 6×4 inch print.',
      },
      howKb,
      filePrivacyFaq,
    ],
  }),
  preset({ mode: 'target', rangeKb: [20, 50] }, {
    slug: 'image-size-20kb-to-50kb',
    name: 'Image between 20 and 50 KB',
    title: 'Resize Image Between 20 KB and 50 KB for Online Forms',
    h1: 'Image size *20 KB to 50 KB*',
    description: 'Make a photo between 20 KB and 50 KB, the range many application forms ask for. Too big is compressed, too small is raised to the minimum. No upload.',
    tagline: 'Not just under 50 KB: at least 20 KB too, as forms ask.',
    keywords: ['image size 20kb to 50kb', 'photo between 20kb and 50kb', 'resize photo 20 to 50 kb', 'image 20-50 kb', 'compress photo between 20kb and 50kb'],
    steps: [
      'Drop in your photo. The range is already 20–50 KB; change either number to match your form.',
      'Big photos get the best quality under 50 KB. Small ones get higher quality, then more pixels, until they reach 20 KB.',
      'Check that the result line says "✓ within 20–50 KB", then download.',
    ],
    faq: [
      {
        q: 'Why would a form want at least 20 KB?',
        a: 'A minimum keeps out tiny, blurry pictures. Forms that ask for 20–50 KB want a photo clear enough to recognize the person, so a file under 20 KB is often rejected even though it is "small enough".',
      },
      {
        q: 'What if my photo is too small to reach 20 KB?',
        a: 'First the JPG quality is raised, then the picture is enlarged (unless you fixed its dimensions). If it is still short, blank padding is added to the file: a comment block that viewers ignore, so the picture looks exactly the same. The result line says when padding was used.',
      },
      {
        q: 'Can I also set the pixel size?',
        a: 'Yes. Tick "Exact dimensions too" and enter what the form asks for, for example 200 × 230 pixels or 3.5 × 4.5 cm. The picture is cropped to that shape and only the quality changes.',
      },
      filePrivacyFaq,
    ],
  }),
  preset({ mode: 'increase', targetKb: 50 }, {
    slug: 'increase-image-size-in-kb',
    name: 'Increase image size in KB',
    title: 'Increase Image Size in KB: make a photo at least 50 KB',
    h1: 'Increase image size *in KB*',
    description: 'Make a photo bigger in KB when a form says it is too small. Raises quality, then pixels, and pads only as a last resort, saying so. No upload, no sign-up.',
    tagline: 'For "file too small" errors: up to the minimum, honestly.',
    keywords: ['increase image size in kb', 'kb increaser', 'increase photo size in kb', 'make image bigger in kb', 'increase jpg size', 'image size increase 20kb'],
    steps: [
      'Drop in the photo the form rejected as too small. Set "at least" to the form\'s minimum (it starts at 50 KB), and "at most" if it has a maximum too.',
      'The tool raises the JPG quality first, then enlarges the picture, and adds blank padding only if both fall short.',
      'Check the result line, which says exactly what was done, and download.',
    ],
    faq: [
      {
        q: 'Does a bigger file mean a better photo?',
        a: 'Only partly. Higher JPG quality keeps more of the detail that is really there, and enlarging adds pixels but not detail. If the original is tiny or blurry, a retake or a better scan helps far more than any tool.',
      },
      {
        q: 'What is the padding?',
        a: 'If quality and size can\'t reach the minimum (common with small signature scans), the tool adds a blank comment block inside the JPG. Image viewers and forms skip it, so the picture is unchanged; it only makes the file meet the minimum size. The result line shows how much was added.',
      },
      {
        q: 'Will it keep the photo under a maximum too?',
        a: 'Yes. Fill in "at most" as well, and the tool stays between the two numbers.',
      },
      filePrivacyFaq,
    ],
  }),
  preset({ mode: 'exact', unit: 'cm', dpi: 300, w: 3.5, h: 4.5 }, {
    slug: 'resize-image-in-cm',
    name: 'Resize image in cm',
    title: 'Resize Image in cm, mm or Inches at Any DPI: free tool',
    h1: 'Resize image *in cm*',
    description: 'Resize a photo to an exact size in centimeters, millimeters or inches, such as 3.5 × 4.5 cm at 300 dpi. The DPI is saved in the JPG so it prints at that size.',
    tagline: 'Type the print size, pick the DPI, get the right pixels.',
    keywords: ['resize image in cm', 'photo size in cm', 'resize photo 3.5 x 4.5 cm', 'image size in mm', 'resize image in inches', 'cm to pixels photo'],
    steps: [
      'Drop in your photo. The size starts at 3.5 × 4.5 cm at 300 dpi; type your own width, height and DPI, or switch to mm or inches.',
      'The photo is cropped to that shape (or stretched, if you prefer) and resized to the matching number of pixels.',
      'Download the JPG. It carries the DPI, so it prints at exactly the size you typed.',
    ],
    faq: [
      {
        q: 'How are cm turned into pixels?',
        a: 'Pixels = centimeters ÷ 2.54 × DPI. At 300 dpi, 3.5 × 4.5 cm is 413 × 531 pixels; at 200 dpi it is 276 × 354. The tool shows the pixel size under the fields as you type.',
      },
      {
        q: 'Which DPI should I use?',
        a: '300 dpi is the usual choice for printing photos. If a form gives a size in pixels instead, switch to px and type those numbers: then the DPI doesn\'t matter for uploading.',
      },
      {
        q: 'Does it also keep the file under a size in KB?',
        a: 'Switch to "file size (KB)", tick "Exact dimensions too" and keep cm as the unit. The tool then fixes the print size and adjusts only the quality to fit your KB limit.',
      },
      filePrivacyFaq,
    ],
  }),
] satisfies Tool[];
