/// <reference lib="webworker" />
// A steady clock for compositing. Timers on the page are throttled to once a second (or less)
// while its tab is hidden, which is exactly when a screen recording is usually running.
let timer: ReturnType<typeof setInterval> | undefined;

self.onmessage = (e: MessageEvent<number>) => {
  clearInterval(timer);
  if (e.data > 0) timer = setInterval(() => self.postMessage(0), e.data);
};
