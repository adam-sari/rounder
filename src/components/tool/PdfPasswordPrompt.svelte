<script lang="ts">
  interface Props {
    /** shown in the heading */
    fileName?: string;
    /** the last attempt failed */
    wrong?: boolean;
    /** true while the caller tries the password */
    busy?: boolean;
    onsubmit: (password: string) => void;
    /** skip this file */
    oncancel?: () => void;
  }

  let { fileName = '', wrong = false, busy = false, onsubmit, oncancel }: Props = $props();

  let password = $state('');
  let show = $state(false);
  let input = $state<HTMLInputElement>();
  const id = $props.id();

  $effect(() => {
    input?.focus();
  });

  // select the text after a failed try so retyping replaces it
  $effect(() => {
    if (wrong && !busy) input?.select();
  });
</script>

<form
  class="prompt"
  class:shake={wrong && !busy}
  onsubmit={(e) => {
    e.preventDefault();
    if (password && !busy) onsubmit(password);
  }}
>
  <div class="lock" aria-hidden="true">
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></svg>
  </div>
  <div class="body">
    <h3 class="text-[22px] leading-tight">{fileName ? 'This PDF is locked' : 'Password needed'}</h3>
    <p class="mono mt-1 break-all">{fileName ? `${fileName} needs its password to open.` : 'Enter the password to open this PDF.'}</p>

    <label class="label mt-4" for={id}>Password</label>
    <div class="row">
      <input
        bind:this={input}
        bind:value={password}
        {id}
        class="field"
        type={show ? 'text' : 'password'}
        autocomplete="off"
        spellcheck="false"
        aria-invalid={wrong}
        aria-describedby="{id}-note"
      />
      <button type="button" class="btn eye" aria-pressed={show} onclick={() => (show = !show)}>{show ? 'Hide' : 'Show'}</button>
    </div>
    <p id="{id}-note" class="mono mt-2" class:err={wrong} role={wrong ? 'alert' : undefined}>
      {wrong ? "That password didn't work. Passwords are case-sensitive." : 'Used only on your device to unlock the file. It is never sent anywhere.'}
    </p>

    <div class="mt-4 flex flex-wrap gap-2">
      <button type="submit" class="btn btn-primary" disabled={!password || busy}>{busy ? 'Unlocking…' : 'Unlock'}</button>
      {#if oncancel}
        <button type="button" class="btn" onclick={oncancel}>Skip this file</button>
      {/if}
    </div>
  </div>
</form>

<style>
  .prompt {
    display: flex;
    gap: 16px;
    padding: 20px;
    border: 1px solid var(--color-line-2);
    border-radius: 16px;
    background: var(--color-panel-2);
  }
  .lock {
    flex: none;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 12px;
    color: var(--color-sun);
    background: #ffd25e14;
    border: 1px solid #ffd25e40;
  }
  .body {
    flex: 1;
    min-width: 0;
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .eye {
    flex: none;
    padding-inline: 14px;
    font-size: 14px;
  }
  .err {
    color: var(--color-bad);
  }
  .shake {
    animation: shake 0.36s;
  }
  @keyframes shake {
    20%, 60% { transform: translateX(-5px); }
    40%, 80% { transform: translateX(5px); }
  }
  @media (max-width: 420px) {
    .prompt {
      flex-direction: column;
    }
  }
</style>
