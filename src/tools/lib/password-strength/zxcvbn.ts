import type { ZxcvbnResult } from '@zxcvbn-ts/core';

export type { ZxcvbnResult };

let loading: Promise<(password: string) => ZxcvbnResult> | undefined;

/** Loads zxcvbn and its English + common-password dictionaries (~1 MB) once, on first use */
export function loadZxcvbn() {
  return (loading ??= (async () => {
    const [{ ZxcvbnFactory }, common, en] = await Promise.all([
      import('@zxcvbn-ts/core'),
      import('@zxcvbn-ts/language-common'),
      import('@zxcvbn-ts/language-en'),
    ]);
    const zxcvbn = new ZxcvbnFactory({
      dictionary: { ...common.dictionary, ...en.dictionary },
      graphs: common.adjacencyGraphs,
      translations: en.translations,
      useLevenshteinDistance: true,
    });
    return (password: string) => zxcvbn.check(password);
  })().catch((err) => {
    loading = undefined;
    throw err;
  }));
}

export const SCORE_LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'] as const;
export const SCORE_COLORS = ['var(--color-bad)', 'var(--color-bad)', 'var(--color-sun)', 'var(--color-ok)', 'var(--color-ok)'] as const;
