<script lang="ts">
  import { styles, type FancyStyle, type Group } from '@/tools/lib/fancy-text/styles';

  const GROUPS: { id: Group | 'all'; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'serif', label: 'Bold & italic' },
    { id: 'sans', label: 'Sans' },
    { id: 'script', label: 'Script' },
    { id: 'shapes', label: 'Shapes' },
    { id: 'effects', label: 'Effects' },
    { id: 'decor', label: 'Decor' },
  ];
  // rows only render a preview; the full text is converted when copied
  const PREVIEW = 280;
  const SAMPLE = 'Your text, but fancy';

  let text = $state('');
  let group = $state<Group | 'all'>('all');
  let intensity = $state(3);
  let seed = $state(1);
  let toast = $state<{ id: number; msg: string; ok: boolean } | null>(null);
  let flashed = $state<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout>;

  const preview = $derived.by(() => {
    if (!text) return SAMPLE;
    if (text.length <= PREVIEW) return text;
    // don't cut a surrogate pair (emoji, math letters) in half
    const end = /[\uD800-\uDBFF]/.test(text[PREVIEW - 1]) ? PREVIEW - 1 : PREVIEW;
    return text.slice(0, end);
  });
  const truncated = $derived(text.length > PREVIEW);
  const shown = $derived(group === 'all' ? styles : styles.filter((s) => s.group === group));
  const rows = $derived(shown.map((s) => ({ style: s, out: s.apply(preview, { seed, intensity }) })));

  function notify(msg: string, ok: boolean) {
    toast = { id: (toast?.id ?? 0) + 1, msg, ok };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 1800);
  }

  async function copy(style: FancyStyle) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(style.apply(text, { seed, intensity }));
      flashed = style.id;
      notify(`Copied ${style.name.toLowerCase()} text`, true);
    } catch {
      notify('Couldn’t reach the clipboard. Select the text and copy it instead.', false);
    }
  }
</script>

<div class="grid gap-5">
  <div class="input grid gap-3 sm:sticky sm:top-3">
    <label>
      <span class="label">your text</span>
      <textarea
        class="field min-h-[88px]! font-sans! text-lg!"
        rows="2"
        bind:value={text}
        placeholder="Type or paste something…"
        spellcheck="false"
      ></textarea>
    </label>
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="seg" role="group" aria-label="Style group">
        {#each GROUPS as g}
          <button type="button" aria-pressed={group === g.id} onclick={() => (group = g.id)}>{g.label}</button>
        {/each}
      </div>
      <span class="mono">{shown.length} styles · click one to copy</span>
    </div>
  </div>

  <ul class="grid gap-2" aria-label="Styled versions">
    {#each rows as { style, out } (style.id)}
      <li class="row" class:flash={flashed === style.id} onanimationend={() => (flashed = null)}>
        <button
          type="button"
          class="pick"
          disabled={!text}
          aria-label={`Copy ${style.name} text`}
          onclick={() => copy(style)}
        >
          <span class="mono block">{style.name}</span>
          <span class="out" class:empty={!text} class:glitch={style.id === 'glitch'} style:--z={style.id === 'glitch' ? intensity : undefined}>{out}{truncated ? '…' : ''}</span>
          <span class="copy mono" aria-hidden="true">copy</span>
        </button>
        {#if style.id === 'glitch'}
          <div class="flex flex-wrap items-center gap-3 px-4 pb-3">
            <label class="mono flex items-center gap-2">
              intensity
              <input type="range" min="1" max="10" bind:value={intensity} class="w-28 accent-(--color-sun)" />
              <span class="w-5 text-chalk">{intensity}</span>
            </label>
            <button type="button" class="btn px-3! py-1.5! text-sm!" onclick={() => (seed = Math.floor(Math.random() * 2 ** 31))}>
              Reshuffle
            </button>
          </div>
        {/if}
      </li>
    {/each}
  </ul>

  <p class="mono">
    {#if truncated}Previews show the first {PREVIEW} characters; copying converts all of it. {/if}
    Heads-up: these are look-alike symbols, not real fonts. Screen readers may spell them out or skip them, so use them sparingly in names and bios.
  </p>

  <div class="toast-slot" aria-live="polite">
    {#if toast}
      {#key toast.id}
        <div class="toast" class:bad={!toast.ok}>
          <span class="dot" aria-hidden="true"></span>{toast.msg}
        </div>
      {/key}
    {/if}
  </div>
</div>

<style>
  .input {
    z-index: 2;
    background: var(--color-panel);
    padding-block: 4px 10px;
  }
  .row {
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
    background: var(--color-panel-2);
    transition: border-color 0.2s;
    &:hover:has(.pick:enabled) {
      border-color: var(--color-muted);
    }
  }
  .row.flash {
    animation: flash 0.7s ease-out;
  }
  .pick {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 2px 12px;
    width: 100%;
    padding: 12px 16px;
    text-align: left;
    background: none;
    border: 0;
    border-radius: 14px;
    color: var(--color-chalk);
    cursor: pointer;
    & > .mono {
      grid-column: 1;
      font-size: 11.5px;
    }
    &:disabled {
      cursor: default;
    }
  }
  .out {
    grid-column: 1;
    font-size: 21px;
    line-height: 1.6;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    &.empty {
      color: var(--color-muted);
    }
    /* overflow would clip the stacked marks, so leave room for them instead */
    &.glitch {
      display: block;
      overflow: visible;
      padding-block: calc(var(--z) * 5px);
    }
  }
  .copy {
    grid-column: 2;
    grid-row: 1 / span 2;
    padding: 6px 12px;
    border: 1px solid var(--color-line-2);
    border-radius: 999px;
    transition: color 0.2s, border-color 0.2s, background 0.2s;
  }
  .pick:disabled .copy {
    opacity: 0.4;
  }
  .pick:enabled:hover .copy,
  .pick:focus-visible .copy {
    color: var(--color-bg);
    background: var(--color-sun);
    border-color: var(--color-sun);
  }
  .toast-slot {
    position: fixed;
    left: 50%;
    bottom: max(20px, env(safe-area-inset-bottom));
    transform: translateX(-50%);
    z-index: 50;
    pointer-events: none;
    width: max-content;
    max-width: calc(100vw - 32px);
  }
  .toast {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 18px;
    border-radius: 999px;
    background: var(--color-chalk);
    color: var(--color-bg);
    font: 500 14.5px var(--font-sans);
    box-shadow: 0 10px 30px #0008;
    animation: pop 0.35s var(--ease-spring);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #3a9a2e;
    flex: none;
  }
  .toast.bad .dot {
    background: #c8402f;
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(12px) scale(0.92);
    }
  }
  @keyframes flash {
    from {
      border-color: var(--color-sun);
      box-shadow: 0 0 0 3px #ffd25e33;
    }
  }
</style>
