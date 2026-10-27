<script lang="ts">
  import ImageBatch from '@/components/tool/ImageBatch.svelte';
  import { formatInfo, imageKind, outputFormatFor, processImage, type OutputFormat } from '@/engines/image/client';
  import { withExtension } from '@/tools/lib/files';

  let target = $state<'original' | OutputFormat>('original');
  let quality = $state(75);
  let pngColors = $state(true);
  let maxSide = $state(0);
  let neverBigger = $state(true);

  const formats: ['original' | OutputFormat, string][] = [['original', 'same'], ['jpeg', 'JPG'], ['png', 'PNG'], ['webp', 'WebP'], ['avif', 'AVIF']];
  const sizes: [number, string][] = [[0, 'keep'], [3840, '4K'], [2560, '2560'], [1920, '1920'], [1280, '1280']];

  async function process(file: File) {
    const kind = await imageKind(file);
    const format = target === 'original' ? outputFormatFor(kind) : target;
    const out = await processImage(file, {
      resize: maxSide ? { mode: 'fit', width: maxSide, height: maxSide } : undefined,
      encode: { format, quality, colors: format === 'png' && pngColors ? 256 : undefined, dither: true },
    });
    const name = withExtension(file.name, formatInfo[format].ext);
    // re-encoding an already tiny file can grow it; hand back the original instead
    if (neverBigger && out.blob.size >= file.size && format === outputFormatFor(kind) && kind !== 'heic' && !maxSide) {
      return { blob: file, name: file.name, width: out.sourceWidth, height: out.sourceHeight, note: 'already optimal' };
    }
    return { blob: out.blob, name, width: out.width, height: out.height };
  }

  const settingsKey = $derived(JSON.stringify([target, quality, pngColors, maxSide, neverBigger]));
  const showQuality = $derived(target !== 'png');
  const showPng = $derived(target === 'png' || target === 'original');
</script>

<ImageBatch {process} {settingsKey} compare zipName="compressed-images.zip">
  <div>
    <span class="label">output format</span>
    <div class="seg" role="group" aria-label="Output format">
      {#each formats as [value, label]}
        <button type="button" aria-pressed={target === value} onclick={() => (target = value)}>{label}</button>
      {/each}
    </div>
  </div>

  {#if showQuality}
    <label>
      <span class="label">quality · {quality}{target === 'original' ? ' (JPG, WebP, AVIF)' : ''}</span>
      <input type="range" min="10" max="100" bind:value={quality} class="w-full accent-(--color-sun)" />
      <span class="mono flex justify-between"><span>smaller</span><span>sharper</span></span>
    </label>
  {/if}

  {#if showPng}
    <label class="flex items-start gap-2 text-sm">
      <input type="checkbox" bind:checked={pngColors} class="mt-1" />
      <span>Smart PNG color reduction<span class="mono block">up to 80% smaller, keeps transparency</span></span>
    </label>
  {/if}

  <div>
    <span class="label">shrink large images to</span>
    <div class="seg" role="group" aria-label="Maximum size">
      {#each sizes as [value, label]}
        <button type="button" aria-pressed={maxSide === value} onclick={() => (maxSide = value)}>{label}</button>
      {/each}
    </div>
  </div>

  <label class="flex items-start gap-2 text-sm">
    <input type="checkbox" bind:checked={neverBigger} class="mt-1" />
    <span>Never make a file bigger<span class="mono block">keeps the original if it can't be improved</span></span>
  </label>
</ImageBatch>
