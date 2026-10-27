import { formatInfo, type OutputFormat } from '../../engines/image/types';
import { sourceInfo, type SourceFormat } from '../lib/image-converter/formats';
import { LIMITS, MEASURED } from '../lib/notes';
import { filePrivacyFaq, type Tool } from '../types';

type Copy = Pick<Tool, 'title' | 'description' | 'tagline' | 'keywords' | 'steps' | 'faq' | 'related' | 'flagship' | 'notes'>;

/** a /from-to-to page that opens the converter preset to that pair */
function variant(from: SourceFormat, to: OutputFormat, copy: Copy): Tool {
  const a = sourceInfo[from].label;
  const b = formatInfo[to].label;
  return {
    slug: `${from}-to-${formatInfo[to].ext}`,
    category: 'image',
    name: `${a} to ${b}`,
    h1: `${a} to *${b}*`,
    island: 'ImageConverter',
    props: { from, to },
    variantOf: 'image-converter',
    ...copy,
    faq: [...copy.faq, filePrivacyFaq],
  };
}

export default [
  {
    slug: 'image-converter',
    category: 'image',
    name: 'Image converter',
    title: 'Image Converter: JPG, PNG, WebP, AVIF & HEIC in bulk, free',
    h1: 'Image *converter*',
    description: 'Convert images between JPG, PNG, WebP and AVIF, including iPhone HEIC photos. Batch convert with no file limits. Nothing is uploaded.',
    tagline: 'Turn any image into JPG, PNG, WebP or AVIF, as many as you like at once.',
    keywords: ['convert image', 'image format converter', 'convert to jpg', 'convert to png', 'convert to webp', 'avif converter', 'heic converter', 'batch image converter'],
    island: 'ImageConverter',
    props: { to: 'jpeg' },
    steps: [
      'Drop in your images: JPG, PNG, WebP, AVIF, HEIC, GIF or BMP, as many as you like.',
      'Pick the format to convert to, and adjust the quality or size if you want.',
      'Download each file, or all of them at once as a zip.',
    ],
    faq: [
      { q: 'Which format should I choose?', a: 'JPG for photos that need to open everywhere. PNG for screenshots, graphics and anything with transparency. WebP is smaller than JPG and works in every modern browser. AVIF is smaller still, but slower to create and not yet accepted by many apps.' },
      { q: 'Will converting lower the quality?', a: 'PNG and lossless WebP keep every pixel. JPG, WebP and AVIF are lossy: at the default quality the difference is very hard to see, and the before/after slider lets you check. No format can add back detail the original already lost.' },
      { q: 'Is there a limit on files or size?', a: 'No file cap, no daily limit and no size cap from us. Big batches are converted a few at a time in the background, so the page stays responsive.' },
      { q: 'Does it keep photo metadata?', a: 'No. Converting re-encodes the image, which leaves out EXIF data such as camera details and GPS location. Photos are turned the right way up first, so nothing ends up sideways.' },
      filePrivacyFaq,
    ],
    notes: {
      settings: [
        { name: 'Convert to', effect: 'JPG, PNG, WebP or AVIF. Each format starts at its own quality (JPG 90, WebP 85, AVIF 65) because the scales differ between codecs.' },
        { name: 'Quality (10–100)', effect: 'Only for lossy output. Lower values give smaller files with more blur and blockiness; the before/after slider shows the difference.' },
        { name: 'Lossless WebP', effect: 'Keeps every pixel, like PNG, usually in fewer bytes. Best for logos and screenshots, not photos.' },
        { name: 'Background', effect: 'JPG has no transparency, so see-through pixels are filled with white, black or a color you pick.' },
        { name: 'Maximum size', effect: 'Full keeps the original pixels; 4K, 2560, 1920 or 1280 cap the longest side. Images are never enlarged.' },
      ],
      results: [
        { input: '12 MP phone photo, JPG, 4.0 MB', setting: 'WebP, quality 85', output: '1.3 MB', note: '3.9 s' },
        { input: '12 MP phone photo, JPG, 4.0 MB', setting: 'AVIF, quality 65', output: '910 KB', note: '35.9 s: AVIF is slow to encode' },
        { input: '12 MP HEIC photo, 3.0 MB', setting: 'JPG, quality 90', output: '2.1 MB', note: '6.9 s' },
      ],
      measured: MEASURED,
      formats: [
        { name: 'HEIC', about: 'The iPhone camera default. Small files, but many Windows apps, sites and upload forms can\'t open it. Safari reads it natively; in other browsers we decode it with a WebAssembly build of libheif.' },
        { name: 'JPG', about: 'Opens everywhere. Lossy, no transparency.' },
        { name: 'PNG', about: 'Lossless with transparency: ideal for graphics, large for photos.' },
        { name: 'WebP and AVIF', about: 'Modern web formats, smaller than JPG at a similar look. Browsers show both; plenty of apps and forms still refuse them.' },
      ],
      limits: [LIMITS.passport, LIMITS.gmail],
    },
    related: ['image-compressor', 'image-resizer', 'heic-to-jpg', 'svg-to-png'],
    next: ['image-compressor', 'image-resizer'],
    flagship: { elsewhere: 'Daily conversion limits and upload size caps', here: 'Unlimited files, converted on your device' },
  },

  variant('heic', 'jpeg', {
    title: 'HEIC to JPG Converter: bulk convert iPhone photos, free',
    description: 'Convert HEIC photos from your iPhone to JPG in bulk. No 5-file cap, no queue, no upload: hundreds of photos convert right in your browser.',
    tagline: 'Turn a whole camera roll of iPhone HEIC photos into JPGs at once.',
    keywords: ['heic to jpg', 'heic to jpeg', 'convert heic', 'iphone photos to jpg', 'heic converter', 'open heic on windows', 'heif to jpg', 'bulk heic to jpg'],
    steps: [
      'Drop in your HEIC photos: a handful, or a whole folder from your iPhone.',
      'JPG is already selected. Leave the quality at 90, or nudge it to trade size for detail.',
      'Download each JPG, or all of them at once as a zip.',
    ],
    faq: [
      { q: 'Why are my iPhone photos HEIC?', a: 'iPhones save photos as HEIC by default because it takes less space than JPG at similar quality. The catch is that many Windows apps, websites and upload forms don\'t accept HEIC, so JPG is the safe choice for sharing.' },
      { q: 'How many photos can I convert at once?', a: 'As many as you like. There is no file cap and no queue to wait in: photos are converted a few at a time on your own device, and you can download them all as one zip.' },
      { q: 'Can I make my iPhone take JPGs instead?', a: 'Yes. In Settings > Camera > Formats, choose "Most Compatible" and the camera saves JPG from then on. The trade-off is that each photo takes more space.' },
      { q: 'Is the location data removed?', a: 'Yes. The JPG is a fresh encode of the picture, so EXIF data like GPS location and camera model isn\'t carried over. That\'s handy before posting online, but keep the HEIC files too if you rely on the original date taken for sorting.' },
    ],
    notes: {
      settings: [
        { name: 'Quality (default 90)', effect: 'The JPG quality. 90 keeps a 12 MP photo close to the original; lower it to trade detail for a smaller file.' },
        { name: 'Maximum size', effect: 'Full keeps all 12 megapixels; 1920 or 1280 make light copies for sharing. Photos are never enlarged.' },
        { name: 'Format buttons', effect: 'JPG is preselected here. The same page also makes PNG, WebP or AVIF if you switch.' },
      ],
      results: [
        { input: '12 MP HEIC photo of a street (4032×3024), 3.0 MB', setting: 'JPG, quality 90', output: '2.1 MB', note: '7.0 s' },
        { input: 'Another 12 MP HEIC photo, 3.8 MB', setting: 'JPG, quality 90', output: '3.6 MB', note: '8.5 s' },
        { input: '3 HEIC photos, 9.5 MB together', setting: 'JPG, quality 90, as a zip', output: '8.3 MB zip', note: '12–17 s for all three in two runs, converted side by side' },
      ],
      measured: MEASURED,
      formats: [
        { name: 'HEIC', about: 'HEVC-compressed photos, the iPhone default since iOS 11. Chrome, Edge and Firefox can\'t display them, so we decode them with a WebAssembly build of libheif; Safari reads them natively.' },
        { name: 'JPG', about: 'Every phone, PC, printer and upload form accepts it, which is why it\'s the safe target.' },
      ],
      limits: [LIMITS.passport, LIMITS.gmail],
    },
    related: ['image-compressor', 'image-resizer', 'exif-remover'],
    flagship: { elsewhere: '5 to 10 photos per batch, then a queue', here: 'Hundreds of photos at once, no queue' },
  }),

  variant('heic', 'png', {
    title: 'HEIC to PNG Converter: lossless, in bulk, no upload',
    description: 'Convert iPhone HEIC photos to lossless PNG in bulk. Every pixel is kept, ideal for editing. Free, no file limits, nothing leaves your device.',
    tagline: 'Lossless PNG copies of your iPhone photos, ready for editing.',
    keywords: ['heic to png', 'convert heic to png', 'heif to png', 'iphone photo to png', 'heic png converter', 'heic to png bulk'],
    steps: [
      'Drop in your HEIC photos from an iPhone or iPad.',
      'PNG is already selected. Optionally cap the size so the files stay manageable.',
      'Download the PNGs one by one, or all at once as a zip.',
    ],
    faq: [
      { q: 'HEIC to PNG or HEIC to JPG?', a: 'Pick PNG if you plan to edit the photo further, since PNG adds no compression of its own. Pick JPG to share or upload, because the files are much smaller.' },
      { q: 'Why are the PNG files so big?', a: 'PNG is lossless, so it stores every pixel exactly. That\'s great for graphics but makes photos large, often several times the size of the HEIC. Choosing a smaller size like 1920 helps a lot.' },
      { q: 'Does PNG improve the quality?', a: 'No. Nothing is lost in the conversion, but PNG can only keep what the HEIC already contained. It can\'t add detail back.' },
    ],
    related: ['heic-to-jpg', 'image-resizer', 'image-compressor'],
  }),

  variant('png', 'jpeg', {
    title: 'PNG to JPG Converter: shrink PNG photos, batch & free',
    description: 'Convert PNG to JPG to make photos far smaller. Choose the quality and a background color for transparent areas. Batch convert, nothing uploaded.',
    tagline: 'Shrink heavy PNGs into JPGs, with control over quality and background.',
    keywords: ['png to jpg', 'png to jpeg', 'convert png to jpg', 'png to jpg converter', 'change png to jpg', 'reduce png size', 'png to jpg batch'],
    steps: [
      'Drop in your PNGs, as many as you like.',
      'Set the quality, and pick a background color if any PNG has transparent areas.',
      'Download the JPGs one by one, or all at once as a zip.',
    ],
    faq: [
      { q: 'Why convert PNG to JPG?', a: 'PNG is lossless, which makes photos saved as PNG very large. JPG is built for photos and often makes them several times smaller with no visible difference, so they upload and email faster.' },
      { q: 'What happens to transparent areas?', a: 'JPG can\'t store transparency, so transparent pixels are filled with a solid color. White is the default; pick black or any color to match where the image will sit.' },
      { q: 'Should I convert screenshots and logos too?', a: 'Usually not. Text and sharp edges can pick up faint smudges in JPG. For those, try WebP with lossless on, or keep the PNG and run it through the image compressor.' },
    ],
    notes: {
      settings: [
        { name: 'Quality (default 90)', effect: 'The JPG quality. Photos look the same at 90; text and sharp edges can pick up faint smudges at any quality.' },
        { name: 'Background', effect: 'Transparent pixels become this color (white unless you pick black or another), since JPG can\'t store transparency.' },
        { name: 'Maximum size', effect: 'Optionally caps the longest side at 4K, 2560, 1920 or 1280 pixels.' },
      ],
      results: [
        { input: '12 MP photo saved as PNG, 12 MB', setting: 'JPG, quality 90', output: '2.1 MB', note: '−82%, 3.9 s' },
        { input: '1920×1080 screenshot of a web page, PNG, 173 KB', setting: 'JPG, quality 90', output: '216 KB', note: '+25%: screenshots stay smaller as PNG' },
      ],
      measured: MEASURED,
      formats: [
        { name: 'PNG', about: 'Lossless, so photos saved as PNG are several times larger than they need to be. Flat screenshots compress well in it.' },
        { name: 'JPG', about: 'Built for photos. It drops detail the eye barely sees, which is why a PNG photo shrinks so much.' },
      ],
      limits: [LIMITS.gmail, LIMITS.passport],
    },
    related: ['image-compressor', 'png-to-webp', 'jpg-to-png'],
  }),

  variant('jpg', 'png', {
    title: 'JPG to PNG Converter: lossless copies, batch, free',
    description: 'Convert JPG to PNG for editing, design tools and uploads that require PNG. No further quality loss, unlimited files, nothing uploaded.',
    tagline: 'Lossless PNG copies of your JPGs, so later edits don\'t wear them down.',
    keywords: ['jpg to png', 'jpeg to png', 'convert jpg to png', 'jpg to png converter', 'change jpg to png', 'jpg to png high quality', 'jpg to png batch'],
    steps: [
      'Drop in your JPGs, one or a whole folder.',
      'PNG is already selected. Keep the original size or pick a smaller one.',
      'Download the PNGs one by one, or all at once as a zip.',
    ],
    faq: [
      { q: 'When should I convert JPG to PNG?', a: 'When a site or app asks for PNG, or when you\'ll edit and re-save an image many times, since every JPG re-save loses a little more quality and a PNG doesn\'t.' },
      { q: 'Will PNG improve my JPG\'s quality?', a: 'No. Nothing more is lost, but any blockiness or blur already in the JPG stays. Think of it as freezing the image exactly as it is.' },
      { q: 'Why is the PNG bigger than the JPG?', a: 'JPG throws away fine detail to save space, while PNG stores every pixel exactly. For photos that means a larger file.' },
      { q: 'Will the background become transparent?', a: 'No. A JPG has no transparency to carry over, so the PNG keeps the same solid background.' },
    ],
    notes: {
      settings: [
        { name: 'Maximum size', effect: 'Full keeps every pixel; 1920 or 1280 make a much lighter PNG. Nothing else changes, since PNG is lossless.' },
        { name: 'No quality slider', effect: 'PNG stores exactly what the JPG decodes to, so there is no quality to choose.' },
      ],
      results: [
        { input: '12 MP phone photo, JPG, 4.0 MB', setting: 'PNG, full size', output: '11 MB', note: '+182%, 21.7 s' },
        { input: '12 MP phone photo, JPG, 4.0 MB', setting: 'PNG, max 1920', output: '3.6 MB at 1920×1440', note: '10.0 s' },
      ],
      measured: MEASURED,
      formats: [
        { name: 'JPG', about: 'Lossy: every re-save loses a little more detail.' },
        { name: 'PNG', about: 'Lossless: freezes the picture as it is, at the cost of a bigger file for photos.' },
      ],
    },
    related: ['png-to-jpg', 'image-compressor', 'image-resizer'],
  }),

  variant('webp', 'jpeg', {
    title: 'WebP to JPG Converter: open WebP images anywhere, free',
    description: 'Convert WebP images to JPG for apps, editors and upload forms that reject WebP. Batch convert, pick the quality, nothing uploaded.',
    tagline: 'Turn WebP images saved from the web into JPGs that open anywhere.',
    keywords: ['webp to jpg', 'webp to jpeg', 'convert webp to jpg', 'webp converter', 'save webp as jpg', 'open webp file', 'webp to jpg batch'],
    steps: [
      'Drop in your WebP images, for example ones saved from a website.',
      'JPG is already selected. Adjust the quality or background color if you need to.',
      'Download the JPGs one by one, or all at once as a zip.',
    ],
    faq: [
      { q: 'Why do images from websites save as WebP?', a: 'Many sites serve WebP because it\'s smaller than JPG and loads faster. Browsers show it fine, but some photo editors, print services and upload forms still don\'t accept it.' },
      { q: 'Will I lose quality?', a: 'A tiny bit, since both formats are lossy. At the default quality of 90 it\'s very hard to spot. If you need zero further loss, convert to PNG instead.' },
      { q: 'What about transparent WebP images?', a: 'JPG has no transparency, so transparent areas are filled with white or a color you choose. To keep transparency, convert WebP to PNG.' },
    ],
    notes: {
      settings: [
        { name: 'Quality (default 90)', effect: 'The JPG quality. WebP squeezes harder than JPG, so expect the JPG to be bigger even at the same look.' },
        { name: 'Background', effect: 'Fills transparent areas with white or the color you pick. Convert to PNG instead to keep them see-through.' },
        { name: 'Maximum size', effect: 'Optionally caps the longest side at 4K, 2560, 1920 or 1280 pixels.' },
      ],
      results: [{ input: '1600×1200 WebP photo from a website, 484 KB', setting: 'JPG, quality 90', output: '699 KB', note: '+45%, 1.9 s' }],
      measured: MEASURED,
      formats: [
        { name: 'WebP', about: 'Google\'s web format: smaller than JPG, shown by every current browser, refused by some editors, print shops and forms.' },
        { name: 'JPG', about: 'Bigger for the same picture, but accepted everywhere.' },
      ],
      limits: [LIMITS.passport],
    },
    related: ['webp-to-png', 'image-compressor', 'jpg-to-webp'],
  }),

  variant('webp', 'png', {
    title: 'WebP to PNG Converter: keep transparency, batch, free',
    description: 'Convert WebP images to PNG with transparency intact. Lossless output for editing and apps that reject WebP. Batch convert, nothing uploaded.',
    tagline: 'Lossless PNGs from WebP images, transparency and all.',
    keywords: ['webp to png', 'convert webp to png', 'webp to png transparent', 'webp to png converter', 'save webp as png', 'webp to png batch'],
    steps: [
      'Drop in your WebP images.',
      'PNG is already selected. Keep the original size or choose a smaller one.',
      'Download the PNGs one by one, or all at once as a zip.',
    ],
    faq: [
      { q: 'Does it keep transparency?', a: 'Yes. Transparent and semi-transparent pixels carry straight over to the PNG.' },
      { q: 'Why is the PNG larger than the WebP?', a: 'WebP compresses much harder than PNG. The PNG holds exactly the same pixels, just stored losslessly, which takes more space.' },
      { q: 'WebP to PNG or WebP to JPG?', a: 'PNG for logos, stickers and anything with transparency or that you\'ll keep editing. JPG for photos you want to keep small.' },
    ],
    related: ['webp-to-jpg', 'png-to-webp', 'image-compressor'],
  }),

  variant('jpg', 'webp', {
    title: 'JPG to WebP Converter: smaller images for faster sites',
    description: 'Convert JPG photos to WebP to cut file size for websites and faster loading pages. Batch convert with a quality slider. Free, nothing uploaded.',
    tagline: 'Smaller, web-ready versions of your JPGs for faster pages.',
    keywords: ['jpg to webp', 'jpeg to webp', 'convert jpg to webp', 'webp converter', 'convert images to webp', 'jpg to webp bulk', 'optimize images for web'],
    steps: [
      'Drop in your JPGs, one or hundreds.',
      'WebP is already selected. Set the quality and, for the web, a maximum size like 1920.',
      'Download the WebP files one by one, or all at once as a zip.',
    ],
    faq: [
      { q: 'Why convert JPG to WebP?', a: 'Smaller files make pages load faster. Google\'s own comparison found WebP files 25–34% smaller than JPGs of the same quality, and the file list here shows exactly how much you save.' },
      { q: 'Do all browsers support WebP?', a: 'Every current major browser, including Chrome, Firefox, Edge and Safari, displays WebP. Some older desktop apps and email clients may not, so keep your JPGs for those.' },
      { q: 'Will it look worse?', a: 'At the default quality of 85, most photos look the same. Use the before/after slider to check, and raise the quality if you spot softness.' },
    ],
    related: ['image-compressor', 'jpg-to-avif', 'image-resizer'],
  }),

  variant('png', 'webp', {
    title: 'PNG to WebP Converter: lossless or lossy, batch, free',
    description: 'Convert PNG to WebP and keep transparency. Lossless mode for graphics, lossy for photos, often much smaller. Batch convert, nothing uploaded.',
    tagline: 'Much lighter PNGs for the web, with transparency kept.',
    keywords: ['png to webp', 'convert png to webp', 'png to webp lossless', 'png to webp transparent', 'webp converter', 'png to webp bulk'],
    steps: [
      'Drop in your PNGs.',
      'WebP is already selected. Turn on lossless for logos and screenshots, or use the quality slider for photos.',
      'Download the WebP files one by one, or all at once as a zip.',
    ],
    faq: [
      { q: 'Lossless or lossy?', a: 'Lossless keeps every pixel exactly, like PNG, and is usually still smaller than the PNG. Lossy is much smaller again and works well for photos and illustrations, but can soften fine text.' },
      { q: 'Is transparency kept?', a: 'Yes, in both modes.' },
      { q: 'Where can I use WebP?', a: 'On any website, since all current major browsers support it, and in most modern apps. A few older programs and print services still want PNG or JPG.' },
    ],
    related: ['image-compressor', 'png-to-jpg', 'webp-to-png'],
  }),

  variant('avif', 'jpeg', {
    title: 'AVIF to JPG Converter: open AVIF images anywhere, free',
    description: 'Convert AVIF images to JPG so they open in any app, editor or upload form. Batch convert with adjustable quality. Free, nothing uploaded.',
    tagline: 'JPG copies of AVIF images, for the apps that can\'t open them.',
    keywords: ['avif to jpg', 'avif to jpeg', 'convert avif to jpg', 'avif converter', 'open avif file', 'save avif as jpg', 'avif to jpg batch'],
    steps: [
      'Drop in your AVIF images, for example ones saved from a website.',
      'JPG is already selected. Adjust the quality or background color if you need to.',
      'Download the JPGs one by one, or all at once as a zip.',
    ],
    faq: [
      { q: 'What is AVIF?', a: 'A newer image format based on the AV1 video codec. It makes much smaller files than JPG, so more websites use it, but many photo editors, apps and upload forms still can\'t open it.' },
      { q: 'Why is the JPG bigger than the AVIF?', a: 'AVIF compresses far more efficiently than JPG, so the same picture needs more bytes as a JPG. That\'s the price of opening everywhere.' },
      { q: 'What if my browser can\'t read AVIF?', a: 'Current browsers read it natively. On older ones we fall back to a built-in decoder, so the conversion still works.' },
    ],
    related: ['avif-to-png', 'webp-to-jpg', 'image-compressor'],
  }),

  variant('avif', 'png', {
    title: 'AVIF to PNG Converter: lossless, keeps transparency',
    description: 'Convert AVIF images to PNG with transparency kept and no further quality loss. Works in bulk, right in your browser, nothing uploaded.',
    tagline: 'Lossless PNG copies of AVIF images, transparency included.',
    keywords: ['avif to png', 'convert avif to png', 'avif to png transparent', 'avif converter', 'save avif as png', 'avif to png batch'],
    steps: [
      'Drop in your AVIF images.',
      'PNG is already selected. Keep the original size or choose a smaller one.',
      'Download the PNGs one by one, or all at once as a zip.',
    ],
    faq: [
      { q: 'Does it keep transparency?', a: 'Yes. Transparent and semi-transparent areas carry straight over to the PNG.' },
      { q: 'Why is the PNG so much larger?', a: 'AVIF is one of the most efficient formats around, while PNG stores every pixel losslessly. Same picture, many more bytes. Picking a smaller size helps if that matters.' },
      { q: 'AVIF to PNG or AVIF to JPG?', a: 'PNG for graphics, transparency or further editing. JPG for photos you want to keep small.' },
    ],
    related: ['avif-to-jpg', 'webp-to-png', 'image-compressor'],
  }),

  variant('jpg', 'avif', {
    title: 'JPG to AVIF Converter: much smaller photos, free',
    description: 'Convert JPG photos to AVIF, a modern format that is often far smaller at the same quality. Batch convert with a quality slider. Nothing uploaded.',
    tagline: 'Squeeze your JPGs into AVIF for the lightest web images.',
    keywords: ['jpg to avif', 'jpeg to avif', 'convert jpg to avif', 'avif converter', 'convert images to avif', 'avif encoder', 'jpg to avif bulk'],
    steps: [
      'Drop in your JPGs.',
      'AVIF is already selected. Set the quality and, for websites, a maximum size like 1920.',
      'Download the AVIF files one by one, or all at once as a zip.',
    ],
    faq: [
      { q: 'What quality should I use?', a: 'AVIF\'s scale isn\'t the same as JPG\'s: around 60–70 usually holds up well, and the default is 65. Check with the before/after slider and adjust.' },
      { q: 'Why is AVIF slower to convert?', a: 'AVIF squeezes harder than JPG or WebP, which takes more computing work. Big batches take a while, and run in the background a few at a time.' },
      { q: 'Is AVIF supported everywhere?', a: 'All current major browsers display AVIF, so it\'s safe for websites, ideally with a JPG fallback for old browsers. Many desktop apps, email clients and social sites don\'t accept it yet.' },
    ],
    related: ['jpg-to-webp', 'image-compressor', 'avif-to-jpg'],
  }),

  variant('png', 'avif', {
    title: 'PNG to AVIF Converter: tiny files with transparency',
    description: 'Convert PNG to AVIF for far smaller web images that keep their transparency. Batch convert with adjustable quality, right in your browser.',
    tagline: 'Tiny AVIF versions of your PNGs, see-through areas and all.',
    keywords: ['png to avif', 'convert png to avif', 'png to avif transparent', 'avif converter', 'compress png to avif', 'png to avif bulk'],
    steps: [
      'Drop in your PNGs.',
      'AVIF is already selected. Set the quality; higher keeps text and sharp edges crisp.',
      'Download the AVIF files one by one, or all at once as a zip.',
    ],
    faq: [
      { q: 'Is transparency kept?', a: 'Yes. AVIF supports full transparency, so logos and cut-outs keep their see-through areas.' },
      { q: 'How much smaller will it be?', a: 'It depends on the image. Photos saved as PNG shrink dramatically; flat graphics with few colors shrink less, and now and then a small PNG is already smaller. The file list shows the size change before you download.' },
      { q: 'Can I use AVIF on my website?', a: 'Yes. All current major browsers display it. For old browsers, add a PNG or WebP fallback with the picture element.' },
    ],
    related: ['png-to-webp', 'image-compressor', 'png-to-jpg'],
  }),

  variant('gif', 'png', {
    title: 'GIF to PNG Converter: crisp stills from GIFs, free',
    description: 'Convert GIF images to PNG with transparency kept. Animated GIFs give a still of the first frame. Batch convert, nothing uploaded.',
    tagline: 'Lossless PNG stills from GIFs, transparency kept.',
    keywords: ['gif to png', 'convert gif to png', 'gif to png transparent', 'gif frame to png', 'gif to image', 'gif converter'],
    steps: [
      'Drop in your GIFs.',
      'PNG is already selected. Keep the original size or choose a smaller one.',
      'Download the PNGs one by one, or all at once as a zip.',
    ],
    faq: [
      { q: 'What happens with animated GIFs?', a: 'You get a PNG of the first frame. A PNG here is a still image, so the animation isn\'t kept.' },
      { q: 'Is anything lost?', a: 'No. A GIF frame has at most 256 colors and PNG stores them all exactly, so the picture is identical. Transparent areas stay transparent.' },
      { q: 'Why convert GIF to PNG?', a: 'Many apps, slide decks and design tools handle PNG better than GIF, and some sites only accept PNG or JPG for avatars and icons.' },
    ],
    related: ['image-compressor', 'image-resizer', 'pixel-art-maker'],
  }),

  variant('bmp', 'jpeg', {
    title: 'BMP to JPG Converter: shrink bitmap images, free',
    description: 'Convert BMP bitmap images to JPG and make them many times smaller for email, the web and sharing. Batch convert, nothing uploaded.',
    tagline: 'Turn bulky BMP files into small, shareable JPGs.',
    keywords: ['bmp to jpg', 'bmp to jpeg', 'convert bmp to jpg', 'bitmap to jpg', 'bmp converter', 'bmp to jpg batch'],
    steps: [
      'Drop in your BMP files.',
      'JPG is already selected. Set the quality, or pick PNG for screenshots and diagrams.',
      'Download the JPGs one by one, or all at once as a zip.',
    ],
    faq: [
      { q: 'Why are BMP files so big?', a: 'BMP usually stores every pixel uncompressed. A JPG of the same picture is typically a small fraction of the size, which makes it practical to email and upload.' },
      { q: 'JPG or PNG for BMP files?', a: 'JPG for photos and scans. PNG for screenshots, diagrams and pixel art, where it stays perfectly sharp and is still far smaller than the BMP.' },
      { q: 'Which BMP files work?', a: 'Most BMP files from Windows apps and scanners decode fine. A few uncommon variants may not; any file that can\'t be read is marked in the list.' },
    ],
    related: ['png-to-jpg', 'image-compressor', 'image-resizer'],
  }),
] satisfies Tool[];
