// lib/engine/scores.ts — calibration + multi-source average + derived metrics (SPEC "Engine").
import type { ApiOffer, Calibration, Metric, ModelRow, ScoredModel, SourceId } from '../contracts';
import { K, median } from './constants';

export const METRICS: Metric[] = ['intelligence', 'coding', 'agentic', 'cyber', 'math', 'long_ctx'];
/** Raw value of one source × metric for a model, or null when that source has not scored it. */
export const val = (m: ModelRow, source: SourceId, metric: Metric): number | null =>
  m.scores.find(s => s.source === source && s.metric === metric)?.value ?? null;

/** Theil–Sen line y = a + b·x; null when no pair of points has distinct x (no slope to take). */
export function theilSen(x: number[], y: number[]): { a: number; b: number } | null {
  const sl: number[] = [];
  for (let i = 0; i < x.length; i++) for (let j = i + 1; j < x.length; j++) if (x[j] !== x[i]) sl.push((y[j] - y[i]) / (x[j] - x[i]));
  if (!sl.length) return null;
  const b = median(sl);
  return { a: median(y.map((v, i) => v - b * x[i])), b };
}

// reference = Artificial Analysis for each metric; other sources map onto it
export function fitCalibrations(models: ModelRow[]): Calibration[] {
  const out: Calibration[] = [];
  for (const metric of METRICS) for (const source of ['arena', 'livebench', 'epoch'] as SourceId[]) {
    const pairs = models.flatMap(m => { const r = val(m, 'aa', metric), s = val(m, source, metric); return r != null && s != null ? [[s, r] as const] : []; });
    if (pairs.length < K.minOverlap) continue;
    const fit = theilSen(pairs.map(p => p[0]), pairs.map(p => p[1]));
    if (!fit) continue;
    out.push({ source, metric, a: fit.a, b: fit.b, nOverlap: pairs.length });
  }
  for (const metric of METRICS) out.push({ source: 'aa', metric, a: 0, b: 1, nOverlap: models.length });
  return out;
}

type Task = { inTokens: number; outTokens: number };

export function scoreModels(models: ModelRow[], cals: Calibration[], opts: { disabledSources?: SourceId[]; provider?: Record<string, string> } = {}): ScoredModel[] {
  const taskMedian = (r: boolean | null): Task => {
    const t = models.flatMap(m => (m.task && !m.task.estimated && m.reasoning === r ? [m.task] : []));
    return t.length ? { inTokens: median(t.map(x => x.inTokens)), outTokens: median(t.map(x => x.outTokens)) } : { inTokens: 40000, outTokens: r ? 12000 : 6000 };
  };
  const medians = new Map<boolean | null, Task>();
  const fallbackTask = (r: boolean | null): Task => { let t = medians.get(r); if (!t) { t = taskMedian(r); medians.set(r, t); } return t; };

  return models.map((m): ScoredModel => {
    const perSource = m.scores.filter(s => !opts.disabledSources?.includes(s.source)).flatMap(s => {
      const c = cals.find(c => c.source === s.source && c.metric === s.metric);
      return c ? [{ source: s.source, metric: s.metric, raw: s.value, calibrated: c.a + c.b * s.value, fetchedAt: s.fetchedAt }] : [];
    });
    const avg = (metric: Metric) => { const v = perSource.filter(p => p.metric === metric).map(p => p.calibrated); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const intel = perSource.filter(p => p.metric === 'intelligence').map(p => p.calibrated);
    const spread = intel.length > 1 ? Math.max(...intel) - Math.min(...intel) : null;
    const stale = perSource.some(p => Date.now() - Date.parse(p.fetchedAt) > K.staleHours * 3.6e6);
    const offer = pickOffer(m, opts.provider?.[m.id]);
    const task = m.task ?? fallbackTask(m.reasoning);
    const costPerTask = offer?.priceIn != null && offer.priceOut != null ? (task.inTokens * offer.priceIn + task.outTokens * offer.priceOut) / 1e6 : null;
    const timePerTask = offer?.tpsMedian ? (offer.ttftS ?? 0) + task.outTokens / offer.tpsMedian : null;
    const blendedPrice = offer?.priceIn != null && offer.priceOut != null ? (K.blend.cache * (offer.priceCache ?? offer.priceIn) + K.blend.input * offer.priceIn + K.blend.output * offer.priceOut) / 10 : null;
    const flags: ScoredModel['flags'] = [];
    if (intel.length === 1) flags.push('one-source');
    if (spread != null && spread > K.disagree) flags.push('disagree');
    if (stale) flags.push('stale');
    const domain = Object.fromEntries(METRICS.map(x => [x, avg(x)])) as Record<Metric, number | null>;
    return { ...m, intelligence: avg('intelligence'), domain, perSource, nSources: intel.length, spread, flags, offer, costPerTask, timePerTask, blendedPrice, costEstimated: !m.task || m.task.estimated };
  });
}

// the chosen provider if priced, else the maker's own API if listed, else the offer with the median input price
function pickOffer(m: ModelRow, chosen?: string): ApiOffer | null {
  const priced = m.offers.filter((o): o is ApiOffer & { priceIn: number } => o.priceIn != null);
  const maker = m.creatorName.trim().toLowerCase();
  return priced.find(o => o.provider === chosen)
    ?? (maker ? priced.find(o => o.provider.toLowerCase().includes(maker)) : undefined)
    ?? [...priced].sort((a, b) => a.priceIn - b.priceIn)[priced.length >> 1]
    ?? null;
}
