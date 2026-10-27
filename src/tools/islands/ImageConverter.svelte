<script lang="ts">
  import { untrack } from 'svelte';
  import ImageBatch from '@/components/tool/ImageBatch.svelte';
  import { formatInfo, processImage, type OutputFormat } from '@/engines/image/client';
  import { withExtension } from '@/tools/lib/files';
  import { acceptFor, defaultQuality, dropTitle, maxSizes, type SourceFormat } from '@/tools/lib/image-converter/formats';

  let { from, to = 'jpeg' }: { from?: SourceFormat; to?: OutputFormat } = $props();

  // the page's target format is only the starting choice
  const initial = untrack(() => to);
  let format = $state<OutputFormat>(initial);
  let quality = $state(defaultQuality[initial]);
  let lossless = $state(false);
  let background = $state('#ffffff');
  let maxSide = $state(0);

  const formats: OutputFormat[] = ['jpeg', 'png', 'webp', 'avif'];
  const swatches: [string, string][] = [['#ffffff', 'White'], ['#000000', 'Black']];

  function pick(f: OutputFormat) {
    if (f === format) return;
    format = f;
    // quality scales differ between codecs, so each format starts from its own sweet spot
    quality = defaultQuality[f];
  }

  const lossy = $derived(formatInfo[format].lossy && !(format === 'webp' && lossless));

  async function process(file: File) {
    const out = await processImage(file, {
      resize: maxSide ? { mode: 'fit', width: maxSide, height: maxSide } : undefined,
      encode: { format, quality, lossless: format === 'webp' && lossless, background },
    });
    return { blob: out.blob, name: withExtension(file.name, formatInfo[format].ext), width: out.width, height: out.height };
  }

  // only settings that change the output trigger a re-run
  const settingsKey = $derived(
    JSON.stringify([format, lossy ? quality : 0, format === 'webp' && lossless, format === 'jpeg' ? background : '', maxSide]),
  );
</script>

<ImageBatch
  {process}
  {settingsKey}
  compare
  accept={acceptFor(from)}
  title={dropTitle(from)}
  hint={from ? 'or click to choose · other formats work too' : 'or click to choose · batches welcome'}
  zipName={`converted-${formatInfo[format].ext}.zip`}
>
  <div>
    <span class="label">convert to</span>
    <div class="seg" role="group" aria-label="Output format">
      {#each formats as f}
        <button type="button" aria-pressed={format === f} onclick={() => pick(f)}>{formatInfo[f].label}</button>
      {/each}
    </div>
  </div>

  {#if format === 'png'}
    <p class="mono">PNG is lossless: every pixel is kept and transparency survives. Photos come out larger than JPG.</p>
  {/if}

  {#if format === 'webp'}
    <label class="flex items-start gap-2 text-sm">
      <input type="checkbox" bind:checked={lossless} class="mt-1" />
      <span>Lossless WebP<span class="mono block">best for logos, screenshots and graphics</span></span>
    </label>
  {/if}

  {#if lossy}
    <label>
      <span class="label">quality · {quality}</span>
      <input type="range" min="10" max="100" bind:value={quality} class="w-full accent-(--color-sun)" />
      <span class="mono flex justify-between"><span>smaller</span><span>sharper</span></span>
    </label>
  {/if}

  {#if format === 'jpeg'}
    <div>
      <span class="label">transparent areas become</span>
      <div class="flex items-center gap-2">
        {#each swatches as [color, name]}
          <button
            type="button"
            class="swatch"
            style:background={color}
            aria-pressed={background === color}
            aria-label={name}
            title={name}
            onclick={() => (background = color)}
          ></button>
        {/each}
        <label class="swatch custom" class:on={!swatches.some(([c]) => c === background)} title="Pick any color">
          <input type="color" bind:value={background} aria-label="Custom background color" />
        </label>
        <span class="mono">{background}</span>
      </div>
      <span class="mono mt-1.5 block">JPG can't store transparency</span>
    </div>
  {/if}

  <div>
    <span class="label">size</span>
    <div class="seg" role="group" aria-label="Maximum size">
      {#each maxSizes as [value, label]}
        <button type="button" aria-pressed={maxSide === value} onclick={() => (maxSide = value)}>{label}</button>
      {/each}
    </div>
    <span class="mono mt-1.5 block">{maxSide ? `longest side up to ${maxSide}px, never enlarged` : 'keeps every pixel of the original'}</span>
  </div>
</ImageBatch>

<style>
  .swatch {
    position: relative;
    width: 30px;
    height: 30px;
    flex: none;
    border-radius: 999px;
    border: 1px solid var(--color-line-2);
    cursor: pointer;
    outline-offset: 2px;
    &[aria-pressed='true'],
    &.on {
      outline: 2px solid var(--color-sun);
    }
  }
  .custom {
    overflow: hidden;
    background: conic-gradient(#ff5e5e, #ffd25e, #5eff8a, #5ec8ff, #b65eff, #ff5e5e);
    & input {
      position: absolute;
      inset: 0;
      opacity: 0;
      width: 100%;
      height: 100%;
      cursor: pointer;
    }
    &:focus-within {
      outline: 2px solid var(--color-chalk);
    }
  }
</style>
