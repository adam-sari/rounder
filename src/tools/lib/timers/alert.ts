// Sound and desktop notifications for when a timer ends. Browser-only: call these from
// event handlers or effects, never at module load.

let ctx: AudioContext | null = null;

/** creates or wakes the audio context; call from a click so browsers allow the chime later */
export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** unlocks audio on the first click or key press anywhere on the page; returns a cleanup */
export function unlockOnInteraction() {
  const events = ['pointerup', 'keydown'] as const;
  const once = () => {
    if (unlockAudio()?.state === 'running') off();
  };
  const off = () => events.forEach((e) => window.removeEventListener(e, once, true));
  events.forEach((e) => window.addEventListener(e, once, true));
  return off;
}

export type Tune = 'alarm' | 'gentle';

// C6 E6 G6 C7 rising for the timer; a soft G5 to D6 for pomodoro phase changes
const tunes: Record<Tune, { notes: number[]; gap: number; decay: number }> = {
  alarm: { notes: [1046.5, 1318.5, 1568, 2093], gap: 0.16, decay: 1.6 },
  gentle: { notes: [784, 1174.7], gap: 0.42, decay: 2.6 },
};

/** a bell: a few slightly inharmonic partials, the higher ones fading faster */
const partials: [ratio: number, level: number, decay: number][] = [[1, 1, 1], [2.01, 0.35, 0.55], [3.02, 0.15, 0.32], [4.17, 0.06, 0.2]];

/** plays a synthesized chime; volume is 0–1 */
export function chime(volume: number, tune: Tune = 'alarm') {
  const ac = unlockAudio();
  if (!ac || volume <= 0) return;
  const { notes, gap, decay } = tunes[tune];
  const out = ac.createGain();
  // squared so the slider feels even to the ear
  out.gain.value = volume * volume * 0.3;
  out.connect(ac.destination);
  const t0 = ac.currentTime + 0.02;
  notes.forEach((freq, i) => {
    const at = t0 + i * gap;
    for (const [ratio, level, d] of partials) {
      const osc = ac.createOscillator();
      const env = ac.createGain();
      osc.frequency.value = freq * ratio;
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime(level, at + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0001, at + decay * d);
      osc.connect(env).connect(out);
      osc.start(at);
      osc.stop(at + decay * d + 0.05);
    }
  });
  setTimeout(() => out.disconnect(), (notes.length * gap + decay + 0.5) * 1000);
}

export const canNotify = () => typeof Notification !== 'undefined';

/** asks for permission (only ever from a click); true when notifications may be shown */
export async function askToNotify() {
  if (!canNotify() || Notification.permission === 'denied') return false;
  if (Notification.permission === 'granted') return true;
  return (await Notification.requestPermission()) === 'granted';
}

export function notify(title: string, body: string) {
  if (!canNotify() || Notification.permission !== 'granted') return;
  const opts = { body, tag: 'rounder-timer', icon: '/favicon.svg' };
  try {
    new Notification(title, opts);
  } catch {
    // Android Chrome only allows notifications from a service worker, so go through the site's one if it is registered
    navigator.serviceWorker
      ?.getRegistration()
      .then((r) => r?.showNotification(title, opts))
      .catch(() => {});
  }
}
