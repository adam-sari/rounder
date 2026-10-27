// Character limits of the places people paste text into, each counted the way that platform counts.

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;

/** the characters you see: an emoji, a flag or an accented letter is one, however many code points it takes */
export function graphemeList(text: string): string[] {
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
}

export const graphemes = (text: string) => graphemeList(text).length;

/* ---------- X (twitter-text v3: weight 1 for these ranges, 2 for the rest; links 23; any emoji 2) ---------- */

const X_LIGHT: [number, number][] = [[0x0000, 0x10ff], [0x2000, 0x200d], [0x2010, 0x201f], [0x2032, 0x2037]];
const X_URL_LENGTH = 23;
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;
// links with a scheme or www., plus bare domains on the most common endings; X spots a few more than this.
// Like X, nothing glued to a letter, digit, @, $ or # is a link, so name@gmail.com counts letter by letter.
const URL = /(?<![\p{L}\p{N}_@＠$#＃])(?:(?:https?:\/\/|www\.)[^\s]+|(?:[a-z0-9-]+\.)+(?:com|org|net|io|co|ai|app|dev|gov|edu|me|ly|us|uk|ca|de|fr|info|tv|gg|xyz)\b(?:\/[^\s]*)?)/giu;

const codeWeight = (cp: number) => (X_LIGHT.some(([a, b]) => cp >= a && cp <= b) ? 1 : 2);

export function xLength(text: string): number {
  let length = 0;
  const rest = text.normalize('NFC').replace(URL, (url) => {
    // a sentence's closing punctuation isn't part of the link
    const tail = url.match(/[.,!?;:)'"]+$/)?.[0] ?? '';
    length += X_URL_LENGTH;
    return tail;
  });
  for (const g of graphemeList(rest)) {
    if (EMOJI.test(g)) length += 2;
    else for (const ch of g) length += codeWeight(ch.codePointAt(0)!);
  }
  return length;
}

/* ---------- SMS (GSM 03.38; anything else switches the whole message to UCS-2) ---------- */

const GSM_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
);
/** the extension table: each takes an escape plus the character, so it counts as 2 */
const GSM_EXTENDED = new Set('^{}\\[~]|€\f');

export interface SmsInfo {
  encoding: 'GSM-7' | 'UCS-2';
  /** characters as the network counts them: GSM-7 septets, or UTF-16 units for UCS-2 */
  units: number;
  /** how many texts the message is sent as (0 when empty) */
  segments: number;
  /** what one text holds alone (160 or 70) */
  single: number;
  /** what each part holds once it is split (153 or 67) */
  perPart: number;
  /** the first character that forced UCS-2 */
  culprit?: string;
}

export function smsInfo(text: string): SmsInfo {
  let septets = 0;
  let culprit: string | undefined;
  let at = 0;
  for (const ch of text) {
    if (GSM_BASIC.has(ch)) septets += 1;
    else if (GSM_EXTENDED.has(ch)) septets += 2;
    else {
      // the whole character it belongs to (an emoji with its skin tone), without segmenting the rest of a long text
      culprit = graphemeList(text.slice(at, at + 64))[0];
      break;
    }
    at += ch.length;
  }
  const [encoding, units, single, perPart] = culprit === undefined ? (['GSM-7', septets, 160, 153] as const) : (['UCS-2', text.length, 70, 67] as const);
  const segments = units === 0 ? 0 : units <= single ? 1 : Math.ceil(units / perPart);
  return { encoding, units, segments, single, perPart, culprit };
}

/* ---------- the meters ---------- */

export type LimitId = 'x' | 'instagram' | 'sms' | 'meta' | 'youtube';

export interface LimitCheck {
  id: LimitId;
  label: string;
  used: number;
  max: number;
  /** a rule of thumb rather than a cap the platform enforces */
  soft: boolean;
  state: 'ok' | 'near' | 'over';
  /** the line under the meter: what's left, how far over, or how a long text is split */
  status: string;
  detail?: string;
}

const n = (x: number) => x.toLocaleString('en-US');

/** a character as the meter names it: invisible ones (a no-break space, a tab, a zero-width space) and lone accents by their code */
export function shown(c: string) {
  const code = `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;
  return /^[\s\p{Cf}\p{Cc}]/u.test(c) ? `the invisible character ${code}` : /^\p{M}/u.test(c) ? `the accent mark ${code}` : `“${c}”`;
}

function meter(id: LimitId, label: string, used: number, max: number, extra: Partial<LimitCheck> = {}): LimitCheck {
  const soft = extra.soft ?? false;
  const status = used > max ? `${n(used - max)} over${soft ? ', may be cut off' : ''}` : `${n(max - used)} left`;
  return { id, label, used, max, soft, state: used > max ? 'over' : used >= max * 0.9 ? 'near' : 'ok', status, ...extra };
}

function check(id: LimitId, text: string): LimitCheck {
  switch (id) {
    case 'x':
      return meter(id, 'X post', xLength(text), 280, { detail: 'links count as 23, emoji and CJK as 2' });
    case 'sms': {
      // a long text isn't refused, it's sent in parts
      const s = smsInfo(text);
      const split = s.segments > 1 ? { status: `sent as ${s.segments} texts of up to ${s.perPart}` } : {};
      return meter(id, 'SMS text', s.units, s.single, { ...split, detail: s.culprit ? `${s.encoding} because of ${shown(s.culprit)}` : s.encoding });
    }
    case 'instagram':
      return meter(id, 'Instagram caption', graphemes(text), 2200);
    case 'youtube':
      return meter(id, 'YouTube title', graphemes(text), 100);
    case 'meta':
      return meter(id, 'Meta description', graphemes(text), 160, { soft: true, detail: 'a guide: Google sets no limit' });
  }
}

export const checkLimits = (text: string, ids: LimitId[]) => ids.map((id) => check(id, text));
