import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'instagram-grid-maker',
  category: 'image',
  name: 'Instagram grid maker',
  title: 'Instagram Grid Maker: split a photo into a 3×3 grid or carousel',
  h1: 'Instagram grid *maker*',
  description: 'Split one photo into 3×1 to 3×4 Instagram grid tiles or a seamless carousel. Numbered posting order, 3:4 or square tiles, free with no watermark.',
  tagline: 'Turn one photo into a giant profile grid or a seamless swipe carousel.',
  keywords: ['instagram grid', 'split image into 9', 'instagram puzzle feed', 'grid maker', 'seamless carousel', 'instagram panorama', 'split photo for instagram', 'image splitter', 'giant square'],
  island: 'GridSplitter',
  steps: [
    'Drop in one photo, then pick a profile grid (3×1 to 3×4) or a carousel of 2 to 10 slides.',
    'Drag the photo to frame it, zoom if you like, and check the numbered tiles.',
    'Download the tiles as a zip, already numbered in the order to post them.',
  ],
  faq: [
    { q: 'Why is tile 01 in the bottom-right corner?', a: 'Instagram shows your newest post at the top-left of your profile. So the bottom-right tile goes up first and the top-left tile goes up last, and once they are all posted the picture lines up. The files are named 01, 02 and so on in that upload order.' },
    { q: 'Should I pick 3:4 or square tiles?', a: 'Instagram\'s profile grid now shows posts as 3:4 portrait thumbnails, so 3:4 tiles (1080×1440) join up edge to edge there. Square posts get cropped at the sides to fill those taller thumbnails, so a square grid won\'t line up as cleanly on your profile.' },
    { q: 'Why doesn\'t my grid line up?', a: 'Every new post pushes the others along by one, so post all the tiles back to back, without other posts in between. Every grid here is a whole number of rows of three, which keeps your older posts aligned underneath. Pinned posts always sit at the start of your profile, so unpin them while the grid is on top.' },
    { q: 'How do I post a seamless carousel?', a: 'Create one carousel post and add the slides in order, starting with 01. Instagram shows every slide in a carousel at the same shape, so all slides are cut at the same size and the edges meet when people swipe.' },
    filePrivacyFaq,
  ],
  related: ['crop-image', 'collage-maker', 'image-resizer', 'image-compressor'],
  flagship: { elsewhere: 'Many grid apps add watermarks or charge for bigger grids', here: 'Every grid size free, no watermark' },
} satisfies Tool;
