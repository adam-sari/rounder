import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getModel, lightModel, MODELS, modelUrl, needsF16, pickVariant, totalDownloadSize, variantFiles, type ModelKey } from '@/engines/ai/models';
import { engineFor } from '@/engines/ai/runtime';
import { VENDOR } from '@/engines/ai/vendor.generated';

const keys = Object.keys(MODELS) as ModelKey[];
const pkg = (path: string) => JSON.parse(readFileSync(`node_modules/${path}/package.json`, 'utf8')).version as string;

describe('model registry', () => {
  it.each(keys)('%s is complete and pinned', (key) => {
    const m = getModel(key);
    expect(m.name && m.summary && m.credit).toBeTruthy();
    expect(m.license.name).toMatch(/^(MIT|Apache-2\.0|CC-BY-4\.0)$/);
    expect(m.license.url).toMatch(/^https:\/\//);
    // Hugging Face files are pinned to a full commit sha; other hosts to a version in the URL
    if (m.baseUrl) expect(m.baseUrl).toMatch(/^(https:\/\/|\/models\/)/);
    else expect(m.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(m.variants).length).toBeGreaterThan(0);
    for (const v of Object.values(m.variants)) for (const f of v.files) expect(f.bytes).toBeGreaterThan(0);
    for (const v of [...m.prefer.webgpu, ...m.prefer.wasm]) expect(m.variants).toHaveProperty(v);
    expect(m.prefer.webgpu.length + m.prefer.wasm.length).toBeGreaterThan(0);
    if (m.prefer.webgpu.length) expect(m.speed.webgpu).toBeTruthy();
    if (m.prefer.wasm.length) expect(m.speed.wasm).toBeTruthy();
    if (m.runtime === 'transformers' && m.task) expect(m.repo).toMatch(/^[\w.-]+\/[\w.-]+$/);
  });

  it('light alternatives exist and are smaller', () => {
    for (const key of keys) {
      const light = lightModel(key);
      if (!light) continue;
      expect(MODELS).toHaveProperty(light);
      const smallest = (k: ModelKey) => Math.min(...Object.keys(MODELS[k].variants).map((v) => totalDownloadSize(k, v)));
      expect(smallest(light)).toBeLessThan(smallest(key));
    }
  });

  it('WebGPU-only models offer a light model, except the LLM (which has the Chrome APIs instead)', () => {
    const gpuOnly = keys.filter((k) => !MODELS[k].prefer.wasm.length);
    expect(gpuOnly.filter((k) => !lightModel(k))).toEqual(['qwen3.5-0.8b']);
  });
});

describe('sizes and urls', () => {
  it('adds shared files to the variant files', () => {
    expect(totalDownloadSize('modnet', 'q8')).toBe(83 + 365 + 6632188);
    expect(variantFiles('modnet', 'q8').map((f) => f.path)).toEqual(['config.json', 'preprocessor_config.json', 'onnx/model_quantized.onnx']);
    expect(totalDownloadSize('whisper-base', 'q8')).toBe(2243 + 3832 + 282682 + 2480466 + 339 + 23159167 + 53712708);
    expect(() => totalDownloadSize('modnet', 'q2')).toThrow(/no "q2" variant/);
  });

  it('builds pinned Hugging Face and custom-host urls', () => {
    expect(modelUrl('migan', 'migan_pipeline_v2.onnx')).toBe('https://huggingface.co/andraniksargsyan/migan/resolve/406830d0fa60666da0071c342ad2fbc8f30c5c64/migan_pipeline_v2.onnx');
    expect(modelUrl('tesseract-eng', 'eng.traineddata.gz')).toBe('https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz');
    expect(modelUrl('face-detector', 'blaze_face_short_range.tflite')).toBe('/models/blaze_face_short_range.tflite');
  });

  it('self-hosted model files exist with the registered size', () => {
    const face = MODELS['face-detector'].variants.fp16.files[0];
    expect(statSync(`public/models/${face.path}`).size).toBe(face.bytes);
  });
});

describe('pickVariant', () => {
  const gpu = { webgpu: true, fp16: true };
  const gpuNoF16 = { webgpu: true, fp16: false };
  const cpu = { webgpu: false, fp16: false };

  it('prefers WebGPU and its best variant', () => {
    expect(pickVariant('depth-anything-v2-small', gpu)).toEqual({ device: 'webgpu', variant: 'fp16' });
    expect(pickVariant('modnet', cpu)).toEqual({ device: 'wasm', variant: 'fp16' });
  });

  it('skips fp16 weights on GPUs without shader-f16', () => {
    expect(pickVariant('depth-anything-v2-small', gpuNoF16)).toEqual({ device: 'webgpu', variant: 'fp32' });
    expect(pickVariant('florence2-base', gpuNoF16)).toEqual({ device: 'wasm', variant: 'q8' });
    // only fp16 weights, widened to fp32 for the GPU: no shader-f16 needed
    expect(pickVariant('ddcolor-tiny', gpu)).toEqual({ device: 'webgpu', variant: 'fp16' });
    expect(pickVariant('ddcolor-tiny', gpuNoF16)).toEqual({ device: 'webgpu', variant: 'fp16' });
    expect(pickVariant('ddcolor-tiny', cpu)).toEqual({ device: 'wasm', variant: 'fp16' });
  });

  it('returns null when WebGPU is required but missing', () => {
    expect(pickVariant('birefnet-lite', cpu)).toBeNull();
    expect(pickVariant('qwen3.5-0.8b', gpuNoF16)).toEqual({ device: 'webgpu', variant: 'q4' });
  });

  it('keeps CPU-only runtimes on the CPU', () => {
    expect(pickVariant('tesseract-eng', gpu)).toEqual({ device: 'wasm', variant: 'best_int' });
    expect(pickVariant('opus-mt-en-es', gpu)).toEqual({ device: 'wasm', variant: 'q8' });
  });

  it('runs Kokoro on the GPU in fp32 when it can', () => {
    expect(pickVariant('kokoro', gpu)).toEqual({ device: 'webgpu', variant: 'fp32' });
    expect(pickVariant('kokoro', cpu)).toEqual({ device: 'wasm', variant: 'q8' });
  });

  it('detects fp16 in per-part dtypes', () => {
    expect(needsF16(MODELS['florence2-base'].variants.mixed)).toBe(true);
    expect(needsF16(MODELS.modnet.variants.q8)).toBe(false);
    expect(needsF16(MODELS['tesseract-eng'].variants.best_int)).toBe(false);
  });
});

describe('engineFor', () => {
  it('picks the ORT build a model loads', () => {
    expect(engineFor(MODELS.modnet, 'webgpu')).toBe('jsep');
    expect(engineFor(MODELS.modnet, 'wasm')).toBe('transformers');
    expect(engineFor(MODELS.modnet, 'webgpu', 'webgpu')).toBe('transformers');
    expect(engineFor(MODELS['birefnet-lite'], 'webgpu')).toBe('ort');
    expect(engineFor(MODELS.demucs, 'wasm')).toBe('ort');
    expect(engineFor(MODELS['tesseract-eng'], 'wasm')).toBeNull();
  });
});

describe('vendored runtimes', () => {
  it('match the installed packages', () => {
    expect(VENDOR.ort.version).toBe(pkg('onnxruntime-web'));
    expect(VENDOR.tesseract.version).toBe(pkg('tesseract.js'));
    const nested = (p: string) => {
      try {
        return pkg(p);
      } catch {
        return pkg('onnxruntime-web');
      }
    };
    expect(VENDOR.transformers.version).toBe(nested('@huggingface/transformers/node_modules/onnxruntime-web'));
    expect(VENDOR.jsep.version).toBe(nested('kokoro-js/node_modules/onnxruntime-web'));
  });

  it('keeps every published file under the Cloudflare Pages 25 MB limit', () => {
    for (const rt of [VENDOR.ort, VENDOR.transformers, VENDOR.jsep]) {
      for (const [name, f] of Object.entries(rt.files) as [string, { bytes: number; parts?: readonly { name: string; bytes: number }[] }][]) {
        const parts = f.parts ?? [{ name, bytes: f.bytes }];
        expect(parts.reduce((s, p) => s + p.bytes, 0)).toBe(f.bytes);
        for (const p of parts) {
          expect(p.bytes).toBeLessThan(25 * 1024 * 1024);
          expect(statSync(`public${rt.base}${p.name}`).size).toBe(p.bytes);
        }
      }
    }
  });
});

describe('pickVariant on phones', () => {
  it('keeps the light CPU voice instead of a 300 MB GPU download', () => {
    expect(pickVariant('kokoro', { webgpu: true, fp16: true, isMobile: true })).toEqual({ device: 'wasm', variant: 'q8' });
    expect(pickVariant('kokoro', { webgpu: true, fp16: true, isMobile: false })?.device).toBe('webgpu');
  });
});
