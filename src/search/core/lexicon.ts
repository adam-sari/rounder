// The words the intent parser knows: formats and their aliases, generic nouns, actions, objects, platforms, units.
// Aliases are matched as whole phrases, so multi-word ones ("iphone photo") win over their parts.

export type Kind = 'image' | 'video' | 'audio' | 'pdf' | 'office' | 'text' | 'data' | 'archive';

export const FORMATS: Record<string, { kind: Kind; aliases: string[]; label: string }> = {
  jpg: { kind: 'image', label: 'JPG', aliases: ['jpg', 'jpeg', 'jfif', 'jpe'] },
  png: { kind: 'image', label: 'PNG', aliases: ['png'] },
  webp: { kind: 'image', label: 'WebP', aliases: ['webp'] },
  avif: { kind: 'image', label: 'AVIF', aliases: ['avif'] },
  heic: { kind: 'image', label: 'HEIC', aliases: ['heic', 'heif', 'iphone photo', 'iphone photos', 'iphone pic', 'iphone pics', 'iphone picture', 'iphone pictures', 'iphone image', 'iphone images', 'apple photo', 'ios photo'] },
  gif: { kind: 'image', label: 'GIF', aliases: ['gif'] },
  bmp: { kind: 'image', label: 'BMP', aliases: ['bmp'] },
  svg: { kind: 'image', label: 'SVG', aliases: ['svg', 'vector'] },
  ico: { kind: 'image', label: 'ICO', aliases: ['ico', 'favicon'] },
  pdf: { kind: 'pdf', label: 'PDF', aliases: ['pdf', 'pdfs'] },
  docx: { kind: 'office', label: 'Word', aliases: ['word', 'docx', 'doc', 'word document', 'word file'] },
  xlsx: { kind: 'office', label: 'Excel', aliases: ['excel', 'xlsx', 'xls', 'spreadsheet'] },
  pptx: { kind: 'office', label: 'PowerPoint', aliases: ['powerpoint', 'ppt', 'pptx', 'slides', 'presentation'] },
  txt: { kind: 'text', label: 'text', aliases: ['text', 'txt', 'notes', 'transcript'] },
  md: { kind: 'text', label: 'Markdown', aliases: ['markdown', 'md'] },
  html: { kind: 'text', label: 'HTML', aliases: ['html'] },
  csv: { kind: 'data', label: 'CSV', aliases: ['csv'] },
  json: { kind: 'data', label: 'JSON', aliases: ['json'] },
  epub: { kind: 'text', label: 'EPUB', aliases: ['epub'] },
  mp4: { kind: 'video', label: 'MP4', aliases: ['mp4', 'm4v', 'mpeg4'] },
  mov: { kind: 'video', label: 'MOV', aliases: ['mov', 'quicktime', 'iphone video', 'iphone videos'] },
  webm: { kind: 'video', label: 'WebM', aliases: ['webm'] },
  mkv: { kind: 'video', label: 'MKV', aliases: ['mkv'] },
  avi: { kind: 'video', label: 'AVI', aliases: ['avi'] },
  mp3: { kind: 'audio', label: 'MP3', aliases: ['mp3'] },
  wav: { kind: 'audio', label: 'WAV', aliases: ['wav'] },
  m4a: { kind: 'audio', label: 'M4A', aliases: ['m4a'] },
  flac: { kind: 'audio', label: 'FLAC', aliases: ['flac'] },
  ogg: { kind: 'audio', label: 'OGG', aliases: ['ogg', 'opus'] },
  midi: { kind: 'audio', label: 'MIDI', aliases: ['midi', 'mid'] },
  m4r: { kind: 'audio', label: 'M4R', aliases: ['m4r', 'ringtone'] },
  zip: { kind: 'archive', label: 'ZIP', aliases: ['zip', 'rar', '7z', 'tar'] },
};

/** generic nouns that name a kind of file without a format */
export const KINDS: Partial<Record<Kind, string[]>> = {
  image: ['photo', 'photos', 'picture', 'pictures', 'pic', 'pics', 'image', 'images', 'img', 'screenshot', 'screenshots', 'selfie', 'dp', 'wallpaper', 'logo', 'scan', 'scans'],
  video: ['video', 'videos', 'clip', 'movie', 'reel', 'recording', 'screen recording', 'lecture video'],
  audio: ['audio', 'song', 'songs', 'music', 'voice', 'podcast', 'sound', 'track'],
  pdf: ['document', 'contract', 'scanned'],
};

/** canonical actions and the words that ask for them */
export const ACTIONS: Record<string, string[]> = {
  compress: ['compress', 'compressor', 'compresser', 'shrink', 'smaller', 'small', 'reduce', 'reducer', 'decrease', 'minimize', 'optimize', 'lower', 'too big', 'too large', 'less mb', 'under', 'below', 'within'],
  convert: ['convert', 'converter', 'change', 'turn', 'transform', 'save as', 'export', 'into'],
  resize: ['resize', 'resizer', 'dimensions', 'scale', 'size', 'pixels'],
  increase: ['increase', 'bigger', 'larger', 'enlarge'],
  crop: ['crop', 'cropper'],
  rotate: ['rotate', 'sideways', 'upside down', 'flip', 'mirror'],
  trim: ['trim', 'cut', 'cutter', 'shorten', 'shorter', 'trimmer', 'cut off'],
  merge: ['merge', 'combine', 'join', 'together', 'joiner', 'merger'],
  split: ['split', 'separate', 'splitter'],
  remove: ['remove', 'remover', 'erase', 'eraser', 'delete', 'get rid', 'take off', 'strip', 'hide'],
  extract: ['extract', 'pull', 'rip', 'out of', 'from video'],
  upscale: ['upscale', 'hd', 'clearer', 'clear', 'enhance', 'sharpen', '4k', 'high resolution', 'better quality', 'unblur', 'sharper'],
  transcribe: ['transcribe', 'transcription', 'speech to text', 'to text', 'transcript'],
  protect: ['lock', 'protect', 'encrypt', 'password protect', 'secure'],
  unlock: ['unlock', 'decrypt', 'remove password', 'password remover'],
  sign: ['sign', 'signature', 'e-sign', 'esign'],
  louder: ['louder', 'boost', 'amplify', 'increase volume', 'volume'],
  slower: ['slow down', 'slower', 'slow motion'],
  faster: ['speed up', 'faster'],
  colorize: ['colorize', 'colourise', 'colorise', 'colourize', 'colour', 'color'],
  blur: ['blur', 'pixelate', 'censor'],
  number: ['number', 'page numbers', 'numbering'],
  searchable: ['searchable', 'ocr'],
  edit: ['edit', 'editor', 'add text'],
  watermark: ['watermark'],
  record: ['record', 'recorder'],
};

/** what an action is done to, when it isn't the file itself */
export const OBJECTS: Record<string, string[]> = {
  background: ['background', 'bg', 'backdrop'],
  noise: ['noise', 'hiss', 'hum', 'background noise', 'noisy'],
  vocals: ['vocals', 'vocal', 'voice from song', 'singer', 'lyrics', 'karaoke'],
  watermark: ['watermark'],
  people: ['people', 'person', 'object', 'objects', 'stranger', 'tourists'],
  password: ['password'],
  sound: ['sound', 'audio'],
  location: ['location', 'gps', 'metadata', 'exif'],
  faces: ['face', 'faces', 'license plate'],
  pages: ['pages', 'page'],
};

/**
 * Platforms and what they imply. File caps match LIMITS in src/tools/lib/notes.ts, which quotes each platform's own help
 * page (tests/unit/search/lexicon.test.ts keeps the two in step). WhatsApp has no official figure we can cite, so it gets
 * no number.
 */
export const PLATFORMS: Record<string, { label: string; aliases?: string[]; fileMB?: number; limit?: string }> = {
  discord: { label: 'Discord', fileMB: 10, limit: 'discord' },
  gmail: { label: 'Gmail', fileMB: 25, limit: 'gmail' },
  outlook: { label: 'Outlook', aliases: ['outlook', 'hotmail'], fileMB: 20, limit: 'outlook' },
  yahoo: { label: 'Yahoo Mail', aliases: ['yahoo'], fileMB: 25, limit: 'yahoo' },
  // the strictest common cap, so the file fits both Gmail and Outlook
  email: { label: 'email', aliases: ['email', 'e-mail', 'mail', 'attachment', 'emailing'], fileMB: 20, limit: 'outlook' },
  exchange: { label: 'work email', aliases: ['work email', 'exchange'], fileMB: 10, limit: 'exchange' },
  whatsapp: { label: 'WhatsApp', aliases: ['whatsapp', 'wa'] },
  instagram: { label: 'Instagram', aliases: ['instagram', 'insta', 'ig'] },
  facebook: { label: 'Facebook', aliases: ['facebook', 'fb'] },
  tiktok: { label: 'TikTok', aliases: ['tiktok', 'reels', 'shorts'] },
  youtube: { label: 'YouTube', aliases: ['youtube', 'yt'] },
  linkedin: { label: 'LinkedIn' },
  twitter: { label: 'X', aliases: ['twitter', 'tweet'] },
  exam: { label: 'exam form', aliases: ['ssc', 'upsc', 'neet', 'jee', 'gate', 'ibps', 'pan card', 'pan', 'aadhaar', 'aadhar', 'exam', 'govt form', 'application form', 'online application', 'college portal'] },
  passport: { label: 'passport', aliases: ['passport', 'visa'] },
};

export const DEVICES: Record<string, string[]> = { iphone: ['iphone', 'ipad', 'ios'], android: ['android', 'samsung'], mac: ['mac', 'macbook'] };

/** unit words → UnitConverter's unit ids */
export const UNITS: Record<string, string> = {
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilograms: 'kg', lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  c: 'c', celsius: 'c', f: 'f', fahrenheit: 'f', cm: 'cm', in: 'in', inch: 'in', inches: 'in', km: 'km', mi: 'mi', mile: 'mi',
  miles: 'mi', ft: 'ft', feet: 'ft', foot: 'ft', m: 'm', meter: 'm', meters: 'm', metres: 'm', ml: 'ml', l: 'l', liter: 'l',
  liters: 'l', litres: 'l', oz: 'oz', ounce: 'oz', ounces: 'oz', g: 'g', gram: 'g', grams: 'g', mm: 'mm', mph: 'mph', kmh: 'kmh',
  kph: 'kmh',
};

/** what each unit measures: a conversion needs both ends to measure the same thing ("oz" next to "ml" is fluid ounces) */
export const UNIT_DIM: Record<string, string> = {
  kg: 'mass', lb: 'mass', g: 'mass', oz: 'mass', c: 'temp', f: 'temp', cm: 'length', in: 'length', km: 'length', mi: 'length',
  ft: 'length', m: 'length', mm: 'length', ml: 'volume', l: 'volume', 'floz-us': 'volume', mph: 'speed', kmh: 'speed',
};

/** intents Rounder can't serve; answered honestly instead of with a confident guess */
export const UNSUPPORTED: { re: RegExp; say: string }[] = [
  { re: /\b(download|save|grab|rip)\b.*\b(youtube|yt|instagram|insta|tiktok|facebook|twitter|reels?|spotify)\b|\b(youtube|instagram|tiktok|facebook|twitter|spotify)\b.*\bdownload|\b(youtube|yt|spotify|soundcloud|tiktok|instagram|insta)( video| videos| song| link| url)? (to|2) (mp3|mp4|audio|video|wav|m4a)\b/, say: "Rounder doesn't download from other sites. For a file you already have, try these:" },
  { re: /\b(log ?in|sign ?up|account)\b/, say: 'Rounder has no accounts. Every tool works without one.' },
];
