/*
 * Every model an AI tool may download, pinned to an exact commit so files can't change under us.
 * Sizes are exact bytes from the Hugging Face API at that commit. Speeds are estimates from the
 * model research, written for people ("≈1 s per photo"), not benchmarks.
 */

export type Runtime = 'transformers' | 'ort' | 'mediapipe' | 'tesseract' | 'kokoro' | 'demucs';
/** where a model runs: the GPU through WebGPU, or the CPU through WebAssembly */
export type Device = 'webgpu' | 'wasm';
/** transformers.js dtype names */
export type Dtype = 'fp32' | 'fp16' | 'q8' | 'int8' | 'uint8' | 'q4' | 'q4f16' | 'bnb4';

export interface ModelFile {
  /** path inside the repo (or under baseUrl) */
  path: string;
  bytes: number;
}

export interface Variant {
  /** what transformers.js gets as `dtype` (per-part maps are allowed, see Florence-2); for other runtimes, the weights' precision */
  dtype?: Dtype | Record<string, Dtype>;
  /** the weight files this variant downloads */
  files: ModelFile[];
}

export interface ModelSpec {
  /** shown in the model card, e.g. "BiRefNet lite" */
  name: string;
  /** one honest line about what it is good at */
  summary: string;
  /** Hugging Face repo id, or a label when baseUrl points elsewhere */
  repo: string;
  /** commit sha (or a version for non-HF hosts) the URLs are pinned to */
  revision: string;
  /** files fetched from somewhere other than huggingface.co/<repo>/resolve/<revision>/ */
  baseUrl?: string;
  runtime: Runtime;
  /** transformers.js pipeline task, when the model runs through pipeline() */
  task?: string;
  license: { name: string; url: string };
  /** credit line for the FAQ and /credits */
  credit: string;
  /** config/tokenizer files loaded with every variant */
  shared?: ModelFile[];
  variants: Record<string, Variant>;
  /**
   * Variants to try, best first, per device. An empty webgpu list means the model always runs on
   * the CPU; an empty wasm list means it needs WebGPU.
   */
  prefer: { webgpu: string[]; wasm: string[] };
  /**
   * 'jsep': on WebGPU, run on onnxruntime-web 1.22's JSEP backend instead of the newer WebGPU EP,
   * which gives this model wrong results or can't run it (checked on /dev/ai-parity).
   */
  gpu?: 'jsep';
  /**
   * graph rewrite createOrtSession applies before opening a WebGPU session (onnx-patch.ts):
   * 'webgpu' narrows wide Splits and turns Sums into Adds; 'fp32' widens float16 weights and math to
   * float32 (for models only published in float16 whose GPU math goes wrong in it; no shader-f16 needed)
   */
  patch?: 'webgpu' | 'fp32';
  /** registry key of a smaller model to offer when this one can't run or is too heavy (phones, no WebGPU) */
  light?: string;
  /** too heavy for phones even when it technically runs */
  desktopOnly?: boolean;
  /** typical speed, for the model card */
  speed: Partial<Record<Device, string>>;
}

const f = (path: string, bytes: number): ModelFile => ({ path, bytes });
const one = (path: string, bytes: number, dtype?: Dtype): Variant => ({ dtype, files: [f(path, bytes)] });

const WHISPER_TOKENIZER = [f('tokenizer.json', 2480466), f('preprocessor_config.json', 339)];

function opus(pair: string, revision: string, license: 'Apache-2.0' | 'CC-BY-4.0', encoder: number, decoder: number, tokenizer: number): ModelSpec {
  return {
    name: `OPUS-MT ${pair}`,
    summary: 'A compact translation model for one language direction.',
    repo: `Xenova/opus-mt-${pair}`,
    revision,
    runtime: 'transformers',
    task: 'translation',
    license: { name: license, url: `https://huggingface.co/Helsinki-NLP/opus-mt-${pair}` },
    credit: `OPUS-MT ${pair} by Helsinki-NLP (Jörg Tiedemann et al.)${license === 'CC-BY-4.0' ? ', CC BY 4.0' : ''}`,
    // the other config files are a few hundred bytes each
    shared: [f('tokenizer.json', tokenizer)],
    variants: { q8: { dtype: 'q8', files: [f('onnx/encoder_model_quantized.onnx', encoder), f('onnx/decoder_model_merged_quantized.onnx', decoder)] } },
    prefer: { webgpu: [], wasm: ['q8'] },
    speed: { wasm: 'about a second per sentence' },
  };
}

export const MODELS = {
  // ── images ──────────────────────────────────────────────────────────────────────────────
  'birefnet-lite': {
    name: 'BiRefNet lite',
    summary: 'Cuts out any subject (people, products, pets) with fine edges.',
    repo: 'onnx-community/BiRefNet_lite-ONNX',
    revision: 'de15b22ba131738a16dff04aab8bdf8dc32e3ac1',
    // raw ORT (1024² in, logits out; ImageNet mean/std) so its graph can be fixed up for WebGPU. The CPU
    // can't run it: at 1024² it needs more than WebAssembly's 4 GB
    runtime: 'ort',
    patch: 'webgpu',
    license: { name: 'MIT', url: 'https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE' },
    credit: 'BiRefNet by Peng Zheng et al.',
    variants: { fp16: one('onnx/model_fp16.onnx', 114538221, 'fp16'), fp32: one('onnx/model.onnx', 224005088, 'fp32') },
    prefer: { webgpu: ['fp16', 'fp32'], wasm: [] },
    light: 'modnet',
    speed: { webgpu: '≈2 s per photo' },
  },
  modnet: {
    name: 'MODNet',
    summary: 'A small, fast model for cutting out people. Not made for objects.',
    repo: 'Xenova/modnet',
    revision: 'fa2fa546052fba4c08921230a26cc69a333fca12',
    runtime: 'transformers',
    task: 'background-removal',
    license: { name: 'Apache-2.0', url: 'https://github.com/ZHKKKe/MODNet/blob/master/LICENSE' },
    credit: 'MODNet by Zhanghan Ke et al.',
    shared: [f('config.json', 83), f('preprocessor_config.json', 365)],
    variants: {
      q8: one('onnx/model_quantized.onnx', 6632188, 'q8'),
      fp16: one('onnx/model_fp16.onnx', 12984781, 'fp16'),
      fp32: one('onnx/model.onnx', 25888640, 'fp32'),
    },
    // the current WebGPU EP returns a wrong matte (fp16 and fp32); JSEP is right, but only in fp32.
    // On the CPU q8 is 10% off fp32 at the same speed; fp16 weights (computed in fp32) match it
    prefer: { webgpu: ['fp32'], wasm: ['fp16'] },
    gpu: 'jsep',
    speed: { webgpu: 'well under a second per photo', wasm: '≈0.5–2 s per photo' },
  },
  'swin2sr-x2-light': {
    name: 'Swin2SR lightweight ×2',
    summary: 'Doubles the resolution of a photo with a small, quick model.',
    repo: 'Xenova/swin2SR-lightweight-x2-64',
    revision: '92a21aca5713f20faf9a87590cdfbdce2e34112c',
    runtime: 'transformers',
    task: 'image-to-image',
    license: { name: 'Apache-2.0', url: 'https://huggingface.co/caidas/swin2SR-lightweight-x2-64' },
    credit: 'Swin2SR by Marcos V. Conde et al.',
    shared: [f('config.json', 801), f('preprocessor_config.json', 152)],
    variants: { q8: one('onnx/model_quantized.onnx', 7082844, 'q8'), fp32: one('onnx/model.onnx', 8078888, 'fp32') },
    prefer: { webgpu: ['fp32'], wasm: ['fp32', 'q8'] },
    speed: { webgpu: 'a few seconds per photo', wasm: 'tens of seconds for a large photo' },
  },
  'swin2sr-x4-realworld': {
    name: 'Swin2SR real-world ×4',
    summary: 'Upscales real photos four times, cleaning up blur and noise.',
    repo: 'onnx-community/swin2SR-realworld-sr-x4-64-bsrgan-psnr-ONNX',
    revision: '9b3baf051f6708d0b697580489e4415b64c7378e',
    runtime: 'transformers',
    task: 'image-to-image',
    license: { name: 'Apache-2.0', url: 'https://huggingface.co/caidas/swin2SR-realworld-sr-x4-64-bsrgan-psnr' },
    credit: 'Swin2SR by Marcos V. Conde et al.',
    shared: [f('config.json', 900), f('preprocessor_config.json', 152)],
    variants: {
      q8: one('onnx/model_quantized.onnx', 18935979, 'q8'),
      fp16: one('onnx/model_fp16.onnx', 28281426, 'fp16'),
      fp32: one('onnx/model.onnx', 53827735, 'fp32'),
    },
    // fp16 overflows (on both WebGPU backends: the output is noise); fp32 matches the CPU exactly
    prefer: { webgpu: ['fp32'], wasm: ['q8'] },
    light: 'swin2sr-x2-light',
    speed: { webgpu: 'a few seconds per photo', wasm: 'a minute or more for a large photo' },
  },
  migan: {
    name: 'MI-GAN',
    summary: 'Fills in erased areas. Best on watermarks, text and small objects.',
    repo: 'andraniksargsyan/migan',
    revision: '406830d0fa60666da0071c342ad2fbc8f30c5c64',
    runtime: 'ort',
    license: { name: 'MIT', url: 'https://github.com/Picsart-AI-Research/MI-GAN/blob/main/LICENSE-WEIGHTS' },
    credit: 'MI-GAN by Andranik Sargsyan et al. (Picsart AI Research)',
    variants: { fp32: one('migan_pipeline_v2.onnx', 28079181, 'fp32') },
    prefer: { webgpu: ['fp32'], wasm: ['fp32'] },
    speed: { webgpu: 'under a second per edit', wasm: '≈0.5–2 s per edit' },
  },
  lama: {
    name: 'Big LaMa',
    summary: 'A larger inpainting model that handles big holes better.',
    repo: 'Carve/LaMa-ONNX',
    revision: 'c3c0c9e468934d62e79c329e35d82dd09ff8c444',
    runtime: 'ort',
    license: { name: 'Apache-2.0', url: 'https://github.com/advimman/lama/blob/main/LICENSE' },
    credit: 'LaMa by Roman Suvorov et al.',
    variants: { fp32: one('lama_fp32.onnx', 208044816, 'fp32') },
    prefer: { webgpu: ['fp32'], wasm: ['fp32'] },
    light: 'migan',
    desktopOnly: true,
    speed: { webgpu: 'a few seconds per edit', wasm: '≈30 s per edit' },
  },
  'ddcolor-tiny': {
    name: 'DDColor tiny',
    summary: 'Adds natural color to black-and-white photos.',
    repo: 'edgetools/ddcolor',
    revision: '4755ae9f1f7a35a9e7693b96c2a88f3432cb6ab0',
    runtime: 'ort',
    license: { name: 'Apache-2.0', url: 'https://github.com/piddnad/DDColor/blob/master/LICENSE' },
    credit: 'DDColor by Xiaoyang Kang et al.',
    variants: { fp16: one('ddcolor-tiny-fp16.onnx', 135444402, 'fp16') },
    // only fp16 weights, and its LayerNorms lose too much in real fp16 math (110% off on the GPU), so
    // the GPU gets them widened to fp32 when the session opens. The CPU computes fp16 in fp32 anyway
    patch: 'fp32',
    prefer: { webgpu: ['fp16'], wasm: ['fp16'] },
    speed: { webgpu: '≈1–2 s per photo', wasm: '≈10–15 s per photo' },
  },
  'florence2-base': {
    name: 'Florence-2 base',
    summary: 'Describes what is in a picture, briefly or in detail. English only.',
    repo: 'onnx-community/Florence-2-base-ft',
    revision: 'e88a44eaf3791a35eae0c5a47b3dbcd36e67eb6f',
    runtime: 'transformers',
    license: { name: 'MIT', url: 'https://huggingface.co/microsoft/Florence-2-base-ft' },
    credit: 'Florence-2 by Microsoft',
    shared: [f('config.json', 5432), f('generation_config.json', 292), f('preprocessor_config.json', 2673), f('tokenizer.json', 2297961), f('tokenizer_config.json', 197658)],
    variants: {
      q8: {
        dtype: 'q8',
        files: [
          f('onnx/embed_tokens_quantized.onnx', 39390433),
          f('onnx/vision_encoder_quantized.onnx', 93746540),
          f('onnx/encoder_model_quantized.onnx', 43651493),
          f('onnx/decoder_model_merged_quantized.onnx', 98177697),
        ],
      },
      mixed: {
        dtype: { embed_tokens: 'fp16', vision_encoder: 'fp16', encoder_model: 'q4', decoder_model_merged: 'q4' },
        files: [
          f('onnx/embed_tokens_fp16.onnx', 78780290),
          f('onnx/vision_encoder_fp16.onnx', 183930536),
          f('onnx/encoder_model_q4.onnx', 30058778),
          f('onnx/decoder_model_merged_q4.onnx', 64393474),
        ],
      },
    },
    // q8 on the GPU is slower than on the CPU
    prefer: { webgpu: ['mixed'], wasm: ['q8'] },
    speed: { webgpu: '≈1 s per picture', wasm: '≈3–8 s per picture' },
  },
  'depth-anything-v2-small': {
    name: 'Depth Anything V2 small',
    summary: 'Estimates how far away each part of a photo is.',
    repo: 'onnx-community/depth-anything-v2-small',
    revision: '4472b7362082ad9968fee890ca0f1e5aca36b93d',
    runtime: 'transformers',
    task: 'depth-estimation',
    license: { name: 'Apache-2.0', url: 'https://huggingface.co/depth-anything/Depth-Anything-V2-Small' },
    credit: 'Depth Anything V2 (Small) by Lihe Yang et al.',
    shared: [f('config.json', 38), f('preprocessor_config.json', 461)],
    variants: {
      q8: one('onnx/model_quantized.onnx', 27258801, 'q8'),
      fp16: one('onnx/model_fp16.onnx', 49642442, 'fp16'),
      fp32: one('onnx/model.onnx', 99060839, 'fp32'),
    },
    prefer: { webgpu: ['fp16', 'fp32'], wasm: ['q8'] },
    speed: { webgpu: 'well under a second per photo', wasm: '≈1–3 s per photo (longer on phones)' },
  },

  // ── text in images ──────────────────────────────────────────────────────────────────────
  'tesseract-eng': {
    name: 'Tesseract English',
    summary: 'Classic, dependable OCR for printed text and clean scans.',
    repo: '@tesseract.js-data/eng',
    revision: '1.0.0',
    baseUrl: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/',
    runtime: 'tesseract',
    license: { name: 'Apache-2.0', url: 'https://github.com/tesseract-ocr/tessdata_best/blob/main/LICENSE' },
    credit: 'Tesseract OCR and tessdata by Google and contributors',
    variants: { best_int: one('eng.traineddata.gz', 2952873) },
    prefer: { webgpu: [], wasm: ['best_int'] },
    speed: { wasm: '≈1–3 s per page' },
  },

  // ── audio ───────────────────────────────────────────────────────────────────────────────
  'whisper-tiny': {
    name: 'Whisper tiny',
    summary: 'The smallest Whisper: quick, rougher on accents and noise.',
    repo: 'onnx-community/whisper-tiny_timestamped',
    revision: '517244293732ee2d58139af5814231b7e6830a0d',
    runtime: 'transformers',
    task: 'automatic-speech-recognition',
    license: { name: 'MIT', url: 'https://github.com/openai/whisper/blob/main/LICENSE' },
    credit: 'Whisper by OpenAI',
    shared: [f('config.json', 2243), f('generation_config.json', 3772), f('tokenizer_config.json', 282683), ...WHISPER_TOKENIZER],
    variants: {
      q8: { dtype: 'q8', files: [f('onnx/encoder_model_quantized.onnx', 10097109), f('onnx/decoder_model_merged_quantized.onnx', 30730264)] },
      fp16: { dtype: 'fp16', files: [f('onnx/encoder_model_fp16.onnx', 16477869), f('onnx/decoder_model_merged_fp16.onnx', 59574434)] },
    },
    // q8 on the GPU is slower than on the CPU
    prefer: { webgpu: ['fp16'], wasm: ['q8'] },
    speed: { webgpu: 'many times faster than real time', wasm: 'faster than real time on most computers' },
  },
  'whisper-base': {
    name: 'Whisper base',
    summary: 'Speech to text in about 100 languages, with word timings.',
    repo: 'onnx-community/whisper-base_timestamped',
    revision: '608c49e61301901684bc36cac8f74b95ff6b5a8e',
    runtime: 'transformers',
    task: 'automatic-speech-recognition',
    license: { name: 'MIT', url: 'https://github.com/openai/whisper/blob/main/LICENSE' },
    credit: 'Whisper by OpenAI',
    shared: [f('config.json', 2243), f('generation_config.json', 3832), f('tokenizer_config.json', 282682), ...WHISPER_TOKENIZER],
    variants: {
      q8: { dtype: 'q8', files: [f('onnx/encoder_model_quantized.onnx', 23159167), f('onnx/decoder_model_merged_quantized.onnx', 53712708)] },
      fp16: { dtype: 'fp16', files: [f('onnx/encoder_model_fp16.onnx', 41270731), f('onnx/decoder_model_merged_fp16.onnx', 104701989)] },
    },
    // q8 on the GPU is slower than on the CPU
    prefer: { webgpu: ['fp16'], wasm: ['q8'] },
    light: 'whisper-tiny',
    speed: { webgpu: 'several times faster than real time', wasm: '≈1–3× real time on a computer, slower on phones' },
  },
  'whisper-large-turbo': {
    name: 'Whisper large-v3 turbo',
    summary: 'The most accurate Whisper that fits in a browser. Needs a good GPU.',
    repo: 'onnx-community/whisper-large-v3-turbo_timestamped',
    revision: 'b3f77bf9a8c4d5ea3415827033d1ffea7955fd9a',
    runtime: 'transformers',
    task: 'automatic-speech-recognition',
    license: { name: 'MIT', url: 'https://github.com/openai/whisper/blob/main/LICENSE' },
    credit: 'Whisper by OpenAI',
    shared: [f('config.json', 1330), f('generation_config.json', 3797), f('tokenizer_config.json', 282843), f('tokenizer.json', 2480645), f('preprocessor_config.json', 340)],
    variants: {
      q4f16: { dtype: 'q4f16', files: [f('onnx/encoder_model_q4f16.onnx', 370035242), f('onnx/decoder_model_merged_q4f16.onnx', 193566135)] },
      q4: { dtype: 'q4', files: [f('onnx/encoder_model_q4.onnx', 425003939), f('onnx/decoder_model_merged_q4.onnx', 334207912)] },
    },
    prefer: { webgpu: ['q4f16', 'q4'], wasm: [] },
    light: 'whisper-base',
    desktopOnly: true,
    // q4f16 matches the CPU's words (JFK, a noisy clip); q4 (fp32 math) is for GPUs without shader-f16.
    // ≈3.7× real time on an NVIDIA Ampere GPU (a 1 min mix, warm), language detection and word timings included
    speed: { webgpu: '≈2–4× faster than real time on a good graphics card' },
  },
  demucs: {
    name: 'Demucs (htdemucs)',
    summary: 'Splits a song into vocals, drums, bass and other instruments.',
    repo: 'timcsy/demucs-web-onnx',
    revision: '92e33df61cfc9eb820272aaa62d2ef6dcf4d950d',
    runtime: 'demucs',
    license: { name: 'MIT', url: 'https://github.com/facebookresearch/demucs/blob/main/LICENSE' },
    credit: 'Uses the open-source Demucs model by Meta (Alexandre Défossez et al.)',
    variants: { fp32: one('htdemucs_embedded.onnx', 180534758, 'fp32') },
    prefer: { webgpu: ['fp32'], wasm: ['fp32'] },
    desktopOnly: true,
    speed: { webgpu: '≈1–3 min per song', wasm: '10+ minutes per song' },
  },
  kokoro: {
    name: 'Kokoro 82M',
    summary: 'Natural-sounding speech in English and a few other languages.',
    repo: 'onnx-community/Kokoro-82M-v1.0-ONNX',
    revision: '1939ad2a8e416c0acfeecc08a694d14ef25f2231',
    runtime: 'kokoro',
    license: { name: 'Apache-2.0', url: 'https://huggingface.co/hexgrad/Kokoro-82M' },
    credit: 'Kokoro-82M by hexgrad',
    // one voice (~0.5 MB) is fetched on first use; others load when picked
    shared: [f('config.json', 44), f('tokenizer.json', 3497), f('tokenizer_config.json', 113), f('voices/af_heart.bin', 522240)],
    variants: { q8: one('onnx/model_quantized.onnx', 92361116, 'q8'), fp32: one('onnx/model.onnx', 325532232, 'fp32') },
    // q8 on the CPU (one thread: no cross-origin isolation) makes speech at about a third of real
    // time; fp32 on WebGPU (kokoro-js's ORT 1.22 JSEP) 3–9× faster than real time, same words
    prefer: { webgpu: ['fp32'], wasm: ['q8'] },
    speed: { webgpu: 'several times faster than real time', wasm: 'slower than real time on most computers' },
  },

  // ── text ────────────────────────────────────────────────────────────────────────────────
  'qwen3.5-0.8b': {
    name: 'Qwen3.5 0.8B',
    summary: 'A small multilingual chat model for summaries and rewrites. It can make mistakes.',
    repo: 'onnx-community/Qwen3.5-0.8B-Text-ONNX',
    revision: '25cdf33f386b487a25f3d743e86442517bdb77ff',
    runtime: 'transformers',
    task: 'text-generation',
    license: { name: 'Apache-2.0', url: 'https://huggingface.co/Qwen/Qwen3.5-0.8B' },
    credit: 'Qwen3.5 by the Qwen team, Alibaba Cloud',
    shared: [f('config.json', 1989), f('generation_config.json', 120), f('tokenizer.json', 19226111), f('tokenizer_config.json', 10027), f('chat_template.jinja', 7755)],
    variants: {
      q4f16: { dtype: 'q4f16', files: [f('onnx/model_q4f16.onnx', 597442), f('onnx/model_q4f16.onnx_data', 469331968)] },
      q4: { dtype: 'q4', files: [f('onnx/model_q4.onnx', 482783), f('onnx/model_q4.onnx_data', 550764544)] },
    },
    prefer: { webgpu: ['q4f16', 'q4'], wasm: [] },
    speed: { webgpu: '≈20–60 words a second' },
  },
  'opus-mt-en-es': opus('en-es', '4b002a4c7edd54a7ced58877258b87f7efd3f892', 'Apache-2.0', 52899742, 60212804, 6262682),
  'opus-mt-es-en': opus('es-en', 'eadfd7c658a9d8929ac3b8e996b68a68e2c7d480', 'Apache-2.0', 52899742, 60212804, 6262682),
  'opus-mt-en-fr': opus('en-fr', '28726206f80896b90035bd99cccd5cc1e151f916', 'Apache-2.0', 50090398, 57381512, 5637839),
  'opus-mt-fr-en': opus('fr-en', '6b166a182780e118c997879d0ad5be4b53671644', 'Apache-2.0', 50090398, 57381512, 5637839),
  'opus-mt-en-de': opus('en-de', '1ca130c44c4c5441ef16d48aae521a424ab644f7', 'CC-BY-4.0', 49366942, 56652404, 5498450),
  'opus-mt-de-en': opus('de-en', '399dfd68706739fffd503f876093e455ae268a06', 'Apache-2.0', 49366942, 56652404, 5498450),
  'opus-mt-en-it': opus('en-it', '075406e3c8c2c30634d4a1bd8f00c21d9e162011', 'Apache-2.0', 60597150, 67970348, 7904597),
  'opus-mt-it-en': opus('it-en', 'fd0b89b9c052adc1f2f64152f555aa17353728be', 'Apache-2.0', 60773278, 68147852, 7942314),
  'opus-mt-en-nl': opus('en-nl', 'c3a0541231a7329b4492809fc2bd7ab7d2ceb0bc', 'Apache-2.0', 53937565, 61258735, 6433167),
  'opus-mt-nl-en': opus('nl-en', '82c42d95d1508037cbe7172d85fd4e940a2f3584', 'Apache-2.0', 53937566, 61258736, 6433167),
  'opus-mt-en-ru': opus('en-ru', 'e050376e960175e8ddc5cff85025dc8436cddd68', 'Apache-2.0', 51628446, 58931576, 7205388),
  'opus-mt-ru-en': opus('ru-en', 'afe8c6c738ec81b6d033fd8f44f9678a639a7c67', 'CC-BY-4.0', 51628446, 58931576, 7205388),
  'opus-mt-en-zh': opus('en-zh', '046f55aec303cdee3e0318604406d4df20f1e8ea', 'Apache-2.0', 52899742, 60212804, 6380952),
  'opus-mt-zh-en': opus('zh-en', '39d480d52a9ea3065a1f117adfe4dbc55de10e6f', 'CC-BY-4.0', 52899742, 60212804, 6381339),
  'opus-mt-en-ar': opus('en-ar', '034a684356c19021a187cda4d7f823298b913921', 'Apache-2.0', 51773854, 59078120, 6748848),
  'opus-mt-ar-en': opus('ar-en', '09c7556866400dcc53562ba8d7035119e7d9a2c1', 'Apache-2.0', 51790238, 59094632, 6734647),
  'opus-mt-en-hi': opus('en-hi', '7aad72006a1588a9c3485ed6203aed99eebbc872', 'Apache-2.0', 51337630, 58638488, 6679560),
  'opus-mt-hi-en': opus('hi-en', '99853100ed9d932987a6816e8cf7b1b6742a6116', 'Apache-2.0', 50916254, 58213820, 6578153),
  'opus-mt-ja-en': opus('ja-en', '1a906cfaaf7c8f4193f67f5885c082aa6dbd9d16', 'Apache-2.0', 50705822, 58001744, 5991485),
  'opus-mt-ko-en': opus('ko-en', 'd9fa1ac6008242100fecb4fff9b0a5917a1be81f', 'Apache-2.0', 52899741, 60212803, 6487044),
  'opus-mt-pl-en': opus('pl-en', 'aeaf0e003b045248c28a559a5ce6027b54ebdaba', 'Apache-2.0', 52095390, 59402168, 6118576),
  'opus-mt-tr-en': opus('tr-en', '78247f41f354af036d24e6f0f8a3d02c6806f96e', 'Apache-2.0', 51562398, 58865012, 6123578),
  'opus-mt-uk-en': opus('uk-en', 'b2ad6afa424aaeff8913ff350860b7a7b7c0a607', 'Apache-2.0', 51151774, 58451180, 6922026),
  'opus-mt-en-uk': opus('en-uk', 'e6ca587292984b343fd829b6430ed55858496525', 'Apache-2.0', 51151774, 58451180, 6922026),
  'opus-mt-sv-en': opus('sv-en', '63a40256869b6a2b29a84e47aa7f03524fa5f3a2', 'Apache-2.0', 48513438, 55792232, 5450794),
  'opus-mt-en-sv': opus('en-sv', '33d522d806c041cdebecd549c558d22a2b9b4ea4', 'Apache-2.0', 48513438, 55792232, 5450794),
  'opus-mt-ROMANCE-en': opus('ROMANCE-en', 'f60feaabe8bb435a5871e7702b25f53a01e770f8', 'Apache-2.0', 52899741, 60212803, 6120151),
  'opus-mt-en-ROMANCE': opus('en-ROMANCE', '9d2ba69ac80c8e8453c3d9a1e2323a0e7b8ca3cd', 'Apache-2.0', 52899742, 60212804, 6117691),

  // ── video (MediaPipe; tiny, so they also suit self-hosting under /models) ───────────────
  'selfie-segmenter': {
    name: 'MediaPipe Selfie Segmenter',
    summary: 'Separates people from the background in real time.',
    repo: 'mediapipe-models/selfie_segmenter',
    revision: 'float16/1',
    baseUrl: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/',
    runtime: 'mediapipe',
    license: { name: 'Apache-2.0', url: 'https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE' },
    credit: 'MediaPipe Selfie Segmentation by Google',
    variants: { fp16: one('selfie_segmenter.tflite', 249537, 'fp16') },
    prefer: { webgpu: [], wasm: ['fp16'] },
    speed: { wasm: 'real time' },
  },
  'face-detector': {
    name: 'MediaPipe BlazeFace',
    summary: 'Finds faces quickly, for tracking and auto-framing.',
    repo: 'mediapipe-models/blaze_face_short_range',
    revision: 'float16/1',
    baseUrl: '/models/',
    runtime: 'mediapipe',
    license: { name: 'Apache-2.0', url: 'https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE' },
    credit: 'MediaPipe BlazeFace by Google',
    variants: { fp16: one('blaze_face_short_range.tflite', 229746, 'fp16') },
    prefer: { webgpu: [], wasm: ['fp16'] },
    speed: { wasm: 'real time' },
  },
} satisfies Record<string, ModelSpec>;

export type ModelKey = keyof typeof MODELS;

export function getModel(model: ModelKey | ModelSpec): ModelSpec {
  return typeof model === 'string' ? MODELS[model] : model;
}

/** The registry's lighter alternative to a model, if any */
export const lightModel = (model: ModelKey): ModelKey | undefined => getModel(model).light as ModelKey | undefined;

/** The pinned URL of one file, e.g. https://huggingface.co/Xenova/modnet/resolve/fa2f…/onnx/model_quantized.onnx */
export function modelUrl(model: ModelKey | ModelSpec, file: string): string {
  const m = getModel(model);
  return `${m.baseUrl ?? `https://huggingface.co/${m.repo}/resolve/${m.revision}/`}${file}`;
}

/** Every file a variant downloads, shared config files included */
export function variantFiles(model: ModelKey | ModelSpec, variant: string): ModelFile[] {
  const m = getModel(model);
  const v = m.variants[variant] as Variant | undefined;
  if (!v) throw new Error(`${m.name} has no "${variant}" variant`);
  return [...(m.shared ?? []), ...v.files];
}

/** Bytes a variant downloads the first time */
export function totalDownloadSize(model: ModelKey | ModelSpec, variant: string): number {
  return variantFiles(model, variant).reduce((sum, file) => sum + file.bytes, 0);
}

/** fp16 weights on WebGPU need the GPU's shader-f16 feature */
export function needsF16(v: Variant): boolean {
  const dtypes = typeof v.dtype === 'object' ? Object.values(v.dtype) : [v.dtype ?? 'fp32'];
  return dtypes.some((d) => d.includes('16'));
}

export interface Choice {
  device: Device;
  variant: string;
}

/** phones skip GPU variants bigger than this when a CPU variant exists (data plans, storage) */
const MOBILE_GPU_MAX_BYTES = 200e6;

/**
 * The best variant for this device: WebGPU when the model and the browser support it (skipping
 * fp16 variants on GPUs without shader-f16 unless they're widened to fp32, and very large ones on
 * phones), the CPU otherwise.
 * Null when the model needs WebGPU and this browser has none.
 */
export function pickVariant(model: ModelKey | ModelSpec, gpu: { webgpu: boolean; fp16: boolean; isMobile?: boolean }): Choice | null {
  const m = getModel(model);
  if (gpu.webgpu) {
    const tooBig = (k: string) => !!gpu.isMobile && m.prefer.wasm.length > 0 && totalDownloadSize(m, k) > MOBILE_GPU_MAX_BYTES;
    // a model widened to fp32 when it opens needs no shader-f16
    const variant = m.prefer.webgpu.find((k) => (gpu.fp16 || m.patch === 'fp32' || !needsF16(m.variants[k])) && !tooBig(k));
    if (variant) return { device: 'webgpu', variant };
  }
  const variant = m.prefer.wasm[0];
  return variant ? { device: 'wasm', variant } : null;
}
