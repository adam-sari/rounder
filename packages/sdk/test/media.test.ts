import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { files, findFfmpeg, media } from '@roundertools/sdk';
import { FX } from './helpers';

const M = (f: string) => join(FX, 'media', f);
const ffmpeg = findFfmpeg();

describe.runIf(!!ffmpeg)('media on the system ffmpeg', () => {
  it('probes streams', async () => {
    const info = await files.info(M('sample.mov'));
    expect(info).toMatchObject({ kind: 'video', durationSec: 3, video: { codec: 'avc', width: 480, height: 270 }, audio: { codec: 'aac' } });
  });

  it('compresses to a size target with the site planner', async () => {
    const out = await media.compress(M('sample.mov'), { target: '100kb' });
    expect(out.name).toBe('sample-compressed.mp4');
    expect(out.size).toBeLessThanOrEqual(100_000);
    expect(out.meta.fits).toBe(true);
    const info = await files.info({ name: 'out.mp4', data: out.data });
    expect(info).toMatchObject({ video: { codec: 'avc' } });
  });

  it('converts, trims, mutes and extracts audio', async () => {
    const webm = await media.convert(M('sample.avi'), { to: 'webm' });
    expect(webm.name).toBe('sample.webm');
    const trimmed = await media.trim(M('sample.mp4'), { start: 0.5, end: '0:01.5' });
    expect(((await files.info({ name: 't.mp4', data: trimmed.data })).durationSec as number)).toBeCloseTo(1, 0);
    const muted = await media.mute(M('sample.mp4'));
    expect((await files.info({ name: 'm.mp4', data: muted.data })).audio).toBeUndefined();
    const mp3 = await media.toAudio(M('sample.mp4'), { bitrate: 128 });
    expect(mp3.name).toBe('sample.mp3');
    const flac = await media.convertAudio(M('sample.wav'), { to: 'flac' });
    expect(String.fromCharCode(...flac.data.subarray(0, 4))).toBe('fLaC');
  });

  it('makes a GIF with its own palette', async () => {
    const gif = await media.toGif(M('sample.mp4'), { end: 1, width: 160, fps: 8 });
    expect(String.fromCharCode(...gif.data.subarray(0, 6))).toBe('GIF89a');
  });

  it('rejects an end before the start', async () => {
    await expect(media.trim(M('sample.mp4'), { start: 2, end: 1 })).rejects.toMatchObject({ code: 'invalid-options' });
  });
});

describe('without ffmpeg', () => {
  it('says how to get it (exit 4 in the CLI)', () => {
    const script = "import('@roundertools/sdk').then(({ media }) => media.mute(process.argv[1])).catch((e) => { console.log(e.code + '|' + e.hint); })";
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script, M('sample.mp4')], { cwd: import.meta.dirname, env: { ...process.env, ROUNDERTOOLS_FFMPEG: join(import.meta.dirname, 'no-such-ffmpeg') }, encoding: 'utf8' });
    expect(out.trim()).toMatch(/^missing-dependency\|Install ffmpeg/);
  });
});
