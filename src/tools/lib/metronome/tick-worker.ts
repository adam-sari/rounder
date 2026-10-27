/// <reference lib="webworker" />
// The scheduler's wake-up call. Timers on the page itself are throttled to about once a second
// in a background tab, which would starve the lookahead; timers in a worker keep their pace.
let timer: ReturnType<typeof setInterval> | undefined;

self.onmessage = (e: MessageEvent<number>) => {
  clearInterval(timer);
  if (e.data > 0) timer = setInterval(() => self.postMessage(0), e.data);
};

// a module, so its names stay out of the global scope other scripts share
export {};
