<script lang="ts">
  import { onMount } from 'svelte';
  import { downloadBlob } from '../lib/files';
  import { guessCurrency } from '../lib/loan/currency';
  import {
    ACCENTS, addDays, daysBetween, duplicateInvoice, emptyBusiness, invoiceFileName, newInvoice, newItem, parseStore, serializeStore, suggestNumber, uid,
    type Invoice, type Paper, type Template,
  } from '../lib/invoice-generator/invoice';
  import { computeTotals, currencyDigits, formatMoney, formatRate, parseScaled } from '../lib/invoice-generator/money';
  import { isBlankItem, layoutInvoice, type FontKey, type Formatters, type Measure } from '../lib/invoice-generator/layout';

  const KEY = 'rounder:invoice-generator';
  const SANS = 'Helvetica, Arial, sans-serif';
  const SERIF = "'Times New Roman', Times, serif";
  const COMMON = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'INR', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'BRL', 'MXN', 'ZAR', 'SGD', 'AED'];
  const ACCENT_NAMES = ['Navy', 'Teal', 'Violet', 'Amber', 'Rose', 'Ink'];
  const LETTER_REGIONS = ['US', 'CA', 'MX', 'PH', 'CL', 'CO'];

  let locale = $state('en-US');
  // placeholder until saved invoices load on mount
  const first = newInvoice(emptyBusiness(), { number: 'INV-0001', currency: 'USD', paper: 'letter' });
  let invoices = $state<Invoice[]>([first]);
  let currentId = $state(first.id);
  let loaded = $state(false);
  let storageNote = $state('');
  let confirmDelete = $state(false);
  let busy = $state(false);
  let done = $state(false);
  let error = $state('');
  let missing = $state<string[]>([]);
  let note = $state('');
  let allCurrencies = $state<string[]>(COMMON);
  let menuOpen = $state(false);
  let menu: HTMLDetailsElement;

  const inv = $derived(invoices.find((i) => i.id === currentId) ?? invoices[0]);

  /* ---------- formatting ---------- */
  const dateFmt = $derived(new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }));
  const numFmt = $derived(new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }));
  const money = (minor: number, currency = inv.currency) => formatMoney(minor, currency, locale);
  const fmtFor = (currency: string): Formatters => ({
    money: (n) => formatMoney(n, currency, locale),
    date: (iso) => {
      const t = Date.parse(`${iso}T00:00:00Z`);
      return Number.isNaN(t) ? '' : dateFmt.format(t);
    },
    // narrow no-break spaces (fr, ru…) become plain ones, which Helvetica can draw
    number: (n) => numFmt.format(n).replace(/\u202f/g, '\u00a0'),
  });

  const totalsOf = (i: Invoice) =>
    computeTotals({ items: i.items, digits: currencyDigits(i.currency), taxMode: i.taxMode, taxRate: i.taxRate, discountKind: i.discountKind, discount: i.discount, paid: i.paid, rounding: i.rounding });
  const totals = $derived(totalsOf(inv));

  const currencyName = $derived.by(() => {
    try {
      const names = new Intl.DisplayNames([locale], { type: 'currency' });
      return (code: string) => names.of(code) ?? code;
    } catch {
      return (code: string) => code;
    }
  });

  /* ---------- preview: laid out a moment after typing pauses ---------- */
  // rough widths until the browser can measure; replaced on mount
  let measure = $state<Measure>((s, size) => s.length * size * 0.52);
  let snap = $state.raw<Invoice>(structuredClone(first));
  let logoSize = $state<{ width: number; height: number } | null>(null);

  $effect(() => {
    const s = $state.snapshot(inv);
    const t = setTimeout(() => (snap = s), 120);
    return () => clearTimeout(t);
  });

  $effect(() => {
    const src = snap.from.logo;
    if (!src) {
      logoSize = null;
      return;
    }
    const img = new Image();
    img.onload = () => (logoSize = { width: img.naturalWidth, height: img.naturalHeight });
    img.src = src;
    // a logo replaced before this one loaded mustn't report its size
    return () => (img.onload = null);
  });

  const layout = $derived(layoutInvoice(snap, totalsOf(snap), fmtFor(snap.currency), measure, snap.from.logo ? logoSize : null, true));

  function canvasMeasure(): Measure {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return measure;
    const cache = new Map<string, number>();
    const family = (f: FontKey) => (f === 'serif' ? SERIF : SANS);
    return (s, size, font) => {
      const key = `${font}\u0000${s}`;
      let w = cache.get(key);
      if (w === undefined) {
        // measure big and scale, so small sizes don't pick up rounding
        ctx.font = `${font === 'bold' ? 700 : 400} 100px ${family(font)}`;
        w = ctx.measureText(s).width / 100;
        if (cache.size > 4000) cache.clear();
        cache.set(key, w);
      }
      return w * size;
    };
  }

  /* ---------- storage ---------- */
  onMount(() => {
    locale = navigator.language || 'en-US';
    measure = canvasMeasure();
    try {
      const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('currency');
      if (all?.length) allCurrencies = all;
    } catch {
      // older browsers: the common list is enough
    }
    const region = (() => {
      try {
        return new Intl.Locale(locale).maximize().region ?? '';
      } catch {
        return '';
      }
    })();
    const defaults = { currency: guessCurrency(locale), paper: (LETTER_REGIONS.includes(region) ? 'letter' : 'a4') as Paper };
    let saved = null;
    try {
      saved = parseStore(localStorage.getItem(KEY), defaults);
    } catch {
      // storage blocked: start fresh, nothing will be remembered
    }
    if (saved) {
      invoices = saved.invoices;
      currentId = saved.current;
    } else {
      invoices = [newInvoice(emptyBusiness(), { number: 'INV-0001', ...defaults })];
      currentId = invoices[0].id;
    }
    loaded = true;
  });

  $effect(() => {
    if (!loaded) return;
    const data = serializeStore({ business: inv.from, invoices, current: currentId });
    const t = setTimeout(() => {
      try {
        localStorage.setItem(KEY, data);
        storageNote = '';
      } catch {
        storageNote = "Your browser's storage is full or blocked, so changes aren't being saved. Export a backup, then delete old invoices or remove the logo.";
      }
    }, 400);
    return () => clearTimeout(t);
  });

  /* ---------- invoice actions ---------- */
  function flash(msg: string) {
    note = msg;
    setTimeout(() => note === msg && (note = ''), 2200);
  }

  function addInvoice(next: Invoice) {
    invoices.push(next);
    currentId = next.id;
    confirmDelete = false;
    error = '';
    missing = [];
  }

  function createNew() {
    const fresh = newInvoice($state.snapshot(inv.from), { number: suggestNumber(invoices), currency: inv.currency, paper: inv.paper, template: inv.template, accent: inv.accent });
    // business-wide settings carry over; the client and items start empty
    addInvoice({ ...fresh, taxMode: inv.taxMode, taxLabel: inv.taxLabel, taxRate: inv.taxRate, rounding: inv.rounding, notes: inv.notes, terms: inv.terms, payment: inv.payment });
    flash(`Started ${fresh.number}`);
  }

  function duplicate() {
    const copy = duplicateInvoice($state.snapshot(inv), suggestNumber(invoices));
    addInvoice(copy);
    flash(`Copied to ${copy.number}`);
  }

  function remove() {
    if (!confirmDelete) {
      confirmDelete = true;
      return;
    }
    const gone = inv.number || 'Invoice';
    const rest = invoices.filter((i) => i.id !== inv.id);
    if (!rest.length) rest.push(newInvoice($state.snapshot(inv.from), { number: suggestNumber(invoices), currency: inv.currency, paper: inv.paper }));
    invoices = rest;
    currentId = rest[rest.length - 1].id;
    confirmDelete = false;
    flash(`Deleted ${gone}`);
  }

  function exportJson(all: boolean) {
    menuOpen = false;
    const data = all ? serializeStore({ business: inv.from, invoices, current: currentId }, 2) : JSON.stringify({ v: 1, ...inv }, null, 2);
    const name = all ? `invoices-backup-${new Date().toISOString().slice(0, 10)}.json` : invoiceFileName(inv, 'json');
    downloadBlob(new Blob([data], { type: 'application/json' }), name);
  }

  async function importJson(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    menuOpen = false;
    if (!file) return;
    const parsed = parseStore(await file.text(), { currency: inv.currency, paper: inv.paper });
    if (!parsed) {
      error = "That file doesn't look like an invoice exported from this tool.";
      return;
    }
    const ids = new Set(invoices.map((i) => i.id));
    const added = parsed.invoices.map((i) => (ids.has(i.id) ? { ...i, id: uid() } : i));
    invoices.push(...added);
    currentId = added[0].id;
    error = '';
    flash(added.length === 1 ? `Imported ${added[0].number || 'invoice'}` : `Imported ${added.length} invoices`);
  }

  /* ---------- logo ---------- */
  let logoError = $state('');

  async function onLogo(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    logoError = '';
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const w = img.naturalWidth || 300;
      const h = img.naturalHeight || 150;
      // 3× the printed size is plenty sharp and keeps saved invoices small
      const s = Math.min(1, 600 / w, 240 / h);
      const canvas = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) });
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      inv.from.logo = canvas.toDataURL('image/png');
    } catch {
      logoError = "Couldn't read that image. Try a PNG, JPG, WebP or SVG.";
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /* ---------- PDF ---------- */
  async function download() {
    busy = true;
    error = '';
    missing = [];
    try {
      const { invoicePdf } = await import('../lib/invoice-generator/pdf');
      const data = $state.snapshot(inv);
      const logo = data.from.logo ? Uint8Array.from(atob(data.from.logo.slice(data.from.logo.indexOf(',') + 1)), (c) => c.charCodeAt(0)) : null;
      const res = await invoicePdf(data, totalsOf(data), fmtFor(data.currency), logo);
      downloadBlob(res.blob, invoiceFileName(data));
      missing = res.missing;
      done = true;
      setTimeout(() => (done = false), 1800);
    } catch (e) {
      error = (e as Error)?.name === 'PdfError' ? (e as Error).message : "Something went wrong while building the PDF. Please try again.";
    } finally {
      busy = false;
    }
  }

  /* ---------- small helpers for the form ---------- */
  const bad = (s: string) => s.trim() !== '' && parseScaled(s, 4) === null;
  const dueWindow = $derived(inv.due ? daysBetween(inv.issued, inv.due) : null);
  const terms: [number, string][] = [[0, 'on receipt'], [7, 'net 7'], [14, 'net 14'], [30, 'net 30'], [60, 'net 60']];
  const sorted = $derived([...invoices].sort((a, b) => b.created - a.created));
  const otherCurrencies = $derived(allCurrencies.filter((c) => !COMMON.includes(c)));
  const filledItems = $derived(inv.items.filter((it) => !isBlankItem(it)).length);
</script>

<svelte:window onpointerdown={(e) => menuOpen && !menu.contains(e.target as Node) && (menuOpen = false)} />

<div class="grid gap-6">
  <!-- invoice switcher and file actions -->
  <div class="bar card flex flex-wrap items-end gap-3 p-3 sm:p-4">
    <label class="min-w-[220px] flex-1">
      <span class="label">your invoices · saved on this device</span>
      <select class="field" bind:value={currentId} onchange={() => (confirmDelete = false)}>
        {#each sorted as i (i.id)}
          <option value={i.id}>{i.number || 'No number'} · {i.to.name || 'no client yet'} · {money(totalsOf(i).total, i.currency)}</option>
        {/each}
      </select>
    </label>
    <div class="flex flex-wrap gap-2">
      <button type="button" class="btn py-2.5! text-sm!" onclick={createNew}><span class="text-sun" aria-hidden="true">+</span> New</button>
      <button type="button" class="btn py-2.5! text-sm!" onclick={duplicate}>Duplicate</button>
      <button type="button" class="btn py-2.5! text-sm!" class:danger={confirmDelete} onclick={remove} onblur={() => (confirmDelete = false)}>{confirmDelete ? 'Really delete?' : 'Delete'}</button>
      <details class="more relative" bind:open={menuOpen} bind:this={menu}>
        <summary class="btn py-2.5! text-sm!">JSON</summary>
        <div class="menu card">
          <button type="button" onclick={() => exportJson(false)}>Export this invoice</button>
          <button type="button" onclick={() => exportJson(true)}>Back up all invoices</button>
          <label>Import from file…<input type="file" accept=".json,application/json" class="sr-only" onchange={importJson} /></label>
        </div>
      </details>
    </div>
    <p class="mono w-full min-h-[1.2em]" aria-live="polite">{note}</p>
  </div>
  {#if storageNote}<p class="text-bad -mt-3 text-sm" role="alert">{storageNote}</p>{/if}

  <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
    <!-- the form -->
    <div class="grid content-start gap-5">
      <fieldset class="sec">
        <legend>Look</legend>
        <div class="grid gap-4">
          <div class="flex flex-wrap gap-x-6 gap-y-4">
            <div>
              <span class="label">template</span>
              <div class="seg" role="group" aria-label="Template">
                {#each ['classic', 'modern', 'minimal'] as const as t}
                  <button type="button" aria-pressed={inv.template === t} onclick={() => (inv.template = t as Template)}>{t}</button>
                {/each}
              </div>
            </div>
            <div>
              <span class="label">paper</span>
              <div class="seg" role="group" aria-label="Paper size">
                {#each [['letter', 'US letter'], ['a4', 'A4']] as const as [p, l]}
                  <button type="button" aria-pressed={inv.paper === p} onclick={() => (inv.paper = p)}>{l}</button>
                {/each}
              </div>
            </div>
          </div>
          <div>
            <span class="label">accent color</span>
            <div class="flex flex-wrap items-center gap-2" role="group" aria-label="Accent color">
              {#each ACCENTS as c, i}
                <button type="button" class="swatch" style:--c={c} aria-pressed={inv.accent === c} aria-label={ACCENT_NAMES[i]} title={ACCENT_NAMES[i]} onclick={() => (inv.accent = c)}></button>
              {/each}
              <label class="custom" title="Custom color">
                <input type="color" bind:value={inv.accent} aria-label="Custom accent color" />
              </label>
            </div>
          </div>
          <label class="max-w-sm">
            <span class="label">currency</span>
            <select class="field" bind:value={inv.currency}>
              <optgroup label="Common">
                {#each COMMON as c}<option value={c}>{c} · {currencyName(c)}</option>{/each}
              </optgroup>
              {#if otherCurrencies.length}
                <optgroup label="All currencies">
                  {#each otherCurrencies as c}<option value={c}>{c} · {currencyName(c)}</option>{/each}
                </optgroup>
              {/if}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset class="sec">
        <legend>From</legend>
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="flex flex-wrap items-center gap-3 sm:col-span-2">
            {#if inv.from.logo}
              <img src={inv.from.logo} alt="Your logo" class="logo" />
              <label class="btn cursor-pointer py-2.5! text-sm!">Change logo<input type="file" accept="image/*" class="sr-only" onchange={onLogo} /></label>
              <button type="button" class="btn py-2.5! text-sm!" onclick={() => (inv.from.logo = '')}>Remove</button>
            {:else}
              <label class="btn cursor-pointer py-2.5! text-sm!"><span class="text-sun" aria-hidden="true">+</span> Add your logo<input type="file" accept="image/*" class="sr-only" onchange={onLogo} /></label>
              <span class="mono">PNG, JPG, WebP or SVG</span>
            {/if}
            {#if logoError}<p class="text-bad w-full text-sm" role="alert">{logoError}</p>{/if}
          </div>
          <label class="sm:col-span-2"><span class="label">business or your name</span><input class="field" bind:value={inv.from.name} autocomplete="organization" /></label>
          <label class="sm:col-span-2"><span class="label">address</span><textarea class="field area" rows="3" bind:value={inv.from.address}></textarea></label>
          <label><span class="label">email</span><input class="field" type="email" bind:value={inv.from.email} /></label>
          <label><span class="label">phone</span><input class="field" type="tel" bind:value={inv.from.phone} /></label>
          <label class="sm:col-span-2"><span class="label">tax ID (optional)</span><input class="field" bind:value={inv.from.taxId} placeholder="e.g. VAT GB123456789 or EIN 12-3456789" /></label>
        </div>
        <p class="mono mt-3">your details carry over to every new invoice</p>
      </fieldset>

      <fieldset class="sec">
        <legend>Bill to</legend>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="sm:col-span-2"><span class="label">client name</span><input class="field" bind:value={inv.to.name} /></label>
          <label class="sm:col-span-2"><span class="label">address</span><textarea class="field area" rows="3" bind:value={inv.to.address}></textarea></label>
          <label><span class="label">email</span><input class="field" type="email" bind:value={inv.to.email} /></label>
          <label><span class="label">phone</span><input class="field" type="tel" bind:value={inv.to.phone} /></label>
          <label class="sm:col-span-2"><span class="label">client tax ID (optional)</span><input class="field" bind:value={inv.to.taxId} /></label>
        </div>
      </fieldset>

      <fieldset class="sec">
        <legend>Details</legend>
        <div class="grid gap-3 sm:grid-cols-2">
          <label><span class="label">document title</span><input class="field" bind:value={inv.title} placeholder="Invoice" /></label>
          <label><span class="label">invoice number</span><input class="field" bind:value={inv.number} /></label>
          <label><span class="label">issue date</span><input class="field" type="date" bind:value={inv.issued} /></label>
          <label><span class="label">due date</span><input class="field" type="date" bind:value={inv.due} /></label>
          <div class="sm:col-span-2">
            <div class="seg" role="group" aria-label="Payment terms">
              {#each terms as [days, l]}
                <button type="button" aria-pressed={dueWindow === days} onclick={() => (inv.due = addDays(inv.issued, days))}>{l}</button>
              {/each}
            </div>
          </div>
          <label class="sm:col-span-2"><span class="label">PO number (optional)</span><input class="field" bind:value={inv.po} /></label>
        </div>
      </fieldset>

      <fieldset class="sec">
        <legend>Items</legend>
        <ol class="grid gap-3">
          {#each inv.items as it, i (it.id)}
            <li class="item">
              <label class="block">
                <span class="sr-only">Item {i + 1} description</span>
                <textarea class="field area desc" rows="1" bind:value={it.description} placeholder="Description of the work or product"></textarea>
              </label>
              <div class="nums" class:tax={inv.taxMode === 'line'}>
                <label class="q"><span class="label">qty</span><input class="field" inputmode="decimal" bind:value={it.qty} aria-invalid={bad(it.qty)} /></label>
                <label class="p"><span class="label">price</span><input class="field" inputmode="decimal" bind:value={it.price} placeholder="0.00" aria-invalid={bad(it.price)} /></label>
                {#if inv.taxMode === 'line'}
                  <label class="t"><span class="label">{inv.taxLabel || 'tax'} %</span><input class="field" inputmode="decimal" bind:value={it.tax} placeholder="0" aria-invalid={bad(it.tax)} /></label>
                {/if}
                <div class="amount">
                  <span class="label">amount</span>
                  <output class="block py-[11px] text-right tabular-nums">{money(totals.lines[i] ?? 0)}</output>
                </div>
                <button type="button" class="x" aria-label={`Remove item ${i + 1}`} title="Remove item" disabled={inv.items.length === 1} onclick={() => inv.items.splice(i, 1)}>
                  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
                </button>
              </div>
            </li>
          {/each}
        </ol>
        <button type="button" class="btn mt-3 w-full py-2.5! text-sm!" onclick={() => inv.items.push({ ...newItem(), tax: inv.items.at(-1)?.tax ?? '' })}><span class="text-sun" aria-hidden="true">+</span> Add item</button>

        <div class="mt-5 grid gap-4 border-t border-line pt-5">
          <div class="flex flex-wrap items-end gap-3">
            <div>
              <span class="label">tax</span>
              <div class="seg" role="group" aria-label="Tax">
                {#each [['none', 'none'], ['global', 'one rate'], ['line', 'per item']] as const as [m, l]}
                  <button type="button" aria-pressed={inv.taxMode === m} onclick={() => (inv.taxMode = m)}>{l}</button>
                {/each}
              </div>
            </div>
            {#if inv.taxMode !== 'none'}
              <label class="w-28"><span class="label">name</span><input class="field" bind:value={inv.taxLabel} placeholder="Tax, VAT, GST" /></label>
            {/if}
            {#if inv.taxMode === 'global'}
              <label class="w-24"><span class="label">rate %</span><input class="field" inputmode="decimal" bind:value={inv.taxRate} placeholder="0" aria-invalid={bad(inv.taxRate)} /></label>
            {/if}
          </div>
          {#if inv.taxMode !== 'none'}
            <div>
              <span class="label">round tax</span>
              <div class="seg" role="group" aria-label="Round tax">
                <button type="button" aria-pressed={inv.rounding === 'total'} onclick={() => (inv.rounding = 'total')}>on the total</button>
                <button type="button" aria-pressed={inv.rounding === 'line'} onclick={() => (inv.rounding = 'line')}>on each line</button>
              </div>
              <p class="mono mt-1.5">can change the tax by a cent or so; use whichever your tax office or accounting software expects</p>
            </div>
          {/if}
          <div class="flex flex-wrap items-end gap-3">
            <div>
              <span class="label">discount</span>
              <div class="seg" role="group" aria-label="Discount type">
                <button type="button" aria-pressed={inv.discountKind === 'percent'} onclick={() => (inv.discountKind = 'percent')}>%</button>
                <button type="button" aria-pressed={inv.discountKind === 'amount'} onclick={() => (inv.discountKind = 'amount')}>amount</button>
              </div>
            </div>
            <label class="w-28"><span class="sr-only">Discount value</span><input class="field" inputmode="decimal" bind:value={inv.discount} placeholder="0" aria-invalid={bad(inv.discount)} /></label>
            <label class="w-36"><span class="label">already paid</span><input class="field" inputmode="decimal" bind:value={inv.paid} placeholder="0.00" aria-invalid={bad(inv.paid)} /></label>
          </div>
        </div>

        <dl class="sum mt-5">
          <div><dt>Subtotal</dt><dd>{money(totals.subtotal)}</dd></div>
          {#if totals.discount}<div><dt>Discount</dt><dd>{money(-totals.discount)}</dd></div>{/if}
          {#each totals.taxes as t (t.rate)}<div><dt>{inv.taxLabel || 'Tax'} {formatRate(t.rate)}</dt><dd>{money(t.amount)}</dd></div>{/each}
          <div><dt>Total</dt><dd>{money(totals.total)}</dd></div>
          {#if totals.paid}<div><dt>Paid</dt><dd>{money(-totals.paid)}</dd></div>{/if}
          <div class="due"><dt>{totals.paid ? 'Balance due' : 'Amount due'}</dt><dd>{money(totals.due)}</dd></div>
        </dl>
      </fieldset>

      <fieldset class="sec">
        <legend>Notes &amp; payment</legend>
        <div class="grid gap-3">
          <label><span class="label">payment details</span><textarea class="field area" rows="3" bind:value={inv.payment} placeholder="Bank name, account number, IBAN / routing number, or a payment link"></textarea></label>
          <label><span class="label">notes</span><textarea class="field area" rows="2" bind:value={inv.notes}></textarea></label>
          <label><span class="label">terms</span><textarea class="field area" rows="2" bind:value={inv.terms} placeholder="e.g. Payment due within 30 days. Late payments may incur a fee."></textarea></label>
        </div>
      </fieldset>
    </div>

    <!-- live preview -->
    <div class="preview grid content-start gap-4 lg:sticky lg:top-4 lg:self-start">
      <div class="pages" aria-label="Invoice preview">
        {#each layout.pages as ops, p}
          <svg class="page" viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label={`Page ${p + 1} of ${layout.pages.length}`}>
            <rect width={layout.width} height={layout.height} fill="#fff" />
            {#each ops as op}
              {#if op.t === 'text'}
                <text x={op.x} y={op.y} font-size={op.size} font-family={op.font === 'serif' ? SERIF : SANS} font-weight={op.font === 'bold' ? 700 : 400} fill={op.color}>{op.text}</text>
              {:else if op.t === 'rect'}
                <rect x={op.x} y={op.y} width={op.w} height={op.h} fill={op.color} />
              {:else if op.t === 'line'}
                <line x1={op.x1} y1={op.y1} x2={op.x2} y2={op.y2} stroke={op.color} stroke-width={op.width} />
              {:else if snap.from.logo}
                <image href={snap.from.logo} x={op.x} y={op.y} width={op.w} height={op.h} preserveAspectRatio="none" />
              {/if}
            {/each}
          </svg>
        {/each}
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="mono">{filledItems} {filledItems === 1 ? 'item' : 'items'} · {layout.pages.length} {layout.pages.length === 1 ? 'page' : 'pages'} · vector PDF, no watermark</p>
      </div>
      <button type="button" class="btn btn-primary dl w-full" class:done disabled={busy} onclick={download}>
        {#if busy}Building PDF…{:else if done}<span class="tick" aria-hidden="true">✓</span> Downloaded{:else}Download PDF{/if}
      </button>
      {#if error}<p class="text-bad text-sm" role="alert">{error}</p>{/if}
      {#if missing.length}
        <p class="text-sm text-soft" role="status">
          These characters can't be drawn with the PDF's fonts and may show as boxes: <span class="mono text-chalk!">{missing.slice(0, 20).join(' ')}</span>.
          Latin, Greek and Cyrillic text is fully supported.
        </p>
      {/if}
    </div>
  </div>
</div>

<style>
  .sec {
    border: 1px solid var(--color-line-2);
    border-radius: 16px;
    background: var(--color-panel);
    padding: 16px 16px 18px;
    min-width: 0;
  }
  .sec legend {
    font: 400 22px/1 var(--font-serif);
    padding: 0 8px;
    margin-left: -6px;
  }
  .area {
    font-family: var(--font-sans);
    font-size: 15px;
    min-height: 0;
    resize: vertical;
  }
  .desc {
    field-sizing: content;
    min-height: 46px;
  }
  .field[aria-invalid='true'] {
    border-color: var(--color-bad);
  }
  .item {
    display: grid;
    gap: 8px;
    padding: 10px;
    border-radius: 14px;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line);
  }
  .nums {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr) minmax(0, 1fr) 36px;
    gap: 8px;
    align-items: end;
  }
  .nums.tax {
    grid-template-columns: 58px minmax(0, 1fr) 64px minmax(0, 1fr) 36px;
  }
  .item {
    container-type: inline-size;
  }
  /* phones: the amount and remove button drop to a second row so the inputs keep a usable width */
  @container (max-width: 400px) {
    .nums {
      grid-template-columns: 64px minmax(0, 1fr) 36px;
      grid-template-areas: 'q p p' 'a a x';
    }
    .nums.tax {
      grid-template-columns: 58px minmax(0, 1fr) 64px 36px;
      grid-template-areas: 'q p t t' 'a a a x';
    }
    .q { grid-area: q; }
    .p { grid-area: p; }
    .t { grid-area: t; }
    .amount { grid-area: a; }
    .x { grid-area: x; }
  }
  .amount output {
    color: var(--color-soft);
  }
  .x {
    display: grid;
    place-items: center;
    height: 46px;
    border-radius: 10px;
    border: 0;
    background: transparent;
    color: var(--color-muted);
    cursor: pointer;
  }
  .x:hover:not(:disabled) {
    color: var(--color-bad);
    background: var(--color-panel);
  }
  .x:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .swatch {
    width: 30px;
    height: 30px;
    border-radius: 999px;
    background: var(--c);
    border: 2px solid var(--color-panel);
    box-shadow: 0 0 0 1px var(--color-line-2);
    cursor: pointer;
    transition: transform 0.2s var(--ease-spring), box-shadow 0.2s;
  }
  .swatch[aria-pressed='true'] {
    box-shadow: 0 0 0 2px var(--color-sun);
    transform: scale(1.08);
  }
  .custom {
    position: relative;
    width: 30px;
    height: 30px;
    border-radius: 999px;
    background: conic-gradient(#ff7a6b, #ffd25e, #9be58f, #5fe0d0, #7cc4ff, #c8a6ff, #ff7a6b);
    box-shadow: 0 0 0 1px var(--color-line-2);
    overflow: hidden;
    cursor: pointer;
  }
  .custom:focus-within {
    outline: 2px solid var(--color-sun);
    outline-offset: 2px;
  }
  .custom input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .logo {
    max-height: 44px;
    max-width: 140px;
    padding: 4px 8px;
    border-radius: 8px;
    background: #fff;
  }
  .danger {
    border-color: var(--color-bad);
    color: var(--color-bad);
  }
  .more summary {
    list-style: none;
  }
  .more summary::-webkit-details-marker {
    display: none;
  }
  .menu {
    position: absolute;
    z-index: 20;
    right: 0;
    top: calc(100% + 6px);
    width: 220px;
    padding: 6px;
    display: grid;
    box-shadow: 0 18px 50px -12px #000c;
    animation: pop 0.18s var(--ease-spring);
    transform-origin: top right;
  }
  .menu button,
  .menu label {
    text-align: left;
    font-size: 14px;
    padding: 9px 10px;
    border-radius: 9px;
    border: 0;
    background: transparent;
    color: var(--color-chalk);
    cursor: pointer;
  }
  .menu button:hover,
  .menu label:hover,
  .menu label:focus-within {
    background: var(--color-panel-2);
  }
  .sum {
    display: grid;
    gap: 4px;
    font-size: 14px;
  }
  .sum div {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    color: var(--color-soft);
  }
  .sum dd {
    font-variant-numeric: tabular-nums;
    color: var(--color-chalk);
  }
  .sum .due {
    margin-top: 6px;
    padding-top: 10px;
    border-top: 1px solid var(--color-line-2);
    align-items: baseline;
  }
  .sum .due dt {
    color: var(--color-chalk);
  }
  .sum .due dd {
    font: 400 26px/1 var(--font-serif);
    color: var(--color-sun);
  }
  .pages {
    display: grid;
    gap: 14px;
    max-height: calc(100dvh - 190px);
    min-height: 260px;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 2px;
    border-radius: 6px;
  }
  .page {
    display: block;
    width: 100%;
    height: auto;
    border-radius: 4px;
    box-shadow: 0 1px 0 #ffffff14, 0 22px 50px -18px #000e;
  }
  .page text {
    white-space: pre;
  }
  @media (max-width: 1023px) {
    .pages {
      max-height: none;
    }
  }
  .dl.done {
    background: var(--color-ok);
    border-color: var(--color-ok);
  }
  .tick {
    display: inline-block;
    animation: tick 0.45s var(--ease-spring);
  }
  @keyframes tick {
    from {
      transform: scale(0.2) rotate(-30deg);
      opacity: 0;
    }
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(-4px) scale(0.98);
    }
  }
</style>
