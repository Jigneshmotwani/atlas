// lib/engine/hardware.ts — setup → HardwareSpec, memory budgets, file fit + speed (SPEC "Engine").
import type { Device, DeviceType, EtaCalibration, FileRow, FitResult, HardwareSpec, HostPc, ModelFit, ModelRow, RunStat, SetupPick } from '../contracts';
import { K } from './constants';

type FitCtx = { runStats: RunStat[]; eta: EtaCalibration[] };
type Item = { d: Device; qty: number };

const usableFrac = (d: Device) => d.usableFrac ?? (d.type === 'gpu' ? K.usable.discrete : d.backend === 'metal' ? K.usable.macDefault : K.usable.unified);
const sumMem = (xs: Item[]) => xs.reduce((a, x) => a + x.d.memGb * x.qty, 0);
const sumTf = (xs: Item[]) => xs.reduce((a, x) => a + (x.d.fp16Tflops ?? 0) * x.qty, 0);
const largest = (xs: Item[]) => [...xs].sort((a, b) => b.d.memGb - a.d.memGb)[0].d;
const singleOf = (d: Device) => ({ memGb: d.memGb * usableFrac(d), bwGbs: d.bwGbs, fp16Tflops: d.fp16Tflops ?? 0 });

export function specFromPicks(picks: SetupPick[], devices: Device[], host: HostPc): HardwareSpec | null {
  const items = picks.filter(p => p.qty > 0).flatMap((p): Item[] => { const d = devices.find(d => d.id === p.deviceId); return d ? [{ d, qty: p.qty }] : []; });
  if (!items.length) return null;
  const uni = items.filter(x => x.d.type === 'unified'), gpu = items.filter(x => x.d.type === 'gpu'), cpu = items.filter(x => x.d.type === 'cpu');
  const deviceId = items.length === 1 && items[0].qty === 1 ? items[0].d.id : undefined;
  const disk = { diskFreeGb: host.diskFreeGb, diskReadGbs: host.diskReadGbs };
  if (gpu.length) {
    // discrete GPUs hold the weights; unified boxes add RAM over the network; CPU-only devices are covered by the host PC
    const cnt = gpu.reduce((a, x) => a + x.qty, 0), big = largest(gpu);
    return { arch: 'discrete', gpus: cnt, vramGb: sumMem(gpu) / cnt, gpuBwGbs: Math.min(...gpu.map(x => x.d.bwGbs)), link: uni.length ? 'network' : 'pcie',
      ramGb: host.ramGb + sumMem(uni), ramBwGbs: host.ramBwGbs, fp16Tflops: sumTf([...gpu, ...uni]), fp8: gpu.every(x => x.d.fp8), backend: gpu[0].d.backend,
      ...disk, deviceId, single: singleOf(big) };
  }
  if (uni.length) {
    const n = uni.reduce((a, x) => a + x.qty, 0), big = largest(uni), minBw = Math.min(...uni.map(x => x.d.bwGbs));
    return { arch: 'unified', gpus: n, vramGb: 0, gpuBwGbs: minBw, link: n > 1 ? 'network' : 'none', ramGb: sumMem(uni), ramBwGbs: minBw,
      fp16Tflops: sumTf(uni), fp8: uni.every(x => x.d.fp8), backend: big.backend, ...disk, deviceId, single: singleOf(big) };
  }
  // CPU-only devices: one machine runs the model, so take the largest
  const big = largest(cpu);
  return { arch: 'cpu', gpus: 0, vramGb: 0, gpuBwGbs: 0, link: 'none', ramGb: big.memGb, ramBwGbs: big.bwGbs,
    fp16Tflops: big.fp16Tflops ?? K.cpuTflops, fp8: false, backend: 'cpu', ...disk, deviceId };
}

export const fastMemoryGb = (s: HardwareSpec): number => s.arch === 'cpu' ? 0 : s.arch === 'unified' ? s.ramGb * (s.backend === 'metal' ? s.macGpuCap ?? K.usable.macDefault : K.usable.unified) : s.vramGb * s.gpus * K.usable.discrete;
export const spillMemoryGb = (s: HardwareSpec): number => s.arch === 'unified' ? 0 : Math.max(0, s.ramGb * K.spill.frac - K.spill.osGb);

/** Active parameters (B) read per token; dense models with no active count fall back to the total. */
const activeB = (m: ModelRow) => m.activeParamsB ?? m.totalParamsB;
const kvBytes = (m: ModelRow) => m.kvBytesPerToken ?? Math.min(K.kvFallbackMax, K.kvFallbackBytesPerActiveB * (activeB(m) ?? 10));
/** True when the model reads fewer parameters per token than it has (both counts known). */
export const isMoe = (m: ModelRow) => m.activeParamsB != null && m.totalParamsB != null && m.activeParamsB < m.totalParamsB;
const deviceTypeOf = (s: HardwareSpec): DeviceType => (s.arch === 'discrete' ? 'gpu' : s.arch === 'unified' ? 'unified' : 'cpu');

export const physicalCeilingTps = (m: ModelRow, f: FileRow, bw: number): number => bw / ((activeB(m) ?? 1) * f.bitsPerWeight / 8);

const round1 = (x: number) => Math.max(0.1, Math.round(x * 10) / 10);

export function fitFile(m: ModelRow, f: FileRow, s: HardwareSpec, ctxK: number, ctx: FitCtx): FitResult {
  // kvBytesPerToken × (ctxK × 1000 tokens) / 2^30 = GB of KV cache (= prototype kv_kb × ctxK × 1000 / 2^20)
  const need = f.sizeGb * K.fileOverhead + kvBytes(m) * ctxK * 1000 / 2 ** 30 + K.runtimeGb;
  const fast = fastMemoryGb(s), spill = spillMemoryGb(s);
  const base = { fileId: f.id, needGb: Math.round(need), fitsDisk: f.sizeGb <= s.diskFreeGb, loadS: Math.round(f.sizeGb / Math.max(0.1, s.diskReadGbs)) };
  const no = (why: string): FitResult => ({ ...base, where: 'no', why, soloDevice: false, runtime: null, speed: null, promptTps: null, loadS: null });
  if (f.format !== 'gguf') {
    if (s.arch === 'cpu' || s.backend === 'cpu') return no('Needs a GPU runtime (vLLM / MLX)');
    if (f.format === 'fp8' && !s.fp8) return no('Needs FP8 support');
    if (f.format === 'int4' && s.backend === 'metal') return no('Format not supported on Mac');
    if (f.format === 'mlx' && s.backend !== 'metal') return no('MLX files run on Mac only');
  }
  let where: FitResult['where'];
  if (s.arch !== 'cpu' && need <= fast) where = 'gpu';
  else if (f.format === 'gguf' && need <= fast + spill) where = s.arch === 'cpu' ? 'cpu' : 'offload';
  else return no(f.format !== 'gguf' && need <= fast + spill ? `Needs ${Math.round(need)} GB of GPU memory; this format can't spill into RAM` : `Needs ${Math.round(need)} GB, has ${Math.round(fast + spill)} GB`);
  const one = s.single ?? { memGb: fast / Math.max(1, s.gpus), bwGbs: s.gpuBwGbs, fp16Tflops: s.fp16Tflops / Math.max(1, s.gpus) };
  const solo = where === 'gpu' && s.gpus > 1 && need <= one.memGb;
  const runtime = f.format === 'gguf' ? 'llama.cpp' : s.backend === 'metal' ? 'MLX' : 'vLLM';
  const moe = isMoe(m);
  const stat = s.deviceId ? ctx.runStats.find(r => r.deviceId === s.deviceId && r.fileId === f.id && r.nRuns >= K.minRunsMeasured) : undefined;
  const A = activeB(m) ?? 1;
  const B = A * f.bitsPerWeight / 8, frac = where === 'gpu' ? 0 : where === 'cpu' ? 1 : (need - fast) / need;
  const cal = ctx.eta.find(e => e.deviceType === deviceTypeOf(s) && e.runtime === runtime && e.moe === moe);
  // a 'cpu' calibration replaces the RAM efficiency (CPU-only runs read everything from RAM); others replace the GPU η.
  // Calibrations come from single-device runs, so a split across devices keeps the link's share of the loss.
  const linkEta = s.gpus > 1 && !solo ? K.eta[s.link === 'none' ? 'pcie' : s.link] : K.eta.single;
  const eta = cal && s.arch !== 'cpu' ? cal.eta * (linkEta / K.eta.single) : linkEta;
  const ramEta = cal && s.arch === 'cpu' ? cal.eta : K.ramEta;
  const bw = solo ? one.bwGbs : s.gpuBwGbs;
  const t = (B * (1 - frac)) / (Math.max(1, bw) * eta) + (B * frac) / (Math.max(1, s.ramBwGbs) * ramEta);
  const mid = (1 / t) * (cal ? 1 : (moe ? K.moePenalty : 1) * (s.backend === 'metal' ? K.metalPenalty : 1));
  const tf = where === 'cpu' ? K.cpuTflops : solo ? one.fp16Tflops : s.fp16Tflops;
  return { ...base, where, why: null, soloDevice: solo, runtime: stat?.runtime ?? runtime,
    speed: stat ? { kind: 'measured', p50: stat.genP50, p25: stat.genP25, p75: stat.genP75, nRuns: stat.nRuns } : { kind: 'estimate', mid: round1(mid), lo: round1(mid * K.range[0]), hi: round1(mid * K.range[1]) },
    promptTps: stat?.promptP50 ?? Math.round(tf * 1e12 * K.prefillEff / (2 * A * 1e9)) };
}

/** Sentinel "best" when a model has no files: fileId 0 is never a real file id. Callers check `all.length`. */
const NO_FILES: FitResult = { fileId: 0, where: 'no', why: 'No downloadable files yet', needGb: 0, fitsDisk: false, soloDevice: false, runtime: null, speed: null, promptTps: null, loadS: null };

// smallest near-lossless file in fast memory, else lowest-loss in fast memory, else lowest-loss that runs, else smallest
export function fitModel(m: ModelRow, files: FileRow[], s: HardwareSpec, ctxK: number, ctx: FitCtx): ModelFit {
  const kld = (f: FileRow) => (f.kind === 'official' ? 0 : f.quality[0]?.kld ?? null);
  const all = files.filter(f => f.modelId === m.id).map(f => ({ f, r: fitFile(m, f, s, ctxK, ctx), k: kld(f) }));
  const rated = all.flatMap(x => (x.k != null ? [{ ...x, k: x.k }] : [])), g = rated.filter(x => x.r.where === 'gpu');
  const pick = g.filter(x => x.k <= K.kld.nearLossless).sort((a, b) => a.f.sizeGb - b.f.sizeGb)[0]
    ?? [...g].sort((a, b) => a.k - b.k)[0]
    ?? rated.filter(x => x.r.where !== 'no').sort((a, b) => a.k - b.k)[0]
    ?? [...all].sort((a, b) => a.f.sizeGb - b.f.sizeGb)[0];
  return { modelId: m.id, best: pick?.r ?? { ...NO_FILES }, all: all.map(x => x.r) };
}
