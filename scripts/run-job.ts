// scripts/run-job.ts — run the cron jobs outside Next (W4).
//   pnpm exec tsx scripts/run-job.ts <openrouter|aa|arena|livebench|epoch|calibrate|all> [--dry] [--aa-fixture <file>] [--aa-pages <n>]
// --dry: fetch + map + print counts; never touches Supabase (catalog = sample data, so `all` chains jobs on one in-memory catalog).
// AA without --aa-fixture is skipped in --dry so development never spends the 100/day quota.
import { existsSync } from 'node:fs';
import { config } from 'dotenv';

if (existsSync('.env.local')) config({ path: '.env.local', quiet: true });

async function main() {
  const { JOBS, JOB_SOURCES } = await import('@/lib/ingest/jobs');
  const { IngestContext } = await import('@/lib/ingest/context');
  const { run: aa } = await import('@/lib/ingest/aa');
  const args = process.argv.slice(2);
  const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const target = args.find(a => !a.startsWith('--') && a !== flag('--aa-fixture') && a !== flag('--aa-pages'));
  const dry = args.includes('--dry');
  const list = target === 'all' ? [...JOB_SOURCES] : JOB_SOURCES.filter(s => s === target);
  if (!list.length) { console.error(`usage: run-job.ts <${JOB_SOURCES.join('|')}|all> [--dry] [--aa-fixture file] [--aa-pages n]`); process.exit(2); }
  const ctx = dry ? await IngestContext.create({ dry: true }) : undefined;
  const log = (m: string) => console.log(`  ${m}`);
  let failed = false;
  for (const s of list) {
    const t = Date.now();
    const opts = { dry, ctx, log, fixture: s === 'aa' ? flag('--aa-fixture') : undefined };
    const r = s === 'aa' ? await aa({ ...opts, maxPages: flag('--aa-pages') ? Number(flag('--aa-pages')) : undefined }) : await JOBS[s](opts);
    console.log(`${s}${dry ? ' (dry)' : ''}: ${JSON.stringify(r)} in ${((Date.now() - t) / 1000).toFixed(1)}s`);
    if (!r.ok) failed = true;
  }
  if (ctx) console.log(`dry catalog after run: ${ctx.models.size} models, ${ctx.creators.size} creators, ${ctx.aliases.size} aliases`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
