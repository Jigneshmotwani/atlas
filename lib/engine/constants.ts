// lib/engine/constants.ts — engine constants (SPEC "Engine"). Reasons for each value live in the engine design doc.
export const K = {
  fileOverhead: 1.05, runtimeGb: 1.5,
  usable: { discrete: 0.92, unified: 0.85, macDefault: 0.75 },
  spill: { frac: 0.8, osGb: 4 },
  eta: { single: 0.6, pcie: 0.45, nvlink: 0.55, network: 0.35 }, ramEta: 0.6,
  moePenalty: 0.7, metalPenalty: 0.8, range: [0.7, 1.15] as const,
  prefillEff: 0.3, cpuTflops: 2,
  kld: { nearLossless: 0.01, small: 0.05 },
  minRunsMeasured: 3, minOverlap: 8, disagree: 8, staleHours: 48,
  blend: { cache: 7, input: 2, output: 1 },
  kvFallbackBytesPerActiveB: 2400, kvFallbackMax: 160_000,
  minEtaRuns: 20,
};

/** Median of a list; NaN for an empty list (callers guard the length). */
export const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length === 0 ? NaN : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
