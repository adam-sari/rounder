/**
 * Have I Been Pwned "range" lookup (k-anonymity): only the first 5 hex characters of the
 * password's SHA-1 leave the device. The service answers with every breached hash suffix
 * that shares that prefix (padded with decoys) and the match happens here.
 */

export async function sha1Hex(password: string) {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Finds `suffix` in a range response ("SUFFIX:COUNT" lines) and returns its breach count */
export function countInRange(body: string, suffix: string) {
  const target = suffix.toUpperCase();
  for (const line of body.split('\n')) {
    const [s, n] = line.trim().split(':');
    if (s?.toUpperCase() === target) return Number.parseInt(n, 10) || 0;
  }
  return 0;
}

export async function pwnedCount(password: string, signal?: AbortSignal) {
  const hash = await sha1Hex(password);
  const res = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
    headers: { 'Add-Padding': 'true' },
    signal,
  });
  if (!res.ok) throw new Error(`The breach check service answered with an error (${res.status}). Try again in a moment.`);
  return countInRange(await res.text(), hash.slice(5));
}
