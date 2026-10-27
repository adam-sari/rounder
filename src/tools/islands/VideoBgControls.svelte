<script lang="ts">
  import { decodeImage } from '@/engines/image/client';
  import type { BgMode } from '@/tools/lib/video-bg/compositor';

  interface Props {
    mode: BgMode;
    color: string;
    image: ImageBitmap | null;
    blur: number;
    feather: number;
    smoothing: number;
    /** offer transparent output (file mode); a string says why it's unavailable here */
    transparent?: boolean | string;
  }

  let {
    mode = $bindable(),
    color = $bindable(),
    image = $bindable(),
    blur = $bindable(),
    feather = $bindable(),
    smoothing = $bindable(),
    transparent = false,
  }: Props = $props();

  const uid = $props.id();
  let imageName = $state('');
  let imageError = $state('');

  const modes: { id: BgMode; label: string }[] = [
    { id: 'blur', label: 'Blur' },
    { id: 'color', label: 'Color' },
    { id: 'image', label: 'Image' },
    { id: 'transparent', label: 'Transparent' },
  ];
  const swatches = [
    { color: '#00b140', label: 'Green screen' },
    { color: '#0047bb', label: 'Blue screen' },
    { color: '#ffffff', label: 'White' },
    { color: '#131211', label: 'Night' },
    { color: '#ffd25e', label: 'Sun yellow' },
    { color: '#c8a6ff', label: 'Lilac' },
  ];

  async function pick(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    imageError = '';
    try {
      const bitmap = await createImageBitmap(await decodeImage(file));
      image?.close();
      image = bitmap;
      imageName = file.name;
    } catch {
      imageError = "That image couldn't be opened. Try a JPG, PNG or WebP.";
    }
  }

  const pct = (v: number) => `${Math.round(v * 100)}%`;
</script>

<div class="grid content-start gap-5">
  <div>
    <span class="label" id="{uid}-mode">new background</span>
    <div class="seg modes" role="group" aria-labelledby="{uid}-mode">
      {#each modes as m}
        {#if m.id !== 'transparent' || transparent !== false}
          {@const why = m.id === 'transparent' && typeof transparent === 'string' ? transparent : null}
          <button type="button" aria-pressed={mode === m.id} disabled={!!why} title={why ?? undefined} onclick={() => (mode = m.id)}>{m.label}</button>
        {/if}
      {/each}
    </div>
  </div>

  {#if mode === 'blur'}
    <label class="grid gap-1">
      <span class="label flex justify-between">blur strength <span class="mono">{pct(blur)}</span></span>
      <input type="range" min="0" max="1" step="0.01" bind:value={blur} />
    </label>
  {:else if mode === 'color'}
    <div>
      <span class="label" id="{uid}-color">color</span>
      <div class="swatches" role="group" aria-labelledby="{uid}-color">
        {#each swatches as s}
          <button type="button" class="swatch" style="--c:{s.color}" aria-pressed={color === s.color} aria-label={s.label} title={s.label} onclick={() => (color = s.color)}></button>
        {/each}
        <label class="swatch custom" title="Any color">
          <input type="color" bind:value={color} aria-label="Pick any color" />
        </label>
      </div>
      <p class="hint">Green screen is the one to pick if you'll key it out in a video editor.</p>
    </div>
  {:else if mode === 'image'}
    <div class="grid gap-2">
      <span class="label">background image</span>
      <label class="btn pick">
        <input type="file" accept="image/*,.heic,.heif" class="sr-only" onchange={pick} />
        {image ? 'Change image' : 'Choose an image'}
      </label>
      {#if imageName}<p class="mono truncate" title={imageName}>{imageName}</p>{/if}
      {#if imageError}<p class="mono text-bad!" role="alert">{imageError}</p>{/if}
      <p class="hint">It's scaled to fill the frame. Until you pick one, the color background is used.</p>
    </div>
  {:else}
    <p class="hint">
      Saves a WebM (VP9) with a see-through background, whatever format is picked below. It works in Chrome, Edge and Firefox and in editors that read
      WebM transparency. If yours doesn't, use the green screen color and key it out instead.
    </p>
  {/if}

  <label class="grid gap-1">
    <span class="label flex justify-between">edge softness <span class="mono">{pct(feather)}</span></span>
    <input type="range" min="0" max="1" step="0.01" bind:value={feather} />
  </label>

  <label class="grid gap-1">
    <span class="label flex justify-between">steadiness <span class="mono">{pct(smoothing)}</span></span>
    <input type="range" min="0" max="1" step="0.01" bind:value={smoothing} />
    <span class="hint">Calms flickering edges. Turn it down if fast moves leave a trail.</span>
  </label>
</div>

<style>
  .modes {
    display: flex;
    flex-wrap: wrap;
    & button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  }
  input[type='range'] {
    width: 100%;
    accent-color: var(--color-ai);
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .swatch {
    position: relative;
    width: 36px;
    height: 36px;
    border-radius: 99px;
    border: 1px solid var(--color-line-2);
    background: var(--c);
    cursor: pointer;
    &[aria-pressed='true'] {
      outline: 2px solid var(--color-ai);
      outline-offset: 2px;
    }
    &.custom {
      overflow: hidden;
      background: conic-gradient(#ff6b4a, #ffd25e, #9be58f, #5fe0d0, #7cc4ff, #c8a6ff, #ff8fb8, #ff6b4a);
      &:focus-within {
        outline: 2px solid var(--color-ai);
        outline-offset: 2px;
      }
      & input {
        position: absolute;
        inset: 0;
        opacity: 0;
        cursor: pointer;
      }
    }
  }
  .pick {
    justify-self: start;
    &:focus-within {
      outline: 2px solid var(--color-sun);
      outline-offset: 2px;
    }
  }
  .hint {
    font-size: 14px;
    color: var(--color-soft);
  }
</style>
