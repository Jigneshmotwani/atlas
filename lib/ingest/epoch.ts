// lib/ingest/epoch.ts — Epoch Capabilities Index (ECI) → scores (epoch, index) (W4).
// Best-effort: https://epoch.ai/data/eci_scores.csv (CC BY 4.0); any failure → skipped.
import { IngestContext, TOL } from './context';
import { logRun, Skip, type JobOptions, type JobResult } from './log';
import { SOURCES } from './sources';
import { diff, errMsg, fetchText, num, parseCsv, round } from './util';

async function sync(opts: JobOptions): Promise<Omit<JobResult, 'ok'>> {
  const log = opts.log ?? (() => {});
  if (!SOURCES.epoch.enabled) throw new Skip('disabled in lib/ingest/sources.ts');
  let rows: Record<string, string>[];
  try { rows = parseCsv(await fetchText(SOURCES.epoch.urls.eci, { timeoutMs: 25_000 })); } catch (e) { throw new Skip(`Epoch ECI unavailable: ${errMsg(e)}`); }
  if (!rows.length || !('eci' in rows[0]) || !('Model' in rows[0])) throw new Skip('Epoch ECI CSV changed shape (no Model / eci columns)');

  const ctx = opts.ctx ?? await IngestContext.create({ dry: opts.dry });
  const i0 = ctx.inserted, u0 = ctx.unchanged, d0 = ctx.dropped, m0 = { ...ctx.methods };
  await ctx.preloadLatest('scores', 'epoch');
  let scored = 0;
  for (const r of rows) {
    const eci = num(r.eci), model = r.Model;
    if (eci == null || !model) continue;
    const display = r['Display name'] || model;
    const org = (r.Organization ?? '').split(',')[0].trim();
    const id = ctx.matchModel('epoch', model, display, org ? ctx.creator(org, org) : null, { altNames: [model] });
    if (!id) continue;
    scored++;
    ctx.insertIfChanged('scores', { model_id: id, source: 'epoch', metric: 'intelligence' }, { value: round(eci, 1), scale: 'index', source_ref: 'epoch eci_scores.csv' }, TOL.score);
  }
  log(`epoch: ${rows.length} models, ${scored} matched; match ${JSON.stringify(diff(ctx.methods, m0))}; pending ${JSON.stringify(ctx.pending())}; duplicate facts dropped ${ctx.dropped - d0}`);
  await ctx.flush();
  return { inserted: ctx.inserted - i0, unchanged: ctx.unchanged - u0 };
}

export const run = (opts: JobOptions = {}): Promise<JobResult> => logRun('epoch', () => sync(opts), opts);
