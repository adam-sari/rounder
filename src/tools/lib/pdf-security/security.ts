/* PDF passwords and permissions, mapped to qpdf's 256-bit AES (--encrypt … --bits=256) options. */

export interface Permissions {
  print: boolean;
  copy: boolean;
  edit: boolean;
  comment: boolean;
  forms: boolean;
}

export const ALLOW_ALL: Permissions = { print: true, copy: true, edit: true, comment: true, forms: true };

export const PERMISSIONS: { key: keyof Permissions; label: string }[] = [
  { key: 'print', label: 'Print' },
  { key: 'copy', label: 'Copy text & images' },
  { key: 'edit', label: 'Edit pages & content' },
  { key: 'comment', label: 'Add comments' },
  { key: 'forms', label: 'Fill in forms' },
];

export interface ProtectSettings {
  openPassword: string;
  confirm: string;
  /** used only while restricting; blank means a random one */
  ownerPassword: string;
  restrict: boolean;
  allow: Permissions;
}

// the PDF standard lets anyone who may comment also fill in forms
export const formsAllowed = (allow: Permissions) => allow.forms || allow.comment;

export const isRestricting = (s: Pick<ProtectSettings, 'restrict' | 'allow'>) =>
  s.restrict && (!s.allow.print || !s.allow.copy || !s.allow.edit || !s.allow.comment || !formsAllowed(s.allow));

/** Why the settings can't be used yet, written for people; null when they can */
export function protectProblem(s: ProtectSettings): string | null {
  const restricting = isRestricting(s);
  if (!s.openPassword && !restricting) return s.restrict ? 'Untick at least one permission, or set an open password.' : 'Choose a password.';
  if (s.openPassword && s.confirm !== s.openPassword) return s.confirm ? "The passwords don't match yet." : 'Type the password again to confirm it.';
  if (restricting && s.ownerPassword && s.ownerPassword === s.openPassword) return 'Use a different permissions password, or anyone who can open the file could lift the restrictions.';
  return null;
}

/** 32 random characters for a permissions password nobody needs to know */
export function randomPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint32Array(32)), (n) => chars[n % chars.length]).join('');
}

/** qpdf arguments that encrypt "in.pdf" into "out.pdf". Check protectProblem() first. */
export function encryptArgs(s: ProtectSettings, random = randomPassword): string[] {
  const restricting = isRestricting(s);
  // without restrictions the open password is the owner password too; qpdf refuses a blank owner password
  const owner = restricting ? s.ownerPassword || random() : s.openPassword;
  const args = ['--encrypt', `--user-password=${s.openPassword}`, `--owner-password=${owner}`, '--bits=256'];
  if (restricting) {
    const { allow } = s;
    if (!allow.print) args.push('--print=none');
    if (!allow.copy) args.push('--extract=n');
    if (!allow.edit) args.push('--modify-other=n', '--assemble=n');
    if (!allow.comment) args.push('--annotate=n');
    if (!formsAllowed(allow)) args.push('--form=n');
  }
  return [...args, '--', 'in.pdf', 'out.pdf'];
}

/** PDF permission bits, as pdf.js reports them in getPermissions() */
export const FLAG = { PRINT: 0x04, MODIFY: 0x08, COPY: 0x10, ANNOTATE: 0x20, FORMS: 0x100, ASSEMBLE: 0x400, PRINT_HQ: 0x800 } as const;

/** What an encrypted PDF stops people from doing, from its allowed-permission set (null = no restrictions) */
export function describeRestrictions(allowed: Set<number> | null): string[] {
  if (!allowed) return [];
  const has = (f: number) => allowed.has(f);
  const out: string[] = [];
  if (!has(FLAG.PRINT)) out.push('printing');
  else if (!has(FLAG.PRINT_HQ)) out.push('high-quality printing');
  if (!has(FLAG.COPY)) out.push('copying');
  if (!has(FLAG.MODIFY) || !has(FLAG.ASSEMBLE)) out.push('editing');
  if (!has(FLAG.ANNOTATE)) out.push('commenting');
  if (!has(FLAG.ANNOTATE) && !has(FLAG.FORMS)) out.push('form filling');
  return out;
}

/** ["printing", "copying", "editing"] → "printing, copying and editing" */
export function listPhrase(items: string[]) {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
