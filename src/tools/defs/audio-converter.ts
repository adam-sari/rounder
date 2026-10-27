import { formatInfo, sourceInfo, type OutFormat, type SourceFormat } from '../lib/audio-converter/formats';
import { filePrivacyFaq, type Tool } from '../types';

type Copy = Pick<Tool, 'title' | 'description' | 'tagline' | 'keywords' | 'steps' | 'faq' | 'related' | 'flagship'>;

/** a /from-to-to page that opens the converter preset to that pair */
function variant(from: SourceFormat, to: OutFormat, copy: Copy): Tool {
  const a = sourceInfo[from].label;
  const b = formatInfo[to].label;
  return {
    slug: `${from}-to-${to}`,
    category: 'audio',
    name: `${a} to ${b}`,
    h1: `${a} to *${b}*`,
    island: 'AudioConverter',
    props: { from, to },
    variantOf: 'audio-converter',
    ...copy,
    faq: [...copy.faq, filePrivacyFaq],
  };
}

export default [
  {
    slug: 'audio-converter',
    category: 'audio',
    name: 'Audio converter',
    title: 'Audio Converter: MP3, WAV, M4A, OGG & FLAC in bulk, free',
    h1: 'Audio *converter*',
    description: 'Convert audio between MP3, WAV, M4A, OGG and FLAC. Batch convert with your choice of bitrate and sample rate. Free, no file limits, nothing uploaded.',
    tagline: 'Turn any audio file into MP3, M4A, WAV, OGG or FLAC, a whole folder at once.',
    keywords: ['audio converter', 'convert audio', 'audio file converter', 'mp3 converter', 'convert to mp3', 'wav converter', 'flac converter', 'batch audio converter'],
    island: 'AudioConverter',
    props: { to: 'mp3' },
    steps: [
      'Drop in your audio files: MP3, WAV, M4A, FLAC, OGG and more, as many as you like.',
      'Pick the format to convert to, and adjust the quality, sample rate or channels if you want.',
      'Press Convert, then download each file or all of them at once as a zip.',
    ],
    faq: [
      { q: 'Which format should I choose?', a: 'MP3 if the file has to play everywhere, from old car stereos to any phone. M4A (AAC) sounds a little better than MP3 at the same size and is the Apple default. WAV for audio editors and DAWs. FLAC to keep perfect quality in less space than WAV. OGG for games and web projects that ask for it.' },
      { q: 'Will converting improve the quality?', a: 'No. Converting an MP3 or M4A to WAV or FLAC keeps it exactly as it is, but can\'t bring back what lossy compression already removed. Going from lossless (WAV, FLAC) to a lossy format like MP3 does lose a little, which is hard to hear at 192 kbps and above.' },
      { q: 'What bitrate should I use?', a: 'For music in MP3, 192 kbps is a solid everyday choice and 320 kbps is the highest MP3 goes. For speech and podcasts, 128 kbps is plenty. The file list shows the estimated size before you convert.' },
      { q: 'Can I convert a video to audio?', a: 'Yes. Drop in an MP4, MOV, WebM or MKV and you get its soundtrack in the format you pick.' },
      { q: 'Are the song tags kept?', a: 'By default the title, artist and album tags are carried over where the output format can hold them. Untick "Keep title, artist and album tags" for clean files.' },
      filePrivacyFaq,
    ],
    related: ['audio-cutter', 'audio-joiner', 'video-to-mp3', 'volume-booster'],
    next: ['audio-cutter', 'audio-normalizer'],
    flagship: { elsewhere: 'Upload size caps and a few free conversions a day', here: 'Unlimited files, converted on your device' },
  },

  variant('mp3', 'wav', {
    title: 'MP3 to WAV Converter: free, in bulk, no upload',
    description: 'Convert MP3 to WAV for audio editors, DAWs, CD burning and apps that only take WAV. 16-bit or 24-bit, batch convert, nothing is uploaded.',
    tagline: 'Uncompressed WAV copies of your MP3s, ready for any editor.',
    keywords: ['mp3 to wav', 'convert mp3 to wav', 'mp3 to wav converter', 'mp3 to wav 16 bit', 'mp3 to wav 44100', 'change mp3 to wav', 'mp3 to wav batch'],
    steps: [
      'Drop in your MP3 files, one or a whole album.',
      'WAV is already selected. Keep 16-bit unless your project needs 24-bit, and pick 44.1 kHz for CDs.',
      'Press Convert, then download each WAV or all of them as a zip.',
    ],
    faq: [
      { q: 'Why convert MP3 to WAV?', a: 'Some audio editors, samplers, CD-burning apps and phone systems only accept WAV. WAV is also simpler for software to work with, since it doesn\'t need decoding.' },
      { q: 'Will the WAV sound better than the MP3?', a: 'No. The WAV is an exact copy of what the MP3 sounds like, nothing more. It just stops any further loss if you edit and re-save it.' },
      { q: 'Why is the WAV file so big?', a: 'WAV stores audio uncompressed: 16-bit stereo at 44.1 kHz is about 10 MB per minute, roughly seven times the size of a 192 kbps MP3.' },
      { q: '16-bit or 24-bit?', a: '16-bit is CD quality and opens everywhere. 24-bit only helps when you plan heavy editing; it can\'t add detail the MP3 didn\'t have.' },
    ],
    related: ['wav-to-mp3', 'audio-cutter', 'audio-converter'],
  }),

  variant('wav', 'mp3', {
    title: 'WAV to MP3 Converter: shrink WAV files, batch & free',
    description: 'Convert big WAV recordings to small MP3s at 128 to 320 kbps. Batch convert with no file limits. Free, and nothing leaves your device.',
    tagline: 'Turn huge WAV recordings into small MP3s that play anywhere.',
    keywords: ['wav to mp3', 'convert wav to mp3', 'wav to mp3 converter', 'wav to mp3 320kbps', 'compress wav', 'reduce wav file size', 'wav to mp3 batch'],
    steps: [
      'Drop in your WAV files, as many as you like.',
      'MP3 is already selected. 192 kbps suits most music; choose 320 for the best quality or 128 for speech.',
      'Press Convert, then download each MP3 or all of them as a zip.',
    ],
    faq: [
      { q: 'How much smaller will the MP3 be?', a: 'A lot. CD-quality WAV runs at 1,411 kbps, so a 192 kbps MP3 is about a seventh of the size and a 128 kbps MP3 about an eleventh. The file list estimates each size before you convert.' },
      { q: 'Will I hear a difference?', a: 'MP3 is lossy, so a little detail is removed. At 192 kbps most people can\'t tell on everyday headphones or speakers, and 320 kbps is the most MP3 can do. Keep the WAV if you\'ll edit the audio further.' },
      { q: 'Can I convert long recordings?', a: 'Yes. There\'s no length or size cap from us. Long recordings simply take longer, and the progress bar shows how long is left.' },
      { q: 'Should I pick mono?', a: 'For a single voice, like an interview or lecture, mono at 128 kbps sounds just as clear. For music, keep stereo.' },
    ],
    related: ['mp3-to-wav', 'audio-cutter', 'audio-normalizer'],
    flagship: { elsewhere: 'Upload caps that big WAV files hit quickly', here: 'No size cap, converted on your device' },
  }),

  variant('m4a', 'mp3', {
    title: 'M4A to MP3 Converter: Voice Memos & iTunes songs, free',
    description: 'Convert M4A files, like iPhone Voice Memos and iTunes downloads, to MP3 that plays everywhere. Batch convert, free, nothing uploaded.',
    tagline: 'Turn iPhone voice memos and iTunes songs into MP3s that play anywhere.',
    keywords: ['m4a to mp3', 'convert m4a to mp3', 'm4a to mp3 converter', 'voice memo to mp3', 'iphone voice memo to mp3', 'itunes to mp3', 'aac to mp3', 'm4a converter'],
    steps: [
      'Drop in your M4A files, such as Voice Memos shared from your iPhone or songs from your iTunes library.',
      'MP3 is already selected. 192 kbps suits music; for voice memos, 128 kbps in mono is plenty.',
      'Press Convert, then download each MP3 or all of them as a zip.',
    ],
    faq: [
      { q: 'What is an M4A file?', a: 'An audio file holding AAC sound in an MP4 container. iPhone Voice Memos and songs bought from the iTunes Store are saved as M4A. Apple devices play it fine, but some older players, car stereos and upload forms only take MP3.' },
      { q: 'How do I get Voice Memos off my iPhone?', a: 'In the Voice Memos app, tap a recording, tap the share button and choose Save to Files, AirDrop or Mail. Then drop the M4A here.' },
      { q: 'Can I convert Apple Music songs?', a: 'No. Songs downloaded through an Apple Music subscription are copy-protected, and protected files can\'t be converted. Songs bought from the iTunes Store since 2009 are not protected and convert fine.' },
      { q: 'Does it lose quality?', a: 'Both formats are lossy, so a little is lost in the switch. At 192 kbps or above it\'s very hard to hear.' },
    ],
    related: ['audio-cutter', 'ringtone-maker', 'voice-recorder'],
  }),

  variant('flac', 'mp3', {
    title: 'FLAC to MP3 Converter: lossless to MP3 in bulk, free',
    description: 'Convert FLAC albums to MP3 for car stereos, phones and players that don\'t do FLAC. 320 kbps, tags kept, batch convert. Nothing is uploaded.',
    tagline: 'MP3 copies of your lossless FLAC albums for the car, phone or old player.',
    keywords: ['flac to mp3', 'convert flac to mp3', 'flac to mp3 converter', 'flac to mp3 320', 'flac to mp3 batch', 'lossless to mp3', 'flac converter'],
    steps: [
      'Drop in your FLAC files, a track or a whole album.',
      'MP3 is already selected. Pick 320 kbps for the best quality, or 192 kbps to fit more on a phone.',
      'Press Convert, then download each MP3 or the whole album as a zip.',
    ],
    faq: [
      { q: 'Why convert FLAC to MP3?', a: 'FLAC keeps perfect CD quality but its files are big, and many car stereos, older MP3 players and some apps can\'t play it. MP3 plays everywhere at a fraction of the size. Keep your FLACs as the master copy.' },
      { q: '320 or 256 kbps?', a: '320 kbps is the highest quality MP3 offers and sounds transparent to almost everyone. 256 kbps is very close and saves about a fifth of the space.' },
      { q: 'Are the album tags kept?', a: 'Yes. Title, artist and album tags are carried over by default, so your player still sorts the music properly.' },
      { q: 'What about hi-res 24-bit/96 kHz FLAC?', a: 'It converts fine. MP3 tops out at 48 kHz, so hi-res files are resampled on the way, which you won\'t hear in an MP3 anyway.' },
    ],
    related: ['audio-cutter', 'audio-joiner', 'audio-normalizer'],
    flagship: { elsewhere: 'Size caps that rule out whole FLAC albums', here: 'Whole albums at once, no size cap' },
  }),

  variant('ogg', 'mp3', {
    title: 'OGG to MP3 Converter: game sounds & voice messages, free',
    description: 'Convert OGG audio, from game files to WhatsApp, Telegram and Discord voice messages, to MP3 that plays anywhere. Batch convert, nothing uploaded.',
    tagline: 'Turn OGG game sounds and voice messages into MP3s that play anywhere.',
    keywords: ['ogg to mp3', 'convert ogg to mp3', 'ogg to mp3 converter', 'opus to mp3', 'ogg vorbis to mp3', 'voice message to mp3', 'whatsapp audio to mp3', 'ogg converter'],
    steps: [
      'Drop in your OGG or OPUS files, such as game sounds or saved voice messages.',
      'MP3 is already selected. 128 kbps is plenty for voice; use 192 kbps or more for music.',
      'Press Convert, then download each MP3 or all of them as a zip.',
    ],
    faq: [
      { q: 'Where do OGG files come from?', a: 'OGG is a free, open format. Many games store their music and sound effects as Ogg Vorbis, and messaging apps like WhatsApp, Telegram and Discord save voice messages as Ogg Opus, often with a .ogg or .opus ending.' },
      { q: 'Why convert OGG to MP3?', a: 'Many car stereos, older players, some editing apps and upload forms can\'t open OGG files. MP3 works everywhere.' },
      { q: 'Does it work with .opus files?', a: 'Yes. An .opus file is Opus audio in an Ogg container, and it converts the same way.' },
      { q: 'Will it sound worse?', a: 'Both formats are lossy, so a tiny bit is lost. For voice messages you won\'t notice; for music, choose 192 kbps or higher.' },
    ],
    related: ['audio-cutter', 'volume-booster', 'audio-noise-reduction'],
  }),
] satisfies Tool[];
