// lib/data/models.ts — v_models → ModelRow[], creators. Owned by W1.
import 'server-only';
import { cache } from 'react';
import type { ApiOffer, Metric, Modality, ModelRow, SourceId, SourceScore } from '@/lib/contracts';
import { SAMPLE_CREATORS, SAMPLE_MODELS, type Creator } from '@/lib/sample-data';
import { num, selectAll, str, withFallback, type Row } from './_db';

export type { Creator };

const score = (s: Row): SourceScore => ({ source: s.source as SourceId, metric: s.metric as Metric, value: Number(s.value), scale: s.scale as SourceScore['scale'], fetchedAt: String(s.fetched_at) });
const offer = (o: Row): ApiOffer => ({
  provider: String(o.provider), source: o.source as ApiOffer['source'], priceIn: num(o.price_in), priceOut: num(o.price_out), priceCache: num(o.price_cache),
  tpsMedian: num(o.tps_median), ttftS: num(o.ttft_median_s), contextK: num(o.context_k), quantization: str(o.quantization), fetchedAt: String(o.fetched_at),
});
export function toModelRow(r: Row): ModelRow {
  const task = r.task as Row | null;
  return {
    id: String(r.id), familyId: str(r.family_id), name: String(r.name), creatorId: str(r.creator_id) ?? 'unknown', creatorName: str(r.creator_name) ?? 'Unknown',
    openWeights: !!r.open_weights, reasoning: r.reasoning == null ? null : !!r.reasoning,
    inModalities: ((r.in_modalities as string[] | null) ?? ['text']) as Modality[], outModalities: ((r.out_modalities as string[] | null) ?? ['text']) as Modality[],
    contextK: num(r.context_k), totalParamsB: num(r.total_params_b), activeParamsB: num(r.active_params_b), kvBytesPerToken: num(r.kv_bytes_per_token),
    hfRepo: str(r.hf_repo), scores: ((r.scores as Row[] | null) ?? []).map(score), offers: ((r.offers as Row[] | null) ?? []).map(offer),
    task: task ? { inTokens: Number(task.task_in_tokens), outTokens: Number(task.task_out_tokens), estimated: !!task.estimated } : null,
  };
}

/** Every non-deprecated model with latest scores, offers and task profile. */
export const loadModels = cache((): Promise<ModelRow[]> =>
  withFallback('v_models', async () => (await selectAll('v_models')).map(toModelRow), () => SAMPLE_MODELS, true));

/** All creators (providers), sorted by name; `defaultSelected` = the 12 shown by default. */
export const loadCreators = cache((): Promise<Creator[]> =>
  withFallback('creators', async () => (await selectAll('creators', 'id,name,default_selected', q => q.order('name')))
    .map(r => ({ id: String(r.id), name: String(r.name), defaultSelected: !!r.default_selected })), () => SAMPLE_CREATORS, true));
