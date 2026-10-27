/// <reference lib="webworker" />
import { applyGain, peakLevel, writeWav } from '@/engines/media/dsp';
import { toMediaError, type MediaErrorCode } from '@/engines/media/types';
import { stretchChannels, type StretchSettings } from './stretch';

/*
 * One job per worker: the page terminates it to cancel, which is instant even mid-FFT.
 * Hands back a 16-bit WAV so the page holds half the memory a float copy would need.
 */

export interface StretchRequest {
  channels: Float32Array[];
  sampleRate: number;
  settings: StretchSettings;
}

export type StretchMessage =
  | { type: 'progress'; value: number }
  | { type: 'done'; wav: Blob; frames: number; safetyDb: number }
  | { type: 'error'; name: 'MediaError'; code: MediaErrorCode; message: string };

const post = (m: StretchMessage) => self.postMessage(m);

self.onmessage = ({ data }: MessageEvent<StretchRequest>) => {
  try {
    let reported = 0;
    const out = stretchChannels(data.channels, data.settings, (p) => {
      if (p - reported < 0.01 && p < 1) return;
      reported = p;
      post({ type: 'progress', value: p });
    });
    data.channels.length = 0;
    // shifted phases can stack a little above full scale; lower the whole file rather than clip it
    const peak = peakLevel(out);
    const safetyDb = peak > 0.999 ? 20 * Math.log10(0.98 / peak) : 0;
    if (safetyDb) applyGain(out, safetyDb);
    const frames = out[0]?.length ?? 0;
    const bytes = writeWav({ sampleRate: data.sampleRate, channels: out });
    out.length = 0;
    post({ type: 'done', wav: new Blob([bytes], { type: 'audio/wav' }), frames, safetyDb });
  } catch (e) {
    const err = toMediaError(e);
    post({ type: 'error', name: 'MediaError', code: err.code, message: err.message });
  }
};
