// lib/sample-data.ts — the prototype's sample data typed as the shared contracts. Owned by W1.
// Used (1) by lib/data loaders as a fallback when Supabase is not reachable and
// (2) by W3 to generate supabase/seed.sql, so ids here and in the seed must match.
import type {
  ApiOffer, Calibration, Device, EtaCalibration, FileFormat, FileKind, FileRow, Metric, Modality,
  ModelRow, RunStat, SourceId, SourceScore, SourceStatus,
} from './contracts';

export interface Creator { id: string; name: string; defaultSelected: boolean }

const HOUR = 3.6e6;
const ago = (h: number) => new Date(Date.now() - h * HOUR).toISOString();

/** Display names + sync age of the four benchmark sources (prototype SOURCES). */
export const SOURCE_NAMES: Record<SourceId, string> = {
  aa: 'Artificial Analysis', arena: 'Arena', livebench: 'LiveBench', epoch: 'Epoch AI',
};
const SOURCE_AGE_H: Record<SourceId, number> = { aa: 3, arena: 5, livebench: 24, epoch: 40 };
const SOURCE_SCALE: Record<SourceId, SourceScore['scale']> = { aa: 'index', arena: 'elo', livebench: 'pct', epoch: 'index' };

// ---------------------------------------------------------------- creators
const PROVIDERS = ['OpenAI', 'Anthropic', 'Google', 'Meta', 'Mistral', 'DeepSeek', 'Alibaba', 'Moonshot AI', 'xAI', 'Microsoft', 'NVIDIA', 'Amazon', 'Cohere', 'AI21 Labs', 'IBM', 'Zhipu AI', 'MiniMax', 'Baidu', 'Tencent', 'ByteDance', 'StepFun', '01.AI', 'LG AI Research', 'Upstage', 'Reka', 'Liquid AI', 'Ai2', 'Nous Research', 'Perplexity', 'Snowflake', 'Databricks', 'ServiceNow', 'Salesforce', 'Apple', 'Xiaomi', 'Meituan', 'Kuaishou', 'Sarvam AI', 'TII', 'Stability AI', 'Inception', 'Arcee AI', 'Deep Cogito', 'Swiss AI', 'Kakao', 'Naver', 'Prime Intellect', 'Essential AI'];
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const SAMPLE_CREATORS: Creator[] = PROVIDERS.map((name, i) => ({ id: slug(name), name, defaultSelected: i < 12 }));

// ---------------------------------------------------------------- models
interface RawModel {
  id: string; name: string; creator: string; open: boolean; reasoning: boolean; inMod: Modality[]; outMod: Modality[]; ctxK: number;
  priceIn: number; priceOut: number; tps: number; ttft: number; taskIn: number; taskOut: number;
  aa: number; arena: number; livebench: number; epoch: number | null;
  coding: number; agentic: number; cyber: number; math: number; longCtx: number;
  totalB?: number; activeB?: number; kvKb?: number; hfRepo?: string;
}
const RAW: RawModel[] = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', creator: 'Anthropic', open: false, reasoning: true, inMod: ['text', 'image', 'file'], outMod: ['text'], ctxK: 1000, priceIn: 4, priceOut: 20, tps: 114, ttft: 2.4, taskIn: 42000, taskOut: 9000, aa: 59.1, arena: 1498, livebench: 81.2, epoch: 161, coding: 96, agentic: 95, cyber: 93, math: 90, longCtx: 92 },
  { id: 'gpt-6-astra', name: 'GPT-6 Astra', creator: 'OpenAI', open: false, reasoning: true, inMod: ['text', 'image', 'audio', 'file'], outMod: ['text', 'image'], ctxK: 400, priceIn: 3.5, priceOut: 18, tps: 96, ttft: 3.1, taskIn: 40000, taskOut: 11000, aa: 56.9, arena: 1505, livebench: 80.1, epoch: 158, coding: 92, agentic: 91, cyber: 90, math: 97, longCtx: 88 },
  { id: 'gemini-3-5-pro', name: 'Gemini 3.5 Pro', creator: 'Google', open: false, reasoning: true, inMod: ['text', 'image', 'audio', 'video', 'file'], outMod: ['text', 'audio'], ctxK: 2000, priceIn: 2, priceOut: 12, tps: 142, ttft: 2.0, taskIn: 41000, taskOut: 10000, aa: 54.2, arena: 1489, livebench: 77.9, epoch: null, coding: 88, agentic: 86, cyber: 84, math: 93, longCtx: 98 },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', creator: 'Anthropic', open: false, reasoning: true, inMod: ['text', 'image', 'file'], outMod: ['text'], ctxK: 1000, priceIn: 2, priceOut: 10, tps: 168, ttft: 1.4, taskIn: 38000, taskOut: 8000, aa: 52.8, arena: 1470, livebench: 76.0, epoch: 149, coding: 91, agentic: 90, cyber: 87, math: 82, longCtx: 88 },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', creator: 'Anthropic', open: false, reasoning: false, inMod: ['text', 'image'], outMod: ['text'], ctxK: 400, priceIn: 0.6, priceOut: 3, tps: 260, ttft: 0.6, taskIn: 36000, taskOut: 5000, aa: 41.0, arena: 1402, livebench: 63.5, epoch: null, coding: 74, agentic: 72, cyber: 68, math: 62, longCtx: 70 },
  { id: 'kimi-k2-5', name: 'Kimi K2.5', creator: 'Moonshot AI', open: true, reasoning: true, inMod: ['text', 'image'], outMod: ['text'], ctxK: 256, priceIn: 0.6, priceOut: 2.5, tps: 58, ttft: 1.9, taskIn: 44000, taskOut: 14000, aa: 47.3, arena: 1441, livebench: 71.8, epoch: 141, coding: 84, agentic: 88, cyber: 78, math: 80, longCtx: 78, totalB: 1000, activeB: 32, kvKb: 70, hfRepo: 'moonshotai/Kimi-K2.5' },
  { id: 'deepseek-v4-1-flash', name: 'DeepSeek-V4.1-Flash', creator: 'DeepSeek', open: true, reasoning: true, inMod: ['text'], outMod: ['text'], ctxK: 160, priceIn: 0.27, priceOut: 1.1, tps: 74, ttft: 1.2, taskIn: 43000, taskOut: 12000, aa: 45.1, arena: 1430, livebench: 70.2, epoch: null, coding: 81, agentic: 79, cyber: 76, math: 86, longCtx: 74, totalB: 284, activeB: 13, kvKb: 36, hfRepo: 'deepseek-ai/DeepSeek-V4.1-Flash' },
  { id: 'qwen3-8-flash-next', name: 'Qwen3.8-Flash-Next', creator: 'Alibaba', open: true, reasoning: true, inMod: ['text', 'image', 'video'], outMod: ['text'], ctxK: 262, priceIn: 0.15, priceOut: 0.9, tps: 190, ttft: 0.7, taskIn: 42000, taskOut: 13000, aa: 42.6, arena: 1418, livebench: 67.4, epoch: 133, coding: 77, agentic: 80, cyber: 71, math: 79, longCtx: 82, totalB: 80, activeB: 3, kvKb: 24, hfRepo: 'Qwen/Qwen3.8-Flash-Next' },
  { id: 'qwen3-8-27b', name: 'Qwen3.8-27B', creator: 'Alibaba', open: true, reasoning: true, inMod: ['text', 'image'], outMod: ['text'], ctxK: 262, priceIn: 0.1, priceOut: 0.6, tps: 88, ttft: 0.6, taskIn: 40000, taskOut: 12000, aa: 40.2, arena: 1405, livebench: 65.0, epoch: null, coding: 75, agentic: 73, cyber: 66, math: 78, longCtx: 72, totalB: 27, activeB: 27, kvKb: 64, hfRepo: 'Qwen/Qwen3.8-27B' },
  { id: 'gemma-4-26b', name: 'Gemma 4 26B', creator: 'Google', open: true, reasoning: false, inMod: ['text', 'image', 'audio'], outMod: ['text'], ctxK: 128, priceIn: 0.08, priceOut: 0.35, tps: 120, ttft: 0.5, taskIn: 36000, taskOut: 6000, aa: 35.4, arena: 1388, livebench: 60.1, epoch: null, coding: 66, agentic: 64, cyber: 58, math: 70, longCtx: 66, totalB: 26, activeB: 26, kvKb: 48, hfRepo: 'google/gemma-4-26b-it' },
];

function scoresOf(r: RawModel): SourceScore[] {
  const s = (source: SourceId, metric: Metric, value: number): SourceScore => ({ source, metric, value, scale: SOURCE_SCALE[source], fetchedAt: ago(SOURCE_AGE_H[source]) });
  return [
    s('aa', 'intelligence', r.aa), s('arena', 'intelligence', r.arena), s('livebench', 'intelligence', r.livebench),
    ...(r.epoch != null ? [s('epoch', 'intelligence', r.epoch)] : []),
    s('aa', 'coding', r.coding), s('aa', 'agentic', r.agentic), s('aa', 'cyber', r.cyber), s('aa', 'math', r.math), s('aa', 'long_ctx', r.longCtx),
  ];
}
function offersOf(r: RawModel): ApiOffer[] {
  const o = (provider: string, source: ApiOffer['source'], k: number, tk: number): ApiOffer => ({
    provider, source, priceIn: +(r.priceIn * k).toFixed(3), priceOut: +(r.priceOut * k).toFixed(3), priceCache: null,
    tpsMedian: Math.round(r.tps * tk), ttftS: r.ttft, contextK: r.ctxK, quantization: null, fetchedAt: ago(SOURCE_AGE_H.aa),
  });
  // maker's own API (picked by default) + AA median; open models also get a cheaper third-party host
  return [o(r.creator, 'openrouter', 1, 1), o('AA median', 'aa', 1, 1), ...(r.open ? [o('DeepInfra', 'openrouter', 0.8, 0.85)] : [])];
}
export const SAMPLE_MODELS: ModelRow[] = RAW.map(r => ({
  id: r.id, familyId: null, name: r.name, creatorId: slug(r.creator), creatorName: r.creator,
  openWeights: r.open, reasoning: r.reasoning, inModalities: r.inMod, outModalities: r.outMod, contextK: r.ctxK,
  totalParamsB: r.totalB ?? null, activeParamsB: r.activeB ?? null,
  kvBytesPerToken: r.kvKb != null ? r.kvKb * 1024 : null, // prototype kv_kb = KiB per token
  hfRepo: r.hfRepo ?? null, scores: scoresOf(r), offers: offersOf(r),
  task: { inTokens: r.taskIn, outTokens: r.taskOut, estimated: false },
}));

// ---------------------------------------------------------------- files (prototype VARIANTS)
type V = [repo: string, quant: string, bits: number, gb: number, kld: number | null, format?: FileFormat, kind?: FileKind];
const VARIANTS: Record<string, V[]> = {
  'kimi-k2-5': [['moonshotai/Kimi-K2.5', 'INT4 native', 4.5, 595, 0, 'int4', 'official'], ['unsloth/Kimi-K2.5-GGUF', 'UD-Q2_K_XL', 2.7, 375, 0.11], ['unsloth/Kimi-K2.5-GGUF', 'UD-TQ1_0', 1.8, 240, 0.29], ['bartowski/Kimi-K2.5-GGUF', 'IQ2_XXS', 2.1, 290, 0.21], ['example-user/Kimi-K2.5-abliterated-GGUF', 'Q2_K', 2.6, 360, null, 'gguf', 'abliterated']],
  'deepseek-v4-1-flash': [['deepseek-ai/DeepSeek-V4.1-Flash', 'FP8', 8, 290, 0, 'fp8', 'official'], ['unsloth/DeepSeek-V4.1-Flash-GGUF', 'UD-Q4_K_XL', 4.6, 168, 0.03], ['unsloth/DeepSeek-V4.1-Flash-GGUF', 'UD-Q2_K_XL', 2.7, 99, 0.12], ['bartowski/DeepSeek-V4.1-Flash-GGUF', 'Q4_K_M', 4.8, 172, 0.035], ['bartowski/DeepSeek-V4.1-Flash-GGUF', 'IQ3_M', 3.6, 128, 0.07]],
  'qwen3-8-flash-next': [['Qwen/Qwen3.8-Flash-Next', 'BF16', 16, 160, 0, 'bf16', 'official'],
    ['unsloth/Qwen3.8-Flash-Next-GGUF', 'UD-Q2_K_XL', 2.9, 30, 0.10], ['unsloth/Qwen3.8-Flash-Next-GGUF', 'UD-Q3_K_XL', 3.8, 38, 0.05], ['unsloth/Qwen3.8-Flash-Next-GGUF', 'UD-Q4_K_XL', 4.6, 47, 0.02], ['unsloth/Qwen3.8-Flash-Next-GGUF', 'UD-Q8_K_XL', 8.5, 86, 0.004],
    ['bartowski/Qwen_Qwen3.8-Flash-Next-GGUF', 'Q3_K_M', 3.9, 39, 0.062], ['bartowski/Qwen_Qwen3.8-Flash-Next-GGUF', 'Q4_K_M', 4.8, 48.5, 0.025], ['bartowski/Qwen_Qwen3.8-Flash-Next-GGUF', 'Q6_K', 6.6, 66, 0.007],
    ['ggml-org/Qwen3.8-Flash-Next-GGUF', 'Q4_K_M', 4.8, 48.5, 0.031], ['ggml-org/Qwen3.8-Flash-Next-GGUF', 'Q8_0', 8.5, 85, 0.0045],
    ['example-user/Qwen3.8-Flash-Next-coder-ft', 'Q4_K_M', 4.8, 48, null, 'gguf', 'finetune']],
  'qwen3-8-27b': [['Qwen/Qwen3.8-27B', 'BF16', 16, 54, 0, 'bf16', 'official'],
    ['unsloth/Qwen3.8-27B-GGUF', 'UD-Q2_K_XL', 2.9, 9.8, 0.09], ['unsloth/Qwen3.8-27B-GGUF', 'UD-Q3_K_XL', 3.7, 12.6, 0.045], ['unsloth/Qwen3.8-27B-GGUF', 'UD-Q4_K_XL', 4.8, 17, 0.02], ['unsloth/Qwen3.8-27B-GGUF', 'UD-Q5_K_XL', 5.7, 19.6, 0.009], ['unsloth/Qwen3.8-27B-GGUF', 'UD-Q6_K_XL', 6.8, 23, 0.004], ['unsloth/Qwen3.8-27B-GGUF', 'Q8_0', 8.5, 28.7, 0.001],
    ['bartowski/Qwen_Qwen3.8-27B-GGUF', 'Q2_K', 3.1, 10.5, 0.12], ['bartowski/Qwen_Qwen3.8-27B-GGUF', 'IQ3_M', 3.6, 12.1, 0.052], ['bartowski/Qwen_Qwen3.8-27B-GGUF', 'Q4_K_M', 4.9, 16.5, 0.024], ['bartowski/Qwen_Qwen3.8-27B-GGUF', 'Q5_K_M', 5.7, 19.2, 0.011], ['bartowski/Qwen_Qwen3.8-27B-GGUF', 'Q6_K', 6.6, 22.2, 0.005], ['bartowski/Qwen_Qwen3.8-27B-GGUF', 'Q8_0', 8.5, 28.7, 0.001],
    ['lmstudio-community/Qwen3.8-27B-GGUF', 'Q3_K_L', 4.3, 14.5, 0.06], ['lmstudio-community/Qwen3.8-27B-GGUF', 'Q4_K_M', 4.9, 16.5, 0.028], ['lmstudio-community/Qwen3.8-27B-GGUF', 'Q6_K', 6.6, 22.2, 0.006],
    ['mradermacher/Qwen3.8-27B-i1-GGUF', 'i1-IQ2_M', 2.8, 9.4, 0.14], ['mradermacher/Qwen3.8-27B-i1-GGUF', 'i1-IQ3_S', 3.6, 12, 0.058], ['mradermacher/Qwen3.8-27B-i1-GGUF', 'i1-Q4_K_M', 4.9, 16.5, 0.023], ['mradermacher/Qwen3.8-27B-i1-GGUF', 'i1-Q5_K_M', 5.7, 19.2, 0.01],
    ['ggml-org/Qwen3.8-27B-GGUF', 'Q4_K_M', 4.9, 16.5, 0.03], ['ggml-org/Qwen3.8-27B-GGUF', 'Q8_0', 8.5, 28.7, 0.0013]],
  'gemma-4-26b': [['google/gemma-4-26b-it', 'BF16', 16, 52, 0, 'bf16', 'official'], ['google/gemma-4-26b-it-qat-q4_0-gguf', 'QAT Q4_0', 4.5, 15, 0.01], ['unsloth/gemma-4-26b-it-GGUF', 'UD-Q4_K_XL', 4.8, 16, 0.018], ['bartowski/google_gemma-4-26b-it-GGUF', 'Q4_K_M', 4.9, 16.2, 0.022]],
};
export const SAMPLE_EVAL_SET = 'prototype-sample';
let fileId = 0;
export const SAMPLE_FILES: FileRow[] = Object.entries(VARIANTS).flatMap(([modelId, vs]) => vs.map(([repo, quant, bits, gb, kld, format = 'gguf', kind = 'quant']) => ({
  id: ++fileId, modelId, repo, uploader: repo.split('/')[0], quant, format, bitsPerWeight: bits, sizeGb: gb, kind, downloads: null,
  quality: kld == null ? [] : [{ kld, evalSet: SAMPLE_EVAL_SET, source: kld === 0 ? 'reference' : 'prototype', measuredAt: ago(72) }],
})));

// ---------------------------------------------------------------- devices (prototype DEVICES)
type D = [id: string, name: string, category: string, type: Device['type'], memGb: number, bwGbs: number, tf: number, fp8: boolean, backend: Device['backend']];
const DEVICES: D[] = [
  ['spark', 'NVIDIA DGX Spark', 'AI box', 'unified', 128, 273, 125, true, 'cuda'],
  ['aimax', 'AMD Ryzen AI Max+ 395 (128GB)', 'AI box', 'unified', 128, 256, 59, false, 'rocm'],
  ['orin', 'NVIDIA Jetson AGX Orin 64GB', 'AI box', 'unified', 64, 205, 21, false, 'cuda'],
  ['mini24', 'Mac mini M4 Pro 24GB', 'Mac', 'unified', 24, 273, 17, false, 'metal'],
  ['mini64', 'Mac mini M4 Pro 64GB', 'Mac', 'unified', 64, 273, 17, false, 'metal'],
  ['mbp128', 'MacBook Pro M4 Max 128GB', 'Mac', 'unified', 128, 546, 34, false, 'metal'],
  ['stu128', 'Mac Studio M4 Max 128GB', 'Mac', 'unified', 128, 546, 34, false, 'metal'],
  ['stu512', 'Mac Studio M3 Ultra 512GB', 'Mac', 'unified', 512, 819, 57, false, 'metal'],
  ['r3090', 'GeForce RTX 3090', 'GPU', 'gpu', 24, 936, 71, false, 'cuda'],
  ['r4060t', 'GeForce RTX 4060 Ti 16GB', 'GPU', 'gpu', 16, 288, 44, true, 'cuda'],
  ['r4090', 'GeForce RTX 4090', 'GPU', 'gpu', 24, 1008, 165, true, 'cuda'],
  ['r5080', 'GeForce RTX 5080', 'GPU', 'gpu', 16, 960, 113, true, 'cuda'],
  ['r5090', 'GeForce RTX 5090', 'GPU', 'gpu', 32, 1792, 209, true, 'cuda'],
  ['xtx', 'Radeon RX 7900 XTX', 'GPU', 'gpu', 24, 960, 123, false, 'rocm'],
  ['a6k', 'RTX 6000 Ada 48GB', 'Workstation GPU', 'gpu', 48, 960, 364, true, 'cuda'],
  ['p6k', 'RTX PRO 6000 Blackwell 96GB', 'Workstation GPU', 'gpu', 96, 1792, 500, true, 'cuda'],
  ['l40s', 'L40S 48GB', 'Data center', 'gpu', 48, 864, 362, true, 'cuda'],
  ['a100', 'A100 80GB', 'Data center', 'gpu', 80, 2039, 312, false, 'cuda'],
  ['h100', 'H100 80GB SXM', 'Data center', 'gpu', 80, 3350, 989, true, 'cuda'],
  ['r4090l', 'RTX 4090 Laptop 16GB', 'Laptop GPU', 'gpu', 16, 576, 80, true, 'cuda'],
];
export const SAMPLE_DEVICES: Device[] = DEVICES.map(([id, name, category, type, memGb, bwGbs, fp16Tflops, fp8, backend]) => ({
  id, name, category, type, memGb, bwGbs, fp16Tflops, fp8, fp4: false, backend, usableFrac: null, source: 'curated', verified: true,
}));

// ---------------------------------------------------------------- measured runs (prototype MEASURED)
type M = [device: string, model: string, quant: string, uploader: string, runtime: string, gen: number, prompt: number, runs: number];
const MEASURED: M[] = [
  ['spark', 'qwen3-8-flash-next', 'UD-Q4_K_XL', 'unsloth', 'llama.cpp', 58, 2100, 14], ['spark', 'qwen3-8-27b', 'UD-Q4_K_XL', 'unsloth', 'llama.cpp', 9.6, 640, 9], ['spark', 'qwen3-8-27b', 'Q8_0', 'unsloth', 'llama.cpp', 6.1, 610, 4],
  ['spark', 'deepseek-v4-1-flash', 'UD-Q2_K_XL', 'unsloth', 'llama.cpp', 24, 880, 4], ['spark', 'gemma-4-26b', 'QAT Q4_0', 'google', 'llama.cpp', 11.8, 700, 6],
  ['r4090', 'qwen3-8-27b', 'Q4_K_M', 'bartowski', 'llama.cpp', 41, 2900, 23], ['r4090', 'qwen3-8-27b', 'UD-Q4_K_XL', 'unsloth', 'llama.cpp', 39, 2850, 17], ['r4090', 'gemma-4-26b', 'QAT Q4_0', 'google', 'llama.cpp', 46, 3500, 11],
  ['r5090', 'qwen3-8-27b', 'UD-Q5_K_XL', 'unsloth', 'llama.cpp', 55, 4800, 8], ['r5090', 'qwen3-8-27b', 'UD-Q4_K_XL', 'unsloth', 'llama.cpp', 61, 5100, 12],
  ['mbp128', 'qwen3-8-flash-next', 'UD-Q4_K_XL', 'unsloth', 'MLX', 72, 900, 6], ['mbp128', 'qwen3-8-27b', 'UD-Q4_K_XL', 'unsloth', 'llama.cpp', 18, 310, 5],
  ['stu512', 'kimi-k2-5', 'UD-TQ1_0', 'unsloth', 'llama.cpp', 17, 120, 5], ['stu512', 'deepseek-v4-1-flash', 'UD-Q4_K_XL', 'unsloth', 'llama.cpp', 27, 190, 3],
];
export const SAMPLE_RUN_STATS: RunStat[] = MEASURED.map(([deviceId, modelId, quant, uploader, runtime, gen, prompt, nRuns]) => {
  const f = SAMPLE_FILES.find(x => x.modelId === modelId && x.quant === quant && x.uploader === uploader);
  if (!f) throw new Error(`sample run without file: ${modelId} ${uploader} ${quant}`);
  return { deviceId, fileId: f.id, runtime, nRuns, genP50: gen, genP25: +(gen * 0.95).toFixed(1), genP75: +(gen * 1.05).toFixed(1), promptP50: prompt, anyVerified: true, lastRun: ago(12) };
});

// ---------------------------------------------------------------- calibrations
// Theil–Sen fit of each source onto the AA intelligence scale over the sample models.
// Sample only: the nightly job uses lib/engine fitCalibrations (needs 8+ overlapping models).
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function fit(source: SourceId): Calibration {
  const pairs = SAMPLE_MODELS.flatMap(m => {
    const r = m.scores.find(s => s.source === 'aa' && s.metric === 'intelligence')?.value, x = m.scores.find(s => s.source === source && s.metric === 'intelligence')?.value;
    return r != null && x != null ? [[x, r] as const] : [];
  });
  const sl: number[] = [];
  for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) if (pairs[j][0] !== pairs[i][0]) sl.push((pairs[j][1] - pairs[i][1]) / (pairs[j][0] - pairs[i][0]));
  const b = med(sl);
  return { source, metric: 'intelligence', a: +med(pairs.map(([x, y]) => y - b * x)).toFixed(4), b: +b.toFixed(6), nOverlap: pairs.length };
}
const METRICS: Metric[] = ['intelligence', 'coding', 'agentic', 'cyber', 'math', 'long_ctx'];
export const SAMPLE_CALIBRATIONS: Calibration[] = [
  ...(['arena', 'livebench', 'epoch'] as SourceId[]).map(fit),
  ...METRICS.map((metric): Calibration => ({ source: 'aa', metric, a: 0, b: 1, nOverlap: SAMPLE_MODELS.length })),
];
export const SAMPLE_ETA: EtaCalibration[] = [];

// ---------------------------------------------------------------- ops
export const SAMPLE_SOURCE_STATUS: SourceStatus[] = [
  { source: 'aa', finishedAt: ago(SOURCE_AGE_H.aa), ok: true, error: null },
  { source: 'arena', finishedAt: ago(SOURCE_AGE_H.arena), ok: true, error: null },
  { source: 'livebench', finishedAt: ago(SOURCE_AGE_H.livebench), ok: true, error: null },
  { source: 'epoch', finishedAt: ago(SOURCE_AGE_H.epoch), ok: true, error: null },
  { source: 'openrouter', finishedAt: ago(2), ok: true, error: null },
  { source: 'hf-sync', finishedAt: ago(1), ok: true, error: null },
];
