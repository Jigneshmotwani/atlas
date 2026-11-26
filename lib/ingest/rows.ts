// lib/ingest/rows.ts — DB row → contract mappers for jobs and scripts (W4).
// Same mapping as lib/data (W1), duplicated because lib/data imports 'server-only', which throws under tsx.
import type { ApiOffer, Backend, Device, DeviceType, FileFormat, FileKind, FileRow, Metric, Modality, ModelRow, SourceId, SourceScore } from '@/lib/contracts';
import { num } from './util';

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? null : String(v));

export function modelRowOf(r: Row): ModelRow {
  const task = r.task as Row | null;
  return {
    id: String(r.id), familyId: str(r.family_id), name: String(r.name), creatorId: str(r.creator_id) ?? 'unknown', creatorName: str(r.creator_name) ?? 'Unknown',
    openWeights: !!r.open_weights, reasoning: r.reasoning == null ? null : !!r.reasoning,
    inModalities: ((r.in_modalities as string[] | null) ?? ['text']) as Modality[], outModalities: ((r.out_modalities as string[] | null) ?? ['text']) as Modality[],
    contextK: num(r.context_k), totalParamsB: num(r.total_params_b), activeParamsB: num(r.active_params_b), kvBytesPerToken: num(r.kv_bytes_per_token),
    hfRepo: str(r.hf_repo),
    scores: ((r.scores as Row[] | null) ?? []).map((s): SourceScore => ({ source: s.source as SourceId, metric: s.metric as Metric, value: Number(s.value), scale: s.scale as SourceScore['scale'], fetchedAt: String(s.fetched_at) })),
    offers: ((r.offers as Row[] | null) ?? []).map((o): ApiOffer => ({
      provider: String(o.provider), source: o.source as ApiOffer['source'], priceIn: num(o.price_in), priceOut: num(o.price_out), priceCache: num(o.price_cache),
      tpsMedian: num(o.tps_median), ttftS: num(o.ttft_median_s), contextK: num(o.context_k), quantization: str(o.quantization), fetchedAt: String(o.fetched_at),
    })),
    task: task ? { inTokens: Number(task.task_in_tokens), outTokens: Number(task.task_out_tokens), estimated: !!task.estimated } : null,
  };
}

export function fileRowOf(r: Row): FileRow {
  return {
    id: Number(r.id), modelId: String(r.model_id), repo: String(r.repo), uploader: String(r.uploader), quant: String(r.quant),
    format: r.format as FileFormat, bitsPerWeight: num(r.bits_per_weight) ?? 0, sizeGb: Number(r.size_gb), kind: r.kind as FileKind, downloads: num(r.downloads),
    quality: ((r.quality as Row[] | null) ?? []).map(q => ({ kld: num(q.kld), evalSet: String(q.eval_set), source: String(q.source), measuredAt: String(q.measured_at) })),
  };
}

export function deviceOf(r: Row): Device {
  return {
    id: String(r.id), name: String(r.name), category: String(r.category), type: r.type as DeviceType, memGb: Number(r.mem_gb), bwGbs: Number(r.bw_gbs),
    fp16Tflops: num(r.fp16_tflops), fp8: !!r.fp8, fp4: !!r.fp4, backend: r.backend as Backend, usableFrac: num(r.usable_frac),
    source: r.source as Device['source'], verified: !!r.verified,
  };
}
