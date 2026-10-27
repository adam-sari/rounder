/*
 * Microphone setup: constraints, the device list, and plain-English errors.
 */

export type Processing = 'noiseSuppression' | 'echoCancellation' | 'autoGainControl';

export const PROCESSING: { key: Processing; label: string; hint: string }[] = [
  { key: 'noiseSuppression', label: 'noise suppression', hint: 'Filters steady background noise such as fans and hum.' },
  { key: 'echoCancellation', label: 'echo cancellation', hint: 'Removes sound from your speakers that leaks into the mic.' },
  { key: 'autoGainControl', label: 'auto gain', hint: 'Evens out loud and quiet speech.' },
];

export type ProcessingOptions = Record<Processing, boolean>;

/** '' = the system default microphone */
export function micConstraints(deviceId: string, o: ProcessingOptions): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    noiseSuppression: o.noiseSuppression,
    echoCancellation: o.echoCancellation,
    autoGainControl: o.autoGainControl,
    // a voice needs one channel; a mic that can't do mono hands back what it has
    channelCount: { ideal: 1 },
  };
}

/** options that were asked for but that the browser reports as off for this microphone */
export function ignoredProcessing(o: ProcessingOptions, settings: Partial<Record<Processing, unknown>>): Processing[] {
  return PROCESSING.map((p) => p.key).filter((k) => o[k] && settings[k] === false);
}

export interface DeviceChoice {
  id: string;
  label: string;
}

/**
 * Audio inputs with readable labels (labels stay empty until permission is granted). Chrome's
 * "default" entry is dropped: the picker has its own "system default" option.
 */
export function micChoices(devices: Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label'>[]): DeviceChoice[] {
  return devices
    .filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default')
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
}

export const isPermissionError = (err: unknown) => ['NotAllowedError', 'SecurityError'].includes((err as { name?: string } | null)?.name ?? '');

export const BLOCKED_TEXT =
  'Microphone access is blocked for this site. Click the icon at the left of the address bar (a lock or sliders), allow the microphone, then press Record again. On a Mac, also check System Settings → Privacy & Security → Microphone.';

/** friendly copy for a failed getUserMedia call */
export function micErrorText(err: unknown): string {
  const name = (err as { name?: string } | null)?.name;
  if (isPermissionError(err)) return BLOCKED_TEXT;
  if (name === 'NotFoundError') return 'No microphone was found. Plug one in or check that it is switched on, then try again.';
  if (name === 'OverconstrainedError') return "That microphone isn't available any more. Pick another one from the list.";
  if (name === 'NotReadableError' || name === 'AbortError') return 'Your microphone is busy or blocked by the system. Close other apps that might be using it, then try again.';
  return "Your microphone couldn't start. Try again, or pick another one.";
}

export type MicUnsupported = 'insecure' | 'no-mic' | 'no-recorder';

export function micSupport(env: { secure: boolean; userMedia: boolean; recorder: boolean }): MicUnsupported | null {
  if (!env.secure) return 'insecure';
  if (!env.userMedia) return 'no-mic';
  return env.recorder ? null : 'no-recorder';
}

export const unsupportedText: Record<MicUnsupported, string> = {
  insecure: 'Browsers only allow microphone recording on secure (https) pages. Open this page over https and try again.',
  'no-mic': "This browser can't use a microphone from a web page. Try a recent Chrome, Edge, Firefox or Safari.",
  'no-recorder': "This browser can't record audio (it's missing MediaRecorder). Try a recent Chrome, Edge, Firefox or Safari.",
};
