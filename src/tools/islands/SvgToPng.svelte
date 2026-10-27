<script lang="ts">
  import { onMount } from 'svelte';
  import ImageBatch from '@/components/tool/ImageBatch.svelte';
  import { encodeImage, formatInfo } from '@/engines/image/client';
  import { withExtension, withSuffix } from '@/tools/lib/files';
  import { hasExternalRefs, prepareSvg, readSvgSize, targetSize, type Sizing } from '@/tools/lib/svg-to-png/svg';

  type Format = 'png' | 'jpeg' | 'webp';
  type SizeChoice = '1' | '2' | '4' | 'width' | 'height';

  let format = $state<Format>('png');
  let size = $state<SizeChoice>('2');
  let px = $state(1024);
  let transparent = $state(true);
  let color = $state('#ffffff');
  let code = $state('');
  let codeError = $state('');

  let batch: ReturnType<typeof ImageBatch>;
  let pasted = 0;

  const formats: [Format, string][] = [['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP']];
  const sizes: [SizeChoice, string][] = [['1', '1×'], ['2', '2×'], ['4', '4×'], ['width', 'width'], ['height', 'height']];

  const sizing = $derived<Sizing>(size === 'width' || size === 'height' ? { mode: size, px: Math.min(16384, Math.max(1, px || 1)) } : { mode: 'scale', factor: +size });
  // JPG has no alpha channel, so transparent areas need a fill
  const background = $derived(!transparent ? color : format === 'jpeg' ? '#ffffff' : null);

  async function process(file: File) {
    // settings can change while this awaits, so the output uses one consistent set
    const fmt = format;
    const fit = sizing;
    const fill = background;
    const text = await file.text();
    const own = readSvgSize(text);
    const out = targetSize(own, fit);
    const url = URL.createObjectURL(new Blob([prepareSvg(text, out.width, out.height)], { type: 'image/svg+xml' }));
    const canvas = document.createElement('canvas');
    try {
      const img = new Image();
      img.src = url;
      await img.decode().catch(() => {
        throw new Error("This SVG couldn't be drawn. Check that it's valid SVG markup.");
      });
      canvas.width = out.width;
      canvas.height = out.height;
      const ctx = canvas.getContext('2d');
      // past a browser's canvas limit (16.7 MP on iPhones) there is no context, or a silently blank one
      ctx?.fillRect(0, 0, 1, 1);
      if (!ctx || !ctx.getImageData(0, 0, 1, 1).data[3]) throw new Error('This size is too big for your browser. Pick a smaller size.');
      ctx.clearRect(0, 0, 1, 1);
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(0, 0, out.width, out.height);
      }
      ctx.drawImage(img, 0, 0, out.width, out.height);
      let pixels: ImageData;
      try {
        pixels = ctx.getImageData(0, 0, out.width, out.height);
      } catch {
        // Safari blocks reading back svgs that contain html (<foreignObject>)
        throw new Error("Your browser won't let this SVG be converted (it contains embedded HTML).");
      }
      // free the canvas before the encode, so parallel files don't each hold one
      canvas.width = canvas.height = 0;
      const blob = await encodeImage(pixels, { format: fmt, quality: 92 });

      const base = withExtension(file.name, formatInfo[fmt].ext);
      const name =
        fit.mode === 'scale' && !out.capped ? (fit.factor === 1 ? base : withSuffix(base, `@${fit.factor}x`)) : withSuffix(base, `-${out.width}x${out.height}`);
      const notes = [
        own.guessed && `no size in file, used ${own.width} px`,
        out.capped && 'capped to fit browser limits',
        hasExternalRefs(text) && 'linked images or fonts skipped',
      ].filter(Boolean);
      return { blob, name, width: out.width, height: out.height, note: notes.join(' · ') || undefined };
    } finally {
      URL.revokeObjectURL(url);
      // on errors too: Safari holds on to canvas memory otherwise
      canvas.width = canvas.height = 0;
    }
  }

  const looksLikeSvg = (s: string) => /<svg[\s>]/i.test(s);

  function addSvg(svg: string) {
    batch.add([new File([svg], `pasted-${++pasted}.svg`, { type: 'image/svg+xml' })]);
  }

  function addCode() {
    if (!looksLikeSvg(code)) {
      codeError = "That doesn't look like SVG code. It should contain an <svg> tag.";
      return;
    }
    addSvg(code.trim());
    code = '';
    codeError = '';
  }

  // svg code pasted anywhere outside a text field is added straight away
  onMount(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.clipboardData?.files.length || target?.closest('input, textarea, [contenteditable]')) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (looksLikeSvg(text)) addSvg(text.trim());
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const settingsKey = $derived(JSON.stringify([format, sizing, background]));
</script>

<ImageBatch bind:this={batch} {process} {settingsKey} accept=".svg,image/svg+xml" title="Drop SVG files here" hint="or click to choose · paste SVG code too" zipName="svg-to-png.zip">
  <div>
    <span class="label">output format</span>
    <div class="seg" role="group" aria-label="Output format">
      {#each formats as [value, label]}
        <button type="button" aria-pressed={format === value} onclick={() => (format = value)}>{label}</button>
      {/each}
    </div>
  </div>

  <div>
    <span class="label">size</span>
    <div class="seg" role="group" aria-label="Output size">
      {#each sizes as [value, label]}
        <button type="button" aria-pressed={size === value} onclick={() => (size = value)}>{label}</button>
      {/each}
    </div>
    {#if size === 'width' || size === 'height'}
      <label class="mt-3 flex items-center gap-2">
        <input type="number" min="1" max="16384" bind:value={px} class="field w-28!" aria-label={`Output ${size} in pixels`} />
        <span class="mono">px {size}, aspect ratio kept</span>
      </label>
    {:else}
      <p class="mono mt-2">{size === '1' ? "the SVG's own size" : `${size}× the SVG's own size`}</p>
    {/if}
  </div>

  <div>
    <span class="label">background</span>
    <div class="flex flex-wrap items-center gap-3">
      <div class="seg" role="group" aria-label="Background">
        <button type="button" aria-pressed={transparent} onclick={() => (transparent = true)}>transparent</button>
        <button type="button" aria-pressed={!transparent} onclick={() => (transparent = false)}>color</button>
      </div>
      {#if !transparent}
        <label class="flex items-center gap-2">
          <input type="color" bind:value={color} class="h-9 w-11 cursor-pointer rounded-lg border border-line-2 bg-transparent" aria-label="Background color" />
          <span class="mono">{color}</span>
        </label>
      {/if}
    </div>
    {#if transparent && format === 'jpeg'}<p class="mono mt-2">JPG can't be transparent, so it gets white</p>{/if}
  </div>

  <details class="paste">
    <summary class="mono">paste SVG code instead</summary>
    <div class="mt-3 grid gap-2">
      <textarea class="field min-h-[110px]! text-xs!" bind:value={code} placeholder={'<svg viewBox="0 0 24 24">…</svg>'} aria-label="SVG code"></textarea>
      {#if codeError}<p class="text-bad text-sm" role="alert">{codeError}</p>{/if}
      <button type="button" class="btn" disabled={!code.trim()} onclick={addCode}>Add to list</button>
    </div>
  </details>

  <p class="mono">Linked images and web fonts can't load when an SVG becomes an image (a browser security rule). Embed them, or convert text to paths first.</p>
</ImageBatch>

<style>
  .paste summary {
    cursor: pointer;
    color: var(--color-soft);
    &:hover {
      color: var(--color-sun);
    }
  }
</style>
