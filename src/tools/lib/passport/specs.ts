/*
 * Photo rules for passports, visas and ID documents. Measurements are in mm,
 * taken from each issuing authority's published requirements. Where a rule
 * doesn't give a value (most don't fix the eye line or the space above the
 * head), it is left out and guideFor() places a sensible guide instead.
 */

export interface PhotoSpec {
  id: string;
  country: string;
  document: string;
  widthMm: number;
  heightMm: number;
  /** how sizes are shown to the user */
  unit: 'in' | 'mm';
  /** head height, bottom of chin to top of head (crown, hair included) */
  head: [number, number];
  /** gap between the top of the head and the top edge, when the rules fix it */
  top?: [number, number];
  /** eye line measured up from the bottom edge, when the rules fix it */
  eyes?: [number, number];
  background: string;
  /** how bright the background has to be for the check */
  bright: 'white' | 'light';
  source: string;
}

const IN = 25.4;

/** the US rule, which India's 2×2 visa photo copies */
const twoByTwo: Pick<PhotoSpec, 'widthMm' | 'heightMm' | 'unit' | 'head' | 'eyes'> = {
  widthMm: 2 * IN,
  heightMm: 2 * IN,
  unit: 'in',
  head: [1 * IN, 1.375 * IN],
  eyes: [1.125 * IN, 1.375 * IN],
};

const iso: Pick<PhotoSpec, 'widthMm' | 'heightMm' | 'unit'> = { widthMm: 35, heightMm: 45, unit: 'mm' };

export const SPECS: PhotoSpec[] = [
  {
    id: 'us',
    country: 'United States',
    document: 'passport & visa',
    ...twoByTwo,
    background: 'Plain white or off-white, no shadows.',
    bright: 'white',
    // U.S. Department of State photo requirements and photo composition template (travel.state.gov)
    source: 'U.S. Department of State',
  },
  {
    id: 'uk',
    country: 'United Kingdom',
    document: 'passport',
    ...iso,
    // GOV.UK: head 29–34 mm from the bottom of the chin to the top of the head
    head: [29, 34],
    background: 'Plain cream or light grey.',
    bright: 'light',
    source: 'GOV.UK (HM Passport Office)',
  },
  {
    id: 'schengen',
    country: 'Schengen / EU',
    document: 'visa & passport',
    ...iso,
    // ICAO Doc 9303 biometric photo: chin to crown 70–80% of the photo height, i.e. about 32–36 mm (the range Germany and most Schengen states publish)
    head: [32, 36],
    background: 'Plain and light. Light grey is accepted almost everywhere; some countries ask for white.',
    bright: 'light',
    source: 'ICAO Doc 9303 / Schengen member states',
  },
  {
    id: 'canada',
    country: 'Canada',
    document: 'passport',
    widthMm: 50,
    heightMm: 70,
    unit: 'mm',
    // Government of Canada (IRCC) passport photo specifications: face 31–36 mm chin to crown
    head: [31, 36],
    background: 'Plain white or light-colored, evenly lit.',
    bright: 'white',
    source: 'Government of Canada (IRCC)',
  },
  {
    id: 'india-visa',
    country: 'India',
    document: 'visa & OCI (2×2 in)',
    ...twoByTwo,
    background: 'Plain white or light-colored.',
    bright: 'white',
    // Indian visa photo requirements (indianvisaonline.gov.in) use the same 2×2 in geometry as the US
    source: 'Government of India visa photo requirements',
  },
  {
    id: 'india',
    country: 'India',
    document: 'passport (35×45 mm)',
    ...iso,
    // Passport Seva only says the face should fill about 80% of the photo; we use the ICAO 32–36 mm range
    head: [32, 36],
    background: 'Plain white.',
    bright: 'white',
    source: 'Passport Seva (Ministry of External Affairs) / ICAO',
  },
  {
    id: 'australia',
    country: 'Australia',
    document: 'passport',
    ...iso,
    // Australian Passport Office: face 32–36 mm from chin to crown
    head: [32, 36],
    background: 'Plain white or light grey.',
    bright: 'light',
    source: 'Australian Passport Office (DFAT)',
  },
  {
    id: 'china',
    country: 'China',
    document: 'visa',
    widthMm: 33,
    heightMm: 48,
    unit: 'mm',
    // Chinese Visa Application Service Center: head 28–33 mm, 3–5 mm from the top of the head to the top edge
    head: [28, 33],
    top: [3, 5],
    background: 'White or close to white.',
    bright: 'white',
    source: 'Chinese Visa Application Service Center',
  },
  {
    id: 'japan',
    country: 'Japan',
    document: 'passport & visa',
    ...iso,
    // Ministry of Foreign Affairs of Japan: 34 ± 2 mm crown to chin, 4 ± 2 mm space above the head
    head: [32, 36],
    top: [2, 6],
    background: 'Plain, light-colored, no pattern.',
    bright: 'light',
    source: 'Ministry of Foreign Affairs of Japan',
  },
  {
    id: 'generic-35x45',
    country: 'Other',
    document: '35×45 mm (ICAO standard)',
    ...iso,
    // ICAO Doc 9303: head 70–80% of the photo height
    head: [31.5, 36],
    background: 'Plain and light. Check your country’s rules.',
    bright: 'light',
    source: 'ICAO Doc 9303',
  },
  {
    id: 'generic-2x2',
    country: 'Other',
    document: '2×2 in',
    ...twoByTwo,
    background: 'Plain white or off-white.',
    bright: 'white',
    source: 'U.S. Department of State 2×2 in geometry',
  },
];

export const DPI = 300;
export const mmToPx = (mm: number, dpi = DPI) => Math.round((mm / IN) * dpi);

export interface Guide {
  width: number;
  height: number;
  /** target line for the top of the head (y, px); a band when the rules give a range */
  crown: [number, number];
  /** where the chin may sit if the crown is on its target */
  chin: [number, number];
  eyes: [number, number];
  /** target head height in px (middle of the allowed range) */
  head: number;
}

/** The overlay guide for a spec, in output pixels at 300 dpi */
export function guideFor(spec: PhotoSpec): Guide {
  const width = mmToPx(spec.widthMm);
  const height = mmToPx(spec.heightMm);
  const k = height / spec.heightMm;
  const head = (spec.head[0] + spec.head[1]) / 2;
  // without a rule, leave 30% of the spare height above the head and 70% below for neck and shoulders
  const crown: [number, number] = spec.top ?? [(spec.heightMm - head) * 0.3, (spec.heightMm - head) * 0.3];
  const crownMid = (crown[0] + crown[1]) / 2;
  // eyes sit a little under halfway down a head measured from crown to chin
  const eyes: [number, number] = spec.eyes
    ? [spec.heightMm - spec.eyes[1], spec.heightMm - spec.eyes[0]]
    : [crownMid + head * 0.42, crownMid + head * 0.54];
  const px = ([a, b]: [number, number]): [number, number] => [a * k, b * k];
  return {
    width,
    height,
    crown: px(crown),
    chin: px([crownMid + spec.head[0], crownMid + spec.head[1]]),
    eyes: px(eyes),
    head: head * k,
  };
}

const EIGHTHS = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞'];

/** 34.925 → "1⅜ in", 45 → "45 mm" */
export function formatLength(mm: number, unit: 'in' | 'mm') {
  if (unit === 'mm') return `${Math.round(mm * 10) / 10} mm`;
  const eighths = Math.round((mm / IN) * 8);
  const whole = Math.floor(eighths / 8);
  const frac = EIGHTHS[eighths % 8];
  return `${whole || (frac ? '' : '0')}${frac} in`;
}

export function sizeLabel(spec: PhotoSpec) {
  return spec.unit === 'in'
    ? `${formatLength(spec.widthMm, 'in').slice(0, -3)} × ${formatLength(spec.heightMm, 'in')}`
    : `${spec.widthMm} × ${spec.heightMm} mm`;
}
