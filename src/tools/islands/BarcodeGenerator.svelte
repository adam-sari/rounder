<script lang="ts">
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import { downloadBlob, zipFiles } from '@/tools/lib/files';
  import { check, checkBatch, fileNameFor, formatById, formats, type FormatId, type MsiCheck } from '@/tools/lib/barcode-generator/formats';
  import { drawSvg, pngBlob, svgBlob, svgMarkup, type Spec } from '@/tools/lib/barcode-generator/render';

  let mode = $state<'single' | 'batch'>('single');
  let format = $state<FormatId>('CODE128');
  let value = $state(formatById.CODE128.placeholder);
  let msi = $state<MsiCheck>('MSI10');
  let mod43 = $state(false);
  let style = $state({ barWidth: 2, height: 100, margin: 10, showText: true, fontSize: 20, lineColor: '#000000', background: '#ffffff' });
  let transparent = $state(false);
  let scale = $state(2);

  const info = $derived(formatById[format]);
  const options = $derived({ msi, mod43 });
  const checked = $derived(check(format, value, options));

  /** a fresh plain copy of everything that shapes the barcode, so effects re-run on any change */
  const look = $derived({ ...style, background: transparent ? '' : style.background });
  const spec = $derived<Spec>({ value: checked.value, format, options: { ...options }, style: look });

  let previewSvg = $state<SVGSVGElement>();
  let drawn = $state(false);
  let size = $state({ width: 0, height: 0 });
  let renderError = $state('');

  // redraw once typing pauses rather than on every keystroke
  $effect(() => {
    const s = spec;
    const svg = previewSvg;
    if (!checked.ok || !svg) return;
    const t = setTimeout(() => {
      try {
        drawSvg(svg, s);
        size = { width: svg.width.baseVal.value, height: svg.height.baseVal.value };
        drawn = true;
        renderError = '';
      } catch (err) {
        renderError = typeof err === 'string' ? err : "This value can't be drawn in the chosen format.";
      }
    }, 100);
    return () => clearTimeout(t);
  });

  function setFormat(id: FormatId) {
    // swap in the new format's example unless the user has typed their own value
    const untouched = !value.trim() || value === info.placeholder;
    format = id;
    if (untouched) value = formatById[id].placeholder;
  }

  // scanners need dark bars on a light background; warn using relative luminance
  function lum(hex: string) {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const colorWarning = $derived.by(() => {
    const bars = lum(style.lineColor);
    const bg = transparent ? 1 : lum(style.background);
    if (bars > bg) return 'The bars are lighter than the background. Most scanners only read dark bars on a light background.';
    if ((bg + 0.05) / (bars + 0.05) < 3) return 'Low contrast between the bars and background. Many scanners won\'t read it.';
    return '';
  });

  const ready = $derived(checked.ok && drawn && !renderError);

  let exportError = $state('');

  async function downloadPng() {
    exportError = '';
    try {
      downloadBlob(await pngBlob(spec, scale), fileNameFor(spec.value, 'png'));
    } catch {
      // browsers cap canvas size, which a long code at 4× can pass
      exportError = 'This PNG is too large for your browser to make. Pick a smaller size or a narrower bar width, or download the SVG.';
    }
  }

  // batch mode
  let batchText = $state('');
  let settled = $state('');
  $effect(() => {
    const text = batchText;
    const t = setTimeout(() => (settled = text), 150);
    return () => clearTimeout(t);
  });
  const lines = $derived(checkBatch(settled, format, options));
  const good = $derived(lines.filter((l) => l.ok));
  const bad = $derived(lines.filter((l) => !l.ok));
  const fixable = $derived(bad.filter((l) => l.fix));
  let batchType = $state<'png' | 'svg'>('png');
  let progress = $state<number | null>(null);
  let total = $state(0);
  let cancelled = false;
  let batchError = $state('');

  function fixAll() {
    const rows = batchText.split(/\r?\n/);
    for (const l of fixable) rows[l.line - 1] = l.fix!;
    batchText = settled = rows.join('\n');
  }

  async function downloadZip() {
    // freeze the settings so edits during a long run don't mix styles
    const items = good.map((l) => l.value);
    const base = $state.snapshot(spec);
    const type = batchType;
    const s = scale;
    const zipName = `barcodes-${format.toLowerCase()}.zip`;
    total = items.length;
    cancelled = false;
    batchError = '';
    progress = 0;
    try {
      const files: { name: string; blob: Blob }[] = [];
      for (const [i, v] of items.entries()) {
        if (cancelled) return;
        const one = { ...base, value: v };
        files.push({ name: fileNameFor(v, type), blob: type === 'png' ? await pngBlob(one, s) : svgBlob(one) });
        // hand the page back now and then so it stays responsive on big batches
        if (i % 20 === 19) {
          progress = i + 1;
          await new Promise((r) => setTimeout(r));
        }
      }
      progress = items.length;
      downloadBlob(await zipFiles(files), zipName);
    } catch {
      batchError = 'Something went wrong while making the files. Try a smaller batch or SVG instead of PNG.';
    } finally {
      progress = null;
    }
  }

  /** draws a small batch preview; bad values just leave it blank */
  function thumb(node: SVGSVGElement, s: Spec) {
    const draw = (next: Spec) => {
      try {
        drawSvg(node, next);
      } catch {
        node.replaceChildren();
      }
    };
    draw(s);
    return { update: draw };
  }

  const msiSchemes: [MsiCheck, string][] = [['MSI', 'none'], ['MSI10', 'mod 10'], ['MSI11', 'mod 11'], ['MSI1010', 'mod 10+10'], ['MSI1110', 'mod 11+10']];
  const PREVIEW_COUNT = 6;
</script>

<div class="grid gap-8 lg:grid-cols-[1fr_1.15fr]">
  <div class="grid min-w-0 content-start gap-5">
    <div class="seg" role="group" aria-label="Mode">
      <button type="button" aria-pressed={mode === 'single'} onclick={() => (mode = 'single')}>single</button>
      <button type="button" aria-pressed={mode === 'batch'} onclick={() => (mode = 'batch')}>batch</button>
    </div>

    <label>
      <span class="label">format</span>
      <select class="field" value={format} onchange={(e) => setFormat(e.currentTarget.value as FormatId)}>
        {#each formats as f}<option value={f.id}>{f.label}</option>{/each}
      </select>
      <span class="mono mt-1.5 block">{info.use}</span>
    </label>

    {#if format === 'MSI'}
      <div>
        <span class="label">check digit</span>
        <div class="seg" role="group" aria-label="MSI check digit">
          {#each msiSchemes as [id, label]}
            <button type="button" aria-pressed={msi === id} onclick={() => (msi = id)}>{label}</button>
          {/each}
        </div>
      </div>
    {:else if format === 'CODE39'}
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="accent-(--color-sun)" bind:checked={mod43} /> add a mod 43 check character</label>
    {/if}

    {#if mode === 'single'}
      <div>
        <label for="bc-value" class="label">value</label>
        <input
          id="bc-value"
          class="field mono-input"
          bind:value
          placeholder={info.placeholder}
          spellcheck="false"
          autocomplete="off"
          aria-invalid={!checked.ok}
          aria-describedby="bc-msg"
        />
        <div id="bc-msg" class="mt-2 min-h-6 text-sm" aria-live="polite">
          {#if !checked.ok}
            <span class="text-bad">{checked.message}</span>
            {#if checked.fix}<button type="button" class="link" onclick={() => (value = checked.fix!)}>Use {checked.fix}</button>{/if}
          {:else if checked.message}
            <span class="text-ok">✓</span> <span class="text-soft">{checked.message}</span>
          {/if}
        </div>
      </div>
    {:else}
      <div>
        <label for="bc-batch" class="label">values · one per line</label>
        <textarea id="bc-batch" class="field min-h-[200px]!" bind:value={batchText} spellcheck="false" placeholder={`${info.placeholder}\n${info.placeholder}…`}></textarea>
        <div class="mt-2 grid gap-2 text-sm" aria-live="polite">
          {#if lines.length}
            <p><span class="text-ok">{good.length}</span> ready{#if bad.length} · <span class="text-bad">{bad.length} to fix</span>{/if}</p>
          {/if}
          {#if bad.length}
            <ul class="problems">
              {#each bad.slice(0, 30) as l}
                <li><span class="mono">line {l.line}</span> <span class="text-chalk">{l.value || '(blank)'}</span> · <span class="text-soft">{l.message}</span></li>
              {/each}
              {#if bad.length > 30}<li class="mono">…and {bad.length - 30} more</li>{/if}
            </ul>
            {#if fixable.length}
              <button type="button" class="btn justify-self-start px-3! py-[7px]! text-[13px]!" onclick={fixAll}>Fix {fixable.length} wrong check {fixable.length === 1 ? 'digit' : 'digits'}</button>
            {/if}
          {/if}
        </div>
      </div>
    {/if}

    <div class="grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
      <label>
        <span class="label">bar width · {style.barWidth}px</span>
        <input type="range" class="w-full accent-(--color-sun)" min="1" max="6" step="1" bind:value={style.barWidth} />
      </label>
      <label>
        <span class="label">height · {style.height}px</span>
        <input type="range" class="w-full accent-(--color-sun)" min="20" max="240" step="5" bind:value={style.height} />
      </label>
      <label>
        <span class="label">margin · {style.margin}px</span>
        <input type="range" class="w-full accent-(--color-sun)" min="0" max="50" step="1" bind:value={style.margin} />
      </label>
      <div>
        <div class="flex items-center justify-between gap-2">
          <label for="bc-font" class="label">text size · {style.fontSize}px</label>
          <label class="label flex items-center gap-1.5"><input type="checkbox" class="accent-(--color-sun)" bind:checked={style.showText} /> show text</label>
        </div>
        <input id="bc-font" type="range" class="w-full accent-(--color-sun)" min="8" max="40" step="1" bind:value={style.fontSize} disabled={!style.showText} />
      </div>
      <label class="flex items-center gap-3"><input type="color" bind:value={style.lineColor} class="h-10 w-12 cursor-pointer rounded-lg border border-line-2 bg-transparent" /> <span class="mono">bars {style.lineColor}</span></label>
      <div class="flex flex-wrap items-center gap-3">
        <label class="flex items-center gap-3"><input type="color" bind:value={style.background} disabled={transparent} class="h-10 w-12 cursor-pointer rounded-lg border border-line-2 bg-transparent disabled:opacity-40" /> <span class="mono">background</span></label>
        <label class="mono flex items-center gap-1.5"><input type="checkbox" class="accent-(--color-sun)" bind:checked={transparent} /> transparent</label>
      </div>
    </div>
  </div>

  <div class="grid min-w-0 content-start gap-4">
    {#if mode === 'single'}
      <div class="preview" class:clear={transparent} class:stale={!checked.ok || !!renderError}>
        <svg bind:this={previewSvg} role="img" aria-label={`${info.label} barcode for ${checked.value}`}></svg>
      </div>
      {#if renderError && checked.ok}<p class="text-sm text-bad" role="alert">{renderError}</p>{/if}
      {#if colorWarning}<p class="text-sm text-bad" role="alert">{colorWarning}</p>{/if}

      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="seg" role="group" aria-label="PNG size">
          {#each [1, 2, 4] as s}<button type="button" aria-pressed={scale === s} onclick={() => (scale = s)}>{s}×</button>{/each}
        </div>
        {#if size.width}<span class="mono">PNG {Math.round(size.width * scale)} × {Math.round(size.height * scale)} px</span>{/if}
      </div>
      <div class="grid grid-cols-2 gap-2">
        <button type="button" class="btn btn-primary" disabled={!ready} onclick={downloadPng}>Download PNG</button>
        <button type="button" class="btn" disabled={!ready} onclick={() => downloadBlob(svgBlob(spec), fileNameFor(spec.value, 'svg'))}>Download SVG</button>
      </div>
      {#if exportError}<p class="text-sm text-bad" role="alert">{exportError}</p>{/if}
      <CopyButton text={() => (ready ? svgMarkup(spec) : '')} label="Copy SVG code" class="justify-self-start px-3! py-[7px]! text-[13px]!" />
    {:else}
      {#if good.length}
        <div class="thumbs">
          {#each good.slice(0, PREVIEW_COUNT) as l (l.line)}
            <div class="thumb" class:clear={transparent}><svg use:thumb={{ ...spec, value: l.value }} role="img" aria-label={`Barcode for ${l.value}`}></svg></div>
          {/each}
        </div>
        {#if good.length > PREVIEW_COUNT}<p class="mono">+ {good.length - PREVIEW_COUNT} more in the zip</p>{/if}
      {:else}
        <div class="empty">
          <div class="bars" aria-hidden="true">{#each [3, 1, 2, 1, 1, 3, 2, 1, 1, 2, 3, 1] as w}<i style:width={`${w * 3}px`}></i>{/each}</div>
          <p class="font-serif text-2xl">Paste a list, get a zip</p>
          <p class="text-sm text-soft">One value per line. Each one becomes its own PNG or SVG file, named after its value.</p>
        </div>
      {/if}
      {#if colorWarning}<p class="text-sm text-bad" role="alert">{colorWarning}</p>{/if}

      <div class="flex flex-wrap items-center gap-3">
        <div class="seg" role="group" aria-label="File type">
          <button type="button" aria-pressed={batchType === 'png'} onclick={() => (batchType = 'png')}>PNG</button>
          <button type="button" aria-pressed={batchType === 'svg'} onclick={() => (batchType = 'svg')}>SVG</button>
        </div>
        {#if batchType === 'png'}
          <div class="seg" role="group" aria-label="PNG size">
            {#each [1, 2, 4] as s}<button type="button" aria-pressed={scale === s} onclick={() => (scale = s)}>{s}×</button>{/each}
          </div>
        {/if}
      </div>
      {#if progress === null}
        <button type="button" class="btn btn-primary" disabled={!good.length} onclick={downloadZip}>
          Download {good.length || ''} {good.length === 1 ? 'barcode' : 'barcodes'} as ZIP
        </button>
      {:else}
        <div class="grid gap-2" role="status">
          <div class="meter"><i style:width={`${(progress / Math.max(1, total)) * 100}%`}></i></div>
          <div class="flex items-center justify-between gap-3">
            <span class="mono">making {progress} of {total}…</span>
            <button type="button" class="btn px-3! py-[7px]! text-[13px]!" onclick={() => (cancelled = true)}>Cancel</button>
          </div>
        </div>
      {/if}
      {#if batchError}<p class="text-sm text-bad" role="alert">{batchError}</p>{/if}
    {/if}
    <p class="mono">need a QR code instead? try the <a class="text-sun underline-offset-2 hover:underline" href="/qr-code-generator">QR code generator</a></p>
  </div>
</div>

<style>
  .mono-input {
    font-family: var(--font-mono);
    letter-spacing: 0.02em;
  }
  .link {
    margin-left: 6px;
    color: var(--color-sun);
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }

  .preview {
    display: grid;
    place-items: center;
    min-height: 260px;
    padding: 28px 20px;
    border: 1px solid var(--color-line-2);
    border-radius: 18px;
    background: radial-gradient(circle at 50% 40%, #f2ede40d, transparent 70%), #0e0d0c;
    transition: opacity 0.2s;
  }
  .preview svg {
    display: block;
    max-width: 100%;
    height: auto;
    border-radius: 6px;
    box-shadow: 0 18px 40px -18px #000c;
    animation: settle 0.4s var(--ease-spring) both;
  }
  .preview.stale svg {
    opacity: 0.25;
    filter: grayscale(1);
  }
  @keyframes settle {
    from { opacity: 0; transform: translateY(6px) scale(0.98); }
  }
  /* checkerboard so a transparent background reads as transparent */
  .clear {
    background: repeating-conic-gradient(#ffffff14 0 25%, transparent 0 50%) 0 0 / 16px 16px, #0e0d0c;
  }

  .problems {
    display: grid;
    gap: 4px;
    max-height: 160px;
    overflow: auto;
    padding: 10px 12px;
    border: 1px solid #ff7a6b55;
    border-radius: 12px;
    background: #ff7a6b0d;
    word-break: break-word;
  }

  .thumbs {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
  }
  .thumb {
    display: grid;
    place-items: center;
    min-height: 110px;
    padding: 10px;
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
    background: #0e0d0c;
  }
  .thumb svg {
    display: block;
    max-width: 100%;
    height: auto;
    max-height: 120px;
  }

  .empty {
    display: grid;
    justify-items: center;
    gap: 10px;
    padding: 40px 24px;
    text-align: center;
    border: 1.5px dashed var(--color-line-2);
    border-radius: 18px;
  }
  .empty p:last-child {
    max-width: 34ch;
  }
  .bars {
    display: flex;
    gap: 3px;
    height: 40px;
    margin-bottom: 4px;
  }
  .bars i {
    background: var(--color-sun);
    border-radius: 1px;
  }

  .meter {
    height: 6px;
    overflow: hidden;
    border-radius: 99px;
    background: var(--color-panel-2);
  }
  .meter i {
    display: block;
    height: 100%;
    background: var(--color-sun);
    transition: width 0.2s;
  }
</style>
