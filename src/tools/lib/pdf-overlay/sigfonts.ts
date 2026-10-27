/** Handwriting fonts for typed signatures (OFL / Apache, files and licences in /fonts/signature/) */
export const sigFonts = [
  { id: 'caveat', label: 'Caveat', file: 'Caveat.ttf', scale: 1.05 },
  { id: 'dancing', label: 'Dancing Script', file: 'DancingScript.ttf', scale: 1 },
  { id: 'homemade', label: 'Homemade Apple', file: 'HomemadeApple.ttf', scale: 0.78 },
  { id: 'sacramento', label: 'Sacramento', file: 'Sacramento.ttf', scale: 1.3 },
] as const;

export type SigFont = (typeof sigFonts)[number];

export const sigFamily = (f: SigFont) => `RounderSig ${f.id}`;

const loading = new Map<string, Promise<void>>();

/** loads one font on first use; resolves once it can be drawn on a canvas */
export function loadSigFont(f: SigFont): Promise<void> {
  let p = loading.get(f.id);
  if (!p) {
    const face = new FontFace(sigFamily(f), `url(${import.meta.env.BASE_URL}fonts/signature/${f.file}) format("truetype")`);
    p = face.load().then((loaded) => {
      document.fonts.add(loaded);
    });
    p.catch(() => loading.delete(f.id));
    loading.set(f.id, p);
  }
  return p;
}
