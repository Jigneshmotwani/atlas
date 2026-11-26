// supabase/generate-seed.ts — writes supabase/seed.sql from lib/sample-data.ts + data/devices-curated.json. Owned by W3.
// Run from the repo root:  pnpm exec tsx supabase/generate-seed.ts
// The seed is idempotent (safe to re-run, also on top of real data) and deterministic except for now() timestamps.
import fs from 'node:fs';
import path from 'node:path';
import type { Backend, DeviceType } from '../lib/contracts';
import {
  SAMPLE_CALIBRATIONS, SAMPLE_CREATORS, SAMPLE_DEVICES, SAMPLE_EVAL_SET, SAMPLE_FILES, SAMPLE_MODELS, SAMPLE_RUN_STATS,
} from '../lib/sample-data';
import curatedJson from '../data/devices-curated.json';

/** One row of data/devices-curated.json (= the `devices` columns the curated catalog sets). */
export interface CuratedDevice {
  id: string; name: string; category: string; type: DeviceType; mem_gb: number; bw_gbs: number; fp16_tflops: number | null;
  fp8: boolean; fp4: boolean; backend: Backend; usable_frac: number | null; aliases: string[];
}
const CURATED = curatedJson as CuratedDevice[];

// ------------------------------------------------------------------ SQL literal helpers
const q = (s: string | null | undefined): string => (s == null ? 'null' : `'${s.replace(/'/g, "''")}'`);
const n = (x: number | null | undefined): string => {
  if (x == null) return 'null';
  if (!Number.isFinite(x)) throw new Error(`not a finite number: ${x}`);
  return String(x);
};
const b = (x: boolean | null | undefined): string => (x == null ? 'null' : x ? 'true' : 'false');
const arr = (a: string[]): string => (a.length ? `array[${a.map(q).join(', ')}]::text[]` : `'{}'::text[]`);
const rows = (rs: string[][]): string => rs.map(r => `  (${r.join(', ')})`).join(',\n');
/** Hours between an ISO timestamp from the sample data and now, rounded (sample ages are whole hours). */
const ageH = (iso: string): number => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3.6e6));
const fail = (msg: string): never => { throw new Error(msg); };

// ------------------------------------------------------------------ checks
const CATEGORIES = new Set(['AI box', 'Mac', 'GPU', 'Workstation GPU', 'Data center', 'Laptop GPU']);
const TYPES = new Set<string>(['gpu', 'unified', 'cpu']);
const BACKENDS = new Set<string>(['cuda', 'rocm', 'metal', 'vulkan', 'cpu']);
{
  const ids = new Set<string>();
  for (const d of CURATED) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(d.id)) fail(`device id not a slug: ${d.id}`);
    if (ids.has(d.id)) fail(`duplicate device id: ${d.id}`);
    ids.add(d.id);
    if (!CATEGORIES.has(d.category)) fail(`bad category for ${d.id}: ${d.category}`);
    if (!TYPES.has(d.type)) fail(`bad type for ${d.id}: ${d.type}`);
    if (!BACKENDS.has(d.backend)) fail(`bad backend for ${d.id}: ${d.backend}`);
    if (!(d.mem_gb > 0 && d.bw_gbs > 0)) fail(`device without memory/bandwidth: ${d.id}`);
    if (!Array.isArray(d.aliases)) fail(`aliases must be an array: ${d.id}`);
  }
  // the prototype devices must keep the same ids and numbers as SAMPLE_DEVICES (sample fallback = seed)
  SAMPLE_DEVICES.forEach((s, i) => {
    const d = CURATED[i];
    const same = d && d.id === s.id && d.name === s.name && d.category === s.category && d.type === s.type && d.mem_gb === s.memGb && d.bw_gbs === s.bwGbs
      && d.fp16_tflops === s.fp16Tflops && d.fp8 === s.fp8 && d.fp4 === s.fp4 && d.backend === s.backend && d.usable_frac === s.usableFrac;
    if (!same) fail(`devices-curated.json row ${i} differs from SAMPLE_DEVICES ${s.id}`);
  });
  const fileKeys = new Set<string>();
  SAMPLE_FILES.forEach((f, i) => {
    if (f.id !== i + 1) fail(`SAMPLE_FILES ids must be 1..N in order (file ${f.id} at ${i})`);
    const k = `${f.repo}\u0000${f.quant}`;
    if (fileKeys.has(k)) fail(`duplicate (repo, quant): ${f.repo} ${f.quant}`);
    fileKeys.add(k);
  });
}

// ------------------------------------------------------------------ runs: nRuns values reproducing p25 / p50 / p75
/** Postgres percentile_cont over an ascending-sorted array. */
function percentileCont(sorted: number[], p: number): number {
  const h = p * (sorted.length - 1), lo = Math.floor(h), hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}
/** Piecewise-linear values through (h25, p25), (h50, p50), (h75, p75) at integer positions 0..n-1. */
function runValues(nRuns: number, p25: number, p50: number, p75: number): number[] {
  if (nRuns < 2) return Array(nRuns).fill(p50);
  const h25 = 0.25 * (nRuns - 1), h50 = 0.5 * (nRuns - 1), h75 = 0.75 * (nRuns - 1);
  const sL = (p50 - p25) / (h50 - h25), sU = (p75 - p50) / (h75 - h50);
  return Array.from({ length: nRuns }, (_, i) => +(i <= h50 ? p50 + (i - h50) * sL : p50 + (i - h50) * sU).toFixed(2));
}
let maxRunErr = 0;
const runRows: string[][] = [];
for (const s of SAMPLE_RUN_STATS) {
  const f = SAMPLE_FILES.find(x => x.id === s.fileId) ?? fail(`run stat without file ${s.fileId}`);
  if (!SAMPLE_DEVICES.some(d => d.id === s.deviceId)) fail(`run stat on unknown device ${s.deviceId}`);
  const vals = runValues(s.nRuns, s.genP25, s.genP50, s.genP75);
  if (vals.some(v => !(v > 0))) fail(`non-positive run value for ${s.deviceId} ${f.repo}:${f.quant}`);
  const err = Math.max(Math.abs(percentileCont(vals, 0.25) - s.genP25), Math.abs(percentileCont(vals, 0.5) - s.genP50), Math.abs(percentileCont(vals, 0.75) - s.genP75));
  maxRunErr = Math.max(maxRunErr, err);
  if (err > 0.06) fail(`run values for ${s.deviceId} ${f.repo}:${f.quant} miss the sample stats by ${err}`);
  for (const v of vals) runRows.push([q(s.deviceId), n(f.id), q(f.repo), q(f.quant), q(s.runtime), n(v), n(s.promptP50)]);
}

// ------------------------------------------------------------------ metric_sources
// PK is (metric, source), so several fields of one source go into one comma-separated source_metric
// (a domain score = mean of the listed fields present in the response). Field names are best guesses
// for the AA v2 free endpoint and the other sources' published files; W4 corrects them after a real response.
const METRIC_SOURCES: [metric: string, source: string, fields: string][] = [
  ['intelligence', 'aa', 'artificial_analysis_intelligence_index'],
  ['intelligence', 'arena', 'rating'],
  ['intelligence', 'livebench', 'global_average'],
  ['intelligence', 'epoch', 'eci'],
  ['coding', 'aa', 'livecodebench,scicode,terminalbench_hard'],
  ['agentic', 'aa', 'tau2,terminalbench_hard'],
  ['math', 'aa', 'aime_25,math_500'],
  ['long_ctx', 'aa', 'lcr'],
  // cyber: no AA evaluation field covers security; left unmapped on purpose (see NOTES.md)
];

// ------------------------------------------------------------------ build the SQL
const out: string[] = [];
const counts: Record<string, number> = {};
const section = (table: string, count: number, sql: string) => { counts[table] = (counts[table] ?? 0) + count; out.push(`-- ${table} (${count})\n${sql}\n`); };

out.push(`-- supabase/seed.sql — GENERATED by supabase/generate-seed.ts from lib/sample-data.ts and data/devices-curated.json.
-- Do not edit by hand: change the sources and run  pnpm exec tsx supabase/generate-seed.ts
-- Apply after 0001_init.sql and 0002_security.sql. Idempotent: re-running never duplicates rows and never
-- overwrites real (ingested) values, except that curated devices and the 12 default creators are re-asserted.
-- No ingest_log rows on purpose: the footer must not show fake sync times.

begin;
`);

section('creators', SAMPLE_CREATORS.length, `insert into creators (id, name, default_selected) values
${rows(SAMPLE_CREATORS.map(c => [q(c.id), q(c.name), b(c.defaultSelected)]))}
on conflict (id) do update set default_selected = excluded.default_selected;`);

section('models', SAMPLE_MODELS.length, `insert into models (id, family_id, name, creator_id, open_weights, reasoning, in_modalities, out_modalities, context_k,
  total_params_b, active_params_b, kv_bytes_per_token, hf_repo) values
${rows(SAMPLE_MODELS.map(m => [q(m.id), q(m.familyId), q(m.name), q(m.creatorId), b(m.openWeights), b(m.reasoning), arr(m.inModalities), arr(m.outModalities),
    n(m.contextK), n(m.totalParamsB), n(m.activeParamsB), n(m.kvBytesPerToken), q(m.hfRepo)]))}
on conflict (id) do nothing;`);

const scoreRows = SAMPLE_MODELS.flatMap(m => m.scores.map(s => [q(m.id), q(s.source), q(s.metric), n(s.value), q(s.scale), n(ageH(s.fetchedAt))]));
section('scores', scoreRows.length, `insert into scores (model_id, source, metric, value, scale, source_ref, fetched_at)
select v.model_id, v.source, v.metric, v.value, v.scale, 'seed', now() - make_interval(hours => v.age_h)
from (values
${rows(scoreRows)}
) as v (model_id, source, metric, value, scale, age_h)
where not exists (select 1 from scores s where s.model_id = v.model_id and s.source = v.source and s.metric = v.metric);`);

const offerRows = SAMPLE_MODELS.flatMap(m => m.offers.map(o => {
  if (o.priceCache != null || o.quantization != null) fail('generator assumes sample offers have no cache price / quantization');
  return [q(m.id), q(o.provider), q(o.source), n(o.priceIn), n(o.priceOut), n(o.tpsMedian), n(o.ttftS), n(o.contextK), n(ageH(o.fetchedAt))];
}));
section('api_offers', offerRows.length, `insert into api_offers (model_id, provider, source, price_in, price_out, price_cache, tps_median, ttft_median_s, context_k, quantization, fetched_at)
select v.model_id, v.provider, v.source, v.price_in, v.price_out, null, v.tps_median, v.ttft_median_s, v.context_k, null, now() - make_interval(hours => v.age_h)
from (values
${rows(offerRows)}
) as v (model_id, provider, source, price_in, price_out, tps_median, ttft_median_s, context_k, age_h)
where not exists (select 1 from api_offers o where o.model_id = v.model_id and o.provider = v.provider and o.source = v.source);`);

const taskModels = SAMPLE_MODELS.filter(m => m.task);
section('task_profile', taskModels.length, `insert into task_profile (model_id, task_in_tokens, task_out_tokens, estimated) values
${rows(taskModels.map(m => [q(m.id), n(m.task!.inTokens), n(m.task!.outTokens), b(m.task!.estimated)]))}
on conflict (model_id) do nothing;`);

section('files', SAMPLE_FILES.length, `insert into files (id, model_id, repo, uploader, quant, format, bits_per_weight, size_gb, kind, downloads) values
${rows(SAMPLE_FILES.map(f => [n(f.id), q(f.modelId), q(f.repo), q(f.uploader), q(f.quant), q(f.format), n(f.bitsPerWeight), n(f.sizeGb), q(f.kind), n(f.downloads)]))}
on conflict do nothing;
select setval(pg_get_serial_sequence('files', 'id'), (select max(id) from files));`);

// rows join on (id, repo, quant) so a database whose ids were taken by real files never gets KLDs on the wrong file
const qualityRows = SAMPLE_FILES.flatMap(f => f.quality.filter(x => x.kld != null).map(x => {
  if (x.evalSet !== SAMPLE_EVAL_SET) fail(`unexpected eval set ${x.evalSet}`);
  if (f.kind === 'official' && x.kld !== 0) fail(`official file ${f.id} with KLD ${x.kld}`);
  return [n(f.id), q(f.repo), q(f.quant), n(x.kld), q(x.evalSet), q(x.source), n(ageH(x.measuredAt)), b(f.kind === 'official')];
}));
section('file_quality', qualityRows.length, `insert into file_quality (file_id, kld, eval_set, reference_file_id, source, source_ref, measured_at)
select f.id, v.kld, v.eval_set,
  case when v.is_reference then null
       else (select r.id from files r where r.model_id = f.model_id and r.kind = 'official' order by r.id limit 1) end,
  v.source, 'seed', now() - make_interval(hours => v.age_h)
from (values
${rows(qualityRows)}
) as v (file_id, repo, quant, kld, eval_set, source, age_h, is_reference)
join files f on f.id = v.file_id and f.repo = v.repo and f.quant = v.quant
on conflict (file_id, eval_set, source) do nothing;`);

section('devices', CURATED.length, `insert into devices (id, name, category, type, mem_gb, bw_gbs, fp16_tflops, fp8, fp4, backend, usable_frac, source, verified, aliases) values
${rows(CURATED.map(d => [q(d.id), q(d.name), q(d.category), q(d.type), n(d.mem_gb), n(d.bw_gbs), n(d.fp16_tflops), b(d.fp8), b(d.fp4), q(d.backend), n(d.usable_frac),
    q('curated'), b(true), arr(d.aliases)]))}
on conflict (id) do update set
  name = excluded.name, category = excluded.category, type = excluded.type, mem_gb = excluded.mem_gb, bw_gbs = excluded.bw_gbs,
  fp16_tflops = excluded.fp16_tflops, fp8 = excluded.fp8, fp4 = excluded.fp4, backend = excluded.backend, usable_frac = excluded.usable_frac,
  source = 'curated', verified = true, aliases = excluded.aliases, updated_at = now();`);

section('runs', runRows.length, `insert into runs (device_id, device_name_raw, file_id, file_ref, runtime, gen_tps, prompt_tps, probe_version, fingerprint, verified, created_at)
select v.device_id, d.name, f.id, f.repo || ':' || f.quant, v.runtime, v.gen_tps, v.prompt_tps, '1.0.0', 'seed', true, now() - interval '12 hours'
from (values
${rows(runRows)}
) as v (device_id, file_id, repo, quant, runtime, gen_tps, prompt_tps)
join files f on f.id = v.file_id and f.repo = v.repo and f.quant = v.quant
join devices d on d.id = v.device_id
where not exists (select 1 from runs r where r.fingerprint = 'seed' and r.device_id = v.device_id and r.file_id = f.id and r.runtime = v.runtime);`);

section('metric_sources', METRIC_SOURCES.length, `insert into metric_sources (metric, source, source_metric, weight) values
${rows(METRIC_SOURCES.map(([metric, source, fields]) => [q(metric), q(source), q(fields), '1']))}
on conflict (metric, source) do nothing;`);

section('calibrations', SAMPLE_CALIBRATIONS.length, `insert into calibrations (source, metric, a, b, n_overlap) values
${rows(SAMPLE_CALIBRATIONS.map(c => [q(c.source), q(c.metric), n(c.a), n(c.b), n(c.nOverlap)]))}
on conflict (source, metric) do nothing;`);

out.push('commit;\n');

const target = path.resolve(process.cwd(), 'supabase', 'seed.sql');
if (!fs.existsSync(path.dirname(target))) fail('run from the repo root (supabase/ not found)');
fs.writeFileSync(target, out.join('\n'));
console.log(`wrote ${path.relative(process.cwd(), target)}`);
console.table(counts);
console.log(`runs: ${SAMPLE_RUN_STATS.length} groups, max |percentile - sample| = ${maxRunErr.toFixed(3)} tok/s`);
