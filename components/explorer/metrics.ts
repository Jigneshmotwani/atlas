// components/explorer/metrics.ts — the Explorer's 10 metric tabs (W6).
import type { Metric, ScoredModel } from '@/lib/contracts';
import { fmt1, fmtTime, fmtUsd } from '@/lib/format';
import { fmtTps, METRIC_LABEL, scoreFor } from '@/components/detail/labels';

export type ExplorerMetric = Metric | 'cost' | 'time' | 'speed' | 'price';
export interface MetricDef { k: ExplorerMetric; l: string; hi: boolean; get(m: ScoredModel): number | null; fmt(v: number | null): string }

const score = (k: Metric): MetricDef => ({ k, l: METRIC_LABEL[k], hi: true, get: m => scoreFor(m, k), fmt: fmt1 });

export const EXPLORER_METRICS: MetricDef[] = [
  score('intelligence'), score('coding'), score('agentic'), score('cyber'), score('math'), score('long_ctx'),
  { k: 'cost', l: 'Cost per task', hi: false, get: m => m.costPerTask, fmt: fmtUsd },
  { k: 'time', l: 'Time per task', hi: false, get: m => m.timePerTask, fmt: fmtTime },
  { k: 'speed', l: 'Output speed', hi: true, get: m => m.offer?.tpsMedian ?? null, fmt: fmtTps },
  { k: 'price', l: 'Price per 1M', hi: false, get: m => m.blendedPrice, fmt: fmtUsd },
];
export const metricDef = (k: string | null | undefined) => EXPLORER_METRICS.find(x => x.k === k) ?? EXPLORER_METRICS[0];
