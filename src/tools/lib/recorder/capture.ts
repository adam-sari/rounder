/** Pure builders for getDisplayMedia / getUserMedia options, device lists and error copy. */

export type Surface = 'monitor' | 'window' | 'browser';

/**
 * Options for getDisplayMedia. `surface` only pre-selects a tab of the browser's picker; the
 * newer hints (systemAudio, surfaceSwitching…) are ignored by browsers that don't know them.
 */
export function displayMediaOptions(o: { surface: Surface; fps: number; systemAudio: boolean }) {
  return {
    video: { displaySurface: o.surface, frameRate: { ideal: o.fps, max: o.fps } },
    // processing meant for voices would mangle music and game sound
    audio: o.systemAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false } : false,
    systemAudio: o.systemAudio ? 'include' : 'exclude',
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
    monitorTypeSurfaces: 'include',
  } as DisplayMediaStreamOptions;
}

export interface Resolution {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const RESOLUTIONS: Resolution[] = [
  { id: '480p', label: '480p', width: 640, height: 480 },
  { id: '720p', label: '720p', width: 1280, height: 720 },
  { id: '1080p', label: '1080p', width: 1920, height: 1080 },
  { id: '4k', label: '4K', width: 3840, height: 2160 },
];

/** `ideal` sizes: a camera that can't do 4K hands back its best instead of failing */
export function cameraConstraints(deviceId: string, res: Pick<Resolution, 'width' | 'height'>, fps = 30): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' }),
    width: { ideal: res.width },
    height: { ideal: res.height },
    frameRate: { ideal: fps },
  };
}

export function micConstraints(deviceId: string): MediaTrackConstraints {
  return { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true };
}

export interface DeviceChoice {
  id: string;
  label: string;
}

/** devices of one kind with readable labels; labels stay empty until permission is granted */
export function deviceChoices(devices: Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label'>[], kind: MediaDeviceKind, noun: string): DeviceChoice[] {
  return devices
    .filter((d) => d.kind === kind && d.deviceId)
    .map((d, i) => ({ id: d.deviceId, label: d.label || `${noun} ${i + 1}` }));
}

export type Device = 'screen' | 'camera' | 'microphone' | 'camera and microphone';

/** friendly copy for a failed getDisplayMedia / getUserMedia call */
export function captureError(err: unknown, what: Device): string {
  const name = (err as { name?: string } | null)?.name;
  if (what === 'screen') {
    if (name === 'NotAllowedError') {
      return 'Screen sharing was cancelled or blocked. If no picker appeared, check that your browser is allowed to record the screen (on a Mac: System Settings → Privacy & Security → Screen & System Audio Recording).';
    }
    if (name === 'NotReadableError' || name === 'AbortError') {
      return "The screen couldn't be captured. The operating system may have blocked it. Try again, or pick a different window.";
    }
    return "Screen sharing couldn't start. Try again, or try another browser such as Chrome, Edge or Firefox.";
  }
  const both = what === 'camera and microphone';
  if (name === 'NotAllowedError' || name === 'SecurityError') return `Access to your ${what} was blocked. Allow it for this site in your browser's address bar or settings, then try again.`;
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return `No ${what} was found. Check that ${both ? 'they are' : 'it is'} connected, then try again.`;
  if (name === 'NotReadableError' || name === 'AbortError') return `Your ${what} ${both ? 'are' : 'is'} busy, probably in use by another app or tab. Close it there and try again.`;
  return `Your ${what} couldn't start. Try again, or pick another device.`;
}

export interface CaptureEnv {
  secure: boolean;
  displayMedia: boolean;
  userMedia: boolean;
  recorder: boolean;
  /** phone or tablet */
  mobile: boolean;
}

export type Unsupported = 'insecure' | 'mobile-screen' | 'no-screen' | 'no-camera' | 'no-recorder';

export function screenSupport(env: CaptureEnv): Unsupported | null {
  if (!env.secure) return 'insecure';
  if (!env.displayMedia) return env.mobile ? 'mobile-screen' : 'no-screen';
  return env.recorder ? null : 'no-recorder';
}

export function cameraSupport(env: CaptureEnv): Unsupported | null {
  if (!env.secure) return 'insecure';
  if (!env.userMedia) return 'no-camera';
  return env.recorder ? null : 'no-recorder';
}

export const unsupportedCopy: Record<Unsupported, { title: string; text: string }> = {
  insecure: { title: 'This page needs a secure connection', text: 'Browsers only allow recording on https pages. Open this page over https and try again.' },
  'mobile-screen': {
    title: "Phones can't record the screen from a web page",
    text: "Mobile browsers don't let websites capture the screen. Use your device's built-in recorder instead: on iPhone and iPad, add Screen Recording to Control Center; on Android, look for Screen record in Quick Settings. On a computer, this tool works in Chrome, Edge, Firefox and Safari.",
  },
  'no-screen': { title: "This browser can't record the screen", text: 'Try a recent version of Chrome, Edge, Firefox or Safari on a computer.' },
  'no-camera': { title: "This browser can't use the camera here", text: 'Try a recent version of Chrome, Edge, Firefox or Safari.' },
  'no-recorder': { title: "This browser can't record video", text: "It's missing MediaRecorder, which recording needs. Try a recent version of Chrome, Edge, Firefox or Safari." },
};

/** reads the browser's capabilities; call it in the browser only */
export function detectEnv(): CaptureEnv {
  const md = navigator.mediaDevices;
  const ua = navigator.userAgent;
  return {
    secure: window.isSecureContext,
    displayMedia: typeof md?.getDisplayMedia === 'function',
    userMedia: typeof md?.getUserMedia === 'function',
    recorder: typeof MediaRecorder !== 'undefined',
    // iPads report a Mac user agent, but Macs have no touch screen
    mobile: /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1),
  };
}

/** copy for an engine MediaError while converting a recording to MP4 ('' for a cancel) */
export function conversionError(code: string | undefined, message: string): string {
  switch (code) {
    case 'aborted':
      return '';
    case 'out-of-memory':
      return 'Your browser ran out of memory converting this recording. The original is fine: download it as it is. It plays in Chrome, Firefox, Edge and VLC.';
    case 'no-webcodecs':
    case 'unsupported-codec':
      return "This browser can't encode MP4 video. Download the recording as it is, or open this page in a recent Chrome, Edge or Safari to convert it.";
    case 'ffmpeg-failed':
      return "The fallback converter couldn't process this recording. Download it as it is instead.";
    default:
      return `The conversion didn't work. ${message}`.trim();
  }
}
