// components/quants/select.ts — which models the Quants page can compare (owned by W7). Pure.
import type { FileRow } from '@/lib/contracts';

/** Quants page needs at least this many rated quants (kind 'quant', KLD > 0 in one eval set). */
export const MIN_RATED_QUANTS = 4;

/** KLD of a file in one eval set (null = not rated there). */
export const kldIn = (f: FileRow, evalSet: string): number | null => f.quality.find(q => q.evalSet === evalSet)?.kld ?? null;

/** The eval set with the most rated quants among `files` (same filter as quantView), and that count. */
export function bestEvalSet(files: FileRow[]): { evalSet: string | null; count: number } {
  const counts = new Map<string, number>();
  for (const f of files) {
    if (f.kind !== 'quant') continue;
    for (const q of f.quality) if (q.kld != null && q.kld > 0) counts.set(q.evalSet, (counts.get(q.evalSet) ?? 0) + 1);
  }
  let evalSet: string | null = null, count = 0;
  for (const [k, v] of counts) if (v > count) { evalSet = k; count = v; }
  return { evalSet, count };
}

/** Model ids (from `modelIds`) whose files have enough rated quants to compare. */
export function comparableModelIds(modelIds: string[], files: FileRow[]): Set<string> {
  const byModel = new Map<string, FileRow[]>();
  for (const f of files) byModel.set(f.modelId, [...(byModel.get(f.modelId) ?? []), f]);
  return new Set(modelIds.filter(id => bestEvalSet(byModel.get(id) ?? []).count >= MIN_RATED_QUANTS));
}
