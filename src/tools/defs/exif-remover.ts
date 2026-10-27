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
  related: ['image-compressor', 'heic-to-jpg', 'blur-image', 'image-converter'],
} satisfies Tool;
