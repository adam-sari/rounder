/**
 * Audio plumbing for recorders: mixing several tracks (tab sound + microphone) into the one
 * audio track MediaRecorder takes, and a level meter for the microphone.
 */

export interface Mix {
  track: MediaStreamTrack | null;
  close: () => void;
}

/**
 * One track or none is passed straight through. Two or more are mixed with Web Audio; pass a
 * context created during the click that started recording, since one created later may stay
 * suspended (and record silence) under autoplay rules.
 */
export function mixAudio(tracks: MediaStreamTrack[], ctx?: AudioContext | null): Mix {
  if (tracks.length < 2) {
    void ctx?.close();
    return { track: tracks[0] ?? null, close: () => {} };
  }
  const ac = ctx ?? new AudioContext();
  void ac.resume();
  const out = ac.createMediaStreamDestination();
  const sources = tracks.map((t) => {
    const node = ac.createMediaStreamSource(new MediaStream([t]));
    node.connect(out);
    return node;
  });
  return {
    track: out.stream.getAudioTracks()[0] ?? null,
    close: () => {
      sources.forEach((n) => n.disconnect());
      void ac.close();
    },
  };
}

/** 0–1 meter reading for a block of samples: RMS on a -60…0 dB scale */
export function levelFromSamples(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  const rms = Math.sqrt(sum / samples.length);
  if (rms <= 0) return 0;
  return Math.min(1, Math.max(0, (20 * Math.log10(rms) + 60) / 60));
}

/** live input level of a stream's audio; read() it on animation frames */
export function levelMeter(stream: MediaStream) {
  const ctx = new AudioContext();
  void ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  return {
    read() {
      analyser.getFloatTimeDomainData(buf);
      return levelFromSamples(buf);
    },
    close() {
      source.disconnect();
      void ctx.close();
    },
  };
}
