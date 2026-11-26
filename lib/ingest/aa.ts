// lib/ingest/aa.ts — Artificial Analysis free API → scores (aa), 'AA median' offers, task_profile (W4).
//
// Real free-tier shape (read 24 Nov 2026, intelligence_index_version 5): { tier, intelligence_index_version,
// pagination: { page, page_size: 200, total_pages, has_more }, data: [{ id, name, slug, release_date, model_creator: { id, name },
// evaluations: { artificial_analysis_intelligence_index, …_coding_index (always null), …_agentic_index (always null),
// …_finance_and_accounting_index, …_strategy_and_ops_index, …_legal_index, …_healthcare_and_medical_index,
// …_engineering_index, …_economics_index }, artificial_analysis_intelligence_index_cost: { total_cost, cost_per_task: { total_cost } } | null,
// pricing: { price_1m_input_tokens, price_1m_output_tokens, price_1m_cache_hit_tokens, price_1m_cache_write_tokens },
// performance: { median_output_tokens_per_second, median_time_to_first_token_seconds, … }, performance_v3: {…} | null }] }.
// The free shape has NO individual evaluations and no token counts (AA docs: "full evaluation set, token counts … are Pro-only").
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Metric } from '@/lib/contracts';
import { IngestContext, TOL } from './context';
import { logRun, Skip, type JobOptions, type JobResult } from './log';
import { cleanDisplayName } from './normalize';
import { SOURCES } from './sources';
import { diff, fetchText, num, round } from './util';

/**
 * Source of truth for AA field → Atlas metric (also upserted into `metric_sources` each run; a domain score is the mean of
 * its listed fields that are present). The free tier only carries the Intelligence Index; coding / agentic are listed so a
 * Pro key fills them, but AA documents both as always null now. cyber comes from OpenRouter's republished AA Cyber Index
 * (lib/ingest/openrouter.ts). math and long_ctx have no AA field on the free tier → no aa rows → those tabs stay empty.
 */
export const AA_METRIC_FIELDS: Record<Metric, string[]> = {
  intelligence: ['artificial_analysis_intelligence_index'],
  coding: ['artificial_analysis_coding_index'],
  agentic: ['artificial_analysis_agentic_index'],
  cyber: [],
  math: [],
  long_ctx: [],
};
const KNOWN_EVAL_FIELDS = new Set([
  ...Object.values(AA_METRIC_FIELDS).flat(),
  'artificial_analysis_finance_and_accounting_index', 'artificial_analysis_strategy_and_ops_index', 'artificial_analysis_legal_index',
  'artificial_analysis_healthcare_and_medical_index', 'artificial_analysis_engineering_index', 'artificial_analysis_economics_index',
]);
/** metric_sources rows for source 'aa' (cyber points at the OpenRouter-republished field). */
const METRIC_SOURCES = [
  ...Object.entries(AA_METRIC_FIELDS).filter(([, f]) => f.length).map(([metric, f]) => ({ metric, source: 'aa', source_metric: f.join(','), weight: 1 })),
  { metric: 'cyber', source: 'aa', source_metric: 'openrouter:benchmarks.artificial_analysis.cyber_index', weight: 1 },
];
const MAX_PAGES = 8;
/** Assumed input tokens per task when deriving output tokens from AA's cost per task (engine default 40K). */
const TASK_IN_TOKENS = 40_000;

const Item = z.object({
  id: z.string(), name: z.string(), slug: z.string().nullish(), release_date: z.string().nullish(),
  model_creator: z.object({ name: z.string().nullish() }).nullish(),
  evaluations: z.record(z.string(), z.number().nullable()).nullish(),
  artificial_analysis_intelligence_index_cost: z.object({ cost_per_task: z.object({ total_cost: z.number().nullish() }).nullish() }).nullish(),
  pricing: z.object({ price_1m_input_tokens: z.number().nullish(), price_1m_output_tokens: z.number().nullish(), price_1m_cache_hit_tokens: z.number().nullish() }).nullish(),
  performance: z.object({ median_output_tokens_per_second: z.number().nullish(), median_time_to_first_token_seconds: z.number().nullish() }).nullish(),
});
const Page = z.object({ data: z.array(z.unknown()), pagination: z.object({ has_more: z.boolean().nullish(), total_pages: z.number().nullish() }).nullish() });

async function pages(opts: JobOptions & { maxPages?: number }): Promise<unknown[]> {
  if (opts.fixture) return Page.parse(JSON.parse(await readFile(opts.fixture, 'utf8'))).data;
  if (opts.dry) throw new Skip('dry run without --fixture: not spending the AA quota (100 requests/day)');
  const key = process.env.AA_API_KEY;
  if (!key) throw new Skip('AA_API_KEY not set');
  const out: unknown[] = [];
  const cap = Math.min(MAX_PAGES, opts.maxPages ?? MAX_PAGES);
  for (let page = 1; page <= cap; page++) {
    const body = await fetchText(`${SOURCES.aa.urls.models}?page=${page}`, { headers: { 'x-api-key': key }, timeoutMs: 25_000 });
    const p = Page.safeParse(JSON.parse(body));
    if (!p.success) throw new Error(`AA page ${page}: unexpected shape (${p.error.issues[0]?.message ?? 'no data array'})`);
    out.push(...p.data.data);
    if (!p.data.pagination?.has_more) break;
  }
  return out;
}

async function sync(opts: JobOptions & { maxPages?: number }): Promise<Omit<JobResult, 'ok'>> {
  const log = opts.log ?? (() => {});
  const items = await pages(opts);
  const ctx = opts.ctx ?? await IngestContext.create({ dry: opts.dry });
  const i0 = ctx.inserted, u0 = ctx.unchanged, d0 = ctx.dropped, m0 = { ...ctx.methods };
  await ctx.preloadLatest('scores', 'aa');
  await ctx.preloadLatest('api_offers', 'aa');
  const tasks = ctx.dry ? new Map<string, string>() : new Map((await ctx.selectAll('task_profile', 'model_id,task_in_tokens,task_out_tokens,estimated'))
    .map(r => [String(r.model_id), `${r.task_in_tokens}|${r.task_out_tokens}|${r.estimated}`]));

  const unknownFields = new Set<string>();
  let bad = 0, scored = 0;
  const taskRows: Record<string, unknown>[] = [];
  for (const raw of items) {
    const p = Item.safeParse(raw);
    if (!p.success) { bad++; continue; }
    const m = p.data, ev = m.evaluations ?? {};
    for (const f of Object.keys(ev)) if (!KNOWN_EVAL_FIELDS.has(f)) unknownFields.add(f);
    const intel = num(ev.artificial_analysis_intelligence_index);
    const pr = m.pricing ?? {}, perf = m.performance ?? {};
    const creatorName = m.model_creator?.name ?? null;
    const id = ctx.matchModel('aa', m.id, cleanDisplayName(m.name), ctx.creator(creatorName, creatorName), {
      altNames: m.slug ? [m.slug] : [],
      allowCreate: intel != null,          // don't add the ~600 legacy AA entries that have no current index
      recordUnmatched: false,
      effortFallback: false,
      create: { released_on: m.release_date ?? null, reasoning: /non-reasoning/i.test(m.name) ? false : /\((reasoning|max|xhigh|high|medium|low|minimal)\b/i.test(m.name) ? true : null },
    });
    if (!id) continue;
    const ref = `aa:${m.slug ?? m.id}`;
    for (const [metric, fields] of Object.entries(AA_METRIC_FIELDS)) {
      const vals = fields.map(f => num(ev[f])).filter((v): v is number => v != null);
      if (!vals.length) continue;
      scored++;
      ctx.insertIfChanged('scores', { model_id: id, source: 'aa', metric }, { value: round(vals.reduce((a, b) => a + b, 0) / vals.length, 2), scale: 'index', source_ref: ref }, TOL.score);
    }
    const pin = num(pr.price_1m_input_tokens), pout = num(pr.price_1m_output_tokens);
    const tps = num(perf.median_output_tokens_per_second), ttft = num(perf.median_time_to_first_token_seconds);
    if (pin != null || pout != null || tps != null) {
      ctx.insertIfChanged('api_offers', { model_id: id, provider: 'AA median', source: 'aa' }, {
        price_in: pin, price_out: pout, price_cache: num(pr.price_1m_cache_hit_tokens), tps_median: tps || null, ttft_median_s: ttft || null, context_k: null, quantization: null,
      }, TOL.offer);
    }
    // task_profile: AA free gives cost per task (USD), not token counts → derive output tokens at an assumed 40K input
    const cost = num(m.artificial_analysis_intelligence_index_cost?.cost_per_task?.total_cost);
    if (cost != null && pin != null && pout && pout > 0) {
      const out = Math.round((cost * 1e6 - TASK_IN_TOKENS * pin) / pout);
      if (out >= 500 && out <= 500_000) {
        const sig = `${TASK_IN_TOKENS}|${out}|true`;
        if (tasks.get(id) !== sig) { tasks.set(id, sig); taskRows.push({ model_id: id, task_in_tokens: TASK_IN_TOKENS, task_out_tokens: out, estimated: true, updated_at: new Date().toISOString() }); }
      }
    }
  }
  if (bad) ctx.note(`aa: ${bad} entries with an unexpected shape skipped`);
  if (unknownFields.size) ctx.note(`aa: unmapped evaluation fields: ${[...unknownFields].join(', ')}`);
  ctx.upsert('task_profile', taskRows, 'model_id');
  ctx.upsert('metric_sources', METRIC_SOURCES, 'metric,source');
  log(`aa: ${items.length} entries, ${scored} scores seen; match ${JSON.stringify(diff(ctx.methods, m0))}; pending ${JSON.stringify(ctx.pending())}; duplicate facts dropped ${ctx.dropped - d0}${ctx.notes.length ? '; notes: ' + ctx.notes.join(' | ') : ''}`);
  await ctx.flush();
  if (!ctx.dry) {
    // drop guessed aa rows for metrics AA's free tier doesn't publish (seed guesses)
    const keep = METRIC_SOURCES.map(r => r.metric);
    const { error } = await ctx.client.from('metric_sources').delete().eq('source', 'aa').not('metric', 'in', `(${keep.join(',')})`);
    if (error) log(`aa: metric_sources cleanup failed: ${error.message}`);
  }
  return { inserted: ctx.inserted - i0, unchanged: ctx.unchanged - u0 };
}

export const run = (opts: JobOptions & { maxPages?: number } = {}): Promise<JobResult> => logRun('aa', () => sync(opts), opts);
