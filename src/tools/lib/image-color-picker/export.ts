import type { Swatch } from '../palette';
import { describe, nearestNamed, toHex } from './color';

export type CodeFormat = 'css' | 'tailwind4' | 'tailwind3' | 'json';

export const codeFormats: [CodeFormat, string][] = [
  ['css', 'CSS'],
  ['tailwind4', 'Tailwind v4'],
  ['tailwind3', 'Tailwind v3'],
  ['json', 'JSON'],
];

/** The palette as a snippet to paste into a stylesheet, Tailwind setup or script */
export function paletteCode(colors: Swatch[], format: CodeFormat): string {
  const hex = colors.map((c) => toHex(c));
  const hint = (i: number) => `/* ${nearestNamed(colors[i]).name} */`;
  switch (format) {
    case 'css':
      return `:root {\n${hex.map((h, i) => `  --palette-${i + 1}: ${h}; ${hint(i)}`).join('\n')}\n}`;
    case 'tailwind4':
      return `@theme {\n${hex.map((h, i) => `  --color-palette-${i + 1}: ${h}; ${hint(i)}`).join('\n')}\n}`;
    case 'tailwind3':
      return [
        '// tailwind.config.js',
        'export default {',
        '  theme: {',
        '    extend: {',
        '      colors: {',
        '        palette: {',
        ...hex.map((h, i) => `          ${i + 1}: '${h}', ${hint(i)}`),
        '        },',
        '      },',
        '    },',
        '  },',
        '};',
      ].join('\n');
    case 'json':
      return JSON.stringify(
        colors.map((c, i) => {
          const d = describe({ ...c, a: 255 });
          return { hex: hex[i], rgb: [c.r, c.g, c.b], hsl: d.hsl, oklch: d.oklch, name: d.named.name, percent: +(c.share * 100).toFixed(1) };
        }),
        null,
        2,
      );
  }
}

/** "42%", or "<1%" for slivers so nothing reads as zero */
export const percent = (share: number) => (share < 0.005 ? '<1%' : `${Math.round(share * 100)}%`);
