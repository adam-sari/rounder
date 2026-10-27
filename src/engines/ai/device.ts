import type { Device } from './models';

export interface DeviceInfo {
  /** a real (not software) WebGPU adapter is available */
  webgpu: boolean;
  adapterInfo?: { vendor: string; architecture: string; device: string; description: string };
  /** the GPU can run fp16 shaders (shader-f16), needed for fp16/q4f16 weights */
  fp16: boolean;
  /** largest GPU buffer in bytes; 0 without WebGPU */
  maxBufferSize: number;
  isMobile: boolean;
  /** RAM in GB, rounded and capped at 8 by the browser; Chromium only */
  deviceMemory?: number;
  cores: number;
  /** WebAssembly threads ORT can use: 1 unless the page is cross-origin isolated (ours isn't) */
  threads: number;
  recommended: Device;
  /** why WebGPU is unavailable, in plain words */
  reason?: string;
}

type Nav = Navigator & { gpu?: GPU; deviceMemory?: number; userAgentData?: { mobile: boolean } };

const timeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))]);

async function probe(): Promise<DeviceInfo> {
  const nav = navigator as Nav;
  const cores = nav.hardwareConcurrency || 2;
  // iPadOS reports itself as a Mac; touch points give it away
  const isMobile = nav.userAgentData?.mobile ?? (/Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1));
  const info: DeviceInfo = {
    webgpu: false,
    fp16: false,
    maxBufferSize: 0,
    isMobile,
    deviceMemory: nav.deviceMemory,
    cores,
    threads: globalThis.crossOriginIsolated ? Math.min(4, Math.max(1, cores - 1)) : 1,
    recommended: 'wasm',
  };

  if (!nav.gpu) return { ...info, reason: 'This browser has no WebGPU.' };
  try {
    // some drivers hang here instead of answering, so don't wait forever
    const adapter = await timeout(nav.gpu.requestAdapter({ powerPreference: 'high-performance' }), 4000);
    if (!adapter) return { ...info, reason: 'WebGPU is turned off or blocked for this graphics card.' };
    // Chrome < 121 and older Safari previews only have the deprecated isFallbackAdapter on the adapter
    const legacy = adapter as GPUAdapter & { isFallbackAdapter?: boolean };
    if (adapter.info?.isFallbackAdapter ?? legacy.isFallbackAdapter) return { ...info, reason: 'Only a software GPU is available, which is slower than the CPU path.' };
    const { vendor = '', architecture = '', device = '', description = '' } = adapter.info ?? {};
    return {
      ...info,
      webgpu: true,
      adapterInfo: { vendor, architecture, device, description },
      fp16: adapter.features.has('shader-f16'),
      maxBufferSize: adapter.limits.maxBufferSize,
      recommended: 'webgpu',
    };
  } catch {
    return { ...info, reason: "WebGPU didn't start in this browser." };
  }
}

let cached: Promise<DeviceInfo> | undefined;

/** What this device can run, probed once per page (or worker) and cached */
export function detectDevice(): Promise<DeviceInfo> {
  return (cached ??= probe());
}

/** "your graphics card" / "your processor", for model cards */
export function deviceLabel(device: Device): string {
  return device === 'webgpu' ? 'your graphics card (WebGPU)' : 'your processor';
}
