// POST /api/runs — store speed runs shared by `atlas-probe --share` (W8).
// Checks, in SPEC order ("/api/runs checks"); a run that fails a check is stored with `rejected_reason`, never dropped:
//   1. Zod shape, probe_version >= 1.0.0 (bad input → 400 { error }, nothing stored)
//   2. device_name_raw → devices.id (exact id, alias, trigram >= 0.8); unknown → new unverified device, source 'probe'
//   3. run.file ('repo:quant') → files.id; unknown → file_id null
//   4. gen_tps > 1.3 × physical ceiling, or outside 3× IQR of its group (5+ runs) → rejected
//   5. fingerprint = SHA-256(client fingerprint + RUNS_SALT); 20 runs per fingerprint per 24 h
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { resolveDevice, type DeviceName } from '@/components/probe/match';
import type { Arch, DeviceType } from '@/lib/contracts';
import { toFileRow, toModelRow } from '@/lib/data';
import { physicalCeilingTps } from '@/lib/engine';
import { supabaseAdmin } from '@/lib/supabase/server';

type Row = Record<string, unknown>;

const MIN_VERSION = [1, 0, 0] as const;
const DAILY_LIMIT = 20;
const CEILING_SLACK = 1.3;
const IQR_K = 3, IQR_MIN_RUNS = 5, IQR_FLOOR = 0.05;
const MAX_BODY = 64 * 1024;

const num = (max: number) => z.number().nonnegative().max(max);
const Run = z.object({
  file: z.string().max(200).regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+:[^:\n]{1,80}$/, 'file must be "owner/repo:quant"'),
  runtime: z.string().trim().min(1).max(40),
  runtime_version: z.string().max(40).nullish(),
  ctx: z.int().positive().max(10_000_000).nullish(),
  gen_tps: z.number().positive().max(100_000),
  prompt_tps: num(1_000_000).nullish(),
  ttft_s: num(100_000).nullish(),
  load_s: num(100_000).nullish(),
});
const Profile = z.object({
  probe_version: z.string().regex(/^\d+\.\d+\.\d+/, 'probe_version must be x.y.z'),
  device_name_raw: z.string().trim().min(1).max(120),
  arch: z.enum(['discrete', 'unified', 'cpu']),
  devices: z.int().min(1).max(64),
  vram_gb: num(4096),
  memory_gb: z.number().positive().max(65_536),
  measured_bw_gbs: z.number().positive().max(100_000),
  ram_bw_gbs: num(100_000),
  fp16_tflops: num(100_000),
  fp8: z.boolean(),
  backend: z.enum(['cuda', 'rocm', 'metal', 'vulkan', 'cpu']),
  disk_free_gb: num(10_000_000),
  disk_read_gbs: num(1_000),
  fingerprint: z.string().min(8).max(100),
  runs: z.array(Run).max(DAILY_LIMIT),
});
type ProfileIn = z.infer<typeof Profile>;

const bad = (error: string, status = 400) => Response.json({ error }, { status });

const versionOk = (v: string) => {
  const p = v.split('.').map(n => parseInt(n, 10));
  for (let i = 0; i < 3; i++) if (p[i] !== MIN_VERSION[i]) return p[i] > MIN_VERSION[i];
  return true;
};

/** Linear-interpolated percentile of a sorted array (same as Postgres percentile_cont). */
const pct = (s: number[], p: number) => { const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'device';

const deviceType = (a: Arch): DeviceType => (a === 'discrete' ? 'gpu' : a);

type Db = ReturnType<typeof supabaseAdmin>;

async function allDevices(db: Db): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('devices').select('id,name,aliases,bw_gbs').order('id').range(from, from + 999);
    if (error) throw new Error(`devices: ${error.message}`);
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) return out;
  }
}

/** Step 2: catalog device id + its bandwidth; inserts an unverified probe device when nothing matches. */
async function resolveOrCreateDevice(db: Db, p: ProfileIn): Promise<{ id: string; bwGbs: number }> {
  const rows = await allDevices(db);
  const names: DeviceName[] = rows.map(r => ({ id: String(r.id), name: String(r.name), aliases: (r.aliases as string[] | null) ?? [] }));
  const hit = resolveDevice(p.device_name_raw, names);
  if (hit) {
    const bw = Number(rows.find(r => String(r.id) === hit.id)?.bw_gbs);
    return { id: hit.id, bwGbs: isFinite(bw) && bw > 0 ? bw : p.measured_bw_gbs };
  }
  const id = `probe-${slug(p.device_name_raw)}`;
  const memGb = p.arch === 'discrete' && p.vram_gb > 0 ? p.vram_gb : p.memory_gb;
  const { error } = await db.from('devices').upsert({
    id, name: p.device_name_raw, category: 'Reported by probe', type: deviceType(p.arch),
    mem_gb: memGb, bw_gbs: p.measured_bw_gbs, fp16_tflops: p.fp16_tflops || null, fp8: p.fp8, backend: p.backend,
    source: 'probe', verified: false,
  }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw new Error(`devices insert: ${error.message}`);
  return { id, bwGbs: p.measured_bw_gbs };
}

const splitRef = (ref: string) => { const i = ref.lastIndexOf(':'); return { repo: ref.slice(0, i), quant: ref.slice(i + 1) }; };

/** Step 3: 'repo:quant' → file row + its model row (both null when unknown). */
async function resolveFiles(db: Db, refs: string[]) {
  const out = new Map<string, { file: ReturnType<typeof toFileRow>; model: ReturnType<typeof toModelRow> | null }>();
  const repos = [...new Set(refs.map(r => splitRef(r).repo))];
  if (!repos.length) return out;
  const { data: files, error } = await db.from('files').select('id,model_id,repo,uploader,quant,format,bits_per_weight,size_gb,kind,downloads').in('repo', repos);
  if (error) throw new Error(`files: ${error.message}`);
  const matched = ((files ?? []) as Row[]).filter(f => refs.includes(`${f.repo}:${f.quant}`));
  const modelIds = [...new Set(matched.map(f => String(f.model_id)))];
  const models = new Map<string, Row>();
  if (modelIds.length) {
    const { data, error: e2 } = await db.from('models').select('*').in('id', modelIds);
    if (e2) throw new Error(`models: ${e2.message}`);
    for (const m of (data ?? []) as Row[]) models.set(String(m.id), m);
  }
  for (const f of matched) {
    const m = models.get(String(f.model_id));
    out.set(`${f.repo}:${f.quant}`, { file: toFileRow(f), model: m ? toModelRow(m) : null });
  }
  return out;
}

export async function POST(req: Request) {
  // 1. shape ------------------------------------------------------------------------------------
  const text = await req.text().catch(() => '');
  if (text.length > MAX_BODY) return bad('Profile is too large');
  let body: unknown;
  try { body = JSON.parse(text); } catch { return bad('Body must be the profile JSON printed by atlas-probe'); }
  const parsed = Profile.safeParse(body);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return bad(`Invalid profile: ${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`);
  }
  const p = parsed.data;
  if (!versionOk(p.probe_version)) return bad('probe_version must be 1.0.0 or newer; run npx atlas-probe@latest');
  if (!p.runs.length) return Response.json({ accepted: 0, rejected: [] });

  const salt = process.env.RUNS_SALT;
  if (!salt) return bad('Run sharing is not configured on this site', 503);
  let db: Db;
  try { db = supabaseAdmin(); } catch { return bad('Run sharing is not configured on this site', 503); }

  try {
    // 2. device, 3. files ---------------------------------------------------------------------
    const device = await resolveOrCreateDevice(db, p);
    const files = await resolveFiles(db, [...new Set(p.runs.map(r => r.file))]);

    // 5. fingerprint + quota (stored runs, accepted or not, in the last 24 h) -------------------
    const fingerprint = createHash('sha256').update(p.fingerprint + salt).digest('hex');
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count, error: ce } = await db.from('runs').select('id', { count: 'exact', head: true }).eq('fingerprint', fingerprint).gte('created_at', since);
    if (ce) throw new Error(`runs count: ${ce.message}`);
    let used = count ?? 0;

    // 4. plausibility, per run ----------------------------------------------------------------
    const groups = new Map<string, number[]>();
    const groupOf = async (fileRef: string, runtime: string) => {
      const k = `${fileRef}\u0000${runtime}`;
      if (!groups.has(k)) {
        const yearAgo = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
        const { data, error } = await db.from('runs').select('gen_tps').eq('device_id', device.id).eq('file_ref', fileRef).eq('runtime', runtime)
          .is('rejected_reason', null).gte('created_at', yearAgo).order('created_at', { ascending: false }).limit(1000);
        if (error) throw new Error(`runs group: ${error.message}`);
        groups.set(k, ((data ?? []) as Row[]).map(r => Number(r.gen_tps)).filter(isFinite).sort((a, b) => a - b));
      }
      return groups.get(k)!;
    };

    const rows: Row[] = [];
    const rejected: { file: string; reason: string }[] = [];
    for (const r of p.runs) {
      const hit = files.get(r.file) ?? null;
      let reason: string | null = null;
      if (hit?.model && hit.file.bitsPerWeight > 0 && device.bwGbs > 0) {
        const ceiling = physicalCeilingTps(hit.model, hit.file, device.bwGbs);
        if (r.gen_tps > CEILING_SLACK * ceiling) reason = `faster than this device's memory bandwidth allows (max ${Math.round(ceiling * CEILING_SLACK * 10) / 10} tok/s)`;
      }
      if (!reason) {
        const g = await groupOf(r.file, r.runtime);
        if (g.length >= IQR_MIN_RUNS) {
          // spread floored at 5% of the median so a tight group (identical rounded runs, IQR 0) can still accept new runs
          const q1 = pct(g, 0.25), q3 = pct(g, 0.75), iqr = Math.max(q3 - q1, IQR_FLOOR * pct(g, 0.5));
          if (r.gen_tps < q1 - IQR_K * iqr || r.gen_tps > q3 + IQR_K * iqr) reason = `outlier: far from the ${g.length} runs already shared for this device and file`;
        }
      }
      if (!reason && used >= DAILY_LIMIT) reason = `daily limit of ${DAILY_LIMIT} shared runs reached; try again tomorrow`;
      used++;
      rows.push({
        device_id: device.id, device_name_raw: p.device_name_raw, file_id: hit?.file.id ?? null, file_ref: r.file,
        runtime: r.runtime, runtime_version: r.runtime_version ?? null, ctx: r.ctx ?? null,
        gen_tps: r.gen_tps, prompt_tps: r.prompt_tps ?? null, ttft_s: r.ttft_s ?? null, load_s: r.load_s ?? null,
        probe_version: p.probe_version, fingerprint, verified: false, rejected_reason: reason,
      });
      if (reason) rejected.push({ file: r.file, reason });
    }

    const { error: ie } = await db.from('runs').insert(rows);
    if (ie) throw new Error(`runs insert: ${ie.message}`);
    return Response.json({ accepted: rows.length - rejected.length, rejected });
  } catch (e) {
    console.error('[api/runs]', (e as Error).message);
    return bad('Could not store the runs right now; try again later', 500);
  }
}
