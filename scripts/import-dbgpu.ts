// scripts/import-dbgpu.ts — weekly import of the dbgpu GPU database into `devices`. Owned by W3.
// Run by .github/workflows/dbgpu.yml:  pnpm exec tsx scripts/import-dbgpu.ts dbgpu.json [--dry-run]
// Input: JSON array of dbgpu GPUSpecification dicts (python: [s.to_dict() for s in GPUDatabase.default().specs]).
// Rules: source='dbgpu', verified=false, type 'gpu'; skips entries without memory size or bandwidth, old/integrated parts,
// and anything that is (or looks like) a curated or probe device; never overwrites a non-dbgpu row. Writes one
// ingest_log row and exits 0 on handled errors so one broken job never fails the schedule.
import fs from 'node:fs';
import { config } from 'dotenv';
import { supabaseAdmin } from '@/lib/supabase/server';
import { bestSimilarity } from '@/lib/trigram';

if (fs.existsSync('.env.local')) config({ path: '.env.local', quiet: true });

const SOURCE = 'dbgpu';
const MIN_YEAR = 2016;         // older parts are useless for local LLMs and would flood the catalog
const MIN_MEM_GB = 4;
const SIMILAR = 0.9;           // trigram similarity to a curated/probe name or alias → treat as the same device
const BATCH = 500;

type Category = 'GPU' | 'Workstation GPU' | 'Data center' | 'Laptop GPU';
type GpuBackend = 'cuda' | 'rocm' | 'vulkan';
interface DeviceRow {
  id: string; name: string; category: Category; type: 'gpu'; mem_gb: number; bw_gbs: number; fp16_tflops: number | null;
  fp8: boolean; fp4: boolean; backend: GpuBackend; usable_frac: null; source: typeof SOURCE; verified: false; aliases: string[];
}
/** The dbgpu fields this script reads (all optional: the dump is untrusted input). */
interface DbgpuSpec {
  manufacturer?: string; name?: string; generation?: string; architecture?: string | null; release_date?: string | null;
  memory_size_gb?: number | null; memory_bandwidth_gb_s?: number | null; boost_clock_mhz?: number | null;
  streaming_multiprocessors?: number | null; tensor_cores?: number | null; half_float_performance_gflop_s?: number | null;
  single_float_performance_gflop_s?: number | null;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const r1 = (x: number) => Math.round(x * 10) / 10;
const pos = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : null);

const SKIP_GENERATION = /IGP|Console|Graphics-|HD Graphics|Xe Graphics|Arc Graphics|Mining|DRIVE|GRID|Embedded|Tegra|Mac\(|Mac \(|H3C/i;
const SKIP_NAME = /^Jetson|Embedded/i; // Jetsons are unified AI boxes (curated), not cards

function category(s: DbgpuSpec): Category {
  const name = s.name ?? '', t = `${s.generation ?? ''} ${name}`;
  if (/Mobile|Max-Q|Laptop|\(\w+M\)|RX \d+M\b|\b\w*\d{3,4}MX?\b|\bM\d{3}X?\b|Vega M\b|TiM\b/i.test(t)) return 'Laptop GPU';
  // NVIDIA data-center names: A10, A100X, H100 CNX, L40G, PG506-… (case-sensitive and NVIDIA-only: "Arc A310" is a desktop card)
  if (s.manufacturer === 'NVIDIA' && /^(?:[ABHL]\d{1,3}[A-Z]?|PG\d{3})\b/.test(name)) return 'Data center';
  if (/Radeon PRO V\d|FirePro S/i.test(name)) return 'Data center';
  if (/Quadro|Workstation|RTX A\d|Ada Generation|PRO W|Pro W|Blackwell PRO|Radeon Pro (Vega|VII|Duo)|AI PRO|Arc Pro|FirePro W|\bT\d{3,4}\b/i.test(t)) return 'Workstation GPU';
  if (/Server|Tesla|Instinct|Data Center|Arctic Sound|Radeon PRO V\d|FirePro S/i.test(t)) return 'Data center';
  return 'GPU';
}

function backend(manufacturer: string): GpuBackend {
  return manufacturer === 'NVIDIA' ? 'cuda' : manufacturer === 'AMD' ? 'rocm' : 'vulkan';
}

/** Dense FP16 TFLOPS on the curated catalog's scale (tensor/matrix units, no sparsity); approximate. */
function fp16Tflops(s: DbgpuSpec): number | null {
  // shader rate: FP16, or FP32 where FP16 is crippled (consumer Pascal) or unknown — llama.cpp then computes in FP32
  const half = pos(s.half_float_performance_gflop_s), single = pos(s.single_float_performance_gflop_s);
  const shader = half != null || single != null ? Math.max(half ?? 0, single ?? 0) : null, arch = s.architecture ?? '', name = s.name ?? '';
  const sm = pos(s.streaming_multiprocessors), ghz = (pos(s.boost_clock_mhz) ?? 0) / 1000;
  if (s.manufacturer === 'NVIDIA' && pos(s.tensor_cores) && sm && ghz) {
    // FP16 FLOPs per SM per clock with FP32 accumulate
    let perSm = 0;
    if (/Hopper/.test(arch)) perSm = 4096;
    else if (/Blackwell/.test(arch) && /Server|Bxx/.test(s.generation ?? '') && /^G?B\d{3}/.test(name)) perSm = 8192;
    else if (/Ampere/.test(arch) && /\bA(100|800|30)\b/.test(name)) perSm = 2048;
    else if (/Volta/.test(arch)) perSm = 1024;
    else if (/Turing|Ampere|Ada|Blackwell/.test(arch)) perSm = 1024;
    if (perSm) {
      const geforce = /GeForce/i.test(s.generation ?? '') && !/TITAN/i.test(name); // GeForce: half-rate FP32 accumulate
      return r1((sm * ghz * perSm * (geforce ? 0.5 : 1)) / 1000);
    }
  }
  if (s.manufacturer === 'AMD' && /RDNA 4/.test(arch) && shader) return r1((shader * 2) / 1000); // WMMA = 2x shader rate
  return shader ? r1(shader / 1000) : null;
}

function toRow(s: DbgpuSpec): DeviceRow | null {
  const manufacturer = s.manufacturer ?? '', name = (s.name ?? '').trim();
  if (!['NVIDIA', 'AMD', 'Intel'].includes(manufacturer) || !name) return null;
  const mem = pos(s.memory_size_gb), bw = pos(s.memory_bandwidth_gb_s);
  if (mem == null || bw == null || mem < MIN_MEM_GB) return null;
  const year = s.release_date ? Number(String(s.release_date).slice(0, 4)) : NaN;
  if (!(year >= MIN_YEAR)) return null;
  if (SKIP_GENERATION.test(s.generation ?? '') || SKIP_NAME.test(name)) return null;
  const arch = s.architecture ?? '';
  const fp8 = /Ada|Hopper|Blackwell|RDNA 4|CDNA 3|CDNA 4/.test(arch);
  const fp4 = /Blackwell|CDNA 4/.test(arch);
  return {
    id: `dbgpu-${slug(`${manufacturer} ${name}`)}`, name, category: category(s), type: 'gpu', mem_gb: r1(mem), bw_gbs: r1(bw),
    fp16_tflops: fp16Tflops(s), fp8, fp4, backend: backend(manufacturer), usable_frac: null, source: SOURCE, verified: false, aliases: [],
  };
}

const sameRow = (a: DeviceRow, b: Record<string, unknown>) =>
  a.name === b.name && a.category === b.category && a.type === b.type && Number(b.mem_gb) === a.mem_gb && Number(b.bw_gbs) === a.bw_gbs
  && (b.fp16_tflops == null ? a.fp16_tflops == null : Number(b.fp16_tflops) === a.fp16_tflops) && b.fp8 === a.fp8 && b.fp4 === a.fp4
  && b.backend === a.backend && b.verified === false;

async function selectDevices(columns: string): Promise<Record<string, unknown>[]> {
  const db = supabaseAdmin(), out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('devices').select(columns).order('id').range(from, from + 999);
    if (error) throw new Error(`devices: ${error.message}`);
    out.push(...((data ?? []) as unknown as Record<string, unknown>[]));
    if (!data || data.length < 1000) return out;
  }
}

async function main() {
  const file = process.argv.slice(2).find(a => !a.startsWith('--'));
  const dryRun = process.argv.includes('--dry-run');
  if (!file) throw new Error('usage: tsx scripts/import-dbgpu.ts <dbgpu.json> [--dry-run]');

  const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('dbgpu dump is not a JSON array');
  const specs = raw.filter((x): x is DbgpuSpec => typeof x === 'object' && x !== null);

  // devices we must never touch: curated + probe rows (read from the DB; dry-run reads the curated JSON instead)
  let protectedRows: { id: string; name: string; aliases: string[] }[];
  let existingDbgpu = new Map<string, Record<string, unknown>>();
  if (dryRun) {
    const curated = JSON.parse(fs.readFileSync('data/devices-curated.json', 'utf8')) as { id: string; name: string; aliases: string[] }[];
    protectedRows = curated;
  } else {
    const all = await selectDevices('id,name,category,type,mem_gb,bw_gbs,fp16_tflops,fp8,fp4,backend,source,verified,aliases');
    protectedRows = all.filter(r => r.source !== SOURCE).map(r => ({ id: String(r.id), name: String(r.name), aliases: (r.aliases as string[] | null) ?? [] }));
    existingDbgpu = new Map(all.filter(r => r.source === SOURCE).map(r => [String(r.id), r]));
  }
  const protectedIds = new Set(protectedRows.map(r => r.id));
  const protectedNames = protectedRows.flatMap(r => [r.name, ...r.aliases]);

  const rows = new Map<string, DeviceRow>();
  let skippedSpecs = 0, skippedCurated = 0;
  for (const s of specs) {
    const row = toRow(s);
    if (!row) { skippedSpecs++; continue; }
    // a trailing die code ("GeForce RTX 3060 12 GB GA104") is the same card as the curated one for our purposes
    const base = row.name.replace(/\s+(GA|AD|TU|GP|GB|GH|GK|GM)\d{3}$/i, '');
    if (protectedIds.has(row.id) || bestSimilarity(base, protectedNames) >= SIMILAR) { skippedCurated++; continue; }
    if (!rows.has(row.id)) rows.set(row.id, row); // first wins on a slug collision (one upsert may not touch a row twice)
  }
  const changed = [...rows.values()].filter(r => { const e = existingDbgpu.get(r.id); return !e || !sameRow(r, e); });
  const unchanged = rows.size - changed.length;
  console.log(`dbgpu: ${specs.length} specs, ${rows.size} candidate devices (${changed.length} new/changed, ${unchanged} unchanged), `
    + `${skippedCurated} skipped as curated/probe look-alikes, ${skippedSpecs} skipped (no memory/bandwidth, < ${MIN_YEAR}, integrated, other vendors)`);
  if (dryRun) {
    const byCat: Record<string, number> = {};
    for (const r of rows.values()) byCat[r.category] = (byCat[r.category] ?? 0) + 1;
    console.log(byCat);
    console.log([...rows.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)).map(r => `${r.id}  ${r.name}  ${r.category}  ${r.mem_gb}GB ${r.bw_gbs}GB/s ${r.fp16_tflops}TF`).join('\n'));
    return { inserted: 0, unchanged };
  }
  const db = supabaseAdmin();
  for (let i = 0; i < changed.length; i += BATCH) {
    const batch = changed.slice(i, i + BATCH).map(r => ({ ...r, updated_at: new Date().toISOString() }));
    const { error } = await db.from('devices').upsert(batch, { onConflict: 'id' });
    if (error) throw new Error(`upsert devices: ${error.message}`);
  }
  return { inserted: changed.length, unchanged };
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  let logId: number | null = null;
  if (!dryRun) {
    try {
      const { data, error } = await supabaseAdmin().from('ingest_log').insert({ source: SOURCE }).select('id').single();
      if (error) throw new Error(error.message);
      logId = Number((data as { id: number }).id);
    } catch (e) {
      console.error('dbgpu: cannot write ingest_log, giving up:', (e as Error).message);
      return; // exit 0: handled
    }
  }
  let result: { inserted: number; unchanged: number } | null = null, err: string | null = null;
  try { result = await main(); } catch (e) { err = (e as Error).message; console.error('dbgpu: failed:', err); }
  if (logId != null) {
    const { error } = await supabaseAdmin().from('ingest_log').update({
      finished_at: new Date().toISOString(), ok: err == null, rows_inserted: result?.inserted ?? 0, rows_unchanged: result?.unchanged ?? 0, error: err,
    }).eq('id', logId);
    if (error) console.error('dbgpu: cannot finish ingest_log row:', error.message);
  }
}

run().then(() => { process.exitCode = 0; });
