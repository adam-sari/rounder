<script lang="ts">
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import { fromHsv, fromOklch, inGamut, to8bit, toGamut, toHsv, type Color, type Vec3 } from '@/tools/lib/color/convert';
  import { parseColor } from '@/tools/lib/color/parse';
  import { formatAll, formatLabels, swatchCss, toHex, toHex6 } from '@/tools/lib/color/format';
  import { apca, apcaUse, contrastRatio, readableInk, resolvePair, wcagChecks } from '@/tools/lib/color/contrast';
  import { scaleCode, shades, type ScaleExport, type Shade } from '@/tools/lib/color/scale';
  import { simulate, visions } from '@/tools/lib/color/cvd';
  import { nearestNamed } from '@/tools/lib/image-color-picker/color';

  const START = '#ffd25e';
  const START_BG = '#131211';

  let text = $state(START);
  let color = $state<Color>(parseColor(START)!);
  /** the picker works in HSV; kept separately so dragging through gray or black doesn't lose the hue */
  let hsv = $state<Vec3>(toHsv(parseColor(START)!));
  let bgText = $state(START_BG);
  let bg = $state<Color>(parseColor(START_BG)!);

  const invalid = $derived(!!text.trim() && !parseColor(text));
  const bgInvalid = $derived(!!bgText.trim() && !parseColor(bgText));

  /** hex when it can hold the color exactly, oklch when it can't */
  const canonical = (c: Color) => (inGamut(c) ? toHex(c) : formatAll(c).oklch);

  function setColor(c: Color, write = true) {
    color = c;
    const [h, s, v] = toHsv(toGamut(c));
    hsv = [s > 0.001 && v > 0.001 ? h : hsv[0], v > 0.001 ? s : hsv[1], v];
    if (write) text = canonical(c);
  }

  function onText(value: string) {
    text = value;
    const c = parseColor(value);
    if (c) setColor(c, false);
  }

  function onBgText(value: string) {
    bgText = value;
    const c = parseColor(value);
    if (c) bg = c;
  }

  function setHsv(next: Vec3) {
    hsv = next;
    color = fromHsv(next, color.alpha);
    text = toHex(color);
  }

  function setAlpha(percent: number) {
    color = { ...color, alpha: percent / 100 };
    text = canonical(color);
  }

  function random() {
    setColor(toGamut(fromOklch([0.45 + Math.random() * 0.4, 0.06 + Math.random() * 0.16, Math.random() * 360])));
  }

  function swap() {
    // keep what the user typed when it's readable, otherwise write the color out
    const [c, t] = [color, parseColor(text) ? text : canonical(color)];
    setColor(bg);
    if (parseColor(bgText)) text = bgText;
    bg = c;
    bgText = t;
  }

  // saturation / brightness square
  let square = $state<HTMLDivElement>();
  let dragging = false;
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

  function fromPointer(e: PointerEvent) {
    if (!square) return;
    const r = square.getBoundingClientRect();
    setHsv([hsv[0], clamp01((e.clientX - r.left) / r.width), 1 - clamp01((e.clientY - r.top) / r.height)]);
  }

  function onSquareKey(e: KeyboardEvent) {
    const step = e.shiftKey ? 0.1 : 0.01;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    setHsv([hsv[0], clamp01(hsv[1] + m[0]), clamp01(hsv[2] + m[1])]);
  }

  const formats = $derived(formatAll(color));
  const hex6 = $derived(toHex6(color));
  const named = $derived.by(() => {
    const [r, g, b] = to8bit(color);
    return nearestNamed({ r, g, b });
  });
  const outside = $derived(!inGamut(color));
  // the hero shows see-through colors over a dark checkerboard, so judge ink against that
  const CHECKER: Color = { r: 0.145, g: 0.141, b: 0.129, alpha: 1 };
  const ink = $derived(readableInk(color, CHECKER));

  // shades
  const scale = $derived(shades(color));
  let scaleValue = $state<'hex' | 'oklch'>('hex');
  let scaleFormat = $state<ScaleExport>('css');
  let scaleName = $state('brand');
  const code = $derived(scaleCode(scale.shades, scaleFormat, scaleValue, scaleName.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'brand'));
  let copiedStep = $state<number | null>(null);
  let copyTimer: ReturnType<typeof setTimeout>;

  async function copyShade(s: Shade) {
    try {
      await navigator.clipboard.writeText(s[scaleValue]);
      copiedStep = s.step;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copiedStep = null), 1200);
    } catch {
      // clipboard blocked; the value is still visible to select by hand
    }
  }

  // contrast
  const pair = $derived(resolvePair(color, bg));
  const ratio = $derived(contrastRatio(pair.text, pair.bg));
  // rounded down so 4.499 never shows as a passing 4.5
  const ratioText = $derived((Math.floor(ratio * 100) / 100).toFixed(2).replace(/\.?0+$/, ''));
  const checks = $derived(wcagChecks(ratio));
  const lc = $derived(apca(pair.text, pair.bg));
  const views = $derived([
    { id: 'normal', name: 'Normal vision', detail: 'for comparison', text: pair.text, bg: pair.bg },
    ...visions.map((v) => ({ ...v, text: simulate(pair.text, v.id), bg: simulate(pair.bg, v.id) })),
  ]);

  const scaleValues = [['hex', 'hex'], ['oklch', 'oklch']] as const;
  const scaleFormats = [['css', 'CSS'], ['tailwind', 'Tailwind'], ['json', 'JSON']] as const;
</script>

<div class="grid gap-10">
  <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
    <div class="grid min-w-0 content-start gap-5">
      <label>
        <span class="label">your color</span>
        <input
          class="field mono-field"
          value={text}
          oninput={(e) => onText(e.currentTarget.value)}
          placeholder="#ff8800, rgb(255 136 0), oklch(75% 0.18 60), tomato…"
          spellcheck="false"
          autocomplete="off"
          aria-invalid={invalid}
          aria-describedby="color-hint"
        />
      </label>
      <p id="color-hint" class="mono -mt-3" class:text-bad={invalid} aria-live="polite">
        {invalid ? "Can't read that yet. Try hex, rgb(), hsl(), oklch(), cmyk() or a name like tomato." : 'hex, rgb, hsl, hwb, lab, lch, oklab, oklch, color(), cmyk or a CSS name'}
      </p>

      <div class="grid gap-4">
        <div
          bind:this={square}
          class="square"
          style:--hue={hsv[0]}
          role="slider"
          tabindex="0"
          aria-label="Saturation and brightness"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(hsv[1] * 100)}
          aria-valuetext="saturation {Math.round(hsv[1] * 100)}%, brightness {Math.round(hsv[2] * 100)}%"
          onpointerdown={(e) => {
            dragging = true;
            square?.setPointerCapture(e.pointerId);
            fromPointer(e);
          }}
          onpointermove={(e) => dragging && fromPointer(e)}
          onpointerup={() => (dragging = false)}
          onpointercancel={() => (dragging = false)}
          onkeydown={onSquareKey}
        >
          <span class="thumb" style:left="{hsv[1] * 100}%" style:top="{(1 - hsv[2]) * 100}%" style:background={hex6}></span>
        </div>
        <label>
          <span class="label">hue · {Math.round(hsv[0])}°</span>
          <input class="slider hue" type="range" min="0" max="360" step="1" value={hsv[0]} oninput={(e) => setHsv([+e.currentTarget.value, hsv[1], hsv[2]])} />
        </label>
        <label>
          <span class="label">opacity · {Math.round(color.alpha * 100)}%</span>
          <input class="slider alpha" type="range" min="0" max="100" step="1" value={Math.round(color.alpha * 100)} style:--c={hex6} oninput={(e) => setAlpha(+e.currentTarget.value)} />
        </label>
        <div class="flex flex-wrap items-center gap-2">
          <label class="btn native" title="Open your system color picker">
            <input type="color" value={hex6} oninput={(e) => setColor({ ...parseColor(e.currentTarget.value)!, alpha: color.alpha })} />
            System picker
          </label>
          <button type="button" class="btn" onclick={random}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" /><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" /><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" /><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor" /></svg>
            Surprise me
          </button>
        </div>
      </div>
    </div>

    <div class="grid min-w-0 content-start gap-4">
      <div class="hero" class:light={ink === 'black'}>
        <div class="fill" style={swatchCss(color)}></div>
        <div class="relative grid gap-1">
          <p class="font-serif text-4xl leading-none sm:text-5xl">{formats.hex}</p>
          <p class="text-sm opacity-80">{named.exact ? named.name : `closest name: ${named.name}`}</p>
        </div>
        {#if outside}
          <p class="gamut relative">outside sRGB · hex, RGB, HSL, HWB and CMYK show the closest match</p>
        {/if}
      </div>
      <dl class="grid gap-2">
        {#each formatLabels as [key, label] (key)}
          <div class="row">
            <dt class="label mb-0!">{label}</dt>
            <dd class="mono truncate text-chalk!" title={formats[key]}>{formats[key]}</dd>
            <CopyButton text={formats[key]} class="px-3! py-2! text-[13px]!" />
          </div>
        {/each}
      </dl>
    </div>
  </div>

  <section class="grid gap-5 border-t border-line pt-6" aria-labelledby="shades-title">
    <div>
      <h3 id="shades-title" class="text-3xl">Shades &amp; tints</h3>
      <p class="mono">a 50–950 scale made in OKLCH; your color sits at {scale.shades[scale.anchor].step}. Click a swatch to copy it.</p>
    </div>
    <div class="scale">
      {#each scale.shades as s, i (s.step)}
        <button
          type="button"
          class="shade"
          class:light={readableInk(s.color) === 'black'}
          class:copied={copiedStep === s.step}
          style:--c={s.hex}
          aria-label="Copy {s.step}: {s[scaleValue]}"
          onclick={() => copyShade(s)}
        >
          <span class="chip">
            <span>{s.step}</span>
            {#if i === scale.anchor}<i class="you" title="Your color">●</i>{/if}
            <span class="done" aria-hidden="true">copied</span>
          </span>
          <span class="mono block truncate px-2 py-1.5 text-chalk!">{scaleValue === 'hex' ? s.hex : s.oklch.replace(/^oklch\(|\)$/g, '')}</span>
        </button>
      {/each}
    </div>
    <span class="sr-only" aria-live="polite">{copiedStep ? `Copied ${copiedStep}` : ''}</span>
    <div class="flex flex-wrap items-end gap-3">
      <div class="seg" role="group" aria-label="Value format">
        {#each scaleValues as [value, label]}
          <button type="button" aria-pressed={scaleValue === value} onclick={() => (scaleValue = value)}>{label}</button>
        {/each}
      </div>
      <div class="seg" role="group" aria-label="Export as">
        {#each scaleFormats as [value, label]}
          <button type="button" aria-pressed={scaleFormat === value} onclick={() => (scaleFormat = value)}>{label}</button>
        {/each}
      </div>
      {#if scaleFormat !== 'json'}
        <label class="w-36">
          <span class="sr-only">Variable name</span>
          <input class="field py-1.5! text-sm!" bind:value={scaleName} placeholder="brand" spellcheck="false" />
        </label>
      {/if}
      <CopyButton text={code} label="Copy code" class="ml-auto px-3! py-2! text-[13px]!" />
    </div>
    <pre class="code mono" aria-label="Scale code">{code}</pre>
  </section>

  <section class="grid gap-5 border-t border-line pt-6" aria-labelledby="contrast-title">
    <div>
      <h3 id="contrast-title" class="text-3xl">Contrast checker</h3>
      <p class="mono">your color as text on a background, checked with WCAG 2.2 and APCA</p>
    </div>
    <div class="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div class="grid min-w-0 content-start gap-4">
        <div class="flex flex-wrap items-end gap-2">
          <label class="min-w-0 flex-1">
            <span class="label">background</span>
            <input class="field mono-field" value={bgText} oninput={(e) => onBgText(e.currentTarget.value)} spellcheck="false" autocomplete="off" aria-invalid={bgInvalid} />
          </label>
          <label class="btn native icon" title="Pick the background color">
            <input type="color" value={toHex6(bg)} oninput={(e) => onBgText(e.currentTarget.value)} />
            <span class="dot" style:background={toHex6(bg)}></span>
            <span class="sr-only">Pick the background color</span>
          </label>
          <button type="button" class="btn" onclick={swap} title="Swap text and background">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4 3 8l4 4" /><path d="M3 8h14" /><path d="m17 20 4-4-4-4" /><path d="M21 16H7" /></svg>
            Swap
          </button>
        </div>
        {#if bgInvalid}<p class="mono text-bad -mt-2" aria-live="polite">Can't read that background color yet.</p>{/if}
        <div class="preview" style:background={toHex(pair.bg)}>
          <p class="font-serif text-5xl leading-none" style:color={toHex(pair.text)}>Aa</p>
          <p class="text-2xl font-semibold leading-tight" style:color={toHex(pair.text)}>Large text, 24px or 18.7px bold</p>
          <p class="text-base" style:color={toHex(pair.text)}>Normal body text at 16px. The quick brown fox jumps over the lazy dog.</p>
        </div>
      </div>

      <div class="grid min-w-0 content-start gap-4">
        <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <p class="font-serif text-6xl leading-none">{ratioText}<span class="text-muted">:1</span></p>
          <p class="mono">WCAG 2.2 contrast ratio</p>
        </div>
        <ul class="badges" aria-label="WCAG results">
          {#each checks as c (c.id)}
            <li class:pass={c.pass}>
              <span aria-hidden="true">{c.pass ? '✓' : '✕'}</span>
              <b>{c.label}</b> {c.detail}
              <span class="mono">{c.need}:1</span>
              <span class="sr-only">{c.pass ? 'passes' : 'fails'}</span>
            </li>
          {/each}
        </ul>
        <div class="apca">
          <p class="flex flex-wrap items-baseline gap-x-3"><span class="font-serif text-3xl">Lc {lc.toFixed(1)}</span><span class="mono">APCA</span></p>
          <p class="text-soft text-sm">{apcaUse(lc)}. APCA is proposed for WCAG 3 and shown for guidance; it isn't a legal requirement yet.</p>
        </div>
      </div>
    </div>
  </section>

  <section class="grid gap-5 border-t border-line pt-6" aria-labelledby="cvd-title">
    <div>
      <h3 id="cvd-title" class="text-3xl">Color blindness preview</h3>
      <p class="mono">roughly how your text and background look with each type, simulated at full strength</p>
    </div>
    <div class="cvd">
      {#each views as v (v.id)}
        <figure>
          <div class="pair" role="img" aria-label="{v.name}: text {toHex(v.text)} on {toHex(v.bg)}">
            <span style:background={toHex(v.text)}></span>
            <span class="font-serif text-4xl" style:background={toHex(v.bg)} style:color={toHex(v.text)}>Aa</span>
          </div>
          <figcaption class="grid px-3 py-2.5">
            <span class="text-sm">{v.name}</span>
            <span class="mono">{v.detail} · {toHex(v.text)}</span>
          </figcaption>
        </figure>
      {/each}
    </div>
  </section>
</div>

<style>
  .mono-field {
    font-family: var(--font-mono);
    font-size: 15px;
  }
  .square {
    position: relative;
    height: 220px;
    border-radius: 14px;
    border: 1px solid var(--color-line-2);
    background:
      linear-gradient(to top, #000, transparent),
      linear-gradient(to right, #fff, hsl(var(--hue) 100% 50%));
    cursor: crosshair;
    touch-action: none;
  }
  .thumb {
    position: absolute;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 3px solid #fff;
    box-shadow: 0 0 0 1px #0006, 0 4px 12px #0008;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
  .slider {
    width: 100%;
    height: 22px;
    appearance: none;
    background: transparent;
    cursor: pointer;
    --track: linear-gradient(to right, red, #ff0, lime, cyan, blue, #f0f, red);
    &::-webkit-slider-runnable-track {
      height: 14px;
      border-radius: 99px;
      border: 1px solid var(--color-line-2);
      background: var(--track);
    }
    &::-moz-range-track {
      height: 14px;
      border-radius: 99px;
      border: 1px solid var(--color-line-2);
      background: var(--track);
    }
    &::-webkit-slider-thumb {
      appearance: none;
      width: 20px;
      height: 20px;
      margin-top: -4px;
      border-radius: 50%;
      background: transparent;
      border: 3px solid #fff;
      box-shadow: 0 0 0 1px #0006, 0 2px 8px #0008;
    }
    &::-moz-range-thumb {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: transparent;
      border: 3px solid #fff;
      box-shadow: 0 0 0 1px #0006, 0 2px 8px #0008;
    }
    &.alpha {
      --track: linear-gradient(to right, transparent, var(--c)), repeating-conic-gradient(#2a2926 0 25%, #1f1e1b 0 50%) 0 0 / 12px 12px;
    }
  }
  .native {
    position: relative;
    overflow: hidden;
    & input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
    }
    &:focus-within {
      outline: 2px solid var(--color-sun);
      outline-offset: 2px;
    }
    &.icon {
      padding-inline: 12px;
    }
  }
  .dot {
    width: 20px;
    height: 20px;
    border-radius: 6px;
    border: 1px solid var(--color-line-2);
  }
  .hero {
    position: relative;
    display: grid;
    align-content: space-between;
    gap: 24px;
    min-height: 170px;
    padding: 22px;
    overflow: hidden;
    border-radius: 18px;
    border: 1px solid var(--color-line-2);
    color: #fff;
    background: repeating-conic-gradient(#2a2926 0 25%, #1f1e1b 0 50%) 0 0 / 20px 20px;
    &.light {
      color: #131211;
    }
    & .fill {
      position: absolute;
      inset: 0;
      transition: background 0.25s ease;
    }
  }
  .gamut {
    justify-self: start;
    padding: 4px 10px;
    border-radius: 8px;
    font: 400 12.5px var(--font-mono);
    background: #131211d9;
    color: var(--color-sun);
  }
  .row {
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 6px 6px 6px 12px;
    border: 1px solid var(--color-line);
    border-radius: 12px;
    background: #141312;
  }
  /* fixed counts so the 11 steps never leave a lone 950 on its own row */
  .scale {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    @media (min-width: 600px) {
      grid-template-columns: repeat(6, minmax(0, 1fr));
    }
    @media (min-width: 1024px) {
      grid-template-columns: repeat(11, minmax(0, 1fr));
      gap: 6px;
    }
  }
  .shade {
    display: grid;
    overflow: hidden;
    padding: 0;
    text-align: left;
    color: inherit;
    border-radius: 12px;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel-2);
    cursor: pointer;
    transition: transform 0.2s var(--ease-spring), border-color 0.2s;
    &:hover {
      transform: translateY(-3px);
      border-color: var(--color-muted);
    }
    & .chip {
      position: relative;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      height: 64px;
      padding: 8px 9px;
      background: var(--c);
      color: #fff;
      font: 500 13px var(--font-mono);
    }
    &.light .chip {
      color: #131211;
    }
    & .you {
      font-style: normal;
      font-size: 10px;
    }
    & .done {
      position: absolute;
      inset: auto 0 6px;
      text-align: center;
      font-size: 11.5px;
      opacity: 0;
      transform: translateY(4px);
      transition: opacity 0.2s, transform 0.25s var(--ease-spring);
    }
    &.copied .done {
      opacity: 1;
      transform: none;
    }
  }
  .code {
    margin: 0;
    max-height: 220px;
    overflow: auto;
    padding: 14px 16px;
    border-radius: 12px;
    border: 1px solid var(--color-line);
    background: #141312;
    color: var(--color-soft);
    white-space: pre;
  }
  .preview {
    display: grid;
    gap: 12px;
    padding: 24px;
    border-radius: 16px;
    border: 1px solid var(--color-line-2);
  }
  .badges {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 8px;
    & li {
      display: flex;
      align-items: baseline;
      gap: 8px;
      padding: 9px 12px;
      border-radius: 12px;
      border: 1px solid color-mix(in srgb, var(--color-bad) 40%, transparent);
      background: color-mix(in srgb, var(--color-bad) 8%, transparent);
      font-size: 14px;
      & > span:first-child {
        color: var(--color-bad);
      }
      & .mono {
        margin-left: auto;
      }
      &.pass {
        border-color: color-mix(in srgb, var(--color-ok) 40%, transparent);
        background: color-mix(in srgb, var(--color-ok) 8%, transparent);
        & > span:first-child {
          color: var(--color-ok);
        }
      }
    }
  }
  .apca {
    display: grid;
    gap: 4px;
    padding: 14px 16px;
    border-radius: 14px;
    border: 1px solid var(--color-line);
    background: #141312;
  }
  .cvd {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    @media (min-width: 640px) {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    & figure {
      margin: 0;
      overflow: hidden;
      border-radius: 14px;
      border: 1px solid var(--color-line-2);
      background: var(--color-panel-2);
    }
    & .pair {
      display: grid;
      grid-template-columns: 1fr 1.4fr;
      height: 96px;
      & span {
        display: grid;
        place-items: center;
        transition: background 0.25s ease, color 0.25s ease;
      }
    }
  }
</style>
