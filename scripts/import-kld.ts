// scripts/import-kld.ts — upsert data/kld/*.csv (repo,quant,kld,eval_set,source,source_ref) into file_quality (W4).
//   pnpm exec tsx scripts/import-kld.ts [--dry]
// Resolves repo + quant → files.id (exact quant, then case-insensitive); unresolved rows are listed, not inserted
// (run hf-sync first so the files exist).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';

if (existsSync('.env.local')) config({ path: '.env.local', quiet: true });

async function main() {
  const { parseCsv, num } = await import('@/lib/ingest/util');
  const { supabaseAdmin } = await import('@/lib/supabase/server');
  const dry = process.argv.includes('--dry');
  const dir = join(process.cwd(), 'data', 'kld');
  const rows = readdirSync(dir).filter(f => f.endsWith('.csv')).flatMap(f => parseCsv(readFileSync(join(dir, f), 'utf8')).map((r): Record<string, string> => ({ ...r, file: f })));
  const valid = rows.filter(r => r.repo && r.quant && r.eval_set && r.source && num(r.kld) != null);
  console.log(`${rows.length} CSV rows, ${valid.length} valid`);
  if (!valid.length) return;
  const db = supabaseAdmin();
  const repos = [...new Set(valid.map(r => r.repo))];
  const { data, error } = await db.from('files').select('id,repo,quant').in('repo', repos);
  if (error) throw new Error(`files: ${error.message}`);
  const files = (data ?? []) as { id: number; repo: string; quant: string }[];
  const out: Record<string, unknown>[] = [], missing: string[] = [];
  for (const r of valid) {
    const f = files.find(x => x.repo === r.repo && x.quant === r.quant) ?? files.find(x => x.repo.toLowerCase() === r.repo.toLowerCase() && x.quant.toLowerCase() === r.quant.toLowerCase());
    if (!f) { missing.push(`${r.file}: ${r.repo}:${r.quant}`); continue; }
    out.push({ file_id: f.id, kld: num(r.kld), eval_set: r.eval_set, source: r.source, source_ref: r.source_ref || null, measured_at: new Date().toISOString() });
  }
  const uniq = [...new Map(out.map(o => [`${o.file_id}|${o.eval_set}|${o.source}`, o])).values()];
  if (!dry && uniq.length) {
    const { error: e2 } = await db.from('file_quality').upsert(uniq, { onConflict: 'file_id,eval_set,source' });
    if (e2) throw new Error(`file_quality: ${e2.message}`);
  }
  console.log(`${dry ? 'would upsert' : 'upserted'} ${uniq.length} file_quality rows; ${missing.length} unresolved${missing.length ? ':\n  ' + missing.join('\n  ') : ''}`);
}
main().catch(e => { console.error(e); process.exit(1); });
