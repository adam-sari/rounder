<script lang="ts">
  import { onMount } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import { toDecodable } from '@/engines/image/client';
  import { downloadBlob } from '@/tools/lib/files';
  import {
    BASE_SIDE, computeLayout, cssGradient, exportScale, outputName, presets, solids,
    type Aspect, type Background, type Frame, type Settings, type Shadow,
  } from '@/tools/lib/screenshot-beautifier/layout';
  import { render } from '@/tools/lib/screenshot-beautifier/render';

  let full = $state.raw<ImageBitmap | null>(null);
  // large screenshots get a smaller copy for the live preview; export always uses the full one
  let small = $state.raw<ImageBitmap | null>(null);
  let fileName = 'screenshot.png';
  let darkShot = $state(false);
  let loading = $state(false);
  let error = $state('');
  let fontsReady = $state(false);

  let bgKind = $state<Background['kind']>('preset');
  let presetId = $state('sunrise');
  let solid = $state('#f2ede4');
  let from = $state('#7cc4ff');
  let to = $state('#c8a6ff');
  let angle = $state(135);
  let padding = $state(72);
  let radius = $state(14);
  let shadow = $state<Shadow>('soft');
  let border = $state(true);
  let frame = $state<Frame>('mac');
  let theme = $state<'light' | 'dark'>('light');
  let url = $state('roundertools.com');
  let aspect = $state<Aspect>('auto');
  let caption = $state('');

  let scaleWant = $state(2);
  let format = $state<'png' | 'jpeg' | 'webp'>('png');
  let busy = $state(false);
  let copyState = $state<'idle' | 'working' | 'done' | 'error'>('idle');
  let canCopy = $state(false);
  let canvas = $state<HTMLCanvasElement>();
  let replaceInput: HTMLInputElement | undefined = $state();

  const background = $derived.by((): Background => {
    switch (bgKind) {
      case 'preset': return { kind: 'preset', id: presetId };
      case 'solid': return { kind: 'solid', color: solid };
      case 'custom': return { kind: 'custom', from, to, angle };
      case 'none': return { kind: 'none' };
    }
  });

  const settings = $derived<Settings>({ background, padding, radius, shadow, border, frame, theme, url, aspect, caption });
  const layout = $derived(full ? computeLayout(full.width, full.height, settings) : null);
  const outScale = $derived(layout ? exportScale(layout.width, layout.height, scaleWant) : 1);
  const outSize = $derived(layout ? `${Math.round(layout.width * outScale)} × ${Math.round(layout.height * outScale)}` : '');

  // a newer paste or drop wins over a slower decode that started earlier
  let loadId = 0;
  async function load(file: File | undefined) {
    if (!file) return;
    const id = ++loadId;
    loading = true;
    error = '';
    let bmp: ImageBitmap | undefined;
    try {
      const src = await toDecodable(file);
      bmp = src instanceof ImageBitmap ? src : await createImageBitmap(src);
      const side = Math.max(bmp.width, bmp.height);
      const preview = side > BASE_SIDE * 1.25
        ? await createImageBitmap(bmp, {
            resizeWidth: Math.round((bmp.width * BASE_SIDE) / side),
            resizeHeight: Math.round((bmp.height * BASE_SIDE) / side),
            resizeQuality: 'high',
          })
        : bmp;
      if (id !== loadId) {
        if (preview !== bmp) preview.close();
        bmp.close();
        return;
      }
      release();
      full = bmp;
      small = preview;
      fileName = file.name;
      darkShot = isDark(preview);
    } catch (e) {
      console.error(e);
      if (bmp !== full) bmp?.close();
      if (id === loadId) error = "We couldn't read that image. Try a PNG, JPG or WebP screenshot.";
    } finally {
      if (id === loadId) loading = false;
    }
  }

  function release() {
    if (small && small !== full) small.close();
    full?.close();
  }

  // average brightness from a 16×16 thumbnail, to pick an inset border that shows
  function isDark(img: ImageBitmap) {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, 16, 16);
    const d = ctx.getImageData(0, 0, 16, 16).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * (d[i + 3] / 255);
    return sum / 256 / 255 < 0.4;
  }

  onMount(() => {
    canCopy = typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write;
    document.fonts.load('500 28px "Geist Variable"').finally(() => (fontsReady = true));
    // ⌘V anywhere on the page swaps in the pasted screenshot; pasting text into the fields is left alone
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
      if (!file) return;
      // copies from Docs, Sheets or Word carry an image too; text pasted into a field should stay text
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, [contenteditable]') && e.clipboardData?.types.includes('text/plain')) return;
      e.preventDefault();
      load(file);
    };
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('paste', onPaste);
      release();
    };
  });

  // the preview is small, so it can redraw every frame while a slider moves
  $effect(() => {
    const L = layout;
    const s = settings;
    const src = small;
    const c = canvas;
    const dark = darkShot;
    void fontsReady;
    if (!L || !src || !c) return;
    const id = requestAnimationFrame(() => {
      const scale = Math.min(2, 1100 / Math.max(L.width, L.height));
      c.width = Math.round(L.width * scale);
      c.height = Math.round(L.height * scale);
      render(c.getContext('2d')!, src, L, s, { scale, darkShot: dark });
    });
    return () => cancelAnimationFrame(id);
  });

  const mime = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

  function exportBlob(type: keyof typeof mime): Promise<Blob> {
    const L = layout!;
    const out = document.createElement('canvas');
    out.width = Math.round(L.width * outScale);
    out.height = Math.round(L.height * outScale);
    render(out.getContext('2d')!, full!, L, settings, { scale: outScale, darkShot, opaque: type === 'jpeg' });
    return new Promise((resolve, reject) =>
      out.toBlob((b) => {
        // free the backing store now: iOS caps total canvas memory and GC is slow to reclaim it
        out.width = out.height = 0;
        if (b) resolve(b);
        else reject(new Error('Export failed'));
      }, mime[type], 0.92),
    );
  }

  async function download() {
    busy = true;
    error = '';
    try {
      downloadBlob(await exportBlob(format), outputName(fileName, format === 'jpeg' ? 'jpg' : format));
    } catch (e) {
      console.error(e);
      error = 'Your browser couldn’t create that image. Try 1× resolution or a smaller canvas.';
    } finally {
      busy = false;
    }
  }

  let copyTimer: ReturnType<typeof setTimeout>;
  async function copy() {
    copyState = 'working';
    try {
      // handing ClipboardItem a promise keeps Safari's user-gesture check happy during the render
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': exportBlob('png') })]);
      copyState = 'done';
    } catch (e) {
      console.error(e);
      copyState = 'error';
    }
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copyState = 'idle'), 1800);
  }

  let over = $state(false);
  function onDrop(e: DragEvent) {
    e.preventDefault();
    over = false;
    load(Array.from(e.dataTransfer?.files ?? []).find((f) => f.type.startsWith('image/') || /\.(heic|heif|avif)$/i.test(f.name)));
  }

  const bgKinds: [Background['kind'], string][] = [['preset', 'gradient'], ['solid', 'solid'], ['custom', 'custom'], ['none', 'none']];
  const frames: [Frame, string][] = [['none', 'none'], ['mac', 'macOS'], ['browser', 'browser']];
  const aspects: [Aspect, string][] = [['auto', 'fit'], ['16:9', 'X · LinkedIn'], ['1:1', 'Instagram post'], ['4:5', 'Instagram portrait'], ['9:16', 'stories · reels']];
  const aspectHint = $derived(aspects.find(([a]) => a === aspect)![1]);
  const copyLabel = $derived({ idle: 'Copy image', working: 'Copying…', done: 'Copied ✓', error: 'Copy blocked' }[copyState]);
</script>

{#if !full}
  <div class="grid gap-3">
    <Dropzone
      accept="image/*,.heic,.heif,.avif"
      title="Paste a screenshot"
      hint="⌘V / Ctrl+V, drop it here, or click to choose"
      paste={false}
      onfiles={(files) => load(files[0])}
    />
    {#if loading}<p class="mono" aria-live="polite">reading your screenshot…</p>{/if}
    {#if error}<p class="text-bad text-sm" role="alert">{error}</p>{/if}
  </div>
{:else}
  <div class="grid gap-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
    <div class="grid content-start gap-3 lg:sticky lg:top-6 lg:self-start">
      <div
        class="stage"
        class:over
        role="region"
        aria-label="Preview. Drop or paste another screenshot to replace it."
        ondragover={(e) => {
          e.preventDefault();
          over = true;
        }}
        ondragleave={() => (over = false)}
        ondrop={onDrop}
      >
        <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
        <canvas bind:this={canvas} role="img" aria-label="Preview of your screenshot on its new background"></canvas>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="mono" aria-live="polite">{loading ? 'reading your screenshot…' : `${outSize} px · ⌘V to swap screenshot`}</span>
        <button type="button" class="btn py-2! text-sm!" onclick={() => replaceInput?.click()}>Replace</button>
        <input
          bind:this={replaceInput}
          type="file"
          accept="image/*,.heic,.heif,.avif"
          hidden
          onchange={(e) => {
            load(e.currentTarget.files?.[0]);
            e.currentTarget.value = ''; // so picking the same file again still fires
          }}
        />
      </div>
      {#if error}<p class="text-bad text-sm" role="alert">{error}</p>{/if}
    </div>

    <div class="grid content-start gap-6">
      <section class="grid gap-3">
        <span class="label mb-0!">background</span>
        <div class="seg" role="group" aria-label="Background type">
          {#each bgKinds as [k, label]}
            <button type="button" aria-pressed={bgKind === k} onclick={() => (bgKind = k)}>{label}</button>
          {/each}
        </div>
        {#if bgKind === 'preset'}
          <div class="grid grid-cols-6 gap-2" role="group" aria-label="Gradient presets">
            {#each presets as p}
              <button type="button" class="swatch" style:background={cssGradient(p.gradient)} aria-pressed={presetId === p.id} aria-label={p.name} title={p.name} onclick={() => (presetId = p.id)}></button>
            {/each}
          </div>
        {:else if bgKind === 'solid'}
          <div class="grid grid-cols-6 gap-2" role="group" aria-label="Solid colors">
            {#each solids as color}
              <button type="button" class="swatch" style:background={color} aria-pressed={solid === color} aria-label={color} title={color} onclick={() => (solid = color)}></button>
            {/each}
            <label class="swatch picker" title="Pick any color" class:active={!solids.includes(solid)} style:background={solids.includes(solid) ? undefined : solid}>
              <input type="color" bind:value={solid} aria-label="Custom solid color" />
              {#if solids.includes(solid)}<span aria-hidden="true">+</span>{/if}
            </label>
          </div>
        {:else if bgKind === 'custom'}
          <div class="grid gap-3">
            <div class="custom" style:background={cssGradient({ angle, stops: [from, to] })}>
              <input type="color" bind:value={from} aria-label="Gradient start color" />
              <input type="color" bind:value={to} aria-label="Gradient end color" />
            </div>
            <label>
              <span class="label flex justify-between">angle <span>{angle}°</span></span>
              <input type="range" min="0" max="360" step="5" bind:value={angle} class="w-full accent-(--color-sun)" />
            </label>
          </div>
        {:else}
          <p class="mono">transparent PNG or WebP · the checkerboard isn't exported</p>
        {/if}
      </section>

      <section class="grid gap-4 border-t border-line pt-5">
        <div class="grid gap-4 sm:grid-cols-2">
          <label>
            <span class="label flex justify-between">padding <span>{padding}</span></span>
            <input type="range" min="0" max="200" step="2" bind:value={padding} class="w-full accent-(--color-sun)" />
          </label>
          <label>
            <span class="label flex justify-between">corners <span>{radius}</span></span>
            <input type="range" min="0" max="48" step="1" bind:value={radius} class="w-full accent-(--color-sun)" />
          </label>
        </div>
        <div class="flex flex-wrap items-end gap-x-6 gap-y-4">
          <div>
            <span class="label">shadow</span>
            <div class="seg" role="group" aria-label="Shadow">
              {#each ['none', 'soft', 'strong'] as const as sh}
                <button type="button" aria-pressed={shadow === sh} onclick={() => (shadow = sh)}>{sh}</button>
              {/each}
            </div>
          </div>
          <label class="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" bind:checked={border} class="accent-(--color-sun)" /> inset border</label>
        </div>
      </section>

      <section class="grid gap-4 border-t border-line pt-5">
        <div class="flex flex-wrap items-end gap-x-6 gap-y-4">
          <div>
            <span class="label">window frame</span>
            <div class="seg" role="group" aria-label="Window frame">
              {#each frames as [f, label]}
                <button type="button" aria-pressed={frame === f} onclick={() => (frame = f)}>{label}</button>
              {/each}
            </div>
          </div>
          {#if frame !== 'none'}
            <div class="seg" role="group" aria-label="Frame theme">
              {#each ['light', 'dark'] as const as t}
                <button type="button" aria-pressed={theme === t} onclick={() => (theme = t)}>{t}</button>
              {/each}
            </div>
          {/if}
        </div>
        {#if frame === 'browser'}
          <label><span class="label">address bar</span><input class="field" bind:value={url} placeholder="example.com" spellcheck="false" /></label>
        {/if}
      </section>

      <section class="grid gap-4 border-t border-line pt-5">
        <div>
          <span class="label">canvas</span>
          <div class="seg" role="group" aria-label="Canvas aspect ratio">
            {#each aspects as [a, use]}
              <button type="button" aria-pressed={aspect === a} title={use} onclick={() => (aspect = a)}>{a === 'auto' ? 'auto' : a}</button>
            {/each}
          </div>
          <p class="mono mt-2">{aspect === 'auto' ? 'wraps the screenshot' : aspectHint}</p>
        </div>
        <label><span class="label">caption (optional)</span><input class="field" bind:value={caption} placeholder="Shipped: dark mode for everyone" maxlength="120" /></label>
      </section>

      <section class="grid gap-4 border-t border-line pt-5">
        <div class="flex flex-wrap gap-x-6 gap-y-4">
          <div>
            <span class="label">format</span>
            <div class="seg" role="group" aria-label="Download format">
              {#each [['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP']] as const as [f, label]}
                <button type="button" aria-pressed={format === f} onclick={() => (format = f)}>{label}</button>
              {/each}
            </div>
          </div>
          <div>
            <span class="label">resolution</span>
            <div class="seg" role="group" aria-label="Export resolution">
              {#each [1, 2] as n}
                <button type="button" aria-pressed={scaleWant === n} onclick={() => (scaleWant = n)}>{n}×</button>
              {/each}
            </div>
          </div>
        </div>
        <div class="grid gap-2 {canCopy ? 'grid-cols-2' : ''}">
          <button type="button" class="btn btn-primary" disabled={busy} onclick={download}>{busy ? 'Rendering…' : 'Download'}</button>
          {#if canCopy}
            <button type="button" class="btn" disabled={copyState === 'working'} onclick={copy} aria-live="polite">{copyLabel}</button>
          {/if}
        </div>
        <p class="mono">no watermark · copy pastes straight into X, Slack or Docs</p>
      </section>
    </div>
  </div>
{/if}

<style>
  .stage {
    display: grid;
    place-items: center;
    min-height: 240px;
    padding: 14px;
    border-radius: 18px;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel-2);
    transition: border-color 0.2s;
    &.over {
      border-color: var(--color-sun);
    }
  }
  canvas {
    display: block;
    max-width: 100%;
    max-height: min(68vh, 640px);
    width: auto;
    height: auto;
    border-radius: 4px;
    /* checkerboard so a transparent background is visible */
    background: repeating-conic-gradient(#2a2926 0 25%, #1f1e1b 0 50%) 0 0 / 20px 20px;
  }
  .swatch {
    position: relative;
    display: grid;
    place-items: center;
    height: 40px;
    border-radius: 10px;
    border: 1px solid var(--color-line-2);
    cursor: pointer;
    transition: transform 0.2s var(--ease-spring);
    &:hover {
      transform: scale(1.06);
    }
    &[aria-pressed='true'],
    &.active {
      outline: 2px solid var(--color-sun);
      outline-offset: 2px;
    }
  }
  .picker {
    background: repeating-linear-gradient(-45deg, transparent 0 6px, #f2ede410 6px 7px);
    color: var(--color-soft);
    font-size: 20px;
    &:focus-within {
      outline: 2px solid var(--color-sun);
      outline-offset: 2px;
    }
    & input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
      width: 100%;
      height: 100%;
    }
  }
  .custom {
    display: flex;
    justify-content: space-between;
    padding: 8px;
    border-radius: 12px;
    border: 1px solid var(--color-line-2);
    & input {
      width: 44px;
      height: 36px;
      border-radius: 8px;
      border: 2px solid #ffffffcc;
      background: transparent;
      cursor: pointer;
    }
  }
</style>
