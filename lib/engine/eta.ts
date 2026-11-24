// lib/engine/eta.ts — fit bandwidth efficiency η from measured runs (used by the nightly `calibrate` job).
//
// Input contract for each run:
//   estimate = the UNCALIBRATED engine estimate for that run, i.e.
//              fitFile(model, file, spec, ctxK, { runStats: [], eta: [] }).speed.mid  (kind 'estimate')
//              on the run's single-device spec, for files that sit fully in fast memory (where === 'gpu',
//              or 'cpu' on a CPU-only device). Offloaded runs mix GPU and RAM η, so leave them out.
//   measured = the measured generation tok/s.
//
// The uncalibrated estimate is phys(η₀) × penalties, where η₀ = K.eta.single (K.ramEta for 'cpu') and
// penalties = K.moePenalty for MoE (and K.metalPenalty on Metal). Once a calibration exists fitFile drops those
// penalties and uses cal.eta instead, so the fitted η must absorb them:
//   η = median(measured / estimate) × η₀ × (moe ? K.moePenalty : 1) × (runtime 'MLX' ? K.metalPenalty : 1)
// Then the calibrated estimate for a run equals estimate × median(measured / estimate).
// Limitation: the group key has no backend, so the Metal penalty is only known for MLX runs; llama.cpp runs on a
// Mac share the 'unified' group with CUDA boxes (DGX Spark) and their Metal penalty is not folded in.
import type { DeviceType, EtaCalibration } from '../contracts';
import { K, median } from './constants';

type EtaRun = { estimate: number; measured: number; deviceType: DeviceType; runtime: string; moe: boolean };

export function fitEta(runs: EtaRun[]): EtaCalibration[] {
  const groups = new Map<string, EtaRun[]>();
  for (const r of runs) {
    if (!(Number.isFinite(r.estimate) && Number.isFinite(r.measured) && r.estimate > 0 && r.measured > 0)) continue;
    const key = `${r.deviceType}|${r.runtime}|${r.moe}`;
    const g = groups.get(key);
    if (g) g.push(r); else groups.set(key, [r]);
  }
  const out: EtaCalibration[] = [];
  for (const g of groups.values()) {
    if (g.length < K.minEtaRuns) continue;
    const { deviceType, runtime, moe } = g[0];
    const eta0 = deviceType === 'cpu' ? K.ramEta : K.eta.single;
    const penalties = (moe ? K.moePenalty : 1) * (runtime === 'MLX' ? K.metalPenalty : 1);
    const eta = median(g.map(r => r.measured / r.estimate)) * eta0 * penalties;
    out.push({ deviceType, runtime, moe, eta: Math.round(eta * 1e4) / 1e4, nRuns: g.length });
  }
  return out;
}
