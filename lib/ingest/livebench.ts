// lib/ingest/livebench.ts — LiveBench leaderboard → scores (livebench, pct) (W4).
// Best-effort: the site loads ./data/{release}/table.csv + categories.json; the newest release id (8 digits) is listed in
// the site's JS bundle. Overall = weighted mean of category means, with `_overall_weights` (default 1) — as the site does.
import { IngestContext, TOL } from './context';
import { logRun, Skip, type JobOptions, type JobResult } from './log';
import { SOURCES } from './sources';
import { diff, errMsg, fetchJson, fetchText, num, parseCsv, round } from './util';

async function latestRelease(): Promise<string> {
  const html = await fetchText(SOURCES.livebench.urls.site);
  const js = html.match(/src="\.?\/?(static\/js\/main\.[\w]+\.js)"/)?.[1];
  if (!js) throw new Error('main bundle not found on livebench.ai');
  const bundle = await fetchText(new URL(js, SOURCES.livebench.urls.site).toString(), { timeoutMs: 25_000 });
  const ids = [...bundle.matchAll(/\[\s*("20\d{6}"(?:\s*,\s*"20\d{6}")*)\s*\]/g)].flatMap(m => m[1].match(/20\d{6}/g) ?? []);
  if (!ids.length) throw new Error('no release ids in the livebench.ai bundle');
  return ids.sort().at(-1)!;
}

async function sync(opts: JobOptions): Promise<Omit<JobResult, 'ok'>> {
  const log = opts.log ?? (() => {});
  if (!SOURCES.livebench.enabled) throw new Skip('disabled in lib/ingest/sources.ts');
  let release: string, table: Record<string, string>[], cats: Record<string, unknown>;
  try {
    release = await latestRelease();
    [table, cats] = await Promise.all([
      fetchText(SOURCES.livebench.urls.table.replace('{release}', release)).then(parseCsv),
      fetchJson<Record<string, unknown>>(SOURCES.livebench.urls.categories.replace('{release}', release)),
    ]);
  } catch (e) { throw new Skip(`LiveBench data unavailable: ${errMsg(e)}`); }
  const weights = (cats._overall_weights ?? {}) as Record<string, number>;
  const groups = Object.entries(cats).filter(([k, v]) => k !== '_overall_weights' && Array.isArray(v)) as [string, string[]][];
  if (!table.length || !groups.length) throw new Skip('LiveBench table or categories empty / changed shape');

  const ctx = opts.ctx ?? await IngestContext.create({ dry: opts.dry });
  const i0 = ctx.inserted, u0 = ctx.unchanged, d0 = ctx.dropped, m0 = { ...ctx.methods };
  await ctx.preloadLatest('scores', 'livebench');
  let scored = 0;
  for (const row of table) {
    const name = row.model;
    if (!name) continue;
    let sum = 0, w = 0;
    for (const [cat, cols] of groups) {
      const vals = cols.map(c => num(row[c])).filter((v): v is number => v != null);
      if (!vals.length) continue;
      const wt = num(weights[cat]) ?? 1;
      sum += (vals.reduce((a, b) => a + b, 0) / vals.length) * wt; w += wt;
    }
    if (!w) continue;
    const id = ctx.matchModel('livebench', name, name, null);
    if (!id) continue;
    scored++;
    ctx.insertIfChanged('scores', { model_id: id, source: 'livebench', metric: 'intelligence' }, { value: round(sum / w, 1), scale: 'pct', source_ref: `livebench ${release}` }, TOL.score);
  }
  log(`livebench: release ${release}, ${table.length} models, ${scored} matched; match ${JSON.stringify(diff(ctx.methods, m0))}; pending ${JSON.stringify(ctx.pending())}; duplicate facts dropped ${ctx.dropped - d0}`);
  await ctx.flush();
  return { inserted: ctx.inserted - i0, unchanged: ctx.unchanged - u0 };
}

export const run = (opts: JobOptions = {}): Promise<JobResult> => logRun('livebench', () => sync(opts), opts);
