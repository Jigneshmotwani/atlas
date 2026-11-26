// scripts/import-vendor-benchmarks.ts — upsert data/vendor-benchmarks/*.csv into vendor_benchmarks (W1, after launch).
//   pnpm exec tsx scripts/import-vendor-benchmarks.ts [--dry]
// Rows are curated by hand from vendor publications (NVIDIA Technical Blog, OEM spec sheets), one row per published
// number. model_id may be empty when the model is not in Atlas yet; device_id must exist in `devices`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';

if (existsSync('.env.local')) config({ path: '.env.local', quiet: true });

async function main() {
  const { parseCsv, num } = await import('@/lib/ingest/util');
  const { supabaseAdmin } = await import('@/lib/supabase/server');
  const dry = process.argv.includes('--dry');
  const dir = join(process.cwd(), 'data', 'vendor-benchmarks');
  const rows = readdirSync(dir).filter(f => f.endsWith('.csv')).flatMap(f => parseCsv(readFileSync(join(dir, f), 'utf8')));
  const out = rows.filter(r => r.device_id && r.model_name && r.precision && r.runtime && r.source && r.source_url && (num(r.gen_tps) != null || num(r.prompt_tps) != null))
    .map(r => ({
      device_id: r.device_id, devices: num(r.devices) ?? 1, model_id: r.model_id || null, model_name: r.model_name, precision: r.precision,
      runtime: r.runtime, batch: num(r.batch) ?? 1, isl: num(r.isl), osl: num(r.osl), prompt_tps: num(r.prompt_tps), gen_tps: num(r.gen_tps),
      source: r.source, source_name: r.source_name || r.source, source_url: r.source_url, published_on: r.published_on || null, note: r.note || null,
    }));
  console.log(`${rows.length} CSV rows, ${out.length} valid, ${out.filter(r => r.model_id).length} linked to an Atlas model`);
  if (dry || !out.length) return;
  const db = supabaseAdmin();
  // a model_id that no longer exists would fail the FK: unlink it instead of dropping the row
  const ids = [...new Set(out.map(r => r.model_id).filter((x): x is string => !!x))];
  const { data, error } = await db.from('models').select('id').in('id', ids);
  if (error) throw new Error(`models: ${error.message}`);
  const known = new Set((data ?? []).map(r => String((r as { id: string }).id)));
  for (const r of out) if (r.model_id && !known.has(r.model_id)) { console.log(`  unknown model_id ${r.model_id}: stored unlinked`); r.model_id = null; }
  const { error: e2 } = await db.from('vendor_benchmarks').upsert(out, { onConflict: 'device_id,devices,model_name,precision,runtime,batch,source' });
  if (e2) throw new Error(`vendor_benchmarks upsert: ${e2.message}`);
  console.log(`upserted ${out.length} vendor benchmark rows`);
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
