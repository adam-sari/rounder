<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { onToolSuccess } from '@/tools/lib/success';
  import { cleanComment, COMMENT_MAX, promptState, rememberPrompt } from '@/tools/lib/rating';

  // "Rate this tool": appears under the tool after a run worked (toolSucceeded), never before, never in the way.
  // It gates nothing and offers nothing in return (Google's review rules ban incentivized ratings), it can be closed,
  // and once answered or closed it never asks again for this tool in this browser.
  let { slug }: { slug: string } = $props();

  let phase = $state<'idle' | 'asking' | 'sending' | 'thanks' | 'closed'>('idle');
  let stars = $state(0);
  let comment = $state('');
  let error = $state('');
  let announce = $state('');
  let thanksEl = $state<HTMLElement>();

  const storage = () => {
    try {
      return localStorage;
    } catch {
      return undefined;
    }
  };
  const words = ['', 'Didn’t work', 'Poor', 'OK', 'Good', 'Great'];

  onMount(() =>
    onToolSuccess((d) => {
      if (d.slug !== slug || phase !== 'idle' || promptState(storage(), slug)) return;
      phase = 'asking';
      announce = 'Optional: you can rate this tool below it.';
    }),
  );

  // "No thanks" works while sending too, and the answer must not reopen the box
  const closed = () => phase === 'closed';

  function close() {
    if (phase !== 'thanks') rememberPrompt(storage(), slug, 'dismissed');
    phase = 'closed';
  }

  async function send(e: SubmitEvent) {
    e.preventDefault();
    if (!stars || phase === 'sending') return;
    phase = 'sending';
    error = '';
    try {
      const res = await fetch('/api/rate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, stars, comment: cleanComment(comment) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `The server answered ${res.status}.`);
      rememberPrompt(storage(), slug, 'rated');
      if (closed()) return; // closed while sending: it stays closed
      phase = 'thanks';
      announce = '';
      await tick();
      thanksEl?.focus();
    } catch (err) {
      if (closed()) return;
      phase = 'asking';
      error = err instanceof TypeError ? 'You seem to be offline.' : (err as Error).message;
    }
  }
</script>

<!-- says once that the box appeared, without moving focus; the thanks gets focus and errors are alerts of their own -->
<span class="sr-only" aria-live="polite">{announce}</span>

{#if phase === 'asking' || phase === 'sending'}
  <section class="card rate" aria-labelledby="rate-title">
    <form onsubmit={send}>
      <div class="flex flex-wrap items-center gap-x-5 gap-y-3">
        <fieldset class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <legend id="rate-title" class="float-left mr-1 font-medium text-chalk">How did it go?</legend>
          <span class="stars">
            {#each [1, 2, 3, 4, 5] as n (n)}
              <label class:lit={n <= stars}>
                <input type="radio" name="stars" value={n} bind:group={stars} class="sr-only" />
                <span aria-hidden="true">★</span>
                <span class="sr-only">{n} {n === 1 ? 'star' : 'stars'}, {words[n]}</span>
              </label>
            {/each}
          </span>
          <span class="mono" aria-hidden="true">{words[stars] || 'pick a star'}</span>
        </fieldset>
        <button type="button" class="mono ml-auto hover:text-chalk" onclick={close}>No thanks</button>
      </div>

      {#if stars}
        <label class="label mt-4" for="rate-comment">Anything we should know? (optional)</label>
        <textarea id="rate-comment" class="field comment" maxlength={COMMENT_MAX} rows="2" bind:value={comment}></textarea>
        <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="submit" class="btn btn-primary" disabled={phase === 'sending'}>{phase === 'sending' ? 'Sending…' : 'Send rating'}</button>
          <span class="mono">{comment.length}/{COMMENT_MAX}</span>
        </div>
      {/if}
      {#if error}<p class="mt-3 text-bad" role="alert">Couldn't send your rating. {error}</p>{/if}
      <p class="mono mt-3">
        Anonymous: we keep the stars, your comment and the date, never your IP address. <a href="/privacy#ratings" class="hover:text-chalk">Privacy</a>
      </p>
    </form>
  </section>
{:else if phase === 'thanks'}
  <section class="card rate flex items-center gap-4" aria-label="Rating sent">
    <p bind:this={thanksEl} tabindex="-1" class="text-soft outline-none">Thanks, your rating was saved.</p>
    <button type="button" class="mono ml-auto hover:text-chalk" onclick={close}>Close</button>
  </section>
{/if}

<style>
  .rate {
    padding: 16px 20px;
    animation: rise 0.35s var(--ease-spring) both;
  }
  @keyframes rise {
    from { opacity: 0; transform: translateY(6px); }
  }
  @media (prefers-reduced-motion: reduce) {
    .rate { animation: none; }
  }
  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
  .stars { display: inline-flex; }
  .stars label {
    cursor: pointer;
    padding: 2px 3px;
    font-size: 26px;
    line-height: 1;
    color: var(--color-line-2);
    transition: color 0.15s, transform 0.2s var(--ease-spring);
  }
  .stars label:hover { transform: scale(1.12); }
  /* the chosen score, and while hovering a preview: every star up to the pointer lights, the ones after it stay dark */
  .stars label.lit,
  .stars:hover label { color: var(--color-sun); }
  .stars label:hover ~ label { color: var(--color-line-2); }
  /* the radios are visually hidden, so their focus ring goes on the star */
  .stars label:has(:global(input:focus-visible)) { outline: 2px solid var(--color-sun); outline-offset: 2px; border-radius: 6px; }
  .comment { min-height: 0; }
  .text-bad { color: var(--color-bad); }
</style>
