/**
 * Calls fn on every animation frame while the tab is visible, and about once a second while
 * it's hidden (browsers pause requestAnimationFrame in background tabs). Timers read the
 * clock on each call rather than counting ticks, so throttling never makes them drift.
 */
export function ticker(fn: () => void): () => void {
  let frame = 0;
  let interval = 0;
  const loop = () => {
    fn();
    frame = requestAnimationFrame(loop);
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    clearInterval(interval);
  };
  const sync = () => {
    stop();
    if (document.hidden) interval = window.setInterval(fn, 1000);
    else loop();
  };
  sync();
  document.addEventListener('visibilitychange', sync);
  return () => {
    stop();
    document.removeEventListener('visibilitychange', sync);
  };
}

/** a one-off timeout for a wall-clock moment; a single timeout still fires in a background tab */
export function wakeAt(at: number, fn: () => void): () => void {
  const t = setTimeout(fn, Math.max(0, at - Date.now()) + 5);
  return () => clearTimeout(t);
}

/** shows the time in the tab title while a timer runs, and puts the page title back afterwards */
export function titleKeeper() {
  const original = document.title;
  return {
    set(text: string | null) {
      document.title = text ? `${text} · ${original}` : original;
    },
    restore() {
      document.title = original;
    },
  };
}
