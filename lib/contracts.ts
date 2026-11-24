// lib/contracts.ts: shared types, FROZEN (copied verbatim from SPEC.md "Shared contracts"). Only the Lead (W1) may change this file.
export type SourceId = 'aa' | 'arena' | 'livebench' | 'epoch';
export type Metric = 'intelligence' | 'coding' | 'agentic' | 'cyber' | 'math' | 'long_ctx';
export type Modality = 'text' | 'image' | 'audio' | 'video' | 'file';

export interface SourceScore { source: SourceId; metric: Metric; value: number; scale: 'index' | 'elo' | 'pct'; fetchedAt: string }
export interface ApiOffer { provider: string; source: 'aa' | 'openrouter'; priceIn: number | null; priceOut: number | null; priceCache: number | null; tpsMedian: number | null; ttftS: number | null; contextK: number | null; quantization: string | null; fetchedAt: string }
export interface ModelRow {
  id: string; familyId: string | null; name: string; creatorId: string; creatorName: string;
  openWeights: boolean; reasoning: boolean | null; inModalities: Modality[]; outModalities: Modality[];
  contextK: number | null; totalParamsB: number | null; activeParamsB: number | null; kvBytesPerToken: number | null;
  hfRepo: string | null; scores: SourceScore[]; offers: ApiOffer[];
  task: { inTokens: number; outTokens: number; estimated: boolean } | null;
}

export type FileFormat = 'gguf' | 'bf16' | 'fp16' | 'fp8' | 'int4' | 'mlx' | 'awq' | 'gptq';
export type FileKind = 'official' | 'quant' | 'finetune' | 'abliterated' | 'merge';
export interface FileQuality { kld: number | null; evalSet: string; source: string; measuredAt: string }
export interface FileRow { id: number; modelId: string; repo: string; uploader: string; quant: string; format: FileFormat; bitsPerWeight: number; sizeGb: number; kind: FileKind; downloads: number | null; quality: FileQuality[] }

export type DeviceType = 'gpu' | 'unified' | 'cpu';
export type Backend = 'cuda' | 'rocm' | 'metal' | 'vulkan' | 'cpu';
export interface Device { id: string; name: string; category: string; type: DeviceType; memGb: number; bwGbs: number; fp16Tflops: number | null; fp8: boolean; fp4: boolean; backend: Backend; usableFrac: number | null; source: 'curated' | 'dbgpu' | 'probe'; verified: boolean }
export interface RunStat { deviceId: string; fileId: number; runtime: string; nRuns: number; genP50: number; genP25: number; genP75: number; promptP50: number | null; anyVerified: boolean; lastRun: string }
export interface SourceStatus { source: string; finishedAt: string; ok: boolean; error: string | null }
export interface Calibration { source: SourceId; metric: Metric; a: number; b: number; nOverlap: number }
export interface EtaCalibration { deviceType: DeviceType; runtime: string; moe: boolean; eta: number; nRuns: number }

// hardware ------------------------------------------------------------
export type Arch = 'discrete' | 'unified' | 'cpu';
export type Link = 'none' | 'pcie' | 'nvlink' | 'network';
export interface HardwareSpec {
  arch: Arch; gpus: number; vramGb: number; gpuBwGbs: number; link: Link;
  ramGb: number; ramBwGbs: number; fp16Tflops: number; fp8: boolean; backend: Backend;
  diskFreeGb: number; diskReadGbs: number;
  deviceId?: string;                                   // set when the setup is exactly one catalog device
  single?: { memGb: number; bwGbs: number; fp16Tflops: number }; // largest single device
  macGpuCap?: number;                                  // default 0.75
}
export interface SetupPick { deviceId: string; qty: number }
export interface HostPc { ramGb: number; ramBwGbs: number; diskFreeGb: number; diskReadGbs: number }

// engine outputs --------------------------------------------------------
export interface ScoredModel extends ModelRow {
  intelligence: number | null;                         // calibrated weighted average
  domain: Record<Metric, number | null>;
  perSource: { source: SourceId; metric: Metric; raw: number; calibrated: number; fetchedAt: string }[];
  nSources: number; spread: number | null; flags: ('one-source' | 'disagree' | 'stale')[];
  offer: ApiOffer | null;                              // chosen provider
  costPerTask: number | null; timePerTask: number | null; blendedPrice: number | null; costEstimated: boolean;
}
export type Where = 'gpu' | 'offload' | 'cpu' | 'no';
export interface FitResult {
  fileId: number; where: Where; why: string | null; needGb: number; fitsDisk: boolean; soloDevice: boolean;
  runtime: string | null;
  speed: { kind: 'measured'; p50: number; p25: number; p75: number; nRuns: number }
       | { kind: 'estimate'; mid: number; lo: number; hi: number } | null;
  promptTps: number | null; loadS: number | null;
}
export interface ModelFit { modelId: string; best: FitResult; all: FitResult[] }
export interface RecommendInput {
  weights: { intelligence: number; speed: number; cost: number };   // 1..10 each
  openWeights: 'any' | 'open' | 'closed'; reasoning: 'any' | 'yes' | 'no';
  inputs: Modality[]; outputs: Modality[]; minContextK: number; focus: Metric; providers: string[];
}
export interface Recommendation { model: ScoredModel; match: number }   // 0..100
export interface QuantView { points: FileRow[]; frontier: number[]; bestUnder: number | null; uploaderGap: { a: FileRow; b: FileRow; ratio: number } | null }
