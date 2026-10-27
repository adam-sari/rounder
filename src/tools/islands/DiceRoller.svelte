<script lang="ts">
  import { onDestroy } from 'svelte';
  import { addDie, countDice, diceRange, formatDice, parseDice, rollDice, STANDARD_DICE, type RollResult, type Term } from '@/tools/lib/random/dice';
  import { randBelow } from '@/tools/lib/random/rng';

  interface ShownDie {
    sides: number;
    value: number;
    kept: boolean;
    negative: boolean;
    /** extra turns the die tumbles through before landing */
    sx: number;
    sy: number;
  }
  interface Past {
    id: number;
    notation: string;
    total: number;
    detail: string;
  }

  const ANIMATED = 36;
  const COINS_ANIMATED = 12;

  // d6 is a cube: rotation that brings each face to the front (opposite faces add up to 7)
  const FACE: Record<number, [number, number]> = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180] };
  const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  const COLOR: Record<number, string> = {
    4: 'var(--color-video)', 6: 'var(--color-sun)', 8: 'var(--color-image)', 10: 'var(--color-ai)',
    12: 'var(--color-text)', 20: 'var(--color-pdf)', 100: 'var(--color-dev)',
  };
  const color = (sides: number) => COLOR[sides] ?? 'var(--color-everyday)';

  // silhouettes in a 100 × 100 box: outline, facet lines, and where the number sits
  const SHAPES: Record<string, { outline: string; facets: string; y: number }> = {
    4: { outline: '50,6 95,88 5,88', facets: 'M50 6 L50 62 M5 88 L50 62 L95 88', y: 75 },
    6: { outline: '12,12 88,12 88,88 12,88', facets: '', y: 52 },
    8: { outline: '50,3 94,50 50,97 6,50', facets: 'M50 3 L22 66 L78 66 Z', y: 56 },
    10: { outline: '50,4 95,46 50,96 5,46', facets: 'M5 46 L50 64 L95 46 M50 64 L50 96', y: 46 },
    12: { outline: '50,4 95,37 78,93 22,93 5,37', facets: 'M50 24 L74 42 L65 72 L35 72 L26 42 Z', y: 54 },
    20: { outline: '50,3 93,27 93,73 50,97 7,73 7,27', facets: 'M50 22 L81 72 L19 72 Z M50 3 L50 22 M93 73 L81 72 M7 73 L19 72', y: 58 },
  };
  const shape = (sides: number) => SHAPES[sides === 100 ? 10 : sides] ?? SHAPES[20];

  const presets: [string, string][] = [
    ['d20', 'd20'], ['2d6', '2d6'], ['d20 + 5', 'd20+5'], ['advantage', '2d20kh1'],
    ['disadvantage', '2d20kl1'], ['4d6 drop lowest', '4d6kh3'], ['d100', 'd100'], ['8d6', '8d6'],
  ];

  let mode = $state<'dice' | 'coin'>('dice');

  // dice
  let notation = $state('d20');
  let result = $state.raw<RollResult | null>(null);
  let shown = $state.raw<ShownDie[]>([]);
  let rollId = $state(0);
  let tumbling = $state(false);
  let tick = $state(0);
  let history = $state<Past[]>([]);
  let announce = $state('');

  // coins
  let coinCount = $state<number | null>(1);
  let coins = $state.raw<boolean[]>([]);
  let coinId = $state(0);
  let flipping = $state(false);
  let session = $state({ heads: 0, tails: 0 });
  let streak = $state<boolean[]>([]);

  const parsed = $derived.by((): { terms: Term[] | null; error: string } => {
    if (!notation.trim()) return { terms: null, error: '' };
    try {
      return { terms: parseDice(notation), error: '' };
    } catch (e) {
      return { terms: null, error: (e as Error).message };
    }
  });
  const counts = $derived(countDice(parsed.terms ?? []));
  const range = $derived(parsed.terms ? diceRange(parsed.terms) : null);

  let flicker: ReturnType<typeof setInterval> | undefined;
  let rollTimer: ReturnType<typeof setTimeout> | undefined;
  let flipTimer: ReturnType<typeof setTimeout> | undefined;
  // settles the roll or flip still in the air, so a quick second click still logs the first
  let landRoll: (() => void) | null = null;
  let landFlip: (() => void) | null = null;
  onDestroy(() => {
    clearInterval(flicker);
    clearTimeout(rollTimer);
    clearTimeout(flipTimer);
  });

  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const turns = () => (1 + randBelow(2)) * 360 * (randBelow(2) ? 1 : -1);

  function add(sides: number) {
    notation = formatDice(addDie(parsed.terms ?? [], sides));
  }

  /** "[6, 4, (1)] +2", dropped dice in brackets */
  function describe(r: RollResult) {
    return r.terms
      .map((t) => (t.term.type === 'mod' ? `${t.term.sign < 0 ? '−' : '+'}${t.term.value}` : `${t.term.sign < 0 ? '−' : ''}[${t.dice.map((d) => (d.kept ? d.value : `(${d.value})`)).join(', ')}]`))
      .join(' ');
  }

  function roll(e?: Event) {
    e?.preventDefault();
    const terms = parsed.terms;
    if (!terms) return;
    landRoll?.();
    const r = rollDice(terms);
    result = r;
    shown = r.terms.flatMap((t) => t.dice.map((d) => ({ ...d, negative: t.term.sign < 0, sx: turns(), sy: turns() })));
    const id = ++rollId;
    announce = '';
    const land = (landRoll = () => {
      landRoll = null;
      clearTimeout(rollTimer);
      clearInterval(flicker);
      tumbling = false;
      announce = `${r.notation}: total ${r.total}`;
      history = [{ id, notation: r.notation, total: r.total, detail: describe(r) }, ...history].slice(0, 40);
    });
    if (reduced() || shown.length > ANIMATED) return land();
    tumbling = true;
    flicker = setInterval(() => tick++, 70);
    rollTimer = setTimeout(land, 900 + Math.min(shown.length, 12) * 25);
  }

  function preset(n: string) {
    notation = n;
    roll();
  }

  // a cosmetic blur of faces while the dice tumble; the real values are already decided
  const face = (d: ShownDie, i: number) => (tumbling ? ((d.value + tick * (i + 2)) % d.sides) + 1 : d.value);

  /** the natural result of a lone d20, for the classic crit callout */
  const natural = $derived.by(() => {
    if (!result || tumbling) return 0;
    const kept = result.terms.flatMap((t) => t.dice.filter((d) => d.kept && d.sides === 20));
    return kept.length === 1 ? kept[0].value : 0;
  });

  function flip(e?: Event) {
    e?.preventDefault();
    landFlip?.();
    const n = Math.min(100, Math.max(1, Math.floor(coinCount ?? 1)));
    const next = Array.from({ length: n }, () => randBelow(2) === 0);
    coins = next;
    coinId++;
    flipping = true;
    const land = (landFlip = () => {
      landFlip = null;
      clearTimeout(flipTimer);
      flipping = false;
      const heads = next.filter(Boolean).length;
      session = { heads: session.heads + heads, tails: session.tails + n - heads };
      streak = [...next, ...streak].slice(0, 60);
    });
    if (reduced() || n > COINS_ANIMATED) return land();
    flipTimer = setTimeout(land, 1150);
  }

  const coinHeads = $derived(coins.filter(Boolean).length);
  const sessionTotal = $derived(session.heads + session.tails);
</script>

{#snippet poly(sides: number, value: number | string, big: boolean)}
  {@const s = shape(sides)}
  <svg viewBox="0 0 100 100" class="block h-full w-full overflow-visible" aria-hidden="true">
    {#if sides === 6}
      <rect x="10" y="10" width="80" height="80" rx="16" fill={color(sides)} />
    {:else}
      <polygon points={s.outline} fill={color(sides)} stroke={color(sides)} stroke-width="6" stroke-linejoin="round" />
    {/if}
    {#if s.facets}<path d={s.facets} fill="none" stroke="#131211" stroke-opacity="0.22" stroke-width="2.5" stroke-linejoin="round" />{/if}
    {#if big}
      <text x="50" y={s.y} text-anchor="middle" dominant-baseline="central" class="face-num" font-size={String(value).length > 2 ? 26 : sides === 4 ? 30 : 36}>{value}</text>
    {/if}
  </svg>
{/snippet}

{#snippet cube(d: ShownDie)}
  {@const [rx, ry] = FACE[d.value]}
  <div class="cube" style={`--rx:${rx}deg;--ry:${ry}deg;--sx:${d.sx}deg;--sy:${d.sy}deg`}>
    {#each [1, 2, 3, 4, 5, 6] as f}
      <div class={`side s${f}`}>
        {#each Array.from({ length: 9 }, (_, i) => i) as cell}
          <span class:pip={PIPS[f].includes(cell)}></span>
        {/each}
      </div>
    {/each}
  </div>
{/snippet}

{#snippet sun()}
  <svg viewBox="0 0 40 40" class="h-[46%] w-[46%]" aria-hidden="true">
    <circle cx="20" cy="20" r="7" fill="currentColor" />
    {#each Array.from({ length: 8 }, (_, i) => i * 45) as a}
      <rect x="18.6" y="2" width="2.8" height="7" rx="1.4" fill="currentColor" transform={`rotate(${a} 20 20)`} />
    {/each}
  </svg>
{/snippet}

{#snippet moon()}
  <svg viewBox="0 0 40 40" class="h-[46%] w-[46%]" aria-hidden="true">
    <path d="M26 6a15 15 0 1 0 8 26A12 12 0 0 1 26 6Z" fill="currentColor" />
  </svg>
{/snippet}

<div class="grid gap-6">
  <div class="seg justify-self-start" role="group" aria-label="Mode">
    <button type="button" aria-pressed={mode === 'dice'} onclick={() => (mode = 'dice')}>dice</button>
    <button type="button" aria-pressed={mode === 'coin'} onclick={() => (mode = 'coin')}>coin flip</button>
  </div>

  {#if mode === 'dice'}
    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_250px]">
      <div class="grid min-w-0 content-start gap-5">
        <div class="grid grid-cols-4 gap-2 sm:grid-cols-7" role="group" aria-label="Add a die">
          {#each STANDARD_DICE as sides}
            <button type="button" class="die-btn" onclick={() => add(sides)} aria-label={`Add a d${sides}${counts[sides] ? `, ${counts[sides]} in the roll` : ''}`}>
              <span class="h-9 w-9">{@render poly(sides, '', false)}</span>
              <span class="mono text-chalk!">d{sides}</span>
              {#if counts[sides]}<span class="badge">{counts[sides]}</span>{/if}
            </button>
          {/each}
        </div>

        <form class="grid gap-2" onsubmit={roll}>
          <label for="dice-notation" class="label mb-0!">dice notation</label>
          <div class="flex gap-2">
            <input id="dice-notation" class="field min-w-0 flex-1 font-mono!" bind:value={notation} placeholder="2d6+3" autocomplete="off" spellcheck="false" aria-invalid={!!parsed.error} aria-describedby="dice-hint" />
            <button type="submit" class="btn btn-primary" disabled={!parsed.terms}>Roll</button>
            <button type="button" class="btn" onclick={() => (notation = '')} disabled={!notation}>Clear</button>
          </div>
          <p id="dice-hint" class={['mono', parsed.error && 'text-bad!']} role={parsed.error ? 'alert' : undefined}>
            {#if parsed.error}{parsed.error}{:else if range}totals from {range.min} to {range.max}{:else}tap the dice above, or type something like 4d6kh3{/if}
          </p>
        </form>

        <div class="flex flex-wrap gap-1.5" role="group" aria-label="Quick rolls">
          {#each presets as [label, n]}
            <button type="button" class="chip" onclick={() => preset(n)} title={n}>{label}</button>
          {/each}
        </div>

        <div class="tray" role="region" aria-label="Dice tray">
          {#if !result}
            <div class="grid place-items-center gap-3 py-10 text-center">
              <div class="flex items-end gap-3 opacity-60" aria-hidden="true">
                <span class="h-10 w-10 -rotate-12">{@render poly(20, 20, true)}</span>
                <span class="h-8 w-8 rotate-6">{@render poly(6, '', false)}</span>
                <span class="h-9 w-9 rotate-12">{@render poly(8, 8, true)}</span>
              </div>
              <p class="mono">press roll and the dice land here</p>
            </div>
          {:else}
            {#key rollId}
              {#if shown.length <= ANIMATED}
                <div class="flex flex-wrap justify-center gap-x-4 gap-y-5 py-4">
                  {#each shown as d, i}
                    <div class="die" class:dropped={!d.kept} style={`--i:${Math.min(i, 12)};--c:${color(d.sides)}`} title={d.kept ? `d${d.sides}: ${d.value}` : `d${d.sides}: ${d.value} (dropped)`}>
                      <div class="toss">
                        {#if d.sides === 6}
                          <div class="d6">{@render cube(d)}</div>
                        {:else}
                          <div class="poly" style={`--sx:${d.sx}deg`}>{@render poly(d.sides, face(d, i), true)}</div>
                        {/if}
                      </div>
                      <span class="shadow"></span>
                      {#if d.negative}<span class="neg mono" aria-hidden="true">−</span>{/if}
                    </div>
                  {/each}
                </div>
              {:else}
                <ul class="flex max-h-[260px] flex-wrap justify-center gap-1.5 overflow-auto py-2" aria-label="Dice results">
                  {#each shown as d}
                    <li class="mini" class:dropped={!d.kept} style={`--c:${color(d.sides)}`}>{d.negative ? '−' : ''}{d.value}</li>
                  {/each}
                </ul>
              {/if}
            {/key}

            <div class="mt-2 grid justify-items-center gap-1 text-center" class:invisible={tumbling}>
              {#key rollId}
                <output class="total font-serif" class:pop={!tumbling}>{result.total}</output>
              {/key}
              {#if natural === 20}<p class="crit">Natural 20!</p>{:else if natural === 1}<p class="crit fail">Natural 1</p>{/if}
              <p class="mono max-w-full break-words">
                {#each result.terms as t, i}
                  {#if i > 0 || t.term.sign < 0}<span>{t.term.sign < 0 ? ' − ' : ' + '}</span>{/if}
                  {#if t.term.type === 'mod'}{t.term.value}{:else}
                    <span class="text-soft">{formatDice([{ ...t.term, sign: 1 }])}</span>
                    [{#each t.dice as d, j}{#if j > 0}, {/if}<span class:line-through={!d.kept} class:opacity-50={!d.kept}>{d.value}</span>{/each}]
                  {/if}
                {/each}
              </p>
            </div>
          {/if}
          <p class="sr-only" aria-live="polite">{announce}</p>
        </div>
      </div>

      <aside class="grid min-w-0 content-start gap-2">
        <div class="flex items-baseline justify-between">
          <span class="label mb-0!">history</span>
          {#if history.length}<button type="button" class="link" onclick={() => (history = [])}>clear</button>{/if}
        </div>
        {#if history.length}
          <ol class="grid max-h-[520px] gap-1.5 overflow-auto pr-1">
            {#each history as h (h.id)}
              <li>
                <button type="button" class="past" onclick={() => preset(h.notation)} title={`Roll ${h.notation} again`}>
                  <span class="font-serif text-2xl leading-none text-chalk">{h.total}</span>
                  <span class="min-w-0">
                    <span class="mono block truncate text-soft!">{h.notation}</span>
                    <span class="mono block truncate text-[11px]!">{h.detail}</span>
                  </span>
                </button>
              </li>
            {/each}
          </ol>
        {:else}
          <p class="mono rounded-xl border border-dashed border-line-2 p-4">Your rolls will stack up here. Tap one to roll it again.</p>
        {/if}
      </aside>
    </div>
  {:else}
    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_250px]">
      <div class="grid min-w-0 content-start gap-5">
        <form class="flex flex-wrap items-end gap-3" onsubmit={flip}>
          <label class="w-32"><span class="label">coins</span><input class="field" type="number" min="1" max="100" bind:value={coinCount} /></label>
          <button type="submit" class="btn btn-primary">Flip</button>
        </form>

        <div class="tray" role="region" aria-label="Coin tray">
          {#if !coins.length}
            <div class="grid place-items-center gap-3 py-10 text-center">
              <div class="coin-face heads h-16 w-16 opacity-60" aria-hidden="true">{@render sun()}</div>
              <p class="mono">heads is the sun, tails is the moon</p>
            </div>
          {:else}
            {#key coinId}
              {#if coins.length <= COINS_ANIMATED}
                <div class="flex flex-wrap justify-center gap-5 py-4">
                  {#each coins as heads, i}
                    <div class="coin-wrap" style={`--i:${i}`}>
                      <div class="coin" style={`--end:${heads ? 0 : 180}deg`}>
                        <div class="coin-face heads">{@render sun()}</div>
                        <div class="coin-face tails">{@render moon()}</div>
                      </div>
                      <span class="shadow"></span>
                      <span class="mono mt-2 block text-center" class:invisible={flipping}>{heads ? 'heads' : 'tails'}</span>
                    </div>
                  {/each}
                </div>
              {:else}
                <ul class="flex flex-wrap justify-center gap-1.5 py-2" aria-label="Coin results">
                  {#each coins as heads}
                    <li class="mini" style={`--c:${heads ? 'var(--color-sun)' : 'var(--color-soft)'}`}>{heads ? 'H' : 'T'}</li>
                  {/each}
                </ul>
              {/if}
            {/key}
            <div class="grid justify-items-center gap-1 text-center" class:invisible={flipping}>
              {#if coins.length === 1}
                <output class="total font-serif pop">{coins[0] ? 'Heads' : 'Tails'}</output>
              {:else}
                <output class="total font-serif pop">{coinHeads}<span class="text-muted"> : </span>{coins.length - coinHeads}</output>
                <p class="mono">{coinHeads} heads · {coins.length - coinHeads} tails</p>
              {/if}
            </div>
          {/if}
          <p class="sr-only" aria-live="polite">{flipping || !coins.length ? '' : coins.length === 1 ? (coins[0] ? 'Heads' : 'Tails') : `${coinHeads} heads, ${coins.length - coinHeads} tails`}</p>
        </div>
      </div>

      <aside class="grid min-w-0 content-start gap-3">
        <div class="flex items-baseline justify-between">
          <span class="label mb-0!">this session</span>
          {#if sessionTotal}<button type="button" class="link" onclick={() => { session = { heads: 0, tails: 0 }; streak = []; }}>reset</button>{/if}
        </div>
        {#if sessionTotal}
          <div class="grid gap-2">
            <div class="flex h-2 overflow-hidden rounded-full bg-panel-2" aria-hidden="true">
              <div class="bg-sun transition-[width] duration-500" style={`width:${(session.heads / sessionTotal) * 100}%`}></div>
              <div class="flex-1 bg-soft/50"></div>
            </div>
            <p class="mono">{session.heads} heads · {session.tails} tails · {Math.round((session.heads / sessionTotal) * 100)}% heads</p>
          </div>
          <div class="flex flex-wrap gap-1" aria-label="Latest flips, newest first">
            {#each streak as h, i (i)}
              <span class="dot" class:h title={h ? 'heads' : 'tails'}>{h ? 'H' : 'T'}</span>
            {/each}
          </div>
        {:else}
          <p class="mono rounded-xl border border-dashed border-line-2 p-4">Flips are tallied here so you can watch the split even out.</p>
        {/if}
      </aside>
    </div>
  {/if}
</div>

<style>
  .die-btn {
    position: relative;
    display: grid;
    justify-items: center;
    gap: 6px;
    padding: 12px 4px 10px;
    border-radius: 14px;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel-2);
    cursor: pointer;
    transition: transform 0.2s var(--ease-spring), border-color 0.2s;
    &:hover {
      border-color: var(--color-muted);
      transform: translateY(-2px);
    }
    &:active {
      transform: scale(0.95);
    }
  }
  .badge {
    position: absolute;
    top: 6px;
    right: 6px;
    min-width: 20px;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--color-sun);
    color: var(--color-bg);
    font: 600 11.5px/18px var(--font-mono);
    animation: pop 0.3s var(--ease-spring);
  }
  .chip {
    font: 400 12.5px var(--font-mono);
    color: var(--color-soft);
    background: transparent;
    border: 1px solid var(--color-line-2);
    border-radius: 999px;
    padding: 5px 12px;
    cursor: pointer;
    transition: border-color 0.2s, color 0.2s;
    &:hover {
      border-color: var(--color-sun);
      color: var(--color-sun);
    }
  }
  .link {
    font: 400 12.5px var(--font-mono);
    color: var(--color-sun);
    background: none;
    border: 0;
    cursor: pointer;
  }
  .tray {
    display: grid;
    gap: 8px;
    min-height: 300px;
    align-content: center;
    padding: 20px 16px;
    border-radius: 18px;
    border: 1px solid var(--color-line-2);
    background: radial-gradient(120% 90% at 50% 30%, #1d1c19, #141312 70%);
    overflow: hidden;
  }
  .face-num {
    font-family: var(--font-sans);
    font-weight: 700;
    fill: #131211;
    font-variant-numeric: tabular-nums;
  }

  /* one die: a toss arc, a spin, and a shadow that shrinks while it's airborne */
  .die {
    position: relative;
    display: grid;
    justify-items: center;
    width: 64px;
    transition: opacity 0.3s;
  }
  .die.dropped {
    opacity: 0.32;
  }
  .toss {
    width: 64px;
    height: 64px;
    animation: toss 0.85s cubic-bezier(0.3, 0.7, 0.4, 1) both;
    animation-delay: calc(var(--i) * 25ms);
  }
  .shadow {
    display: block;
    width: 44px;
    height: 8px;
    margin-top: 6px;
    border-radius: 50%;
    background: #000;
    opacity: 0.45;
    filter: blur(3px);
    animation: shadow 0.85s cubic-bezier(0.3, 0.7, 0.4, 1) both;
    animation-delay: calc(var(--i) * 25ms);
  }
  .neg {
    position: absolute;
    top: -6px;
    left: -2px;
    color: var(--color-bad) !important;
    font-size: 16px;
  }
  .poly {
    width: 100%;
    height: 100%;
    animation: spin 0.85s cubic-bezier(0.2, 0.8, 0.3, 1) both;
    animation-delay: calc(var(--i) * 25ms);
  }
  @keyframes toss {
    0% {
      transform: translateY(-46px) scale(0.7);
      opacity: 0;
    }
    15% {
      opacity: 1;
    }
    55% {
      transform: translateY(0) scale(1);
    }
    72% {
      transform: translateY(-9px);
    }
    100% {
      transform: none;
    }
  }
  @keyframes shadow {
    0% {
      transform: scale(0.4);
      opacity: 0;
    }
    55% {
      transform: scale(1);
      opacity: 0.45;
    }
    72% {
      transform: scale(0.8);
    }
  }
  @keyframes spin {
    from {
      transform: rotate(var(--sx));
    }
  }

  /* d6: a real cube, tumbling to the rolled face */
  .d6 {
    width: 64px;
    height: 64px;
    perspective: 400px;
    transform: rotateX(-16deg) rotateY(20deg);
    transform-style: preserve-3d;
    padding: 8px;
  }
  .cube {
    --h: 24px;
    position: relative;
    width: 48px;
    height: 48px;
    transform-style: preserve-3d;
    transform: rotateX(var(--rx)) rotateY(var(--ry));
    animation: tumble 0.85s cubic-bezier(0.2, 0.8, 0.3, 1) both;
    animation-delay: calc(var(--i) * 25ms);
  }
  @keyframes tumble {
    from {
      transform: rotateX(calc(var(--rx) + var(--sx))) rotateY(calc(var(--ry) + var(--sy)));
    }
  }
  .side {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template: repeat(3, 1fr) / repeat(3, 1fr);
    place-items: center;
    padding: 6px;
    border-radius: 10px;
    background: var(--color-sun);
    box-shadow: inset 0 0 0 1px #13121126, inset 0 -6px 10px #13121118;
    backface-visibility: hidden;
  }
  .side span {
    width: 8px;
    height: 8px;
  }
  .side .pip {
    border-radius: 50%;
    background: #131211;
  }
  .s1 { transform: translateZ(var(--h)); }
  .s6 { transform: rotateY(180deg) translateZ(var(--h)); }
  .s2 { transform: rotateY(90deg) translateZ(var(--h)); }
  .s5 { transform: rotateY(-90deg) translateZ(var(--h)); }
  .s3 { transform: rotateX(90deg) translateZ(var(--h)); }
  .s4 { transform: rotateX(-90deg) translateZ(var(--h)); }

  .mini {
    min-width: 34px;
    padding: 4px 8px;
    border-radius: 8px;
    text-align: center;
    font: 600 13px var(--font-mono);
    color: #131211;
    background: var(--c);
    &.dropped {
      opacity: 0.3;
      text-decoration: line-through;
    }
  }

  .total {
    font-size: clamp(56px, 10vw, 96px);
    line-height: 1;
    color: var(--color-sun);
    font-variant-numeric: tabular-nums;
  }
  .pop {
    animation: pop 0.45s var(--ease-spring);
  }
  @keyframes pop {
    from {
      transform: scale(0.7);
      opacity: 0;
    }
  }
  .crit {
    font: 600 13px var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-ok);
    animation: pop 0.45s var(--ease-spring);
    &.fail {
      color: var(--color-bad);
    }
  }

  .past {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 10px;
    text-align: left;
    border-radius: 12px;
    border: 1px solid var(--color-line);
    background: var(--color-panel-2);
    cursor: pointer;
    animation: slide 0.3s ease-out;
    &:hover {
      border-color: var(--color-line-2);
    }
  }
  @keyframes slide {
    from {
      transform: translateY(-6px);
      opacity: 0;
    }
  }

  /* coins: sun on one side, moon on the other, flipped end over end */
  .coin-wrap {
    display: grid;
    justify-items: center;
    perspective: 500px;
  }
  .coin {
    position: relative;
    width: 76px;
    height: 76px;
    transform-style: preserve-3d;
    transform: rotateX(var(--end));
    animation: flip 1.1s cubic-bezier(0.25, 0.7, 0.35, 1) both;
    animation-delay: calc(var(--i) * 40ms);
  }
  @keyframes flip {
    0% {
      transform: translateY(0) rotateX(calc(var(--end) + 1800deg)) scale(0.9);
    }
    40% {
      transform: translateY(-70px) rotateX(calc(var(--end) + 900deg)) scale(1.12);
    }
    80% {
      transform: translateY(0) rotateX(calc(var(--end) + 40deg)) scale(1);
    }
    100% {
      transform: rotateX(var(--end));
    }
  }
  .coin-wrap .shadow {
    width: 60px;
    animation: shadow 1.1s ease both;
    animation-delay: calc(var(--i) * 40ms);
  }
  .coin-face {
    display: grid;
    place-items: center;
    border-radius: 50%;
    backface-visibility: hidden;
  }
  .coin .coin-face {
    position: absolute;
    inset: 0;
  }
  .heads {
    color: #7a5200;
    background: radial-gradient(circle at 35% 30%, #ffe7a3, var(--color-sun) 55%, #e0a93a);
    box-shadow: inset 0 0 0 4px #e0a93a, inset 0 0 0 6px #ffe7a3aa;
  }
  .tails {
    color: #4a4740;
    background: radial-gradient(circle at 35% 30%, #fffaf0, var(--color-soft) 55%, #8f897e);
    box-shadow: inset 0 0 0 4px #8f897e, inset 0 0 0 6px #fffaf0aa;
    transform: rotateX(180deg);
  }
  .dot {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    font: 600 10px var(--font-mono);
    color: #131211;
    background: var(--color-soft);
    &.h {
      background: var(--color-sun);
    }
  }
</style>
