import { describe, expect, it, vi } from 'vitest';
import { aiError, AiError, toAiError } from '@/engines/ai/errors';
import { formatMB, formatProgress, ProgressTally, throttleProgress, type LoadProgress } from '@/engines/ai/progress';

describe('ProgressTally', () => {
  it('sums files against totals known up front', () => {
    const t = new ProgressTally({ 'a.onnx': 100, 'config.json': 10 });
    expect(t.sum()).toEqual({ phase: 'download', loaded: 0, total: 110 });
    expect(t.update('a.onnx', 40)).toMatchObject({ loaded: 40, total: 110, file: 'a.onnx' });
    expect(t.done('config.json')).toMatchObject({ loaded: 50, total: 110 });
  });

  it('grows when a file is bigger than expected or unlisted, and never goes backwards', () => {
    const t = new ProgressTally({ 'a.onnx': 100 });
    t.update('a.onnx', 60, 120);
    t.update('extra.json', 5, 5);
    expect(t.sum()).toMatchObject({ loaded: 65, total: 125 });
    t.update('a.onnx', 30);
    expect(t.sum().loaded).toBe(65);
    t.update('a.onnx', 200);
    expect(t.sum()).toMatchObject({ loaded: 205, total: 205 });
  });
});

describe('throttleProgress', () => {
  it('drops rapid updates but always passes the last one and init', () => {
    const seen: LoadProgress[] = [];
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    const report = throttleProgress((p) => seen.push(p), 50);
    report({ phase: 'download', loaded: 1, total: 10 });
    report({ phase: 'download', loaded: 2, total: 10 });
    report({ phase: 'download', loaded: 10, total: 10 });
    report({ phase: 'init', loaded: 10, total: 10 });
    expect(seen.map((p) => p.loaded)).toEqual([1, 10, 10]);
    vi.restoreAllMocks();
  });
});

describe('formatting', () => {
  it('uses decimal megabytes like Hugging Face', () => {
    expect(formatMB(114538221)).toBe('115 MB');
    expect(formatMB(6632188)).toBe('6.6 MB');
    expect(formatMB(229746)).toBe('0.2 MB');
    expect(formatMB(1085000000)).toBe('1.1 GB');
    expect(formatProgress({ phase: 'download', loaded: 32e6, total: 114538221 })).toBe('32 of 115 MB');
  });
});

describe('toAiError', () => {
  const code = (e: unknown) => toAiError(e).code;
  it('classifies runtime failures', () => {
    expect(code(new DOMException('The user aborted a request.', 'AbortError'))).toBe('aborted');
    expect(code(new DOMException('Quota exceeded', 'QuotaExceededError'))).toBe('storage-full');
    expect(code(new RangeError('Array buffer allocation failed'))).toBe('out-of-memory');
    expect(code(new Error('Aborted(). Build with -sASSERTIONS for more info.'))).toBe('out-of-memory');
    expect(code(new TypeError('Failed to fetch'))).toBe('network');
    expect(code(new Error('HTTP 429 Too Many Requests'))).toBe('rate-limited');
    expect(code(new Error('Unsupported model type'))).toBe('failed');
    expect(code(new Error('Could not locate file: "https://huggingface.co/x/y/resolve/main/config.json".'))).toBe('network');
    expect(code(new Error('Error (503) occurred while trying to load file'))).toBe('network');
    // tensor shapes are not HTTP status codes
    expect(code(new Error('[WebGPU] Kernel "Conv" failed. Input dims [1,3,512,512], 404 channels'))).toBe('failed');
  });

  it('keeps codes across a worker boundary and passes AiErrors through', () => {
    const e = aiError('no-webgpu');
    expect(toAiError(e)).toBe(e);
    expect(toAiError(Object.assign(new Error('x'), { code: 'out-of-memory' }))).toBeInstanceOf(AiError);
    expect(code(Object.assign(new Error('x'), { code: 'out-of-memory' }))).toBe('out-of-memory');
    expect(e.message).toMatch(/WebGPU/);
  });
});
