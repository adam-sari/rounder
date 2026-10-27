<script lang="ts">
  import { onMount } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import { decodeImage, encodeCanvas, resizeImage } from '@/engines/image/client';
  import { downloadBlob, withExtension, withSuffix } from '@/tools/lib/files';
  import { THEMES, fitCell, toAscii, toHtml, toText, type AsciiArt, type Charset } from '@/tools/lib/ascii';

  // 300 braille columns sample 600 dots across, so this is plenty of source detail
  const WORK = 1200;
  const PREVIEW = 1400;
  const FONT = '"Geist Mono Variable", ui-monospace, Menlo, Consolas, monospace';

  let src = $state.raw<{ img: ImageData; name: string } | null>(null);
  let loading = $state(false);
  let error = $state('');

  let cols = $state(100);
  let charset = $state<Charset>('standard');
  let custom = $state(' .:oO@');
  let background = $state<'dark' | 'light'>('dark');
  let color = $state(false);
  let invert = $state(false);
  let brightness = $state(0);
  let contrast = $state(0);

  /** the art plus how it should look, swapped in together so the preview never flashes */
  let view = $state.raw<{ art: AsciiArt; background: 'dark' | 'light'; color: boolean } | null>(null);
  let canvas = $state<HTMLCanvasElement>();
  let saving = $state(false);
  let fontReady = $state(false);

  // a slow decode must not land on top of a newer image
  let loadId = 0;

  async function load(file: File) {
    const id = ++loadId;
    loading = true;
    error = '';
    try {
      const full = await decodeImage(file);
      const s = Math.min(1, WORK / Math.max(full.width, full.height));
      const img = s < 1 ? await resizeImage(full, { width: Math.round(full.width * s), height: Math.round(full.height * s) }) : full;
      if (id === loadId) src = { img, name: file.name };
    } catch (e) {
      console.error(e);
      if (id === loadId) error = "Couldn't read that image. Try a JPG, PNG, WebP or HEIC file.";
    } finally {
      if (id === loadId) loading = false;
    }
  }

  onMount(() => {
    document.fonts.load(`20px ${FONT}`).finally(() => (fontReady = true));
  });

  // convert once the sliders settle
  $effect(() => {
    const s = src;
    const next = { cols, charset, custom, background, invert, brightness, contrast, color };
    if (!s) return;
    const t = setTimeout(() => (view = { art: toAscii(s.img, next), background: next.background, color: next.color }), 100);
    return () => clearTimeout(t);
  });

  function paint(target: HTMLCanvasElement, v: NonNullable<typeof view>, cell: number, pad: number) {
    const { art } = v;
    const theme = THEMES[v.background];
    target.width = Math.round(art.cols * cell + pad * 2);
    target.height = Math.round(art.rows * cell * 2 + pad * 2);
    const ctx = target.getContext('2d')!;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, target.width, target.height);
    // a 0.6em-wide monospace glyph fills the cell exactly
    ctx.font = `${cell / 0.6}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = theme.ink;
    let fill = '';
    for (let r = 0; r < art.rows; r++) {
      for (let c = 0; c < art.cols; c++) {
        const p = r * art.cols + c;
        const ch = art.chars[p];
        if (ch === ' ' || ch === '⠀') continue;
        if (v.color) {
          const next = `rgb(${art.colors[p * 3]},${art.colors[p * 3 + 1]},${art.colors[p * 3 + 2]})`;
          if (next !== fill) ctx.fillStyle = fill = next;
        }
        // drawn cell by cell so fallback glyphs (braille, emoji) can't knock the grid out of line
        ctx.fillText(ch, pad + (c + 0.5) * cell, pad + (r + 0.5) * cell * 2);
      }
    }
  }

  $effect(() => {
    if (canvas && view && fontReady) paint(canvas, view, fitCell(view.art.cols, view.art.rows, PREVIEW / view.art.cols), 0);
  });

  const text = $derived(view ? toText(view.art) : '');
  const fileBase = $derived(src ? withSuffix(withExtension(src.name, 'txt'), '-ascii') : 'ascii.txt');

  function downloadText() {
    downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), fileBase);
  }

  function downloadHtml() {
    if (!view) return;
    downloadBlob(new Blob([toHtml(view.art, view.background, view.color)], { type: 'text/html;charset=utf-8' }), withExtension(fileBase, 'html'));
  }

  async function downloadPng() {
    if (!view) return;
    saving = true;
    error = '';
    try {
      // big enough to print: roughly 2400px across whatever the width in characters (very tall art is scaled down to fit a canvas)
      const cell = fitCell(view.art.cols, view.art.rows, Math.max(8, Math.round(2400 / view.art.cols)), 2);
      const out = document.createElement('canvas');
      paint(out, view, cell, cell * 2);
      downloadBlob(await encodeCanvas(out, { format: 'png' }), withExtension(fileBase, 'png'));
    } catch (e) {
      console.error(e);
      error = "Couldn't save the PNG. Try a narrower width.";
    } finally {
      saving = false;
    }
  }

  const charsets: [Charset, string][] = [['standard', 'standard'], ['detailed', 'detailed'], ['blocks', '░▒▓█'], ['braille', '⠿ braille'], ['custom', 'custom']];
</script>

<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
  <div class="grid min-w-0 content-start gap-4">
    {#if src}
      <div class="stage" style:background={THEMES[view?.background ?? background].bg}>
        <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
        <canvas bind:this={canvas} role="img" aria-label={`ASCII art made from ${src.name}`}></canvas>
      </div>
      {#if view}<p class="mono">{src.name} · {view.art.cols} × {view.art.rows} characters</p>{/if}
      <Dropzone accept="image/*,.heic,.heif,.avif" title={loading ? 'Reading image…' : 'Try another image'} hint="drop, click or paste" onfiles={(f) => load(f[0])} />
    {:else}
      <Dropzone accept="image/*,.heic,.heif,.avif" title={loading ? 'Reading image…' : 'Drop an image here'} hint="or click to choose" onfiles={(f) => load(f[0])} />
    {/if}
    {#if error}<p class="text-bad text-sm" role="alert">{error}</p>{/if}
  </div>

  <aside class="grid content-start gap-5">
    <label>
      <span class="label">width · {cols} characters</span>
      <input type="range" min="40" max="300" bind:value={cols} class="w-full accent-(--color-sun)" />
      <span class="mono flex justify-between"><span>bolder</span><span>finer</span></span>
    </label>

    <div>
      <span class="label">characters</span>
      <div class="seg" role="group" aria-label="Character set">
        {#each charsets as [value, label]}
          <button type="button" aria-pressed={charset === value} onclick={() => (charset = value)}>{label}</button>
        {/each}
      </div>
    </div>

    {#if charset === 'custom'}
      <label>
        <span class="label">your characters, lightest to densest</span>
        <input class="field font-mono!" bind:value={custom} placeholder=" .:oO@" spellcheck="false" />
      </label>
    {/if}

    <div>
      <span class="label">made for a background that is</span>
      <div class="seg" role="group" aria-label="Background">
        {#each ['dark', 'light'] as const as b}
          <button type="button" aria-pressed={background === b} onclick={() => (background = b)}>{b}</button>
        {/each}
      </div>
    </div>

    <label>
      <span class="label">brightness · {brightness > 0 ? '+' : ''}{brightness}</span>
      <input type="range" min="-100" max="100" bind:value={brightness} class="w-full accent-(--color-sun)" />
    </label>
    <label>
      <span class="label">contrast · {contrast > 0 ? '+' : ''}{contrast}</span>
      <input type="range" min="-100" max="100" bind:value={contrast} class="w-full accent-(--color-sun)" />
    </label>

    <div class="grid gap-2">
      <label class="flex items-start gap-2 text-sm">
        <input type="checkbox" bind:checked={color} class="mt-1" />
        <span>Color<span class="mono block">keeps the photo's colors in the PNG and HTML</span></span>
      </label>
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={invert} /> Invert</label>
    </div>

    <div class="grid gap-2 border-t border-line pt-5">
      <button type="button" class="btn btn-primary" disabled={!view || saving} onclick={downloadPng}>{saving ? 'Saving…' : 'Download PNG'}</button>
      <div class="grid grid-cols-2 gap-2">
        {#if view}
          <CopyButton text={() => text} label="Copy text" />
        {:else}
          <button type="button" class="btn" disabled>Copy text</button>
        {/if}
        <button type="button" class="btn" disabled={!view} onclick={downloadText}>.txt</button>
      </div>
      {#if view?.color}
        <button type="button" class="btn" onclick={downloadHtml}>Download colored HTML</button>
        <p class="mono">copied text is plain; the PNG and HTML keep the color</p>
      {/if}
    </div>
  </aside>
</div>

<style>
  .stage {
    overflow: hidden;
    border-radius: 14px;
    border: 1px solid var(--color-line-2);
    padding: 16px;
    transition: background-color 0.2s;
  }
  canvas {
    display: block;
    width: 100%;
    height: auto;
    max-height: 640px;
    object-fit: contain;
  }
</style>
