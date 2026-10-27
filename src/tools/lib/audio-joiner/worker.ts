/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import { applyGain, dbToGain, peakLevel, writeWav } from '@/engines/media/dsp';
import { integratedLoudness, loudnessGainDb } from './loudness';
import { conformChannels, mixTrack, type TrackFrames } from './mix';

/*
 * Holds the mix buffer and does the per-sample work (loudness, fades, summing, WAV writing)
 * off the main thread. Decoded tracks are transferred in one at a time, never copied.
 */

let out: Float32Array[] = [];
let sampleRate = 48000;

const api = {
  start(frames: number, channels: 1 | 2, rate: number) {
    out = []; // let the last mix go before allocating the next
    out = Array.from({ length: channels }, () => new Float32Array(frames));
    sampleRate = rate;
  },

  /** mixes one decoded track in; returns the loudness gain it applied (dB) */
  add(channels: Float32Array[], p: TrackFrames, gainDb: number, matchLoudness: boolean) {
    const src = conformChannels(channels, out.length as 1 | 2);
    const auto = matchLoudness ? loudnessGainDb(integratedLoudness(src, sampleRate), peakLevel(src)) : 0;
    mixTrack(out, src, { ...p, gain: dbToGain(gainDb + auto) });
    return auto;
  },

  /** hands back the mix as PCM, or as a 16-bit WAV file for WAV/FLAC output */
  finish(as: 'pcm' | 'wav') {
    const channels = out;
    out = [];
    // overlaps and boosts can sum past full scale; lower the whole mix rather than clip it
    const peak = peakLevel(channels);
    const safetyDb = peak > 0.999 ? 20 * Math.log10(0.98 / peak) : 0;
    if (safetyDb) applyGain(channels, safetyDb);
    if (as === 'wav') {
      const wav = new Blob([writeWav({ sampleRate, channels }, 'pcm-s16')], { type: 'audio/wav' });
      return { safetyDb, wav, channels: [] as Float32Array[] };
    }
    return Comlink.transfer({ safetyDb, wav: null, channels }, channels.map((c) => c.buffer as ArrayBuffer));
  },

  /** a WAV copy of audio only the fallback decoder could read, so previews and later decodes are native */
  toWav(channels: Float32Array[], rate: number) {
    return new Blob([writeWav({ sampleRate: rate, channels }, 'pcm-s16')], { type: 'audio/wav' });
  },

  reset() {
    out = [];
  },
};

export type JoinWorker = typeof api;

Comlink.expose(api);
