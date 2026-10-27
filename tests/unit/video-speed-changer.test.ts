import { describe, expect, it } from 'vitest';
import { clampSpeed, outputFps, sliderToSpeed, speedLabel, speedSuffix, speedToSlider } from '@/tools/lib/video-speed/speed';
import { stretchedBytes, TimeStretcher } from '@/tools/lib/video-speed/stretch';

const RATE = 16000;

function sine(freq: number, seconds: number, rate = RATE) {
  return Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * freq * i) / rate));
}

async function samplesOf(wav: Blob, channels: number) {
  const buf = await wav.arrayBuffer();
  const pcm = new Int16Array(buf, 44);
  return Array.from({ length: channels }, (_, c) => Float32Array.from({ length: pcm.length / channels }, (_, i) => pcm[i * channels + c] / 32767));
}

/** dominant frequency from zero crossings of the steady middle part */
function frequency(x: Float32Array, rate = RATE) {
  const a = Math.floor(x.length * 0.2);
  const b = Math.floor(x.length * 0.8);
  let crossings = 0;
  for (let i = a + 1; i < b; i++) if (x[i - 1] < 0 !== x[i] < 0) crossings++;
  return (crossings / 2) * (rate / (b - a));
}

const rms = (x: Float32Array, a = 0, b = x.length) => Math.sqrt(x.subarray(a, b).reduce((s, v) => s + v * v, 0) / (b - a));

async function stretch(input: Float32Array[], speed: number, chunk = 4096, rate = RATE) {
  const st = new TimeStretcher(speed, rate, input.length);
  for (let i = 0; i < input[0].length; i += chunk) st.push(input.map((c) => c.subarray(i, i + chunk)));
  st.finish();
  return { st, out: await samplesOf(st.toWav(), input.length) };
}

describe('TimeStretcher', () => {
  it.each([0.25, 0.5, 0.8, 1, 1.5, 2, 4])('makes the output 1/%s as long', async (speed) => {
    const { st, out } = await stretch([sine(220, 2)], speed);
    expect(st.outputFrames).toBe(Math.round((2 * RATE) / speed));
    expect(out[0].length).toBe(st.outputFrames);
  });

  it.each([0.5, 2, 3])('keeps the pitch of a 440 Hz tone at %s×', async (speed) => {
    const { out } = await stretch([sine(440, 3)], speed);
    expect(frequency(out[0])).toBeGreaterThan(440 * 0.97);
    expect(frequency(out[0])).toBeLessThan(440 * 1.03);
  });

  it('keeps the loudness steady (no dips where frames overlap)', async () => {
    const { out } = await stretch([sine(330, 3)], 0.6);
    const x = out[0];
    const whole = rms(x, Math.floor(x.length * 0.1), Math.floor(x.length * 0.9));
    expect(whole).toBeGreaterThan(0.5 / Math.SQRT2 - 0.03);
    for (let a = Math.floor(x.length * 0.1); a + 800 < x.length * 0.9; a += 800) {
      expect(Math.abs(rms(x, a, a + 800) - whole)).toBeLessThan(0.05);
    }
  });

  it('reproduces the input at 1×', async () => {
    const input = sine(500, 1);
    const { out } = await stretch([input], 1);
    let maxErr = 0;
    for (let i = 0; i < input.length; i++) maxErr = Math.max(maxErr, Math.abs(out[0][i] - input[i]));
    expect(maxErr).toBeLessThan(1e-3);
  });

  it('gives the same result whatever the chunk size', async () => {
    const input = [sine(300, 1.5), sine(450, 1.5)];
    const a = await stretch(input, 1.7, 100_000);
    const b = await stretch(input, 1.7, 777);
    expect(b.out[0]).toEqual(a.out[0]);
    expect(b.out[1]).toEqual(a.out[1]);
  });

  it('keeps stereo channels apart', async () => {
    const { out } = await stretch([sine(440, 2), new Float32Array(2 * RATE)], 0.5);
    expect(rms(out[0])).toBeGreaterThan(0.3);
    expect(rms(out[1])).toBe(0);
  });

  it('writes a valid 16-bit WAV header', async () => {
    const { st } = await stretch([sine(440, 0.5), sine(440, 0.5)], 2, 4096, 48000);
    const wav = st.toWav();
    const v = new DataView(await wav.arrayBuffer());
    const tag = (at: number) => String.fromCharCode(...new Uint8Array(v.buffer, at, 4));
    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(st.outputFrames * 4);
    expect(wav.size).toBe(44 + st.outputFrames * 4);
    expect(wav.type).toBe('audio/wav');
  });

  it('keeps every sample when the output spans several 2 MB pieces', async () => {
    // 0.5× stereo at 16 kHz for 40 s: 2.56 M samples, so three staging flushes
    const { st, out } = await stretch([sine(440, 40), sine(330, 40)], 0.5, 16384);
    expect(st.outputFrames).toBe(80 * RATE);
    expect(out[0].length).toBe(st.outputFrames);
    expect(frequency(out[0])).toBeGreaterThan(440 * 0.97);
    expect(frequency(out[0])).toBeLessThan(440 * 1.03);
    expect(frequency(out[1])).toBeGreaterThan(330 * 0.97);
    expect(frequency(out[1])).toBeLessThan(330 * 1.03);
  });

  it('handles empty input and refuses pushes after finish', () => {
    const st = new TimeStretcher(2, RATE, 1);
    st.finish();
    expect(st.outputFrames).toBe(0);
    expect(st.toWav().size).toBe(44);
    expect(() => st.push([new Float32Array(10)])).toThrow();
  });

  it('estimates the WAV size it will hold', () => {
    expect(stretchedBytes(60, 0.5, 48000, 2)).toBe(120 * 48000 * 4);
  });
});

describe('speed helpers', () => {
  it('clamps and rounds speeds', () => {
    expect(clampSpeed(0.1)).toBe(0.25);
    expect(clampSpeed(9)).toBe(4);
    expect(clampSpeed(1.234)).toBe(1.23);
    expect(clampSpeed(Number.NaN)).toBe(1);
  });

  it('maps the log slider symmetrically around 1×', () => {
    expect(speedToSlider(1)).toBe(0);
    expect(speedToSlider(2)).toBe(1);
    expect(speedToSlider(0.5)).toBe(-1);
    expect(sliderToSpeed(-2)).toBe(0.25);
    expect(sliderToSpeed(Math.log2(1.5))).toBe(1.5);
  });

  it('labels speeds', () => {
    expect(speedLabel(0.5)).toBe('0.5×');
    expect(speedSuffix(2)).toBe('-2x');
  });

  it('works out the frame rate the output plays at', () => {
    expect(outputFps(30, 0.5)).toBe(15);
    expect(outputFps(30, 4)).toBe(60);
    expect(outputFps(24, 2)).toBe(48);
    expect(outputFps(null, 2)).toBeNull();
  });
});
