<script lang="ts">
  import ImageBatch, { type BatchOutput } from '@/components/tool/ImageBatch.svelte';
  import { decodeImage, formatInfo, imageKind, outputFormatFor, processImage, resolveSize, type ImageKind, type Job, type OutputFormat, type ResizeSpec } from '@/engines/image/client';
  import { withExtension, withSuffix } from '@/tools/lib/files';
  import { fitFileSize } from '@/tools/lib/image-resizer/fit-file-size';

  type Mode = 'percent' | 'fit' | 'exact' | 'target';

  let mode = $state<Mode>('fit');
  let percent = $state(50);
  let width = $state<number | null>(1920);
  let height = $state<number | null>(1080);
  let crop = $state(true);
  let noEnlarge = $state(true);
  let format = $state<'original' | OutputFormat>('original');
  let quality = $state(85);
  let targetKb = $state<number | null>(200);
  let targetFormat = $state<'jpeg' | 'webp'>('jpeg');

  const modes: [Mode, string][] = [['percent', 'percent'], ['fit', 'fit in box'], ['exact', 'exact size'], ['target', 'file size (KB)']];
  const formats: ['original' | OutputFormat, string][] = [['original', 'same'], ['jpeg', 'JPG'], ['png', 'PNG'], ['webp', 'WebP']];
  const targets = [100, 200, 500, 1000];
  const presets = [
    { name: 'Instagram post', w: 1080, h: 1080 },
    { name: 'Instagram portrait', w: 1080, h: 1350 },
    { name: 'Story / Reel', w: 1080, h: 1920 },
    { name: 'YouTube thumbnail', w: 1280, h: 720 },
    { name: 'X / Twitter post', w: 1600, h: 900 },
    { name: 'Facebook cover', w: 851, h: 315 },
    { name: 'LinkedIn banner', w: 1584, h: 396 },
    { name: 'HD 1080p', w: 1920, h: 1080 },
    { name: '4K UHD', w: 3840, h: 2160 },
  ];

  // 16383 is the largest side WebP can hold
  const px = (n: number | null) => (n && n > 0 ? Math.min(16383, Math.round(n)) : undefined);
  const kbLabel = (kb: number) => (kb >= 1000 ? `${kb / 1000} MB` : `${kb} KB`);
  const limitKb = $derived(targetKb && targetKb > 0 ? targetKb : 200);

  function spec(): ResizeSpec {
    if (mode === 'percent') return { mode: 'scale', percent };
    const w = px(width);
    const h = px(height);
    if (mode === 'exact') {
      // with one side blank, "auto" means follow the proportions instead of keeping the source's side
      if (!w || !h) return { mode: 'fit', width: w, height: h, enlarge: true };
      return { mode: crop ? 'fill' : 'stretch', width: w, height: h };
    }
    return { mode: 'fit', width: w, height: h, enlarge: !noEnlarge };
  }

  function named(file: File, ext: string, w: number, h: number) {
    return withSuffix(withExtension(file.name, ext), `-${w}x${h}`);
  }

  // the wasm codecs fail with cryptic memory errors when asked for a huge output
  async function run(file: Blob | ImageData, job: Job) {
    try {
      return await processImage(file, job);
    } catch (e) {
      const err = e as Error;
      if (/RangeError|RuntimeError|memory|alloc|abort|Encoding error/i.test(`${err?.name} ${err?.message}`))
        throw new Error('This size is too big for your browser to handle. Try a smaller size or another format.');
      throw e;
    }
  }

  async function process(file: File): Promise<BatchOutput> {
    const kind = await imageKind(file);
    if (mode === 'target') return toTarget(file, kind);
    const outFormat = format === 'original' ? outputFormatFor(kind) : format;
    const resize = spec();
    const out = await run(file, { resize, encode: { format: outFormat, quality } });
    const { sourceWidth: sw, sourceHeight: sh } = out;
    // compare the scaled size before any crop, so crop-to-fill that upscales one side still counts
    const scaled = resolveSize(sw, sh, resize);
    let note: string | undefined;
    if (resize.mode === 'fit' && !resize.enlarge && resolveSize(sw, sh, { ...resize, enlarge: true }).width > out.width) note = 'not enlarged';
    else if (scaled.width > sw || scaled.height > sh) note = 'enlarged';
    return { blob: out.blob, name: named(file, formatInfo[outFormat].ext, out.width, out.height), width: out.width, height: out.height, note };
  }

  async function toTarget(file: File, kind: ImageKind): Promise<BatchOutput> {
    const kb = limitKb;
    // 1 KB = 1000 bytes here, so the file passes upload forms that count either way
    const limit = kb * 1000;
    if (file.size <= limit && kind === targetFormat) {
      const bmp = await createImageBitmap(file).catch(() => undefined);
      const dims = bmp && { width: bmp.width, height: bmp.height };
      bmp?.close();
      return { blob: file, name: file.name, ...dims, note: `already under ${kbLabel(kb)} · unchanged` };
    }
    // decode once; every attempt below starts from the same pixels
    const source = await decodeImage(file);
    const r = await fitFileSize(limit, async (q, scale) => {
      const out = await run(source, {
        resize: scale < 1 ? { mode: 'scale', percent: scale * 100 } : undefined,
        encode: { format: targetFormat, quality: q },
      });
      return { ...out, size: out.blob.size };
    });
    const { blob, width: w, height: h } = r.out;
    const note = r.fits ? `quality ${r.quality}${r.scale < 1 ? ' · shrunk to fit' : ''}` : `couldn't get under ${kbLabel(kb)}`;
    return { blob, name: named(file, formatInfo[targetFormat].ext, w, h), width: w, height: h, note };
  }

  const settingsKey = $derived(
    JSON.stringify(mode === 'target' ? [mode, limitKb, targetFormat] : [mode, percent, px(width), px(height), crop, noEnlarge, format, quality]),
  );
</script>

<ImageBatch {process} {settingsKey} zipName="resized-images.zip">
  <div>
    <span class="label">resize by</span>
    <div class="seg grid w-full grid-cols-2" role="group" aria-label="Resize mode">
      {#each modes as [value, label]}
        <button type="button" aria-pressed={mode === value} onclick={() => (mode = value)}>{label}</button>
      {/each}
    </div>
  </div>

  {#if mode === 'percent'}
    <label>
      <span class="label">scale · {percent}%</span>
      <input type="range" min="5" max="200" step="5" bind:value={percent} class="w-full accent-(--color-sun)" />
      <span class="mono flex justify-between"><span>smaller</span><span>bigger</span></span>
    </label>
  {:else if mode === 'fit' || mode === 'exact'}
    <div class="grid gap-2">
      <div class="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <label>
          <span class="label">{mode === 'fit' ? 'max width' : 'width'} · px</span>
          <input class="field" type="number" min="1" max="16383" inputmode="numeric" placeholder="auto" bind:value={width} />
        </label>
        <span class="mono pb-3" aria-hidden="true">×</span>
        <label>
          <span class="label">{mode === 'fit' ? 'max height' : 'height'} · px</span>
          <input class="field" type="number" min="1" max="16383" inputmode="numeric" placeholder="auto" bind:value={height} />
        </label>
      </div>
      <p class="mono">{mode === 'fit' ? 'keeps proportions · ' : ''}leave one side blank to follow the other</p>
    </div>

    {#if mode === 'fit'}
      <label class="flex items-start gap-2 text-sm">
        <input type="checkbox" bind:checked={noEnlarge} class="mt-1" />
        <span>Don't enlarge small images<span class="mono block">smaller photos keep their size</span></span>
      </label>
    {:else}
      <div>
        <span class="label">if the shape differs</span>
        <div class="seg" role="group" aria-label="When the aspect ratio differs">
          <button type="button" aria-pressed={crop} onclick={() => (crop = true)}>crop to fill</button>
          <button type="button" aria-pressed={!crop} onclick={() => (crop = false)}>stretch</button>
        </div>
      </div>

      <div>
        <span class="label">popular sizes</span>
        <div class="grid grid-cols-2 gap-1.5">
          {#each presets as p}
            <button type="button" class="preset" aria-pressed={width === p.w && height === p.h} onclick={() => ((width = p.w), (height = p.h))}>
              <span>{p.name}</span>
              <span class="mono">{p.w}×{p.h}</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  {:else}
    <div class="grid gap-2">
      <label>
        <span class="label">keep each file under · KB</span>
        <input class="field" type="number" min="1" inputmode="numeric" bind:value={targetKb} />
      </label>
      <div class="seg" role="group" aria-label="Common size limits">
        {#each targets as kb}
          <button type="button" aria-pressed={limitKb === kb} onclick={() => (targetKb = kb)}>{kbLabel(kb)}</button>
        {/each}
      </div>
      <p class="mono">finds the best quality that fits and only shrinks the picture if it has to</p>
    </div>

    <div>
      <span class="label">output format</span>
      <div class="seg" role="group" aria-label="Output format">
        <button type="button" aria-pressed={targetFormat === 'jpeg'} onclick={() => (targetFormat = 'jpeg')}>JPG</button>
        <button type="button" aria-pressed={targetFormat === 'webp'} onclick={() => (targetFormat = 'webp')}>WebP</button>
      </div>
    </div>
  {/if}

  {#if mode !== 'target'}
    <div>
      <span class="label">output format</span>
      <div class="seg" role="group" aria-label="Output format">
        {#each formats as [value, label]}
          <button type="button" aria-pressed={format === value} onclick={() => (format = value)}>{label}</button>
        {/each}
      </div>
    </div>

    {#if format !== 'png'}
      <label>
        <span class="label">quality · {quality}{format === 'original' ? ' (JPG, WebP, AVIF)' : ''}</span>
        <input type="range" min="10" max="100" bind:value={quality} class="w-full accent-(--color-sun)" />
        <span class="mono flex justify-between"><span>smaller</span><span>sharper</span></span>
      </label>
    {/if}
  {/if}
</ImageBatch>

<style>
  .preset {
    display: grid;
    gap: 2px;
    text-align: left;
    padding: 8px 10px;
    border: 1px solid var(--color-line-2);
    border-radius: 10px;
    background: transparent;
    color: var(--color-soft);
    font-size: 13px;
    line-height: 1.25;
    cursor: pointer;
    transition: border-color 0.2s, color 0.2s;
    &:hover {
      border-color: var(--color-muted);
    }
    &[aria-pressed='true'] {
      border-color: var(--color-sun);
      color: var(--color-sun);
    }
    & .mono {
      font-size: 11.5px;
    }
  }
</style>
