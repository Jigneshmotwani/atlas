// lib/engine/recommend.ts — filter + weighted match score (SPEC "Engine").
import type { Recommendation, RecommendInput, ScoredModel } from '../contracts';

// log of a cost or time; a free (≤ 0) value is -Infinity = better than anything, kept out of the range
const lg = (x: number | null): number | null => (x == null ? null : x > 0 ? Math.log(x) : -Infinity);

export function recommend(models: ScoredModel[], q: RecommendInput): Recommendation[] {
  const pool = models.filter(m => q.providers.includes(m.creatorName) && (q.openWeights === 'any' || (q.openWeights === 'open') === m.openWeights)
    && (q.reasoning === 'any' || (q.reasoning === 'yes') === !!m.reasoning) && q.inputs.every(x => m.inModalities.includes(x))
    && q.outputs.every(x => m.outModalities.includes(x)) && (m.contextK ?? 0) >= q.minContextK);
  if (!pool.length) return [];
  const I = (m: ScoredModel) => (q.focus === 'intelligence' ? m.intelligence : m.domain[q.focus]);
  const C = (m: ScoredModel) => lg(m.costPerTask), T = (m: ScoredModel) => lg(m.timePerTask);
  // [lo, hi] over finite values; [0, 0] when there are none (every model then scores 1 on a known value, 0 on null)
  const rng = (f: (m: ScoredModel) => number | null): [number, number] => {
    const v = pool.map(f).filter((x): x is number => x != null && Number.isFinite(x));
    return v.length ? [Math.min(...v), Math.max(...v)] : [0, 0];
  };
  const sc = (v: number | null, [lo, hi]: [number, number], invert = false) => {
    if (v == null) return 0;
    if (!Number.isFinite(v)) return invert === (v < 0) ? 1 : 0; // -Infinity (free) is best when lower is better
    if (hi === lo) return 1;
    return Math.min(1, Math.max(0, invert ? (hi - v) / (hi - lo) : (v - lo) / (hi - lo)));
  };
  const ri = rng(I), rc = rng(C), rt = rng(T);
  const w = q.weights, tot = w.intelligence + w.speed + w.cost || 1;
  return pool.map(m => ({ model: m, match: Math.round(100 * (w.intelligence * sc(I(m), ri) + w.cost * sc(C(m), rc, true) + w.speed * sc(T(m), rt, true)) / tot) }))
    .sort((a, b) => b.match - a.match || (I(b.model) ?? 0) - (I(a.model) ?? 0) || (a.model.costPerTask ?? 1e9) - (b.model.costPerTask ?? 1e9));
}
