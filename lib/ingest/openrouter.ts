// lib/ingest/openrouter.ts — OpenRouter catalog: models, aliases, per-provider offers (W4).
//
// Tracked models (keeps the run < 60 s and the DB small): not a `~` router alias or `:variant`, author not `openrouter`,
// text in AND text out, and either the author maps to a known creator or the model has a hugging_face_id; newest first,
// capped at MAX_TRACKED. One endpoints call per distinct `links.details` URL, 10 in parallel.
import { z } from 'zod';
import { IngestContext, TOL, type ModelRec } from './context';
import { logRun, type JobOptions, type JobResult } from './log';
import { cleanDisplayName, creatorIdFor } from './normalize';
import { SOURCES } from './sources';
import { contextK, fetchJson, mapLimit, num, round } from './util';

export const MAX_TRACKED = 300;
const PARALLEL = 10;
const MODALITIES = new Set(['text', 'image', 'audio', 'video', 'file']);
/** AA indices OpenRouter republishes in `benchmarks.artificial_analysis` that the free AA API does not return. */
const OR_AA_DOMAIN = { cyber: 'cyber_index', coding: 'coding_index', agentic: 'agentic_index' } as const;

const Price = z.record(z.string(), z.unknown()).nullish();
const OrModel = z.object({
  id: z.string(), name: z.string(), created: z.number().nullish(), hugging_face_id: z.string().nullish(),
  context_length: z.number().nullish(),
  architecture: z.object({ input_modalities: z.array(z.string()).nullish(), output_modalities: z.array(z.string()).nullish() }).nullish(),
  supported_parameters: z.array(z.string()).nullish(),
  expiration_date: z.string().nullish(),
  links: z.object({ details: z.string().nullish() }).nullish(),
  benchmarks: z.object({ artificial_analysis: z.record(z.string(), z.number().nullable()).nullish() }).nullish(),
  pricing: Price,
});
type OrModel = z.infer<typeof OrModel>;
const Endpoint = z.object({
  provider_name: z.string(), tag: z.string().nullish(), service_tier: z.string().nullish(), quantization: z.string().nullish(),
  context_length: z.number().nullish(), pricing: Price, status: z.number().nullish(),
  latency_last_30m: z.unknown().optional(), throughput_last_30m: z.unknown().optional(),
});
type Endpoint = z.infer<typeof Endpoint>;

/** per-token USD string → USD per 1M tokens; negative (= variable) → null */
const perM = (v: unknown) => { const n = num(v); return n == null || n < 0 ? null : round(n * 1e6, 6); };
/** latency / throughput may be a number or a percentile object */
const stat = (v: unknown): number | null => num(v) ?? (v && typeof v === 'object' ? num((v as Record<string, unknown>).p50) : null);

export function isTracked(m: OrModel, knownCreators: Set<string>): boolean {
  const author = m.id.split('/')[0];
  const ins = m.architecture?.input_modalities ?? [], outs = m.architecture?.output_modalities ?? [];
  if (m.id.startsWith('~') || m.id.includes(':') || author === 'openrouter') return false;
  if (!ins.includes('text') || !outs.includes('text')) return false;
  const c = creatorIdFor(author);
  return !!m.hugging_face_id || (c != null && knownCreators.has(c));
}

/** One offer per provider: standard tier first, then the provider's default tag, then the cheapest input price. */
function pickPerProvider(eps: Endpoint[]): Endpoint[] {
  const by = new Map<string, Endpoint[]>();
  for (const e of eps) by.set(e.provider_name, [...(by.get(e.provider_name) ?? []), e]);
  return [...by.values()].map(g => [...g].sort((a, b) =>
    Number(!!a.service_tier) - Number(!!b.service_tier)
    || Number((a.tag ?? '').includes('/')) - Number((b.tag ?? '').includes('/'))
    || (perM(a.pricing?.prompt) ?? 1e9) - (perM(b.pricing?.prompt) ?? 1e9))[0]);
}

async function sync(opts: JobOptions): Promise<Omit<JobResult, 'ok'> & { ok?: boolean }> {
  const log = opts.log ?? (() => {});
  const ctx = opts.ctx ?? await IngestContext.create({ dry: opts.dry });
  const i0 = ctx.inserted, u0 = ctx.unchanged, d0 = ctx.dropped;
  await ctx.preloadLatest('api_offers', 'openrouter');
  await ctx.preloadLatest('scores', 'aa');

  const raw = await fetchJson<{ data?: unknown[] }>(SOURCES.openrouter.urls.models, { timeoutMs: 25_000 });
  if (!Array.isArray(raw.data)) throw new Error('OpenRouter /models: unexpected shape (no data array)');
  const all: OrModel[] = [];
  let bad = 0;
  for (const d of raw.data) { const p = OrModel.safeParse(d); if (p.success) all.push(p.data); else bad++; }
  if (bad) ctx.note(`openrouter: ${bad} model entries with an unexpected shape skipped`);

  const known = new Set(ctx.creators.keys());
  const tracked = all.filter(m => isTracked(m, known)).sort((a, b) => (b.created ?? 0) - (a.created ?? 0)).slice(0, MAX_TRACKED);
  log(`openrouter: ${all.length} listed, ${tracked.length} tracked`);

  const today = new Date().toISOString().slice(0, 10);
  const detailUrl = new Map<string, string>(); // model id → endpoints URL
  // phase 1: match every tracked entry; phase 2: one OpenRouter entry per model (several ids can normalise to one name,
  // e.g. "gpt-5.2" and "gpt-5.2-chat"): the entry whose name IS the model's name wins, then exact before fuzzy, then newest.
  const matched: { m: OrModel; id: string; fields: Partial<ModelRec>; rank: number }[] = [];
  for (const m of tracked) {
    const author = m.id.split('/')[0];
    const display = m.name.includes(':') ? m.name.slice(0, m.name.indexOf(':')).trim() : author;
    const creatorId = ctx.creator(author, display);
    const name = cleanDisplayName(m.name);
    const ins = (m.architecture?.input_modalities ?? ['text']).filter(x => MODALITIES.has(x));
    const outs = (m.architecture?.output_modalities ?? ['text']).filter(x => MODALITIES.has(x));
    const params = m.supported_parameters ?? [];
    const fields: Partial<ModelRec> = {
      in_modalities: ins.length ? ins : ['text'], out_modalities: outs.length ? outs : ['text'],
      context_k: contextK(m.context_length), reasoning: params.includes('reasoning') || params.includes('include_reasoning'),
      ...(m.hugging_face_id ? { hf_repo: m.hugging_face_id, open_weights: true } : {}),
      ...(m.expiration_date ? { deprecated_on: m.expiration_date.slice(0, 10) } : {}),
    };
    const id = ctx.matchModel('openrouter', m.id, name, creatorId, {
      altNames: [m.id],
      create: { ...fields, released_on: m.created ? new Date(m.created * 1000).toISOString().slice(0, 10) : null },
    });
    if (!id) continue;
    matched.push({ m, id, fields, rank: ctx.models.get(id)?.name === name ? 3 : ctx.rank });
  }
  const claimed = new Set<string>();
  let dupes = 0;
  for (const { m, id, fields } of matched.sort((a, b) => b.rank - a.rank)) {
    if (claimed.has(id)) { dupes++; continue; }
    claimed.add(id);
    const cur = ctx.models.get(id);
    // don't overwrite a hand-set / seeded hf_repo; never un-deprecate
    if (cur) ctx.patchModel(id, { ...fields, hf_repo: cur.hf_repo ?? fields.hf_repo, deprecated_on: cur.deprecated_on && cur.deprecated_on <= today ? cur.deprecated_on : fields.deprecated_on });
    const aaBench = m.benchmarks?.artificial_analysis;
    if (aaBench) for (const [metric, field] of Object.entries(OR_AA_DOMAIN)) {
      const v = num(aaBench[field]);
      if (v != null) ctx.insertIfChanged('scores', { model_id: id, source: 'aa', metric }, { value: v, scale: 'index', source_ref: `openrouter:benchmarks.artificial_analysis.${field}` }, TOL.score);
    }
    if (m.links?.details) detailUrl.set(id, SOURCES.openrouter.urls.endpointsBase + m.links.details);
  }

  // endpoints, deduped by URL (":batch" / ":free" share one)
  const urls = [...new Set(detailUrl.values())];
  const results = await mapLimit(urls, PARALLEL, url => fetchJson<{ data?: { endpoints?: unknown[] } }>(url, { timeoutMs: 15_000 }));
  const byUrl = new Map(urls.map((u, i) => [u, results[i]]));
  let failed = 0, offers = 0;
  for (const [modelId, url] of detailUrl) {
    const r = byUrl.get(url);
    if (!r || !r.ok) { failed++; continue; }
    const eps = (r.value.data?.endpoints ?? []).flatMap(e => { const p = Endpoint.safeParse(e); return p.success ? [p.data] : []; });
    for (const e of pickPerProvider(eps)) {
      const latency = stat(e.latency_last_30m);
      const row = {
        price_in: perM(e.pricing?.prompt), price_out: perM(e.pricing?.completion), price_cache: perM(e.pricing?.input_cache_read),
        tps_median: round(stat(e.throughput_last_30m), 1),
        ttft_median_s: latency == null ? null : round(latency > 50 ? latency / 1000 : latency, 2), // OpenRouter reports ms
        context_k: contextK(e.context_length), quantization: e.quantization && e.quantization !== 'unknown' ? e.quantization : null,
      };
      if (row.price_in == null && row.price_out == null) continue;
      offers++;
      ctx.insertIfChanged('api_offers', { model_id: modelId, provider: e.provider_name, source: 'openrouter' }, row, TOL.offer);
    }
  }
  if (failed) ctx.note(`openrouter: ${failed} endpoint lookups failed`);
  if (dupes) log(`openrouter: ${dupes} entries skipped (their model is already fed by a better-matching OpenRouter id)`);
  log(`openrouter: ${urls.length} endpoint lookups (${failed} failed), ${offers} provider offers seen; match ${JSON.stringify(ctx.methods)}; pending ${JSON.stringify(ctx.pending())}; duplicate facts dropped ${ctx.dropped - d0}`);
  await ctx.flush();
  const broken = failed > urls.length / 2;
  return { ok: !broken, inserted: ctx.inserted - i0, unchanged: ctx.unchanged - u0, ...(broken ? { error: `${failed}/${urls.length} endpoint lookups failed` } : {}) };
}

export const run = (opts: JobOptions = {}): Promise<JobResult> => logRun('openrouter', () => sync(opts), opts);
