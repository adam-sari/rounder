import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'favicon-generator',
  category: 'dev',
  name: 'Favicon generator',
  title: 'Favicon Generator: ICO, PNG, SVG & Apple icons from any image',
  h1: 'Favicon *generator*',
  description: 'Make a favicon from a logo, text or emoji. Get favicon.ico, SVG, Apple touch and Android icons, a web manifest and the HTML tags. Free, no upload.',
  tagline: 'Every icon size your site needs, from a logo, a letter or an emoji.',
  keywords: ['favicon generator', 'favicon ico', 'png to ico', 'emoji favicon', 'apple touch icon', 'favicon from text', 'site icon', 'webmanifest icons'],
  island: 'FaviconGenerator',
  steps: [
    'Drop in your logo (PNG, JPG, WebP or SVG), or type a letter or pick an emoji.',
    'Choose a shape, background and padding, and check the browser tab and home screen previews.',
    'Download the zip, put the files in your site\'s root folder and paste the HTML tags into your <head>.',
  ],
  faq: [
    { q: 'Which files do I actually need?', a: 'favicon.ico works in every current browser, and it is the file browsers look for when a page has no icon tags. favicon.svg gives a sharp icon at any size in modern browsers. apple-touch-icon.png is used when someone adds your site to an iPhone or iPad home screen, and the Android icons plus site.webmanifest are used when it is installed on Android. The zip has all of them, and the HTML snippet links them up.' },
    { q: 'Why is the Apple touch icon square with a solid background?', a: 'iOS ignores transparency in home screen icons and fills it with black, and it rounds the corners itself. So we give it a solid background (your background color, or white if you chose transparent) and leave the rounding to the phone.' },
    { q: 'Why do I only get favicon.svg for SVG and text icons?', a: 'An SVG favicon only makes sense when the source is vector art. Wrapping a photo or PNG in an SVG would not make it any sharper, so for those you get high-quality PNG and ICO files instead.' },
    { q: 'What sizes are inside favicon.ico?', a: '16, 32 and 48 pixels, each stored as a PNG inside the ICO file. Browsers and Windows pick the size that suits the screen.' },
    filePrivacyFaq,
  ],
  related: ['image-resizer', 'svg-to-png', 'png-to-svg', 'image-converter'],
} satisfies Tool;
