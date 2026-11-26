// lib/ingest/arena.ts — Arena (LMArena) text leaderboard, style control, overall → scores (arena, elo) (W4).
// Best-effort: reads the official CC BY 4.0 HF dataset through the public datasets-server API; any failure → skipped.
import { z } from 'zod';
import { IngestContext, TOL } from './context';
import { logRun, Skip, type JobOptions, type JobResult } from './log';
import { SOURCES } from './sources';
import { diff, errMsg, fetchJson, round } from './util';

/** Only the top of the board: older / retired models would only flood /admin/match with unmatched names. */
const TOP_N = 200;
const PAGE = 100;

const Resp = z.object({
  num_rows_total: z.number(),
  rows: z.array(z.object({ row: z.object({ model_name: z.string(), organization: z.string().nullish(), rating: z.number(), vote_count: z.number().nullish(), leaderboard_publish_date: z.string().nullish() }) })),
});

async function fetchRows() {
  const out: z.infer<typeof Resp>['rows'][number]['row'][] = [];
  for (let offset = 0; offset < 1000; offset += PAGE) {
    const url = `${SOURCES.arena.urls.rows}&where=${encodeURIComponent(`"category"='overall'`)}&offset=${offset}&length=${PAGE}`;
    const r = Resp.parse(await fetchJson(url, { timeoutMs: 20_000 }));
    out.push(...r.rows.map(x => x.row));
    if (offset + PAGE >= r.num_rows_total) break;
  }
  return out;
}

async function sync(opts: JobOptions): Promise<Omit<JobResult, 'ok'>> {
  const log = opts.log ?? (() => {});
  if (!SOURCES.arena.enabled) throw new Skip('disabled in lib/ingest/sources.ts');
  let rows;
  try { rows = await fetchRows(); } catch (e) { throw new Skip(`Arena dataset unavailable: ${errMsg(e)}`); }
  if (!rows.length) throw new Skip('Arena dataset returned no rows');
  const ctx = opts.ctx ?? await IngestContext.create({ dry: opts.dry });
  const i0 = ctx.inserted, u0 = ctx.unchanged, d0 = ctx.dropped, m0 = { ...ctx.methods };
  await ctx.preloadLatest('scores', 'arena');
  const top = [...rows].sort((a, b) => b.rating - a.rating).slice(0, TOP_N);
  let scored = 0;
  for (const r of top) {
    const creatorId = r.organization ? ctx.creator(r.organization, null) : null;
    const id = ctx.matchModel('arena', r.model_name, r.model_name, creatorId);
    if (!id) continue;
    scored++;
    ctx.insertIfChanged('scores', { model_id: id, source: 'arena', metric: 'intelligence' },
      { value: round(r.rating, 1), scale: 'elo', source_ref: `lmarena text_style_control ${r.leaderboard_publish_date ?? ''}`.trim() }, TOL.score);
  }
  log(`arena: ${rows.length} overall rows, top ${top.length} matched ${scored}; match ${JSON.stringify(diff(ctx.methods, m0))}; pending ${JSON.stringify(ctx.pending())}; duplicate facts dropped ${ctx.dropped - d0}`);
  await ctx.flush();
  return { inserted: ctx.inserted - i0, unchanged: ctx.unchanged - u0 };
}

export const run = (opts: JobOptions = {}): Promise<JobResult> => logRun('arena', () => sync(opts), opts);
