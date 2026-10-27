<script lang="ts">
  import { guessesInWords, passwordChecks } from '@/tools/lib/password-strength/checks';
  import { pwnedCount, sha1Hex } from '@/tools/lib/password-strength/hibp';
  import { loadZxcvbn, SCORE_COLORS, SCORE_LABELS, type ZxcvbnResult } from '@/tools/lib/password-strength/zxcvbn';

  const SCENARIOS = [
    ['onlineThrottlingXPerHour', 'Online, rate-limited', '100 guesses an hour, like a login page with lockouts'],
    ['onlineNoThrottlingXPerSecond', 'Online, no rate limit', '10 guesses a second against an unprotected login'],
    ['offlineSlowHashingXPerSecond', 'Offline, slow hash', '10,000 a second against a leaked bcrypt or Argon2 database'],
    ['offlineFastHashingXPerSecond', 'Offline, fast hash', '10 billion a second against leaked MD5 or SHA-1 hashes on GPUs'],
  ] as const;

  let password = $state('');
  let visible = $state(false);
  let result = $state<ZxcvbnResult | null>(null);
  let loadError = $state('');
  let prefix = $state('');
  let breach = $state<{ state: 'idle' | 'checking' | 'error' } | { state: 'done'; count: number }>({ state: 'idle' });
  let breachMessage = $state('');
  let controller: AbortController | undefined;

  const checks = $derived(passwordChecks(password));
  const score = $derived<number>(password && result ? result.score : -1);

  // zxcvbn and its dictionaries load the first time someone focuses the field
  const warm = () => loadZxcvbn().catch(() => (loadError = 'Couldn\'t load the strength checker. Check your connection and refresh the page.'));

  $effect(() => {
    const pw = password;
    controller?.abort();
    breach = { state: 'idle' };
    if (!pw) {
      result = null;
      prefix = '';
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const [check, hash] = await Promise.all([loadZxcvbn(), sha1Hex(pw)]);
        if (pw !== password) return;
        result = check(pw);
        prefix = hash.slice(0, 5);
        loadError = '';
      } catch {
        loadError = 'Couldn\'t load the strength checker. Check your connection and refresh the page.';
      }
    }, 120);
    return () => clearTimeout(timer);
  });

  async function checkBreaches() {
    const pw = password;
    controller = new AbortController();
    breach = { state: 'checking' };
    try {
      const count = await pwnedCount(pw, controller.signal);
      if (pw === password) breach = { state: 'done', count };
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      // fetch rejects with a TypeError when the request never got an answer
      breachMessage = !navigator.onLine
        ? 'You seem to be offline, so the breach check can\'t run.'
        : err instanceof TypeError
          ? 'Couldn\'t reach the breach check service. Try again in a moment.'
          : (err as Error).message;
      breach = { state: 'error' };
    }
  }
</script>

<div class="grid gap-5">
  <label class="block">
    <span class="label">password to test</span>
    <span class="relative block">
      <input
        class="field pr-24! font-mono text-lg!"
        type={visible ? 'text' : 'password'}
        bind:value={password}
        onfocus={warm}
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        data-1p-ignore
        data-lpignore="true"
        placeholder="Type or paste a password"
      />
      <button
        type="button"
        class="mono absolute top-1/2 right-2 -translate-y-1/2 rounded-lg px-3 py-1.5 hover:text-chalk"
        aria-pressed={visible}
        aria-label="Show password"
        onclick={() => (visible = !visible)}>{visible ? 'hide' : 'show'}</button
      >
    </span>
    <span class="mono mt-2 block text-ok">● checked on your device · nothing you type is sent anywhere</span>
  </label>

  <section class="rounded-2xl border border-line-2 bg-[#141312] p-4 sm:p-5" aria-label="Strength">
    <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <p class="font-serif text-[clamp(30px,5vw,42px)] leading-none" style:color={score >= 0 ? SCORE_COLORS[score] : 'var(--color-muted)'} aria-live="polite">
        {score >= 0 ? SCORE_LABELS[score] : password ? 'Checking…' : 'Waiting for a password'}
      </p>
      {#if result && password}
        <p class="mono">{guessesInWords(result.guessesLog10)}</p>
      {/if}
    </div>
    <div class="meter mt-4" role="meter" aria-label="Password strength" aria-valuemin={0} aria-valuemax={4} aria-valuenow={Math.max(0, score)} aria-valuetext={score >= 0 ? SCORE_LABELS[score] : 'no password'}>
      {#each [0, 1, 2, 3, 4] as i}
        <span class:on={i <= score} style:--c={score >= 0 ? SCORE_COLORS[score] : ''} style:--d={`${i * 40}ms`}></span>
      {/each}
    </div>
    {#if loadError}
      <p class="mt-3 text-sm text-bad" role="alert">{loadError}</p>
    {/if}
    {#if result?.feedback.warning && password}
      <p class="mt-4 text-sm text-sun">⚠ {result.feedback.warning}</p>
    {/if}
    {#if result?.feedback.suggestions.length && password}
      <ul class="mt-2 grid gap-1 text-sm text-soft">
        {#each result.feedback.suggestions as tip}<li>→ {tip}</li>{/each}
      </ul>
    {/if}
  </section>

  <div class="grid gap-5 md:grid-cols-[1.25fr_1fr]">
    <section aria-labelledby="crack-heading">
      <h2 id="crack-heading" class="label">time to crack</h2>
      <ul class="grid gap-2">
        {#each SCENARIOS as [key, name, detail]}
          <li class="grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl border border-line-2 px-3 py-2.5">
            <span class="min-w-0">
              <span class="block text-sm">{name}</span>
              <span class="mono block text-[11.5px]!">{detail}</span>
            </span>
            <span class="text-right font-mono text-sm {result && password && result.crackTimes[key].seconds < 86400 * 30 ? 'text-bad' : 'text-chalk'}">
              {result && password ? result.crackTimes[key].display : '–'}
            </span>
          </li>
        {/each}
      </ul>
    </section>

    <section aria-labelledby="checks-heading">
      <h2 id="checks-heading" class="label">checklist</h2>
      <ul class="grid gap-1.5 text-sm">
        {#each checks as c}
          <li class="flex items-center gap-2.5 {password && c.pass ? 'text-chalk' : 'text-muted'}">
            <span class="tick" class:pass={password && c.pass} aria-hidden="true">{password && c.pass ? '✓' : ''}</span>
            {c.label}<span class="sr-only">: {password && c.pass ? 'yes' : 'no'}</span>
          </li>
        {/each}
      </ul>
      <p class="mono mt-3">Length and unpredictability matter far more than symbols. A long phrase of random words beats a short jumble.</p>
    </section>
  </div>

  <section class="rounded-2xl border border-line-2 p-4 sm:p-5" aria-labelledby="breach-heading">
    <h2 id="breach-heading" class="font-serif text-2xl">Has it leaked in a data breach?</h2>
    <p class="mt-1 text-sm text-soft">
      Optional. This asks <a class="underline decoration-line-2 underline-offset-2 hover:decoration-sun" href="https://haveibeenpwned.com/Passwords" target="_blank" rel="noopener">Have I Been Pwned</a>
      using k-anonymity: your password is hashed with SHA-1 on this device and only the first 5 characters of that hash are sent{#if prefix}&#32;(for this password: <code class="font-mono text-sun">{prefix}</code>){/if}. The service replies with every leaked hash starting with those characters and the match is made here, so neither the password nor its full hash ever leaves your browser.
    </p>
    <div class="mt-4 flex flex-wrap items-center gap-3">
      <button type="button" class="btn" disabled={!password || breach.state === 'checking'} onclick={checkBreaches}>
        {breach.state === 'checking' ? 'Checking…' : 'Check breaches'}
      </button>
      <p role="status" class="text-sm">
        {#if breach.state === 'done' && breach.count > 0}
          <span class="text-bad">✕ Seen {breach.count.toLocaleString('en-US')} {breach.count === 1 ? 'time' : 'times'} in breaches. Don't use this password anywhere.</span>
        {:else if breach.state === 'done'}
          <span class="text-ok">✓ Not found in known breaches.</span> <span class="text-muted">That's good, but it doesn't make a weak password strong.</span>
        {:else if breach.state === 'error'}
          <span class="text-bad">{breachMessage}</span>
        {/if}
      </p>
    </div>
  </section>
</div>

<style>
  .meter {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 6px;
  }
  .meter span {
    height: 8px;
    border-radius: 99px;
    background: var(--color-panel-2);
    transform-origin: left;
    transition: background-color 0.3s var(--d), transform 0.4s var(--ease-spring) var(--d);
  }
  .meter span.on {
    background: var(--c);
    transform: scaleY(1.25);
  }
  .tick {
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    flex: none;
    border-radius: 6px;
    border: 1px solid var(--color-line-2);
    font-size: 11px;
    transition: background-color 0.2s, border-color 0.2s;
  }
  .tick.pass {
    background: var(--color-ok);
    border-color: var(--color-ok);
    color: var(--color-bg);
  }
</style>
