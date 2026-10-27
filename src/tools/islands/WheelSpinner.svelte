<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { randBelow, shuffle } from '@/tools/lib/random/rng';
  import { indexAt, landingRotation, layout, parseEntries, pickWeighted, removeLine, sliceColors, spinEase, type Entry } from '@/tools/lib/random/wheel';

  interface SavedList {
    name: string;
    text: string;
  }

  // the category colors from global.css, ordered so neighbours contrast (canvas can't read CSS vars cheaply)
  const PALETTE = ['#ff6b4a', '#7cc4ff', '#ffd25e', '#c8a6ff', '#9be58f', '#ff8fb8', '#5fe0d0', '#ffa552', '#8fa2ff', '#f2e36b'];
  const INK = '#131211';
  const KEY = { text: 'rounder:wheel:text', lists: 'rounder:wheel:lists', sound: 'rounder:wheel:sound' };

  let text = $state('Ali\nBeatriz\nChen\nDario\nElif\nFemi\nGrace\nHiro');
  let sound = $state(true);
  let autoRemove = $state(false);
  let saved = $state<SavedList[]>([]);
  let listName = $state('');
  let spinning = $state(false);
  let winner = $state<Entry | null>(null);
  let under = $state('');
  let winners = $state<string[]>([]);
  let fullscreen = $state(false);
  let canFullscreen = $state(false);

  let stage = $state<HTMLDivElement>();
  let box = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();
  let burst = $state<HTMLCanvasElement>();
  let pointer = $state<HTMLDivElement>();
  let again = $state<HTMLButtonElement>();

  const entries = $derived(parseEntries(text));
  const segments = $derived(layout(entries.map((e) => e.weight)));
  const colors = $derived(sliceColors(entries.length, PALETTE.length));
  const weighted = $derived(entries.some((e) => e.weight !== 1));

  // rotation in turns, clockwise; animated outside Svelte's reactivity, straight onto the canvas
  let rotation = 0;
  let face: HTMLCanvasElement | undefined;
  let raf = 0;
  let confettiRaf = 0;
  let loaded = false;
  let audio: AudioContext | undefined;
  let lastClick = 0;

  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function store(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // private mode or storage full: the wheel still works, it just won't remember
    }
  }

  /** draws the static wheel once into an offscreen canvas; spinning only rotates this image */
  function drawFace() {
    if (!canvas?.clientWidth) return;
    const S = canvas.width;
    face ??= document.createElement('canvas');
    face.width = face.height = S;
    const ctx = face.getContext('2d')!;
    const dpr = S / Math.max(1, canvas.clientWidth);
    const r = S / 2;
    const rim = Math.max(8, S * 0.028);
    const R = r - rim;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.translate(r, r);

    ctx.beginPath();
    ctx.arc(0, 0, r - dpr, 0, Math.PI * 2);
    ctx.fillStyle = '#23211e';
    ctx.fill();
    ctx.lineWidth = dpr;
    ctx.strokeStyle = '#f2ede433';
    ctx.stroke();

    if (!entries.length) {
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.fillStyle = '#1a1917';
      ctx.fill();
    }

    const TAU = Math.PI * 2;
    segments.forEach((seg, i) => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R, seg.start * TAU - Math.PI / 2, seg.end * TAU - Math.PI / 2);
      ctx.closePath();
      ctx.fillStyle = PALETTE[colors[i]];
      ctx.fill();
      if (entries.length > 1 && (seg.end - seg.start) * TAU * R > 3 * dpr) {
        ctx.lineWidth = 1.5 * dpr;
        ctx.strokeStyle = '#13121159';
        ctx.stroke();
      }
    });

    // labels run along each slice's middle, right-aligned near the rim
    ctx.fillStyle = INK;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const maxW = R * 0.66;
    segments.forEach((seg, i) => {
      const span = (seg.end - seg.start) * TAU;
      const size = Math.min(R * 0.085, span * R * 0.5);
      if (size < 9 * dpr) return;
      ctx.save();
      ctx.rotate((seg.start + seg.end) * Math.PI - Math.PI / 2);
      ctx.font = `600 ${size}px 'Geist Variable', ui-sans-serif, system-ui, sans-serif`;
      let label = entries[i].label;
      if (ctx.measureText(label).width > maxW) {
        // by code point so emoji don't split; capped first so a pasted essay can't stall the loop
        const chars = Array.from(label).slice(0, 60);
        while (chars.length > 1 && ctx.measureText(`${chars.join('')}…`).width > maxW) chars.pop();
        label = `${chars.join('').trimEnd()}…`;
      }
      ctx.fillText(label, R - size * 0.9, 0);
      ctx.restore();
    });

    // a soft inner edge and the rim's little lights
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = '#00000040';
    ctx.stroke();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * (r - rim / 2), Math.sin(a) * (r - rim / 2), Math.max(1.5 * dpr, rim * 0.18), 0, TAU);
      ctx.fillStyle = i % 2 ? '#f2ede4cc' : '#ffd25ecc';
      ctx.fill();
    }
    ctx.restore();
  }

  function render() {
    if (!canvas || !face) return;
    const ctx = canvas.getContext('2d')!;
    const S = canvas.width;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(rotation * Math.PI * 2);
    ctx.drawImage(face, -S / 2, -S / 2);
    ctx.restore();
  }

  function resize() {
    if (!canvas || !box) return;
    const css = box.clientWidth;
    const px = Math.round(css * Math.min(devicePixelRatio || 1, 2));
    // a hidden container measures 0, and a 0-size wheel would draw arcs with negative radii
    if (px && canvas.width !== px) {
      canvas.width = canvas.height = px;
      drawFace();
      render();
    }
  }

  // redraw once typing pauses; a spin redraws immediately anyway
  $effect(() => {
    void [entries, segments, colors];
    const t = setTimeout(() => {
      drawFace();
      render();
    }, 120);
    return () => clearTimeout(t);
  });

  $effect(() => {
    const t = text;
    if (loaded) store(KEY.text, t);
  });

  onMount(() => {
    try {
      const t = localStorage.getItem(KEY.text);
      if (t !== null) text = t;
      const lists: unknown = JSON.parse(localStorage.getItem(KEY.lists) ?? '[]');
      if (Array.isArray(lists)) saved = lists.filter((l): l is SavedList => typeof l?.name === 'string' && typeof l?.text === 'string');
      sound = localStorage.getItem(KEY.sound) !== 'off';
    } catch {
      // unreadable storage: start fresh
    }
    loaded = true;
    canFullscreen = !!document.fullscreenEnabled;
    const ro = new ResizeObserver(resize);
    if (box) ro.observe(box);
    resize();
    // labels use Geist; draw again once it has loaded
    document.fonts?.ready.then(() => {
      drawFace();
      render();
    });
    const onFs = () => (fullscreen = document.fullscreenElement === stage);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      ro.disconnect();
      document.removeEventListener('fullscreenchange', onFs);
    };
  });

  onDestroy(() => {
    cancelAnimationFrame(raf);
    cancelAnimationFrame(confettiRaf);
    audio?.close();
  });

  function ensureAudio() {
    if (!sound) return;
    audio ??= new AudioContext();
    if (audio.state === 'suspended') audio.resume();
  }

  /** a short wooden tick as a peg passes the pointer */
  function click() {
    if (!sound || !audio) return;
    const now = performance.now();
    if (now - lastClick < 28) return;
    lastClick = now;
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1500, t);
    osc.frequency.exponentialRampToValueAtTime(420, t + 0.03);
    gain.gain.setValueAtTime(0.16, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  /** a little rising arpeggio for the winner */
  function chime() {
    if (!sound || !audio) return;
    [784, 988, 1319].forEach((f, i) => {
      const t = audio!.currentTime + i * 0.09;
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.14, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      osc.connect(gain).connect(audio!.destination);
      osc.start(t);
      osc.stop(t + 0.75);
    });
  }

  function setPointer(kick: number) {
    if (pointer) pointer.style.transform = `rotate(${-kick * 24}deg)`;
  }

  async function spin() {
    if (spinning || !entries.length) return;
    spinning = true;
    dismiss();
    await tick();
    if (!entries.length) return (spinning = false);
    ensureAudio();
    drawFace();

    // the winner is drawn first, fairly; the animation just travels there
    const segs = segments;
    const list = entries;
    const pick = pickWeighted(list.map((e) => e.weight));
    const fraction = 0.12 + randBelow(7601) / 10000;
    const calm = reduced();
    const from = rotation;
    const to = landingRotation(from, segs[pick], calm ? 1 : 5 + randBelow(3), fraction);
    const duration = calm ? 900 : 5200 + randBelow(1500);
    const start = performance.now();
    let at = indexAt(from, segs);
    let kick = 0;
    under = list[at].label;

    const frame = (now: number) => {
      const t = (now - start) / duration;
      rotation = from + (to - from) * spinEase(t);
      const i = indexAt(rotation, segs);
      if (i !== at) {
        at = i;
        under = list[i].label;
        kick = 1;
        click();
      }
      kick *= 0.78;
      setPointer(kick);
      render();
      if (t < 1) raf = requestAnimationFrame(frame);
      else land(list[pick]);
    };
    raf = requestAnimationFrame(frame);
  }

  async function land(entry: Entry) {
    rotation %= 1;
    setPointer(0);
    spinning = false;
    winner = entry;
    winners = [entry.label, ...winners].slice(0, 30);
    chime();
    confetti();
    await tick();
    again?.focus();
  }

  /** closes the result; with auto-remove on, the winner leaves the wheel now */
  function dismiss() {
    if (winner && autoRemove) removeWinner();
    winner = null;
  }

  function removeWinner() {
    if (!winner) return;
    const { line, label } = winner;
    // only remove if that line still holds the winner
    if (entries.some((e) => e.line === line && e.label === label)) text = removeLine(text, line);
    winner = null;
  }

  function confetti() {
    if (reduced() || !burst || !stage || !box) return;
    cancelAnimationFrame(confettiRaf);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const area = stage.getBoundingClientRect();
    const wheel = box.getBoundingClientRect();
    burst.width = area.width * dpr;
    burst.height = area.height * dpr;
    const ctx = burst.getContext('2d')!;
    const cx = (wheel.left - area.left + wheel.width / 2) * dpr;
    const cy = (wheel.top - area.top + wheel.height / 2) * dpr;
    // cosmetic only, so plain Math.random is fine here
    const bits = Array.from({ length: 150 }, () => {
      const a = Math.random() * Math.PI * 2;
      const v = (6 + Math.random() * 12) * dpr;
      return {
        x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 6 * dpr,
        r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
        w: (5 + Math.random() * 6) * dpr, h: (3 + Math.random() * 4) * dpr,
        c: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      };
    });
    const start = performance.now();
    const step = (now: number) => {
      const life = (now - start) / 2600;
      ctx.clearRect(0, 0, burst!.width, burst!.height);
      if (life >= 1) return;
      ctx.globalAlpha = 1 - life ** 3;
      for (const b of bits) {
        b.vx *= 0.975;
        b.vy = b.vy * 0.975 + 0.35 * dpr;
        b.x += b.vx;
        b.y += b.vy;
        b.r += b.vr;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.r);
        ctx.fillStyle = b.c;
        // flutter: squash the height as the piece turns
        ctx.fillRect(-b.w / 2, (-b.h / 2) * Math.cos(b.r * 3), b.w, b.h * Math.cos(b.r * 3));
        ctx.restore();
      }
      confettiRaf = requestAnimationFrame(step);
    };
    confettiRaf = requestAnimationFrame(step);
  }

  function lines() {
    return text.split(/\r?\n/).filter((l) => l.trim());
  }

  function shuffleList() {
    dismiss();
    text = shuffle(lines()).join('\n');
  }

  function sortList() {
    dismiss();
    text = lines().sort((a, b) => a.trim().localeCompare(b.trim(), undefined, { numeric: true, sensitivity: 'base' })).join('\n');
  }

  function saveList(e: Event) {
    e.preventDefault();
    if (!entries.length) return;
    const name = listName.trim() || `List ${saved.length + 1}`;
    saved = [{ name, text }, ...saved.filter((l) => l.name !== name)];
    store(KEY.lists, JSON.stringify(saved));
    listName = '';
  }

  function loadList(l: SavedList) {
    if (spinning) return;
    winner = null;
    text = l.text;
  }

  function deleteList(name: string) {
    saved = saved.filter((l) => l.name !== name);
    store(KEY.lists, JSON.stringify(saved));
  }

  function toggleSound() {
    sound = !sound;
    store(KEY.sound, sound ? 'on' : 'off');
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else stage?.requestFullscreen().catch(() => {});
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && winner) dismiss();
  }
</script>

<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="stage" bind:this={stage} class:fullscreen onkeydown={onKey}>
    <div class="flex w-full items-center justify-end gap-2">
      <button type="button" class="icon-btn" onclick={toggleSound} aria-pressed={sound} aria-label="Sound" title={sound ? 'Sound on' : 'Sound off'}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" />{#if sound}<path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" fill="none" />{:else}<path d="m17 9 5 6m0-6-5 6" fill="none" />{/if}</svg>
      </button>
      {#if canFullscreen}
        <button type="button" class="icon-btn" onclick={toggleFullscreen} aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} title={fullscreen ? 'Exit full screen' : 'Full screen'}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {#if fullscreen}<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" />{:else}<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" />{/if}
          </svg>
        </button>
      {/if}
    </div>

    <div class="wheel" bind:this={box}>
      <canvas bind:this={canvas} onclick={spin} aria-hidden="true" class:cursor-pointer={!spinning && entries.length > 0}></canvas>
      <div class="pointer" bind:this={pointer} aria-hidden="true">
        <svg viewBox="0 0 40 52"><path d="M20 50 4 14a16 16 0 1 1 32 0L20 50Z" /><circle cx="20" cy="16" r="5" /></svg>
      </div>
      <button type="button" class="hub" onclick={spin} disabled={!entries.length} aria-disabled={spinning}>
        {spinning ? '…' : 'spin'}
      </button>

      {#if !entries.length}
        <p class="empty mono">add a few names to fill the wheel</p>
      {/if}

      {#if winner}
        <div class="result" role="dialog" aria-modal="false" aria-labelledby="wheel-winner">
          <div class="card-pop">
            <span class="label">the wheel says</span>
            <p id="wheel-winner" class="name font-serif">{winner.label}</p>
            <div class="mt-4 flex flex-wrap justify-center gap-2">
              <button type="button" class="btn btn-primary" bind:this={again} onclick={spin}>Spin again</button>
              {#if !autoRemove}<button type="button" class="btn" onclick={removeWinner}>Remove</button>{/if}
              <button type="button" class="btn" onclick={dismiss} aria-label="Close">Close</button>
            </div>
          </div>
        </div>
      {/if}
    </div>

    <p class="mono h-5 text-center" aria-hidden="true">{spinning ? under : ''}</p>
    <p class="sr-only" aria-live="assertive">{winner ? `The winner is ${winner.label}` : ''}</p>
    <canvas class="burst" bind:this={burst} aria-hidden="true"></canvas>
  </div>

  <div class="grid min-w-0 content-start gap-5">
    <label>
      <span class="label">entries · one per line · {entries.length}{weighted ? ' · weighted' : ''}</span>
      <textarea class="field min-h-[220px]! font-sans!" bind:value={text} readonly={spinning} spellcheck="false" placeholder={'Alice\nBob *2\nCara'}></textarea>
    </label>
    <p class="mono -mt-3">add <span class="text-soft">*2</span> after a name to double its chance</p>

    <div class="flex flex-wrap gap-2">
      <button type="button" class="btn" onclick={shuffleList} disabled={spinning || entries.length < 2}>Shuffle</button>
      <button type="button" class="btn" onclick={sortList} disabled={spinning || entries.length < 2}>Sort A–Z</button>
    </div>
    <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={autoRemove} class="accent-(--color-sun)" /> remove each winner from the wheel</label>

    <div class="grid gap-2 border-t border-line pt-5">
      <span class="label mb-0!">saved lists</span>
      <form class="flex gap-2" onsubmit={saveList}>
        <input class="field min-w-0 flex-1 py-2!" bind:value={listName} placeholder="name this list" aria-label="List name" maxlength="60" />
        <button type="submit" class="btn py-2!" disabled={!entries.length}>Save</button>
      </form>
      {#if saved.length}
        <ul class="flex flex-wrap gap-1.5">
          {#each saved as l (l.name)}
            <li class="saved">
              <button type="button" class="load" onclick={() => loadList(l)} disabled={spinning} title={`Load ${l.name}`}>{l.name} <span class="text-muted">· {parseEntries(l.text).length}</span></button>
              <button type="button" class="del" onclick={() => deleteList(l.name)} aria-label={`Delete ${l.name}`}>×</button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="mono">Lists are kept in this browser only.</p>
      {/if}
    </div>

    {#if winners.length}
      <div class="grid gap-2 border-t border-line pt-5">
        <div class="flex items-baseline justify-between">
          <span class="label mb-0!">winners so far</span>
          <button type="button" class="link" onclick={() => (winners = [])}>clear</button>
        </div>
        <ol class="grid gap-1">
          {#each winners as w, i (i)}
            <li class="flex gap-3 text-sm"><span class="mono w-6 shrink-0 text-right">{winners.length - i}</span><span class="min-w-0 break-words">{w}</span></li>
          {/each}
        </ol>
      </div>
    {/if}
  </div>
</div>

<style>
  .stage {
    position: relative;
    display: grid;
    justify-items: center;
    align-content: start;
    gap: 10px;
    min-width: 0;
  }
  .stage.fullscreen {
    align-content: center;
    padding: 24px;
    background: var(--color-bg);
  }
  .wheel {
    position: relative;
    width: min(100%, 560px);
    aspect-ratio: 1;
  }
  .fullscreen .wheel {
    width: min(86vh, 92vw);
  }
  .wheel canvas {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    filter: drop-shadow(0 18px 30px #0008);
  }
  .burst {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 3;
  }
  .pointer {
    position: absolute;
    top: -14px;
    left: 50%;
    width: 34px;
    margin-left: -17px;
    /* pivot on the pointer's round head */
    transform-origin: 50% 31%;
    z-index: 1;
    filter: drop-shadow(0 3px 4px #0009);
    & svg {
      display: block;
      width: 100%;
    }
    & path {
      fill: var(--color-chalk);
    }
    & circle {
      fill: var(--color-bg);
    }
  }
  .hub {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 21%;
    aspect-ratio: 1;
    translate: -50% -50%;
    border-radius: 50%;
    border: 3px solid var(--color-chalk);
    background: var(--color-bg);
    color: var(--color-chalk);
    font: 600 clamp(12px, 2.4vw, 17px) var(--font-mono);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    cursor: pointer;
    box-shadow: 0 6px 18px #000a, inset 0 0 0 4px #ffd25e33;
    transition: transform 0.25s var(--ease-spring), color 0.2s;
    &:hover:not(:disabled) {
      color: var(--color-sun);
      transform: scale(1.06);
    }
    &:active:not(:disabled) {
      transform: scale(0.94);
    }
    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }
  .empty {
    position: absolute;
    inset: auto 0 18%;
    text-align: center;
    pointer-events: none;
  }
  .result {
    position: absolute;
    inset: 8%;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: radial-gradient(circle, #131211f2 55%, #131211cc);
    backdrop-filter: blur(3px);
    text-align: center;
    padding: 8%;
    z-index: 2;
    animation: fade 0.25s ease-out;
  }
  .card-pop {
    animation: rise 0.5s var(--ease-spring);
    & :global(.btn) {
      padding: 9px 14px;
      font-size: 14px;
    }
  }
  .name {
    font-size: clamp(32px, 6vw, 60px);
    line-height: 1.05;
    color: var(--color-sun);
    overflow-wrap: anywhere;
    max-height: 3.3em;
    overflow: hidden;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes rise {
    from {
      transform: scale(0.6);
      opacity: 0;
    }
  }
  .icon-btn {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 10px;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel-2);
    color: var(--color-soft);
    cursor: pointer;
    transition: border-color 0.2s, color 0.2s;
    &:hover {
      border-color: var(--color-muted);
      color: var(--color-chalk);
    }
    & svg {
      width: 18px;
      height: 18px;
      fill: currentColor;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    &[aria-pressed='false'] {
      color: var(--color-muted);
    }
  }
  .saved {
    display: inline-flex;
    border: 1px solid var(--color-line-2);
    border-radius: 999px;
    overflow: hidden;
    & button {
      background: transparent;
      border: 0;
      color: var(--color-soft);
      font: 400 12.5px var(--font-mono);
      cursor: pointer;
      padding: 5px 8px;
      &:hover:not(:disabled) {
        color: var(--color-sun);
      }
    }
    & .load {
      padding-left: 12px;
    }
    & .del {
      padding-right: 11px;
      border-left: 1px solid var(--color-line);
    }
  }
  .link {
    font: 400 12.5px var(--font-mono);
    color: var(--color-sun);
    background: none;
    border: 0;
    cursor: pointer;
  }
</style>
