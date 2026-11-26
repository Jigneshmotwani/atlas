// components/detail/labels.ts — display names shared by the Explorer, the drawer and the Recommender (W6).
import type { FileRow, Metric, ScoredModel, SourceId } from '@/lib/contracts';

/** The four benchmark sources, in the prototype's column order. */
export const SOURCES: { id: SourceId; name: string }[] = [
  { id: 'aa', name: 'Artificial Analysis' },
  { id: 'arena', name: 'Arena' },
  { id: 'livebench', name: 'LiveBench' },
  { id: 'epoch', name: 'Epoch AI' },
];
export const sourceName = (s: SourceId) => SOURCES.find(x => x.id === s)?.name ?? s;

export const METRIC_LABEL: Record<Metric, string> = {
  intelligence: 'Intelligence', coding: 'Coding', agentic: 'Agentic', cyber: 'Cybersecurity', math: 'Math', long_ctx: 'Long context',
};

/** focus score of a model: the calibrated intelligence average or one AA domain score */
export const scoreFor = (m: ScoredModel, metric: Metric) => (metric === 'intelligence' ? m.intelligence : m.domain[metric]);

/** first measured KLD of a file (official files are the reference) */
export const kldOf = (f: FileRow): number | null => (f.kind === 'official' ? 0 : f.quality.find(q => q.kld != null)?.kld ?? null);

export const FLAG_LABEL: Record<ScoredModel['flags'][number], string> = { 'one-source': 'one source', disagree: 'sources disagree', stale: 'stale' };

/** "Anthropic · open · reasoning" */
export const modelSub = (m: ScoredModel) => `${m.creatorName}${m.openWeights ? ' · open' : ''}${m.reasoning ? ' · reasoning' : ''}`;

export const fmtTps = (v: number | null | undefined) => (v == null || !isFinite(v) ? '–' : `${Math.round(v)} tok/s`);
