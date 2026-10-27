<script lang="ts">
  import type { Row, YearRow } from '../lib/loan/amortize';

  let {
    rows,
    baseRows,
    years,
    principal,
    start,
    compact,
    money,
  }: {
    rows: Row[];
    /** schedule without extra payments, drawn for comparison */
    baseRows?: Row[];
    years: YearRow[];
    principal: number;
    start: string;
    compact: (x: number) => string;
    money: (x: number) => string;
  } = $props();

  const L = 58;
  const R = 10;
  const BAL_H = 170;
  const BAR_H = 150;
  const T = 10;
  const AXIS = 22;

  let width = $state(640);
  let hover = $state<number | null>(null);

  const y0 = $derived(Number(start.slice(0, 4)));
  const span = $derived(Number((baseRows ?? rows).at(-1)!.date.slice(0, 4)) - y0 + 1);
  const plotW = $derived(Math.max(100, width - L - R));
  const bw = $derived(plotW / span);

  /** x of a date, so the balance line lines up with its year's bar */
  function xOf(iso: string) {
    const y = Number(iso.slice(0, 4));
    const a = Date.UTC(y, 0, 1);
    return L + (y - y0 + (Date.parse(iso) - a) / (Date.UTC(y + 1, 0, 1) - a)) * bw;
  }

  const balY = (v: number) => T + (1 - v / principal) * (BAL_H - T - 6);
  const line = (rs: Row[]) => `M${xOf(start).toFixed(1)},${balY(principal).toFixed(1)}` + rs.map((r) => `L${xOf(r.date).toFixed(1)},${balY(r.balance).toFixed(1)}`).join('');
  const balLine = $derived(line(rows));
  const baseLine = $derived(baseRows ? line(baseRows) : '');
  const area = $derived(`${balLine}L${xOf(rows.at(-1)!.date).toFixed(1)},${balY(0)}L${xOf(start).toFixed(1)},${balY(0)}Z`);

  /** 0 and two round steps above, e.g. 0 / 5k / 10k */
  function ticks(max: number) {
    const raw = max / 2;
    const mag = 10 ** Math.floor(Math.log10(raw || 1));
    const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw)!;
    return [0, step, step * 2];
  }

  const barTicks = $derived(ticks(Math.max(1, ...years.map((y) => y.principal + y.interest))));
  const barMax = $derived(barTicks[2]);
  const barY = (v: number) => T + (1 - v / barMax) * (BAR_H - T - AXIS);
  const balTicks = $derived([0, principal / 2, principal]);

  // label every year, or every 2nd/5th/10th when bars get narrow
  const every = $derived([1, 2, 5, 10, 20].find((k) => k * bw >= 40) ?? 20);

  /** a bar with rounded top corners, square on the baseline */
  function bar(x: number, y: number, w: number, h: number) {
    const r = Math.min(4, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  const bars = $derived(
    years.map((y) => {
      const gap = bw > 6 ? Math.min(4, bw * 0.2) : 0.5;
      const x = L + (y.year - y0) * bw + gap / 2;
      const w = Math.max(1, bw - gap);
      const pTop = barY(y.principal);
      const iTop = barY(y.principal + y.interest);
      // 2px of surface between the two segments
      const iH = Math.max(0, pTop - iTop - (y.principal > 0 ? 2 : 0));
      return { y, x, w, pTop, iTop, iH };
    }),
  );

  const hovered = $derived(hover === null ? null : (years.find((y) => y.year === y0 + hover!) ?? null));

  function onMove(e: PointerEvent) {
    const box = (e.currentTarget as SVGElement).getBoundingClientRect();
    const i = Math.floor((e.clientX - box.left - L) / bw);
    hover = i >= 0 && i < span ? i : null;
  }

  function onKey(e: KeyboardEvent) {
    const at = hover ?? -1;
    const next: Record<string, number> = { ArrowRight: at + 1, ArrowUp: at + 1, ArrowLeft: at - 1, ArrowDown: at - 1, Home: 0, End: span - 1 };
    if (e.key in next) {
      e.preventDefault();
      hover = Math.min(span - 1, Math.max(0, next[e.key]));
    } else if (e.key === 'Escape') hover = null;
  }

  const tipX = $derived(hover === null ? 0 : Math.min(Math.max(L + (hover + 0.5) * bw, 90), width - 90));
</script>

<div
  class="chart relative"
  bind:clientWidth={width}
  tabindex="0"
  role="slider"
  aria-roledescription="chart"
  aria-valuemin={y0}
  aria-valuemax={y0 + span - 1}
  aria-valuenow={y0 + (hover ?? 0)}
  aria-valuetext={hovered ? `${hovered.year}: principal ${money(hovered.principal)}, interest ${money(hovered.interest)}, balance ${money(hovered.balance)}` : `${y0 + (hover ?? 0)}`}
  aria-label="Loan balance and yearly principal and interest by year"
  onkeydown={onKey}
  onblur={() => (hover = null)}
>
  <div class="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-soft">
    <span class="flex items-center gap-2"><i class="h-0.5 w-4 rounded bg-sun"></i>Balance</span>
    {#if baseRows}<span class="flex items-center gap-2"><i class="w-4 border-t-2 border-dashed border-muted"></i>Without extra payments</span>{/if}
    <span class="flex items-center gap-2"><i class="size-2.5 rounded-sm bg-[#3d8bd0]"></i>Principal</span>
    <span class="flex items-center gap-2"><i class="size-2.5 rounded-sm bg-[#d4762c]"></i>Interest</span>
  </div>

  <svg width={width} height={BAL_H + BAR_H} class="block touch-pan-y select-none" aria-hidden="true"
    onpointerdown={onMove}
    onpointermove={onMove}
    onpointerleave={(e) => {
      // a tap ends with pointerleave; keep its tooltip until the next tap
      if (e.pointerType !== 'touch') hover = null;
    }}>
    <defs>
      <linearGradient id="loan-fill" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#ffd25e" stop-opacity="0.22" />
        <stop offset="1" stop-color="#ffd25e" stop-opacity="0" />
      </linearGradient>
    </defs>

    <!-- balance -->
    {#each balTicks as t}
      <line x1={L} x2={L + plotW} y1={balY(t)} y2={balY(t)} class="grid" />
      <text x={L - 8} y={balY(t) + 4} text-anchor="end" class="tick">{compact(t)}</text>
    {/each}
    <path d={area} fill="url(#loan-fill)" />
    {#if baseLine}<path d={baseLine} fill="none" stroke="var(--color-muted)" stroke-width="1.5" stroke-dasharray="4 4" />{/if}
    <path d={balLine} fill="none" stroke="#ffd25e" stroke-width="2" stroke-linejoin="round" class="draw" pathLength="1" />

    <!-- yearly principal and interest -->
    <g transform={`translate(0 ${BAL_H})`}>
      {#each barTicks as t}
        <line x1={L} x2={L + plotW} y1={barY(t)} y2={barY(t)} class="grid" />
        <text x={L - 8} y={barY(t) + 4} text-anchor="end" class="tick">{compact(t)}</text>
      {/each}
      {#each bars as b (b.y.year)}
        <g class="bar" class:dim={hover !== null && b.y.year !== y0 + hover}>
          {#if b.y.interest > 0 && b.iH > 0}<path d={bar(b.x, b.iTop, b.w, b.iH)} fill="#d4762c" />{/if}
          {#if b.y.principal > 0}<path d={b.y.interest > 0 ? `M${b.x},${barY(0)}V${b.pTop}H${b.x + b.w}V${barY(0)}Z` : bar(b.x, b.pTop, b.w, barY(0) - b.pTop)} fill="#3d8bd0" />{/if}
        </g>
      {/each}
      {#each Array.from({ length: span }, (_, i) => i).filter((i) => (y0 + i) % every === 0 || span <= every) as i}
        <text x={L + (i + 0.5) * bw} y={BAR_H - 6} text-anchor="middle" class="tick">{y0 + i}</text>
      {/each}
    </g>

    {#if hover !== null}
      <line x1={L + (hover + 0.5) * bw} x2={L + (hover + 0.5) * bw} y1={T} y2={BAL_H + BAR_H - AXIS} class="guide" />
    {/if}
  </svg>

  {#if hover !== null}
    <div class="tip" style:left={`${tipX}px`} aria-hidden="true">
      <div class="mb-1 font-serif text-xl leading-none">{y0 + hover}</div>
      {#if hovered}
        <dl>
          <dt>Principal</dt><dd>{money(hovered.principal)}</dd>
          <dt>Interest</dt><dd>{money(hovered.interest)}</dd>
          {#if hovered.extra > 0}<dt>incl. extra</dt><dd>{money(hovered.extra)}</dd>{/if}
          <dt>Balance</dt><dd>{money(hovered.balance)}</dd>
        </dl>
      {:else}
        <p class="mono">paid off</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .chart {
    border-radius: 12px;
  }
  .grid {
    stroke: var(--color-line);
  }
  .guide {
    stroke: var(--color-soft);
    stroke-width: 1;
  }
  .tick {
    font: 11px var(--font-mono);
    fill: var(--color-muted);
  }
  .bar {
    transition: opacity 0.15s;
  }
  .bar.dim {
    opacity: 0.4;
  }
  .draw {
    stroke-dasharray: 1;
    animation: draw 0.9s cubic-bezier(0.3, 0.7, 0.4, 1) both;
  }
  @keyframes draw {
    from { stroke-dashoffset: 1; }
    to { stroke-dashoffset: 0; }
  }
  .tip {
    position: absolute;
    top: 40px;
    transform: translateX(-50%);
    min-width: 168px;
    padding: 10px 12px;
    border: 1px solid var(--color-line-2);
    border-radius: 12px;
    background: color-mix(in srgb, var(--color-panel-2) 94%, transparent);
    box-shadow: 0 10px 30px #0006;
    pointer-events: none;
  }
  .tip dl {
    display: grid;
    grid-template-columns: auto auto;
    gap: 2px 14px;
    margin: 0;
    font-size: 13px;
  }
  .tip dt {
    color: var(--color-muted);
  }
  .tip dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
