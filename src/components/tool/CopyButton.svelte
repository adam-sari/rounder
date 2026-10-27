<script lang="ts">
  let {
    text,
    label = 'Copy',
    disabled = false,
    class: className = '',
  }: { text: string | (() => string); label?: string; disabled?: boolean; class?: string } = $props();
  let state = $state<'idle' | 'copied' | 'failed'>('idle');
  let timer: ReturnType<typeof setTimeout>;

  async function copy() {
    const value = typeof text === 'function' ? text() : text;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      state = 'copied';
    } catch {
      // clipboard access can be refused (permissions, insecure origin); say so rather than pretend
      state = 'failed';
    }
    clearTimeout(timer);
    timer = setTimeout(() => (state = 'idle'), 1600);
  }
</script>

<button type="button" class={`btn ${className}`} onclick={copy} disabled={disabled || (typeof text === 'string' && !text)} aria-live="polite">
  {state === 'copied' ? 'Copied ✓' : state === 'failed' ? 'Copy blocked' : label}
</button>
