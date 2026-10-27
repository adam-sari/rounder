<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import * as Comlink from 'comlink';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import ImagesToPdfGrid, { type ImageItem } from './ImagesToPdfGrid.svelte';
  import { decodeImage, encodeImage, imageKind, resizeImage, resolveSize, toDecodable } from '@/engines/image/client';
  import { pdfName } from '@/engines/pdf/lib';
  import { downloadResult, formatBytes } from '@/tools/lib/files';
  import { combinedName, hasTransparency, layoutPage, type Margin, type Orientation, type PageSizeOption, type Placement } from '@/tools/lib/jpg-to-pdf/layout';
  import type { ImagesPdfWorker } from '@/tools/lib/jpg-to-pdf/pdf.worker';
  import { zipBlobs } from '@/tools/lib/pdf-to-jpg/zip';
  import { checkDevice } from '@/tools/lib/device-guard';
  import { fitFileSize } from '@/tools/lib/image-resizer/fit-file-size';
  import { KB, limitText, sizeText, targetFromHash, verdict } from '@/tools/lib/exact-size/target';

  const ACCEPT = 'image/*,.heic,.heif,.avif';
  const THUMB = 360;
  /** compressed photos are capped here: about 210 dpi across an A4 page */
  const COMPRESS_MAX = 2500;

  // preset pages start from their own settings (png-to-pdf: pages shaped like each screenshot; heic-to-pdf: compressed;
  // jpg-to-pdf-under-200kb: a size limit)
  const preset: { size?: PageSizeOption; compress?: boolean; targetKb?: number } = $props();

  let items = $state<ImageItem[]>([]);
  let size = $state<PageSizeOption>(untrack(() => preset.size ?? 'A4'));
  let orientation = $state<Orientation>('auto');
  let margin = $state<Margin>('none');
  let placement = $state<Placement>('fit');
  let compress = $state(untrack(() => preset.compress ?? false));
  let quality = $state(75);
  let output = $state<'one' | 'each'>('one');
  let limitOn = $state(untrack(() => !!preset.targetKb));
  let limitKb = $state<number | null>(untrack(() => preset.targetKb ?? 200));

  let errors = $state<string[]>([]);
  let progress = $state.raw<{ done: number; total: number; attempt?: number } | null>(null);
  let result = $state.raw<{
    key: string;
    files: { name: string; blob: Blob }[];
    pages: number;
    /** size-limit mode: the limit, and what it took (null quality: the images went in as they were) */
    target?: { bytes: number; quality: number | null; side: number };
  } | null>(null);
  let zipping = $state(false);
  let picker = $state<HTMLInputElement>();
  let over = $state(false);
  let cancel: (() => void) | undefined;
  let nextId = 0;

  const opts = $derived({ size, orientation, margin, placement });
  const layout = (item: ImageItem) => (item.width && item.height ? layoutPage(item.width, item.height, opts) : null);
  const ready = $derived(items.length > 0 && items.every((i) => i.width));
  const each = $derived(output === 'each' && items.length > 1);
  /** a size limit applies to the single combined PDF */
  const target = $derived(limitOn && !each && limitKb && limitKb > 0 ? Math.round(limitKb * KB) : null);
  const jobKey = $derived(JSON.stringify([items.map((i) => i.id), opts, compress && quality, each, target]));

  // a size typed into the address (/jpg-to-pdf#300kb), which the exact-size hub links to
  $effect(() => {
    const kb = targetFromHash(location.hash);
    if (kb) [limitOn, limitKb] = [true, kb];
  });

  $effect(() => {
    if (result && result.key !== jobKey) result = null;
  });

  onMount(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.clipboardData?.files.length && !progress) add(Array.from(e.clipboardData.files));
    };
    addEventListener('paste', onPaste);
    return () => {
      removeEventListener('paste', onPaste);
      cancel?.();
      for (const i of items) if (i.thumb) URL.revokeObjectURL(i.thumb);
    };
  });

  /* ---------- adding images ---------- */

  const isImage = (f: File) => f.type.startsWith('image/') || /\.(heic|heif|avif)$/i.test(f.name);

  function add(files: File[]) {
    for (const f of files) {
      if (isImage(f)) items.push({ id: nextId++, file: f });
      else errors.push(`${f.name} isn't an image.`);
    }
    void inspectAll();
  }

  let inspecting = false;
  // one at a time: each needs a full decode to learn its upright size
  async function inspectAll() {
    if (inspecting) return;
    inspecting = true;
    let item: ImageItem | undefined;
    while ((item = items.find((i) => !i.width))) {
      const { id, file } = item;
      try {
        const info = await inspect(file);
        const live = items.find((i) => i.id === id);
        if (live) Object.assign(live, info);
        else URL.revokeObjectURL(info.thumb);
      } catch {
        if (!items.some((i) => i.id === id)) continue; // removed meanwhile
        errors.push(`${file.name} couldn't be read. It may be damaged, or a format your browser can't open.`);
        items = items.filter((i) => i.id !== id);
      }
    }
    inspecting = false;
  }

  async function inspect(file: File) {
    const src = await toDecodable(file);
    const bitmap = src instanceof ImageBitmap ? src : await createImageBitmap(src, { imageOrientation: 'from-image' });
    const { width, height } = bitmap;
    const s = Math.min(1, THUMB / Math.max(width, height));
    const canvas = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) });
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
    canvas.width = 0;
    if (!blob) throw new Error('no preview');
    return { width, height, thumb: URL.createObjectURL(blob) };
  }

  function remove(item: ImageItem) {
    if (item.thumb) URL.revokeObjectURL(item.thumb);
    items = items.filter((i) => i !== item);
  }

  function clear() {
    cancel?.();
    for (const i of items) if (i.thumb) URL.revokeObjectURL(i.thumb);
    items = [];
    errors = [];
    result = null;
  }

  const sortByName = () => (items = items.toSorted((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true })));

  /* ---------- building ---------- */

  interface Embeddable {
    bytes: Uint8Array;
    type: 'jpg' | 'png';
    original: boolean;
  }

  async function orientationOf(file: File) {
    const { default: exifr } = await import('exifr');
    return exifr.orientation(file).catch(() => undefined);
  }

  /** JPEGs and PNGs go in byte for byte unless they need turning or compressing */
  async function embeddable(file: File, squeeze: number | null, side = COMPRESS_MAX): Promise<Embeddable> {
    if (squeeze === null) {
      const kind = await imageKind(file);
      if ((kind === 'jpeg' && ((await orientationOf(file)) ?? 1) === 1) || kind === 'png') {
        return { bytes: new Uint8Array(await file.arrayBuffer()), type: kind === 'jpeg' ? 'jpg' : 'png', original: true };
      }
    }
    return reencode(file, squeeze, side);
  }

  /** squeeze: JPEG quality, with photos capped at `side` pixels; null keeps full size at high quality */
  async function reencode(file: File, squeeze: number | null, side = COMPRESS_MAX): Promise<Embeddable> {
    let img = await decodeImage(file);
    if (squeeze !== null && Math.max(img.width, img.height) > side) {
      img = await resizeImage(img, resolveSize(img.width, img.height, { mode: 'fit', width: side, height: side }));
    }
    // graphics and anything see-through stay lossless; photos become high-quality JPEGs
    const kind = await imageKind(file);
    const lossless = squeeze === null && (kind === 'png' || kind === 'gif' || kind === 'bmp' || kind === 'svg' || hasTransparency(img.data));
    const blob = await encodeImage(img, lossless ? { format: 'png' } : { format: 'jpeg', quality: squeeze ?? 92 });
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: lossless ? 'png' : 'jpg', original: false };
  }

  async function build() {
    if (!ready || progress) return;
    // ── device guard (low-end devices): a set of images this device can't hold fails before any work starts ──
    const fit = checkDevice('images', {
      count: items.length,
      bytes: items.reduce((n, i) => n + i.file.size, 0),
      // compressed photos are re-encoded at most COMPRESS_MAX px wide, roughly 1 MB each
      outBytes: compress ? items.length * 2 ** 20 : undefined,
      width: Math.max(0, ...items.map((i) => i.width ?? 0)),
      height: Math.max(0, ...items.map((i) => i.height ?? 0)),
    });
    if (fit.level === 'block') {
      errors = [fit.message];
      return;
    }
    // ── end device guard ──
    const list = [...items];
    const key = jobKey;
    const o = opts;
    const squeeze = compress ? quality : null;
    const separate = each;
    const limit = target;
    const worker = new Worker(new URL('../lib/jpg-to-pdf/pdf.worker.ts', import.meta.url), { type: 'module', name: 'images-to-pdf' });
    const api = Comlink.wrap<ImagesPdfWorker>(worker);
    // a terminated or broken worker never answers, so every wait races this
    let stop!: (e: Error) => void;
    const stopped = new Promise<never>((_, reject) => (stop = reject));
    stopped.catch(() => {});
    const guard = <T,>(p: Promise<T>) => Promise.race([p, stopped]);
    worker.addEventListener('error', () => stop(new Error("The PDF builder couldn't start. Reload the page and try again.")));
    let cancelled = false;
    cancel = () => {
      cancelled = true;
      stop(new Error('cancelled'));
    };

    errors = [];
    result = null;
    let attempt = 0;
    // one full build; a size limit may take a few, each with smaller or lower-quality photos
    const once = async (squeeze: number | null, side: number) => {
      attempt++;
      progress = { done: 0, total: list.length, attempt: limit ? attempt : undefined };
      const files: { name: string; blob: Blob }[] = [];
      const save = async (name: string) => files.push({ name, blob: new Blob([(await guard(api.save())) as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }) });
      if (!separate) await guard(api.start(combinedName(list.map((i) => i.file.name)).replace(/\.pdf$/, '')));
      for (const [k, item] of list.entries()) {
        if (separate) await guard(api.start(item.file.name.replace(/\.[^.]+$/, '')));
        const page = layoutPage(item.width!, item.height!, o);
        try {
          let img = await guard(embeddable(item.file, squeeze, side));
          try {
            await guard(api.add(Comlink.transfer(img.bytes, [img.bytes.buffer as ArrayBuffer]), img.type, page));
          } catch (e) {
            // pdf-lib can't take some JPEG/PNG variants as they are (e.g. odd PNG bit depths)
            if (!img.original || (e as Error).message !== 'embed') throw e;
            img = await guard(reencode(item.file, squeeze, side));
            await guard(api.add(Comlink.transfer(img.bytes, [img.bytes.buffer as ArrayBuffer]), img.type, page));
          }
        } catch (e) {
          if (cancelled) throw e;
          const why = (e as Error).message;
          throw new Error(`${item.file.name} couldn't be added: ${why === 'embed' ? 'the image data looks damaged.' : why || 'unknown error.'}`);
        }
        if (separate) await save(pdfName(item.file.name));
        progress = { done: k + 1, total: list.length, attempt: limit ? attempt : undefined };
      }
      if (!separate) await save(combinedName(list.map((i) => i.file.name)));
      return files;
    };
    try {
      let files = await once(squeeze, COMPRESS_MAX);
      let reached: { bytes: number; quality: number | null; side: number } | undefined;
      if (limit) {
        reached = { bytes: limit, quality: squeeze, side: COMPRESS_MAX };
        if (files[0].blob.size > limit) {
          // the same search the image resizer uses: best JPEG quality first, then smaller photos
          const r = await fitFileSize(
            limit,
            async (q, scale) => {
              const out = await once(q, Math.max(300, Math.round(COMPRESS_MAX * scale)));
              return { files: out, size: out[0].blob.size };
            },
            { maxQuality: 85, minQuality: 45, maxSteps: 6, minScale: 0.12 },
          );
          files = r.out.files;
          reached = { bytes: limit, quality: r.quality, side: Math.max(300, Math.round(COMPRESS_MAX * r.scale)) };
        }
      }
      result = { key, files, pages: list.length, target: reached };
    } catch (e) {
      if (!cancelled) {
        const msg = (e as Error).message;
        errors.push(/memory|allocation/i.test(msg) ? "Your browser ran out of memory. Try fewer images at a time, or turn on Compress images." : msg);
      }
    } finally {
      worker.terminate();
      progress = null;
      cancel = undefined;
    }
  }

  async function download() {
    if (!result) return;
    const { files } = result;
    if (files.length === 1) return downloadResult(files[0].blob, files[0].name);
    zipping = true;
    try {
      downloadResult(await zipBlobs(files), pdfName(files[0].name, '-pdfs', 'zip'));
    } catch {
      errors.push("The zip couldn't be made. Try downloading the PDFs one by one.");
    } finally {
      zipping = false;
    }
  }

  const total = $derived(result?.files.reduce((s, f) => s + f.blob.size, 0) ?? 0);

  const SIZES: [PageSizeOption, string][] = [['fit', 'Fit image'], ['A4', 'A4'], ['Letter', 'Letter']];
  const ORIENTATIONS: [Orientation, string][] = [['auto', 'Auto'], ['portrait', 'Portrait'], ['landscape', 'Landscape']];
  const MARGIN_OPTS: [Margin, string][] = [['none', 'None'], ['small', 'Small'], ['big', 'Big']];
  const PLACEMENTS: [Placement, string][] = [['fit', 'Whole image'], ['fill', 'Fill page']];
  const OUTPUTS: ['one' | 'each', string][] = [['one', 'One PDF'], ['each', 'One per image']];
</script>

{#snippet seg(label: string, options: [string, string][], value: string, set: (v: string) => void)}
  <div>
    <span class="label">{label}</span>
    <div class="seg" role="group" aria-label={label}>
      {#each options as [v, text]}
        <button type="button" aria-pressed={value === v} onclick={() => set(v)}>{text}</button>
      {/each}
    </div>
  </div>
{/snippet}

{#if !items.length}
  <Dropzone accept={ACCEPT} multiple paste={false} title="Drop images here" hint="JPG, PNG, WebP, HEIC or GIF · or click to choose" onfiles={add} />
  {#if errors.length}<p class="mono mt-3 text-bad" role="alert">{errors.join(' ')}</p>{/if}
{:else}
  <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
    <div
      class="main"
      class:over
      role="region"
      aria-label="Images"
      ondragover={(e) => {
        if (!e.dataTransfer?.types.includes('Files')) return;
        e.preventDefault();
        over = true;
      }}
      ondragleave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) over = false;
      }}
      ondrop={(e) => {
        if (!e.dataTransfer?.files.length) return;
        e.preventDefault();
        over = false;
        // adding mid-build would change the job and throw the finished PDF away
        if (!progress) add(Array.from(e.dataTransfer.files));
      }}
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="mono">
          {items.length} image{items.length === 1 ? '' : 's'} · drag to reorder
          {#if items.length > 1}· <button type="button" class="link" disabled={!!progress} onclick={sortByName}>sort by name</button>{/if}
        </p>
        <button type="button" class="btn add py-2!" disabled={!!progress} onclick={() => picker?.click()}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
          Add images
        </button>
        <input bind:this={picker} type="file" accept={ACCEPT} multiple hidden onchange={(e) => (add(Array.from(e.currentTarget.files ?? [])), (e.currentTarget.value = ''))} />
      </div>

      <ImagesToPdfGrid bind:items {layout} disabled={!!progress} onremove={remove} />

      {#if errors.length}
        <div class="errors" role="alert">
          <ul>
            {#each errors as msg, i (i)}<li>{msg}</li>{/each}
          </ul>
          <button type="button" class="link shrink-0" onclick={() => (errors = [])}>Dismiss</button>
        </div>
      {/if}
    </div>

    <aside class="grid content-start gap-5">
      <fieldset class="grid min-w-0 gap-5" disabled={!!progress}>
        {@render seg('page size', SIZES, size, (v) => (size = v as PageSizeOption))}
        {#if size !== 'fit'}
          {@render seg('orientation', ORIENTATIONS, orientation, (v) => (orientation = v as Orientation))}
        {/if}
        {@render seg('margin', MARGIN_OPTS, margin, (v) => (margin = v as Margin))}
        {#if size !== 'fit'}
          {@render seg('image on the page', PLACEMENTS, placement, (v) => (placement = v as Placement))}
        {/if}

        <div class="grid gap-3">
          <label class="flex items-start gap-2 text-sm">
            <input type="checkbox" bind:checked={compress} class="mt-1" />
            <span>Compress images<span class="mono block">re-saves every image as JPG and shrinks any over {COMPRESS_MAX} px</span></span>
          </label>
          {#if compress}
            <label>
              <span class="label">quality · {quality}</span>
              <input type="range" min="30" max="95" bind:value={quality} class="w-full accent-(--color-sun)" />
              <span class="mono flex justify-between"><span>smaller</span><span>sharper</span></span>
            </label>
          {/if}
        </div>

        <div class="grid gap-3">
          <label class="flex items-start gap-2 text-sm">
            <input type="checkbox" bind:checked={limitOn} class="mt-1" />
            <span>Keep the PDF under a size<span class="mono block">for upload forms with a limit</span></span>
          </label>
          {#if limitOn}
            <label>
              <span class="label">at most · KB</span>
              <input class="field" type="number" min="1" step="any" inputmode="decimal" bind:value={limitKb} />
            </label>
            <p class="mono" class:text-bad={each}>
              {#if each}a size limit needs "One PDF" output{:else if target}{limitText({ max: target })} · lowers photo quality, then size, only as far as needed{:else}enter a size above 0 KB{/if}
            </p>
          {/if}
        </div>

        {#if items.length > 1}
          {@render seg('output', OUTPUTS, output, (v) => (output = v as 'one' | 'each'))}
        {/if}
      </fieldset>

      <div class="grid gap-3 border-t border-line pt-5">
        {#if progress}
          <div class="grid gap-2" role="status">
            <p class="mono">
              {#if progress.attempt}try {progress.attempt} · {/if}
              {#if progress.done < progress.total}
                Adding image <span class="text-chalk">{progress.done + 1}</span> of {progress.total}…
              {:else}
                Saving the PDF…
              {/if}
            </p>
            <div class="meter" role="progressbar" aria-label="Building PDF" aria-valuemin="0" aria-valuemax={progress.total} aria-valuenow={progress.done}>
              <span style:width="{(progress.done / progress.total) * 100}%"></span>
            </div>
            <button type="button" class="btn" onclick={() => cancel?.()}>Cancel</button>
          </div>
        {:else if result}
          <div class="ready" role="status">
            <svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5" /><path d="M7 12.5l3.2 3.2L17 9" /></svg>
            <div class="min-w-0">
              <p class="font-serif text-2xl leading-tight">{result.files.length === 1 ? 'Your PDF is ready' : `${result.files.length} PDFs ready`}</p>
              <p class="mono truncate">
                {result.files.length === 1 ? `${result.files[0].name} · ${result.pages} page${result.pages === 1 ? '' : 's'}` : `one page each`} · {formatBytes(total)}
              </p>
            </div>
          </div>
          {#if result.target}
            {@const v = verdict(total, { max: result.target.bytes })}
            <p class="mono" class:text-ok={v.ok} class:text-bad={!v.ok}>Result: {v.text}</p>
            {#if result.target.quality !== null}
              <p class="mono">photos at quality {result.target.quality}{result.target.side < COMPRESS_MAX ? `, at most ${result.target.side} px` : ''}</p>
            {/if}
            {#if !v.ok}
              <p class="text-sm text-soft">
                Even with small, low-quality photos, {result.pages} page{result.pages === 1 ? '' : 's'} come to {sizeText(total)}. Use fewer images, or split the PDF
                into parts afterwards.
              </p>
            {/if}
          {/if}
          <button type="button" class="btn btn-primary" disabled={zipping} onclick={download}>
            {zipping ? 'Zipping…' : result.files.length === 1 ? 'Download PDF' : 'Download all as .zip'}
          </button>
        {:else}
          <button type="button" class="btn btn-primary" disabled={!ready} onclick={build}>
            {ready ? (each ? `Create ${items.length} PDFs` : 'Create PDF') : 'Reading images…'}
          </button>
        {/if}
        <button type="button" class="btn" onclick={clear}>Start over</button>
      </div>
    </aside>
  </div>
{/if}

<style>
  .main {
    display: grid;
    align-content: start;
    gap: 14px;
    min-width: 0;
    border-radius: 18px;
    outline: 1.5px dashed transparent;
    outline-offset: 6px;
    transition: outline-color 0.2s;
    &.over {
      outline-color: var(--color-sun);
    }
  }
  .add {
    border-style: dashed;
  }
  .link {
    font: inherit;
    color: var(--color-soft);
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 3px;
    &:disabled {
      opacity: 0.4;
      cursor: default;
    }
  }
  fieldset:disabled {
    opacity: 0.6;
  }
  .errors {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 14px;
    border-radius: 12px;
    border: 1px solid #ff7a6b55;
    background: #ff7a6b12;
    color: var(--color-bad);
    font-size: 14px;
    overflow-wrap: anywhere;
    & ul {
      flex: 1;
      min-width: 0;
    }
  }
  .meter {
    height: 6px;
    border-radius: 99px;
    background: var(--color-panel-2);
    overflow: hidden;
    & span {
      display: block;
      height: 100%;
      background: var(--color-sun);
      border-radius: inherit;
      transition: width 0.25s ease-out;
    }
  }
  .ready {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .tick {
    flex: none;
    width: 40px;
    height: 40px;
    fill: none;
    stroke: var(--color-ok);
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
    & circle {
      stroke-dasharray: 66;
      animation: draw 0.5s ease-out both;
    }
    & path {
      --len: 16;
      stroke-width: 2;
      stroke-dasharray: 16;
      animation: draw 0.35s 0.35s ease-out both;
    }
  }
  @keyframes draw {
    from { stroke-dashoffset: var(--len, 66); }
    to { stroke-dashoffset: 0; }
  }
</style>
