<script lang="ts">
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import {
    CLAIM_INFO,
    TIME_CLAIMS,
    decodeJwt,
    formatDuration,
    isNumericDate,
    jsonTokens,
    makeExampleToken,
    relativeTime,
    tokenSegments,
    tokenStatus,
    type DecodedJwt,
  } from '@/tools/lib/jwt-decoder/jwt';
  import { algorithmSpec, verifyJwt, type VerifyOutcome } from '@/tools/lib/jwt-decoder/verify';

  const EXAMPLE_SECRET = 'rounder-example-secret';

  let input = $state('');
  let secret = $state('');
  let secretIsBase64 = $state(false);
  let publicKey = $state('');
  let now = $state(Date.now() / 1000);
  // raw, so the token keeps its identity and a verdict is only shown for the token it was computed for
  let checked = $state.raw<{ token: DecodedJwt; outcome: VerifyOutcome } | null>(null);
  let backdrop = $state<HTMLPreElement>();

  const decoded = $derived(input.trim() ? decodeJwt(input) : null);
  const jwt = $derived(decoded?.ok ? decoded.jwt : null);
  const alg = $derived(String(jwt?.header.alg ?? ''));
  const spec = $derived(algorithmSpec(alg));
  const status = $derived(jwt ? tokenStatus(jwt.payload, now) : null);
  const segments = $derived(tokenSegments(input));
  const headerJson = $derived(jwt ? JSON.stringify(jwt.header, null, 2) : '');
  const payloadJson = $derived(jwt ? (jwt.payloadIsJson ? JSON.stringify(jwt.payload, null, 2) : String(jwt.payload)) : '');
  const claims = $derived.by(() => {
    const p = jwt?.payload;
    return p && typeof p === 'object' && !Array.isArray(p) ? Object.entries(p as Record<string, unknown>) : [];
  });
  const payload = $derived(Object.fromEntries(claims));
  const outcome = $derived(checked && checked.token === jwt ? checked.outcome : null);
  const lifetime = $derived(isNumericDate(payload.exp) && isNumericDate(payload.iat) ? payload.exp - payload.iat : null);

  $effect(() => {
    const t = setInterval(() => (now = Date.now() / 1000), 1000);
    return () => clearInterval(t);
  });

  // verify as the key is typed, debounced; while only the key changes, the last verdict stays up until the next one lands
  $effect(() => {
    const token = jwt;
    const key = { secret, secretIsBase64, publicKey };
    if (!token || !spec || (spec.kind === 'hmac' ? !secret : !publicKey.trim())) {
      checked = null;
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await verifyJwt(token, key).catch((e): VerifyOutcome => ({ state: 'error', message: (e as Error).message }));
      if (!cancelled) checked = { token, outcome: r };
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  });

  async function loadExample() {
    input = await makeExampleToken(EXAMPLE_SECRET, Math.floor(Date.now() / 1000));
    secret = EXAMPLE_SECRET;
    secretIsBase64 = false;
  }

  function syncScroll(e: Event) {
    const t = e.currentTarget as HTMLTextAreaElement;
    if (backdrop) backdrop.scrollTop = t.scrollTop;
  }

  const fullDate = (sec: number) => new Date(sec * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'long' });
  const relative = (sec: number) => relativeTime(sec - now);
  // own keys only, so payload keys like "constructor" don't pick up Object.prototype members
  const claimInfo = (key: string) => (Object.hasOwn(CLAIM_INFO, key) ? CLAIM_INFO[key] : undefined);
  const isTimeClaim = (key: string) => Object.hasOwn(TIME_CLAIMS, key);
  const show = (v: unknown) => (typeof v === 'string' ? v : Array.isArray(v) && v.every((x) => typeof x === 'string') ? v.join(', ') : JSON.stringify(v));
</script>

{#snippet json(text: string, part: 'header' | 'payload')}
  <pre class="json" data-part={part}>{#each jsonTokens(text) as t}<span class={t.kind}>{t.text}</span>{/each}</pre>
{/snippet}

<div class="grid gap-5 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
  <div class="grid content-start gap-3 md:sticky md:top-4">
    <label for="jwt-input" class="label">encoded token</label>
    <div class="editor">
      <pre class="backdrop" aria-hidden="true" bind:this={backdrop}>{#each segments as s}<span class="seg-{s.part}">{s.text}</span>{/each}{' '}</pre>
      <textarea
        id="jwt-input"
        class="field min-h-[300px]!"
        bind:value={input}
        onscroll={syncScroll}
        placeholder="Paste a JWT, e.g. eyJhbGciOiJIUzI1NiIs…"
        spellcheck="false"
        autocomplete="off"
        autocapitalize="off"
      ></textarea>
    </div>
    <div class="flex flex-wrap gap-2">
      <button type="button" class="btn" onclick={loadExample}>Try an example</button>
      <button type="button" class="btn" onclick={() => (input = '')} disabled={!input}>Clear</button>
    </div>
    <p class="mono leading-relaxed">
      Decoded on your device. JWT payloads are only encoded, not encrypted, so anyone holding a token can read it.
    </p>
  </div>

  <div class="grid content-start gap-4">
    {#if !decoded}
      <div class="empty">
        <p class="font-serif text-2xl text-chalk">Paste a token to look inside</p>
        <p class="mono mt-2">
          <span class="seg-header">header</span>.<span class="seg-payload">payload</span>.<span class="seg-signature">signature</span>
        </p>
      </div>
    {:else if !decoded.ok}
      <div class="card border-bad! p-4 text-bad" role="alert">{decoded.error}</div>
    {:else if jwt}
      <div class="flex flex-wrap items-center gap-2">
        {#if status?.state === 'expired'}
          <span class="pill text-bad">Expired {relative(status.at)}</span>
        {:else if status?.state === 'not-yet'}
          <span class="pill text-sun">Not valid yet · starts {relative(status.at)}</span>
        {:else if status?.state === 'active'}
          <span class="pill text-ok">Active · expires {relative(status.at)}</span>
        {:else}
          <span class="pill text-muted">No expiry set</span>
        {/if}
        {#if alg}<span class="pill text-soft">{alg}</span>{/if}
        {#if typeof jwt.header.typ === 'string'}<span class="pill text-soft">{jwt.header.typ}</span>{/if}
      </div>

      <section class="part" style="--part: var(--color-pdf)" aria-label="Header">
        <div class="part-head">
          <span class="label m-0!">header</span>
          <CopyButton text={headerJson} class="py-1.5! text-sm!" label="Copy" />
        </div>
        {@render json(headerJson, 'header')}
      </section>

      <section class="part" style="--part: var(--color-ai)" aria-label="Payload">
        <div class="part-head">
          <span class="label m-0!">payload</span>
          <CopyButton text={payloadJson} class="py-1.5! text-sm!" label="Copy" />
        </div>
        {#if jwt.payloadIsJson}
          {@render json(payloadJson, 'payload')}
        {:else}
          <pre class="json">{payloadJson}</pre>
        {/if}
        {#if claims.length}
          <dl class="claims">
            {#each claims as [key, value]}
              <div class="claim">
                <dt>
                  <code class="text-[13px] text-chalk">{key}</code>
                  {#if claimInfo(key)}<span class="block text-xs text-muted">{claimInfo(key)}</span>{/if}
                </dt>
                <dd>
                  {#if isTimeClaim(key) && isNumericDate(value)}
                    <span class="text-chalk">{fullDate(value)}</span>
                    <span class="block text-xs {key === 'exp' && value <= now ? 'text-bad' : 'text-muted'}">
                      {relative(value)}{#if key === 'exp' && lifetime !== null && lifetime > 0}&nbsp;· lifetime {formatDuration(lifetime)}{/if}
                    </span>
                  {:else}
                    <span class="break-words text-soft">{show(value)}</span>
                  {/if}
                </dd>
              </div>
            {/each}
          </dl>
        {/if}
      </section>

      <section class="part" style="--part: var(--color-dev)" aria-label="Signature">
        <div class="part-head">
          <span class="label m-0!">signature</span>
          <span class="mono">{jwt.signature.length} bytes</span>
        </div>
        <div class="grid gap-3 p-4 pt-1">
          {#if alg === 'none' || !jwt.raw[2]}
            <p class="text-sm text-bad">
              This token is unsigned, so anyone could have written it. Never accept unsigned tokens in production.
            </p>
          {:else if !spec}
            <p class="text-sm text-soft">{alg || 'This algorithm'} can't be checked with your browser's built-in crypto, but the header and payload above are decoded as usual.</p>
          {:else if spec.kind === 'hmac'}
            <label>
              <span class="label">secret, to verify the {alg} signature</span>
              <input class="field font-mono text-sm!" bind:value={secret} spellcheck="false" autocomplete="off" placeholder="your-256-bit-secret" />
            </label>
            <label class="flex items-center gap-2 text-sm text-soft">
              <input type="checkbox" class="accent-(--color-sun)" bind:checked={secretIsBase64} /> secret is Base64URL-encoded
            </label>
          {:else}
            <label>
              <span class="label">public key, to verify the {alg} signature</span>
              <textarea
                class="field min-h-[120px]! text-[13px]!"
                bind:value={publicKey}
                spellcheck="false"
                placeholder={'-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----\n\nPEM, certificate, JWK or JWK Set'}
              ></textarea>
            </label>
          {/if}

          {#if outcome?.state === 'error'}
            <p class="text-sm text-bad" role="alert">{outcome.message}</p>
          {:else if outcome}
            {#key outcome.state}
              {#if outcome.state === 'valid'}
                <p class="verdict text-ok" role="status"><span class="stamp" aria-hidden="true">✓</span> Signature verified</p>
              {:else}
                <p class="verdict text-bad" role="status"><span class="stamp" aria-hidden="true">✕</span> Invalid signature: the token was changed, or this isn't the key it was signed with.</p>
              {/if}
            {/key}
            {#if outcome.note}<p class="mono">{outcome.note}</p>{/if}
          {/if}
        </div>
      </section>
    {/if}
  </div>
</div>

<style>
  .editor {
    position: relative;
    border-radius: 12px;
    background: #141312;
  }
  /* the textarea and the colored layer under it must lay text out identically */
  .editor textarea,
  .backdrop {
    font: 400 14px/1.6 var(--font-mono);
    padding: 11px 14px;
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: normal;
    letter-spacing: 0;
    scrollbar-gutter: stable;
  }
  .backdrop {
    position: absolute;
    inset: 0;
    overflow: hidden;
    border: 1px solid transparent;
    pointer-events: none;
    color: var(--color-chalk);
  }
  .editor textarea {
    position: relative;
    display: block;
    overflow: auto;
    background: transparent;
    color: transparent;
    caret-color: var(--color-chalk);
  }
  .seg-header { color: var(--color-pdf); }
  .seg-payload { color: var(--color-ai); }
  .seg-signature { color: var(--color-dev); }
  .seg-dot, .seg-prefix { color: var(--color-muted); }
  .seg-extra { color: var(--color-bad); }

  .empty {
    display: grid;
    place-items: center;
    text-align: center;
    min-height: 300px;
    padding: 24px;
    border: 1.5px dashed var(--color-line-2);
    border-radius: 18px;
  }

  .pill {
    font: 400 12.5px var(--font-mono);
    padding: 5px 11px;
    border-radius: 999px;
    border: 1px solid currentColor;
    background: color-mix(in srgb, currentColor 10%, transparent);
  }

  .part {
    background: var(--color-panel);
    border: 1px solid var(--color-line-2);
    border-left: 3px solid var(--part);
    border-radius: 14px;
    min-width: 0;
  }
  .part-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px 0 16px;
  }
  .part-head .label { color: var(--part); }

  .json {
    margin: 0;
    padding: 10px 16px 14px;
    font: 400 13.5px/1.6 var(--font-mono);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--color-muted);
  }
  .json .key { color: var(--part); }
  .json .string { color: var(--color-ok); }
  .json .number { color: var(--color-sun); }
  .json .literal { color: var(--color-everyday); }

  .claims {
    margin: 0;
    border-top: 1px solid var(--color-line);
  }
  .claim {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
    gap: 12px;
    padding: 9px 16px;
    font-size: 14px;
  }
  .claim + .claim { border-top: 1px solid var(--color-line); }
  .claim dd { margin: 0; }

  .verdict {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 15px;
  }
  .stamp {
    display: grid;
    place-items: center;
    flex: none;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: 1.5px solid currentColor;
    font-weight: 600;
    animation: stamp 0.45s var(--ease-spring) both;
  }
  @keyframes stamp {
    from { transform: scale(1.6) rotate(-14deg); opacity: 0; }
    to { transform: none; opacity: 1; }
  }
</style>
