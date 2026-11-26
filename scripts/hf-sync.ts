// scripts/hf-sync.ts — Hugging Face sync (SPEC "Hugging Face sync" steps 1–6), run daily by .github/workflows/hf-sync.yml (W4).
//   pnpm exec tsx scripts/hf-sync.ts [--dry] [--model <model id | hf repo>] [--limit <n>]
// For every model with hf_repo: params + KV bytes from safetensors / config.json, the official file, and the files of the
// top-8 uploaders' quantized / fine-tuned derivatives. 5 requests/s, stops at 9 min and resumes next day from a cursor
// stored as JSON in ingest_log.error (source 'hf-sync').
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';

if (existsSync('.env.local')) config({ path: '.env.local', quiet: true });

const HF = 'https://huggingface.co';
const MIN_GAP_MS = 200;               // 5 req/s
const BUDGET_MS = 9 * 60_000;
const TOP_UPLOADERS = 8, REPOS_PER_UPLOADER = 3;

type Json = Record<string, unknown>;
type FileFormat = 'gguf' | 'bf16' | 'fp16' | 'fp8' | 'int4' | 'mlx' | 'awq' | 'gptq';
type FileKind = 'official' | 'quant' | 'finetune' | 'abliterated' | 'merge';
interface FileOut { model_id: string; repo: string; uploader: string; quant: string; format: FileFormat; bits_per_weight: number | null; size_gb: number; kind: FileKind; downloads: number | null; updated_at: string | null }
/** A real copy of the model lands between ~1.2 (TQ1_0) and 17 (BF16 + overhead) bits per weight; anything else is a
 *  tiny-random test repo, a partial upload or a pointer-only repo (W1, Wave 2). Unknown bpw (no param count) only needs ≥ 0.3 GB. */
const plausibleFile = (f: FileOut) => f.size_gb >= 0.3 && (f.bits_per_weight == null || (f.bits_per_weight >= 1.2 && f.bits_per_weight <= 17));
interface TreeEntry { type: string; path: string; size?: number; lfs?: { size?: number } }
/** Bytes of one copy of the weights: root-level .safetensors only when the repo has any (repos like openai/gpt-oss-*
 *  also ship a second copy under original/ or metal/), else every .safetensors in the tree (W1, after launch). */
function weightBytes(tree: TreeEntry[]): number {
  const st = tree.filter(e => e.type === 'file' && /\.safetensors$/i.test(e.path));
  const root = st.filter(e => !e.path.includes('/'));
  return (root.length ? root : st).reduce((a, e) => a + fileSize(e), 0);
}
interface Listed { id: string; downloads?: number; tags?: string[]; lastModified?: string }
/** HF repos listed in data/kld/<model id>.csv (first column), so files with published KLD are always synced. */
function kldRepos(modelId: string): string[] {
  const p = join(process.cwd(), 'data', 'kld', `${modelId}.csv`);
  if (!existsSync(p)) return [];
  return [...new Set(readFileSync(p, 'utf8').split(/\r?\n/).slice(1).map(l => l.split(',')[0].trim()).filter(r => /^[\w.-]+\/[\w.-]+$/.test(r)))];
}

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const DRY = args.includes('--dry');
const ONLY = flag('--model');
const LIMIT = flag('--limit') ? Number(flag('--limit')) : Infinity;
const started = Date.now();
let requests = 0, lastAt = 0;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const r2 = (v: number) => Math.round(v * 100) / 100;

/** HF said stop (429 past the budget, or its window outlasts the run): end the run without moving the cursor past this model. */
class RateLimited extends Error {}

/** Wait for the window to reset when HF's `RateLimit: "api";r=<remaining>;t=<seconds>` header says the quota is nearly gone. */
async function respectWindow(res: Response) {
  const m = (res.headers.get('ratelimit') ?? '').match(/r=(\d+);\s*t=(\d+)/);
  if (!m || Number(m[1]) > 5) return;
  const ms = (Number(m[2]) + 1) * 1000;
  if (Date.now() - started + ms > BUDGET_MS) throw new RateLimited(`HF quota exhausted; window resets in ${m[2]}s`);
  console.log(`  HF quota nearly used, waiting ${m[2]}s for the window to reset`);
  await sleep(ms);
}

/** Throttled GET (≤ 5 req/s and HF's own 5-minute quota); 404/401/403 → null; one retry after 429 / 5xx. */
async function hf<T>(path: string, json = true): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const wait = lastAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt = Date.now(); requests++;
    const res = await fetch(HF + path, {
      headers: { 'user-agent': 'atlas-hf-sync/1.0', ...(process.env.HF_TOKEN ? { authorization: `Bearer ${process.env.HF_TOKEN}` } : {}) },
      signal: AbortSignal.timeout(30_000), redirect: 'follow',
    });
    if (res.status === 404 || res.status === 401 || res.status === 403) return null;
    if (res.status === 429 || res.status >= 500) {
      const t = (Number(res.headers.get('retry-after')) || Number((res.headers.get('ratelimit') ?? '').match(/t=(\d+)/)?.[1]) || 10) * 1000;
      if (res.status === 429 && Date.now() - started + t > BUDGET_MS) throw new RateLimited(`HF 429; retry in ${Math.round(t / 1000)}s`);
      await sleep(t);
      continue;
    }
    if (!res.ok) throw new Error(`HF ${path} → ${res.status}`);
    const body = (json ? await res.json() : await res.text()) as T;
    await respectWindow(res);
    return body;
  }
  throw new RateLimited(`HF ${path}: still rate limited after retry`);
}

// ---------------------------------------------------------------- step 1: params + KV
function modelParams(cfgRaw: Json | null, totalParams: number | null) {
  if (!cfgRaw) return { active: null as number | null, kv: null as number | null };
  const c: Json = { ...cfgRaw, ...((cfgRaw.text_config as Json | undefined) ?? {}), ...((cfgRaw.language_config as Json | undefined) ?? {}) };
  const layers = n(c.num_hidden_layers) ?? n(c.n_layers) ?? n(c.num_layers);
  const heads = n(c.num_attention_heads) ?? n(c.n_heads);
  const kvHeads = n(c.num_key_value_heads) ?? n(c.n_kv_heads) ?? heads;
  const hidden = n(c.hidden_size) ?? n(c.d_model);
  const headDim = n(c.head_dim) ?? (hidden && heads ? hidden / heads : null);
  const types = Array.isArray(c.layer_types) ? (c.layer_types as unknown[]) : null;
  const full = types ? types.filter(t => t === 'full_attention').length : 0;
  const kvLayers = types && full > 0 ? full : layers;                    // hybrid models: only full-attention layers keep a KV cache
  let kv: number | null = null;
  if (n(c.kv_lora_rank) != null && layers) kv = layers * ((n(c.kv_lora_rank) ?? 0) + (n(c.qk_rope_head_dim) ?? 0)) * 2;   // MLA
  else if (kvLayers && kvHeads && headDim) kv = 2 * kvLayers * kvHeads * headDim * 2;
  // MoE active params ≈ total − routed experts not used per token
  const E = n(c.n_routed_experts) ?? n(c.num_experts) ?? n(c.num_local_experts) ?? n(c.moe_num_experts);
  const k = n(c.num_experts_per_tok) ?? n(c.num_experts_per_token) ?? n(c.moe_top_k) ?? n(c.top_k_experts);
  let active: number | null = totalParams;
  if (totalParams && E && k && E > k && layers && hidden) {
    const inter = n(c.moe_intermediate_size) ?? n(c.intermediate_size);
    const moeLayers = layers - (n(c.first_k_dense_replace) ?? 0);
    if (inter) {
      const est = totalParams - moeLayers * (E - k) * 3 * hidden * inter;
      active = est > 0 && est < totalParams ? est : null;
    } else active = null;
  }
  return { active, kv: kv ? Math.round(kv) : null };
}

// ---------------------------------------------------------------- steps 2–5: files
const QUANT_RE = /((?:UD-|i1-)?(?:I?Q\d(?:_[A-Z0-9]+)*|TQ\d_\d|BF16|F16|F32|MXFP4(?:_MOE)?))$/i;
/** quant name from a GGUF file name: "Qwen3.8-27B-UD-Q4_K_XL-00001-of-00002.gguf" → "UD-Q4_K_XL" */
function ggufQuant(path: string): string | null {
  const base = path.split('/').pop()!.replace(/\.gguf$/i, '').replace(/-\d{5}-of-\d{5}$/, '');
  if (/mmproj|imatrix|^mtp-|draft|[-_.]mtp$|nomtp/i.test(base)) return null;   // projectors, draft / MTP heads, duplicate builds
  const m = base.match(QUANT_RE) ?? base.split('.').pop()?.match(QUANT_RE);
  if (!m) return null;
  return /^i1-/i.test(m[1]) ? `i1-${m[1].slice(3).toUpperCase()}` : m[1].toUpperCase();
}
const fileSize = (e: TreeEntry) => e.lfs?.size ?? e.size ?? 0;
const kindOf = (repo: string, tags: string[], base: FileKind): FileKind => (/abliterat|uncensor/i.test(repo) || tags.some(t => /abliterat|uncensor/i.test(t)) ? 'abliterated' : base);
const bits = (bytes: number, total: number | null) => (total ? r2((bytes * 8) / total) : null);

function nonGgufFormat(repo: string, tags: string[], cfg: Json | null): { format: FileFormat; quant: string } | null {
  const s = `${repo} ${tags.join(' ')}`.toLowerCase();
  const q = (cfg?.quantization_config as Json | undefined)?.quant_method;
  if (/\bmlx\b|mlx-/.test(s)) { const b = repo.match(/(\d+)-?bit/i); return { format: 'mlx', quant: b ? `${b[1]}bit` : 'MLX' }; }
  if (/\bawq\b|-awq/.test(s) || q === 'awq') return { format: 'awq', quant: 'AWQ' };
  if (/\bgptq\b|-gptq/.test(s) || q === 'gptq') return { format: 'gptq', quant: 'GPTQ' };
  if (/nvfp4|exl2|exl3|bnb|4bit/.test(s)) return null;                    // no matching files.format
  if (/\bfp8\b|-fp8/.test(s) || q === 'fp8') return { format: 'fp8', quant: 'FP8' };
  return null;
}
function officialFormat(info: Json, cfg: Json | null): { format: FileFormat; quant: string } {
  const params = Object.keys(((info.safetensors as Json | undefined)?.parameters as Json | undefined) ?? {});
  const qm = String((cfg?.quantization_config as Json | undefined)?.quant_method ?? '');
  const c = { ...(cfg ?? {}), ...((cfg?.text_config as Json | undefined) ?? {}) };
  const dtype = String(c.torch_dtype ?? c.dtype ?? '');
  if (qm === 'fp8' || params.some(p => p.startsWith('F8'))) return { format: 'fp8', quant: 'FP8' };
  if (qm === 'awq') return { format: 'awq', quant: 'AWQ' };
  if (qm === 'gptq') return { format: 'gptq', quant: 'GPTQ' };
  if (qm || params.includes('I4') || params.includes('U8')) return { format: 'int4', quant: 'INT4' };
  if (dtype === 'float16' || (params.includes('F16') && !params.includes('BF16'))) return { format: 'fp16', quant: 'FP16' };
  return { format: 'bf16', quant: 'BF16' };
}

async function filesOfRepo(modelId: string, repo: string, kind: FileKind, downloads: number | null, updatedAt: string | null, total: number | null, tags: string[]): Promise<FileOut[]> {
  const tree = (await hf<TreeEntry[]>(`/api/models/${repo}/tree/main?recursive=true`)) ?? [];
  const uploader = repo.split('/')[0];
  // one model file = one "stem" (path minus the -0000k-of-0000n split suffix); split parts are summed.
  const stems = new Map<string, { quant: string; bytes: number }>();
  for (const e of tree) {
    if (e.type !== 'file' || !/\.gguf$/i.test(e.path)) continue;
    const q = ggufQuant(e.path);
    if (!q) continue;
    const stem = e.path.replace(/\.gguf$/i, '').replace(/-\d{5}-of-\d{5}$/, '');
    const cur = stems.get(stem) ?? { quant: q, bytes: 0 };
    cur.bytes += fileSize(e);
    stems.set(stem, cur);
  }
  // several builds can share a quant name (e.g. "…-Q4_K_M" and "…-UD-DW-Q4_K_M"): keep the plainest (shortest) stem
  const ggufs = new Map<string, number>();
  for (const [stem, v] of [...stems].sort((a, b) => a[0].length - b[0].length)) if (!ggufs.has(v.quant) && stem) ggufs.set(v.quant, v.bytes);
  const row = (quant: string, format: FileFormat, bytes: number): FileOut => ({ model_id: modelId, repo, uploader, quant, format, bits_per_weight: bits(bytes, total), size_gb: r2(bytes / 1e9), kind, downloads, updated_at: updatedAt });
  if (ggufs.size) return [...ggufs].map(([q, b]) => row(q, 'gguf', b));
  const st = weightBytes(tree);
  if (!st) return [];
  const cfg = await hf<Json>(`/${repo}/resolve/main/config.json`);
  const f = nonGgufFormat(repo, tags, cfg) ?? (kind === 'quant' ? null : officialFormat({}, cfg));
  return f ? [row(f.quant, f.format, st)] : [];
}

async function syncModel(m: { id: string; hf_repo: string }) {
  const repo = m.hf_repo;
  const info = await hf<Json>(`/api/models/${repo}?expand[]=safetensors&expand[]=downloads&expand[]=lastModified&expand[]=tags`);
  if (!info) return { model: null, files: [] as FileOut[], note: `${repo}: not found` };
  const total = n((info.safetensors as Json | undefined)?.total);
  const cfg = await hf<Json>(`/${repo}/resolve/main/config.json`);
  const { active, kv } = modelParams(cfg, total);
  const files: FileOut[] = [];
  // step 2: the official file
  const tree = (await hf<TreeEntry[]>(`/api/models/${repo}/tree/main?recursive=true`)) ?? [];
  const st = weightBytes(tree);
  if (st) {
    const f = officialFormat(info, cfg);
    files.push({ model_id: m.id, repo, uploader: repo.split('/')[0], quant: f.quant, format: f.format, bits_per_weight: bits(st, total), size_gb: r2(st / 1e9), kind: 'official', downloads: n(info.downloads), updated_at: (info.lastModified as string | undefined) ?? null });
  }
  // step 3: derivatives, top uploaders by downloads
  const q = (await hf<Listed[]>(`/api/models?filter=base_model:quantized:${repo}&sort=downloads&limit=100&expand[]=downloads&expand[]=tags&expand[]=lastModified`)) ?? [];
  const ft = (await hf<Listed[]>(`/api/models?filter=base_model:finetune:${repo}&sort=downloads&limit=30&expand[]=downloads&expand[]=tags&expand[]=lastModified`)) ?? [];
  const derived = [...q.map(d => ({ ...d, base: 'quant' as FileKind })), ...ft.map(d => ({ ...d, base: 'finetune' as FileKind }))].filter(d => d.id !== repo);
  const best = new Map<string, number>();
  for (const d of derived) { const u = d.id.split('/')[0]; best.set(u, Math.max(best.get(u) ?? 0, d.downloads ?? 0)); }
  const top = new Set([...best].sort((a, b) => b[1] - a[1]).slice(0, TOP_UPLOADERS).map(([u]) => u));
  const perUploader = new Map<string, number>();
  for (const d of derived.sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0))) {
    const u = d.id.split('/')[0];
    if (!top.has(u) || (perUploader.get(u) ?? 0) >= REPOS_PER_UPLOADER) continue;
    perUploader.set(u, (perUploader.get(u) ?? 0) + 1);
    const tags = d.tags ?? [];
    files.push(...await filesOfRepo(m.id, d.id, kindOf(d.id, tags, d.base), d.downloads ?? null, d.lastModified ?? null, total, tags));
  }
  // step 3b: repos named in data/kld/<model id>.csv, even outside the top uploaders, so their KLD rows resolve (W1, after launch)
  const synced = new Set(files.map(f => f.repo));
  for (const pr of kldRepos(m.id)) {
    if (synced.has(pr) || pr === repo) continue;
    const d = await hf<Listed>(`/api/models/${pr}?expand[]=downloads&expand[]=tags&expand[]=lastModified`);
    if (!d) { console.log(`  ${m.id}: KLD repo ${pr} not found`); continue; }
    const tags = d.tags ?? [];
    files.push(...await filesOfRepo(m.id, pr, kindOf(pr, tags, 'quant'), d.downloads ?? null, d.lastModified ?? null, total, tags));
  }
  return { model: { total_params_b: total ? r2(total / 1e9) : null, active_params_b: active ? r2(active / 1e9) : null, kv_bytes_per_token: kv }, files, note: null as string | null };
}

async function main() {
  const { supabaseAdmin } = await import('@/lib/supabase/server');
  const { logRun } = await import('@/lib/ingest/log');
  const db = DRY ? null : supabaseAdmin();
  const result = await logRun('hf-sync', async () => {
    let models: { id: string; hf_repo: string }[];
    let cursor: string | null = null;
    if (db) {
      const { data, error } = await db.from('models').select('id,hf_repo').not('hf_repo', 'is', null).order('id');
      if (error) throw new Error(`models: ${error.message}`);
      models = (data ?? []) as { id: string; hf_repo: string }[];
      const last = await db.from('ingest_log').select('error').eq('source', 'hf-sync').not('finished_at', 'is', null).order('finished_at', { ascending: false }).limit(1);
      try { cursor = (JSON.parse(String(last.data?.[0]?.error ?? 'null')) as { cursor?: string } | null)?.cursor ?? null; } catch { cursor = null; }
    } else {
      const { SAMPLE_MODELS } = await import('@/lib/sample-data');
      models = SAMPLE_MODELS.filter(m => m.hfRepo).map(m => ({ id: m.id, hf_repo: m.hfRepo! }));
    }
    if (ONLY) { models = models.filter(m => m.id === ONLY || m.hf_repo === ONLY); cursor = null; }
    const start = cursor ? Math.max(0, models.findIndex(m => m.id > cursor!)) : 0;
    const order = [...models.slice(start), ...models.slice(0, start)];
    let inserted = 0, done = 0, lastId: string | null = cursor;   // a run that stops before finishing any model keeps the old cursor
    for (const m of order) {
      if (done >= LIMIT || Date.now() - started > BUDGET_MS) break;
      try {
        const r = await syncModel(m);
        const raw = r.files.length;
        r.files = r.files.filter(plausibleFile);
        if (raw > r.files.length) console.log(`  ${m.id}: skipped ${raw - r.files.length} implausible files (test repos / incomplete uploads)`);
        if (r.note) console.log(`  ${r.note}`);
        console.log(`  ${m.id} (${m.hf_repo}): params ${r.model?.total_params_b ?? '–'}B, active ${r.model?.active_params_b ?? '–'}B, kv ${r.model?.kv_bytes_per_token ?? '–'} B/tok, ${r.files.length} files`);
        if (DRY) for (const f of r.files) console.log(`    ${f.kind.padEnd(11)} ${f.repo} ${f.quant} ${f.format} ${f.size_gb} GB ${f.bits_per_weight ?? '–'} bpw`);
        if (db && r.model) {
          const patch = Object.fromEntries(Object.entries(r.model).filter(([, v]) => v != null));
          if (Object.keys(patch).length) { const { error } = await db.from('models').update(patch).eq('id', m.id); if (error) throw new Error(`models update: ${error.message}`); inserted++; }
        }
        if (db && r.files.length) {
          const uniq = [...new Map(r.files.map(f => [`${f.repo}|${f.quant}`, f])).values()];
          const { error } = await db.from('files').upsert(uniq, { onConflict: 'repo,quant' });
          if (error) throw new Error(`files upsert: ${error.message}`);
          inserted += uniq.length;
        }
      } catch (e) {
        console.log(`  ${m.id}: ${(e as Error).message}`);
        if (e instanceof RateLimited) break;          // resume from this model next run (cursor = previous model)
      }
      done++; lastId = m.id;
    }
    const finished = done >= order.length;
    console.log(`hf-sync: ${done}/${order.length} models, ${requests} HF requests, ${((Date.now() - started) / 1000).toFixed(0)}s${finished ? '' : `, resume after ${lastId}`}`);
    return { inserted, unchanged: 0, ...(!finished && lastId && !ONLY ? { error: JSON.stringify({ cursor: lastId }) } : {}) };
  }, { dry: DRY, log: m => console.log(m) });
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
}

main().catch(e => { console.error(e); process.exit(1); });
