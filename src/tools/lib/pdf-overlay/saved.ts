/* Signatures kept on this device, only when the person ticks "remember". */

export type SigRole = 'signature' | 'initials';

export interface SavedSig {
  id: string;
  role: SigRole;
  /** a PNG data URL */
  data: string;
}

const KEY = 'rounder:pdf-signatures';
const NAME_KEY = 'rounder:pdf-signer-name';
/** per role, newest first */
export const MAX_SAVED = 4;

export function parseSaved(raw: string | null): SavedSig[] {
  try {
    const list = JSON.parse(raw ?? '[]');
    if (!Array.isArray(list)) return [];
    return list.filter(
      (s): s is SavedSig =>
        typeof s?.id === 'string' && (s.role === 'signature' || s.role === 'initials') && typeof s.data === 'string' && s.data.startsWith('data:image/png;base64,'),
    );
  } catch {
    return [];
  }
}

/** adds a signature in front, keeping at most MAX_SAVED per role */
export function withSaved(list: SavedSig[], sig: SavedSig): SavedSig[] {
  const same = [sig, ...list.filter((s) => s.role === sig.role && s.id !== sig.id)].slice(0, MAX_SAVED);
  return [...same, ...list.filter((s) => s.role !== sig.role)];
}

export function loadSaved(): SavedSig[] {
  try {
    return parseSaved(localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

/** false when the browser refused (private mode, storage full) */
export function storeSaved(list: SavedSig[]): boolean {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list));
    else localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}

export function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function storeName(name: string) {
  try {
    if (name) localStorage.setItem(NAME_KEY, name);
    else localStorage.removeItem(NAME_KEY);
  } catch {
    // not remembering is fine
  }
}
