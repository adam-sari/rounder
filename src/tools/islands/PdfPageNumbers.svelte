<script lang="ts">
  import type { PDFFont } from 'pdf-lib';
  import PdfStampShell, { type Stamp, type StampItem } from './PdfStampShell.svelte';
  import PdfStampPreview, { type Paint } from './PdfStampPreview.svelte';
  import { isWinAnsi, loadEditablePdf, missingGlyphs, PageRangeError, parsePageRanges, pdfName, savePdf } from '@/engines/pdf';
  import { formatPageLabel, labelOrigin, NUMBER_FORMATS, numberingPlan, type Anchor } from '@/tools/lib/pdf-stamp/geometry';
  import { addPageNumbers, previewFont, StampError, textBox, type FontFamily } from '@/tools/lib/pdf-stamp/stamp';
  import { cssFont, drawTextBox } from '@/tools/lib/pdf-stamp/canvas';

  let anchor = $state<Anchor>('bc');
  /** one of NUMBER_FORMATS, or 'custom' */
  let format = $state<string>('{n}');
  let custom = $state('– {n} –');
  let start = $state<number | null>(1);
  let scope = $state<'all' | 'range'>('all');
  let range = $state('');
  let skipFirst = $state(false);
  let family = $state<FontFamily>('sans');
  let bold = $state(false);
  let size = $state(11);
  let color = $state('#222222');
  let margin = $state(28);

  const spots: [Anchor, string][][] = [
    [['tl', 'Top left'], ['tc', 'Top center'], ['tr', 'Top right']],
    [['bl', 'Bottom left'], ['bc', 'Bottom center'], ['br', 'Bottom right']],
  ];
  const families: [FontFamily, string, string][] = [
    ['sans', 'Sans', 'Helvetica, Arial, sans-serif'],
    ['serif', 'Serif', '"Times New Roman", Times, serif'],
    ['mono', 'Mono', '"Courier New", Courier, monospace'],
  ];

  // one line: tabs and other breaks can't be drawn by the PDF fonts
  const template = $derived(format === 'custom' ? custom.replace(/\s+/g, ' ') : format);
  const cfg = $derived({ anchor, template, start: Number.isFinite(start) ? Math.max(0, Math.round(start!)) : 1, scope, range, skipFirst, family, bold, size, color, margin });
  type Cfg = typeof cfg;

  const pagesFor = (c: Cfg, numPages: number) => (c.scope === 'all' ? Array.from({ length: numPages }, (_, i) => i) : parsePageRanges(c.range, numPages, { unique: true }));

  let previewItem = $state.raw<StampItem | null>(null);

  const rangeError = $derived.by(() => {
    if (scope !== 'range') return '';
    try {
      parsePageRanges(range, previewItem?.doc.numPages ?? 1e6);
      return '';
    } catch (e) {
      return (e as Error).message;
    }
  });

  // characters even the fallback font lacks (CJK, emoji…) would come out as empty boxes
  let missing = $state<string[]>([]);
  $effect(() => {
    const t = template;
    const b = bold;
    if (isWinAnsi(t)) {
      missing = [];
      return;
    }
    let cancelled = false;
    missingGlyphs(t, { bold: b })
      .then((m) => !cancelled && (missing = m))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  });

  const blocker = $derived.by(() => {
    if (format === 'custom' && !/\{\s*n\s*\}/i.test(custom)) return 'Put {n} in the format where the page number goes.';
    if (missing.length) return `The PDF font can't draw ${missing.join(' ')}. Remove ${missing.length === 1 ? 'it' : 'them'} to continue.`;
    return rangeError;
  });

  function begin(): Stamp {
    const c = cfg;
    return async (item, onprogress) => {
      // a range that doesn't fit this file fails before the heavy loading
      const pages = pagesFor(c, item.doc.numPages);
      const { doc, decrypted } = await loadEditablePdf(item.file, { password: item.password });
      onprogress(0.15);
      const count = await addPageNumbers(doc, { ...c, pages }, (f) => onprogress(0.15 + f * 0.6));
      if (!count) throw new StampError('No pages left to number: the only page chosen is the skipped first page.');
      onprogress(0.8);
      const blob = await savePdf(doc, { updateFieldAppearances: false });
      const note = [`${count} page${count === 1 ? '' : 's'} numbered`, decrypted && 'saved without its password'].filter(Boolean).join(' · ');
      return { blob, name: pdfName(item.file.name, '-numbered'), note };
    };
  }

  /* ---------------- preview ---------------- */

  // the preview follows the settings once they settle, measured with the real PDF font
  let look = $state.raw<{ c: Cfg; font: PDFFont } | null>(null);
  $effect(() => {
    const c = cfg;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const font = await previewFont(c.family, c.bold, formatPageLabel(c.template, 0, 0));
        if (!cancelled) look = { c, font };
      } catch {
        // the Unicode font didn't load; keep the last preview
      }
    }, 100);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  });

  function numbersFor(c: Cfg, numPages: number) {
    try {
      const plan = numberingPlan(pagesFor(c, numPages), c);
      return { total: plan.total, at: new Map(plan.pages.map((p) => [p.pageIndex, p.n])) };
    } catch (e) {
      if (e instanceof PageRangeError) return null;
      throw e;
    }
  }

  function paintFor(numPages: number): Paint | null {
    if (!look) return null;
    const { c, font } = look;
    const numbers = numbersFor(c, numPages);
    if (!numbers) return null;
    const css = cssFont(c.family, c.bold, !isWinAnsi(c.template), c.size);
    return (ctx, page, layer) => {
      const n = numbers.at.get(page.index);
      if (layer !== 'over' || n === undefined) return;
      const label = formatPageLabel(c.template, n, numbers.total);
      const box = textBox(font, label, c.size);
      const o = labelOrigin(page.width, page.height, box, c.anchor, c.margin);
      ctx.translate(o.x, o.y - box.descent);
      ctx.fillStyle = c.color;
      drawTextBox(ctx, label, css, box);
    };
  }

  function captionFor(numPages: number) {
    const c = look?.c ?? cfg;
    const numbers = numbersFor(c, numPages);
    return (i: number) => {
      const n = numbers?.at.get(i);
      return n === undefined ? `p. ${i + 1} · no number` : `p. ${i + 1} · “${formatPageLabel(c.template, n, numbers!.total)}”`;
    };
  }

  const settingsKey = $derived(JSON.stringify(cfg));
</script>

<PdfStampShell action="Add page numbers" verb="Numbering" zipName="numbered-pdfs.zip" {settingsKey} {blocker} {begin} onselect={(i) => (previewItem = i)}>
  {#snippet preview(item)}
    <PdfStampPreview doc={item.doc} paint={paintFor(item.doc.numPages)} caption={captionFor(item.doc.numPages)} spread label="Page number preview" />
  {/snippet}

  <div>
    <span class="label" id="pn-pos">position</span>
    <div class="flex items-center gap-4">
      <div class="sheet" role="group" aria-labelledby="pn-pos">
        {#each spots as row, r}
          <div class="slots">
            {#each row as [spot, name] (spot)}
              <button type="button" aria-pressed={anchor === spot} aria-label={name} title={name} onclick={() => (anchor = spot)}>
                <span aria-hidden="true">{anchor === spot ? '1' : ''}</span>
              </button>
            {/each}
          </div>
          {#if r === 0}
            <div class="lines" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
          {/if}
        {/each}
      </div>
      <p class="mono">{spots.flat().find(([s]) => s === anchor)?.[1]}</p>
    </div>
  </div>

  <div class="grid gap-2">
    <span class="label" id="pn-format">format</span>
    <div class="seg" role="group" aria-labelledby="pn-format">
      {#each NUMBER_FORMATS as [value, example] (value)}
        <button type="button" aria-pressed={format === value} onclick={() => (format = value)}>{example}</button>
      {/each}
      <button type="button" aria-pressed={format === 'custom'} onclick={() => (format = 'custom')}>Custom</button>
    </div>
    {#if format === 'custom'}
      <input class="field" bind:value={custom} aria-label="Custom format" placeholder={'Page {n} of {total}'} spellcheck="false" />
      <p class="mono">{'{n}'} = page number · {'{total}'} = last number</p>
    {/if}
  </div>

  <div class="grid gap-3">
    <label class="flex items-center justify-between gap-3">
      <span class="label mb-0!">start at</span>
      <input class="field w-24! py-2!" type="number" min="0" step="1" inputmode="numeric" bind:value={start} />
    </label>
    <div>
      <span class="label" id="pn-pages">pages to number</span>
      <div class="seg" role="group" aria-labelledby="pn-pages">
        <button type="button" aria-pressed={scope === 'all'} onclick={() => (scope = 'all')}>All</button>
        <button type="button" aria-pressed={scope === 'range'} onclick={() => (scope = 'range')}>Choose pages</button>
      </div>
    </div>
    {#if scope === 'range'}
      <label>
        <span class="sr-only">Pages to number</span>
        <input class="field" bind:value={range} placeholder="e.g. 3-12, 15, 20-" spellcheck="false" aria-invalid={!!rangeError} />
      </label>
    {/if}
    <label class="flex items-start gap-2 text-sm">
      <input type="checkbox" bind:checked={skipFirst} class="mt-1" />
      <span>Skip the first page<span class="mono block">the cover stays blank and page 2 gets the start number</span></span>
    </label>
  </div>

  <div class="grid gap-3 border-t border-line pt-5">
    <div class="flex flex-wrap items-center gap-2">
      <div class="seg" role="group" aria-label="Font">
        {#each families as [f, name, css] (f)}
          <button type="button" aria-pressed={family === f} onclick={() => (family = f)} style:font-family={css}>{name}</button>
        {/each}
      </div>
      <div class="seg" role="group" aria-label="Weight">
        <button type="button" aria-pressed={bold} onclick={() => (bold = !bold)} aria-label="Bold"><b>B</b></button>
      </div>
    </div>
    <label>
      <span class="label">size · {size} pt</span>
      <input type="range" min="6" max="36" bind:value={size} class="w-full accent-(--color-sun)" />
    </label>
    <label>
      <span class="label">margin from edge · {margin} pt ({(margin / 72).toFixed(2)} in)</span>
      <input type="range" min="8" max="108" step="2" bind:value={margin} class="w-full accent-(--color-sun)" />
    </label>
    <label class="flex items-center gap-3">
      <input type="color" bind:value={color} class="h-10 w-12 cursor-pointer rounded-lg border border-line-2 bg-transparent" />
      <span class="mono">color {color}</span>
    </label>
  </div>
</PdfStampShell>

<style>
  /* a little page with the six spots on its edges */
  .sheet {
    flex: none;
    display: grid;
    grid-template-rows: auto 1fr auto;
    gap: 8px;
    width: 116px;
    height: 148px;
    padding: 8px;
    border-radius: 10px;
    border: 1px solid var(--color-line-2);
    background: #141312;
  }
  .slots {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
    & button {
      height: 24px;
      display: grid;
      place-items: center;
      border-radius: 6px;
      border: 1px dashed var(--color-line-2);
      background: transparent;
      cursor: pointer;
      font: 600 12px var(--font-mono);
      color: var(--color-bg);
      transition: background-color 0.15s, border-color 0.15s, transform 0.2s var(--ease-spring);
      &:hover {
        border-color: var(--color-muted);
      }
      &[aria-pressed='true'] {
        border: 1px solid var(--color-sun);
        background: var(--color-sun);
        transform: scale(1.06);
      }
    }
  }
  .lines {
    display: grid;
    align-content: center;
    gap: 7px;
    padding-inline: 6px;
    & i {
      display: block;
      height: 3px;
      border-radius: 2px;
      background: var(--color-line-2);
      &:nth-child(2) {
        width: 80%;
      }
      &:nth-child(4) {
        width: 60%;
      }
    }
  }
</style>
