<script lang="ts">
  import CopyButton from '@/components/tool/CopyButton.svelte';

  const SETS = {
    lower: 'abcdefghijkmnopqrstuvwxyz',
    upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
    digits: '23456789',
    symbols: '!@#$%^&*()-_=+[]{};:,.?/',
  };
  const AMBIGUOUS = { lower: 'l', upper: 'IO', digits: '01' };

  let mode = $state<'password' | 'passphrase'>('password');
  let length = $state(20);
  let use = $state({ lower: true, upper: true, digits: true, symbols: true });
  let ambiguous = $state(false);
  let wordCount = $state(6);
  let separator = $state('-');
  let capitalize = $state(true);
  let addNumber = $state(true);
  let words = $state<string[] | null>(null);
  let value = $state('');

  /** unbiased random integer in [0, max) */
  function randInt(max: number) {
    const limit = Math.floor(0x1_0000_0000 / max) * max;
    const buf = new Uint32Array(1);
    do crypto.getRandomValues(buf);
    while (buf[0] >= limit);
    return buf[0] % max;
  }

  const pool = $derived(
    (Object.keys(SETS) as (keyof typeof SETS)[])
      .filter((k) => use[k])
      .map((k) => SETS[k] + (ambiguous && k in AMBIGUOUS ? AMBIGUOUS[k as keyof typeof AMBIGUOUS] : ''))
      .join(''),
  );

  const bits = $derived(
    mode === 'password'
      ? length * Math.log2(pool.length || 1)
      : wordCount * Math.log2(7776) + (addNumber ? Math.log2(100) : 0),
  );

  function generate() {
    if (mode === 'password') {
      if (!pool) return (value = '');
      // guarantee at least one character from each chosen set
      const chosen = (Object.keys(SETS) as (keyof typeof SETS)[]).filter((k) => use[k]);
      let out: string;
      do out = Array.from({ length }, () => pool[randInt(pool.length)]).join('');
      while (length >= chosen.length && !chosen.every((k) => [...SETS[k]].some((c) => out.includes(c))));
      value = out;
    } else {
      if (!words) return;
      const picked = Array.from({ length: wordCount }, () => {
        const w = words![randInt(words!.length)];
        return capitalize ? w[0].toUpperCase() + w.slice(1) : w;
      });
      if (addNumber) picked[randInt(picked.length)] += String(randInt(100));
      value = picked.join(separator);
    }
  }

  function crackTime(b: number) {
    // a well-funded offline attacker at 10 billion guesses per second, on average half the space
    const seconds = 2 ** (b - 1) / 1e10;
    const units: [number, string][] = [[3.15e16, 'billion years'], [3.15e13, 'million years'], [3.15e10, 'thousand years'], [3.15e7, 'years'], [86400, 'days'], [3600, 'hours'], [60, 'minutes'], [1, 'seconds']];
    for (const [s, name] of units) if (seconds >= s) return `${Math.round(seconds / s).toLocaleString()} ${name}`;
    return 'instantly';
  }

  const rating = $derived(bits < 50 ? ['weak', 'var(--color-bad)'] : bits < 75 ? ['ok', 'var(--color-sun)'] : bits < 100 ? ['strong', 'var(--color-ok)'] : ['excellent', 'var(--color-ok)']);

  $effect(() => {
    if (mode === 'passphrase' && !words) {
      import('eff-diceware-passphrase/wordlist.json').then((m) => {
        words = m.default as string[];
      });
    }
  });

  $effect(() => {
    // regenerate whenever an option changes
    mode; length; pool; wordCount; separator; capitalize; addNumber; words;
    generate();
  });
</script>

<div class="grid gap-5">
  <div class="seg" role="group" aria-label="Type">
    <button type="button" aria-pressed={mode === 'password'} onclick={() => (mode = 'password')}>password</button>
    <button type="button" aria-pressed={mode === 'passphrase'} onclick={() => (mode = 'passphrase')}>passphrase</button>
  </div>

  <div class="rounded-2xl border border-line-2 bg-[#141312] p-4">
    <output class="block font-mono text-[clamp(18px,2.6vw,26px)] break-all" aria-live="polite">{value || '…'}</output>
    <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-panel-2">
      <div class="h-full rounded-full transition-[width] duration-300" style={`width:${Math.min(100, bits)}%; background:${rating[1]}`}></div>
    </div>
    <p class="mono mt-2">{rating[0]} · {Math.round(bits)} bits · ~{crackTime(bits)} to crack offline</p>
  </div>

  <div class="flex flex-wrap gap-2">
    <button type="button" class="btn" onclick={generate}>↻ New</button>
    <CopyButton text={() => value} class="btn-primary" />
  </div>

  {#if mode === 'password'}
    <label>
      <span class="label">length · {length}</span>
      <input type="range" min="6" max="64" bind:value={length} class="w-full accent-(--color-sun)" />
    </label>
    <div class="flex flex-wrap gap-x-5 gap-y-2 text-sm">
      <label class="flex items-center gap-2"><input type="checkbox" bind:checked={use.lower} /> a–z</label>
      <label class="flex items-center gap-2"><input type="checkbox" bind:checked={use.upper} /> A–Z</label>
      <label class="flex items-center gap-2"><input type="checkbox" bind:checked={use.digits} /> 0–9</label>
      <label class="flex items-center gap-2"><input type="checkbox" bind:checked={use.symbols} /> !@#$</label>
      <label class="flex items-center gap-2"><input type="checkbox" bind:checked={ambiguous} /> allow look-alikes (l, I, O, 0, 1)</label>
    </div>
  {:else}
    <label>
      <span class="label">words · {wordCount}</span>
      <input type="range" min="3" max="10" bind:value={wordCount} class="w-full accent-(--color-sun)" />
    </label>
    <div class="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      <label class="flex items-center gap-2">separator
        <select class="field w-20! py-1.5!" bind:value={separator}>
          <option value="-">-</option><option value=".">.</option><option value="_">_</option><option value=" ">space</option><option value="">none</option>
        </select>
      </label>
      <label class="flex items-center gap-2"><input type="checkbox" bind:checked={capitalize} /> Capitalize</label>
      <label class="flex items-center gap-2"><input type="checkbox" bind:checked={addNumber} /> add a number</label>
    </div>
    <p class="mono">Words come from the EFF diceware list (7,776 words), picked with your browser's secure random generator.</p>
  {/if}
</div>
