<script lang="ts">
  import { untrack } from 'svelte';
  import ImageBatch, { type BatchOutput } from '@/components/tool/ImageBatch.svelte';
  import { decodeImage, formatInfo, imageKind, outputFormatFor, processImage, resolveSize, type ImageKind, type Job, type OutputFormat, type ResizeSpec } from '@/engines/image/client';
  import { withExtension, withSuffix } from '@/tools/lib/files';
  import { fitRange, fromPixels, padJpeg, setJpegDpi, toPixels, type Unit } from '@/tools/lib/image-resizer/form-size';
  import { KB, limitText, sizeText, targetFromHash, verdict, type Limit } from '@/tools/lib/exact-size/target';
  import { checkDevice } from '@/tools/lib/device-guard';

  type Mode = 'percent' | 'fit' | 'exact' | 'target';

  /**
   * Preset pages open in a ready state: { mode: 'target', targetKb: 50 } keeps files under 50 KB, rangeKb [20, 50]
   * keeps them between, mode 'increase' with targetKb makes them at least that big, and w × h (in unit, at dpi)
   * fixes the dimensions too. forms lists common photo and signature sizes as one-click examples.
   */
  interface Props {
    mode?: Mode | 'increase';
    targetKb?: number;
    rangeKb?: [number, number];
    unit?: Unit;
    dpi?: number;
    w?: number;
    h?: number;
    forms?: boolean;
  }
  const preset: Props = $props();
  const p = untrack(() => ({ ...preset }));
  const inTarget = p.mode === 'target' || p.mode === 'increase' || !!p.rangeKb;

  let mode = $state<Mode>(inTarget ? 'target' : ((p.mode as Mode | undefined) ?? 'fit'));
  let percent = $state(50);
  let unit = $state<Unit>(p.unit ?? 'px');
  let dpi = $state<number | null>(p.dpi ?? 300);
  let width = $state<number | null>(p.w ?? (inTarget ? null : 1920));
  let height = $state<number | null>(p.h ?? (inTarget ? null : 1080));
  let crop = $state(true);
  let noEnlarge = $state(true);
  let format = $state<'original' | OutputFormat>('original');
  let quality = $state(85);
  // file-size mode: at most maxKb, at least minKb (either may be empty)
  let maxKb = $state<number | null>(p.rangeKb?.[1] ?? (p.mode === 'increase' ? null : (p.targetKb ?? 200)));
  let minKb = $state<number | null>(p.rangeKb?.[0] ?? (p.mode === 'increase' ? (p.targetKb ?? 50) : null));
  let fixed = $state(inTarget && !!(p.w && p.h));
  let targetFormat = $state<'jpeg' | 'webp'>('jpeg');

  const modes: [Mode, string][] = [['percent', 'percent'], ['fit', 'fit in box'], ['exact', 'exact size'], ['target', 'file size (KB)']];
  const formats: ['original' | OutputFormat, string][] = [['original', 'same'], ['jpeg', 'JPG'], ['png', 'PNG'], ['webp', 'WebP']];
  const units: Unit[] = ['px', 'cm', 'mm', 'in'];
  const targets = [20, 50, 100, 200, 500, 1000];
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
  // examples only: every application notice sets its own numbers, which is why they stay editable
  const formSizes = [
    { name: 'Photo', w: 200, h: 230, kb: [20, 50] as [number, number] },
    { name: 'Signature', w: 140, h: 60, kb: [10, 20] as [number, number] },
    { name: 'Thumb impression', w: 240, h: 240, kb: [20, 50] as [number, number] },
  ];

  const physical = $derived(unit !== 'px');
  const ppi = $derived(dpi && dpi > 0 ? dpi : 300);
  // 16383 is the largest side WebP can hold
  const px = (n: number | null) => (n && n > 0 ? Math.min(16383, Math.max(1, Math.round(toPixels(n, unit, ppi)))) : undefined);
  const kbLabel = (kb: number) => (kb >= 1000 ? `${kb / 1000} MB` : `${kb} KB`);
  const limit = $derived<Limit>({
    min: minKb && minKb > 0 ? Math.round(minKb * KB) : undefined,
    max: maxKb && maxKb > 0 ? Math.round(maxKb * KB) : undefined,
  });
  const validLimit = $derived((limit.min !== undefined || limit.max !== undefined) && !(limit.min && limit.max && limit.min > limit.max));
  /** fixed output dimensions in file-size mode, or null */
  const box = $derived(fixed && px(width) && px(height) ? { width: px(width)!, height: px(height)! } : null);

  function setUnit(next: Unit) {
    // keep the same size in pixels, shown in the new unit
    const conv = (n: number | null) => (n && n > 0 ? fromPixels(toPixels(n, unit, ppi), next, ppi) : n);
    [width, height, unit] = [conv(width), conv(height), next];
  }

  function useForm(f: (typeof formSizes)[number]) {
    [unit, width, height, fixed, minKb, maxKb, targetFormat] = ['px', f.w, f.h, true, f.kb[0], f.kb[1], 'jpeg'];
  }

  // a size typed into the address (/image-resizer#30kb), which the exact-size hub links to
  $effect(() => {
    const fromHash = targetFromHash(location.hash);
    if (fromHash) [mode, maxKb, minKb] = ['target', fromHash, null];
  });

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

  /** a JPEG measured in cm, mm or inches carries its DPI, so it prints at that size */
  async function withDpi(blob: Blob) {
    if (!physical || blob.type !== 'image/jpeg') return blob;
    return new Blob([setJpegDpi(new Uint8Array(await blob.arrayBuffer()), ppi) as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' });
  }

  async function process(file: File): Promise<BatchOutput> {
    // ── device guard (low-end devices): an exact output size this device can't hold fails before decoding ──
    const exact = mode === 'target' ? { mode: 'fill', ...box } : spec();
    if (exact.mode !== 'fit' && exact.mode !== 'scale' && exact.width && exact.height) {
      const fit = checkDevice('image', { width: exact.width, height: exact.height, bytes: file.size, tip: 'Try a smaller width and height.' });
      if (fit.level === 'block') throw new Error(fit.message);
    }
    // ── end device guard ──
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
    if (physical && outFormat === 'jpeg') note = [note, `${ppi} dpi`].filter(Boolean).join(' · ');
    return { blob: await withDpi(out.blob), name: named(file, formatInfo[outFormat].ext, out.width, out.height), width: out.width, height: out.height, note };
  }

  // each file's last verdict, for the summary under the settings
  let checked = $state<{ file: File; key: string; ok: boolean }[]>([]);
  const record = (file: File, key: string, ok: boolean) => (checked = [...checked.filter((c) => c.file !== file), { file, key, ok }]);

  async function toTarget(file: File, kind: ImageKind): Promise<BatchOutput> {
    const key = settingsKey;
    const lim = limit;
    const size = box;
    const fmt = targetFormat;
    if (!validLimit) throw new Error(lim.min && lim.max ? 'The minimum is above the maximum.' : 'Enter a size in KB.');
    const done = (out: BatchOutput, bytes: number, extra: string[]) => {
      const v = verdict(bytes, lim);
      record(file, key, v.ok);
      return { ...out, note: [`Result: ${v.text}`, ...extra].join(' · ') };
    };
    // already in range and in the right format: handed back untouched
    if (!size && !physical && kind === fmt && file.size <= (lim.max ?? Infinity) && file.size >= (lim.min ?? 0)) {
      const bmp = await createImageBitmap(file).catch(() => undefined);
      const dims = bmp && { width: bmp.width, height: bmp.height };
      bmp?.close();
      return done({ blob: file, name: file.name, ...dims }, file.size, ['unchanged']);
    }
    // decode once; every attempt below starts from the same pixels
    const source = await decodeImage(file);
    const r = await fitRange(
      lim,
      async (q, scale) => {
        const resize: ResizeSpec | undefined = size
          ? { mode: crop ? 'fill' : 'stretch', ...size }
          : scale !== 1
            ? { mode: 'scale', percent: scale * 100 }
            : undefined;
        const out = await run(source, { resize, encode: { format: fmt, quality: q } });
        return { ...out, size: out.blob.size };
      },
      // enlarging to reach a minimum stops at 4×, 40 megapixels or WebP's 16383 px side, whichever comes first
      { fixedSize: !!size, maxScale: Math.max(1, Math.min(4, Math.sqrt(40e6 / (source.width * source.height)), 16383 / Math.max(source.width, source.height))) },
    );
    let { blob } = r.out;
    const { width: w, height: h } = r.out;
    const extra = [`quality ${r.quality}`];
    if (r.scale < 1) extra.push('shrunk to fit');
    if (r.scale > 1) extra.push('enlarged to reach the minimum');
    let bytes: Uint8Array | null = fmt === 'jpeg' ? new Uint8Array(await blob.arrayBuffer()) : null;
    if (bytes && physical) bytes = setJpegDpi(bytes, ppi);
    if (bytes && lim.min && bytes.length < lim.min) {
      // a few hundred spare bytes, so a form that counts slightly differently still sees the minimum
      const pad = Math.min(lim.min - bytes.length + 512, (lim.max ?? Infinity) - bytes.length);
      bytes = padJpeg(bytes, pad);
      extra.push(`+${sizeText(pad)} blank padding (the picture is unchanged)`);
    }
    if (bytes) blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' });
    const v = verdict(blob.size, lim);
    if (!v.ok) {
      if (v.miss === 'under') extra.push('WebP files can’t be padded: pick JPG');
      else if (size) extra.push(`at ${w}×${h} px even quality ${r.quality} is too big: try smaller dimensions or a plainer background`);
      else extra.push(`even shrunk to ${Math.round(r.scale * 100)}% of its size it doesn’t fit`);
    }
    if (physical && fmt === 'jpeg') extra.push(`${ppi} dpi`);
    return done({ blob, name: named(file, formatInfo[fmt].ext, w, h), width: w, height: h }, blob.size, extra);
  }

  const settingsKey = $derived(
    JSON.stringify(
      mode === 'target'
        ? [mode, limit, targetFormat, box, crop, physical && ppi]
        : [mode, percent, px(width), px(height), crop, noEnlarge, format, quality, physical && ppi],
    ),
  );
  const current = $derived(checked.filter((c) => c.key === settingsKey));
  const fits = $derived(current.filter((c) => c.ok).length);
</script>

{#snippet sizeFields(maxLabels: boolean)}
  <div class="grid gap-2">
    <div class="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
      <label>
        <span class="label">{maxLabels ? 'max width' : 'width'} · {unit}</span>
        <input class="field" type="number" min="0" step="any" inputmode="decimal" placeholder="auto" bind:value={width} />
      </label>
      <span class="mono pb-3" aria-hidden="true">×</span>
      <label>
        <span class="label">{maxLabels ? 'max height' : 'height'} · {unit}</span>
        <input class="field" type="number" min="0" step="any" inputmode="decimal" placeholder="auto" bind:value={height} />
      </label>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <div class="seg" role="group" aria-label="Unit">
        {#each units as u}
          <button type="button" aria-pressed={unit === u} onclick={() => setUnit(u)}>{u}</button>
        {/each}
      </div>
      {#if physical}
        <label class="flex items-center gap-2">
          <input class="field w-20!" type="number" min="1" max="2400" inputmode="numeric" bind:value={dpi} aria-label="Dots per inch" />
          <span class="mono">dpi</span>
        </label>
      {/if}
    </div>
    <p class="mono">
      {#if physical && px(width) && px(height)}= {px(width)}×{px(height)} px at {ppi} dpi · {/if}{maxLabels ? 'keeps proportions · ' : ''}{mode === 'target' ? 'crops to the shape' : 'leave one side blank to follow the other'}
    </p>
  </div>
{/snippet}

<ImageBatch {process} {settingsKey} zipName="resized-images.zip" onremove={(f) => (checked = checked.filter((c) => c.file !== f))}>
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
    {@render sizeFields(mode === 'fit')}

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
          {#each presets as s}
            <button type="button" class="preset" aria-pressed={unit === 'px' && width === s.w && height === s.h} onclick={() => ([unit, width, height] = ['px', s.w, s.h])}>
              <span>{s.name}</span>
              <span class="mono">{s.w}×{s.h}</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  {:else}
    {#if preset.forms}
      <div>
        <span class="label">common form sizes · check your notice</span>
        <div class="grid grid-cols-2 gap-1.5">
          {#each formSizes as f}
            <button
              type="button"
              class="preset"
              aria-pressed={fixed && unit === 'px' && width === f.w && height === f.h && minKb === f.kb[0] && maxKb === f.kb[1]}
              onclick={() => useForm(f)}
            >
              <span>{f.name}</span>
              <span class="mono">{f.w}×{f.h} · {f.kb[0]}–{f.kb[1]} KB</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <div class="grid gap-2">
      <div class="grid grid-cols-2 gap-2">
        <label>
          <span class="label">at most · KB</span>
          <input class="field" type="number" min="0" step="any" inputmode="decimal" placeholder="no limit" bind:value={maxKb} />
        </label>
        <label>
          <span class="label">at least · KB</span>
          <input class="field" type="number" min="0" step="any" inputmode="decimal" placeholder="optional" bind:value={minKb} />
        </label>
      </div>
      <div class="seg grid grid-cols-3" role="group" aria-label="Common size limits">
        {#each targets as kb}
          <button type="button" aria-pressed={maxKb === kb && !minKb} onclick={() => ([maxKb, minKb] = [kb, null])}>{kbLabel(kb)}</button>
        {/each}
      </div>
      <p class="mono" class:text-bad={!validLimit}>
        {#if !validLimit}
          {limit.min && limit.max ? 'the minimum is above the maximum' : 'enter a size in KB'}
        {:else}
          keeps each file {limitText(limit)} · finds the best quality first, then changes the pixel size only if it must
        {/if}
      </p>
    </div>

    <label class="flex items-start gap-2 text-sm">
      <input type="checkbox" bind:checked={fixed} class="mt-1" />
      <span>Exact dimensions too<span class="mono block">for forms that ask for both</span></span>
    </label>
    {#if fixed}{@render sizeFields(false)}{/if}

    <div>
      <span class="label">output format</span>
      <div class="seg" role="group" aria-label="Output format">
        <button type="button" aria-pressed={targetFormat === 'jpeg'} onclick={() => (targetFormat = 'jpeg')}>JPG</button>
        <button type="button" aria-pressed={targetFormat === 'webp'} onclick={() => (targetFormat = 'webp')}>WebP</button>
      </div>
    </div>

    {#if current.length}
      <p class="mono" class:text-ok={fits === current.length} class:text-bad={fits < current.length} role="status">
        {fits === current.length ? '✓' : '✗'} {fits} of {current.length} {limitText(limit)}
      </p>
    {/if}
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
