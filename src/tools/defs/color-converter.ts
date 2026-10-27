import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'color-converter',
  category: 'dev',
  name: 'Color converter & contrast checker',
  title: 'Color Converter: HEX, RGB, HSL, OKLCH & contrast checker',
  h1: 'Color *converter*',
  description: 'Convert any CSS color to HEX, RGB, HSL, HWB, LAB, LCH, OKLCH and CMYK. Check WCAG and APCA contrast, build a 50–950 scale and preview color blindness.',
  tagline: 'Paste any color, get every format, plus contrast, shades and color-blind previews.',
  keywords: ['hex to rgb', 'rgb to hex', 'hex to hsl', 'oklch converter', 'color contrast checker', 'wcag contrast checker', 'apca contrast', 'color shades generator', 'color blindness simulator', 'cmyk to hex'],
  island: 'ColorConverter',
  steps: [
    'Type or paste a color in any CSS format (hex, rgb, hsl, oklch, a name like tomato…), or pick one.',
    'Copy the format you need, or grab a full 50–950 shade scale as CSS, Tailwind or JSON.',
    'Set a background color to check WCAG and APCA contrast and see how both look with color blindness.',
  ],
  faq: [
    { q: 'Which color formats can I paste in?', a: 'Hex (3, 4, 6 or 8 digits, with or without #), all 148 CSS color names, rgb(), hsl(), hwb(), lab(), lch(), oklab(), oklch() and color() in srgb, srgb-linear or display-p3, in both the old comma syntax and the modern space syntax with / alpha. CMYK works too, as cmyk(0%, 47%, 100%, 0%).' },
    { q: 'Why does it say a color is outside sRGB?', a: 'Spaces like OKLCH, LAB and Display P3 can describe colors brighter or more saturated than hex and rgb() can hold. For those, hex, RGB, HSL, HWB and CMYK show the closest color that fits, found with the CSS Color 4 gamut-mapping method, which lowers saturation while keeping lightness and hue. The OKLCH, LAB and P3 values keep the exact color.' },
    { q: 'How is contrast checked?', a: 'The WCAG 2.2 ratio compares the relative luminance of text and background: 4.5:1 passes AA for normal text and 3:1 for large text, icons and UI parts, while AAA needs 7:1 and 4.5:1. APCA is a newer method proposed for WCAG 3 that also accounts for whether the text is darker or lighter than its background. It is shown for guidance only and is not a legal requirement yet. The ratio is rounded down, so a pair shown as 4.5:1 really passes.' },
    { q: 'Is the CMYK value ready for print?', a: 'Treat it as a starting point. It uses the simple formula from RGB with no printer color profile, so real ink results depend on the paper, press and profile your printer uses. Ask them for a proof if exact color matters.' },
    privacyFaq,
  ],
  related: ['image-color-picker', 'css-minifier', 'favicon-generator'],
} satisfies Tool;
