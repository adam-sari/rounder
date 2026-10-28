<!--
  Language picker + consent card + download progress for the OCR tools. The first visit shows
  what will download and where it runs; once agreed, later visits start straight away and picking
  another language just downloads that one. The tool below gets the engine through bind:engine
  (null while it loads).
-->
<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { toAiError } from '@/engines/ai/errors';
  import { formatMB, formatProgress, type LoadProgress } from '@/engines/ai/progress';
  import { cachedLanguages, createOcrEngine, ENGINE_BYTES, hasOcrConsent, rememberOcrConsent, type OcrEngine } from '@/tools/lib/ocr/engine';
  import { defaultLanguages, LANGUAGES, languageBytes, languageNames, normalizeLanguages, TESSDATA } from '@/tools/lib/ocr/languages';

  interface Props {
    /** Tesseract workers run side by side (pages of a PDF) */
    workers?: number;
    /** the running engine; null until it's ready and while languages change */
    engine?: OcrEngine | null;
    /** what one image takes, for the card */
    speed?: string;
    /** keeps the languages fixed while the tool is working */
    locked?: boolean;
    children: Snippet;
  }

  let { workers = 1, engine = $bindable(null), speed = 'a few seconds per page', locked = false, children }: Props = $props();

  const uid = $props.id();
  const MAX_LANGS = 3;
  const LANGS_KEY = 'rounder:ocr-langs';

  type Status = 'checking' | 'idle' | 'loading' | 'ready' | 'error';
  let status = $state<Status>('checking');
  let langs = $state<string[]>(['eng']);
  let cached = $state<Set<string>>(new Set());
  let agreed = $state(false);
  let progress = $state<LoadProgress | null>(null);
  let error = $state('');
  let filter = $state('');
  let ctl: AbortController | null = null;
  let changeTimer: ReturnType<typeof setTimeout> | undefined;

  const missing = $derived(langs.filter((c) => !cached.has(c)));
  const download = $derived(languageBytes(missing));
  const names = $derived(languageNames(langs));
  const pct = $derived(progress?.total ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : 0);
  const setup = $derived(progress?.phase === 'init' || (!!progress?.total && pct >= 100));
  const shown = $derived(
    filter.trim() ? LANGUAGES.filter((l) => `${l.name} ${l.native ?? ''} ${l.code}`.toLowerCase().includes(filter.trim().toLowerCase())) : LANGUAGES,
  );

  onMount(() => {
    let gone = false;
    (async () => {
      let saved: string[] | null = null;
      try {
        saved = JSON.parse(localStorage.getItem(LANGS_KEY) ?? 'null');
      } catch {
        /* nothing saved */
      }
      langs = Array.isArray(saved) ? normalizeLanguages(saved) : defaultLanguages(navigator.languages ?? [navigator.language]);
      cached = await cachedLanguages(LANGUAGES.map((l) => l.code));
      agreed = hasOcrConsent();
      if (gone) return;
      if (agreed) start();
      else status = 'idle';
    })();
    return () => {
      gone = true;
      clearTimeout(changeTimer);
      ctl?.abort();
      engine?.terminate();
    };
  });

  async function start() {
    ctl?.abort();
    const job = (ctl = new AbortController());
    engine?.terminate();
    engine = null;
    status = 'loading';
    progress = null;
    error = '';
    try {
      const next = await createOcrEngine(langs, { workers, signal: job.signal, onProgress: (p) => job === ctl && (progress = p) });
      if (job !== ctl) return next.terminate();
      engine = next;
      status = 'ready';
      agreed = true;
      rememberOcrConsent();
    } catch (e) {
      if (job !== ctl) return;
      const err = toAiError(e);
      if (err.code === 'aborted') status = 'idle';
      else {
        console.error(e);
        error = err.code === 'failed' ? "The OCR engine couldn't start. Reload the page and try again." : err.message.replace('The model', 'The language data');
        status = 'error';
      }
    } finally {
      if (job === ctl) cached = await cachedLanguages(LANGUAGES.map((l) => l.code));
    }
  }

  function cancel() {
    ctl?.abort();
    ctl = null;
    status = 'idle';
    progress = null;
  }

  function toggle(code: string, on: boolean) {
    const next = on ? [...langs, code] : langs.filter((c) => c !== code);
    if (!next.length || next.length > MAX_LANGS) return;
    langs = normalizeLanguages(next);
    try {
      localStorage.setItem(LANGS_KEY, JSON.stringify(langs));
    } catch {
      /* not remembered, that's all */
    }
    // a running engine reloads with the new set once the visitor stops clicking
    if (status === 'ready' || status === 'loading') {
      clearTimeout(changeTimer);
      changeTimer = setTimeout(start, 700);
    }
  }
</script>

{#snippet picker()}
  <details class="picker">
    <summary>
      <span class="label m-0!">{langs.length > 1 ? 'languages' : 'language'}</span>
      <span class="names">{names}</span>
      <span class="mono">{missing.length ? `${formatMB(download)} to download` : '✓ on this device'} · change</span>
    </summary>
    <div class="grid gap-3 pt-3">
      <label class="block">
        <span class="sr-only">Find a language</span>
        <input class="field py-2!" type="search" placeholder="Find a language…" bind:value={filter} />
      </label>
      <fieldset class="grid gap-1.5">
        <legend class="mono mb-2">
          {locked ? 'Stop reading first to change languages.' : `Pick up to ${MAX_LANGS}. Each extra language makes reading a little slower.`}
        </legend>
        <div class="langs">
          {#each shown as l (l.code)}
            {@const on = langs.includes(l.code)}
            <label class="lang" class:on>
              <input
                type="checkbox"
                checked={on}
                disabled={locked || (on && langs.length === 1) || (!on && langs.length >= MAX_LANGS)}
                onchange={(e) => toggle(l.code, e.currentTarget.checked)}
              />
              <span class="min-w-0">
                <span class="block truncate">{l.name}</span>
                {#if l.native}<span class="mono block truncate" lang={l.locales[0]}>{l.native}</span>{/if}
              </span>
              <span class="mono size">{cached.has(l.code) ? '✓' : formatMB(l.bytes)}</span>
            </label>
          {:else}
            <p class="mono">No match among the {LANGUAGES.length} languages offered here.</p>
          {/each}
        </div>
      </fieldset>
    </div>
  </details>
{/snippet}

{#if status === 'ready' || (agreed && status === 'loading')}
  <div class="bar-row">
    <p class="chip mono" role="status">
      <span class="dot" aria-hidden="true"></span>
      {#if status === 'ready'}Tesseract OCR · running on your processor · nothing leaves this device
      {:else if setup || !progress}starting the OCR engine…
      {:else}downloading {names} · {formatProgress(progress)}{/if}
    </p>
    {#if status === 'loading'}<button type="button" class="btn py-1.5! px-3! text-sm!" onclick={cancel}>Cancel</button>{/if}
  </div>
  {@render picker()}
{:else}
  <section class="gate card" aria-labelledby={`${uid}-title`} aria-busy={status === 'checking' || status === 'loading'}>
    <div class="flex flex-wrap items-center gap-2">
      <span class="pill"><span class="dot" aria-hidden="true"></span>AI text recognition · runs on your device</span>
      {#if status !== 'checking' && !missing.length}<span class="pill done">✓ already downloaded</span>{/if}
    </div>
    {#if status === 'checking'}
      <h2 id={`${uid}-title`} class="title">Checking your device…</h2>
    {:else}
      <h2 id={`${uid}-title`} class="title">Tesseract OCR</h2>
      <p class="text-soft">
        Reads printed and typed text in {LANGUAGES.length} languages. Sharp scans and screenshots work best; handwriting, curved pages and busy photos are hit and miss.
      </p>
      {@render picker()}
      <dl class="facts">
        <div>
          <dt class="label">download</dt>
          <dd>
            {#if missing.length}{formatMB(download)} for {languageNames(missing)}, once{:else}already on this device{/if}
            {#if !agreed}<span class="sub">+ about {formatMB(ENGINE_BYTES)} OCR engine</span>{/if}
          </dd>
        </div>
        <div>
          <dt class="label">runs on</dt>
          <dd>your processor<span class="sub">typically {speed}</span></dd>
        </div>
        <div>
          <dt class="label">license</dt>
          <dd>
            <a href={TESSDATA.license.url} target="_blank" rel="noopener noreferrer" class="link">{TESSDATA.license.name}<span class="sr-only"> license (opens in a new tab)</span></a>
            <span class="sub">Tesseract OCR and its fast models, by Google and contributors</span>
          </dd>
        </div>
      </dl>

      {#if status === 'loading'}
        <div class="grid gap-2" aria-live="polite">
          <div class="bar" class:init={setup} role="progressbar" aria-label="OCR download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={setup ? 100 : pct}>
            <span style:width={`${setup ? 100 : pct}%`}></span>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="mono">
              {#if setup}starting the OCR engine…{:else if progress}downloading · {formatProgress(progress)} · {pct}%{:else}starting…{/if}
            </p>
            <button type="button" class="btn py-2! text-sm!" onclick={cancel}>Cancel</button>
          </div>
        </div>
      {:else}
        {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}
        <div>
          <button type="button" class="btn btn-ai" onclick={start}>
            {status === 'error' ? 'Try again' : missing.length ? 'Download & start' : 'Start'}
          </button>
        </div>
      {/if}
      <p class="fine">
        It's AI, so give the result a quick read. The language files come from the Tesseract project (via jsDelivr) the first time and then stay in your browser; your images and PDFs never leave your device.
      </p>
    {/if}
  </section>
{/if}

<!-- hidden for the moment the device check takes, so the tool doesn't visibly jump down when the panel above it opens -->
<div class="mt-6" style:visibility={status === 'checking' ? 'hidden' : null}>{@render children()}</div>

<style>
  .gate {
    display: grid;
    gap: 16px;
    padding: clamp(18px, 3vw, 28px);
    border-color: color-mix(in srgb, var(--color-ai) 35%, var(--color-line-2));
    background:
      radial-gradient(120% 80% at 100% 0%, color-mix(in srgb, var(--color-ai) 9%, transparent), transparent 60%),
      var(--color-panel);
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font: 400 12px var(--font-mono);
    color: var(--color-ai);
    padding: 5px 10px;
    border-radius: 99px;
    background: color-mix(in srgb, var(--color-ai) 12%, transparent);
    &.done {
      color: var(--color-ok);
      background: color-mix(in srgb, var(--color-ok) 12%, transparent);
    }
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 99px;
    background: var(--color-ai);
    box-shadow: 0 0 10px var(--color-ai);
    flex: none;
  }
  .title {
    font-size: clamp(28px, 4vw, 36px);
    line-height: 1.05;
  }
  .facts {
    display: grid;
    gap: 14px;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    padding-block: 14px;
    border-block: 1px solid var(--color-line);
    & dd {
      display: grid;
      gap: 2px;
      font-size: 15px;
    }
  }
  .sub {
    font: 400 12.5px var(--font-mono);
    color: var(--color-muted);
  }
  .link {
    color: var(--color-ai);
    text-decoration: underline dotted;
    text-underline-offset: 4px;
  }
  .fine {
    font-size: 13px;
    color: var(--color-muted);
  }
  .btn-ai {
    background: var(--color-ai);
    border-color: var(--color-ai);
    color: var(--color-bg);
    &:hover {
      background: color-mix(in srgb, var(--color-ai) 85%, white);
    }
  }
  .bar {
    position: relative;
    height: 10px;
    border-radius: 99px;
    overflow: hidden;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line);
    & span {
      position: absolute;
      inset: 0 auto 0 0;
      border-radius: inherit;
      background: linear-gradient(90deg, color-mix(in srgb, var(--color-ai) 70%, transparent), var(--color-ai));
      transition: width 0.25s ease-out;
    }
    &.init span {
      background: repeating-linear-gradient(-45deg, var(--color-ai) 0 10px, color-mix(in srgb, var(--color-ai) 65%, transparent) 10px 20px);
      background-size: 28px 28px;
      animation: stripes 0.9s linear infinite;
    }
  }
  @keyframes stripes {
    to {
      background-position: 28px 0;
    }
  }
  .bar-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 10px;
  }
  .chip {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .picker {
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
    padding: 10px 14px;
    background: #141312;
    & summary {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 4px 12px;
      cursor: pointer;
      list-style: none;
      &::-webkit-details-marker {
        display: none;
      }
      &:focus-visible {
        outline: 2px solid var(--color-sun);
        outline-offset: 4px;
        border-radius: 6px;
      }
    }
    &[open] summary .mono {
      color: var(--color-sun);
    }
  }
  .names {
    font-size: 15px;
    flex: 1;
    min-width: 0;
  }
  .langs {
    display: grid;
    gap: 6px;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    max-height: 320px;
    overflow-y: auto;
    padding-right: 2px;
  }
  .lang {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border: 1px solid var(--color-line);
    border-radius: 10px;
    font-size: 14px;
    cursor: pointer;
    &.on {
      border-color: color-mix(in srgb, var(--color-ai) 60%, transparent);
      background: color-mix(in srgb, var(--color-ai) 8%, transparent);
    }
    &:has(input:disabled) {
      cursor: default;
    }
    &:has(input:disabled:not(:checked)) {
      opacity: 0.55;
    }
    & input {
      accent-color: var(--color-ai);
    }
  }
  .size {
    font-size: 11.5px;
  }
  @media (prefers-reduced-motion: reduce) {
    .bar.init span {
      animation: none;
    }
  }
</style>
