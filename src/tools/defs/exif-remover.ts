import { MEASURED } from '../lib/notes';
import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'exif-remover',
  category: 'image',
  name: 'EXIF viewer & remover',
  title: 'EXIF Remover & Viewer: remove GPS and metadata from photos',
  h1: 'EXIF viewer & *remover*',
  description: 'See what your photos reveal (GPS location, camera, date taken) and strip EXIF, XMP and IPTC metadata without re-encoding. Free, nothing uploaded.',
  tagline: 'See what your photos give away, then strip it without touching a pixel.',
  keywords: [
    'remove exif data',
    'exif viewer',
    'remove gps from photo',
    'remove metadata from photo',
    'exif remover',
    'photo metadata viewer',
    'strip exif',
    'remove location from photo',
    'exif data viewer',
  ],
  island: 'ExifRemover',
  steps: [
    'Drop in your photos: JPG, PNG, WebP, HEIC or AVIF, as many as you like.',
    'See what each one reveals: location, camera and lens, date taken, software and author.',
    'Download the cleaned copies one by one or as a zip. JPG, PNG and WebP keep every pixel exactly as it was.',
  ],
  faq: [
    {
      q: 'What is EXIF data?',
      a: 'EXIF is information your camera or phone saves inside each photo: the camera model, its settings, the date and time the photo was taken and often the GPS coordinates of where you were standing. XMP and IPTC are similar blocks that editing apps and photo agencies add, such as author names, copyright notes and edit history.',
    },
    {
      q: 'Does removing metadata reduce quality?',
      a: "Not for JPG, PNG and WebP (unless you pick \"rotate pixels\" for sideways photos). The tool rewrites the file around the image data and copies the compressed pixels over untouched, so the picture is identical. HEIC and AVIF are the exception: they're re-encoded at high quality (HEIC as JPG), which drops all metadata but isn't lossless.",
    },
    {
      q: 'Why does a cleaned photo still have a tiny EXIF block?',
      a: 'Phones often save photos sideways plus a tag that tells apps to rotate them. Without that tag the photo would show up sideways, so by default the tool writes back a tiny EXIF block (under 40 bytes) holding only the rotation and nothing else. Pick "rotate pixels" if you want no EXIF at all; those photos are then turned upright and re-encoded.',
    },
    {
      q: 'What else gets removed?',
      a: "Comments, embedded thumbnails (which can still show a photo before it was cropped), Photoshop and IPTC data, and anything stored after the end of the image, such as motion photo clips or HDR gain maps. The color profile is kept by default so colors look the same, but you can remove it too.",
    },
    filePrivacyFaq,
  ],
  notes: {
    settings: [
      { name: 'Keep color profile (on)', effect: 'Leaves the ICC profile in place so colors look the same; it describes colors, not you. Turn it off to remove it as well.' },
      { name: 'Keep rotation tag / rotate pixels', effect: 'Sideways phone photos need their rotation tag to show upright. "Keep rotation tag" writes back a tiny EXIF block holding only that; "rotate pixels" turns the photo upright and re-encodes it, leaving no EXIF at all.' },
    ],
    results: [
      { input: '12 MP Samsung Galaxy phone photo, JPG, 4.0 MB', setting: 'Defaults', output: '36 KB of metadata removed', note: 'camera model, firmware version, shooting settings and dates gone; pixels untouched, 0.1 s' },
      { input: '12 MP portrait whose EXIF held only a software name and a few basics, JPG, 3.0 MB', setting: 'Defaults', output: '1.1 KB of metadata removed', note: 'little to remove: check the "What\'s inside" list before assuming a photo is clean or dirty' },
    ],
    measured: MEASURED,
    formats: [
      { name: 'JPG, PNG and WebP', about: 'Cleaned by rewriting the file around the compressed image data, so the picture is bit-for-bit the same.' },
      { name: 'HEIC and AVIF', about: 'Re-encoded (HEIC as JPG) at high quality, which leaves no metadata but isn\'t lossless.' },
    ],
  },
  related: ['image-compressor', 'heic-to-jpg', 'blur-image', 'image-converter'],
} satisfies Tool;
